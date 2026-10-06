"""Isolated stock/flow routing and presentation checks; no external providers."""
import copy
import pytest
from conftest import editable
from test_services import thread, message, ok
from server.models import calculate
from server.metric_facts import fact_comparison
from server.question_scope import resolve_question
from server.store import digest


def both_answers(actor, dataset, query):
    legacy = ok(actor.post('/workspace/assistant', json={'query': query, 'dataset_id': dataset['id']}))
    service = ok(message(actor, thread(actor, dataset), text=query), 201)['message']['payload']['response']
    assert legacy['external_calls'] == service['external_calls'] == 0
    return legacy, service


@pytest.mark.parametrize('query', [
    '2025-Q3现金余额是多少', '2025-Q3现金的余额同比', '2025-Q3现金及现金等价物',
    '2025-Q3现金和现金等价物余额', '2025-Q3期末现金', '2025-Q3货币资金',
    '2025-Q3现金及等价物余额', '2025-Q3现金期末余额', '2025-Q3现金期初余额',
    '2025-Q3库存现金', '2025-Q3 cash balance', '2025-Q3 cash balances',
    '2025-Q3 cash beginning balance', '2025-Q3 cash ending balance',
    '2025-Q3 cash and cash equivalents', '2025-Q3 cash on hand',
    '2025-Q3现金余额与营业收入同比', '2025-Q3现金余额和经营现金流',
    '2025-Q3经营现金收入比与现金及现金等价物余额',
    '2025-Q3 cash balance and cash flow and revenue',
])
def test_cash_stocks_are_never_answered_with_flow_or_ratio(actor, query):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, query):
        scope = result.get('question_scope') or result['context']['question_scope']
        assert scope['status'] == 'unsupported_topic' and not scope['can_calculate']
        assert scope['topics'] == result['facts'] == []
        assert '资产负债表' in result['answer'] and '不能用期间流量' in result['answer']
        assert '请单独提问' in result['answer']


@pytest.mark.parametrize('query', [
    '继续看现金余额', '那现金及现金等价物呢', '继续看现金余额和营业收入同比',
    '继续看 cash balance and cash flow',
])
def test_followup_does_not_restore_supported_scope_over_cash_balance_request(actor, query):
    dataset = actor.dataset(); t = thread(actor, dataset)
    ok(message(actor, t, text='2025-Q3经营现金流环比'), 201)
    response = ok(message(actor, t, text=query, version=2, key='cash-balance-followup'), 201)['message']['payload']['response']
    assert response['context']['question_scope']['status'] == 'unsupported_topic'
    assert response['facts'] == [] and response['external_calls'] == 0
    assert '资产负债表' in response['answer']


@pytest.mark.parametrize('query, expected', [
    ('经营现金流', ['cash_flow', 'cash_ratio']),
    ('期末现金流', ['cash_flow', 'cash_ratio']),
    ('期初现金流', ['cash_flow', 'cash_ratio']),
    ('期末现金收入比', ['cash_ratio']),
    ('经营现金收入比', ['cash_ratio']),
    ('现金流收入比', ['cash_ratio']),
    ('cash ratio', ['cash_ratio']),
    ('经营现金收入比和营业收入', ['cash_ratio', 'revenue']),
    ('经营现金收入比和经营现金流', ['cash_flow', 'cash_ratio']),
    ('营业收入同比与经营现金收入比', ['cash_ratio', 'revenue_growth', 'revenue']),
    ('cash ratio and cash flow and revenue', ['cash_flow', 'cash_ratio', 'revenue']),
])
def test_cash_ratio_masks_only_its_embedded_amount_alias(actor, query, expected):
    dataset = actor.dataset()
    for result in both_answers(actor, dataset, '2025-Q3 ' + query):
        assert [f['id'] for f in result['facts']] == expected
        for fact in result['facts']:
            if fact['id'] == 'cash_flow':
                assert fact['comparison']['change_unit'] == 'CNY'
            if fact['id'] == 'cash_ratio':
                assert fact['comparison']['change_unit'] == 'ratio_points'


@pytest.mark.parametrize('period, word, kind, baseline, rate', [
    ('2026-Q2', '同比', 'year_over_year', '2025-Q2', .20625),
    ('2025-Q3', '环比', 'previous', '2025-Q2', .05),
    ('2026-Q1', '环比', 'previous', '2025-Q4', 18100000 / 17500000 - 1),
])
def test_growth_fact_has_growth_rate_comparison_in_both_assistants(actor, period, word, kind, baseline, rate):
    dataset = actor.dataset(); saved_hash = digest(dataset['payload'])
    for result in both_answers(actor, dataset, period + '收入' + word):
        growth, revenue = result['facts']
        assert growth['id'] == 'revenue_growth' and growth['value'] == pytest.approx(rate)
        comparison = growth['comparison']
        assert comparison['operation'] == 'growth_rate' and comparison['status'] == 'available'
        assert comparison['kind'] == kind and comparison['period'] == baseline
        assert comparison['change'] == growth['value'] and comparison['change_unit'] == 'ratio'
        assert comparison['value'] is None  # A revenue amount is never a growth-rate baseline.
        source = next(p for p in dataset['payload']['periods'] if p['period'] == baseline)
        assert comparison['baseline_input'] == {'metric': 'revenue', 'period': baseline, 'value': source['revenue'], 'unit': 'CNY'}
        assert {i['path'] for i in growth['inputs']} == {f'periods/{period}/revenue', f'periods/{baseline}/revenue'}
        assert growth['period'] == period and all(p['period'] <= period for p in growth['trend'])
        assert growth['input_hash'] == dataset['content_hash']
        assert revenue['comparison']['operation'] == 'difference' and revenue['comparison']['change_unit'] == 'CNY'
        assert revenue['comparison']['change'] == revenue['value'] - source['revenue']
        if result['engine'] == 'local_tool_copilot':
            assert f'（{word}，基期{baseline}）' in result['answer']
            assert '个百分点' not in result['answer'] and '缺少可用输入' not in result['answer']
    assert digest(ok(actor.get('/datasets/' + dataset['id']))['payload']) == saved_hash


@pytest.mark.parametrize('case,status,reason', [
    ('absent', 'missing_baseline', '缺少指定基期收入'),
    ('zero', 'invalid_baseline', '基期收入必须大于0'),
])
def test_missing_or_zero_growth_baselines_are_explicit_and_not_substituted(actor, case, status, reason):
    dataset = actor.dataset(); body = editable(dataset)
    if case == 'absent':
        body['periods'] = [p for p in body['periods'] if p['period'] != '2025-Q2']
    else:
        next(p for p in body['periods'] if p['period'] == '2025-Q2')['revenue'] = 0
    dataset = ok(actor.put('/datasets/' + dataset['id'], json=body))
    for result in both_answers(actor, dataset, '2026-Q2收入同比'):
        fact = result['facts'][0]; comparison = fact['comparison']
        assert fact['value'] is None and comparison['change'] is None
        assert comparison['status'] == status and reason in comparison['reason']
        assert comparison['period'] == '2025-Q2' and comparison['change_unit'] == 'ratio'
        assert comparison['baseline_input']['value'] == (None if case == 'absent' else 0)
        if result['engine'] == 'local_tool_copilot':
            assert reason in result['answer']


@pytest.mark.parametrize('current,expected', [(0, -1), (16000000, 0), (8000000, -.5)])
def test_valid_growth_zero_and_decrease_use_original_formula(actor, current, expected):
    dataset = actor.dataset(); body = editable(dataset)
    next(p for p in body['periods'] if p['period'] == '2026-Q2')['revenue'] = current
    dataset = ok(actor.put('/datasets/' + dataset['id'], json=body))
    for result in both_answers(actor, dataset, '2026-Q2收入同比'):
        fact = result['facts'][0]
        assert fact['value'] == expected and fact['comparison']['change'] == expected
        assert fact['comparison']['status'] == 'available'


def test_negative_revenue_baseline_is_still_rejected_by_input_contract_and_formula(actor, example):
    data = copy.deepcopy(example); data['periods'][0]['revenue'] = -1
    assert actor.post('/datasets', json=data).status_code == 422
    result = calculate({**data, 'periods': data['periods'][:5]})
    assert result['metrics']['revenue_growth'] is None
    comparison = fact_comparison('revenue_growth', result['metrics']['revenue_growth'], result)
    assert comparison['status'] == 'invalid_baseline' and comparison['change'] is None
    assert comparison['baseline_input']['value'] == -1


@pytest.mark.parametrize('baseline_cash', [-100, 0, None])
def test_cash_amount_and_ratio_differences_preserve_valid_zero_negative_or_missing_inputs(actor, baseline_cash):
    dataset = actor.dataset(); body = editable(dataset)
    for row in body['periods']:
        if row['period'] == '2025-Q2': row['cash_flow'] = baseline_cash
        if row['period'] == '2025-Q3': row['cash_flow'] = -200
    dataset = ok(actor.put('/datasets/' + dataset['id'], json=body))
    for result in both_answers(actor, dataset, '2025-Q3经营现金流环比'):
        amount, ratio = result['facts']
        assert amount['value'] == -200 and ratio['value'] == pytest.approx(-200 / 16800000)
        assert amount['comparison']['change_unit'] == 'CNY'
        assert ratio['comparison']['change_unit'] == 'ratio_points'
        for fact in (amount, ratio):
            comparison = fact['comparison']
            assert comparison['status'] == ('missing_input' if baseline_cash is None else 'available')
            if baseline_cash is None:
                assert comparison['change'] is None
            else:
                assert comparison['change'] == fact['value'] - comparison['value']


def test_growth_followup_retains_selected_period_and_changes_only_requested_baseline(actor):
    dataset = actor.dataset(); t = thread(actor, dataset)
    ok(message(actor, t, text='2026-Q2收入同比'), 201)
    response = ok(message(actor, t, text='那环比呢', version=2, key='growth-followup'), 201)['message']['payload']['response']
    fact = response['facts'][0]
    assert fact['id'] == 'revenue_growth' and fact['period'] == '2026-Q2'
    assert fact['comparison']['kind'] == 'previous' and fact['comparison']['period'] == '2026-Q1'
    assert fact['value'] == pytest.approx(19300000 / 18100000 - 1)


def test_cash_equivalent_phrase_does_not_match_english_word_fragments(example):
    assert resolve_question('cash balanced ledger', example, [])['status'] != 'unsupported_topic'
