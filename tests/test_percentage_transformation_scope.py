"""Actual assistant APIs distinguish a relative change from amount/ratio facts."""
from copy import deepcopy

import pytest

from conftest import Actor
from test_currency_comparison_scope import ForbiddenProviders, both_answers, scope_of
from test_services import message, ok, thread
from test_workspace_api import plan


@pytest.fixture
def percentage_actor(factory):
    provider = ForbiddenProviders()
    yield Actor(factory(providers=provider))
    assert provider.calls == []


@pytest.fixture
def percentage_data(percentage_actor, example):
    data = deepcopy(example); data.update(source_kind='user_provided', company='百分比边界隔离合成企业')
    data['periods'] = data['periods'][:2]
    for row, period, cost, profit, revenue in zip(data['periods'], ['2024-Q1', '2024-Q2'],
            [80000, 100000], [5000, 10000], [100000, 150000]):
        row.update(period=period, cost=cost, net_profit=profit, revenue=revenue)
    return ok(percentage_actor.post('/datasets', json=data), 201)


@pytest.mark.parametrize('query', [
    '成本环比增长百分之多少', '成本环比百分比增长是多少', '成本环比涨幅是多少', '成本环比增长率是多少',
    '净利润环比增长百分之多少', '净利润环比百分比增长是多少', '净利润环比涨幅是多少', '净利润环比增长率是多少',
    'cost percentage growth QoQ', 'net profit percentage growth QoQ',
    'cash flow percent change QoQ', 'cost percentage decrease QoQ',
    '毛利率环比增长百分之多少', '净利率百分比增长', '净资产收益率涨幅',
    '成本下降了百分之多少', '成本降幅是多少', '库存周转率百分比增长',
    '收入增长率与成本涨幅', 'revenue growth rate and cost percentage growth QoQ',
    '收入与净利润环比增长百分之多少', '成本、净利润与毛利率百分比增长',
    '成本环比百分之多少', '净利润环比百分之多少',
    '成本环比变化百分比是多少', '成本环比增加了多少百分比',
    '净利润同比变化百分比是多少', '现金流环比减少了多少百分比',
    '成本 同比 是 百分之 几', '净利润下降的百分比是多少',
    '毛利率环比变化百分比是多少', '收入环比百分之多少与成本环比百分之多少',
])
def test_unsupported_explicit_relative_changes_refuse_without_amount_substitution(percentage_actor, percentage_data, query):
    actor = percentage_actor; data = percentage_data
    for result in both_answers(actor, data, '2024-Q2 '+query):
        scope = scope_of(result)
        assert scope['status'] == 'unsupported_topic' and not scope['can_calculate']
        assert scope['topics'] == result['facts'] == []
        assert result['answer'] == scope['notice'] and '不能用原始金额' in result['answer']
    preview = plan(actor, data, query='2024-Q2 '+query)
    assert preview['payload']['blockers']
    before = actor.client.app.state.store.db.total_changes
    response = actor.post('/workspace/plans/'+preview['id']+'/execute', json={
        'version': preview['version'], 'fingerprint': preview['payload']['fingerprint']})
    assert response.status_code == 409
    assert actor.client.app.state.store.db.total_changes == before


@pytest.mark.parametrize('query,metric,current,change', [
    ('成本环比增加多少元', 'cost', 100000, 20000),
    ('净利润环比增加多少元', 'net_profit', 10000, 5000),
    ('cost absolute increase QoQ', 'cost', 100000, 20000),
    ('net profit difference QoQ', 'net_profit', 10000, 5000),
])
def test_amount_differences_remain_amounts(percentage_actor, percentage_data, query, metric, current, change):
    for result in both_answers(percentage_actor, percentage_data, '2024-Q2 '+query):
        assert scope_of(result)['can_calculate']
        fact, = result['facts']
        assert (fact['id'], fact['value']) == (metric, current)
        assert fact['comparison']['change'] == change and fact['comparison']['change_unit'] == 'CNY'
        assert fact['comparison']['operation'] == 'difference'


@pytest.mark.parametrize('query', ['收入环比增长率是多少', '收入环比增长百分之多少',
    '收入环比百分比增长是多少', '收入环比涨幅是多少', 'revenue percentage growth QoQ',
    'percentage growth in revenue QoQ', 'QoQ revenue percent change', 'revenue QoQ growth rate',
    '收入环比百分之多少', '收入环比变化百分比是多少', '收入环比增加了多少百分比'])
def test_registered_revenue_growth_keeps_its_formula(percentage_actor, percentage_data, query):
    for result in both_answers(percentage_actor, percentage_data, '2024-Q2 '+query):
        assert scope_of(result)['topics'] == ['revenue_growth', 'revenue']
        growth, amount = result['facts']
        assert growth['value'] == .5 and amount['value'] == 150000
        assert growth['input_hash'] == percentage_data['content_hash']


@pytest.mark.parametrize('query,topics', [
    ('毛利率环比增加多少个百分点', ['gross_margin']),
    ('gross margin percentage points QoQ', ['gross_margin']),
    ('净利润率环比变化多少个百分点', ['net_margin']),
    ('毛利率环比增加了多少个百分点', ['gross_margin']),
    ('毛利率是百分之多少', ['gross_margin']),
    ('净利润率百分比是多少', ['net_margin']),
    ('成本与净利润和毛利率、现金收入比、资产负债率、净资产收益率、资产周转率环比',
        ['gross_margin', 'cash_ratio', 'leverage', 'cost', 'net_profit', 'roe', 'asset_turnover']),
    ('revenue percentage_growth_record and cost QoQ', ['revenue', 'cost']),
    ('cost prepercentage growth QoQ', ['cost']),
    ('cost percentage growth_record QoQ', ['cost']),
])
def test_existing_ratio_and_multiple_metric_queries_keep_the_full_scope(percentage_actor, percentage_data, query, topics):
    for result in both_answers(percentage_actor, percentage_data, '2024-Q2 '+query):
        assert scope_of(result)['can_calculate']
        assert [f['id'] for f in result['facts']] == topics
        for fact in result['facts']:
            if fact['id'] in ('gross_margin', 'net_margin'):
                assert fact['comparison']['change_unit'] == 'ratio_points'


def test_percentage_followup_does_not_restore_previous_amount_scope(percentage_actor, percentage_data):
    actor = percentage_actor; t = thread(actor, percentage_data)
    ok(message(actor, t, text='2024-Q2成本环比增加多少元'), 201)
    response = ok(message(actor, t, text='那成本增长百分之多少呢', version=2, key='percentage-followup'), 201)['message']['payload']['response']
    assert not scope_of(response)['can_calculate'] and response['facts'] == []
