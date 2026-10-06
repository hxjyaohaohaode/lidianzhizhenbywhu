"""Current native copilot damaged-report reader; prepared, never run locally.

The authorized hosted Probe retains its 300-second process / 15-minute job
budgets, original CSP/brand guards, PNG/video/trace/hash packaging and native
submission adapter. Only the single disclosed saved-result fixture uses SQLite.
No old unsupported-percentage history, malformed JSON or provider coverage is
claimed. Every business mutation is performed by an actual visible UI control.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

try:
    from .product_first_use_audit import require_native_contract, canonical_hash, expect_integrity, download_visible
    from .product_report_export import expect_saved_report, one
    from .product_browser_audit import percentage_display
    from .product_integrity_outcomes import _capture_response
    from .product_readout_oracles import observe_text_by_normal_scroll
    from .native_integrity_faults import (COPILOT_BAD_VALUE, read_copilot_records, inject_copilot_report_result)
except ImportError:
    from product_first_use_audit import require_native_contract, canonical_hash, expect_integrity, download_visible
    from product_report_export import expect_saved_report, one
    from product_browser_audit import percentage_display
    from product_integrity_outcomes import _capture_response
    from product_readout_oracles import observe_text_by_normal_scroll
    from native_integrity_faults import (COPILOT_BAD_VALUE, read_copilot_records, inject_copilot_report_result)

SCENARIO = 'I10-copilot-report-integrity'
QUERY = '2024-Q4毛利率是多少'
FRESH_QUERY = '2024-Q4毛利率是多少（独立重新核验）'
RESEARCH_FORM = '#modal form[data-service-form="proposal"][data-kind="research"]'
CONFIRM_FORM = '#modal form[data-service-form="confirm-proposal"]'
UNAVAILABLE = '[data-copilot-report-unavailable]'
RAW = '[data-unverified-report-raw]'


def _read(p, target, text, label):
    assert target.count() == 1 and text in target.text_content()
    observe_text_by_normal_scroll(p, target, text, label)


def card_selector(proposal_id):
    return '#assistant-answer .proposal-card[data-proposal="' + proposal_id + '"]'


def expect_card_api(thread, proposal, run, *, available, raw=None):
    card = one(thread['runs'], run['id'])
    assert card['proposal_id'] == proposal['id'] and card['query'] == run['payload']['query']
    assert one(thread['proposals'], proposal['id']) == proposal
    assert card['state'] == run['state'] and card['dataset_version'] == 1
    if available:
        assert card['report_integrity'] == {'valid': True, 'format': 'studio', 'failures': []}
        assert card['report_availability'] == {'status': 'available', 'notice': ''}
        assert card['report_hash_valid'] is True and card['result'] == run['result']
        assert card['unverified_report'] is None and card['source_impact']['state'] == 'current'
    else:
        assert card['report_integrity'] == {'valid': False, 'format': 'studio', 'failures': ['report_hash']}
        assert card['report_hash_valid'] is False and card['report_availability']['status'] == 'unavailable'
        assert card['result'] is None and card['question_compatibility'] is None
        assert card['source_impact']['state'] == 'unavailable'
        assert [r['code'] for r in card['source_impact']['reasons']] == ['report_integrity_failed']
        assert card['unverified_report'] == {'raw': raw, 'notice': '未核验的已保存报告原文，仅供排查；不是可用结论。'}
    return card


def expect_fault_audit(before, after):
    assert after['report_integrity'] == {'valid': False, 'format': 'studio', 'failures': ['report_hash']}
    assert after['report_hash_valid'] is False
    for key in ('ledger', 'artifacts', 'trace', 'snapshot_hash', 'snapshot_hash_valid', 'data_hash_valid'):
        assert after[key] == before[key], 'Saved-result fault changed protected audit evidence: ' + key
    assert after['source_impact']['state'] == 'unavailable'
    assert [r['code'] for r in after['source_impact']['reasons']] == ['report_integrity_failed']


def _observe_healthy(p, proposal, run, source_file, label):
    card = p.visible(card_selector(proposal['id']))
    assert card.locator(UNAVAILABLE + ',' + RAW).count() == 0
    readout = card.locator('[data-report-readout]')
    _read(p, readout.get_by_text(run['payload']['query'], exact=True), run['payload']['query'], label + '批准的完整原问题')
    rows = readout.locator('table').nth(0).locator('tbody tr')
    assert rows.count() == 1
    cells = rows.first.locator('td').all_text_contents()
    assert [s.strip() for s in cells[:2]] == ['2024-Q4', '毛利率']
    assert percentage_display(cells[2], '已保存结果', .2)
    value = rows.first.locator('td').nth(2).locator('strong')
    _read(p, value, value.inner_text(), label + '所问毛利率20%')
    inputs = rows.first.locator('td').nth(3)
    for text in ('营业收入：10 万元', '营业成本：8 万元', '(收入−成本)/收入'):
        assert text in inputs.inner_text()
    _read(p, inputs, inputs.text_content(), label + '原输入金额、单位与公式')
    source = readout.locator('table').nth(1)
    for field, expected in [('目标季度 / 数据修订', '2024-Q4 / 1'), ('确认使用的文件', source_file['name']),
                            ('原文件金额单位', '元'), ('原文件期间口径', '单季度')]:
        row = source.locator('tbody tr').filter(has=p.page.get_by_text(field, exact=True))
        assert row.count() == 1 and row.locator('td').nth(1).inner_text().strip() == expected
        _read(p, row, row.text_content(), label + field)
    notice = readout.locator(':scope > p.micro').last
    assert any(word in notice.inner_text() for word in ('未独立核验', '未经独立核验', '未经过独立核验'))
    _read(p, notice, notice.inner_text(), label + '合成用户输入尚未独立核验')
    p.observations.setdefault('I10_healthy_cards', []).append({'run_id': run['id'], 'proposal_id': proposal['id'],
        'approved_query': run['payload']['query'], 'gross_margin_ratio': .2, 'source_file': source_file})


def _create_assistant_report(p, dataset, question, source_file, expected_previous):
    turn = p.ask(question)
    message_id = turn.get_attribute('data-message')
    thread = p.thread()
    assert len(thread['runs']) == len(expected_previous)
    thread_id = thread['thread']['id']
    assert set(r['id'] for r in thread['runs']) == expected_previous
    source = '#assistant-answer [data-message="' + message_id + '"] [data-x-action="chat-propose"][data-kind="research"]'
    p.click(source, after=RESEARCH_FORM, label='从真实助手答复打开深入研判表单')
    form = p.visible(RESEARCH_FORM)
    assert form.get_attribute('data-message') == message_id
    assert form.locator('[name="text"]').input_value() == question
    request_id = form.get_attribute('data-key')
    details = form.locator('details').filter(has=p.page.get_by_text('模型参与与数学工具', exact=True))
    p.step('展开真实模型参与设置并明确外部调用上限为0', lambda: details.locator('summary').click())
    p.fill(RESEARCH_FORM + ' [name="max_calls"]', '0')
    assert not p.visible(RESEARCH_FORM + ' [name="use_llm"]').is_checked()
    assert not p.visible(RESEARCH_FORM + ' [name="forecast"]').is_checked()
    status, draft = _capture_response(p, 'POST', '/api/services/threads/' + thread_id + '/proposals',
        lambda: p.submit(RESEARCH_FORM, after=CONFIRM_FORM))
    assert status == 201 and draft['user_id'] == dataset['user_id']
    payload = draft['payload']
    assert payload['status'] == 'draft' and payload['result'] is None
    assert payload['request']['text'] == question and payload['source_message_id'] == message_id
    assert payload['request']['request_id'] == request_id and payload['request']['max_calls'] == 0
    assert payload['request']['use_llm'] is False and payload['external_calls'] == 0
    assert payload['text'].count(question) == 1 and '2024-Q4' in payload['text']
    plan = p.get('/api/workspace/plans/' + payload['plan_id'])
    assert plan['payload']['request']['query'] == payload['text']
    assert plan['payload']['max_calls'] == 0 and not plan['payload']['request']['use_llm']
    assert plan['payload']['snapshot']['dataset'] == dataset['payload']
    assert p.visible(CONFIRM_FORM).get_attribute('data-id') == draft['id']
    assert p.visible(CONFIRM_FORM).locator('[name="external_consent"]').count() == 0
    _read(p, p.visible('#modal').locator('.dialog-body > p').first, payload['text'], '批准前阅读完整原问题与冻结范围')
    _read(p, p.visible('#modal').get_by_text('外部调用最多 0 次', exact=True), '外部调用最多 0 次', '批准前阅读0次外部调用预算')
    boundary = '本任务不会调用模型或自动检索网络。'
    _read(p, p.visible(CONFIRM_FORM).get_by_text(boundary, exact=True), boundary, '批准前阅读无模型和网络检索边界')
    assert set(r['id'] for r in p.get('/api/runs')['items']) == expected_previous, 'Draft must not execute a report.'
    status, approved = _capture_response(p, 'POST', '/api/services/proposals/' + draft['id'] + '/confirm',
        lambda: p.submit(CONFIRM_FORM, after=card_selector(draft['id']) + ' [data-report-readout]'))
    assert status == 200 and approved['payload']['status'] == 'executed'
    run_id = approved['payload']['result']['run_id']
    run = p.get('/api/runs/' + run_id)
    expect_saved_report(run, dataset, payload['text'], source_file)
    assert run_id not in expected_previous and run['snapshot']['studio']['plan_id'] == plan['id']
    audit = p.get('/api/workspace/runs/' + run_id + '/audit')
    expect_integrity(audit)
    saved = p.get('/api/services/proposals/' + draft['id'])
    assert saved == approved
    current = p.thread()
    expect_card_api(current, saved, run, available=True)
    _observe_healthy(p, saved, run, source_file, '新完成助手报告：')
    return current['thread']['id'], saved, run, audit


def _read_raw(p, disclosure, raw):
    # Discover through the product's ordinary visible search. No raw offsets,
    # target ranges, horizontal jumps or implementation-state manipulation.
    query = disclosure.get_by_role('searchbox', name='查找原文字段或值')
    p.step('在未核验原文查找框输入普通字段名：毛利率', lambda: query.fill('毛利率'))
    p.step('用可见查找按钮定位字段', lambda: disclosure.get_by_role('button', name='查找', exact=True).click())
    status = disclosure.locator('[data-raw-status]')
    match = disclosure.locator('[data-raw-match]')
    excerpt = match.locator('[data-raw-excerpt]')
    label = '"label":"毛利率"'
    value = '"value":' + str(COPILOT_BAD_VALUE)
    seen = []
    # The total and every candidate come from the reader's displayed search.
    total = int(re.search(r'第 1 / (\d+) 处', status.inner_text()).group(1))
    assert total == raw.count('毛利率') and 0 < total <= 40
    for index in range(total):
        _read(p, status, f'第 {index + 1} / {total} 处', '读原文查找命中顺序和总数')
        _read(p, excerpt.locator('mark'), '毛利率', '读可见的字段名命中')
        shown = excerpt.inner_text()
        # Expand only through the user-facing control; inspect actual nearby
        # text before choosing the next result, never known target geometry.
        if '"id":"gross_margin"' in shown:
            for _ in range(2):
                if value in shown or match.get_by_role('button', name='更多后文').is_disabled():
                    break
                p.step('用更多后文展开该字段附近的保存内容', lambda: match.get_by_role('button', name='更多后文').click())
                shown = excerpt.inner_text()
        seen.append({'position': status.inner_text(), 'context': shown})
        if label in shown and value in shown and '"id":"gross_margin"' in shown:
            for needle in ('"id":"gross_margin"', label, value):
                _read(p, excerpt, needle, '用普通纵向滚轮阅读未核验字段及原始值：' + needle)
            break
        assert index + 1 < total, 'The ordinary search did not expose the damaged fact and its context.'
        p.step('按下一处检查原字符串中的后续同名字段', lambda: disclosure.get_by_role('button', name='下一处', exact=True).click())
    boundary = match.locator('strong')
    _read(p, boundary, '未核验 · 命中与前后文', '字段和原值仍属于未核验原文')
    complete = disclosure.locator('[data-raw-full]')
    p.step('用完整原文入口核对自动换行阅读区', lambda: complete.locator('summary').click())
    dimensions = complete.locator('[data-raw-content]').evaluate('(el)=>({width:el.clientWidth,scrollWidth:el.scrollWidth,wrap:getComputedStyle(el).whiteSpace})')
    assert dimensions['width'] > 0 and dimensions['scrollWidth'] <= dimensions['width'] + 1
    assert dimensions['wrap'] == 'pre-wrap'
    p.step('收起完整原文，返回字段查找和原文下载', lambda: complete.locator('summary').click())
    button = disclosure.get_by_role('button', name='下载未核验原始文本（.txt）', exact=True)
    downloaded = download_visible(p, button, 'I10-unverified-saved-report.txt', '真实点击并打开未核验原始文本下载')
    assert downloaded == raw.encode('utf-8'), 'Downloaded UTF-8 must equal the saved raw string byte for byte.'
    p.observations['I10_raw_reader'] = {'query': '毛利率', 'displayed_matches': total,
        'visited_contexts': seen, 'download_sha256': hashlib.sha256(downloaded).hexdigest(),
        'download_bytes': len(downloaded), 'full_text_dimensions': dimensions,
        'manual_pixel_review': 'pending', 'discovery': 'visible keyword search and ordinary vertical scrolling'}


def _observe_blocked(p, proposal, run, raw, *, open_raw):
    card = p.visible(card_selector(proposal['id']))
    unavailable = card.locator(UNAVAILABLE)
    assert unavailable.count() == 1
    assert card.locator('[data-report-readout], .chat-run-result, .chat-math-results, canvas, svg.chart, .metric-row').count() == 0
    assert card.locator('[data-route^="lab"], [data-route^="compare"], [data-action="action-from-report"], [data-x-action="watch-from-report"], a[href*="/export"]').count() == 0
    shown = card.inner_text()
    assert '仍是原始冻结内容' not in shown and '本次问题的回答' not in shown
    _read(p, unavailable.get_by_text('原问题：' + run['payload']['query'], exact=True),
          '原问题：' + run['payload']['query'], '坏助手卡仍保留原问题')
    reason = unavailable.locator(':scope > .notice')
    assert all(part in reason.inner_text() for part in ('完整性', '暂停展示主答案', '数学结果', '衍生入口', '原记录保留'))
    _read(p, reason, reason.inner_text(), '阅读坏助手卡不可用原因与暂停范围')
    disclosure = unavailable.locator(RAW)
    assert disclosure.count() == 1
    if disclosure.get_attribute('open') is not None:
        p.step('收起原文，确认未核验数字不出现在普通答案', lambda: disclosure.locator(':scope > summary').click())
    assert str(COPILOT_BAD_VALUE) not in card.inner_text()
    if open_raw:
        summary = '未核验的已保存报告原文（仅供排查）'
        _read(p, disclosure.locator(':scope > summary'), summary, '先读原文披露的未核验标题')
        p.step('明确展开真实未核验原文披露', lambda: disclosure.locator(':scope > summary').click())
        notice = '未核验原文，不是可用结论。'
        _read(p, disclosure.locator('[data-unverified-warning]'), notice, '阅读原文仅供排查而非可用结论的边界')
        _read_raw(p, disclosure, raw)
        p.step('读完后收起未核验原文，保留坏卡状态', lambda: disclosure.locator(':scope > summary').click())
    p.observations.setdefault('I10_blocked_visits', []).append({'proposal_id': proposal['id'], 'run_id': run['id'],
        'approved_query': run['payload']['query'], 'normal_answer_count': 0, 'derived_routes': 0, 'raw_opened': open_raw})


def _open_thread_history(p, thread_id):
    p.click('#main [data-x-action="chat-history"]', after='#modal .thread-history', label='从真实助手历史会话入口找回原会话')
    row = p.visible('#modal').locator('.thread-history').filter(
        has=p.page.get_by_role('heading', name=QUERY, exact=True))
    assert row.count() == 1
    _read(p, row.locator('h3'), QUERY, '按最初原问题识别正确历史会话')
    target = row.locator('[data-x-action="chat-open"]')
    assert target.count() == 1 and target.get_attribute('data-id') == thread_id
    status, loaded = _capture_response(p, 'GET', '/api/services/threads/' + thread_id,
        lambda: p.step('明确打开原研究会话，不用已知URL代替用户入口', lambda: target.click()))
    assert status == 200 and loaded['thread']['id'] == thread_id
    p.page.locator('#modal').wait_for(state='hidden', timeout=10000)
    return loaded


def copilot_report_integrity(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir,
                            expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    if 'fault-injection' not in getattr(p, 'artifact_kinds', ()):
        raise RuntimeError('Runner must explicitly admit integrity fixture receipts.')
    p.observations['scope'] = SCENARIO
    p.observations['corruption_setup_boundary'] = {
        'fault': 'After complete healthy UI readings, replace only runs.result readout.facts[0].value: 0.2 -> 987654321.',
        'preserved': 'Every other saved-result byte; complete proposal/plan/dataset/artifact/event/ledger rows.',
        'recovery': 'A separately approved native assistant report in the same thread; never restore the damaged report.',
        'not_covered': ['authentic old unsupported-percentage warning', 'malformed/missing/oversized raw JSON', 'live providers'],
        'fixture_restore_called': False, 'production_fault_api': False}
    p.bootstrap()
    csv = Path(p.directory) / 'synthetic-financial-input.csv'
    p.record_artifact(csv, kind='synthetic-input')
    source_file = {'name': csv.name, 'sha256': hashlib.sha256(csv.read_bytes()).hexdigest(), 'bytes': csv.stat().st_size}
    dataset = p.get('/api/datasets/' + p.dataset_id)
    assert p.get('/api/runs')['items'] == []
    mutations = []
    def record(request):
        url = urlsplit(request.url)
        if url.path.startswith('/api/') and request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            mutations.append({'method': request.method, 'path': url.path})
    p.page.on('request', record)
    try:
        p.navigate('copilot')
        thread_id, old_proposal, old, healthy_audit = _create_assistant_report(p, dataset, QUERY, source_file, set())
        original = read_copilot_records(p, data_dir=data_dir, run_id=old['id'], proposal_id=old_proposal['id'])
        assert json.loads(original['run']['result']) == old['result']
        fault = inject_copilot_report_result(p, data_dir=data_dir, run_id=old['id'],
                                            proposal_id=old_proposal['id'], expected_records=original)
        raw = fault['damaged_records']['run']['result']
        damaged = p.get('/api/runs/' + old['id'])
        assert {k: v for k, v in damaged.items() if k != 'result'} == {k: v for k, v in old.items() if k != 'result'}
        assert damaged['result'] == json.loads(raw)
        damaged_audit = p.get('/api/workspace/runs/' + old['id'] + '/audit')
        expect_fault_audit(healthy_audit, damaged_audit)
        loaded = _open_thread_history(p, thread_id)
        expect_card_api(loaded, old_proposal, old, available=False, raw=raw)
        _observe_blocked(p, old_proposal, old, raw, open_raw=True)
        p.step('真实浏览器重新载入当前助手页，重新读取持久化坏记录', lambda: p.page.reload(wait_until='domcontentloaded'))
        p.visible(card_selector(old_proposal['id']) + ' ' + UNAVAILABLE)
        expect_card_api(p.thread(), old_proposal, old, available=False, raw=raw)
        _observe_blocked(p, old_proposal, old, raw, open_raw=False)
        fresh_thread, fresh_proposal, fresh, fresh_audit = _create_assistant_report(p, dataset, FRESH_QUERY, source_file, {old['id']})
        assert fresh_thread == thread_id and fresh_proposal['id'] != old_proposal['id'] and fresh['id'] != old['id']
        assert fresh['snapshot']['studio']['plan_id'] != old['snapshot']['studio']['plan_id']
        loaded = _open_thread_history(p, thread_id)
        expect_card_api(loaded, fresh_proposal, fresh, available=True)
        expect_card_api(loaded, old_proposal, old, available=False, raw=raw)
        _observe_blocked(p, old_proposal, old, raw, open_raw=False)
        preserved = read_copilot_records(p, data_dir=data_dir, run_id=old['id'], proposal_id=old_proposal['id'])
        assert preserved == fault['damaged_records'], 'Fresh report or history read repaired/rewrote old bytes.'
        assert p.get('/api/runs/' + old['id']) == damaged
        assert p.get('/api/workspace/runs/' + old['id'] + '/audit') == damaged_audit
        assert p.get('/api/services/proposals/' + old_proposal['id']) == old_proposal
        assert p.get('/api/datasets/' + dataset['id']) == dataset
        assert p.get('/api/runs/' + fresh['id']) == fresh and p.get('/api/workspace/runs/' + fresh['id'] + '/audit') == fresh_audit
        expected = [('POST', '/api/services/threads')]
        expected += [('POST', '/api/services/threads/' + thread_id + '/' + endpoint) for endpoint in ('messages', 'proposals') for _ in range(2)]
        expected += [('POST', '/api/services/proposals/' + value['id'] + '/confirm') for value in (old_proposal, fresh_proposal)]
        assert sorted((row['method'], row['path']) for row in mutations) == sorted(expected), 'Only seven explicit assistant UI writes are allowed.'
        p.observations['I10_complete_history'] = {'thread_id': thread_id, 'old_run_id': old['id'], 'fresh_run_id': fresh['id'],
            'old_proposal_id': old_proposal['id'], 'fresh_proposal_id': fresh_proposal['id'],
            'old_approved_query': old['payload']['query'], 'fresh_approved_query': fresh['payload']['query'],
            'old_original_records_sha256': canonical_hash(original), 'old_damaged_records_sha256': canonical_hash(preserved),
            'old_report_still_blocked': True, 'full_old_rows_preserved': True, 'native_mutations': mutations}
        p.no_external()
    finally:
        p.page.remove_listener('request', record)
