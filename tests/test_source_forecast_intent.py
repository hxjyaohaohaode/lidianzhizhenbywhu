"""Real source-message handoffs keep user forecast targets distinct from titles."""
from copy import deepcopy
import pytest
from test_services import thread,message,proposal,confirm,ok
from test_saved_experiments import save,reference,long_dataset
from server.store import digest
from server.studio import plan_fingerprint_valid
from server.evolution import replay
from server.autonomy import execute_local_capability,compile_graph
from server.forecast_scope import frozen_forecast_scope


def sourced(actor,query,*,execution=None,dataset=None,experiment=None,edited=None):
    d=dataset or actor.dataset();t=thread(actor,d)
    m=ok(message(actor,t,text=query),201)['message']
    extra={'execution':execution or {}}
    if experiment:extra['experiment']=reference(experiment)
    p=ok(proposal(actor,t,text=query if edited is None else edited,source_message_id=m['id'],**extra),201)
    plan=ok(actor.get('/workspace/plans/'+p['payload']['plan_id']))
    return d,m,p,plan


@pytest.mark.parametrize('query',['2026-Q3经营现金流预测','2026-Q3 cash flow forecast'])
def test_implicit_cash_companion_source_forecasts_cash_flow_and_replays(actor,query):
    d,m,p,plan=sourced(actor,query)
    assert '现金收入比' in plan['payload']['scope_query']
    assert not plan['payload']['blockers']
    intent=plan['payload']['snapshot']['forecast_intent']
    assert intent=={'schema_version':1,'query':query,'message_id':m['id'],'message_hash':digest(m['payload'])}
    assert intent['message_hash']==p['payload']['provenance']['message_hash']
    assert plan_fingerprint_valid(plan['payload'])
    changed=deepcopy(plan['payload']);changed['snapshot']['forecast_intent']['query']='营业收入预测'
    assert not plan_fingerprint_valid(changed)
    approved=ok(confirm(actor,p));run=actor.execute(ok(actor.get('/runs/'+approved['payload']['result']['run_id'])))
    out=run['result']['adaptive']['mathematical_outputs']['forecast']
    assert out['metric']=='cash_flow' and out['status']=='completed' and out['train_end']=='2026-Q3'
    original=deepcopy(run);result=replay(run,['forecast'],None)
    assert result['covered']==['forecast'] and result['computations']['forecast']['output_hash']==digest(out)
    assert result['external_calls']==0 and run==original and run['result']['llm']['calls']==[]


@pytest.mark.parametrize('saved',[False,True])
def test_generic_source_default_topics_do_not_override_explicit_single_choice(actor,saved):
    d=actor.dataset();e=save(actor,d,kind='forecast',metric='cost',horizon=3) if saved else None
    d,m,p,plan=sourced(actor,'2026-Q3经营概览',dataset=d,experiment=e,
        execution={} if saved else {'forecast':True,'forecast_metric':'cost','horizon':3})
    assert '毛利' in plan['payload']['scope_query'] and not plan['payload']['blockers']
    approved=ok(confirm(actor,p));run=actor.execute(ok(actor.get('/runs/'+approved['payload']['result']['run_id'])))
    out=run['result']['adaptive']['mathematical_outputs']['forecast']
    assert out['metric']=='cost' and len(out['forecast'])==3 and run['result']['llm']['calls']==[]


@pytest.mark.parametrize('query',['2026-Q3经营现金收入比预测','2026-Q3经营现金流和现金收入比预测',
    '2026-Q3营业收入与营业成本预测','2026-Q3净利润预测'])
def test_original_explicit_ratio_multiple_or_unsupported_targets_remain_refused(actor,query):
    d,m,p,plan=sourced(actor,query)
    assert plan['payload']['blockers'] and confirm(actor,p).status_code==409
    assert actor.client.app.state.store.all('SELECT id FROM runs')==[]


def test_edited_target_uses_its_own_intent_not_the_source_question(actor):
    d,m,p,plan=sourced(actor,'2026-Q3经营现金流预测',edited='2026-Q3营业成本预测')
    assert 'forecast_intent' not in plan['payload']['snapshot']
    assert not plan['payload']['blockers'] and plan['payload']['request']['execution']['forecast_metric']=='cost'


def test_inherited_source_quarter_stays_frozen_when_original_text_has_no_quarter(actor):
    d=long_dataset(actor);t=thread(actor,d)
    first=ok(message(actor,t,text='2026-Q2经营现金流',key='first-quarter'),201)
    m=ok(message(actor,t,text='继续看现金流预测',version=2,key='forecast-followup'),201)['message']
    assert m['payload']['response']['context']['question_scope']['period']=='2026-Q2'
    p=ok(proposal(actor,t,text='继续看现金流预测',source_message_id=m['id']),201)
    plan=ok(actor.get('/workspace/plans/'+p['payload']['plan_id']))
    assert not plan['payload']['blockers'] and plan['payload']['snapshot']['research_scope']['period']=='2026-Q2'
    text,scope=frozen_forecast_scope(plan['payload']['snapshot'],plan['payload']['request'])
    assert text=='继续看现金流预测' and scope['period']=='2026-Q2'
    approved=ok(confirm(actor,p));run=actor.execute(ok(actor.get('/runs/'+approved['payload']['result']['run_id'])))
    assert run['result']['adaptive']['mathematical_outputs']['forecast']['train_end']=='2026-Q2'
    before=deepcopy(run);assert replay(run,['forecast'],None)['covered']==['forecast'];assert run==before


@pytest.mark.parametrize('bad',[None,{}, {'schema_version':True,'query':'营业收入预测','message_id':'x','message_hash':'0'*64},
    {'schema_version':2,'query':'营业收入预测','message_id':'x','message_hash':'0'*64},
    {'schema_version':1,'query':'','message_id':'x','message_hash':'0'*64},
    {'schema_version':1,'query':'x'*3001,'message_id':'x','message_hash':'0'*64}])
def test_damaged_present_intent_never_falls_back_to_header_or_calls_math(actor,monkeypatch,bad):
    d,m,p,plan=sourced(actor,'2026-Q3经营现金流预测');s=deepcopy(plan['payload']['snapshot']);s['forecast_intent']=bad
    calls=[];monkeypatch.setattr('server.analytics.forecast_baselines',lambda *a,**k:calls.append(a))
    result=execute_local_capability('forecast',s,plan['payload']['request'],plan['payload']['request']['execution'],{})
    assert result['status']=='blocked' and calls==[]
    with pytest.raises(ValueError):compile_graph({'snapshot':s,'request':plan['payload']['request']})


def test_original_explicit_period_conflict_fails_closed_without_rewriting(actor):
    d,m,p,plan=sourced(actor,'2026-Q3经营现金流预测');s=deepcopy(plan['payload']['snapshot']);s['research_scope']['period']='2026-Q2';before=deepcopy(s)
    with pytest.raises(ValueError,match='季度'):frozen_forecast_scope(s,plan['payload']['request'])
    assert s==before


def test_clients_cannot_inject_intent_or_strip_a_manually_written_title(actor):
    d=actor.dataset();query='核查范围：2026-Q3，经营现金收入比。当前目标：经营现金流预测'
    r=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':query,'execution':{},'forecast_intent':{'query':'现金流预测'}})
    assert r.status_code==422
    t=thread(actor,d);r=proposal(actor,t,text=query,forecast_intent={'query':'现金流预测'})
    assert r.status_code==422
    p=ok(proposal(actor,t,text=query),201);plan=ok(actor.get('/workspace/plans/'+p['payload']['plan_id']))
    assert 'forecast_intent' not in plan['payload']['snapshot'] and plan['payload']['blockers']
