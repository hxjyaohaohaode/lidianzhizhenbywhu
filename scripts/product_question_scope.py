"""Bounded question-scope journey, prepared for reviewed native CI integration.

Importing launches nothing. All mutations use the existing visible UI helpers;
GETs only corroborate the actual native responses and rendered saved messages.
This is four representative questions, not native coverage of the API matrix.
No runner, budget, retry, workflow, application or formula changes belong here.
"""
from copy import deepcopy
from pathlib import Path
import math
import re
from urllib.parse import urlsplit

try:
    from .product_browser_audit import FORM_TIMEOUT_MS, FIXTURE_COMPANY, FIXTURE_QUARTERS, number_text
    from .product_first_use_audit import require_native_contract, canonical_hash
    from .product_integrity_outcomes import _capture_response
    from .product_readout_oracles import observe_text_by_normal_scroll
except ImportError:
    from product_browser_audit import FORM_TIMEOUT_MS, FIXTURE_COMPANY, FIXTURE_QUARTERS, number_text
    from product_first_use_audit import require_native_contract, canonical_hash
    from product_integrity_outcomes import _capture_response
    from product_readout_oracles import observe_text_by_normal_scroll

PERIOD = '2024-Q2'
BASELINE_PERIOD = '2024-Q1'
NEXT_PERIODS = ['2024-Q3', '2024-Q4']
IDENTITY_NAME = '合成范围核查 · 聚焦要点'
IDENTITY_FORM = 'form[data-service-form="identity"]'
QUESTIONS = (
    PERIOD + ' 收入、成本、净利润、毛利率 环比',
    PERIOD + ' forecast cost',
    PERIOD + ' forecast net profit',
    PERIOD + ' forecast revenue and cost',
)
# Fixed synthetic expectations; do not import the production financial engine.
EXPECTED = {
    'revenue': ('营业收入', 100000, 'CNY'),
    'cost': ('营业成本', 80000, 'CNY'),
    'net_profit': ('净利润', 5000, 'CNY'),
    'gross_margin': ('毛利率', .2, 'ratio'),
}


def expect_fixture(dataset):
    body = dataset['payload']
    assert body['company'] == FIXTURE_COMPANY and dataset['version'] == 1
    assert body['currency'] == 'CNY' and body['amount_unit'] == 'yuan'
    assert body['period_basis'] == 'standalone_quarter'
    assert body['source_kind'] == 'user_provided' and body['source_url'] == ''
    assert body['verification'] == 'unverified_user_input'
    assert [row['period'] for row in body['periods']] == FIXTURE_QUARTERS
    assert all((row['revenue'], row['cost'], row['net_profit']) == (100000, 80000, 5000)
               for row in body['periods'])
    assert dataset['content_hash'] == canonical_hash(body)


def expect_identity(identity, dataset_id):
    body = identity['payload']
    assert identity['version'] == 1 and body['name'] == IDENTITY_NAME
    assert body['depth'] == 'concise' and body['output_style'] == 'evidence_first'
    assert body['dataset_ids'] == [dataset_id]
    assert body['allow_external'] is False and body['max_calls'] == 0
    assert body['include_shared_memory'] is False


def expect_four_facts(response, dataset, *, trace=False):
    scope = response['question_scope'] if trace else response['context']['question_scope']
    facts = response['facts']
    assert len(facts) == 4 and {f['id'] for f in facts} == set(EXPECTED)
    assert [f['id'] for f in facts] == scope['topics']
    assert scope['period'] == PERIOD and scope['comparison'] == 'previous' and scope['can_calculate']
    assert response['external_calls'] == 0
    for fact in facts:
        label, value, unit = EXPECTED[fact['id']]
        assert fact['label'] == label and math.isclose(fact['value'], value, abs_tol=1e-10)
        assert fact['period'] == PERIOD and fact['dataset_version'] == dataset['version']
        assert fact['input_hash'] == dataset['content_hash'] and fact['formula'] and fact['inputs']
        assert all(item['path'].startswith('periods/' + PERIOD + '/') for item in fact['inputs'])
        if not trace:
            assert fact['unit'] == unit and fact['dataset_id'] == dataset['id']
            assert label + '为' + fact['display_value'] in response['answer']
        sources = [('revenue', 100000), ('cost', 80000)] if fact['id'] == 'gross_margin' else [(fact['id'], value)]
        assert [(i['path'], i['value']) for i in fact['inputs']] == [
            ('periods/' + PERIOD + '/' + name, amount) for name, amount in sources]
        if not trace:
            assert all(i['unit'] == 'CNY' for i in fact['inputs'])
        expect_fact_comparison(fact)


def expect_fact_comparison(fact):
    comparison = fact['comparison']
    _, baseline, unit = EXPECTED[fact['id']]
    assert comparison['kind'] == 'previous' and comparison['period'] == BASELINE_PERIOD
    assert comparison['operation'] == 'difference' and comparison['status'] == 'available'
    assert comparison['reason'] == ''
    assert math.isclose(comparison['value'], baseline, rel_tol=0, abs_tol=1e-10)
    assert comparison['change'] == 0
    assert comparison['change_unit'] == ('ratio_points' if unit == 'ratio' else 'CNY')


def expect_comparison_readout(text, metric):
    """Read the existing formatter's comparison period and dimensional change."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    assert len(lines) == 2 and '环比' in lines[0] and BASELINE_PERIOD in lines[0]
    unit = '个百分点' if EXPECTED[metric][2] == 'ratio' else '元'
    assert re.fullmatch(r'[+-]?0(?:\.0+)?\s+' + unit, lines[1]), (
        'The requested quarter comparison must visibly show zero with the correct difference unit.')


def forecast_data(response):
    cards = [c['data'] for c in response['cards'] if c['kind'] == 'forecast']
    assert len(cards) == 1, 'Exactly one forecast outcome is required.'
    return cards[0]


def expect_forecast(response, topics, *, blocked=False):
    scope = response['context']['question_scope']
    assert scope['period'] == PERIOD and scope['topics'] == topics and scope['can_calculate']
    assert response['external_calls'] == 0
    card = forecast_data(response)
    receipts = [r for r in response['receipts'] if r['tool'] == 'forecast_baselines']
    assert len(receipts) == 1 and receipts[0]['input']['requested_metric_ids'] == topics
    receipt = receipts[0]
    if blocked:
        assert card['status'] == receipt['state'] == 'blocked'
        assert 'forecast' not in card and not card.get('history')
        assert not card.get('metric') and receipt['input']['metric'] is None
        reason = card['reason']
        assert reason and '预测' in reason and '不会用其他指标替代' in reason
        assert all(EXPECTED[topic][0] in reason for topic in topics)
        assert reason in response['answer'] and reason in response['warnings']
    else:
        assert receipt['state'] == 'succeeded' and receipt['input']['metric'] == 'cost'
        assert card['metric'] == 'cost' and card['train_end'] == PERIOD
        assert [v['period'] for v in card['history']] == FIXTURE_QUARTERS[:10]
        assert all(v['value'] == 80000 for v in card['history'])
        assert [v['period'] for v in card['forecast']] == NEXT_PERIODS
        assert all(math.isclose(v['value'], 80000, abs_tol=1e-8) for v in card['forecast'])
    return card


def expect_saved_messages(snapshot, messages):
    # The read endpoint intentionally exposes only these three message fields.
    expected = [{key: row[key] for key in ('id', 'payload', 'created_at')} for row in messages]
    assert snapshot['messages'] == expected, 'Saved message identity/content/order changed.'
    assert snapshot['proposals'] == [] and snapshot['runs'] == []
    assert all(m['payload']['response']['external_calls'] == 0 for m in snapshot['messages'])


def expect_cost_readout(text, headers, rows):
    """Closed human-readable card, independent of hidden technical JSON."""
    assert '营业成本 · 万元' in text
    assert re.search('历史输入截至[：: ]*' + re.escape(PERIOD), text), (
        'Forecast card lacks a labelled input/train-end quarter; hidden JSON is not a pass.')
    assert headers == ['期间', '基线点估计']
    assert len(rows) == 2 and [r[0] for r in rows] == NEXT_PERIODS
    assert all(len(row) == 2 and number_text(row[1]) == 8 for row in rows)


def expect_unchanged(current, original):
    assert current == original, 'Saved entity changed after read/reload/relogin.'


def _bootstrap(p):
    # Capture the actual visible file-import commit without replacing bootstrap.
    commits = []
    def capture(response):
        if response.request.method == 'POST' and re.fullmatch(
                r'/api/workspace/imports/[^/]+/commit', urlsplit(response.url).path):
            commits.append(response)
    p.page.on('response', capture)
    try:
        p.bootstrap()
    finally:
        p.page.remove_listener('response', capture)
    assert len(commits) == 1 and commits[0].status == 201
    dataset = commits[0].json()
    assert dataset == p.get('/api/datasets/' + p.dataset_id)
    expect_fixture(dataset)
    p.record_artifact(Path(p.directory) / 'synthetic-financial-input.csv', kind='synthetic-input')
    p.observations.setdefault('native_responses', []).append({
        'method': 'POST', 'path': urlsplit(commits[0].url).path, 'status': 201})
    return dataset


def _create_identity(p):
    p.navigate('services')
    p.click('#main [data-x-action="identity-new"]', after=IDENTITY_FORM)
    p.fill(IDENTITY_FORM + ' [name="name"]', IDENTITY_NAME)
    p.select(IDENTITY_FORM + ' [name="depth"]', 'concise')
    p.select(IDENTITY_FORM + ' [name="output_style"]', 'evidence_first')
    p.fill(IDENTITY_FORM + ' [name="max_calls"]', '0')
    def scope():
        p.visible(IDENTITY_FORM + ' [name="dataset_ids"][value="' + p.dataset_id + '"]').check()
        p.visible(IDENTITY_FORM + ' [name="include_shared_memory"]').uncheck()
        assert not p.visible(IDENTITY_FORM + ' [name="allow_external"]').is_checked()
    p.step('选择唯一合成企业、禁用共享记忆并核对外发未获许可', scope)
    status, identity = _capture_response(p, 'POST', '/api/services/identities',
        lambda: p.submit(IDENTITY_FORM, after='#main .identity-card'))
    assert status == 201
    expect_identity(identity, p.dataset_id)
    assert p.get('/api/services/identities')['items'] == [identity]
    p.click('#main [data-x-action="identity-use"][data-id="' + identity['id'] + '"]',
            after='#main .identity-card.selected', label='实际启用聚焦要点的本地服务身份')
    assert p.visible('#active-identity').input_value() == identity['id']
    return identity


def _ask(p, question, thread_id=None):
    # The first thread is created by sending through the composer. Its unknown
    # ID must come from the observed native response, never an API setup write.
    if thread_id:
        holder = []
        status, body = _capture_response(p, 'POST', '/api/services/threads/' + thread_id + '/messages',
            lambda: holder.append(p.ask(question)))
        turn = holder[0]
    else:
        with p.page.expect_response(lambda r: r.request.method == 'POST' and bool(re.fullmatch(
                r'/api/services/threads/[^/]+/messages', urlsplit(r.url).path)), timeout=FORM_TIMEOUT_MS) as event:
            turn = p.ask(question)
        response = event.value
        status, body = response.status, response.json()
        p.observations.setdefault('native_responses', []).append({
            'method': 'POST', 'path': urlsplit(response.url).path, 'status': status})
    assert status == 201 and body['replayed'] is False
    message = body['message']
    assert turn.get_attribute('data-message') == message['id']
    assert message['payload']['question'] == question
    assert message['thread_id'] == body['thread']['id']
    if thread_id:
        assert body['thread']['id'] == thread_id
    p.observations.setdefault('question_scope_messages', []).append(
        {key: deepcopy(message[key]) for key in ('id', 'payload', 'created_at')})
    return turn, message, body['thread']


def _read_facts(p, turn, *, trace=False, observe=True):
    tiles = turn.locator('.trace-container .assistant-fact' if trace else '.fact-grid .fact-tile')
    assert tiles.count() == 4
    for key, (label, raw, unit) in EXPECTED.items():
        tile = tiles.filter(has=p.page.get_by_text(label, exact=True))
        assert tile.count() == 1
        value = tile.locator('.assistant-fact-head > strong' if trace else ':scope > strong')
        text = value.inner_text()
        assert number_text(text) == (20 if key == 'gross_margin' else raw)
        assert ('%' in text if unit == 'ratio' else '元' in text and '万元' not in text)
        period = tile.locator(':scope > small').inner_text()
        assert period.startswith(PERIOD + ' · ')
        comparison = tile.locator(':scope > .fact-comparison')
        assert comparison.count() == 1
        expect_comparison_readout(comparison.inner_text(), key)
        # One range includes the actual requested comparison without adding
        # another screenshot/wait cycle to the existing bounded journey.
        if observe:
            observe_text_by_normal_scroll(p, tile, label + text + period + comparison.text_content(),
                ('原消息追踪' if trace else '聚焦回答') + '中的' + label + '、原季度及环比基期与变化单位实际可读')


def _read_forecast(p, turn, card, *, blocked=False, observe=True):
    visible = turn.locator('[data-card-kind="forecast"]')
    assert visible.count() == 1 and visible.locator('details[open]').count() == 0
    if observe:
        jump = turn.get_by_role('button', name='查看预测结果', exact=True)
        p.step('用本条原答复的实际按钮定位预测结果', lambda: jump.click())
    if blocked:
        assert visible.locator('table').count() == 0, 'Refusal must not show substituted forecast points.'
        reason = card['reason']
        if observe:
            observe_text_by_normal_scroll(p, visible.get_by_text(reason, exact=True), reason, '本条预测明确说明拒绝原因且无预测点')
        assert reason in turn.locator('.research-answer').inner_text()
    else:
        unit = visible.locator(':scope > p > strong')
        rows = visible.locator('table tbody tr')
        headers = visible.locator('table thead th').all_text_contents()
        expect_cost_readout(visible.inner_text(), headers,
            [rows.nth(i).locator('td').all_text_contents() for i in range(rows.count())])
        train_end = visible.locator(':scope > p').filter(has_text=re.compile('历史输入截至[：: ]*' + PERIOD))
        assert train_end.count() == 1
        if observe:
            observe_text_by_normal_scroll(p, unit, '营业成本 · 万元', '英文成本预测明确标注成本与万元')
            observe_text_by_normal_scroll(p, train_end, train_end.inner_text(), '预测卡直接说明原输入截止季度')
            observe_text_by_normal_scroll(p, visible.locator('table thead'), '期间基线点估计', '预测表明确区分基线点估计与已保存实际成本')
            for index, period in enumerate(NEXT_PERIODS):
                observe_text_by_normal_scroll(p, rows.nth(index), period + rows.nth(index).locator('td').nth(1).inner_text(),
                    '成本基线' + period + '实际为8万元，独立于10万元收入')


def _read_restored(p, messages):
    p.page.locator('#assistant-answer .chat-turn').last.wait_for(state='visible', timeout=FORM_TIMEOUT_MS)
    turns = p.page.locator('#assistant-answer .chat-turn')
    assert turns.count() == len(messages)
    for index, message in enumerate(messages):
        turn = turns.nth(index)
        assert turn.get_attribute('data-message') == message['id']
        assert turn.locator('.user-message p').inner_text() == message['payload']['question']
        assert turn.locator('.research-answer').inner_text() == message['payload']['response']['answer']
    # The initial pass captures every metric and forecast cell in view. Reloads
    # reread the same rendered values without repeating every screenshot pair.
    _read_facts(p, turns.nth(0), observe=False)
    for index in range(1, 4):
        _read_forecast(p, turns.nth(index), forecast_data(messages[index]['payload']['response']),
            blocked=index > 1, observe=False)
    for index in (0, 3):
        question = messages[index]['payload']['question']
        observe_text_by_normal_scroll(p, turns.nth(index).locator('.user-message p'), question,
            '重载或重登录后，同一消息标识的原问题实际可读')


def question_scope_journey(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    """One native scenario; caller retains the existing 300-second outer budget."""
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir,
        expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    dataset = _bootstrap(p)
    owner = p.get('/api/auth/me')['user']
    identity = _create_identity(p)
    p.navigate('copilot')
    assert IDENTITY_NAME in p.visible('.copilot-context').inner_text()
    messages = []
    turn, message, thread = _ask(p, QUESTIONS[0])
    messages.append(message)
    expect_four_facts(message['payload']['response'], dataset)
    assert message['payload']['response']['context']['identity']['depth'] == 'concise'
    _read_facts(p, turn)
    path = '/api/services/threads/' + thread['id']
    trace_path = path + '/messages/' + message['id'] + '/trace'
    status, trace = _capture_response(p, 'GET', trace_path, lambda: p.click(
        '[data-message="' + message['id'] + '"] [data-x-action="chat-trace"]',
        after='[data-message="' + message['id'] + '"] .trace-container .assistant-reply'))
    p.observations['question_scope_trace'] = deepcopy(trace)
    assert status == 200 and trace['source_message_id'] == message['id'] and trace['source_thread_id'] == thread['id']
    expect_four_facts(trace, dataset, trace=True)
    _read_facts(p, turn, trace=True)
    expect_saved_messages(p.get(path), messages)
    for index, topics in enumerate((['cost'], ['net_profit'], ['revenue', 'cost']), 1):
        turn, message, thread = _ask(p, QUESTIONS[index], thread['id'])
        messages.append(message)
        card = expect_forecast(message['payload']['response'], topics, blocked=index > 1)
        _read_forecast(p, turn, card, blocked=index > 1)
    original = deepcopy(p.get(path))
    expect_saved_messages(original, messages)
    assert original['thread'] == thread
    assert thread['payload']['identity_id'] == identity['id'] and thread['payload']['dataset_id'] == dataset['id']
    assert all(m['payload']['response']['context']['identity']['id'] == identity['id'] for m in messages)
    p.step('真实重载页面并找回同一身份的四条已保存问题', lambda: p.page.reload(wait_until='domcontentloaded'))
    p.visible('#assistant-form')
    assert p.visible('#active-identity').input_value() == identity['id']
    _read_restored(p, messages)
    expect_unchanged(p.get(path), original)
    p.click('#sidebar [data-action="logout"]', after='#auth-form', label='退出再登录，核对持久化消息而非页面内存')
    if p.page.locator('#auth-form [name="name"]').count():
        p.click('[data-action="auth-toggle"]', after='#auth-form')
    p.fill('#auth-form [name="email"]', owner['email'])
    p.fill('#auth-form [name="password"]', 'Synthetic-only-audit-password-2026', '重新登录同一合成账号')
    p.submit('#auth-form', after='#main')
    p.select('#active-identity', identity['id'], '在实际身份选择器中找回原服务身份')
    p.navigate('copilot')
    _read_restored(p, messages)
    expect_unchanged(p.get(path), original)
    expect_unchanged(p.get('/api/datasets/' + p.dataset_id), dataset)
    expect_unchanged(p.get('/api/services/identities')['items'], [identity])
    expect_unchanged(p.get('/api/services/threads?identity_id=' + identity['id'] + '&dataset_id=' + p.dataset_id)['items'], [thread])
    assert p.get('/api/services/threads')['items'] == []
    assert p.get('/api/runs')['items'] == [] and p.get('/api/workspace/plans')['items'] == []
    assert not any(row['configured'] for row in p.get('/api/capabilities')['providers'])
    expect_saved_messages(p.get(path), messages)
    p.observations['question_scope_outcome'] = {
        'dataset_id': dataset['id'], 'identity_id': identity['id'], 'thread_id': thread['id'],
        'message_ids': [m['id'] for m in messages], 'questions': list(QUESTIONS),
        'explicit_fact_count': 4, 'scope_period': PERIOD, 'forecast_metric': 'cost',
        'forecast_periods': NEXT_PERIODS, 'forecast_yuan_per_quarter': 80000,
        'blocked_forecasts': ['net_profit', 'revenue+cost'], 'saved_trace_message_id': messages[0]['id'],
        'reload_and_relogin_unchanged': True, 'runs': 0, 'plans': 0, 'external_calls': 0,
        'coverage': 'four native questions; excludes the API thirteen-metric matrix',
    }
