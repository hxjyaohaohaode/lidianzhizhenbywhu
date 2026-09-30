"""Explicit multi-company approval, disclosure and historical replay; no live suppliers."""
import copy
import json
from datetime import date
from unittest.mock import patch
import pytest
from conftest import Actor, editable
from test_adaptive import ResearchProviders, dispatch
from test_services import identity, ok
from test_evolution import assessment, candidate
from test_saved_experiments import save as save_experiment, reference as experiment_ref
from server.evolution import replay, grouped_cases
from server.saved_comparisons import freeze, current_impact, selected_output, METRICS
from server.research_context import project_tools, disclosed_references, omit_tool_details
from server.store import digest, encode


def inputs(actor):
    a=actor.dataset();body=editable(a);body.pop('version');body['company']='同行合成企业，仅用于隔离测试';body['name']='同行数据测试'
    body['periods'][-1]['revenue']*=1.2
    return a,ok(actor.post('/datasets',json=body),201)


def spec(datasets,**extra):
    return {'name':'隔离企业对照','identity_id':'','datasets':[{'id':d['id'],'version':d['version'],'hash':d['content_hash']} for d in datasets],
            'comparison':'year_over_year','comparability_note':'核对共同季度与会计口径；仅作隔离测试，不代表行业基准',**extra}


def saved(actor,datasets,**extra):
    return ok(actor.post('/workspace/comparisons',json=spec(datasets,**extra)),201)


def reference(row):return {'id':row['id'],'version':row['version'],'hash':row['comparison_hash']}


def plan(actor,datasets,row,**extra):
    return actor.post('/workspace/plans',json={'dataset_id':datasets[0]['id'],'query':'核查企业经营差异和可比口径','comparison_artifact':reference(row),**extra})


def run(actor,datasets,row,**extra):return actor.execute(dispatch(actor,ok(plan(actor,datasets,row,**extra),201)))


def revise(actor,d):
    body=editable(d);body['periods'][-1]['revenue']+=13
    return ok(actor.put('/datasets/'+d['id'],json=body))


def test_save_uses_existing_common_quarter_calculator_and_frozen_history(actor):
    ds=inputs(actor);ordinary=ok(actor.post('/compare',json={'dataset_ids':[d['id'] for d in ds]}))
    c=saved(actor,ds);p=c['payload']
    stripped=copy.deepcopy(p['result'])
    for item in stripped['items']:item.pop('dataset_hash')
    assert stripped==ordinary
    assert c['comparison_hash']==digest(p) and c['source_impact']['state']=='current'
    assert p['period_basis']=='standalone_quarter' and all(m['snapshot']['amount_unit']=='yuan' for m in p['members'])
    rows=ok(actor.get('/workspace/comparisons'))['items']
    assert rows[0]['comparison_hash']==c['comparison_hash']
    assert 'result' not in rows[0]['payload'] and all('snapshot' not in m for m in rows[0]['payload']['members'])
    assert ok(actor.get('/workspace/comparisons?dataset_id='+ds[1]['id']))['items'][0]['id']==c['id']
    assert ok(actor.get('/workspace/comparisons/'+c['id']))==c


def test_comparison_auto_adaptive_approval_report_export_and_replay(actor):
    ds=inputs(actor);c=saved(actor,ds);p=ok(plan(actor,ds,c),201)
    assert p['payload']['request']['execution'] is not None
    assert [n['id'] for n in p['payload']['nodes']].count('comparison')==1
    assert p['payload']['bindings']['comparison_artifact']==reference(c)
    assert p['payload']['context']['selected_comparison']['hash']==c['comparison_hash']
    assert 'snapshot' not in json.dumps(p['payload']['context'])
    r=actor.execute(dispatch(actor,p));result=r['result'];output=result['adaptive']['mathematical_outputs']['comparison']
    assert result['comparison_artifact']==r['snapshot']['comparison_artifact']
    assert output['items']==c['payload']['result']['items']
    assert result['comparison_provenance']['hash']==c['comparison_hash']
    rep=replay(r,['comparison'],{'depth':'deep','require_gap_analysis':True})
    assert rep['comparison_provenance']==result['comparison_provenance']
    assert rep['comparison_hash']==digest(output) and rep['covered']==['comparison']
    for format in ('md','json'):
        exported=actor.get('/runs/'+r['id']+'/export?format='+format)
        assert exported.status_code==200 and c['comparison_hash'] in exported.text and ds[1]['id'] in exported.text
    audit=ok(actor.get('/workspace/runs/'+r['id']+'/audit'))
    assert audit['ledger']['valid'] and audit['report_hash_valid'] and audit['snapshot_hash_valid']
    ok(actor.delete('/workspace/comparisons/'+c['id']+'?version=1'))
    ok(actor.delete('/datasets/'+ds[1]['id']+'?version=1'))
    assert ok(actor.get('/runs/'+r['id']))['result']==result
    assert replay(r,['comparison'],None)['comparison_hash']==digest(output)


def test_model_gets_only_verified_compact_member_references_and_explicit_consent(factory):
    async def handler(provider,system,obj,count):
        tool=obj['approved_tool_results']['comparison'];peer=tool['items'][1]
        assert 'analysis' not in peer and set(peer['metrics'])==set(METRICS)
        assert not any(word in json.dumps(tool,ensure_ascii=False) for word in ('snapshot','秘密同行资料','秘密同行记忆','periods'))
        assert not any(word in json.dumps(obj,ensure_ascii=False) for word in ('秘密同行资料','秘密同行记忆'))
        refs=tool['references'];key='comparison:'+ds[1]['id']+':gross_margin'
        assert refs[key]['dataset_id']==ds[1]['id'] and refs[key]['period']==c['payload']['period']
        assert refs[key]['unit']=='ratio'
        return {'output':{'claims':[{'text':'在明确可比口径下核查同行毛利差异','tool_reference_ids':[key]}],'missing':[]}}
    providers=ResearchProviders(handler=handler);a=Actor(factory(providers));ds=inputs(a)
    ok(a.post('/evidence',json={'title':'秘密同行资料','text':'秘密同行资料'*20,'company':ds[1]['payload']['company']}),201)
    ok(a.post('/memories',json={'text':'秘密同行记忆，只适用该同行企业','company':ds[1]['payload']['company'],'kind':'fact','approved':True}),201)
    c=saved(a,ds);p=ok(plan(a,ds,c,use_llm=True,provider='alpha',max_calls=1),201)
    disclosure='\n'.join(p['payload']['consent_scope'])
    assert all(d['payload']['company'] in disclosure and d['id'] in disclosure for d in ds)
    assert a.post('/workspace/plans/'+p['id']+'/execute',json={'version':1,'fingerprint':p['payload']['fingerprint']}).status_code==403
    r=a.execute(dispatch(a,p));assert len(providers.calls)==1
    assert r['result']['llm']['review']['claims'],r['result']['llm']
    claim=r['result']['llm']['review']['claims'][0]
    assert claim['tool_references'][0]['dataset_id']==ds[1]['id']
    assert claim['tool_references'][0]['value']==c['payload']['result']['items'][1]['analysis']['metrics']['gross_margin']


@pytest.mark.parametrize('bad',['owner','dataset_version','dataset_hash','duplicate','scope','no_common','target','blank_note'])
def test_reject_invalid_creation_without_saved_side_effects(actor,bad):
    ds=inputs(actor);payload=spec(ds)
    expected=409
    if bad=='owner':payload['datasets'][1]['id']=Actor(actor.client).dataset()['id'];expected=404
    elif bad=='dataset_version':payload['datasets'][1]['version']+=1
    elif bad=='dataset_hash':payload['datasets'][1]['hash']='0'*64
    elif bad=='duplicate':payload['datasets'][1]=payload['datasets'][0];expected=422
    elif bad=='scope':payload['identity_id']=identity(actor,ds[0])['id'];expected=403
    elif bad=='no_common':
        body=editable(ds[1]);body['periods']=[{**body['periods'][0],'period':'2020-Q1'}]
        other=ok(actor.put('/datasets/'+ds[1]['id'],json=body));payload=spec((ds[0],other));expected=422
    elif bad=='target':payload['target_period']='2020-Q1'
    else:payload['comparability_note']=' '*8;expected=422
    assert actor.post('/workspace/comparisons',json=payload).status_code==expected
    assert ok(actor.get('/workspace/comparisons'))['items']==[]


@pytest.mark.parametrize('bad',['owner','artifact_version','artifact_hash','primary_not_member','identity','target','basis','peer_stale','peer_deleted','artifact_deleted'])
def test_selection_rejects_bad_owner_scope_version_period_basis(actor,bad):
    ds=inputs(actor);c=saved(actor,ds);body={'dataset_id':ds[0]['id'],'query':'核查企业经营差异','comparison_artifact':reference(c)};who=actor;expected=409
    if bad=='owner':who=Actor(actor.client);body['dataset_id']=who.dataset()['id'];expected=404
    elif bad=='artifact_version':body['comparison_artifact']['version']+=1
    elif bad=='artifact_hash':body['comparison_artifact']['hash']='0'*64
    elif bad=='primary_not_member':body['dataset_id']=actor.dataset()['id']
    elif bad=='identity':body['identity_id']=identity(actor)['id'];expected=403
    elif bad=='target':body['query']=ds[0]['payload']['periods'][0]['period']+'经营对照分析'
    elif bad=='basis':body['comparison']='previous'
    elif bad=='peer_stale':revise(actor,ds[1])
    elif bad=='peer_deleted':ok(actor.delete('/datasets/'+ds[1]['id']+'?version=1'))
    else:ok(actor.delete('/workspace/comparisons/'+c['id']+'?version=1'));expected=404
    response=who.post('/workspace/plans',json=body)
    assert response.status_code==expected,response.text
    assert ok(who.get('/workspace/plans'))['items']==[]


@pytest.mark.parametrize('change',['peer_revision','peer_deleted','artifact_version','artifact_deleted','identity_scope','identity_deleted'])
def test_all_sources_rechecked_at_approval_and_each_external_dispatch(factory,change):
    provider=ResearchProviders();a=Actor(factory(provider));ds=inputs(a)
    ident=identity(a,dataset_ids=[d['id'] for d in ds],allow_external=True,max_calls=2)
    c=saved(a,ds,identity_id=ident['id'])
    p=ok(plan(a,ds,c,identity_id=ident['id'],use_llm=True,provider='alpha',max_calls=2),201)
    queued=dispatch(a,p)
    next_plan=ok(plan(a,ds,c,identity_id=ident['id'],use_llm=True,provider='alpha',max_calls=2),201)
    if change=='peer_revision':revise(a,ds[1])
    elif change=='peer_deleted':ok(a.delete('/datasets/'+ds[1]['id']+'?version=1'))
    elif change=='artifact_version':
        with a.client.app.state.store.transaction() as db:db.execute('UPDATE workspace_objects SET version=version+1 WHERE id=?',(c['id'],))
    elif change=='artifact_deleted':ok(a.delete('/workspace/comparisons/'+c['id']+'?identity_id='+ident['id']+'&version=1'))
    elif change=='identity_scope':ok(a.put('/services/identities/'+ident['id'],json={**ident['payload'],'version':1,'dataset_ids':[ds[0]['id']]}))
    else:ok(a.delete('/services/identities/'+ident['id']+'?version=1'))
    reply=a.post('/workspace/plans/'+next_plan['id']+'/execute',json={'version':1,'fingerprint':next_plan['payload']['fingerprint'],'external_consent':True})
    assert reply.status_code in (403,404,409),reply.text
    r=a.execute(queued)
    assert provider.calls==[] and r['result']['llm']['state']=='failed'
    assert r['result']['adaptive']['mathematical_outputs']['comparison']['items']==c['payload']['result']['items']


def test_second_external_dispatch_rechecks_peer_after_first_call(factory):
    async def handler(p,system,obj,count):
        if count==1:
            changed=copy.deepcopy(ds[1]['payload']);changed['periods'][-1]['revenue']+=13
            with a.client.app.state.store.transaction() as db:
                db.execute('UPDATE datasets SET payload=?,content_hash=?,version=version+1 WHERE id=?',(encode(changed),digest(changed),ds[1]['id']))
        return {'output':{'claims':[{'text':'仅作为受限财务核查线索','metric_ids':['gross_margin']}],'missing':[]}}
    providers=ResearchProviders(handler=handler);a=Actor(factory(providers));ds=inputs(a);c=saved(a,ds)
    r=run(a,ds,c,use_llm=True,provider='alpha',max_calls=2)
    assert len(providers.calls)==1 and r['result']['llm']['state']=='partial'


def test_identity_scoped_get_list_delete_and_version_guards(actor):
    ds=inputs(actor);ident=identity(actor,dataset_ids=[d['id'] for d in ds]);c=saved(actor,ds,identity_id=ident['id'])
    assert ok(actor.get('/workspace/comparisons'))['items']==[]
    assert actor.get('/workspace/comparisons/'+c['id']).status_code==403
    assert ok(actor.get('/workspace/comparisons?identity_id='+ident['id']))['items'][0]['id']==c['id']
    other=Actor(actor.client)
    assert other.get('/workspace/comparisons/'+c['id']+'?identity_id='+ident['id']).status_code==404
    for params,status in [('',403),('?identity_id='+ident['id'],428),('?identity_id='+ident['id']+'&version=2',409)]:
        assert actor.delete('/workspace/comparisons/'+c['id']+params).status_code==status
    ok(actor.delete('/workspace/comparisons/'+c['id']+'?identity_id='+ident['id']+'&version=1'))


def test_save_unknown_response_retry_is_idempotent_and_conflicting_body_rejected(actor):
    ds=inputs(actor);body=spec(ds,request_id='comparison-retry-0001');c=ok(actor.post('/workspace/comparisons',json=body),201)
    revise(actor,ds[1]);again=ok(actor.post('/workspace/comparisons',json=body),201)
    assert again['id']==c['id'] and again['payload']==c['payload'] and again['source_impact']['state']=='changed'
    assert actor.post('/workspace/comparisons',json={**body,'name':'不同的新请求内容'}).status_code==409
    assert len(ok(actor.get('/workspace/comparisons'))['items'])==1


def test_historical_common_quarter_and_asof_adopted_exactly(actor):
    ds=inputs(actor);period=ds[0]['payload']['periods'][1]['period']
    with patch('server.saved_comparisons.utc_today',return_value=date(2026,1,1)):
        c=saved(actor,ds,target_period=period,comparison='previous')
    with patch('server.studio.utc_today',return_value=date(2026,10,1)):
        p=ok(plan(actor,ds,c),201)
    assert p['payload']['snapshot']['analysis_as_of']=='2026-01-01'
    assert p['payload']['quality']['as_of']=='2026-01-01'
    assert p['payload']['snapshot']['research_scope']['period']==period
    assert p['payload']['request']['comparison']=='previous'
    r=actor.execute(dispatch(actor,p));assert r['result']['analysis']['current_period']==period
    assert r['result']['analysis']==c['payload']['result']['items'][0]['analysis']
    assert r['result']['quality']['as_of']=='2026-01-01'


def test_same_company_distinct_datasets_and_missing_metrics_stay_distinct(actor):
    a=actor.dataset();b=actor.dataset();body=editable(b)
    body['periods']=[body['periods'][-1]];body['periods'][0]['cash_flow']=None
    b=ok(actor.put('/datasets/'+b['id'],json=body));c=saved(actor,(a,b));r=run(actor,(a,b),c)
    output=r['result']['adaptive']['mathematical_outputs']['comparison'];tools=project_tools({'comparison':output})
    assert len(tools['comparison']['items'])==2
    assert tools['comparison']['items'][1]['metrics']['cash_ratio'] is None
    refs=disclosed_references(tools)
    assert 'comparison:'+b['id']+':cash_ratio' not in refs
    assert 'comparison:'+b['id']+':revenue_growth' not in refs
    assert refs['comparison:'+a['id']+':gross_margin']['dataset_id']!=refs['comparison:'+b['id']+':gross_margin']['dataset_id']
    assert disclosed_references(omit_tool_details(tools))=={}


def test_comparison_and_saved_experiment_cannot_disagree_on_period_or_date(actor):
    ds=inputs(actor);period=ds[0]['payload']['periods'][1]['period'];c=saved(actor,ds,target_period=period)
    exp=save_experiment(actor,ds[0])
    assert plan(actor,ds,c,experiment=experiment_ref(exp)).status_code==409
    with patch('server.saved_experiments.utc_today',return_value=date(2026,1,1)):
        exp=save_experiment(actor,ds[0],target_period=period)
    mismatch=plan(actor,ds,c,experiment=experiment_ref(exp))
    assert mismatch.status_code==409 and mismatch.json()['error']['code']=='COMPARISON_ASOF'
    exp=save_experiment(actor,ds[0],target_period=period)
    r=run(actor,ds,c,experiment=experiment_ref(exp))
    assert {'comparison','sensitivity'}<=r['result']['adaptive']['mathematical_outputs'].keys()


def test_tampered_comparison_recalculation_and_plan_snapshot_rejected(actor):
    ds=inputs(actor);c=saved(actor,ds);p=ok(plan(actor,ds,c),201);s=copy.deepcopy(p['payload']['snapshot'])
    s['comparison_artifact']['payload']['result']['items'][1]['analysis']['metrics']['gross_margin']=.999
    with pytest.raises(ValueError):selected_output(s,{'dataset_id':ds[0]['id'],'comparison':'year_over_year'})
    mutated=copy.deepcopy(c['payload']);mutated['result']['items'][1]['analysis']['metrics']['gross_margin']=.999
    with actor.client.app.state.store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(mutated),c['id']))
    c2=ok(actor.get('/workspace/comparisons/'+c['id']))
    bad=plan(actor,ds,c2);assert bad.status_code==409 and bad.json()['error']['code']=='COMPARISON_INTEGRITY'


@pytest.mark.parametrize('why',['peer_deleted','identity_deleted','scope_narrowed'])
def test_unavailable_comparison_discoverable_in_readonly_history(actor,why):
    ds=inputs(actor);i=identity(actor,dataset_ids=[d['id'] for d in ds]);c=saved(actor,ds,identity_id=i['id'])
    if why=='peer_deleted':ok(actor.delete('/datasets/'+ds[1]['id']+'?version=1'))
    elif why=='identity_deleted':ok(actor.delete('/services/identities/'+i['id']+'?version=1'))
    else:ok(actor.put('/services/identities/'+i['id'],json={**i['payload'],'version':1,'dataset_ids':[ds[0]['id']]}))
    h=next(r for r in ok(actor.get('/services/history'))['items'] if r['id']==c['id'])
    assert h['read_only'] and h['kind']=='comparison' and h['payload']==c['payload']
    assert h['source_impact']['state']=='unavailable'


def test_different_peer_inputs_keep_distinct_replays_without_inflating_sample_count(actor):
    ds=inputs(actor);c1=saved(actor,ds);r1=run(actor,ds,c1);assessment(actor,r1,expected_capabilities=['comparison'])
    peer=revise(actor,ds[1]);c2=saved(actor,(ds[0],peer));r2=run(actor,(ds[0],peer),c2);assessment(actor,r2,expected_capabilities=['comparison'])
    strategy=candidate(actor);report=ok(actor.post('/workspace/strategies/'+strategy['id']+'/evaluate',json={}),201)['payload']
    assert report['unique_inputs']==1 and report['raw_consented_runs']==2 and len(report['cases'])==2
    assert len({v['baseline']['comparison_hash'] for v in report['cases']})==2
    assert all(v['baseline']['comparison_hash']==v['reference_comparison_hash']==v['candidate']['comparison_hash'] for v in report['cases'])
    assert not report['eligible']


def test_actual_budget_omission_removes_comparison_reference_authority(factory):
    async def handler(provider,system,obj,count):
        tool=obj['approved_tool_results']['comparison']
        assert 'omitted_detail' in tool and 'references' not in tool and 'items' not in tool
        return {'output':{'claims':[{'text':'试图引用未披露同行数值','tool_reference_ids':['comparison:'+ds[1]['id']+':gross_margin']}],'missing':[]}}
    providers=ResearchProviders(handler=handler);a=Actor(factory(providers,max_context_chars=9000));ds=inputs(a)
    c=saved(a,ds,comparability_note='有界可比性说明与限制。'*150)
    r=run(a,ds,c,use_llm=True,provider='alpha',max_calls=1,execution={'max_revisions':0})
    assert len(providers.calls)==1
    assert r['result']['llm']['calls'][0]['tool_references']=={}
    assert r['result']['llm']['review']['claims']==[]
    assert r['result']['llm']['review']['rejected_claims']==1


def test_eight_members_bounded_and_ninth_rejected(actor):
    ds=[actor.dataset() for _ in range(8)];c=saved(actor,ds);r=run(actor,ds,c)
    output=r['result']['adaptive']['mathematical_outputs']['comparison']
    projected=project_tools({'comparison':output})['comparison']
    assert len(output['items'])==len(projected['items'])==8
    assert len(projected['references'])<=40
    assert {v['dataset_id'] for v in projected['references'].values()}=={d['id'] for d in ds}
    assert all('snapshot' not in member for member in projected['items'])
    extra=actor.dataset()
    assert actor.post('/workspace/comparisons',json=spec(ds+[extra])).status_code==422


def test_preview_then_save_across_utc_quarter_boundary_discloses_saved_date_and_freezes_replay(actor):
    from server.saved_comparisons import verified_result
    ds=inputs(actor)
    period=max(p['period'] for p in ds[0]['payload']['periods'])
    year=int(period[:4]);quarter=int(period[-1]);start=date(year,(quarter-1)*3+1,1)
    after=date(year+1,1,1) if quarter==4 else date(year,quarter*3+1,1)
    with patch('server.models.utc_today',return_value=start):
        preview=ok(actor.post('/compare',json={'dataset_ids':[d['id'] for d in ds]}))
    with patch('server.saved_comparisons.utc_today',return_value=after):
        c=saved(actor,ds)
    assert c['payload']['analysis_as_of']==after.isoformat()
    assert c['payload']['period']==preview['period']
    for old,new in zip(preview['items'],c['payload']['result']['items']):
        assert old['id']==new['id'] and old['dataset_version']==new['dataset_version']
        assert old['analysis']['metrics']==new['analysis']['metrics']
        assert any('尚未结束' in warning for warning in old['analysis']['warnings'])
        assert not any('尚未结束' in warning for warning in new['analysis']['warnings'])
    with patch('server.saved_comparisons.utc_today',return_value=date(2026,10,1)),patch('server.models.utc_today',return_value=date(2026,10,1)):
        assert verified_result(freeze(c))==c['payload']['result']
