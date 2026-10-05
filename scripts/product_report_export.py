"""I9 native exports and a fresh report after a declared artifact fault.

Importing is pure. The authorized native CI runner owns browser/server lifetime
and admits the existing owner-bound temporary database fixture. That fixture is
setup, never a user action; the damaged history is deliberately never restored.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re

try:
    from .product_browser_audit import FIXTURE_COMPANY, percentage_display
    from .product_first_use_audit import (
        require_native_contract, canonical_hash, download_visible,
        expect_integrity, markdown_json_blocks,
    )
    from .product_integrity_outcomes import _capture_response
    from .product_readout_oracles import observe_text_by_normal_scroll
    from .native_integrity_faults import inject_fault
except ImportError:
    from product_browser_audit import FIXTURE_COMPANY, percentage_display
    from product_first_use_audit import (
        require_native_contract, canonical_hash, download_visible,
        expect_integrity, markdown_json_blocks,
    )
    from product_integrity_outcomes import _capture_response
    from product_readout_oracles import observe_text_by_normal_scroll
    from native_integrity_faults import inject_fault


SCENARIO = 'I9-report-export'
QUERY = '2024-Q4毛利率是多少'
FRESH_QUERY = '2024-Q4毛利率是多少（重新核验受损记录）'
UNAVAILABLE = '[data-report-export-unavailable]'


def one(rows, record_id):
    matches = [row for row in rows if row['id'] == record_id]
    assert len(matches) == 1, 'Expected one exact saved record.'
    return matches[0]


def expect_saved_report(run, dataset, query, source_file):
    """Independent business checks, usable without a browser or application."""
    result, snapshot = run['result'], run['snapshot']
    assert run['state'] in ('succeeded', 'degraded')
    assert run['user_id'] == dataset['user_id']
    assert run['dataset_id'] == result['dataset_id'] == dataset['id']
    assert run['payload']['query'] == result['query'] == query
    assert snapshot['dataset'] == dataset['payload']
    assert snapshot['dataset_version'] == result['dataset_version'] == dataset['version'] == 1
    assert snapshot['dataset_hash'] == result['dataset_hash'] == dataset['content_hash'] == canonical_hash(dataset['payload'])
    assert result['snapshot_hash'] == canonical_hash(snapshot)
    assert result['analysis']['current_period'] == result['research_scope']['period'] == '2024-Q4'
    assert math.isclose(result['analysis']['metrics']['gross_margin'], .2, rel_tol=0, abs_tol=1e-12)
    periods = [row for row in snapshot['dataset']['periods'] if row['period'] == '2024-Q4']
    assert len(periods) == 1 and periods[0]['revenue'] == 100000 and periods[0]['cost'] == 80000
    assert result['llm']['state'] == 'not_requested' and result['llm']['calls'] == []
    assert result['llm']['review']['claims'] == [] and result['citations'] == []
    margin = one(result['lineage'], 'gross_margin')
    readout = result['readout']
    assert readout['schema_version'] == 1 and readout['scope_recorded'] is True
    assert readout['period'] == '2024-Q4' and readout['amount_unit'] == 'wan'
    assert len(readout['facts']) == 1
    fact = one(readout['facts'], 'gross_margin')
    for value in (margin, fact):
        assert value['period'] == '2024-Q4' and value['formula'] == '(收入−成本)/收入'
        assert math.isclose(value['value'], .2, rel_tol=0, abs_tol=1e-12)
        assert [(row['path'], row['value'], row['unit']) for row in value['inputs']] == [
            ('periods/2024-Q4/revenue', 100000, 'CNY'), ('periods/2024-Q4/cost', 80000, 'CNY')]
    assert fact['unit'] == 'ratio' and fact['status'] == 'available' and fact['reason'] == ''
    source = readout['input_source']
    assert source == snapshot['input_source'] and source['status'] == 'recorded'
    assert source['dataset_id'] == dataset['id'] and source['dataset_version'] == 1
    assert source['dataset_hash'] == dataset['content_hash'] and source['period'] == '2024-Q4'
    assert source['file'] == source_file
    assert source['input_amount_unit'] == 'yuan' and source['input_basis'] == 'standalone_quarter'
    assert source['confirmed_at'] and re.fullmatch(r'[0-9a-f]{64}', source['receipt_hash'])
    return result


def expect_export_bytes(json_bytes, md_bytes, run, dataset, query, source_file, events):
    """Open actual downloads and compare frozen values; no production formatter."""
    expected = expect_saved_report(run, dataset, query, source_file)
    exported = json.loads(json_bytes.decode('utf-8'))
    assert {key: value for key, value in exported.items()
            if key not in ('execution_events', 'export_context')} == expected, 'JSON changed the saved report.'
    assert exported['execution_events'] == events
    context = exported['export_context']
    assert context['run_id'] == run['id'] and context['execution_state'] == run['state']
    assert context['identity'] == run['snapshot']['identity']
    assert context['human_reviews_at_export'] == [] and context['assessment_at_export'] is None
    md = md_bytes.decode('utf-8')
    assert md.count('## 技术附录') == 1
    prefix = md.split('## 技术附录', 1)[0]
    assert '```' not in prefix, 'The readable answer must precede raw technical JSON.'
    literal = re.sub(r'\\([\\`*_{}\[\]()#+.!|~-])', r'\1', prefix)
    for text in (query, '本次问题的回答', '输入来源与保存范围', '数据修订', '2024-Q4',
                 source_file['name'], source_file['sha256'], dataset['content_hash'], '万元'):
        assert text in literal, text
    assert re.search(r'20(?:\.0+)?\s*%', literal), 'Markdown must display 20%, not raw 0.2.'
    assert re.search(r'营业收入\s+10(?:\.0+)?\s*万元', literal)
    assert re.search(r'营业成本\s+8(?:\.0+)?\s*万元', literal)
    assert re.search(r'\|\s*数据修订\s*\|\s*1\s*\|', literal)
    assert re.search(r'未经.{0,5}核验|未.{0,5}核验', literal)
    blocks = markdown_json_blocks(md)
    assert expected['analysis'] in blocks and expected['lineage'] in blocks and events in blocks
    assert expected['snapshot_hash'] in md and 'not\\_requested' in md
    return {'json_bytes': len(json_bytes), 'markdown_bytes': len(md_bytes),
            'json_sha256': hashlib.sha256(json_bytes).hexdigest(),
            'markdown_sha256': hashlib.sha256(md_bytes).hexdigest(),
            'saved_result_hash': canonical_hash(expected), 'parsed_markdown_json_blocks': len(blocks)}


def _observe_report(p, dataset, query, label):
    readout = p.visible('#run-tab-summary [data-report-readout]')
    question = readout.get_by_text(query, exact=True)
    assert question.count() == 1
    observe_text_by_normal_scroll(p, question, query, label + '原问题')
    facts = readout.locator('table').nth(0).locator('tbody tr')
    assert facts.count() == 1
    cells = [text.strip() for text in facts.first.locator('td').all_text_contents()]
    assert cells[:2] == ['2024-Q4', '毛利率']
    assert percentage_display(cells[2], '已保存结果', .2)
    value = facts.first.locator('td').nth(2).locator('strong')
    observe_text_by_normal_scroll(p, value, value.inner_text().strip(), label + '毛利率20%')
    for text in ('营业收入：10 万元', '营业成本：8 万元', '(收入−成本)/收入'):
        target = facts.first.locator('td').nth(3).get_by_text(text, exact=True)
        assert target.count() == 1
        observe_text_by_normal_scroll(p, target, text, label + '原始输入与公式')
    source = readout.locator('table').nth(1).locator('tbody tr').filter(
        has=p.page.get_by_text('目标季度 / 数据修订', exact=True))
    assert source.count() == 1
    revision = source.locator('td').nth(1)
    assert revision.inner_text().strip() == '2024-Q4 / 1'
    observe_text_by_normal_scroll(p, revision, '2024-Q4 / 1', label + '原数据修订')
    fingerprints = readout.locator('details').filter(
        has=p.page.get_by_text('冻结数据与回执指纹', exact=True))
    assert fingerprints.count() == 1
    if fingerprints.get_attribute('open') is None:
        p.step(label + '展开冻结指纹', lambda: fingerprints.locator('summary').click())
    fingerprint = fingerprints.get_by_text(dataset['content_hash'], exact=True)
    assert fingerprint.count() == 1
    observe_text_by_normal_scroll(p, fingerprint, dataset['content_hash'], label + '原数据SHA256')
    p.observations.setdefault('I9_visible_reports', []).append({
        'query': query, 'facts': cells, 'dataset_version': 1,
        'dataset_hash': dataset['content_hash'], 'label': label})


def _create_report(p, dataset, query, source_file):
    """Start at the actual visible plan form; no assumption about run count."""
    p.fill('#plan-form [name="query"]', query)
    assert p.visible('#plan-form [name="dataset_id"]').input_value() == dataset['id']
    assert not p.visible('#use-llm').is_checked()
    status, draft = _capture_response(p, 'POST', '/api/workspace/plans',
        lambda: p.submit('#plan-form', after='#execute-plan-form'))
    assert status == 201 and draft['user_id'] == dataset['user_id']
    payload = draft['payload']
    assert payload['status'] == 'draft' and payload['run_id'] is None
    assert payload['request']['query'] == query and payload['request']['dataset_id'] == dataset['id']
    assert payload['snapshot']['dataset'] == dataset['payload']
    assert payload['snapshot']['dataset_version'] == 1 and payload['snapshot']['dataset_hash'] == dataset['content_hash']
    assert payload['max_calls'] == 0 and not payload['request']['use_llm']
    form = p.visible('#execute-plan-form')
    assert form.get_attribute('data-id') == draft['id']
    assert form.locator('[name="external_consent"]').count() == 0
    boundary = '本计划不会调用外部模型或自动搜索网络。'
    observe_text_by_normal_scroll(p, form.get_by_text(boundary, exact=True), boundary, '真实批准前阅读零外部调用边界')
    status, accepted = _capture_response(p, 'POST', '/api/workspace/plans/' + draft['id'] + '/execute',
        lambda: p.submit('#execute-plan-form', after='#run-tab-summary [data-report-readout]'))
    assert status == 202
    _observe_report(p, dataset, query, '新完成报告：')
    run = p.get('/api/runs/' + accepted['id'])
    expect_saved_report(run, dataset, query, source_file)
    assert run['snapshot']['studio']['plan_id'] == draft['id']
    plan = p.get('/api/workspace/plans/' + draft['id'])
    assert plan['payload']['run_id'] == run['id']
    audit = p.get('/api/workspace/runs/' + run['id'] + '/audit')
    expect_integrity(audit)
    assert audit['source_impact']['state'] == 'current'
    return run, plan, audit


def _download_report(p, run, dataset, query, source_file, audit, label):
    assert p.page.locator('#main ' + UNAVAILABLE).count() == 0
    downloads = {}
    for format in ('md', 'json'):
        link = p.visible('#main a[href$="export?format=' + format + '"]')
        assert link.get_attribute('href') == '/api/runs/' + run['id'] + '/export?format=' + format
        downloads[format] = download_visible(p, link, label + '.' + format, label + '：真实点击并打开' + format)
    checked = expect_export_bytes(downloads['json'], downloads['md'], run, dataset,
                                  query, source_file, audit['trace'])
    p.observations.setdefault('I9_native_exports', []).append({'run_id': run['id'], **checked})


def expect_bad_audit(audit):
    assert audit['report_integrity']['valid'] is False
    assert 'artifact_hash' in audit['report_integrity']['failures']
    assert audit['source_impact']['state'] == 'unavailable'
    reasons = [reason for reason in audit['source_impact']['reasons']
               if reason['code'] == 'report_integrity_failed']
    assert len(reasons) == 1 and '完整性' in reasons[0]['message']
    return reasons[0]['message']


def _observe_unavailable(p, scope, label):
    assert scope.locator('a[href*="/export"]').count() == 0, 'Known-bad report offers an export anchor.'
    reason = scope.locator(UNAVAILABLE)
    assert reason.count() == 1 and reason.is_visible()
    text = reason.inner_text().strip()
    assert all(word in text for word in ('导出已停用', '完整性', '新建研判'))
    observe_text_by_normal_scroll(p, reason, text, label)
    return text


def _revisit_bad_report(p, old, dataset, expected_audit, expected_run_ids):
    status, listing = _capture_response(p, 'GET', '/api/workspace/reports', lambda: p.navigate('reports'))
    assert status == 200 and not listing['has_more']
    assert {row['id'] for row in listing['items']} == expected_run_ids
    listed = one(listing['items'], old['id'])
    assert listed['query'] == QUERY and listed['title'] == old['result']['title']
    assert listed['source_impact'] == expected_audit['source_impact']
    target = p.page.locator('#main .title-button').filter(has=p.page.get_by_text(QUERY, exact=True))
    assert target.count() == 1 and target.get_attribute('data-route') == 'agents:run-' + old['id']
    row = p.page.locator('#main tbody tr').filter(has=target)
    assert row.count() == 1
    list_reason = _observe_unavailable(p, row, '按原问题找回坏报告：列表导出停用原因')
    status, audit = _capture_response(p, 'GET', '/api/workspace/runs/' + old['id'] + '/audit',
        lambda: p.step('从原问题的真实列表入口打开坏报告', lambda: target.click()))
    assert status == 200 and audit == expected_audit
    p.visible('#run-tab-summary')
    message = expect_bad_audit(audit)
    warning = p.visible('#run-strip').get_by_text('记录一致性异常', exact=True)
    assert warning.count() == 1
    observe_text_by_normal_scroll(p, warning, '记录一致性异常', '坏报告记录完整性警告可读')
    detail_reason = _observe_unavailable(p, p.visible('#main'), '坏报告详情导出停用与新建方向可读')
    impact = p.visible('#main').locator('.notice.warm').filter(has_text=message)
    assert impact.count() == 1
    observe_text_by_normal_scroll(p, impact, message, '旧报告保留原始内容并显示来源完整性异常')
    # Stored bytes remain available for diagnosis, but known-invalid numbers
    # must not continue to appear as the ordinary verified answer or chart.
    assert p.page.locator('#run-tab-summary [data-report-readout]').count() == 0
    assert p.page.locator('#run-tab-summary .metric-row').count() == 0
    assert p.page.locator('#main [data-action="action-from-report"], #main [data-x-action="watch-from-report"]').count() == 0
    original_question = p.visible('#main').get_by_text(QUERY, exact=True)
    assert original_question.count() == 1
    observe_text_by_normal_scroll(p, original_question, QUERY, '坏报告仍按原问题可找到，但不展示未核验主结论')
    assert p.get('/api/runs/' + old['id']) == old, 'Damaged artifact must never rewrite the saved original run.'
    p.observations.setdefault('I9_blocked_history_visits', []).append({
        'run_id': old['id'], 'list_reason': list_reason, 'detail_reason': detail_reason,
        'saved_result_hash': canonical_hash(old['result']), 'export_anchors': 0,
        'report_integrity': audit['report_integrity']})


def report_export_fresh_report(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir,
                            expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    if 'fault-injection' not in getattr(p, 'artifact_kinds', ()):
        raise RuntimeError('The native runner must explicitly admit the existing integrity fixture receipts.')
    p.observations['scope'] = SCENARIO
    p.observations['corruption_setup_boundary'] = {
        'setup': 'One declared owner-bound report_artifact fault in the existing disposable native CI database.',
        'user_actions': 'Visible CSV import, plan preview/approval, report list/detail, New research, native downloads.',
        'recovery': 'Create a distinct verified report; damaged history is neither restored nor repaired.',
        'backend_409': 'Covered separately by authenticated in-process tests; no absent UI download is invented.',
        'fixture_restore_called': False, 'production_fault_api': False,
    }
    p.bootstrap()
    csv = Path(p.directory) / 'synthetic-financial-input.csv'
    p.record_artifact(csv, kind='synthetic-input')
    source_file = {'name': csv.name, 'sha256': hashlib.sha256(csv.read_bytes()).hexdigest(), 'bytes': csv.stat().st_size}
    owner = p.get('/api/auth/me')['user']
    assert owner['email'].endswith('@test.example')
    dataset = p.get('/api/datasets/' + p.dataset_id)
    assert dataset['user_id'] == owner['id'] and dataset['payload']['company'] == FIXTURE_COMPANY
    assert dataset['version'] == 1 and dataset['content_hash'] == canonical_hash(dataset['payload'])
    assert p.get('/api/runs')['items'] == [] and p.get('/api/workspace/plans')['items'] == []
    p.navigate('agents')
    old, original_plan, healthy_audit = _create_report(p, dataset, QUERY, source_file)
    _download_report(p, old, dataset, QUERY, source_file, healthy_audit, 'I9-original-valid-report')
    assert p.get('/api/runs/' + old['id']) == old

    fault = inject_fault(p, data_dir=data_dir, kind='report_artifact', record_id=old['id'])
    p.observations['I9_report_fault'] = fault.receipt
    receipt = fault.receipt
    assert receipt['owner_id'] == owner['id'] and receipt['kind'] == 'report_artifact'
    assert receipt['table'] == 'agent_artifacts' and receipt['column'] == 'payload'
    assert receipt['before_sha256'] == canonical_hash(old['result'])
    assert receipt['before_sha256'] != receipt['after_sha256'] and not receipt['restored']
    assert receipt['ui_mutation_claimed'] is False and receipt['application_endpoint_added'] is False
    damaged_audit = p.get('/api/workspace/runs/' + old['id'] + '/audit')
    expect_bad_audit(damaged_audit)
    assert damaged_audit['trace'] == healthy_audit['trace']
    damaged = one(damaged_audit['artifacts'], receipt['record_id'])
    original = one(healthy_audit['artifacts'], receipt['record_id'])
    assert damaged['node'] == 'report' and not damaged['integrity_valid'] and damaged['event_anchor_valid']
    assert canonical_hash(damaged['payload']) == receipt['after_sha256']
    assert damaged['content_hash'] == original['content_hash'] == receipt['before_sha256']
    assert [row for row in damaged_audit['artifacts'] if row['id'] != damaged['id']] == [
        row for row in healthy_audit['artifacts'] if row['id'] != original['id']]
    _revisit_bad_report(p, old, dataset, damaged_audit, {old['id']})

    fresh_entry = p.visible('#main').get_by_role('button', name='新建研判', exact=True)
    assert fresh_entry.count() == 1 and fresh_entry.get_attribute('data-route') == 'agents'
    p.step('从坏报告的真实新建研判入口开始独立新报告', lambda: fresh_entry.click())
    p.visible('#plan-form')
    fresh, fresh_plan, fresh_audit = _create_report(p, dataset, FRESH_QUERY, source_file)
    assert fresh['id'] != old['id'] and fresh_plan['id'] != original_plan['id']
    assert fresh_plan['payload']['fingerprint'] != original_plan['payload']['fingerprint']
    _download_report(p, fresh, dataset, FRESH_QUERY, source_file, fresh_audit, 'I9-fresh-valid-report')
    _revisit_bad_report(p, old, dataset, damaged_audit, {old['id'], fresh['id']})
    assert p.get('/api/datasets/' + dataset['id']) == dataset
    assert p.get('/api/workspace/plans/' + original_plan['id']) == original_plan
    assert p.get('/api/workspace/plans/' + fresh_plan['id']) == fresh_plan
    assert p.get('/api/runs/' + fresh['id']) == fresh
    expect_integrity(p.get('/api/workspace/runs/' + fresh['id'] + '/audit'))
    plans, runs = p.get('/api/workspace/plans'), p.get('/api/runs')
    assert plans['total'] == 2 and not plans['has_more'] and not runs['has_more']
    assert {row['id'] for row in plans['items']} == {original_plan['id'], fresh_plan['id']}
    assert {row['id'] for row in runs['items']} == {old['id'], fresh['id']}
    assert len(p.observations['database_faults']) == 1 and not fault.restored and not receipt['restored']
    p.no_external()
    p.observations['I9_export_outcome'] = {
        'original_run_id': old['id'], 'fresh_run_id': fresh['id'],
        'original_plan_id': original_plan['id'], 'fresh_plan_id': fresh_plan['id'],
        'dataset_id': dataset['id'], 'dataset_version': 1, 'dataset_hash': dataset['content_hash'],
        'original_revenue_CNY': 100000, 'original_cost_CNY': 80000, 'both_saved_margins': [.2, .2],
        'actual_native_downloads_opened': 4, 'old_saved_run_and_plan_unchanged': True,
        'old_report_still_invalid_and_export_blocked': True, 'fresh_report_valid': True,
        'fresh_plan_and_report_are_distinct': True, 'dataset_unchanged': True,
        'fixture_restore_called': False, 'provider_calls': 0,
        'scope_limit': 'One synthetic final-artifact fault; no claim about every corruption, live suppliers or full acceptance.',
    }
