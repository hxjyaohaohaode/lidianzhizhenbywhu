"""Question grounding uses isolated fixtures, never seeded runtime business records."""
import pytest
from test_services import thread, message, ok
from test_adaptive import completed, preview
from server.question_scope import resolve_question
from server.store import digest
from server.evolution import replay


@pytest.mark.parametrize('query,status',[('市场占有率是多少','unsupported_topic'),('2025年营业收入','needs_clarification'),
 ('2024-Q1营业收入','period_unavailable'),('2025-Q2和2025-Q3营业收入比较','needs_clarification'),('查看跟进行动','workspace_query')])
def test_unmatched_or_ambiguous_questions_do_not_substitute_latest_metrics(actor,query,status):
    d=actor.dataset()
    result=actor.post('/workspace/assistant',json={'query':query,'dataset_id':d['id']}).json()
    assert result['question_scope']['status']==status and result['facts']==[]
    response=ok(message(actor,thread(actor,d),text=query),201)['message']['payload']['response']
    assert response['context']['question_scope']['status']==status and response['facts']==[]
    assert response['answer']==response['context']['question_scope']['notice']
    assert response['external_calls']==0


def test_historical_cash_amount_and_scope_match_in_both_assistants(actor):
    d=actor.dataset();source=d['payload']['periods'][0];query=source['period']+'经营现金流是多少'
    legacy=actor.post('/workspace/assistant',json={'query':query,'dataset_id':d['id']}).json()
    service=ok(message(actor,thread(actor,d),text=query),201)['message']['payload']['response']
    for result in [legacy,service]:
        facts={f['id']:f for f in result['facts']}
        assert facts['cash_flow']['value']==source['cash_flow']
        assert facts['cash_flow']['period']==source['period']
        assert facts['cash_flow']['input_hash']==d['content_hash']
        assert facts['cash_flow']['inputs'][0]['path']==f"periods/{source['period']}/cash_flow"
        assert all(f['period']==source['period'] for f in result['facts'])
        assert all(point['period']<=source['period'] for f in result['facts'] for point in f['trend'])


def test_plain_cost_and_net_margin_are_not_misrouted(example):
    assert resolve_question('operating cost',example,[])['topics']==['cost']
    assert resolve_question('net margin',example,[])['topics']==['net_margin']
    assert resolve_question('discarded records',example,[])['topics']==[]
    assert resolve_question('2025年第二季度收入',example,[])['period']=='2025-Q2'


def test_historical_question_handoff_uses_same_period_in_approved_tools_and_replay(actor):
    d=actor.dataset();period=d['payload']['periods'][1]['period']
    run=completed(actor,dataset=d,query=period+'营业收入与现金流核查',execution={'depth':'deep','forecast':True,'scenario':{
        'price_change':.1,'cost_change':0.,'volume_change':0.,'fixed_cost_share':0.,'note':'隔离测试历史季度情景假设'}})
    result=run['result']
    assert run['snapshot']['dataset']==d['payload']
    assert run['snapshot']['dataset_hash']==digest(d['payload'])
    assert result['analysis']['current_period']==period
    assert result['adaptive']['mathematical_outputs']['sensitivity']['period']==period
    assert result['quality']['input_hash']==result['analysis']['input_hash']
    assert result['analysis']['input_hash']!=run['snapshot']['dataset_hash']
    assert result['adaptive']['mathematical_outputs']['forecast']['status']=='blocked'
    assert replay(run,['quality','quant'],None)['math_hash']==digest(result['analysis'])
    audit=actor.get('/workspace/runs/'+run['id']+'/audit').json()
    assert audit['data_hash_valid'] and audit['report_hash_valid']
    assert actor.get('/runs/'+run['id']).json()['result']==result


@pytest.mark.parametrize('query',['请检查2025年营业收入','请比较2025-Q2和2025-Q3收入','请核查2024-Q1的收入'])
def test_ambiguous_plan_periods_cannot_be_dispatched(actor,query):
    plan=preview(actor,query=query)
    assert plan['payload']['blockers']
    response=actor.post('/workspace/plans/'+plan['id']+'/execute',json={'version':plan['version'],'fingerprint':plan['payload']['fingerprint'],'external_consent':False})
    assert response.status_code==409 and response.json()['error']['code']=='PLAN_BLOCKED'


@pytest.mark.parametrize('query',['2024年10月收入','2024年1月收入','2024-Q10收入','2023年与2024Q1收入比较',
                                  '2024年1月与2024Q1收入','2024-Q0收入','2024-Q5收入'])
def test_months_malformed_quarters_and_extra_years_cannot_select_a_quarter(example,query):
    from server.question_scope import plan_scope
    assert resolve_question(query,example,[])['status']=='needs_clarification'
    assert plan_scope(query,example)['status']=='blocked'



def test_evolution_deduplicates_effective_historical_financial_input(example):
    import copy
    from server.question_scope import plan_scope, analysis_dataset
    from server.evolution import input_signature, grouped_cases
    data=copy.deepcopy(example)
    scope=plan_scope(data['periods'][0]['period']+'收入核查',data)
    first={'snapshot':{'dataset':data,'research_scope':scope}}
    second=copy.deepcopy(first);second['snapshot']['dataset']['periods'][-1]['revenue']+=1234
    third=copy.deepcopy(first);third['snapshot']['dataset']['periods'][-1]['revenue']+=5678
    assert analysis_dataset(first['snapshot'])==analysis_dataset(second['snapshot'])
    assert input_signature(first)==input_signature(second)==input_signature(third)
    records=[({'id':str(i),'updated_at':str(i)},run) for i,run in enumerate([first,second,third])]
    assert len(grouped_cases(records))==1
    second['snapshot']['dataset']['periods'][0]['revenue']+=1
    assert input_signature(first)!=input_signature(second)
    legacy={'snapshot':{'dataset':data}}
    changed=copy.deepcopy(legacy);changed['snapshot']['dataset']['periods'][-1]['revenue']+=1
    assert input_signature(legacy)!=input_signature(changed)



def test_handoff_preserves_query_comparison_without_overriding_explicit_selection(actor):
    plan=preview(actor,query='2025-Q3收入环比核查')
    assert plan['payload']['request']['comparison']=='previous'
    run=actor.execute(__import__('test_adaptive').dispatch(actor,plan))
    assert run['result']['analysis']['baseline_period']=='2025-Q2'
    mismatch=preview(actor,query='2025-Q3收入环比核查',comparison='year_over_year')
    assert mismatch['payload']['request']['comparison']=='year_over_year'
    assert mismatch['payload']['blockers']
    correct=preview(actor,query='2025-Q3收入环比核查',comparison='previous')
    assert not correct['payload']['blockers']


def test_prior_question_dates_do_not_override_current_proposal_scope(actor):
    from test_services import proposal
    d=actor.dataset();t=thread(actor,d)
    ok(message(actor,t,text='2025-Q2营业收入核查'),201)
    current=ok(message(actor,t,text='2025-Q3收入环比核查',version=2,key='quarter-next'),201)['message']
    p=ok(proposal(actor,t,'research',text='2025-Q3收入环比核查',include_thread_history=True,source_message_id=current['id']),201)
    plan=actor.get('/workspace/plans/'+p['payload']['plan_id']).json()
    assert '2025-Q2' in plan['payload']['request']['query']
    assert plan['payload']['snapshot']['research_scope']['period']=='2025-Q3'
    assert plan['payload']['request']['comparison']=='previous'
    assert not plan['payload']['blockers']


@pytest.mark.parametrize('query',['2025Q2和Q3收入比较','2025Q2-Q3收入','2025年第二季度和第三季度收入比较',
                                  'Q2收入','2025Q2的5月收入','去年收入','2025-Q2.5收入','今年上半年收入'])
def test_partial_or_nonquarter_temporal_requests_fail_closed(example,query):
    from server.question_scope import plan_scope
    assert resolve_question(query,example,[])['status']=='needs_clarification'
    assert plan_scope(query,example)['status']=='blocked'


def test_previous_year_same_quarter_is_still_a_supported_baseline(example):
    assert resolve_question('2025Q2收入与去年同季比较',example,[])['status']=='supported'


@pytest.mark.parametrize('query,topics',[
    ('2025-Q3净利润同比',['net_profit']),
    ('2025-Q3毛利率同比',['gross_margin']),
    ('净利润增长',['net_profit']),
    ('gross margin growth',['gross_margin']),
    ('净利润增长与营业收入',['revenue','net_profit']),
    ('营业收入同比',['revenue_growth','revenue']),
    ('收入的同比增长率',['revenue_growth','revenue']),
    ('revenue growth',['revenue_growth','revenue']),
    ('growth in revenue',['revenue_growth','revenue']),
    ('2025-Q3资产周转',['asset_turnover']),
    ('2025-Q3总资产周转',['asset_turnover']),
    ('2025-Q3存货周转',['inventory_turnover']),
    ('库存周转与资产周转',['inventory_turnover','asset_turnover']),
])
def test_metric_subject_is_not_inferred_from_comparison_or_generic_turnover(example,query,topics):
    scope=resolve_question(query,example,[])
    assert scope['topics']==topics and scope['can_calculate']


@pytest.mark.parametrize('query',[
    '2025-Q3应收账款周转','应收账款周转同比','周转率是多少',
    '应收账款周转和营业收入','应收账款周转与库存周转',
    'receivables turnover and revenue',
    '固定资产周转','流动资产周转','库存周转天数',
    '固定资产周转与总资产周转','营业收入与库存周转天数',
    'fixed asset turnover','current asset turnover','inventory turnover days',
])
def test_unimplemented_turnover_is_not_answered_with_another_metric(example,query):
    scope=resolve_question(query,example,[])
    assert scope['status']=='unsupported_topic' and not scope['can_calculate']
    assert scope['topics']==[]


@pytest.mark.parametrize('query,expected',[
    ('2025-Q3净利润同比',['net_profit']),
    ('2025-Q3毛利率同比',['gross_margin']),
    ('2025-Q3收入同比',['revenue_growth','revenue']),
    ('2025-Q3应收账款周转',[]),
    ('2025-Q3应收账款周转和营业收入',[]),
    ('2025-Q3库存周转',['inventory_turnover']),
    ('2025-Q3固定资产周转',[]),
    ('2025-Q3流动资产周转',[]),
    ('2025-Q3库存周转天数',[]),
])
def test_both_assistants_only_answer_requested_supported_metrics(actor,query,expected):
    d=actor.dataset()
    legacy=actor.post('/workspace/assistant',json={'query':query,'dataset_id':d['id']}).json()
    service=ok(message(actor,thread(actor,d),text=query),201)['message']['payload']['response']
    for result in [legacy,service]:
        assert [fact['id'] for fact in result['facts']]==expected
    assert service['external_calls']==0
    if not expected:
        assert service['context']['question_scope']['status']=='unsupported_topic'
        assert '不支持' in service['answer']


@pytest.mark.parametrize('query,expected',[
    ('继续看净利润同比',['net_profit']),
    ('继续看毛利率同比',['gross_margin']),
    ('那同比呢',['net_profit']),
    ('继续看应收账款周转',[]),
])
def test_followup_does_not_reintroduce_unrelated_growth_or_turnover(actor,query,expected):
    d=actor.dataset();t=thread(actor,d)
    ok(message(actor,t,text='2025-Q2净利润环比'),201)
    response=ok(message(actor,t,text=query,version=2,key='metric-subject-followup'),201)['message']['payload']['response']
    scope=response['context']['question_scope']
    assert scope['topics']==expected
    assert [fact['id'] for fact in response['facts']]==expected
    assert response['external_calls']==0
