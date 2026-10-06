"""Local scope fidelity: isolated authenticated APIs, never a live provider."""
from typing import get_args

import pytest

from conftest import Actor
from server import copilot
from server.analytics import forecast_baselines, lineage, calculate
from server.autonomy_contracts import ExecutionOptions
from server.contracts import ExperimentRequest
from server.providers import ProviderService
from test_services import identity, thread, message, ok
from test_workspace_analytics import series


class NoNetworkScopeProviderSpy(ProviderService):
    """Any supplier/planner invocation is a test failure, not a simulated success."""
    def __init__(self):
        super().__init__()
        self.calls = []

    async def complete(self, *args, **kwargs):
        self.calls.append('complete')
        raise AssertionError('Local question must not invoke a supplier')

    async def propose(self, *args, **kwargs):
        self.calls.append('propose')
        raise AssertionError('Local question must not invoke a planner')


@pytest.fixture
def local_scope_actor(factory, monkeypatch):
    providers = NoNetworkScopeProviderSpy()
    actor = Actor(factory(providers=providers))
    calls = []

    def tracked_local_forecast(data, metric, horizon):
        calls.append({'metric': metric, 'periods': [p['period'] for p in data['periods']]})
        return forecast_baselines(data, metric, horizon)

    monkeypatch.setattr(copilot, 'forecast_baselines', tracked_local_forecast)
    yield actor, calls
    assert providers.calls == []


def saved_reply(actor, conversation, text, version=1):
    posted = ok(message(actor, conversation, text=text, version=version,
                        key=f'scope-reply-{version:04d}'), 201)
    reply = posted['message']['payload']['response']
    historical = ok(actor.get('/services/threads/' + conversation['id']))
    saved = next(m for m in historical['messages'] if m['id'] == posted['message']['id'])
    assert saved['payload']['response'] == reply
    replayed = ok(message(actor, conversation, text=text, version=version,
                          key=f'scope-reply-{version:04d}'), 201)
    assert replayed['replayed'] and replayed['message'] == posted['message']
    assert reply['external_calls'] == 0
    assert reply['context']['question_scope'] == reply['research_brief']['scope']['question_scope']
    return reply, posted['message']


def ask(actor, data, text, depth='balanced'):
    profile = identity(actor, data, depth=depth, output_style='evidence_first')
    reply = saved_reply(actor, thread(actor, data, profile), text)[0]
    assert ok(actor.get('/datasets/' + data['id'])) == data
    return reply


def forecast_card(reply):
    return next(c['data'] for c in reply['cards'] if c['kind'] == 'forecast')


@pytest.mark.parametrize('query,metric', [
    ('预测收入', 'revenue'), ('预测成本', 'cost'), ('预测现金流', 'cash_flow'),
    ('预测毛利率', 'gross_margin'), ('forecast revenue', 'revenue'),
    ('forecast cost', 'cost'), ('forecast cash flow', 'cash_flow'),
    ('forecast gross margin', 'gross_margin'), ('forecast gross profit margin', 'gross_margin'),
    ('forecast gross-profit margin', 'gross_margin'), ('forecast cash', 'cash_flow'),
    ('经营现金流回测', 'cash_flow'),
])
def test_forecast_uses_registered_resolved_metric_and_selected_period(local_scope_actor, query, metric):
    actor, calls = local_scope_actor
    data = ok(actor.post('/datasets', json=series()), 201)
    reply = ask(actor, data, '2024-Q2 环比 ' + query)
    scope = reply['context']['question_scope']
    assert scope['can_calculate'] and scope['period'] == '2024-Q2'
    assert scope['comparison'] == 'previous'
    prefix = {**data['payload'], 'periods': data['payload']['periods'][:10]}
    assert forecast_card(reply) == forecast_baselines(prefix, metric, 2)
    assert calls == [{'metric': metric, 'periods': [p['period'] for p in prefix['periods']]}]
    receipt = next(r for r in reply['receipts'] if r['tool'] == 'forecast_baselines')
    assert receipt['state'] == 'succeeded' and receipt['input']['metric'] == metric
    assert all(f['period'] == '2024-Q2' for f in reply['facts'])


@pytest.mark.parametrize('query', [
    '预测净利润', '资产负债率预测', 'forecast net profit', 'forecast leverage',
    '预测净利率', 'forecast net profit margin', '预测经营现金收入比', 'forecast cash ratio',
    '预测资产周转率', 'forecast inventory turnover', '预测研发费用率',
    '预测收入增长率', 'forecast revenue growth rate', 'forecast growth rate in revenue', '预测收入环比',
    '预测收入和成本', 'forecast gross margin and revenue',
    '预测现金流和现金收入比', 'forecast cash flow and cash ratio',
    'forecast cash flow and net profit', 'forecast revenue and net profit',
    '预测经营概览',
])
def test_unsupported_or_multi_metric_forecast_never_calls_generic_baseline(local_scope_actor, query):
    actor, calls = local_scope_actor
    data = ok(actor.post('/datasets', json=series()), 201)
    reply = ask(actor, data, query)
    assert reply['context']['question_scope']['can_calculate']
    blocked = forecast_card(reply)
    assert blocked['status'] == 'blocked' and 'forecast' not in blocked
    assert '预测' in blocked['reason']
    assert blocked['reason'] in reply['answer'] and blocked['reason'] in reply['warnings']
    assert calls == []
    receipt = next(r for r in reply['receipts'] if r['tool'] == 'forecast_baselines')
    assert receipt['state'] == 'blocked'
    assert receipt['input'].get('metric') is None


@pytest.mark.parametrize('query', [
    '预测市场占有率', 'forecast free cash flow', 'forecast revenue and operating margin',
    '2024年度预测收入', '2024-Q1和2024-Q2预测收入', '2021-Q4 forecast cost',
])
def test_unresolved_financial_scope_never_dispatches_forecast(local_scope_actor, query):
    actor, calls = local_scope_actor
    data = ok(actor.post('/datasets', json=series()), 201)
    reply = ask(actor, data, query)
    scope = reply['context']['question_scope']
    assert not scope['can_calculate'] and not reply['facts']
    assert reply['answer'] == scope['notice']
    assert not any(c['kind'] == 'forecast' for c in reply['cards'])
    assert calls == []


@pytest.mark.parametrize('problem', ['short', 'gap', 'missing'])
def test_correct_forecast_metric_still_respects_existing_data_guards(local_scope_actor, problem):
    actor, calls = local_scope_actor
    payload = series(5 if problem == 'short' else 12)
    if problem == 'gap':
        payload['periods'].pop(4)
    if problem == 'missing':
        payload['periods'][4]['cash_flow'] = None
    data = ok(actor.post('/datasets', json=payload), 201)
    reply = ask(actor, data, 'forecast cash flow')
    assert forecast_card(reply)['status'] == 'blocked'
    assert calls[0]['metric'] == 'cash_flow'
    assert next(r for r in reply['receipts'] if r['tool'] == 'forecast_baselines')['state'] == 'blocked'


FOUR = '收入、成本、净利润、毛利率'
SEVEN = FOUR + '、净利率、资产负债率、资产周转率'
ALL = SEVEN + '、经营现金流、经营现金收入比、库存周转率、研发费用率、净资产收益率、收入增长率'


def assert_complete_scope(reply, data, period):
    scope = reply['context']['question_scope']
    assert [f['id'] for f in reply['facts']] == scope['topics']
    assert all(f['period'] == period and f['formula'] and f['inputs'] for f in reply['facts'])
    for fact in reply['facts']:
        sentence = fact['label'] + ('为' + fact['display_value'] if fact['value'] is not None else '缺少可用输入')
        assert sentence in reply['answer']
    prefix = {**data['payload'], 'periods': [p for p in data['payload']['periods'] if p['period'] <= period]}
    expected = [r for r in lineage(prefix, calculate(prefix, scope['comparison'])) if r['id'] in scope['topics']]
    assert next(c['data'] for c in reply['cards'] if c['kind'] == 'lineage') == expected
    assert next(r for r in reply['receipts'] if r['tool'] == 'metric_lineage')['input']['metric_ids'] == scope['topics']


@pytest.mark.parametrize('depth,query,count', [
    ('concise', FOUR, 4), ('balanced', SEVEN, 7), ('deep', ALL, 13),
    ('concise', ALL, 13), ('balanced', ALL, 13), ('concise', '收入、成本、毛利率', 3),
    ('deep', SEVEN, 7),
])
def test_depth_preserves_every_explicit_fact_prose_and_lineage(local_scope_actor, depth, query, count):
    actor, calls = local_scope_actor
    data = ok(actor.post('/datasets', json=series()), 201)
    reply = ask(actor, data, '2024-Q2 ' + query + ' 环比', depth)
    assert len(reply['context']['question_scope']['topics']) == count
    assert_complete_scope(reply, data, '2024-Q2')
    assert all(len(f['trend']) <= (4 if depth == 'concise' else 8) for f in reply['facts'])
    legacy = ok(actor.post('/workspace/assistant', json={'dataset_id': data['id'], 'query': '2024-Q2 ' + query + ' 环比'}))
    assert [f['id'] for f in legacy['facts']] == legacy['question_scope']['topics']
    assert legacy['question_scope']['topics'] == reply['context']['question_scope']['topics']
    assert calls == []


def test_missing_explicit_metric_stays_visible_instead_of_being_truncated(local_scope_actor):
    actor, _ = local_scope_actor
    payload = series(); payload['periods'][-1]['net_profit'] = None
    data = ok(actor.post('/datasets', json=payload), 201)
    reply = ask(actor, data, FOUR, 'concise')
    assert_complete_scope(reply, data, '2024-Q4')
    fact = next(f for f in reply['facts'] if f['id'] == 'net_profit')
    assert fact['value'] is None and fact['status'] == 'missing'
    assert 'net_profit' in reply['research_brief']['missing_metric_ids']


def test_full_scope_survives_repeated_continuations_and_saved_trace(local_scope_actor):
    actor, calls = local_scope_actor
    data = ok(actor.post('/datasets', json=series()), 201)
    profile = identity(actor, data, depth='concise', output_style='evidence_first')
    conversation = thread(actor, data, profile)
    first, _ = saved_reply(actor, conversation, '2024-Q2 ' + ALL + ' 环比')
    topics = first['context']['question_scope']['topics']
    for version, text in enumerate(['继续展开', '那同比呢', '继续展开'], 2):
        reply, saved = saved_reply(actor, conversation, text, version)
        scope = reply['context']['question_scope']
        assert scope['topics'] == topics and scope['period'] == '2024-Q2'
        assert_complete_scope(reply, data, '2024-Q2')
        assert reply['context']['history_used_for_topics']
        traced = ok(actor.get('/services/threads/' + conversation['id'] + '/messages/' + saved['id'] + '/trace',
                    params={'identity_id': profile['id'], 'dataset_id': data['id']}))
        assert traced['question_scope']['topics'] == topics
        assert [f['id'] for f in traced['facts']] == topics
    assert calls == []


def test_explicit_forecast_followup_keeps_period_but_replaces_metric(local_scope_actor):
    actor, calls = local_scope_actor
    data = ok(actor.post('/datasets', json=series()), 201)
    conversation = thread(actor, data)
    saved_reply(actor, conversation, '2024-Q2 营业收入环比')
    reply, _ = saved_reply(actor, conversation, '继续预测 cash flow', 2)
    assert forecast_card(reply)['metric'] == 'cash_flow'
    assert forecast_card(reply)['train_end'] == '2024-Q2'
    assert reply['context']['question_scope']['comparison'] == 'previous'
    blocked, _ = saved_reply(actor, conversation, '继续预测净利润', 3)
    assert blocked['context']['question_scope']['topics'] == ['net_profit']
    assert blocked['context']['question_scope']['period'] == '2024-Q2'
    assert forecast_card(blocked)['status'] == 'blocked'
    assert len(calls) == 1
    # An unspecified forecast is not permission to reuse a convenient metric.
    unspecified, _ = saved_reply(actor, conversation, '继续预测', 4)
    assert not unspecified['context']['question_scope']['can_calculate']
    assert not any(c['kind'] == 'forecast' for c in unspecified['cards'])


def test_forecast_allowlist_agrees_with_both_registered_contracts():
    expected = {'revenue', 'cost', 'cash_flow', 'gross_margin'}
    assert copilot._FORECAST_METRICS == expected
    assert set(get_args(ExecutionOptions.model_fields['forecast_metric'].annotation)) == expected
    assert set(get_args(ExperimentRequest.model_fields['metric'].annotation)) == expected


@pytest.mark.parametrize('perspective,expected', [
    ('operator', ['gross_margin', 'cash_ratio', 'leverage']),
    ('executive', ['revenue', 'revenue_growth', 'cash_ratio']),
    ('investor', ['revenue_growth', 'net_margin', 'cash_ratio']),
    ('researcher', ['revenue_growth', 'gross_margin', 'rd_ratio']),
    ('auditor', ['cash_ratio', 'leverage', 'gross_margin']),
    ('custom', ['gross_margin', 'cash_ratio', 'leverage']),
])
def test_default_overview_choices_remain_bounded_and_unchanged(local_scope_actor, perspective, expected):
    actor, calls = local_scope_actor
    data = ok(actor.post('/datasets', json=series()), 201)
    for depth in ('concise', 'balanced', 'deep'):
        profile = identity(actor, data, perspective=perspective, depth=depth, output_style='evidence_first')
        reply, _ = saved_reply(actor, thread(actor, data, profile), '2024-Q2 经营概览')
        assert reply['context']['question_scope']['topics'] == expected
        assert_complete_scope(reply, data, '2024-Q2')
    legacy = ok(actor.post('/workspace/assistant', json={'dataset_id': data['id'], 'query': '2024-Q2 经营概览'}))
    assert legacy['question_scope']['topics'] == ['gross_margin', 'cash_ratio']
    assert [f['id'] for f in legacy['facts']] == legacy['question_scope']['topics']
    assert calls == []
