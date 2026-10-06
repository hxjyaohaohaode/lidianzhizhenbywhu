"""Pure oracles plus one isolated in-process API contract; no native UI claim."""
from copy import deepcopy
from types import SimpleNamespace
import pytest

from scripts.product_first_use_audit import HarnessContractError, canonical_hash
from scripts.product_question_scope import (
    BASELINE_PERIOD, EXPECTED, FIXTURE_COMPANY, FIXTURE_QUARTERS, IDENTITY_NAME, NEXT_PERIODS, PERIOD, QUESTIONS,
    expect_cost_readout, expect_fixture, expect_forecast, expect_four_facts,
    expect_identity, expect_saved_messages, expect_unchanged, question_scope_journey,
    expect_fact_comparison, expect_comparison_readout,
)


def dataset():
    body = {'company': FIXTURE_COMPANY, 'currency': 'CNY', 'amount_unit': 'yuan',
        'period_basis': 'standalone_quarter', 'source_kind': 'user_provided', 'source_url': '',
        'verification': 'unverified_user_input', 'periods': [
            {'period': p, 'revenue': 100000, 'cost': 80000, 'net_profit': 5000} for p in FIXTURE_QUARTERS]}
    return {'id': 'data', 'version': 1, 'payload': body, 'content_hash': canonical_hash(body)}


def four():
    d = dataset()
    facts = []
    for key, (label, value, unit) in EXPECTED.items():
        inputs = [('revenue', 100000), ('cost', 80000)] if key == 'gross_margin' else [(key, value)]
        facts.append({'id': key, 'label': label, 'value': value, 'unit': unit, 'period': PERIOD,
            'dataset_id': d['id'], 'dataset_version': 1, 'input_hash': d['content_hash'],
            'formula': 'reviewed formula', 'display_value': str(value),
            'comparison': {'kind': 'previous', 'period': BASELINE_PERIOD, 'operation': 'difference',
                'value': value, 'change': 0, 'change_unit': 'ratio_points' if unit == 'ratio' else 'CNY',
                'status': 'available', 'reason': ''},
            'inputs': [{'path': 'periods/' + PERIOD + '/' + k, 'value': v, 'unit': 'CNY'} for k, v in inputs]})
    return {'context': {'question_scope': {'topics': list(EXPECTED), 'period': PERIOD,
        'comparison': 'previous', 'can_calculate': True}}, 'facts': facts, 'external_calls': 0,
        'answer': '；'.join(f['label'] + '为' + f['display_value'] for f in facts)}


def forecast(topics=None, *, blocked=False):
    topics = topics or ['cost']
    reason = '本次预测范围（' + '、'.join(EXPECTED[k][0] for k in topics) + '）不受支持，不会用其他指标替代'
    card = {'status': 'blocked', 'reason': reason} if blocked else {
        'metric': 'cost', 'train_end': PERIOD,
        'history': [{'period': p, 'value': 80000} for p in FIXTURE_QUARTERS[:10]],
        'forecast': [{'period': p, 'value': 80000} for p in NEXT_PERIODS]}
    return {'context': {'question_scope': {'topics': topics, 'period': PERIOD, 'can_calculate': True}},
        'external_calls': 0, 'cards': [{'kind': 'forecast', 'data': card}],
        'receipts': [{'tool': 'forecast_baselines', 'state': 'blocked' if blocked else 'succeeded',
            'input': {'requested_metric_ids': topics, 'metric': None if blocked else 'cost'}}],
        'answer': reason if blocked else 'cost forecast', 'warnings': [reason] if blocked else []}


def test_local_entry_stops_before_bootstrap(tmp_path, monkeypatch):
    monkeypatch.delenv('GITHUB_ACTIONS', raising=False)
    with pytest.raises(HarnessContractError, match='Local browser execution is restricted'):
        question_scope_journey(SimpleNamespace(), repository_root=tmp_path, data_dir=tmp_path,
            expected_web_tree='a' * 40, expected_server_tree='b' * 40)


def test_exact_distinct_synthetic_import_is_required():
    d = dataset()
    expect_fixture(d)
    for field in ('revenue', 'cost', 'net_profit'):
        broken = deepcopy(d)
        broken['payload']['periods'][0][field] = 10
        broken['content_hash'] = canonical_hash(broken['payload'])
        with pytest.raises(AssertionError):
            expect_fixture(broken)
    d['payload']['periods'].pop()
    with pytest.raises(AssertionError):
        expect_fixture(d)


@pytest.mark.parametrize('key,value', [('depth', 'balanced'), ('max_calls', 1), ('allow_external', True),
    ('include_shared_memory', True), ('dataset_ids', []), ('output_style', 'actionable')])
def test_actual_identity_must_be_concise_and_have_zero_external_permission(key, value):
    identity = {'version': 1, 'payload': {'name': IDENTITY_NAME, 'depth': 'concise',
        'output_style': 'evidence_first', 'dataset_ids': ['data'], 'allow_external': False,
        'max_calls': 0, 'include_shared_memory': False}}
    expect_identity(identity, 'data')
    identity['payload'][key] = value
    with pytest.raises(AssertionError):
        expect_identity(identity, 'data')


def test_four_explicit_facts_and_saved_trace_accept_same_source_values():
    reply = four()
    expect_four_facts(reply, dataset())
    traced = deepcopy(reply)
    traced['question_scope'] = traced.pop('context')['question_scope']
    for fact in traced['facts']:
        fact.pop('unit')
        for item in fact['inputs']:
            item.pop('unit')  # Existing trace API has no input-unit field.
    expect_four_facts(traced, dataset(), trace=True)


@pytest.mark.parametrize('damage', ['truncate', 'duplicate', 'quarter', 'net_profit', 'units',
    'source', 'source_value', 'prose', 'external'])
def test_four_fact_oracle_rejects_scope_truncation_and_substitution(damage):
    reply = four()
    net = next(f for f in reply['facts'] if f['id'] == 'net_profit')
    if damage == 'truncate': reply['facts'].pop()
    elif damage == 'duplicate': reply['facts'][-1] = deepcopy(reply['facts'][0])
    elif damage == 'quarter': net['period'] = '2024-Q4'
    elif damage == 'net_profit': net['value'] = 100000
    elif damage == 'units': net['inputs'][0]['unit'] = 'wan'
    elif damage == 'source': net['inputs'][0]['path'] = 'periods/' + PERIOD + '/revenue'
    elif damage == 'source_value': net['inputs'][0]['value'] = 100000
    elif damage == 'prose': reply['answer'] = '营业收入为100000'
    else: reply['external_calls'] = 1
    with pytest.raises(AssertionError):
        expect_four_facts(reply, dataset())


@pytest.mark.parametrize('damage', ['metric', 'point', 'quarter', 'train_end', 'history', 'receipt'])
def test_cost_forecast_oracle_rejects_revenue_default_and_future_leakage(damage):
    reply = forecast()
    expect_forecast(reply, ['cost'])
    card = reply['cards'][0]['data']
    if damage == 'metric': card['metric'] = 'revenue'
    elif damage == 'point': card['forecast'][0]['value'] = 100000
    elif damage == 'quarter': card['forecast'][0]['period'] = '2025-Q1'
    elif damage == 'train_end': card['train_end'] = '2024-Q4'
    elif damage == 'history': card['history'].append({'period': '2024-Q3', 'value': 80000})
    else: reply['receipts'][0]['input']['metric'] = 'revenue'
    with pytest.raises(AssertionError):
        expect_forecast(reply, ['cost'])


@pytest.mark.parametrize('topics', [['net_profit'], ['revenue', 'cost']])
@pytest.mark.parametrize('damage', ['points', 'metric', 'receipt', 'prose', 'reason'])
def test_refusals_cannot_hide_substituted_points_or_unreadable_reason(topics, damage):
    reply = forecast(topics, blocked=True)
    expect_forecast(reply, topics, blocked=True)
    card = reply['cards'][0]['data']
    if damage == 'points': card['forecast'] = [{'period': '2024-Q3', 'value': 100000}]
    elif damage == 'metric': card['metric'] = 'revenue'
    elif damage == 'receipt': reply['receipts'][0]['input']['metric'] = 'revenue'
    elif damage == 'prose': reply['answer'] = '预测成功'
    else: card['reason'] = 'blocked'
    with pytest.raises(AssertionError):
        expect_forecast(reply, topics, blocked=True)


@pytest.mark.parametrize('damage', ['missing_train_end', 'actual_header', 'revenue_label', 'ten_wan', 'wrong_period'])
def test_readable_cost_card_needs_train_end_forecast_periods_and_baseline_unit(damage):
    text = '营业成本 · 万元\n历史输入截至：2024-Q2'
    headers = ['期间', '基线点估计']
    rows = [['2024-Q3', '8'], ['2024-Q4', '8']]
    expect_cost_readout(text, headers, rows)
    if damage == 'missing_train_end': text = '营业成本 · 万元'
    elif damage == 'actual_header': headers[1] = '已保存实际成本'
    elif damage == 'revenue_label': text = text.replace('营业成本', '营业收入')
    elif damage == 'ten_wan': rows[0][1] = '10'
    else: rows[0][0] = '2025-Q1'
    with pytest.raises(AssertionError):
        expect_cost_readout(text, headers, rows)


@pytest.mark.parametrize('damage', ['id', 'question', 'response', 'order', 'proposal', 'run', 'external'])
def test_saved_history_preserves_exact_questions_responses_ids_and_order(damage):
    messages = [{'id': str(i), 'created_at': 'time-' + str(i),
        'payload': {'question': 'question-' + str(i), 'response': four()}} for i in range(2)]
    snapshot = {'messages': deepcopy(messages), 'proposals': [], 'runs': []}
    expect_saved_messages(snapshot, messages)
    if damage == 'id': snapshot['messages'][0]['id'] = 'replacement'
    elif damage == 'question': snapshot['messages'][0]['payload']['question'] = 'new'
    elif damage == 'response': snapshot['messages'][0]['payload']['response']['facts'].pop()
    elif damage == 'order': snapshot['messages'].reverse()
    elif damage == 'proposal': snapshot['proposals'].append({'id': 'new'})
    elif damage == 'run': snapshot['runs'].append({'id': 'new'})
    else: snapshot['messages'][0]['payload']['response']['external_calls'] = 1
    with pytest.raises(AssertionError):
        expect_saved_messages(snapshot, messages)
    with pytest.raises(AssertionError, match='Saved entity changed'):
        expect_unchanged(snapshot, {'messages': messages, 'proposals': [], 'runs': []})


@pytest.mark.parametrize('metric', list(EXPECTED))
@pytest.mark.parametrize('field,value', [
    ('kind', 'year_over_year'), ('period', '2023-Q2'), ('operation', 'growth_rate'),
    ('value', 7), ('change', .01), ('change_unit', 'ratio'), ('status', 'missing_input'),
])
def test_requested_comparison_rejects_wrong_baseline_operation_and_units(metric, field, value):
    reply = four()
    fact = next(f for f in reply['facts'] if f['id'] == metric)
    expect_fact_comparison(fact)
    fact['comparison'][field] = value
    with pytest.raises(AssertionError):
        expect_four_facts(reply, dataset())
    reply['question_scope'] = reply.pop('context')['question_scope']
    with pytest.raises(AssertionError):
        expect_four_facts(reply, dataset(), trace=True)


@pytest.mark.parametrize('metric', list(EXPECTED))
def test_comparison_readout_accepts_existing_formatter_without_exact_prose(metric):
    unit = '个百分点' if metric == 'gross_margin' else '元'
    expect_comparison_readout('环比 · 2024-Q1\n0 ' + unit, metric)
    expect_comparison_readout('环比 基期 2024-Q1\n+0.00 ' + unit, metric)


@pytest.mark.parametrize('metric,text', [
    ('cost', '同比 · 2024-Q1\n0 元'), ('cost', '环比 · 2023-Q2\n0 元'),
    ('cost', '环比 · 2024-Q1\n1 元'), ('cost', '环比 · 2024-Q1\n0 %'),
    ('cost', '环比 · 2024-Q1\n0 万元'), ('net_profit', '环比 · 2024-Q1'),
    ('gross_margin', '环比 · 2024-Q1\n0 %'), ('gross_margin', '环比 · 2024-Q1\n0 元'),
    ('gross_margin', '环比 · 2024-Q1\n0.2 个百分点'),
])
def test_comparison_readout_rejects_missing_or_substituted_comparison(metric, text):
    with pytest.raises(AssertionError):
        expect_comparison_readout(text, metric)


@pytest.fixture
def offline_oracle(tmp_path):
    from in_process_oracle import offline_test_client
    from server.app import make_app
    from server.config import Settings

    def build_app(providers):
        return make_app(Settings(data_dir=tmp_path, origin='http://testserver'),
                        providers=providers, worker_enabled=False)

    with offline_test_client(build_app) as oracle:
        yield oracle


def test_oracles_match_actual_staged_csv_messages_and_trace_in_process(offline_oracle):
    """Schema compatibility only: API setup here is never native UI evidence."""
    from conftest import Actor
    from test_services import ok

    client, providers, network_attempts = offline_oracle
    actor = Actor(client)
    assert ok(actor.get('/datasets'))['items'] == []
    # Same twelve-quarter CSV, column order, units and values as Probe.bootstrap.
    csv = '季度,营业收入,营业成本,经营现金流,净利润,总资产,总负债,期末净资产,期初净资产,库存金额,研发费用\n'
    csv += ''.join(p + ',100000,80000,10000,5000,500000,200000,300000,300000,20000,3000\n'
                   for p in FIXTURE_QUARTERS)
    staged = ok(actor.post('/workspace/imports/file', data={
        'company': FIXTURE_COMPANY, 'amount_unit': 'yuan', 'basis': 'standalone_quarter',
        'target_id': '', 'target_version': '0', 'merge_mode': 'replace'},
        files={'file': ('synthetic-financial-input.csv', csv.encode('utf-8-sig'), 'text/csv')}), 201)
    assert ok(actor.get('/datasets'))['items'] == []
    saved = ok(actor.post('/workspace/imports/' + staged['id'] + '/commit', json={
        'version': staged['version'], 'fingerprint': staged['payload']['fingerprint']}), 201)
    expect_fixture(saved)
    profile = ok(actor.post('/services/identities', json={
        'name': IDENTITY_NAME, 'perspective': 'operator', 'objective': '', 'depth': 'concise',
        'output_style': 'evidence_first', 'dataset_ids': [saved['id']], 'include_shared_memory': False,
        'allow_external': False, 'max_calls': 0, 'version': 0}), 201)
    expect_identity(profile, saved['id'])
    conversation = ok(actor.post('/services/threads', json={
        'identity_id': profile['id'], 'dataset_id': saved['id'], 'title': '新的研究',
        'request_id': 'oracle-native-shape-thread'}), 201)
    path = '/services/threads/' + conversation['id']
    messages = []
    for index, question in enumerate(QUESTIONS):
        posted = ok(actor.post(path + '/messages', json={
            'text': question, 'version': conversation['version'],
            'request_id': 'oracle-native-shape-message-' + str(index)}), 201)
        assert posted['replayed'] is False
        conversation = posted['thread']
        message = posted['message']
        assert message['thread_id'] == conversation['id']
        messages.append(message)
        response = message['payload']['response']
        assert response['context']['identity']['id'] == profile['id']
        assert response['context']['identity']['depth'] == 'concise'
        if index == 0:
            expect_four_facts(response, saved)
            before_trace = ok(actor.get(path))
            trace = ok(actor.get(path + '/messages/' + message['id'] + '/trace', params={
                'identity_id': profile['id'], 'dataset_id': saved['id']}))
            assert trace['source_message_id'] == message['id'] and trace['source_thread_id'] == conversation['id']
            expect_four_facts(trace, saved, trace=True)
            expect_unchanged(ok(actor.get(path)), before_trace)
        else:
            topics = (['cost'], ['net_profit'], ['revenue', 'cost'])[index - 1]
            expect_forecast(response, topics, blocked=index > 1)
        expect_saved_messages(ok(actor.get(path)), messages)
    original = ok(actor.get(path))
    expect_unchanged(ok(actor.get(path)), original)
    expect_unchanged(original['thread'], conversation)
    expect_unchanged(ok(actor.get('/datasets/' + saved['id'])), saved)
    expect_unchanged(ok(actor.get('/services/identities'))['items'], [profile])
    assert ok(actor.get('/runs'))['items'] == [] and ok(actor.get('/workspace/plans'))['items'] == []
    assert providers.calls == [] and network_attempts == []
