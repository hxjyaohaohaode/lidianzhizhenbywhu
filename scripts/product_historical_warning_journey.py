"""Prepared single historical-warning journey; no CLI or shared suite registration.

Only a separately reviewed hosted native caller may admit the exact legacy
fixture. Original 49 rows are declared preparation, never current UI creation.
Everything after preparation uses real controls, downloads and read-only checks.
Importing this module starts no browser, server, worker or network request.
"""
from __future__ import annotations

import json
import re
from urllib.parse import urlsplit

try:
    from .native_historical_fixture import (SCOPE, RUN_ID, PLAN_ID, DATASET_ID, EXPORT_SHA256,
        prepare_native_history, require_history_admission, require_history_environment,
        verified_closure, verify_native_history, sha256)
    from .product_first_use_audit import (require_native_contract, register_empty_workspace,
        download_visible, expect_integrity)
    from .product_integrity_outcomes import _capture_response
    from .product_question_scope import _ask
    from .product_strategy_journey import _read_groups
except ImportError:
    from native_historical_fixture import (SCOPE, RUN_ID, PLAN_ID, DATASET_ID, EXPORT_SHA256,
        prepare_native_history, require_history_admission, require_history_environment,
        verified_closure, verify_native_history, sha256)
    from product_first_use_audit import (require_native_contract, register_empty_workspace,
        download_visible, expect_integrity)
    from product_integrity_outcomes import _capture_response
    from product_question_scope import _ask
    from product_strategy_journey import _read_groups

SCENARIO = 'historical-cost-percentage-warning'
QUESTION = '2024-Q2 成本环比增长百分之多少'
COMPANY = '旧百分比计划隔离合成企业'
WARNING_TITLE = '历史问题的回答范围提示'
NOTICE = '当前问答仅支持收入增长率；其他指标的增长率、百分比变化或涨跌幅不能用原始金额、原比率或比较差额替代，请单独提问已支持的指标。'
HISTORY_NOTICE = '已保存的指标值和原答复仅供历史查阅，不能作为该问题所要求百分比的答案；原记录未改写，未重新计算。'
EXPORT_NOTICE = '下载仍为原始导出，不包含本页提示。'
VALUE_TITLE = '当时保存的指标值（未回答原问题的百分比要求）'
SOURCE_NOTICE = '本修订未保存可绑定到目标季度的原文件回执；不推测文件名或指纹。'
INPUT_NOTICE = '以下仅整理本报告冻结的问题范围、原始输入和计算结果；不代表输入已经独立核验。 本页金额展示单位：万元。'
SOURCE_ROWS = [
    ['目标季度 / 数据修订', '2024-Q2 / 1'],
    ['确认使用的文件', '当时未记录或目标季度未绑定文件'],
    ['原文件 SHA256', '当时未记录'],
    ['输入金额单位（冻结声明）', '元'],
    ['输入期间口径（冻结声明）', '当时未记录'],
    ['导入确认时间', '当时未记录'],
    ['系统保存口径', '金额归一为元；独立单季度'],
]


def expect_historical_api(audit, run, plan):
    expect_integrity(audit)
    assert audit['run'] == run and run['id'] == RUN_ID and run['state'] == 'succeeded'
    assert run['dataset_id'] == DATASET_ID and plan['id'] == PLAN_ID
    assert plan['payload']['run_id'] == RUN_ID and run['snapshot']['studio']['plan_id'] == PLAN_ID
    assert plan['payload']['scope_query'] == run['payload']['query'] == run['result']['query'] == QUESTION
    assert audit['question_compatibility'] == {'status': 'unsupported_operation',
        'reason': 'percentage_transformation_unsupported', 'question': QUESTION,
        'notice': NOTICE, 'history_notice': HISTORY_NOTICE}
    assert 'question_compatibility' not in run['result']
    result = run['result']
    assert result['readout']['amount_unit'] == 'wan' and result['readout']['period'] == '2024-Q2'
    assert result['readout']['facts'] == [{'id': 'cost', 'label': '营业成本', 'period': '2024-Q2',
        'value': 100000.0, 'unit': 'CNY', 'status': 'available', 'reason': '',
        'formula': '已保存的单季度输入（标准化为元）',
        'inputs': [{'field': 'cost', 'path': 'periods/2024-Q2/cost', 'unit': 'CNY', 'value': 100000.0}]}]
    source = result['readout']['input_source']
    assert source['status'] == 'not_recorded' and source['notice'] == SOURCE_NOTICE
    assert source['verification'] == 'user_provided_not_independently_verified'
    assert not source.get('file') and not source.get('receipt_hash')
    assert result['llm']['state'] == 'not_requested' and result['llm']['calls'] == []


def expect_export(blob, kind):
    assert kind in EXPORT_SHA256 and sha256(blob) == EXPORT_SHA256[kind], 'Original export bytes changed.'
    text = blob.decode('utf-8')
    assert WARNING_TITLE not in text and HISTORY_NOTICE not in text and EXPORT_NOTICE not in text
    if kind == 'json':
        report = json.loads(blob)
        assert report['query'] == QUESTION
        fact = report['readout']['facts'][0]
        assert (fact['value'], fact['unit'], fact['period']) == (100000, 'CNY', '2024-Q2')
    else:
        literal = re.sub(r'\\([\\`*_{}\[\]()#+.!|~-])', r'\1', text)
        assert QUESTION in literal and '100000' in text and 'CNY' in text


def expect_current_refusal(message, thread):
    assert message['payload']['question'] == QUESTION and message['thread_id'] == thread['id']
    assert thread['payload']['dataset_id'] == DATASET_ID and thread['payload']['identity_id'] == ''
    answer = message['payload']['response']
    scope = answer['context']['question_scope']
    assert scope['status'] == 'unsupported_topic' and scope['can_calculate'] is False
    assert scope['topics'] == [] and answer['facts'] == [] and answer['external_calls'] == 0
    assert answer['answer'] == NOTICE and scope['notice'] == NOTICE
    assert answer['context']['dataset_id'] == DATASET_ID and answer['context']['identity'] is None
    assert answer['cards'] == []
    assert not message.get('question_compatibility'), 'New refusal must not be relabelled as an old saved answer.'
    return answer


def expect_report_reading(reading):
    """Semantic reader contract, independent of hidden API facts and formatter."""
    assert reading['warning_title'] == WARNING_TITLE
    assert reading['original_question'] == '原问题：' + QUESTION
    assert reading['notice'] == NOTICE and reading['history_notice'] == HISTORY_NOTICE
    assert reading['export_notice'] == EXPORT_NOTICE
    assert reading['value_title'] == VALUE_TITLE and reading['query'] == QUESTION
    assert reading['input_notice'] == INPUT_NOTICE
    assert reading['headers'] == ['目标季度', '当时记录的指标', '已保存结果', '原输入与公式']
    assert reading['facts'] == [['2024-Q2', '营业成本', '10 万元',
                                 '营业成本：10 万元\n\n已保存的单季度输入（标准化为元）']]
    assert reading['source_rows'] == SOURCE_ROWS and reading['source_notice'] == SOURCE_NOTICE
    assert reading['warning_precedes_value'] is True
    assert reading['integrity'] == '记录一致性通过'
    assert reading['new_plan_label'] == '明确口径后新建研判' and reading['new_plan_route'] == 'agents'


def _read_complete_groups(p, groups, label):
    # Explicit waits precede all count/text/geometry assertions. Shared reading
    # helper observes the complete text Range and clips every overflow ancestor;
    # it records actual pointer-wheel motion and untouched reached viewports.
    for target, _ in groups:
        target.wait_for(state='visible', timeout=10_000)
    _read_groups(p, groups, label)


def _read_report(p, label):
    warning = p.visible('#run-tab-summary [data-historical-question-warning]')
    value = p.visible('#run-tab-summary [data-report-readout]')
    fields = {
        'warning_title': warning.locator(':scope > h2'),
        'original_question': warning.locator(':scope > p.preserve-lines'),
        'notice': warning.locator(':scope > .notice > span'),
        'history_notice': warning.locator(':scope > p').nth(1),
        'export_notice': warning.locator(':scope > p.micro'),
        'value_title': value.locator(':scope > h2'),
        'query': value.locator(':scope > p.preserve-lines'),
        'input_notice': value.locator(':scope > p.micro').first,
        'source_notice': value.locator(':scope > p.micro').last,
        'integrity': p.visible('#run-strip').get_by_text('记录一致性通过', exact=True),
        'new_plan_label': warning.locator('button[data-route="agents"]'),
    }
    for target in fields.values():
        target.wait_for(state='visible', timeout=10_000)
        assert target.count() == 1
    fact_table, source_table = value.locator('table').nth(0), value.locator('table').nth(1)
    fact_rows, source_rows = fact_table.locator('tbody tr'), source_table.locator('tbody tr')
    reading = {key: target.inner_text().strip() for key, target in fields.items()}
    # Block boundaries vary only in whitespace between the two actual input
    # paragraphs; retain exact paragraphs rather than browser-specific newlines.
    facts = [[cell.inner_text().strip() for cell in row.locator('td').all()] for row in fact_rows.all()]
    for row, cells in zip(fact_rows.all(), facts):
        cells[3] = '\n\n'.join(row.locator('td').nth(3).locator(':scope > p').all_text_contents())
    reading.update(headers=fact_table.locator('thead th').all_text_contents(), facts=facts,
        source_rows=[[cell.inner_text().strip() for cell in row.locator('td').all()] for row in source_rows.all()],
        new_plan_route=fields['new_plan_label'].get_attribute('data-route'),
        warning_precedes_value=warning.evaluate('(el) => !!(el.compareDocumentPosition(document.querySelector("#run-tab-summary [data-report-readout]")) & Node.DOCUMENT_POSITION_FOLLOWING)'))
    expect_report_reading(reading)
    _read_complete_groups(p, [(fields[key], [reading[key]]) for key in
        ('warning_title', 'original_question', 'notice', 'history_notice', 'export_notice', 'new_plan_label')],
        label + '：逐项完整阅读历史问题警示及原始导出说明')
    _read_complete_groups(p, [(fields[key], [reading[key]]) for key in
        ('value_title', 'query', 'input_notice')] + [(fact_table.locator('thead'), reading['headers'])]
        + [(row, [cell for cell in cells[:3]]) for row, cells in zip(fact_rows.all(), facts)],
        label + '：阅读原问题、保留的10万元与完整原输入公式')
    _read_complete_groups(p, [(row, cells) for row, cells in zip(source_rows.all(), SOURCE_ROWS)]
        + [(fields['source_notice'], [SOURCE_NOTICE]), (fields['integrity'], ['记录一致性通过'])],
        label + '：完整阅读原来源缺口和记录校验状态')
    p.observations.setdefault('historical_report_readings', []).append({'label': label, **reading,
        'record_integrity_is_not_question_correctness': True, 'manual_pixel_review': 'pending'})


def _open_from_list(p):
    p.navigate('reports')
    button = p.page.locator('#main button[data-route]').filter(has_text=QUESTION)
    button.wait_for(state='visible', timeout=30_000)
    assert button.count() == 1 and button.get_attribute('data-route') == 'agents:run-' + RUN_ID
    _read_complete_groups(p, [(button.locator('small'), [QUESTION])], '从普通研判报告列表按完整原问题找到旧报告')
    p.step('点击报告列表中的真实旧问题入口', lambda: button.click())
    p.visible('#run-tab-summary [data-historical-question-warning]')
    p.observations.setdefault('historical_list_entries', []).append({'question': QUESTION,
        'button_route': 'agents:run-' + RUN_ID, 'observed_url': p.page.url})


def expect_mutations(mutations, thread_id):
    assert mutations == [('POST', '/api/auth/register'), ('POST', '/api/services/threads'),
        ('POST', '/api/services/threads/' + thread_id + '/messages')], 'Unexpected native business mutation.'


def historical_warning_journey(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree,
                               admission_scope=None):
    require_history_admission(p, admission_scope)
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir,
        expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    require_history_environment(p, data_dir, admission_scope)
    verified_closure(repository_root)
    p.observations['historical_fixture_boundary'] = (
        'A newly registered current synthetic account will receive one genuine old API/worker completed report. '
        'Preparation restores 49 business rows, remapping only outer owner columns; it is not a UI write, '
        'current native report creation, old-account upgrade, full migration, or assistant proposal history.')
    mutations = []
    def observe_request(request):
        path = urlsplit(request.url).path
        if path.startswith('/api/') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            mutations.append((request.method, path))
    p.page.on('request', observe_request)
    try:
        status, registration = register_empty_workspace(p, observe_registration=lambda submit:
            _capture_response(p, 'POST', '/api/auth/register', submit))
        assert status == 201
        assert mutations == [('POST', '/api/auth/register')], 'Expected exactly one registration write before historical preparation.'
        owner = registration['user']['id']
        p.observations['historical_native_registration_owner'] = owner
        receipt = p.step('声明测试准备：仅恢复真实旧合成完成报告49行，外层owner映射，0旧队列',
            lambda: prepare_native_history(p, data_dir=data_dir, repository_root=repository_root,
                registration_owner=owner, admission_scope=admission_scope))
        before = verify_native_history(p, data_dir=data_dir, repository_root=repository_root, admission_scope=admission_scope)
        run = p.get('/api/runs/' + RUN_ID)
        plan = p.get('/api/workspace/plans/' + PLAN_ID)
        expect_historical_api(p.get('/api/workspace/runs/' + RUN_ID + '/audit'), run, plan)
        assert p.get('/api/services/threads?identity_id=&dataset_id=' + DATASET_ID)['items'] == []
        # A real reload makes the prepared account history visible to the app;
        # no JavaScript app state, hash route or hidden API mutation is injected.
        p.step('真实刷新后用顶部企业选择器进入旧合成企业', lambda: p.page.reload(wait_until='domcontentloaded'))
        p.select('#active-dataset', DATASET_ID, '明确选择原合成企业')
        assert p.visible('#active-identity').input_value() == ''
        assert COMPANY in p.visible('#active-dataset').inner_text()
        p.dataset_id = DATASET_ID
        _open_from_list(p)
        _read_report(p, '首次历史阅读')
        for kind, text in [('md', '导出报告'), ('json', '完整 JSON')]:
            link = p.visible('#main a[href="/api/runs/' + RUN_ID + '/export?format=' + kind + '"]')
            assert link.inner_text().strip() == text
            blob = download_visible(p, link, 'original-legacy-report.' + kind, '真实下载并打开原始' + kind.upper())
            expect_export(blob, kind)
        p.navigate('copilot')
        turn, message, thread = _ask(p, QUESTION)
        response = expect_current_refusal(message, thread)
        answer = turn.locator('.research-answer')
        answer.wait_for(state='visible', timeout=10_000)
        assert answer.inner_text() == response['answer']
        assert turn.locator('.fact-grid, [data-report-readout], [data-historical-question-warning]').count() == 0
        _read_complete_groups(p, [(turn.locator('.user-message p'), [QUESTION]), (answer, [NOTICE])],
            '在当前研究助手重新发送同句，完整阅读明确拒绝且无替代金额卡')
        saved = p.get('/api/services/threads/' + thread['id'])
        assert saved['runs'] == [] and saved['proposals'] == [] and len(saved['messages']) == 1
        assert saved['messages'][0] == {key: message[key] for key in ('id', 'payload', 'created_at')}
        p.observations['current_refusal'] = {'thread_id': thread['id'], 'message_id': message['id'],
            'question': QUESTION, 'response': response, 'historical_proposal_binding': None}
        p.step('使用浏览器Back返回原报告', lambda: p.page.go_back(wait_until='domcontentloaded'))
        p.visible('#run-tab-summary [data-historical-question-warning]')
        _read_report(p, 'Back返回旧报告')
        _open_from_list(p)
        p.step('重新打开后真实刷新原报告', lambda: p.page.reload(wait_until='domcontentloaded'))
        p.visible('#run-tab-summary [data-historical-question-warning]')
        _read_report(p, '列表重开及刷新旧报告')
        expect_historical_api(p.get('/api/workspace/runs/' + RUN_ID + '/audit'), p.get('/api/runs/' + RUN_ID),
                              p.get('/api/workspace/plans/' + PLAN_ID))
        for kind in EXPORT_SHA256:
            expect_export(p.get('/api/runs/' + RUN_ID + '/export?format=' + kind, as_bytes=True), kind)
        after = verify_native_history(p, data_dir=data_dir, repository_root=repository_root,
            admission_scope=admission_scope, current_thread_id=thread['id'], current_message_id=message['id'])
        assert after == before
        assert p.get('/api/runs')['items'][0]['id'] == RUN_ID and len(p.get('/api/runs')['items']) == 1
        assert p.get('/api/services/threads/' + thread['id']) == saved
        expect_mutations(mutations, thread['id'])
        p.no_external()
        p.observations['historical_warning_outcome'] = {'run_id': RUN_ID, 'plan_id': PLAN_ID,
            'source_fixture_sha256': receipt['source_fixture_sha256'], 'frozen_row_hashes_before': before,
            'frozen_row_hashes_after': after, 'old_rows_preserved_after_owner_mapping': True,
            'original_exports': EXPORT_SHA256, 'actual_downloads': 2, 'actual_current_threads': 1, 'actual_current_messages': 1,
            'new_runs': 0, 'new_reports': 0, 'external_calls': 0, 'database_faults': 0,
            'mutations': mutations, 'coverage': 'one Chinese cost-growth report and one independent current refusal',
            'manual_pixel_review': 'pending'}
    finally:
        p.page.remove_listener('request', observe_request)
