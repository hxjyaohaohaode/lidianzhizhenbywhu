"""Cost units and explicit margin scope over isolated authenticated APIs."""
import pytest
from server.question_scope import resolve_question, resolve_followup
from test_services import thread, message, ok


def both_answers(actor, dataset, query):
    legacy = ok(actor.post('/workspace/assistant', json={'dataset_id': dataset['id'], 'query': query}))
    service = ok(message(actor, thread(actor, dataset), text=query), 201)['message']['payload']['response']
    assert legacy['external_calls'] == service['external_calls'] == 0
    return legacy, service


def assert_unsupported(result):
    scope = result.get('question_scope') or result['context']['question_scope']
    assert scope['status'] == 'unsupported_topic' and not scope['can_calculate']
    assert scope['topics'] == result['facts'] == []
    assert result['answer'] == scope['notice']


@pytest.mark.parametrize('query', [
    '营业成本率', '成本占比', 'cost ratio',
    '营业成本率与收入', '收入与营业成本率',
    'cost ratio and revenue', 'revenue and cost ratio',
    '研发成本率与营业成本率', '营业成本率与研发成本率',
])
def test_unsupported_cost_ratios_cannot_become_amounts_or_partial_answers(example, query):
    scope = resolve_question('2025-Q4 ' + query, example, [])
    assert scope['status'] == 'unsupported_topic' and scope['topics'] == []
    assert '成本比率' in scope['notice'] and '金额' in scope['notice']


@pytest.mark.parametrize('query', ['研发成本率', 'r&d cost ratio'])
def test_supported_rd_cost_ratio_contains_no_unrequested_cost_amount(actor, query):
    dataset = actor.dataset()
    source = next(row for row in dataset['payload']['periods'] if row['period'] == '2025-Q4')
    for result in both_answers(actor, dataset, '2025-Q4 ' + query):
        assert [fact['id'] for fact in result['facts']] == ['rd_ratio']
        fact = result['facts'][0]
        assert fact['value'] == pytest.approx(source['rd_expense'] / source['revenue'])
        assert fact['formula'] == '研发支出/收入'
        assert fact['comparison']['change_unit'] == 'ratio_points'


@pytest.mark.parametrize('query,topics', [
    ('营业成本是多少元', ['cost']), ('operating cost', ['cost']),
    ('研发成本率与营业成本', ['cost', 'rd_ratio']),
    ('营业成本与研发成本率', ['cost', 'rd_ratio']),
    ('r&d cost ratio and cost', ['cost', 'rd_ratio']),
    ('cost and r&d cost ratio', ['cost', 'rd_ratio']),
])
def test_cost_amount_is_preserved_only_when_separately_requested(actor, query, topics):
    dataset = actor.dataset()
    source = next(row for row in dataset['payload']['periods'] if row['period'] == '2025-Q4')
    for result in both_answers(actor, dataset, '2025-Q4 ' + query):
        assert [fact['id'] for fact in result['facts']] == topics
        cost = next(fact for fact in result['facts'] if fact['id'] == 'cost')
        assert cost['value'] == source['cost'] and cost['comparison']['change_unit'] == 'CNY'


@pytest.mark.parametrize('query', [
    'operating margin', 'EBITDA margin', 'profit margin', 'margin',
    'operating margin and revenue', 'revenue and operating margin',
    'gross margin and EBITDA margin', 'EBITDA margin and gross margin',
    'net profit margin and profit margin', 'profit margin and net profit margin',
    '经营利润率', '营业利润率与营业收入', '利润率和营业收入',
])
def test_unsupported_or_unspecified_margin_cannot_become_gross_margin_or_partial_answers(example, query):
    scope = resolve_question('2025-Q4 ' + query, example, ['gross_margin','cash_ratio'])
    assert scope['status'] == 'unsupported_topic' and scope['topics'] == []
    assert 'margin' in scope['notice'] and '毛利率' in scope['notice']


@pytest.mark.parametrize('query,topics', [
    ('gross margin', ['gross_margin']), ('gross profit margin', ['gross_margin']),
    ('gross-profit margin', ['gross_margin']), ('net profit margin', ['net_margin']),
    ('gross margin and net profit margin', ['gross_margin', 'net_margin']),
    ('net profit margin and gross margin', ['gross_margin', 'net_margin']),
    ('gross margin and operating cost', ['gross_margin', 'cost']),
])
def test_explicit_supported_margins_remain_the_requested_metrics(actor, query, topics):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '2025-Q4 ' + query):
        assert [fact['id'] for fact in result['facts']] == topics
        for fact in result['facts']:
            assert fact['comparison']['change_unit'] == ('CNY' if fact['id'] == 'cost' else 'ratio_points')


@pytest.mark.parametrize('query', [
    '那营业成本率呢', '继续看成本率和营业收入',
    '继续看 operating margin', '继续看 EBITDA margin and revenue',
])
def test_unsupported_cost_or_margin_followup_does_not_reinherit_supported_metrics(actor, query):
    dataset = actor.dataset(); t = thread(actor, dataset)
    ok(message(actor, t, text='2025-Q4 gross margin 环比'), 201)
    response = ok(message(actor, t, text=query, version=2, key='cost-margin-unsupported'), 201)['message']['payload']['response']
    assert_unsupported(response)
    assert response['external_calls'] == 0


def test_followup_switches_to_rd_cost_ratio_without_retaining_the_cost_amount(actor):
    dataset = actor.dataset(); t = thread(actor, dataset)
    ok(message(actor, t, text='2025-Q4营业成本环比'), 201)
    response = ok(message(actor, t, text='继续看研发成本率', version=2, key='rd-cost-supported'), 201)['message']['payload']['response']
    assert [fact['id'] for fact in response['facts']] == ['rd_ratio']
    scope = response['context']['question_scope']
    assert scope['period'] == '2025-Q4' and scope['comparison'] == 'previous'


# The finite catalog is the boundary: these tables describe existing capabilities,
# unsupported type transformations, and local compound-name precedence.
RATIO_NAMES = ['毛利率', '经营现金收入比', '资产负债率', '净利润率', '库存周转率', '研发费用率',
               '净资产收益率', '资产周转率', 'gross margin', 'net profit margin', 'cash ratio',
               'leverage', 'inventory turnover', 'r&d cost ratio', 'roe', 'asset turnover']
AMOUNT_NAMES = ['营业收入', '营业成本', '净利润', '经营现金流', 'revenue', 'cost', 'net profit', 'cash flow']


@pytest.mark.parametrize('name', RATIO_NAMES)
@pytest.mark.parametrize('suffix', [' amount', '余额'])
def test_catalog_ratio_metrics_reject_money_and_balance_units(example, name, suffix):
    scope = resolve_question('2025-Q4 ' + name + suffix, example, [])
    assert not scope['can_calculate'] and scope['topics'] == []


@pytest.mark.parametrize('name,suffix', [
    (name,suffix) for name in AMOUNT_NAMES for suffix in (' growth rate', ' balance')
    if not (name in ('营业收入', 'revenue') and suffix == ' growth rate')
])
def test_catalog_flow_amounts_reject_unsupported_growth_rates_and_balances(example, name, suffix):
    scope = resolve_question('2025-Q4 ' + name + suffix, example, [])
    assert not scope['can_calculate'] and scope['topics'] == []


@pytest.mark.parametrize('query', [
    '净利润增长率', '成本增长率', 'cash flow rate', '净利润比例',
    '收入同比增长率与净利润增长率', 'net profit growth rate and revenue growth rate',
    'cash flow growth rate and net profit', '净资产收益金额', '资产周转金额',
    '不要毛利率，只看净利润', '净利润，不看毛利率', 'net profit, not gross margin',
    'not gross margin, net profit', '自由现金流', '投资活动产生的现金流', '筹资现金流',
    'free cash flow and revenue', 'revenue and cash flow from investing',
])
def test_unsupported_transform_subtype_or_negation_is_never_a_partial_metric_answer(example, query):
    scope = resolve_question('2025-Q4 ' + query, example, [])
    assert not scope['can_calculate'] and scope['topics'] == []
    previous = resolve_question('2025-Q4 gross margin 环比', example, [])
    followup = resolve_followup('继续看 ' + query, example, [], previous)
    assert not followup['can_calculate'] and followup['topics'] == []


@pytest.mark.parametrize('query,topics', [
    ('收入同比增长率', ['revenue_growth', 'revenue']),
    ('revenue growth rate', ['revenue_growth', 'revenue']),
    ('growth rate in revenue', ['revenue_growth', 'revenue']),
    ('gross profit margin and revenue', ['gross_margin', 'revenue']),
    ('revenue and gross profit margin', ['gross_margin', 'revenue']),
    ('研发费用与营业收入之比', ['rd_ratio']),
    ('研发费用与营业收入之比和营业收入', ['revenue', 'rd_ratio']),
    ('营业收入与研发费用与营业收入之比', ['revenue', 'rd_ratio']),
    ('经营现金流与净利润率', ['cash_flow', 'cash_ratio', 'net_margin']),
    ('毛利率同比', ['gross_margin']), ('净利润同比', ['net_profit']),
])
def test_catalog_supported_compounds_and_comparisons_keep_exact_topics(example, query, topics):
    scope = resolve_question('2025-Q4 ' + query, example, [])
    assert scope['can_calculate'] and scope['topics'] == topics


@pytest.mark.parametrize('query,status', [
    ('营业成本率与收入', 'unsupported_topic'), ('revenue and operating margin', 'unsupported_topic'),
    ('净利润增长率', 'unsupported_topic'), ('cash flow rate', 'unsupported_topic'),
    ('净资产收益金额', 'unsupported_topic'), ('asset turnover amount', 'unsupported_topic'),
    ('不要毛利率，只看净利率', 'needs_clarification'), ('net profit, not gross margin', 'needs_clarification'),
    ('free cash flow', 'unsupported_topic'), ('筹资现金流与经营现金流', 'unsupported_topic'),
])
def test_each_dispatch_failure_class_reaches_both_real_assistants_without_facts(actor, query, status):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '2025-Q4 ' + query):
        scope = result.get('question_scope') or result['context']['question_scope']
        assert scope['status'] == status and result['facts'] == []
        assert result['answer'] == scope['notice']


def test_compound_research_ratio_keeps_only_separately_requested_revenue_in_both_apis(actor):
    dataset = actor.dataset()
    for query,expected in [('研发费用与营业收入之比',['rd_ratio']),
                           ('研发费用与营业收入之比和营业收入',['revenue','rd_ratio']),
                           ('营业收入与研发费用与营业收入之比',['revenue','rd_ratio'])]:
        for result in both_answers(actor, dataset, '2025-Q4 ' + query):
            assert [fact['id'] for fact in result['facts']] == expected


def test_chinese_unknown_profit_margin_cannot_trigger_overview_defaults_or_hide_among_revenue(actor):
    dataset = actor.dataset()
    for query in ('经营利润率', '营业利润率与营业收入', '利润率与营业收入'):
        for result in both_answers(actor, dataset, '2025-Q4' + query):
            assert_unsupported(result)


def test_plain_business_overview_still_uses_explicit_defaults(example):
    scope = resolve_question('2025-Q4经营概览', example, ['gross_margin','cash_ratio'])
    assert scope['can_calculate'] and scope['topics'] == ['gross_margin','cash_ratio']
