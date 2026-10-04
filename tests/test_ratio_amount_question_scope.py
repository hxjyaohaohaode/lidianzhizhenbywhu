"""Amounts must not become ratios; isolated authenticated API fixtures only."""
import pytest
from server.store import digest
from test_services import thread, message, ok


def both_answers(actor, dataset, query):
    legacy = ok(actor.post('/workspace/assistant', json={'dataset_id': dataset['id'], 'query': query}))
    service = ok(message(actor, thread(actor, dataset), text=query), 201)['message']['payload']['response']
    assert legacy['external_calls'] == service['external_calls'] == 0
    return legacy, service


def assert_unsupported(result, amount='负债金额', ratio='资产负债率'):
    scope = result.get('question_scope') or result['context']['question_scope']
    assert scope['status'] == 'unsupported_topic' and not scope['can_calculate']
    assert scope['topics'] == result['facts'] == []
    assert amount in result['answer'] and ratio in result['answer']


@pytest.mark.parametrize('query', [
    '总负债是多少', '负债总额', '负债金额', '负债余额', '负债存量', '期末负债',
    '负债合计', '负债是多少元', '有多少负债', '负债', '总负债同比', '负债余额环比',
    '偿债金额是多少', '偿债的总额', '偿债多少钱', '偿债金额与资产负债率',
    '负债总额与营业收入同比', '资产负债率和总负债', '总负债及资产负债率',
    '负债余额和经营现金流', '经营概览与负债金额', '债务余额与杠杆',
    'total liabilities', 'liability balance', 'LIABILITIES AND LEVERAGE',
    'total liabilities and revenue year over year', 'debt balance and leverage',
])
def test_liability_amounts_or_generic_requests_never_produce_ratio_facts(actor, query):
    dataset = actor.dataset(); original_hash = digest(dataset['payload'])
    for result in both_answers(actor, dataset, '2025-Q4 ' + query):
        assert_unsupported(result)
    assert digest(ok(actor.get('/datasets/' + dataset['id']))['payload']) == original_hash


@pytest.mark.parametrize('query,comparison', [
    ('资产负债率', 'year_over_year'), ('负债率同比', 'year_over_year'),
    ('资产负债比率', 'year_over_year'), ('负债比例', 'year_over_year'),
    ('总资产负债率环比', 'previous'), ('杠杆环比', 'previous'),
    ('偿债', 'year_over_year'), ('LEVERAGE year over year', 'year_over_year'),
    ('leverage previous quarter', 'previous'),
])
def test_explicit_liability_ratio_remains_an_unchanged_ratio_in_both_assistants(actor, query, comparison):
    dataset = actor.dataset()
    current = next(row for row in dataset['payload']['periods'] if row['period'] == '2025-Q4')
    for result in both_answers(actor, dataset, '2025-Q4 ' + query):
        scope = result.get('question_scope') or result['context']['question_scope']
        assert scope['can_calculate'] and scope['comparison'] == comparison
        assert [fact['id'] for fact in result['facts']] == ['leverage']
        fact = result['facts'][0]
        assert fact['value'] == pytest.approx(current['liabilities'] / current['assets'])
        assert fact['formula'] == '负债/资产'
        assert {item['path'] for item in fact['inputs']} == {'periods/2025-Q4/liabilities', 'periods/2025-Q4/assets'}
        assert fact['comparison']['change_unit'] == 'ratio_points'
        assert fact['input_hash'] == dataset['content_hash']
        if result['engine'] == 'local_tool_copilot':
            assert fact['unit'] == 'ratio' and fact['display_value'].endswith('%')


@pytest.mark.parametrize('query', [
    '那总负债呢', '继续看负债余额', '负债总额环比呢', '继续看资产负债率和总负债',
    '那负债与营业收入呢', '继续看 total liabilities and leverage',
])
def test_liability_amount_followup_cannot_reinherit_a_supported_ratio(actor, query):
    dataset = actor.dataset(); t = thread(actor, dataset)
    first = ok(message(actor, t, text='2025-Q4资产负债率环比'), 201)['message']['payload']['response']
    assert [fact['id'] for fact in first['facts']] == ['leverage']
    result = ok(message(actor, t, text=query, version=2, key='liability-amount-followup'), 201)['message']['payload']['response']
    assert_unsupported(result)
    assert result['external_calls'] == 0


def test_ratio_scope_followup_changes_only_the_requested_baseline(actor):
    dataset = actor.dataset(); t = thread(actor, dataset)
    ok(message(actor, t, text='2025-Q4资产负债率同比'), 201)
    result = ok(message(actor, t, text='那环比呢', version=2, key='liability-ratio-followup'), 201)['message']['payload']['response']
    scope = result['context']['question_scope']
    assert scope['can_calculate'] and scope['period'] == '2025-Q4'
    assert scope['comparison'] == 'previous' and scope['topics'] == ['leverage']
    assert result['facts'][0]['comparison']['period'] == '2025-Q3'


def test_liability_english_word_fragments_do_not_block_an_explicit_ratio(actor):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '2025-Q4 leverage reliability'):
        assert [fact['id'] for fact in result['facts']] == ['leverage']


@pytest.mark.parametrize('query', [
    '库存金额是多少', '存货金额', '库存余额', '存货总额', '存货的金额', '库存价值',
    '存货账面价值', '库存总金额',
    '库存是多少元', '存货多少钱', '库存存量', '期末库存余额同比',
    '库存周转率与库存金额', '存货金额与存货周转率', '库存余额与营业收入',
    '库存金额经营概览', 'inventory amount and inventory turnover',
    'inventory value and revenue', 'inventory balance and inventory turnover',
])
def test_explicit_inventory_amounts_never_become_turnover_or_unrelated_facts(actor, query):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '2025-Q4 ' + query):
        assert_unsupported(result, '存货金额', '库存周转率')


@pytest.mark.parametrize('query', [
    '研发费用是多少元', '研发费用', '研发金额', '研发的费用', '研发支出',
    '研发费是多少元', '研发总费用',
    '研发投入金额', '研发开支', '研发投入多少元', '研发多少钱', '研发费用总额同比',
    '研发费用率与研发费用', '研发支出和研发占比', '研发费用与营业收入',
    '研发费用经营概览', 'R&D expenses', 'r&d expenditure and revenue',
    'r&d amount and r&d ratio', 'r&d spending and r&d expense ratio',
])
def test_explicit_rd_amounts_never_become_ratios_or_unrelated_facts(actor, query):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '2025-Q4 ' + query):
        assert_unsupported(result, '研发费用金额', '研发费用率')


@pytest.mark.parametrize('query,metric,numerator,denominator,unit', [
    ('库存周转率', 'inventory_turnover', 'cost', 'inventory', 'times'),
    ('存货周转', 'inventory_turnover', 'cost', 'inventory', 'times'),
    ('存货的周转率', 'inventory_turnover', 'cost', 'inventory', 'times'),
    ('inventory turnover', 'inventory_turnover', 'cost', 'inventory', 'times'),
    ('研发费用率', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
    ('研发费率', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
    ('研发费用的占比', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
    ('研发金额的占比', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
    ('研发占比', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
    ('研发金额占比', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
    ('研发支出比例', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
    ('研发成本率', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
    ('r&d expense ratio', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
    ('r&d spending ratio', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
    ('r&d cost ratio', 'rd_ratio', 'rd_expense', 'revenue', 'ratio_points'),
])
def test_explicit_inventory_and_rd_ratios_preserve_formula_and_units(actor, query, metric, numerator, denominator, unit):
    dataset = actor.dataset()
    source = next(row for row in dataset['payload']['periods'] if row['period'] == '2025-Q4')
    for result in both_answers(actor, dataset, '2025-Q4 ' + query):
        assert [fact['id'] for fact in result['facts']] == [metric]
        fact = next(fact for fact in result['facts'] if fact['id'] == metric)
        assert fact['value'] == pytest.approx(source[numerator] / source[denominator])
        assert fact['comparison']['change_unit'] == unit
        assert {item['path'] for item in fact['inputs']} == {f'periods/2025-Q4/{numerator}', f'periods/2025-Q4/{denominator}'}


@pytest.mark.parametrize('first,query,amount,ratio', [
    ('库存周转率', '那库存金额呢', '存货金额', '库存周转率'),
    ('库存周转率', '继续看库存余额与存货周转率', '存货金额', '库存周转率'),
    ('库存周转率', '继续看 inventory amount and inventory turnover', '存货金额', '库存周转率'),
    ('研发占比', '那研发费用呢', '研发费用金额', '研发费用率'),
    ('研发费用率', '继续看研发费用率与研发支出', '研发费用金额', '研发费用率'),
    ('研发占比', '继续看 r&d spending and r&d ratio', '研发费用金额', '研发费用率'),
])
def test_inventory_and_rd_amount_followups_do_not_reinherit_ratios(actor, first, query, amount, ratio):
    dataset = actor.dataset(); t = thread(actor, dataset)
    ok(message(actor, t, text='2025-Q4' + first + '环比'), 201)
    result = ok(message(actor, t, text=query, version=2, key='ratio-amount-followup'), 201)['message']['payload']['response']
    assert_unsupported(result, amount, ratio)
    assert result['external_calls'] == 0


@pytest.mark.parametrize('query,topics', [
    ('库存', ['inventory_turnover']), ('存货', ['inventory_turnover']), ('研发', ['rd_ratio']),
    ('库存周转率与研发费用率', ['inventory_turnover', 'rd_ratio']),
    ('研发金额占比与收入', ['revenue', 'rd_ratio']),
])
def test_generic_inventory_rd_and_supported_mixed_ratios_keep_existing_scope(actor, query, topics):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '2025-Q4' + query):
        assert [fact['id'] for fact in result['facts']] == topics


@pytest.mark.parametrize('query', [
    '毛利多少钱', '毛利是多少元', '毛利有多少万元', '毛利率与毛利多少钱',
])
def test_gross_profit_explicit_currency_question_cannot_become_a_margin(actor, query):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '2025-Q4' + query):
        assert_unsupported(result, '毛利额', '毛利率')


def test_gross_profit_currency_followup_cannot_reinherit_margin(actor):
    dataset = actor.dataset(); t = thread(actor, dataset)
    ok(message(actor, t, text='2025-Q4毛利率环比'), 201)
    result = ok(message(actor, t, text='那毛利多少钱呢', version=2, key='margin-amount-followup'), 201)['message']['payload']['response']
    assert_unsupported(result, '毛利额', '毛利率')


@pytest.mark.parametrize('query', [
    '研发费用与营业收入之比', '研发支出占营业收入的比例',
])
def test_explicit_rd_revenue_denominator_remains_supported(actor, query):
    dataset = actor.dataset()
    source = next(row for row in dataset['payload']['periods'] if row['period'] == '2025-Q4')
    for result in both_answers(actor, dataset, '2025-Q4' + query):
        assert [fact['id'] for fact in result['facts']] == ['rd_ratio']
        fact = result['facts'][0]
        assert fact['value'] == pytest.approx(source['rd_expense'] / source['revenue'])
        assert fact['formula'] == '研发支出/收入'
        assert fact['comparison']['change_unit'] == 'ratio_points'


@pytest.mark.parametrize('query', [
    '研发费用与营业收入之比和研发费用金额', '研发费用与总资产之比',
])
def test_rd_revenue_ratio_mask_does_not_hide_separate_expenses_or_change_denominator(actor, query):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '2025-Q4' + query):
        assert_unsupported(result, '研发费用金额', '研发费用率')


def test_repayment_amount_followup_cannot_reinherit_leverage(actor):
    dataset = actor.dataset(); t = thread(actor, dataset)
    ok(message(actor, t, text='2025-Q4偿债环比'), 201)
    result = ok(message(actor, t, text='那偿债金额呢', version=2, key='repayment-amount-followup'), 201)['message']['payload']['response']
    assert_unsupported(result)


def test_balance_sheet_document_name_does_not_replace_the_requested_revenue_topic(actor):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '根据资产负债表核查2025-Q4营业收入'):
        assert [fact['id'] for fact in result['facts']] == ['revenue']
        assert result['facts'][0]['period'] == '2025-Q4'


def test_balance_sheet_document_name_does_not_hide_a_separate_liability_amount_request(actor):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '根据资产负债表核查2025-Q4营业收入与负债金额'):
        assert_unsupported(result)
