"""Six reviewed routing refusals over isolated local APIs; no supplier calls."""
import pytest

from conftest import Actor
from server.providers import ProviderService
from server.question_scope import resolve_question, resolve_followup, plan_scope
from test_services import message, ok, thread
from test_workspace_api import plan


class ForbiddenProviders(ProviderService):
    async def complete(self, *args, **kwargs):
        raise AssertionError('Account subtype checks must not call a supplier')

    async def propose(self, *args, **kwargs):
        raise AssertionError('Account subtype checks must not call a planner')


@pytest.fixture
def local_actor(factory):
    return Actor(factory(providers=ForbiddenProviders()))


UNSUPPORTED = [
    '经营利润是多少', '营业利润是多少', '经营性利润', 'operating profit', 'operating income',
    '净负债率', '有息负债率', '流动负债率', '非流动负债比率', '净资产负债率',
    'net leverage', 'net debt ratio', 'interest-bearing liabilities ratio',
    '净现金流', '现金净流量', '现金流量净额', '现金流净额', 'net cash flow',
    '非经营净现金流', '非经营活动现金流量净额', '非 经营性净现金流',
    'non-operating net cash flow', 'non operating net cash flow',
    '营业外收入', '利息收入', 'non-operating income', 'non operating revenue', 'interest income',
    '融资成本', '利息成本', 'financing cost', 'finance costs', 'interest cost',
]
ANNUALIZED = ['年化净资产收益率', '年化资产周转率', 'annualized roe', 'annualized asset turnover']
REPRESENTATIVES = [
    ('经营利润是多少', 'unsupported_topic'), ('净负债率', 'unsupported_topic'),
    ('净现金流', 'unsupported_topic'), ('营业外收入', 'unsupported_topic'),
    ('融资成本', 'unsupported_topic'), ('年化净资产收益率', 'needs_clarification'),
    ('非经营净现金流', 'unsupported_topic'), ('非经营活动现金流量净额', 'unsupported_topic'),
    ('non-operating net cash flow', 'unsupported_topic'),
]


def scope_of(result):
    return result.get('question_scope') or result['context']['question_scope']


def both_answers(actor, data, query):
    workspace = ok(actor.post('/workspace/assistant', json={'dataset_id': data['id'], 'query': query}))
    service = ok(message(actor, thread(actor, data), text=query), 201)['message']['payload']['response']
    assert workspace['external_calls'] == service['external_calls'] == 0
    return workspace, service


@pytest.mark.parametrize('query', UNSUPPORTED + ANNUALIZED)
def test_account_subtypes_fail_closed_alone_mixed_and_in_followups(example, query):
    previous = resolve_question('2025-Q3收入环比', example, [])
    expected = 'needs_clarification' if query in ANNUALIZED else 'unsupported_topic'
    for wording in (query, '营业收入与' + query, query + ' and net profit'):
        scoped = resolve_question('2025-Q4 ' + wording, example, ['gross_margin', 'cash_ratio'])
        continued = resolve_followup('那' + wording + '呢', example, ['gross_margin', 'cash_ratio'], previous)
        for scope in (scoped, continued):
            assert scope['status'] == expected and not scope['can_calculate']
            assert scope['topics'] == []
            if expected == 'unsupported_topic':
                assert scope['unsupported_financial_operation']
        assert plan_scope('2025-Q4 ' + wording, example)['status'] == 'blocked'


@pytest.mark.parametrize('query,status', REPRESENTATIVES)
def test_original_review_cases_refuse_in_both_real_assistants(local_actor, query, status):
    actor = local_actor; data = actor.dataset()
    for wording in (query, '营业收入和' + query):
        for result in both_answers(actor, data, '2025-Q4 ' + wording):
            scope = scope_of(result)
            assert scope['status'] == status and not scope['can_calculate']
            assert result['facts'] == scope['topics'] == []
            assert result['answer'] == scope['notice']
    assert ok(actor.get('/datasets/' + data['id'])) == data
    assert actor.client.app.state.store.all('SELECT * FROM runs') == []


@pytest.mark.parametrize('query,status', REPRESENTATIVES)
def test_refused_followup_does_not_restore_old_facts_or_change_saved_answer(local_actor, query, status):
    actor = local_actor; data = actor.dataset(); conversation = thread(actor, data)
    first = ok(message(actor, conversation, text='2025-Q3收入环比'), 201)['message']
    result = ok(message(actor, conversation, text='那' + query + '呢', version=2,
                        key='review-subtype-followup'), 201)['message']['payload']['response']
    assert scope_of(result)['status'] == status and result['facts'] == []
    assert result['external_calls'] == 0
    saved = ok(actor.get('/services/threads/' + conversation['id']))
    assert next(row for row in saved['messages'] if row['id'] == first['id'])['payload'] == first['payload']
    assert ok(actor.get('/datasets/' + data['id'])) == data


@pytest.mark.parametrize('query,status', REPRESENTATIVES)
def test_unsupported_account_request_cannot_become_an_executable_plan(local_actor, query, status):
    actor = local_actor; data = actor.dataset()
    preview = plan(actor, data, query='2025-Q4 ' + query)
    assert preview['payload']['blockers']
    assert preview['payload']['snapshot']['research_scope']['status'] == 'blocked'
    before = actor.client.app.state.store.db.total_changes
    result = actor.post('/workspace/plans/' + preview['id'] + '/execute', json={
        'version': preview['version'], 'fingerprint': preview['payload']['fingerprint']})
    assert result.status_code == 409
    assert actor.client.app.state.store.db.total_changes == before


OPERATING_CASH = [
    '经营净现金流', '经营性净现金流', '经营性现金流量净额',
    '经营活动净现金流', '经营活动产生的净现金流',
    '经营现金净流量', '经营活动产生的现金净流量', '经营活动现金流量净额',
    '经营活动产生的现金流量净额', '经营现金流净额',
    'net operating cash flow', 'operating net cash flow',
    'net cash flow from operations', 'net cash flow from operating activities',
]


@pytest.mark.parametrize('query', OPERATING_CASH)
def test_explicit_operating_net_cash_keeps_supported_scope_without_hiding_another_net_request(example, query):
    scope = resolve_question('2025-Q4 ' + query, example, [])
    assert scope['can_calculate'] and scope['topics'] == ['cash_flow', 'cash_ratio']
    for extra in ('和净现金流', ' and net cash flow', '和非经营净现金流', ' and non-operating net cash flow'):
        mixed = resolve_question('2025-Q4 ' + query + extra, example, [])
        assert mixed['status'] == 'unsupported_topic' and mixed['topics'] == []


SUPPORTED = [
    ('营业收入', ['revenue']), ('operating revenue', ['revenue']),
    ('营业成本', ['cost']), ('operating cost', ['cost']),
    ('净利润', ['net_profit']), ('net profit', ['net_profit']),
    ('净利润率', ['net_margin']), ('net profit margin', ['net_margin']),
    ('资产负债率', ['leverage']), ('leverage', ['leverage']),
    ('总负债', ['liabilities']), ('total liabilities', ['liabilities']),
    ('研发成本率', ['rd_ratio']), ('r&d cost ratio', ['rd_ratio']),
    ('经营净现金流', ['cash_flow', 'cash_ratio']),
    ('经营性净现金流', ['cash_flow', 'cash_ratio']),
    ('经营性现金流量净额', ['cash_flow', 'cash_ratio']),
    ('net operating cash flow', ['cash_flow', 'cash_ratio']),
    ('未年化净资产收益率', ['roe']), ('非年化资产周转率', ['asset_turnover']),
    ('经营概览中的净利润', ['net_profit']),
    ('营业收入与净利润', ['revenue', 'net_profit']),
]


@pytest.mark.parametrize('query,topics', SUPPORTED)
def test_supported_bilingual_accounts_keep_exact_topics_and_formulae(local_actor, query, topics):
    actor = local_actor; data = actor.dataset()
    original = next(row for row in data['payload']['periods'] if row['period'] == '2025-Q4')
    for result in both_answers(actor, data, '2025-Q4 ' + query):
        scope = scope_of(result)
        assert scope['can_calculate'] and scope['topics'] == topics
        assert [fact['id'] for fact in result['facts']] == topics
        for fact in result['facts']:
            if fact['id'] in ('revenue', 'cost', 'net_profit', 'cash_flow', 'liabilities'):
                assert fact['value'] == original[fact['id']]
            assert fact['input_hash'] == data['content_hash']
            assert fact['period'] == '2025-Q4'
    assert ok(actor.get('/datasets/' + data['id'])) == data


def test_plain_overview_and_nonannualized_ratios_remain_unchanged(example):
    for query, topics in [('经营概览', ['gross_margin', 'cash_ratio']),
                          ('净资产收益率', ['roe']), ('资产周转率', ['asset_turnover'])]:
        scope = resolve_question('2025-Q4 ' + query, example, ['gross_margin', 'cash_ratio'])
        assert scope['can_calculate'] and scope['topics'] == topics
    mixed = resolve_question('2025-Q4未年化净资产收益率与年化资产周转率', example, [])
    assert mixed['status'] == 'needs_clarification' and not mixed['can_calculate']


@pytest.mark.parametrize('query', ['revenue and interest_cost_record', 'net profit and nonoperating_record',
                                 'cash flow and internet cash bookkeeping', 'cost refinancing_record'])
def test_compound_refusals_do_not_match_unrelated_ascii_tokens(example, query):
    assert resolve_question('2025-Q4 ' + query, example, [])['can_calculate']
