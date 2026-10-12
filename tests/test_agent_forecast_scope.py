"""Synthetic forecast targets stay identical across approval and execution."""
from copy import deepcopy
import pytest
from server.forecast_scope import forecast_metric, forecast_topics
from server.question_scope import resolve_question
from server.autonomy import execute_local_capability
from test_saved_experiments import save, reference


def preview(actor, dataset, query, **extra):
    r=actor.post('/workspace/plans',json={'dataset_id':dataset['id'],'query':query,'execution':{},**extra})
    assert r.status_code==201,r.text
    return r.json()


def approve(actor, plan):
    return actor.post('/workspace/plans/'+plan['id']+'/execute',json={
        'version':plan['version'],'fingerprint':plan['payload']['fingerprint'],'external_consent':False})


@pytest.mark.parametrize('query,metric',[
    ('2026-Q3营业收入预测','revenue'),('2026-Q3营业成本回测','cost'),
    ('2026-Q3经营现金流预测','cash_flow'),('2026-Q3毛利率预测','gross_margin'),
    ('2026-Q3 revenue forecast','revenue'),('2026-Q3 cost forecast','cost'),
    ('2026-Q3 cash flow forecast','cash_flow'),('2026-Q3 gross margin forecast','gross_margin')])
def test_supported_target_is_the_actual_completed_metric(actor,query,metric):
    d=actor.dataset();p=preview(actor,d,query)
    assert not p['payload']['blockers']
    ex=p['payload']['request']['execution']
    assert ex['forecast_metric']==metric and ex['forecast'] and ex['horizon']==2
    assert p['payload']['snapshot']['scope_query']==query
    response=approve(actor,p);assert response.status_code==202,response.text
    run=actor.execute(response.json());assert run['state']=='succeeded',run
    result=run['result']['adaptive']['mathematical_outputs']['forecast']
    assert result['status']=='completed' and result['metric']==metric
    assert result['train_end']=='2026-Q3' and len(result['forecast'])==2
    assert run['result']['llm']['calls']==[]


@pytest.mark.parametrize('query',[
    '2026-Q3净利润预测','2026-Q3 net profit forecast',
    '2026-Q3现金收入比预测','2026-Q3 cash ratio forecast',
    '2026-Q3营业收入和营业成本预测','2026-Q3经营现金流和现金收入比预测',
    '2026-Q3预测'])
def test_unsupported_or_ambiguous_target_cannot_create_run(actor,query):
    d=actor.dataset();p=preview(actor,d,query)
    assert p['payload']['blockers'] and '预测' in p['payload']['blockers'][0]
    store=actor.client.app.state.store;before=store.db.total_changes
    r=approve(actor,p);assert r.status_code==409,r.text
    assert store.all('SELECT id FROM runs')==[] and store.db.total_changes==before


@pytest.mark.parametrize('execution',[
    {'forecast_metric':'revenue'}, {'forecast':True,'forecast_metric':'revenue'}])
def test_explicit_default_is_not_mistaken_for_an_omitted_choice(actor,execution):
    d=actor.dataset();p=preview(actor,d,'2026-Q3营业成本预测',execution=execution)
    assert p['payload']['blockers'] and p['payload']['request']['execution']['forecast_metric']=='revenue'
    assert approve(actor,p).status_code==409


def test_compatible_form_and_generic_explicit_choice_keep_horizon(actor):
    d=actor.dataset()
    for query in ('2026-Q3营业成本预测','2026-Q3经营概览','2026-Q3预测'):
        p=preview(actor,d,query,execution={'forecast':True,'forecast_metric':'cost','horizon':3})
        assert not p['payload']['blockers']
        assert p['payload']['request']['execution']['horizon']==3
        assert p['payload']['request']['execution']['forecast_metric']=='cost'


@pytest.mark.parametrize('query',['2026-Q3 EBITDA forecast','2026-Q3不要毛利率，只看净利润预测',
    '2026-Q3现金余额预测','2026-Q3和2026-Q2营业成本预测',
    '2026-Q3经营概览：EBITDA forecast','2026-Q3经营EBITDA预测',
    '2026-Q3 overview EBITDA forecast','2026-Q3任务 EBITDA forecast',
    '2026-Q3复核选中的数学实验：EBITDA forecast'])
def test_explicit_form_does_not_reclassify_unknown_or_ambiguous_target_as_generic(actor,query):
    d=actor.dataset();p=preview(actor,d,query,execution={'forecast':True,'forecast_metric':'cost'})
    assert p['payload']['blockers'] and approve(actor,p).status_code==409


@pytest.mark.parametrize('query',['2026-Q3净利润分析','2026-Q3经营现金流分析'])
def test_ordinary_analysis_does_not_request_or_block_forecast(actor,query):
    d=actor.dataset();p=preview(actor,d,query)
    assert not p['payload']['blockers']
    assert not p['payload']['request']['execution']['forecast']
    assert not any(n['capability']=='forecast' for n in p['payload']['adaptive']['nodes'])
    r=approve(actor,p);assert r.status_code==202,r.text


def test_saved_forecast_conflict_and_generic_explicit_selection(actor):
    d=actor.dataset();e=save(actor,d,kind='forecast',metric='cost',horizon=3)
    bad=preview(actor,d,'2026-Q3经营现金流预测',experiment=reference(e))
    assert bad['payload']['blockers'] and approve(actor,bad).status_code==409
    for query in ('2026-Q3营业成本预测','2026-Q3经营概览'):
        good=preview(actor,d,query,experiment=reference(e))
        assert not good['payload']['blockers']
        r=approve(actor,good);assert r.status_code==202,r.text
        run=actor.execute(r.json());out=run['result']['adaptive']['mathematical_outputs']['forecast']
        assert out['metric']=='cost' and out['experiment']['id']==e['id']
        assert out['forecast']==e['payload']['result']['forecast']


@pytest.mark.parametrize('query,metric',[
    ('2026-Q3净利润分析','revenue'),('2026-Q3经营现金流分析','revenue'),
    ('2026-Q3营业成本分析','revenue'),('2026-Q3营业收入和成本分析','revenue')])
@pytest.mark.parametrize('saved',[False,True])
def test_dynamic_forecast_uses_same_guard_before_saved_early_return(actor,monkeypatch,query,metric,saved):
    d=actor.dataset();snapshot={'dataset':d['payload'],'scope_query':query}
    if saved:snapshot['experiment']={'deliberately':'not inspected before metric guard'}
    calls=[]
    monkeypatch.setattr('server.saved_experiments.selected_output',lambda *args:calls.append(args))
    monkeypatch.setattr('server.analytics.forecast_baselines',lambda *args,**kwargs:calls.append(args))
    before=deepcopy(snapshot)
    result=execute_local_capability('forecast',snapshot,{'query':query},
        {'forecast':False,'forecast_metric':metric,'horizon':2},{})
    assert result['status']=='blocked' and '预测' in result['reason']
    assert calls==[] and snapshot==before


def test_cash_companion_and_direct_copilot_share_single_metric_contract(actor):
    from server.copilot import _forecast_topics,_forecast_with_scope
    d=actor.dataset()['payload'];query='2026-Q3经营现金流预测';scope=resolve_question(query,d,[])
    assert set(scope['topics'])=={'cash_flow','cash_ratio'}
    assert _forecast_topics(scope,query)==forecast_topics(scope,query)==['cash_flow']
    assert forecast_metric(scope,query)=='cash_flow'
    assert _forecast_with_scope(d,_forecast_topics(scope,query))['metric']=='cash_flow'


def test_bound_current_target_does_not_forecast_from_appended_history(actor):
    from server.studio import build_plan
    from server.contracts import PlanDraft
    # The caller stores history in query but the proposal binds its current text.
    d=actor.dataset();app=actor.client.app;store=app.state.store
    user=store.one('SELECT * FROM users WHERE id=?',(actor.user['id'],))
    body=PlanDraft(dataset_id=d['id'],query='2026-Q3净利润分析\n历史：营业收入预测',execution={})
    p=build_plan(store,user,body,app.state.settings,app.state.worker.providers,scope_query='2026-Q3净利润分析')
    assert not p['payload']['blockers']
    assert not any(n['capability']=='forecast' for n in p['payload']['adaptive']['nodes'])
    from server.evolution import replay
    r=approve(actor,p);assert r.status_code==202,r.text
    run=actor.execute(r.json());original=deepcopy(run)
    result=replay(run,['quant'],None)
    assert result['covered']==['quant'] and result['external_calls']==0
    assert 'forecast' not in result['planned_capabilities']
    assert 'forecast' not in result['computations'] and run==original
