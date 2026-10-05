"""An amount without a denominator must not answer a percentage question."""
import pytest

from test_currency_comparison_scope import both_answers, scope_of
from test_percentage_transformation_scope import percentage_actor, percentage_data
from test_services import message, ok, proposal, thread
from test_workspace_api import plan


@pytest.mark.parametrize('query', [
    '营业成本是百分之多少', '净利润是多少百分比', '成本的百分比是多少',
    '营业收入是百分之多少', '营收是多少百分比', '销售额的百分比是多少',
    '经营现金流是百分之多少', '利润额的百分比是多少',
    '成本 是 百分之 几', '净利润 为 多少 百分比', '成本金额是百分之多少',
    '成本与净利润的百分比是多少', '成本的百分比是多少与毛利率',
    '毛利率是多少百分比和成本是多少百分比',
    '研发费用率与成本的百分比是多少',
    '收入环比增长率与营业收入的百分比是多少',
    '现金收入比与经营现金流是多少百分比',
])
def test_amount_percentage_requires_a_registered_ratio_in_both_apis(percentage_actor, percentage_data, query):
    actor = percentage_actor; data = percentage_data
    for result in both_answers(actor, data, '2024-Q2'+query):
        scope = scope_of(result)
        assert scope['status'] == 'unsupported_topic' and not scope['can_calculate']
        assert result['facts'] == scope['topics'] == []
        assert result['answer'] == scope['notice']
        assert '分母' in result['answer'] and '金额' in result['answer']
    preview = plan(actor, data, query='2024-Q2'+query)
    assert preview['payload']['blockers']
    store = actor.client.app.state.store; changes = store.db.total_changes
    response = actor.post('/workspace/plans/'+preview['id']+'/execute', json={
        'version': preview['version'], 'fingerprint': preview['payload']['fingerprint']})
    assert response.status_code == 409 and store.db.total_changes == changes


@pytest.mark.parametrize('query,topics', [
    ('毛利率是多少百分比', ['gross_margin']),
    ('净利润率是多少百分比', ['net_margin']),
    ('现金收入比是百分之多少', ['cash_ratio']),
    ('研发费用率是多少百分比', ['rd_ratio']),
    ('研发费用与营业收入之比是百分之多少', ['rd_ratio']),
    ('成本金额与毛利率是多少百分比', ['gross_margin', 'cost']),
    ('净利润金额与净利润率是百分之多少', ['net_margin', 'net_profit']),
    ('营业收入金额与研发费用率是多少百分比', ['revenue', 'rd_ratio']),
    ('收入环比百分之多少与成本金额', ['revenue_growth', 'revenue', 'cost']),
    ('收入环比增长率是多少百分比和毛利率', ['gross_margin', 'revenue_growth', 'revenue']),
    ('成本与毛利率环比增加多少个百分点', ['gross_margin', 'cost']),
    ('净利润和成本是多少元', ['cost', 'net_profit']),
])
def test_percentage_binding_preserves_registered_ratios_and_independent_amounts(percentage_actor, percentage_data, query, topics):
    current = percentage_data['payload']['periods'][-1]
    expected = {'gross_margin': (150000-100000)/150000, 'net_margin': 10000/150000,
        'cash_ratio': current['cash_flow']/150000, 'rd_ratio': current['rd_expense']/150000,
        'revenue_growth': .5, 'revenue': 150000, 'cost': 100000, 'net_profit': 10000}
    for result in both_answers(percentage_actor, percentage_data, '2024-Q2'+query):
        assert scope_of(result)['can_calculate']
        assert [f['id'] for f in result['facts']] == topics
        for fact in result['facts']:
            assert fact['value'] == pytest.approx(expected[fact['id']])
            assert fact['input_hash'] == percentage_data['content_hash']
            if fact['id'] in ('gross_margin', 'net_margin', 'cash_ratio', 'rd_ratio'):
                assert fact['comparison']['change_unit'] == 'ratio_points'
            elif fact['id'] in ('cost', 'net_profit', 'revenue'):
                assert fact['comparison']['change_unit'] == 'CNY'


@pytest.mark.parametrize('query', ['那营业成本是百分之多少', '继续看净利润是多少百分比', '那成本的百分比是多少'])
def test_bare_percentage_followup_cannot_inherit_amount_answer(percentage_actor, percentage_data, query):
    actor = percentage_actor; t = thread(actor, percentage_data)
    ok(message(actor, t, text='2024-Q2成本和净利润金额'), 201)
    response = ok(message(actor, t, text=query, version=2, key='bare-percentage-followup'), 201)['message']['payload']['response']
    assert not scope_of(response)['can_calculate'] and response['facts'] == []
    assert '分母' in response['answer']


@pytest.mark.parametrize('current,edited,blocked', [
    ('2024-Q2成本金额', '2024-Q2成本的百分比是多少', True),
    ('2024-Q2成本的百分比是多少', '2024-Q2成本金额与毛利率是多少百分比', False),
])
def test_proposal_uses_edited_target_not_percentage_in_history(percentage_actor, percentage_data, current, edited, blocked):
    actor = percentage_actor; t = thread(actor, percentage_data)
    source = ok(message(actor, t, text=current), 201)['message']
    prop = ok(proposal(actor, t, 'research', text=edited, source_message_id=source['id'],
        include_thread_history=True), 201)
    preview = ok(actor.get('/workspace/plans/'+prop['payload']['plan_id']))
    assert bool(preview['payload']['blockers']) == blocked
