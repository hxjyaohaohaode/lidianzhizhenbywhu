"""Finite currency refusals and comparison aliases over real, isolated APIs.

These cases are a bounded vocabulary contract, not general language coverage.
No conversions, new metric formulas, listeners, or external suppliers are used.
"""
from copy import deepcopy

import pytest

from conftest import Actor, editable
from server.providers import ProviderService
from server.question_scope import plan_scope, resolve_followup, resolve_question
from server.store import encode
from test_adaptive import dispatch, preview
from test_copilot_message_trace import trace
from test_services import confirm, message, ok, proposal, thread


class ForbiddenProviders(ProviderService):
    def __init__(self):
        super().__init__()
        self.calls = []

    async def complete(self, *args, **kwargs):
        self.calls.append('complete')
        raise AssertionError('Currency/comparison scope must stay local')

    async def propose(self, *args, **kwargs):
        self.calls.append('propose')
        raise AssertionError('Currency/comparison scope must stay local')


@pytest.fixture
def currency_actor(factory):
    providers = ForbiddenProviders()
    yield Actor(factory(providers=providers))
    assert providers.calls == []


@pytest.fixture
def comparison_data(example):
    data = deepcopy(example)
    data['source_kind'] = 'user_provided'
    # The historical target, latest input, QoQ and YoY values are all different.
    periods = ['2023-Q4', '2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4', '2025-Q1']
    revenues = [100, 110, 130, 200, 250, 400]
    for row, period, revenue in zip(data['periods'], periods, revenues):
        row.update(period=period, revenue=revenue, cost=revenue * .7,
                   net_profit=revenue * .1, cash_flow=revenue * .2)
    return data


def save(actor, data):
    return ok(actor.post('/datasets', json=data), 201)


def scope_of(result):
    return result.get('question_scope') or result['context']['question_scope']


def both_answers(actor, dataset, query):
    workspace = ok(actor.post('/workspace/assistant', json={'dataset_id': dataset['id'], 'query': query}))
    service = ok(message(actor, thread(actor, dataset), text=query), 201)['message']['payload']['response']
    assert workspace['external_calls'] == service['external_calls'] == 0
    assert ok(actor.get('/datasets/' + dataset['id'])) == dataset
    return workspace, service


FOREIGN_TOKENS = [
    '美元', '美金', '欧元', '英镑', '日元', '日圆', '港元', '港币', '加元', '加币',
    '澳元', '澳币', '瑞士法郎', '瑞郎', '新加坡元', '新元', '韩元',
    'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'CAD', 'AUD', 'CHF', 'SGD', 'KRW',
    'dollar', 'dollars', 'US dollars', 'U.S. dollar', 'euro', 'euros', 'yen',
    'British pound', 'British pounds', 'Swiss franc', 'Swiss francs',
    'Korean won', '$', '€', '£',
]


@pytest.mark.parametrize('token', FOREIGN_TOKENS)
def test_explicit_foreign_currency_vocabulary_refuses_cny_substitution(comparison_data, token):
    scope = resolve_question('2024-Q4 revenue in ' + token, comparison_data, [])
    assert scope['status'] == 'unsupported_topic' and not scope['can_calculate']
    assert scope['topics'] == [] and scope['unsupported_currency']
    assert '人民币' in scope['notice'] and '汇率换算' in scope['notice']
    assert plan_scope('2024-Q4 revenue in ' + token, comparison_data)['status'] == 'blocked'


@pytest.mark.parametrize('query', [
    '2024-Q4美元收入', '2024-Q4 revenue in USD', '2024-Q4欧元成本',
    '2024-Q4人民币收入与美元成本', '2024-Q4 revenue in CNY and cost in EUR',
    '2024-Q4 $ revenue', '2024-Q4经营概览（欧元）',
    '2024-Q4 USD revenue growth rate', '2024-Q4 gross margin in euros',
])
def test_both_assistants_return_no_financial_facts_for_foreign_currency(currency_actor, comparison_data, query):
    data = save(currency_actor, comparison_data)
    for result in both_answers(currency_actor, data, query):
        scope = scope_of(result)
        assert scope['status'] == 'unsupported_topic' and scope['unsupported_currency']
        assert scope['topics'] == result['facts'] == [] and not scope['can_calculate']
        assert result['answer'] == scope['notice']
        assert '人民币数值替代所问币种' in result['answer']


@pytest.mark.parametrize('query,metric,value', [
    ('2024-Q4人民币收入', 'revenue', 250), ('2024-Q4 revenue in CNY', 'revenue', 250),
    ('2024-Q4元成本', 'cost', 175), ('2024-Q4 revenue in RMB', 'revenue', 250),
    ('2024-Q4 revenue in yuan', 'revenue', 250),
])
def test_cny_amounts_keep_the_existing_units_and_saved_values(currency_actor, comparison_data, query, metric, value):
    data = save(currency_actor, comparison_data)
    for result in both_answers(currency_actor, data, query):
        scope = scope_of(result)
        assert scope['can_calculate'] and not scope['unsupported_currency']
        assert [f['id'] for f in result['facts']] == [metric]
        fact = result['facts'][0]
        assert fact['value'] == value and fact['period'] == '2024-Q4'
        assert fact['comparison']['change_unit'] == 'CNY'
        assert [(item['path'], item['value']) for item in fact['inputs']] == [('periods/2024-Q4/' + metric, value)]


@pytest.mark.parametrize('word', ['USDA', 'usd_report', 'EURIBOR', 'Europe', 'eurozone', 'dollarized',
                                'yenwood', 'preQoQ', 'QoQ_summary', 'YoY2024',
                                'year over yearly', 'quarter over quarterly'])
def test_new_ascii_aliases_do_not_match_inside_unrelated_tokens(comparison_data, word):
    scope = resolve_question('2024-Q4 revenue ' + word, comparison_data, [])
    # Existing yearly period parsing is independently conservative.
    if word in ('year over yearly', 'YoY2024'):
        assert scope['status'] == 'needs_clarification'
    else:
        assert scope['can_calculate'] and scope['topics'] == ['revenue']
    assert not scope['unsupported_currency'] and not scope['comparison_explicit']


@pytest.mark.parametrize('query', ['查看美元及欧元资料证据', '查看 USD 资料证据'])
def test_currency_named_evidence_queries_preserve_company_and_owner_scope(currency_actor, comparison_data, query):
    actor = currency_actor; data = save(actor, comparison_data)
    body = {'title': '美元及欧元 USD 资料', 'text': '美元及欧元 USD 资料属于企业提交的待核查证据。' * 6}
    own = ok(actor.post('/evidence', json={**body, 'company': data['payload']['company']}), 201)
    ok(actor.post('/evidence', json={**body, 'company': '另一家隔离合成企业'}), 201)
    stranger = Actor(actor.client)
    ok(stranger.post('/evidence', json={**body, 'company': data['payload']['company']}), 201)
    for result in both_answers(actor, data, query):
        assert scope_of(result)['status'] == 'workspace_query'
        assert not scope_of(result)['unsupported_currency'] and result['facts'] == []
        evidence = result.get('evidence_matches', result.get('citations', []))
        assert evidence and {row['document_id'] for row in evidence} == {own['id']}
    plan = preview(actor, dataset=data, query=query)
    assert plan['payload']['snapshot']['research_scope']['status'] == 'selected'
    assert plan['payload']['snapshot']['research_scope']['question_status'] == 'workspace_query'
    assert not plan['payload']['blockers']


COMPARISONS = [
    ('QoQ', 'previous'), ('qoq', 'previous'), ('quarter over quarter', 'previous'),
    ('quarter-over-quarter', 'previous'), ('YoY', 'year_over_year'),
    ('year over year', 'year_over_year'), ('year-over-year', 'year_over_year'),
]


@pytest.mark.parametrize('alias,kind', COMPARISONS)
@pytest.mark.parametrize('template', ['revenue {}', '{} revenue', 'revenue {} growth rate', '{} revenue growth rate'])
def test_revenue_growth_aliases_and_baselines_share_the_same_vocabulary(comparison_data, alias, kind, template):
    scope = resolve_question('2024-Q4 ' + template.format(alias), comparison_data, [])
    assert scope['can_calculate'] and scope['topics'] == ['revenue_growth', 'revenue']
    assert scope['comparison'] == kind and scope['comparison_explicit']
    assert plan_scope('2024-Q4 ' + template.format(alias), comparison_data)['requested_comparison'] == kind


@pytest.mark.parametrize('alias,kind', COMPARISONS)
def test_scope_only_aliases_inherit_period_and_metric_without_inventing_revenue(comparison_data, alias, kind):
    prior = resolve_question('2024-Q4 net profit 环比', comparison_data, [])
    scope = resolve_followup('那 ' + alias + ' 呢', comparison_data, [], prior)
    assert scope['can_calculate'] and scope['topics'] == ['net_profit']
    assert (scope['period'], scope['comparison']) == ('2024-Q4', kind)
    assert scope['inherited_fields'] == ['period', 'topics']
    standalone = resolve_question(alias, comparison_data, [])
    assert not standalone['can_calculate'] and standalone['topics'] == []


@pytest.mark.parametrize('query,kind,baseline,base_value,growth', [
    ('QoQ revenue', 'previous', '2024-Q3', 200, .25),
    ('revenue quarter over quarter', 'previous', '2024-Q3', 200, .25),
    ('quarter-over-quarter revenue growth', 'previous', '2024-Q3', 200, .25),
    ('revenue QoQ growth rate', 'previous', '2024-Q3', 200, .25),
    ('收入环比', 'previous', '2024-Q3', 200, .25),
    ('YoY revenue', 'year_over_year', '2023-Q4', 100, 1.5),
    ('year-over-year revenue growth rate', 'year_over_year', '2023-Q4', 100, 1.5),
    ('revenue year over year', 'year_over_year', '2023-Q4', 100, 1.5),
    ('收入同比', 'year_over_year', '2023-Q4', 100, 1.5),
])
def test_both_apis_use_the_exact_requested_growth_baseline(currency_actor, comparison_data, query, kind, baseline, base_value, growth):
    data = save(currency_actor, comparison_data)
    for result in both_answers(currency_actor, data, '2024-Q4 ' + query):
        scope = scope_of(result)
        assert (scope['period'], scope['comparison'], scope['comparison_explicit']) == ('2024-Q4', kind, True)
        assert [f['id'] for f in result['facts']] == ['revenue_growth', 'revenue']
        rate, revenue = result['facts']
        assert rate['value'] == pytest.approx(growth) and revenue['value'] == 250
        assert rate['comparison']['kind'] == kind and rate['comparison']['period'] == baseline
        assert rate['comparison']['operation'] == 'growth_rate'
        assert rate['comparison']['baseline_input'] == {'metric': 'revenue', 'period': baseline, 'value': base_value, 'unit': 'CNY'}
        assert rate['comparison']['change'] == pytest.approx(growth)
        assert rate['comparison']['change_unit'] == 'ratio'
        assert revenue['comparison']['value'] == base_value
        assert revenue['comparison']['change'] == 250 - base_value
        assert [(item['path'], item['value']) for item in rate['inputs']] == [
            ('periods/2024-Q4/revenue', 250), ('periods/' + baseline + '/revenue', base_value)]
        assert rate['trend'][-1] == {'period': '2024-Q4', 'value': pytest.approx(growth)}
        assert all(point['period'] <= '2024-Q4' for point in rate['trend'])


@pytest.mark.parametrize('query,topics,kind', [
    ('QoQ cost', ['cost'], 'previous'), ('net profit quarter-over-quarter', ['net_profit'], 'previous'),
    ('YoY gross margin', ['gross_margin'], 'year_over_year'),
    ('inventory turnover year-over-year', ['inventory_turnover'], 'year_over_year'),
    ('revenue previous quarter', ['revenue'], 'previous'),
])
def test_comparison_aliases_never_invent_another_metric_or_growth_capability(comparison_data, query, topics, kind):
    scope = resolve_question('2024-Q4 ' + query, comparison_data, [])
    assert scope['can_calculate'] and scope['topics'] == topics and scope['comparison'] == kind


@pytest.mark.parametrize('query', ['QoQ cost growth rate', 'quarter-over-quarter net profit growth rate',
                                  'revenue QoQ growth rate and cost growth rate',
                                  'QoQ revenue growth rate amount'])
def test_alias_growth_compounds_do_not_mask_unregistered_transforms(comparison_data, query):
    scope = resolve_question('2024-Q4 ' + query, comparison_data, [])
    assert scope['status'] == 'unsupported_topic' and scope['topics'] == []


@pytest.mark.parametrize('query', ['QoQ YoY revenue', 'revenue quarter-over-quarter year-over-year',
                                  '收入同比 QoQ', '收入环比 YoY', 'revenue quarter over quarter 同比'])
def test_conflicting_comparison_aliases_require_clarification_everywhere(currency_actor, comparison_data, query):
    actor = currency_actor; data = save(actor, comparison_data)
    for result in both_answers(actor, data, '2024-Q4 ' + query):
        assert scope_of(result)['status'] == 'needs_clarification' and result['facts'] == []
    prior = resolve_question('2024-Q4收入环比', comparison_data, [])
    followup = resolve_followup('那 ' + query + ' 呢', comparison_data, [], prior)
    assert followup['status'] == 'needs_clarification' and followup['topics'] == []
    plan = preview(actor, dataset=data, query='2024-Q4 ' + query)
    assert plan['payload']['blockers']
    assert actor.post('/workspace/plans/' + plan['id'] + '/execute', json={
        'version': plan['version'], 'fingerprint': plan['payload']['fingerprint']}).status_code == 409
    assert ok(actor.get('/runs'))['items'] == []


@pytest.mark.parametrize('missing', ['quarter', 'zero'])
def test_qoq_missing_or_invalid_baseline_stays_unavailable(currency_actor, comparison_data, missing):
    if missing == 'quarter':
        comparison_data['periods'] = [row for row in comparison_data['periods'] if row['period'] != '2024-Q3']
    else:
        next(row for row in comparison_data['periods'] if row['period'] == '2024-Q3')['revenue'] = 0
    data = save(currency_actor, comparison_data)
    for result in both_answers(currency_actor, data, '2024-Q4 QoQ revenue growth'):
        rate, revenue = result['facts']
        assert rate['value'] is None and rate['comparison']['change'] is None
        assert rate['comparison']['period'] == '2024-Q3'
        assert rate['comparison']['status'] == ('missing_baseline' if missing == 'quarter' else 'invalid_baseline')
        assert rate['comparison']['baseline_input']['value'] == (None if missing == 'quarter' else 0)
        assert revenue['value'] == 250
        if missing == 'quarter':
            assert revenue['comparison']['value'] is None and revenue['comparison']['change'] is None


def test_persisted_followups_trace_and_handoff_preserve_explicit_aliases(currency_actor, comparison_data):
    actor = currency_actor; data = save(actor, comparison_data); t = thread(actor, data)
    first = ok(message(actor, t, text='2024-Q4 revenue year-over-year'), 201)['message']
    queries = [('那QoQ呢', '2024-Q4', 'previous', .25),
               ('继续展开', '2024-Q4', 'previous', .25),
               ('那2025-Q1呢', '2025-Q1', 'previous', .6),
               ('那 year-over-year 呢', '2025-Q1', 'year_over_year', 400 / 110 - 1),
               ('继续看2024-Q4 quarter-over-quarter revenue growth', '2024-Q4', 'previous', .25)]
    for version, (query, target, kind, growth) in enumerate(queries, 2):
        posted = ok(message(actor, t, text=query, version=version, key='comparison-followup-' + str(version)), 201)
        current = posted['message']; result = current['payload']['response']; scope = scope_of(result)
        assert scope['can_calculate'] and (scope['period'], scope['comparison']) == (target, kind)
        assert scope['topics'] == ['revenue_growth', 'revenue']
        assert result['facts'][0]['value'] == pytest.approx(growth)
        persisted = ok(actor.get('/services/threads/' + t['id']))['messages']
        assert next(row for row in persisted if row['id'] == current['id'])['payload'] == current['payload']
        assert next(row for row in persisted if row['id'] == first['id'])['payload'] == first['payload']
        replayed = ok(message(actor, t, text=query, version=version, key='comparison-followup-' + str(version)), 201)
        assert replayed['replayed'] and replayed['message'] == current
        traced = ok(trace(actor, t, current))
        assert scope_of(traced)['comparison'] == kind and traced['facts'][0]['value'] == pytest.approx(growth)
    p = ok(proposal(actor, t, text='', source_message_id=current['id'], include_thread_history=True), 201)
    plan = ok(actor.get('/workspace/plans/' + p['payload']['plan_id']))
    assert not plan['payload']['blockers'] and plan['payload']['request']['comparison'] == 'previous'
    assert plan['payload']['snapshot']['research_scope']['period'] == '2024-Q4'
    assert p['payload']['resolved_source_scope'] == {'period': '2024-Q4', 'comparison': 'previous',
                                                  'topics': ['revenue_growth', 'revenue']}
    assert 'year-over-year' in plan['payload']['request']['query']  # Prior text is not current scope.
    accepted = ok(confirm(actor, p))
    run = actor.execute(ok(actor.get('/runs/' + accepted['payload']['result']['run_id'])))
    assert run['result']['analysis']['current_period'] == '2024-Q4'
    assert run['result']['analysis']['baseline_period'] == '2024-Q3'
    assert run['result']['analysis']['metrics']['revenue_growth'] == pytest.approx(.25)
    assert run['result']['llm']['state'] == 'not_requested'


@pytest.mark.parametrize('query', ['那美元收入呢', '继续看 revenue in USD', '那么欧元呢', '那 USD 呢'])
def test_currency_followup_never_reinherits_cny_facts_or_an_executable_plan(currency_actor, comparison_data, query):
    actor = currency_actor; data = save(actor, comparison_data); t = thread(actor, data)
    ok(message(actor, t, text='2024-Q4 QoQ revenue'), 201)
    current = ok(message(actor, t, text=query, version=2, key='foreign-followup'), 201)['message']
    result = current['payload']['response']
    assert scope_of(result)['unsupported_currency'] and result['facts'] == []
    assert scope_of(result)['status'] == 'unsupported_topic'
    p = ok(proposal(actor, t, text='', source_message_id=current['id']), 201)
    plan = ok(actor.get('/workspace/plans/' + p['payload']['plan_id']))
    assert plan['payload']['snapshot']['research_scope']['status'] == 'blocked'
    assert plan['payload']['blockers'] and confirm(actor, p).status_code == 409
    assert trace(actor, t, current).status_code == 409
    after = ok(message(actor, t, text='继续展开', version=3, key='after-foreign'), 201)['message']['payload']['response']
    assert after['facts'] == [] and not scope_of(after)['can_calculate']
    assert ok(actor.get('/runs'))['items'] == []


@pytest.mark.parametrize('query', ['2024-Q4 revenue in USD', '2024-Q4欧元成本'])
def test_direct_currency_plan_is_blocked_before_dispatch(currency_actor, comparison_data, query):
    actor = currency_actor; data = save(actor, comparison_data)
    plan = preview(actor, dataset=data, query=query)
    assert plan['payload']['blockers'] and '人民币' in plan['payload']['blockers'][0]
    response = actor.post('/workspace/plans/' + plan['id'] + '/execute', json={
        'version': plan['version'], 'fingerprint': plan['payload']['fingerprint']})
    assert response.status_code == 409 and response.json()['error']['code'] == 'PLAN_BLOCKED'
    assert ok(actor.get('/runs'))['items'] == []


@pytest.mark.parametrize('query', [
    '2024-Q4美元经营概览及证据', '2024-Q4 USD overview 证据', '2024-Q4欧元整体经营及资料',
])
def test_currency_overview_with_evidence_blocks_both_approval_paths(currency_actor, comparison_data, query):
    actor = currency_actor; data = save(actor, comparison_data); t = thread(actor, data)
    # Prior valid history must not turn a currently refused sourced goal into a
    # financial plan. Both entry points attempt their real approval endpoints.
    ok(message(actor, t, text='2024-Q4 QoQ revenue'), 201)
    current = ok(message(actor, t, text=query, version=2, key='foreign-overview'), 201)['message']
    service = current['payload']['response']
    workspace = ok(actor.post('/workspace/assistant', json={'dataset_id': data['id'], 'query': query}))
    direct = preview(actor, dataset=data, query=query)
    direct_approval = actor.post('/workspace/plans/' + direct['id'] + '/execute', json={
        'version': direct['version'], 'fingerprint': direct['payload']['fingerprint']})
    sourced = ok(proposal(actor, t, text='', source_message_id=current['id'], include_thread_history=True), 201)
    sourced_plan = ok(actor.get('/workspace/plans/' + sourced['payload']['plan_id']))
    sourced_approval = confirm(actor, sourced)
    assert (direct_approval.status_code, sourced_approval.status_code) == (409, 409)
    assert direct_approval.json()['error']['code'] == sourced_approval.json()['error']['code'] == 'PLAN_BLOCKED'
    for result in (service, workspace):
        scope = scope_of(result)
        assert scope['default_overview'] and scope['unsupported_currency']
        assert scope['status'] == 'unsupported_topic' and result['facts'] == []
        assert result['answer'] == scope['notice'] and result['external_calls'] == 0
    for plan in (direct, sourced_plan):
        scope = plan['payload']['snapshot']['research_scope']
        assert scope['status'] == 'blocked' and scope['question_status'] == 'unsupported_topic'
        assert plan['payload']['blockers'] == [service['answer']]
    assert ok(actor.get('/runs'))['items'] == []
    stored = ok(actor.get('/services/threads/' + t['id']))['messages']
    assert next(row for row in stored if row['id'] == current['id'])['payload'] == current['payload']


@pytest.mark.parametrize('query', ['2024-Q4人民币经营概览及证据', '2024-Q4 CNY overview 证据'])
def test_cny_overview_with_evidence_keeps_both_approval_paths_available(currency_actor, comparison_data, query):
    actor = currency_actor; data = save(actor, comparison_data); t = thread(actor, data)
    current = ok(message(actor, t, text=query), 201)['message']
    result = current['payload']['response']
    assert scope_of(result)['can_calculate'] and not scope_of(result)['unsupported_currency']
    direct = preview(actor, dataset=data, query=query)
    sourced = ok(proposal(actor, t, text='', source_message_id=current['id']), 201)
    sourced_plan = ok(actor.get('/workspace/plans/' + sourced['payload']['plan_id']))
    for plan in (direct, sourced_plan):
        assert not plan['payload']['blockers']
        assert plan['payload']['snapshot']['research_scope']['status'] == 'selected'
    run = actor.execute(dispatch(actor, direct, consent=False))
    assert run['result']['analysis']['current_period'] == '2024-Q4'
    assert run['result']['analysis']['series'][-1]['revenue'] == 250
    assert run['result']['llm']['state'] == 'not_requested'


def test_direct_qoq_plan_inherits_alias_and_rejects_a_conflicting_form_selection(currency_actor, comparison_data):
    actor = currency_actor; data = save(actor, comparison_data)
    query = '2024-Q4 quarter-over-quarter revenue growth'
    plan = preview(actor, dataset=data, query=query)
    assert plan['payload']['request']['comparison'] == 'previous' and not plan['payload']['blockers']
    run = actor.execute(dispatch(actor, plan, consent=False))
    assert run['result']['analysis']['baseline_period'] == '2024-Q3'
    assert run['result']['analysis']['metrics']['revenue_growth'] == pytest.approx(.25)
    conflict = preview(actor, dataset=data, query=query, comparison='year_over_year')
    assert conflict['payload']['blockers'] and conflict['payload']['request']['comparison'] == 'year_over_year'


def test_explicit_alias_overrides_legacy_persisted_default_without_rewriting_old_answers(currency_actor, comparison_data):
    actor = currency_actor; data = save(actor, comparison_data); t = thread(actor, data)
    first = ok(message(actor, t, text='2024-Q4 revenue year over year'), 201)['message']
    # Model an old saved QoQ question that the previous parser resolved as YoY.
    legacy = deepcopy(first['payload']); legacy['question'] = '2024-Q4 QoQ revenue growth'
    legacy['response']['context']['question_scope']['comparison_explicit'] = False
    legacy['response']['context']['question_scope'].pop('unsupported_currency')
    with actor.client.app.state.store.transaction() as db:
        db.execute('UPDATE copilot_messages SET payload=? WHERE id=?', (encode(legacy), first['id']))
    current = ok(message(actor, t, text='那QoQ呢', version=2, key='legacy-explicit-qoq'), 201)['message']
    result = current['payload']['response']
    assert scope_of(result)['comparison'] == 'previous' and result['facts'][0]['value'] == pytest.approx(.25)
    stored = ok(actor.get('/services/threads/' + t['id']))['messages']
    assert next(row for row in stored if row['id'] == first['id'])['payload'] == legacy
    assert ok(trace(actor, t, first))['facts'][0]['value'] == pytest.approx(1.5)


def test_explicit_currency_refusal_also_applies_after_a_legacy_cny_answer(currency_actor, comparison_data):
    actor = currency_actor; data = save(actor, comparison_data); t = thread(actor, data)
    first = ok(message(actor, t, text='2024-Q4人民币收入'), 201)['message']
    legacy = deepcopy(first['payload']); legacy['question'] = '2024-Q4美元收入'
    legacy['response']['context']['question_scope'].pop('unsupported_currency')
    with actor.client.app.state.store.transaction() as db:
        db.execute('UPDATE copilot_messages SET payload=? WHERE id=?', (encode(legacy), first['id']))
    result = ok(message(actor, t, text='继续看美元收入', version=2, key='legacy-foreign-currency'), 201)['message']['payload']['response']
    assert scope_of(result)['unsupported_currency'] and result['facts'] == []
    assert not scope_of(result)['can_calculate'] and '人民币数值替代所问币种' in result['answer']
    stored = ok(actor.get('/services/threads/' + t['id']))['messages']
    assert next(row for row in stored if row['id'] == first['id'])['payload'] == legacy


def test_scoped_followup_keeps_missing_baseline_after_dataset_revision(currency_actor, comparison_data):
    actor = currency_actor; data = save(actor, comparison_data); t = thread(actor, data)
    first = ok(message(actor, t, text='2024-Q4 QoQ revenue growth'), 201)['message']
    body = editable(data)
    body['periods'] = [row for row in body['periods'] if row['period'] != '2024-Q3']
    ok(actor.put('/datasets/' + data['id'], json=body))
    result = ok(message(actor, t, text='继续展开', version=2, key='missing-baseline-followup'), 201)['message']['payload']['response']
    assert (scope_of(result)['period'], scope_of(result)['comparison']) == ('2024-Q4', 'previous')
    rate = result['facts'][0]
    assert rate['value'] is None and rate['comparison']['status'] == 'missing_baseline'
    assert rate['comparison']['period'] == '2024-Q3'
    stored = ok(actor.get('/services/threads/' + t['id']))['messages']
    assert next(row for row in stored if row['id'] == first['id'])['payload'] == first['payload']
