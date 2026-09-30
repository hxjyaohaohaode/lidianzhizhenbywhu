"""Saved-experiment approval chain; all inputs/providers are isolated fixtures."""
import copy
from datetime import date
from unittest.mock import patch
import pytest
from conftest import Actor, editable
from test_adaptive import ResearchProviders, preview, dispatch
from server.autonomy import execute_local_capability
from server.evolution import replay
from server.saved_experiments import selected_output
from server.store import digest, encode


def save(actor, dataset, **kwargs):
    response = actor.post('/workspace/experiments', json={'dataset_id': dataset['id'],
        'dataset_version': dataset['version'], 'dataset_hash': dataset['content_hash'],
        'kind': 'scenario', 'name': '隔离测试数学实验', 'price_change': .1, 'cost_change': .03,
        'volume_change': -.05, 'fixed_cost_share': .4, 'assumptions': '测试中的批准假设与成本边界', **kwargs})
    assert response.status_code == 201, response.text
    return response.json()


def reference(e):
    return {'id': e['id'], 'version': e['version'], 'hash': e['experiment_hash']}


def long_dataset(actor):
    d = actor.dataset(); body = editable(d)
    row = body['periods'][0]
    body['periods'] = [{**row, 'period': f'{2023+i//4}-Q{i%4+1}', 'revenue': row['revenue']*(1+i/100)} for i in range(15)]
    r = actor.put('/datasets/'+d['id'], json=body)
    assert r.status_code == 200, r.text
    return r.json()


def modify_experiment(actor, e, *, version=False, mutate=None, delete=False):
    store = actor.client.app.state.store
    with store.transaction() as db:
        if delete:
            db.execute('DELETE FROM workspace_objects WHERE id=?', (e['id'],))
        elif mutate:
            p = copy.deepcopy(e['payload']); mutate(p)
            db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(p),e['id']))
        else:
            db.execute('UPDATE workspace_objects SET version=version+1 WHERE id=?', (e['id'],))


def test_saved_scenario_to_approved_report_replay_and_export(actor):
    d=actor.dataset();e=save(actor,d,assumptions='完整保留长假设：'+'原始假设边界'*210)
    assert e['experiment_hash']==digest(e['payload'])
    listed=actor.get('/workspace/experiments').json()['items'][0]
    assert listed['experiment_hash']==e['experiment_hash'] and 'result' not in listed['payload']
    p=preview(actor,dataset=d,experiment=reference(e))
    assert p['payload']['bindings']['experiment']==reference(e)
    assert p['payload']['context']['selected_experiment']['assumptions']==e['payload']['request']['assumptions']
    assert p['payload']['request']['execution']['scenario']['note']==e['payload']['request']['assumptions']
    run=actor.execute(dispatch(actor,p)); result=run['result'];out=result['adaptive']['mathematical_outputs']['sensitivity']
    assert run['state'] in ('succeeded','degraded'),run
    assert out['result']==e['payload']['result']['result']
    assert out['experiment']==result['experiment']
    assert result['experiment']['result_hash']==digest(e['payload']['result'])
    r=replay(run,['sensitivity'],{'depth':'deep','require_gap_analysis':True})
    assert r['covered']==['sensitivity'] and r['experiment']==result['experiment']
    assert r['computations']['sensitivity']['output_hash']==digest(out)
    md=actor.get('/runs/'+run['id']+'/export?format=md')
    assert md.status_code==200 and e['id'] in md.text and e['experiment_hash'] in md.text
    audit=actor.get('/workspace/runs/'+run['id']+'/audit').json()
    assert audit['ledger']['valid'] and audit['report_hash_valid'] and audit['snapshot_hash_valid']
    before=copy.deepcopy(result)
    modify_experiment(actor,e,delete=True)
    assert actor.get('/runs/'+run['id']).json()['result']==before
    assert replay(run,['sensitivity'],None)['computations']['sensitivity']['output_hash']==digest(out)


def test_historical_saved_experiment_uses_exact_prefix(actor):
    d=actor.dataset();target=d['payload']['periods'][1]['period'];e=save(actor,d,target_period=target)
    p=preview(actor,dataset=d,query=f'{target}经营毛利研判',experiment=reference(e))
    run=actor.execute(dispatch(actor,p))
    assert run['result']['analysis']['current_period']==target
    out=run['result']['adaptive']['mathematical_outputs']['sensitivity']
    assert out['period']==target and out['result']==e['payload']['result']['result']
    assert len(run['snapshot']['dataset']['periods'])==len(d['payload']['periods'])
    invalid=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'最近一季经营研判','experiment':reference(e)})
    assert invalid.status_code==409 and invalid.json()['error']['code']=='EXPERIMENT_PERIOD'


def test_forecast_reuses_original_as_of_after_quarter_rollover(actor):
    d=long_dataset(actor)
    with patch('server.saved_experiments.utc_today',return_value=date(2026,9,30)):
        e=save(actor,d,kind='forecast',metric='cash_flow',horizon=3)
    assert e['payload']['analysis_as_of']=='2026-09-30'
    assert e['payload']['result']['train_end']=='2026-Q2'
    p=preview(actor,dataset=d,experiment=reference(e),execution={'depth':'concise'})
    with patch('server.analytics.utc_today',return_value=date(2027,2,1)):
        run=actor.execute(dispatch(actor,p))
        replayed=replay(run,['forecast'],None)
    out=run['result']['adaptive']['mathematical_outputs']['forecast']
    assert out['train_end']=='2026-Q2' and out['forecast']==e['payload']['result']['forecast']
    assert out['approved_assumptions']['note']==e['payload']['request']['assumptions']
    assert replayed['computations']['forecast']['output_hash']==digest(out)
    assert out['experiment']['analysis_as_of']=='2026-09-30'


@pytest.mark.parametrize('change', ['version','hash','dataset','owner','stale_dataset','period','assumptions'])
def test_reject_invalid_selection_before_plan_persistence(actor,change):
    d=actor.dataset();e=save(actor,d)
    payload={'dataset_id':d['id'],'query':'经营毛利及现金研判','experiment':reference(e)}; requester=actor
    if change=='version':payload['experiment']['version']+=1
    elif change=='hash':payload['experiment']['hash']='0'*64
    elif change=='dataset':payload['dataset_id']=actor.dataset()['id']
    elif change=='owner':requester=Actor(actor.client);payload['dataset_id']=requester.dataset()['id']
    elif change=='stale_dataset':
        body=editable(d);body['notes']+='修订';assert actor.put('/datasets/'+d['id'],json=body).status_code==200
    elif change=='period':payload['query']=d['payload']['periods'][0]['period']+'经营研判'
    elif change=='assumptions':payload['execution']={'scenario':{'price_change':.2,'note':'与原实验不同的说明'}}
    r=requester.post('/workspace/plans',json=payload)
    assert r.status_code in (404,409),r.text
    assert requester.get('/workspace/plans').json()['items']==[]


@pytest.mark.parametrize('fields',[{'forecast':False},{'forecast_metric':'cost'},{'horizon':4}])
def test_saved_forecast_rejects_conflicting_explicit_options(actor,fields):
    d=long_dataset(actor);e=save(actor,d,kind='forecast',metric='cash_flow',horizon=3)
    r=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'企业经营核查','experiment':reference(e),'execution':fields})
    assert r.status_code==409 and r.json()['error']['code']=='EXPERIMENT_ASSUMPTIONS'


@pytest.mark.parametrize('operation',['version','delete','payload'])
def test_source_changed_after_preview_invalidates_approval(actor,operation):
    d=actor.dataset();e=save(actor,d);p=preview(actor,dataset=d,experiment=reference(e))
    modify_experiment(actor,e,delete=operation=='delete',mutate=(lambda v:v['request'].update(assumptions='被修改的假设说明')) if operation=='payload' else None)
    r=actor.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']})
    assert r.status_code==409 and r.json()['error']['code']=='PLAN_STALE'
    assert not actor.client.app.state.store.all('SELECT * FROM runs')


def test_actual_expert_context_claim_and_dispatch_revalidation(factory):
    async def handler(p,system,obj,count):
        tool=obj['approved_tool_results']['sensitivity']
        assert tool['experiment']['hash']==e['experiment_hash']
        assert tool['approved_assumptions']['note']==e['payload']['request']['assumptions']
        return {'output':{'claims':[{'text':'已保存假设下的数学产物需要核查适用边界','tool_reference_ids':['sensitivity:delta_gross_profit']}],'missing':[]}}
    provider=ResearchProviders(handler=handler);a=Actor(factory(provider));d=a.dataset();e=save(a,d)
    p=preview(a,dataset=d,experiment=reference(e),use_llm=True,provider='alpha',max_calls=1)
    run=a.execute(dispatch(a,p));claim=run['result']['llm']['review']['claims'][0]
    assert len(provider.calls)==1 and claim['tool_references'][0]['experiment']['id']==e['id']
    p2=preview(a,dataset=d,experiment=reference(e),use_llm=True,provider='alpha',max_calls=1)
    queued=dispatch(a,p2);modify_experiment(a,e,delete=True)
    stopped=a.execute(queued)
    assert len(provider.calls)==1 and stopped['result']['llm']['state']=='failed'
    assert stopped['result']['adaptive']['mathematical_outputs']['sensitivity']['experiment']['id']==e['id']


def test_frozen_integrity_and_assumptions_fail_closed(actor):
    d=actor.dataset();e=save(actor,d);p=preview(actor,dataset=d,experiment=reference(e))
    snapshot=p['payload']['snapshot'];ex=p['payload']['request']['execution']
    for mutate in [lambda s:s['experiment']['payload']['result']['result'].update(revenue=1),
                   lambda s:s['research_scope'].update(period=d['payload']['periods'][0]['period'])]:
        s=copy.deepcopy(snapshot);mutate(s)
        with pytest.raises(ValueError):selected_output('sensitivity',s,ex)
    altered=copy.deepcopy(ex);altered['scenario']['price_change']=.4
    with pytest.raises(ValueError):selected_output('sensitivity',snapshot,altered)
    modify_experiment(actor,e,mutate=lambda s:s['result']['result'].update(revenue=1))
    e2=actor.get('/workspace/experiments/'+e['id']).json()
    r=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'企业经营核查','experiment':reference(e2)})
    assert r.status_code==409 and r.json()['error']['code']=='EXPERIMENT_INTEGRITY'


def test_legacy_forecast_without_asof_remains_readable_but_cannot_be_reused(actor):
    d=long_dataset(actor);e=save(actor,d,kind='forecast')
    modify_experiment(actor,e,mutate=lambda p:p.pop('analysis_as_of'))
    old=actor.get('/workspace/experiments/'+e['id']).json()
    assert old['payload']['result']==e['payload']['result']
    r=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'企业经营核查','experiment':reference(old)})
    assert r.status_code==409 and r.json()['error']['code']=='EXPERIMENT_INTEGRITY'


@pytest.mark.parametrize('extra',[{'dataset_version':99},{'dataset_hash':'0'*64},{'target_period':'2024-Q1'}])
def test_create_experiment_rechecks_explicit_input_version_and_period(actor,extra):
    d=actor.dataset();r=actor.post('/workspace/experiments',json={'dataset_id':d['id'],'kind':'scenario','name':'隔离实验','assumptions':'仅用于隔离参数校验',**extra})
    assert r.status_code==409 and actor.get('/workspace/experiments').json()['items']==[]


def test_experiment_reference_enables_real_adaptive_plan_without_inline_execution(actor):
    d=actor.dataset();e=save(actor,d)
    r=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'核查已保存情景的业务边界','experiment':reference(e)})
    assert r.status_code==201,r.text
    p=r.json();assert p['payload']['adaptive'] and p['payload']['request']['execution']['scenario']
    run=actor.execute(dispatch(actor,p))
    assert run['result']['experiment']['id']==e['id']


def test_old_scenario_can_be_verified_without_inventing_asof_date(actor):
    d=actor.dataset();e=save(actor,d)
    def legacy(p):
        p.pop('analysis_as_of');p.pop('target_period')
        for k in ('dataset_version','dataset_hash','target_period'):p['request'].pop(k)
    modify_experiment(actor,e,mutate=legacy)
    old=actor.get('/workspace/experiments/'+e['id']).json()
    plan=preview(actor,dataset=d,experiment=reference(old))
    run=actor.execute(dispatch(actor,plan))
    assert run['result']['experiment']['analysis_as_of'] is None
    assert run['result']['adaptive']['mathematical_outputs']['sensitivity']['result']==old['payload']['result']['result']
