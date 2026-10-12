"""Analysis topics and an approved single forecast choice have distinct types."""
from copy import deepcopy
import pytest
from test_agent_forecast_scope import preview,approve
from test_saved_experiments import save,reference
from server.autonomy import execute_local_capability
from server.evolution import replay
from server.studio import plan_fingerprint_valid
from server.store import digest


@pytest.mark.parametrize('metric',['revenue','cost','cash_flow','gross_margin'])
@pytest.mark.parametrize('query',['2026-Q3净利润分析','2026-Q3营业收入与现金流及毛利率核查'])
@pytest.mark.parametrize('saved',[False,True])
def test_single_chosen_model_is_independent_of_ordinary_analysis(actor,metric,query,saved):
    d=actor.dataset();e=save(actor,d,kind='forecast',metric=metric,horizon=3) if saved else None
    extra={'experiment':reference(e)} if saved else {'execution':{'forecast':True,'forecast_metric':metric,'horizon':3}}
    p=preview(actor,d,query,**extra);assert not p['payload']['blockers']
    s=p['payload']['snapshot']
    if not saved:
        assert s['forecast_selection']=={'schema_version':1,'source':'explicit_form','metric':metric,'horizon':3}
        changed=deepcopy(p['payload']);changed['snapshot']['forecast_selection']['metric']='invalid'
        assert plan_fingerprint_valid(p['payload']) and not plan_fingerprint_valid(changed)
    r=approve(actor,p);assert r.status_code==202,r.text
    run=actor.execute(r.json());assert run['state']=='succeeded'
    out=run['result']['adaptive']['mathematical_outputs']['forecast']
    assert out['status']=='completed' and out['metric']==metric and len(out['forecast'])==3
    if e:assert out['experiment']['hash']==e['experiment_hash'] and out['forecast']==e['payload']['result']['forecast']
    old=deepcopy(run);result=replay(run,['forecast'],None)
    assert result['covered']==['forecast'] and result['computations']['forecast']['output_hash']==digest(out)
    assert run==old and result['external_calls']==0 and run['result']['llm']['calls']==[]


@pytest.mark.parametrize('query',['2026-Q2营业收入与现金流核查','2026-Q3经营概览','2026-Q3营业成本分析'])
def test_switch_only_keeps_research_and_explicitly_blocks_optional_forecast(actor,query):
    d=actor.dataset();p=preview(actor,d,query,execution={'forecast':True})
    assert not p['payload']['blockers'] and 'forecast_selection' not in p['payload']['snapshot']
    assert '预测不可用' in p['payload']['snapshot']['research_scope']['forecast_unavailable']
    r=approve(actor,p);assert r.status_code==202,r.text
    run=actor.execute(r.json());assert run['state']=='degraded' and run['result']['analysis']
    out=run['result']['adaptive']['mathematical_outputs']['forecast']
    assert out['status']=='blocked' and '未明确选择' in out['reason'] and 'metric' not in out and 'forecast' not in out
    old=deepcopy(run);replayed=replay(run,['forecast'],None)
    assert replayed['external_calls']==0 and run==old


@pytest.mark.parametrize('query',['2026-Q3经营概览','2026-Q3营业收入与毛利率分析'])
def test_old_unbound_dynamic_defaults_never_authorize_a_forecast(actor,monkeypatch,query):
    d=actor.dataset();p=preview(actor,d,query);s=deepcopy(p['payload']['snapshot'])
    ex=p['payload']['request']['execution'];ex['forecast']=True
    from server.analytics import forecast_baselines
    calls=[]
    def capture(*args,**kwargs):
        calls.append(args)
        return forecast_baselines(*args,**kwargs)
    monkeypatch.setattr('server.analytics.forecast_baselines',capture)
    out=execute_local_capability('forecast',s,p['payload']['request'],ex,{})
    assert out['status']=='blocked' and '未明确选择' in out['reason'] and not calls,(out,len(calls))


@pytest.mark.parametrize('change',[None,{}, {'schema_version':True,'source':'explicit_form','metric':'cost','horizon':3},
    {'schema_version':2,'source':'explicit_form','metric':'cost','horizon':3},
    {'schema_version':1,'source':'untrusted','metric':'cost','horizon':3},
    {'schema_version':1,'source':'explicit_form','metric':[],'horizon':3},
    {'schema_version':1,'source':'explicit_form','metric':'cost','horizon':True},
    {'schema_version':1,'source':'explicit_form','metric':'revenue','horizon':3},
    {'schema_version':1,'source':'explicit_form','metric':'cost','horizon':2}])
def test_damaged_or_mismatched_choice_never_falls_back(actor,monkeypatch,change):
    d=actor.dataset();p=preview(actor,d,'2026-Q3净利润分析',execution={'forecast':True,'forecast_metric':'cost','horizon':3})
    s=deepcopy(p['payload']['snapshot']);s['forecast_selection']=change;before=deepcopy(s)
    calls=[];monkeypatch.setattr('server.analytics.forecast_baselines',lambda *a,**kw:calls.append(a))
    out=execute_local_capability('forecast',s,p['payload']['request'],p['payload']['request']['execution'],{})
    assert out['status']=='blocked' and not calls and s==before


@pytest.mark.parametrize('query,metric',[
    ('收入预测与现金回流的反向证据核查','revenue'),
    ('2026-Q3现金流预测与现金收入比分析','cash_flow'),
    ('2026-Q3毛利率分析与营业成本预测','cost'),
    ('2026-Q3现金流核查及营业成本预测','cost'),
    ('2026-Q3营业成本预测和毛利率分析','cost'),
    ('2026-Q3 revenue forecast and cash flow analysis','revenue')])
def test_explicit_single_forecast_and_separate_analysis_clause(actor,query,metric):
    d=actor.dataset();p=preview(actor,d,query,execution={'forecast':True})
    assert not p['payload']['blockers']
    r=approve(actor,p);assert r.status_code==202,r.text
    run=actor.execute(r.json());out=run['result']['adaptive']['mathematical_outputs']['forecast']
    assert out['status']=='completed' and out['metric']==metric and run['result']['analysis']


@pytest.mark.parametrize('query',[
    '2026-Q3营业收入和营业成本预测','2026-Q3收入预测与现金流预测','2026-Q3收入预测与成本',
    '2026-Q3收入预测与净利润预测的分析','2026-Q3营业成本预测的证据核查与收入预测',
    '2026-Q3收入预测和现金流预测的反向证据核查','2026-Q3 EBITDA forecast and cash flow analysis',
    '2026-Q3现金流分析与 EBITDA forecast',
    '2026-Q3经营现金收入比预测与收入分析','2026-Q3现金余额预测与营业收入分析',
    '2026-Q3净利润预测与毛利率分析'])
def test_conjunction_does_not_hide_another_or_unsupported_forecast(actor,query):
    d=actor.dataset();p=preview(actor,d,query,execution={'forecast':True,'forecast_metric':'revenue'})
    assert p['payload']['blockers'] and approve(actor,p).status_code==409
    assert actor.client.app.state.store.all('SELECT id FROM runs')==[]


def test_explicit_form_conflict_and_client_choice_injection_stay_rejected(actor):
    d=actor.dataset();p=preview(actor,d,'2026-Q3营业成本预测与毛利率分析',execution={'forecast':True,'forecast_metric':'cash_flow'})
    assert p['payload']['blockers'] and approve(actor,p).status_code==409
    r=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'经营概览','forecast_selection':{'metric':'cost'}})
    assert r.status_code==422


@pytest.mark.parametrize('query,allowed',[
    ('2026-Q3营业收入预测与现金流核查',True),
    ('2026-Q3现金流分析及营业收入预测',True),
    ('2026-Q3收入预测与现金流预测的证据核查',False),
    ('2026-Q3收入预测与营业成本',False)])
def test_real_source_intent_preserves_full_question_and_forecast_boundary(actor,query,allowed):
    from test_source_forecast_intent import sourced
    from test_services import confirm,ok
    d,m,p,plan=sourced(actor,query)
    if not allowed:
        assert plan['payload']['blockers'] and confirm(actor,p).status_code==409
        return
    assert plan['payload']['snapshot']['forecast_intent']['query']==query
    assert plan['payload']['snapshot']['forecast_intent']['message_hash']==digest(m['payload'])
    approved=ok(confirm(actor,p));run=actor.execute(ok(actor.get('/runs/'+approved['payload']['result']['run_id'])))
    out=run['result']['adaptive']['mathematical_outputs']['forecast']
    assert out['metric']=='revenue' and out['status']=='completed'
    assert replay(run,['forecast'],None)['computations']['forecast']['output_hash']==digest(out)


@pytest.mark.parametrize('query',[
    '2026-Q3营业收入和EBITDA预测','2026-Q3 EBITDA和营业收入预测',
    '2026-Q3营业收入及陌生指标预测','2026-Q3未知指标以及营业收入预测',
    '2026-Q3营业收入、未知指标预测','2026-Q3 revenue and mystery forecast',
    '2026-Q3 mystery or revenue forecast','2026-Q3收入预测与EBITDA预测的证据核查',
    '2026-Q3 EBITDA预测的证据核查和收入预测',
    '2026-Q3营业收入和EBITDA预测与现金流分析',
    '2026-Q3现金流分析与 EBITDA and revenue forecast',
    '2026-Q3 revenue forecast and mystery forecast evidence analysis'])
def test_unrecognized_forecast_conjunct_cannot_disappear_from_known_topics(actor,query):
    d=actor.dataset();p=preview(actor,d,query,execution={'forecast':True,'forecast_metric':'revenue'})
    assert p['payload']['blockers'] and approve(actor,p).status_code==409
    assert actor.client.app.state.store.all('SELECT id FROM runs')==[]


@pytest.mark.parametrize('query',['2026-Q3营业收入和EBITDA预测','2026-Q3收入预测与EBITDA预测的证据核查'])
def test_direct_assistant_reports_unknown_conjunct_without_exception_or_math(actor,monkeypatch,query):
    from test_services import thread,message,ok
    d=actor.dataset();t=thread(actor,d);calls=[]
    monkeypatch.setattr('server.copilot.forecast_baselines',lambda *a,**k:calls.append(a))
    result=ok(message(actor,t,text=query),201)['message']['payload']['response']
    forecast=next(c['data'] for c in result['cards'] if c['kind']=='forecast')
    assert forecast['status']=='blocked' and '未识别' in forecast['reason'] and not calls
    receipt=next(x for x in result['receipts'] if x['tool']=='forecast_baselines')
    assert receipt['state']=='blocked' and receipt['input']['metric'] is None and result['external_calls']==0


@pytest.mark.parametrize('query',['2024-Q4总资产','2024-Q4总负债','2024-Q4总资产与总负债',
    '2024-Q4总资产与营业收入核查'])
def test_stock_only_capability_requires_an_independent_model_choice(actor,query):
    from test_direct_balance_fields import imported
    d,_=imported(actor);p=preview(actor,d,query,execution={'forecast':True})
    assert p['payload']['blockers'] and p['payload']['snapshot']['research_scope']['status']=='blocked'
    before=actor.client.app.state.store.db.total_changes
    assert approve(actor,p).status_code==409
    assert actor.client.app.state.store.db.total_changes==before
    plain=preview(actor,d,query);assert not plain['payload']['blockers']
    assert not any(n['capability']=='forecast' for n in plain['payload']['adaptive']['nodes'])


@pytest.mark.parametrize('query',['2024-Q4总资产分析','2024-Q4总负债分析','2024-Q4总资产与总负债核查'])
@pytest.mark.parametrize('saved',[False,True])
def test_independent_supported_model_remains_separate_from_stock_reading(actor,query,saved):
    from test_saved_experiments import long_dataset
    d=long_dataset(actor)
    e=save(actor,d,kind='forecast',metric='cost',target_period='2024-Q4') if saved else None
    extra={'experiment':reference(e)} if saved else {'execution':{'forecast':True,'forecast_metric':'cost'}}
    p=preview(actor,d,query,**extra);assert not p['payload']['blockers']
    run=actor.execute(approve(actor,p).json());out=run['result']['adaptive']['mathematical_outputs']['forecast']
    assert out['status']=='completed' and out['metric']=='cost' and out['train_end']=='2024-Q4'
    assert replay(run,['forecast'],None)['computations']['forecast']['output_hash']==digest(out)


@pytest.mark.parametrize('query',['2024-Q4总资产','2024-Q4总负债','2024-Q4总资产与营业收入核查'])
def test_dynamic_stock_forecast_uses_same_capability_refusal(actor,monkeypatch,query):
    from test_direct_balance_fields import imported
    d,_=imported(actor);p=preview(actor,d,query);s=deepcopy(p['payload']['snapshot'])
    ex={**p['payload']['request']['execution'],'forecast':True};before=deepcopy(s);calls=[]
    monkeypatch.setattr('server.analytics.forecast_baselines',lambda *a,**kw:calls.append(a))
    out=execute_local_capability('forecast',s,p['payload']['request'],ex,{})
    assert out['status']=='blocked' and '期末金额' in out['reason'] and not calls and s==before


from test_percentage_execution_scope import captured_actor,objects


@pytest.mark.parametrize('captured_actor',['stock-forecast-scope-r8.json'],indirect=True)
@pytest.mark.parametrize('state',['draft','queued','paused','completed'])
def test_genuine_old_stock_plan_cannot_gain_execution_and_history_is_unchanged(captured_actor,state):
    from test_legacy_execution_scope import frozen,approve as approve_old
    from server.execution_scope import plan_scope_issue
    import hashlib
    a=captured_actor;store,case,p,run=objects(a,state);before=frozen(store,case)
    assert plan_scope_issue(store,p)['reason']=='forecast_metric_mismatch'
    if state=='draft':
        changes=store.db.total_changes;r=approve_old(a,case,p)
        assert r.status_code==409 and r.json()['error']['code']=='PLAN_SCOPE_REPREVIEW'
        assert store.db.total_changes==changes
    elif state=='queued':
        done=a.execute(run);assert done['state']=='interrupted' and done['result'] is None
        assert [e['type'] for e in store.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq',(run['id'],))]==['queued','running','scope_repreview_required']
    elif state=='paused':
        control=store.one('SELECT * FROM adaptive_controls WHERE run_id=?',(run['id'],));changes=store.db.total_changes
        r=a.post('/workspace/runs/'+run['id']+'/control',json={'version':control['version'],'action':'resume'})
        assert r.status_code==409 and r.json()['error']['code']=='PLAN_SCOPE_REPREVIEW'
        assert store.db.total_changes==changes
    else:
        assert a.get('/runs/'+run['id']).json()['result']==run['result']
        for fmt,sha in case['export_sha256'].items():
            assert hashlib.sha256(a.get('/runs/'+run['id']+'/export?format='+fmt).content).hexdigest()==sha
        replayed=replay(run,['forecast'],None)
        assert replayed['external_calls']==0
    assert frozen(store,case)==before
