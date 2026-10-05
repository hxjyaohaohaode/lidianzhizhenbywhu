"""Independent I5/I6 source-rejection and real-user recovery outcomes.

Import-only: the existing authorized native CI runner supplies Probe, the
already-running temporary server, screenshots, trace and video. All ordinary
creation/review/recovery uses actual visible controls. Exactly one explicitly
recorded disposable-database fault per scenario is synthetic setup, not UI
evidence. A narrowly scoped read-only fixture query corroborates revision bytes
that the public revision-list endpoint deliberately does not return.
"""
from __future__ import annotations

from contextlib import closing
from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3

try:
    from .product_browser_audit import (
        FIXTURE_COMPANY, FIXTURE_COST, FIXTURE_REVENUE, FORM_TIMEOUT_MS,
        percentage_display, require_isolated_runner,
    )
    from .product_first_use_audit import canonical_hash
    from .product_readout_oracles import observe_text_by_normal_scroll
    from .product_integrity_outcomes import _guard, _capture_response, _error_submit
    from .native_integrity_faults import inject_fault
except ImportError:
    from product_browser_audit import (
        FIXTURE_COMPANY, FIXTURE_COST, FIXTURE_REVENUE, FORM_TIMEOUT_MS,
        percentage_display, require_isolated_runner,
    )
    from product_first_use_audit import canonical_hash
    from product_readout_oracles import observe_text_by_normal_scroll
    from product_integrity_outcomes import _guard, _capture_response, _error_submit
    from native_integrity_faults import inject_fault


QUERY = '2024-Q4毛利率是多少'
EVIDENCE_TITLE = 'I5合成原文：2024-Q4营业收入与营业成本核对'
EVIDENCE_TEXT = (
    '仅隔离验收的合成资料，非真实财报。' + FIXTURE_COMPANY +
    '：2024-Q4毛利率是多少，需要核对营业收入100000元、营业成本80000元。'
    '这些数字仅为本地完整性验收输入，不证明实际企业经营表现，不构成投资建议。'
)
INITIAL_REVIEW = '仅接受此合成企业的毛利率输入核对；原文仍未经独立事实认证。'
RECOVERED_REVIEW = '已重新核对合成原文，并明确重新授权原合成企业使用；须新建计划。'
UNSAVED_CONFIRM = '当前输入尚未保存。离开后这些修改将丢失，是否继续？'
RESTORE_CONFIRM = '确认恢复此历史内容并创建新的数据修订？'


def _one(rows, predicate):
    found = [row for row in rows if predicate(row)]
    assert len(found) == 1, f'Expected exactly one independently identified record, got {len(found)}'
    return found[0]


def _begin(p, scenario, repository_root, data_dir, expected_web_tree, expected_server_tree):
    _guard(p, repository_root, data_dir, expected_web_tree, expected_server_tree)
    if not callable(getattr(p, 'with_expected_dialog', None)):
        raise RuntimeError('The reviewed exact one-shot confirmation helper is required.')
    if 'fault-injection' not in getattr(p, 'artifact_kinds', ()):
        raise RuntimeError('The host must explicitly admit integrity fixture receipts.')
    p.observations['scope'] = scenario
    p.observations['recovery_boundary'] = {
        'normal_setup': 'actual visible product controls',
        'fault': 'one declared owner-bound temporary CI database mutation',
        'recovery': 'actual evidence review or trusted revision restore controls',
        'fixture_restore_called': False,
        'browser_server_trace_video_owner': 'existing native runner; not this module',
    }
    p.bootstrap()
    p.record_artifact(Path(p.directory) / 'synthetic-financial-input.csv', kind='synthetic-input')
    owner = p.get('/api/auth/me')['user']
    assert owner['email'].endswith('@test.example')
    data = p.get('/api/datasets/' + p.dataset_id)
    assert data['id'] == p.dataset_id and data['user_id'] == owner['id']
    assert data['version'] == 1 and canonical_hash(data['payload']) == data['content_hash']
    assert data['payload']['company'] == FIXTURE_COMPANY
    assert data['payload']['amount_unit'] == 'yuan'
    assert data['payload']['periods'][-1]['period'] == '2024-Q4'
    assert data['payload']['periods'][-1]['revenue'] == FIXTURE_REVENUE == 100000
    assert data['payload']['periods'][-1]['cost'] == FIXTURE_COST == 80000
    _no_created_output(p, owner['id'], [])
    return owner['id'], data


def _no_created_output(p, owner_id, plan_ids):
    """Corroborate zero business output, not a claim that no audit write exists."""
    assert p.get('/api/auth/me')['user']['id'] == owner_id
    plans = p.get('/api/workspace/plans')
    assert plans['total'] == len(plan_ids) and not plans['has_more']
    assert {r['id'] for r in plans['items']} == set(plan_ids)
    assert all(r['user_id'] == owner_id for r in plans['items'])
    runs = p.get('/api/runs')
    assert runs['items'] == [] and not runs['has_more'], 'Rejection must not queue even an unfinished run.'
    assert p.get('/api/conversations')['items'] == [], 'Rejected execution must not create a session.'
    assert p.get('/api/workspace/actions')['items'] == []
    assert p.get('/api/services/tracking?identity_id=')['rules'] == []
    return {'owner_id': owner_id, 'plan_ids': sorted(plan_ids), 'runs': 0,
            'conversations': 0, 'actions': 0, 'tracking_rules': 0}


def _no_report_ui(p):
    for selector in ('#run-tab-summary', '#main [data-report-readout]',
                     '#main a[href$="export?format=json"]', '#main a[href$="export?format=md"]'):
        assert p.page.locator(selector).count() == 0, 'Rejected request exposed report output: ' + selector


def _visible_response_error(p, form_selector, message):
    # Some forms legitimately contain another empty .form-error container.
    # Reuse the current exact server message, not a broad strict locator.
    error = p.visible(form_selector).locator('.form-error').filter(
        has_text=re.compile(r'^\s*' + re.escape(message) + r'\s*$'))
    error.wait_for(state='visible', timeout=FORM_TIMEOUT_MS)
    assert error.count() == 1 and error.inner_text().strip() == message
    return error


def _frozen_plan(plan):
    """Compare approved input, never incidental response timestamps/audit state."""
    payload = plan['payload']
    return deepcopy({key: payload[key] for key in (
        'request', 'snapshot', 'context', 'packing', 'bindings', 'nodes',
        'call_ids', 'max_calls', 'requested_max_calls', 'fingerprint',
    )})


def _assert_old_plan(p, original, frozen):
    current = p.get('/api/workspace/plans/' + original['id'])
    assert current['id'] == original['id'] and current['user_id'] == original['user_id']
    assert _frozen_plan(current) == frozen, 'New authorization must never refill an old approved input snapshot.'
    assert current['payload']['status'] == 'draft' and current['payload']['run_id'] is None
    return current


def _draft_plan(p):
    p.navigate('agents')
    p.fill('#plan-form [name="query"]', QUERY)
    assert p.visible('#plan-form [name="dataset_id"]').input_value() == p.dataset_id
    assert not p.visible('#use-llm').is_checked()
    return {name: p.visible('#plan-form [name="' + name + '"]').input_value()
            for name in ('dataset_id', 'query', 'mode', 'comparison', 'success_criteria')}


def _preview_plan(p, owner_id, dataset):
    _draft_plan(p)
    status, saved = _capture_response(
        p, 'POST', '/api/workspace/plans',
        lambda: p.submit('#plan-form', after='#execute-plan-form'),
    )
    assert status == 201
    plan_id = p.visible('#execute-plan-form').get_attribute('data-id')
    assert plan_id == saved['id']
    plan = p.get('/api/workspace/plans/' + plan_id)
    assert plan['user_id'] == owner_id and plan['payload']['status'] == 'draft'
    assert plan['payload']['run_id'] is None and plan['payload']['request']['query'] == QUERY
    assert plan['payload']['request']['dataset_id'] == dataset['id']
    assert plan['payload']['snapshot']['dataset'] == dataset['payload']
    assert plan['payload']['snapshot']['dataset_version'] == dataset['version']
    assert plan['payload']['snapshot']['dataset_hash'] == dataset['content_hash']
    assert plan['payload']['max_calls'] == 0 and not plan['payload']['request']['use_llm']
    assert p.page.locator('#execute-plan-form [name="external_consent"]').count() == 0
    assert '本计划不会调用外部模型' in p.visible('#execute-plan-form').inner_text()
    _no_report_ui(p)
    return plan


def _document(p, document_id):
    return _one(p.get('/api/workspace/evidence')['items'], lambda row: row['id'] == document_id)


def _open_review(p, document):
    p.navigate('evidence')
    title = p.page.get_by_role('button', name=EVIDENCE_TITLE, exact=False)
    row = p.page.locator('#main tbody tr').filter(has=title)
    row.wait_for(state='visible', timeout=FORM_TIMEOUT_MS)
    assert row.count() == 1
    named = row.locator('[data-action="evidence-detail"]')
    assert named.count() == 1 and named.get_attribute('data-id') == document['id']
    review = row.get_by_role('button', name='审阅', exact=True)
    assert review.count() == 1 and review.get_attribute('data-id') == document['id']
    p.step('从真实证据资料行按标题打开审阅与适用范围', lambda: review.click())
    form = p.visible('#evidence-review-form')
    assert form.get_attribute('data-id') == document['id']
    assert int(form.get_attribute('data-version')) == document['review_version']
    assert p.visible('#evidence-review-form [name="company"]').input_value() == document['review']['company']
    return form


def _save_review(p, document, note):
    _open_review(p, document)
    p.fill('#evidence-review-form [name="company"]', FIXTURE_COMPANY)
    assert not p.visible('#evidence-review-form [name="global_scope"]').is_checked()
    p.select('#evidence-review-form [name="status"]', 'accepted')
    p.select('#evidence-review-form [name="stance"]', 'context')
    p.fill('#evidence-review-form [name="note"]', note)
    status, response = _capture_response(
        p, 'PUT', '/api/workspace/evidence/' + document['id'] + '/review',
        lambda: p.submit('#evidence-review-form', after='#main[data-page="evidence"]'),
    )
    assert status == 200 and response['version'] == document['review_version'] + 1
    saved = _document(p, document['id'])
    assert saved['payload'] == document['payload'] and saved['content_hash'] == document['content_hash']
    assert saved['version'] == document['version'] and saved['user_id'] == document['user_id']
    assert saved['review_version'] == document['review_version'] + 1
    assert saved['eligible'] and saved['review']['status'] == 'accepted'
    assert saved['review']['company'] == FIXTURE_COMPANY and not saved['review']['global_scope']
    assert saved['review']['note'] == note
    return saved


def _show_plan_citation(p, plan, document):
    citations = plan['payload']['snapshot']['citations']
    assert len(citations) == 1, 'Short synthetic text must produce exactly the intended citation.'
    citation = _one(citations, lambda item: item['document_id'] == document['id'])
    assert citation['title'] == EVIDENCE_TITLE and citation['excerpt'] == EVIDENCE_TEXT
    assert citation['review_state'] == 'accepted' and citation['company_scope'] == FIXTURE_COMPANY
    assert citation['review_version'] == document['review_version']
    assert citation['review_hash'] == canonical_hash(document['review'])
    assert citation['document_version'] == document['version']
    assert citation['document_payload_hash'] == canonical_hash(document['payload'])
    assert citation['document_hash'] == document['content_hash']
    binding = _one(plan['payload']['bindings']['evidence'], lambda row: row['id'] == document['id'])
    assert binding['review_hash'] == citation['review_hash']
    assert binding['review_version'] == citation['review_version']
    summary = p.page.locator('#main summary').filter(has_text=re.compile(r'^已选证据 · 1 条$'))
    assert summary.count() == 1
    p.step('真实展开执行前已选证据，阅读合成原文与人工审阅标记', lambda: summary.click())
    card = summary.locator('..').locator('.citation').filter(
        has=p.page.get_by_role('heading', name=EVIDENCE_TITLE, exact=True))
    assert card.count() == 1 and card.is_visible()
    assert EVIDENCE_TEXT in card.inner_text() and '人工已审阅' in card.inner_text()
    # The preceding click's after-frame is the natural expanded viewport.
    # Separately prove important text can be read by ordinary scrolling.
    observe_text_by_normal_scroll(p, card.get_by_role('heading', name=EVIDENCE_TITLE, exact=True),
                                  EVIDENCE_TITLE, '已选证据的实际标题')
    observe_text_by_normal_scroll(p, card.get_by_text(EVIDENCE_TEXT, exact=True),
                                  EVIDENCE_TEXT, '已选证据的完整合成原文')
    return deepcopy(citation)


def _open_old_plan(p, original):
    p.navigate('agents')
    # This is a visible saved-plan control, never URL/hash navigation.
    button = p.page.locator('#main .list-link').filter(
        has=p.page.locator('strong').filter(has_text=re.compile('^' + re.escape(QUERY) + '$')))
    assert button.count() == 1, 'Before fresh preview the sole saved plan must remain discoverable.'
    assert button.get_attribute('data-route') == 'agents:plan-' + original['id']
    p.step('从真实当前范围计划列表重新打开被拒绝的原计划', lambda: button.click())
    assert p.visible('#execute-plan-form').get_attribute('data-id') == original['id']
    _no_report_ui(p)


def _execute_local_report(p, plan, dataset, owner_id):
    status, accepted = _capture_response(
        p, 'POST', '/api/workspace/plans/' + plan['id'] + '/execute',
        lambda: p.submit('#execute-plan-form', after='#run-tab-summary [data-report-readout]'),
    )
    assert status == 202

    def inspect_answer():
        readout = p.visible('#run-tab-summary [data-report-readout]')
        facts = readout.locator('table').nth(0).locator('tbody tr')
        assert facts.count() == 1
        cells = facts.first.locator('td').all_text_contents()
        assert cells[0].strip() == '2024-Q4' and cells[1].strip() == '毛利率'
        assert percentage_display(cells[2], '已保存结果', .2), cells
        value_cell = facts.first.locator('td').nth(2)
        displayed_margin = value_cell.locator('strong').inner_text().strip()
        source = readout.locator('table').nth(1).locator('tbody tr').filter(
            has=p.page.locator('td').filter(has_text=re.compile(r'^目标季度 / 数据修订$')))
        assert source.count() == 1
        shown_source = source.locator('td').nth(1).inner_text().strip()
        assert shown_source == '2024-Q4 / ' + str(dataset['version']), shown_source
        return ({'fact_cells': cells, 'displayed_margin': displayed_margin,
                 'source_revision_display': shown_source}, value_cell, source.locator('td').nth(1))

    # Read the actual answer first; corroborating GETs cannot substitute for it.
    visible, value_cell, source_cell = p.step('保留新报告到达后的自然视口，核对问题与结果', inspect_answer)
    observe_text_by_normal_scroll(p, value_cell, visible['displayed_margin'], '新报告毛利率20%的真实结果格')
    observe_text_by_normal_scroll(p, source_cell, visible['source_revision_display'], '新报告目标季度与数据修订的真实来源格')
    href = p.visible('#main a[href$="export?format=json"]').get_attribute('href')
    match = re.fullmatch(r'/api/runs/([A-Za-z0-9_-]+)/export\?format=json', href or '')
    assert match and match.group(1) == accepted['id']
    run = p.get('/api/runs/' + match.group(1))
    assert run['user_id'] == owner_id and run['dataset_id'] == dataset['id']
    assert run['state'] in ('succeeded', 'degraded') and run['result']
    assert run['snapshot']['studio']['plan_id'] == plan['id']
    assert run['snapshot']['dataset'] == dataset['payload']
    assert run['snapshot']['dataset_version'] == dataset['version']
    assert run['snapshot']['dataset_hash'] == dataset['content_hash']
    assert run['result']['dataset_version'] == dataset['version']
    assert run['result']['dataset_hash'] == dataset['content_hash']
    assert run['result']['llm']['state'] == 'not_requested'
    assert math.isclose(run['result']['analysis']['metrics']['gross_margin'], .2, abs_tol=1e-12)
    runs = p.get('/api/runs')
    assert len(runs['items']) == 1 and runs['items'][0]['id'] == run['id'] and not runs['has_more']
    assert p.get('/api/workspace/runs/' + run['id'] + '/audit')['report_integrity']['valid']
    p.observations['recovered_report'] = {'id': run['id'], 'plan_id': plan['id'],
        'dataset_id': dataset['id'], 'dataset_version': dataset['version'], **visible}
    return run


def _trusted_revision_bytes(p, data_dir, owner_id, trusted):
    """Non-UI authoritative corroboration, exact synthetic owner's v1 only."""
    require_isolated_runner(p.base_url, data_dir)
    root = Path(data_dir).resolve()
    if root != Path(os.environ.get('DATA_DIR', '')).resolve():
        raise RuntimeError('Read-only revision corroboration must use the running fixture DATA_DIR.')
    owner = p.get('/api/auth/me')['user']
    assert owner['id'] == owner_id and owner['email'].endswith('@test.example')
    assert trusted['id'] == p.dataset_id and trusted['user_id'] == owner_id and trusted['version'] == 1
    database = root / 'lidian.sqlite3'
    if not database.is_file() or database.is_symlink() or database.resolve().parent != root:
        raise RuntimeError('Existing regular native fixture database is required.')
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        assert db.execute('PRAGMA query_only').fetchone()[0] == 1
        active = db.execute('SELECT user_id FROM datasets WHERE id=? AND user_id=?',
                            (trusted['id'], owner_id)).fetchall()
        assert len(active) == 1
        rows = db.execute(
            'SELECT dataset_id,user_id,version,payload,content_hash,created_at FROM dataset_revisions '
            'WHERE dataset_id=? AND user_id=? AND version=?',
            (trusted['id'], owner_id, 1),
        ).fetchall()
        assert len(rows) == 1
        result = dict(rows[0])
    assert json.loads(result['payload']) == trusted['payload']
    assert canonical_hash(json.loads(result['payload'])) == result['content_hash'] == trusted['content_hash']
    return result


def evidence_review_scope_recovery(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    owner_id, dataset = _begin(p, 'I5: same-version evidence scope withdrawal → refusal → real review → new local plan/report',
                              repository_root, data_dir, expected_web_tree, expected_server_tree)
    fixture = Path(p.directory) / 'I5-synthetic-evidence-input.json'
    fixture.write_text(json.dumps({'synthetic': True, 'title': EVIDENCE_TITLE, 'text': EVIDENCE_TEXT,
        'company': FIXTURE_COMPANY, 'initial_review': INITIAL_REVIEW,
        'recovery_review': RECOVERED_REVIEW}, ensure_ascii=False, indent=2), encoding='utf-8')
    p.record_artifact(fixture, kind='synthetic-input')
    p.navigate('evidence')
    p.click('#main > header.page-heading [data-action="evidence-dialog"]', after='#evidence-form')
    p.fill('#evidence-form [name="title"]', EVIDENCE_TITLE)
    p.fill('#evidence-form [name="text"]', EVIDENCE_TEXT)
    p.fill('#evidence-form [name="company"]', FIXTURE_COMPANY)
    assert not p.visible('#evidence-form [name="global_scope"]').is_checked()
    status, created = _capture_response(p, 'POST', '/api/evidence',
        lambda: p.submit('#evidence-form', after='#main[data-page="evidence"]'))
    assert status == 201 and created['user_id'] == owner_id
    assert created['payload']['text'] == EVIDENCE_TEXT
    document = _save_review(p, _document(p, created['id']), INITIAL_REVIEW)
    original = _preview_plan(p, owner_id, dataset)
    citation = _show_plan_citation(p, original, document)
    frozen = _frozen_plan(original)
    _no_created_output(p, owner_id, [original['id']])

    fault = inject_fault(p, data_dir=data_dir, kind='evidence_review_scope',
                         record_id=document['id'], expected_payload_hash=citation['review_hash'])
    assert fault.receipt['owner_id'] == owner_id and fault.receipt['kind'] == 'evidence_review_scope'
    assert fault.receipt['version_preserved'] == document['review_version']
    p.observations['evidence_scope_fault'] = fault.receipt
    broken = _document(p, document['id'])
    expected_review = deepcopy(document['review'])
    expected_review.update(company='另一家隔离企业', global_scope=False)
    assert broken['review'] == expected_review and broken['review_version'] == document['review_version']
    assert broken['payload'] == document['payload'] and broken['version'] == document['version']
    assert broken['content_hash'] == document['content_hash']
    rejected = _error_submit(p, '#execute-plan-form',
                            '/api/workspace/plans/' + original['id'] + '/execute', 'PLAN_STALE')
    message = rejected['error']['message']
    assert all(word in message for word in ('范围', '审阅', '变化', '计划'))
    assert ('重新' in message or '新建' in message)
    observe_text_by_normal_scroll(p, _visible_response_error(p, '#execute-plan-form', message), message,
                                  'I5原计划执行拒绝的准确说明与恢复方向')
    assert p.visible('#execute-plan-form').get_attribute('data-id') == original['id']
    assert p.visible('#main').get_by_role('heading', name='确认执行计划', exact=True).count() == 1
    _no_report_ui(p)
    _assert_old_plan(p, original, frozen)
    assert _document(p, document['id'])['review'] == broken['review']
    assert p.get('/api/datasets/' + dataset['id'])['payload'] == dataset['payload']
    p.observations['I5_rejection_zero_output'] = _no_created_output(p, owner_id, [original['id']])
    p.step('原执行表单保留拒绝说明和原计划，没有报告或排队任务', lambda: None)

    reviewed = _save_review(p, broken, RECOVERED_REVIEW)
    assert canonical_hash(reviewed['review']) != citation['review_hash']
    _open_old_plan(p, original)
    old_again = _assert_old_plan(p, original, frozen)
    assert _show_plan_citation(p, old_again, document) == citation
    p.step('重新审阅后原计划仍显示旧冻结来源，没有回填新授权', lambda: None)
    fresh = _preview_plan(p, owner_id, dataset)
    assert fresh['id'] != original['id'] and fresh['payload']['fingerprint'] != original['payload']['fingerprint']
    fresh_citation = _show_plan_citation(p, fresh, reviewed)
    assert fresh_citation['review_version'] > citation['review_version']
    assert fresh_citation['review_hash'] != citation['review_hash']
    _no_created_output(p, owner_id, [original['id'], fresh['id']])
    run = _execute_local_report(p, fresh, dataset, owner_id)
    assert run['snapshot']['citations'] == fresh['payload']['snapshot']['citations']
    _assert_old_plan(p, original, frozen)
    assert not fault.restored
    p.observations['evidence_scope_recovery'] = {
        'document_id': document['id'], 'original_plan_id': original['id'], 'fresh_plan_id': fresh['id'],
        'old_review_version': document['review_version'], 'new_review_version': reviewed['review_version'],
        'old_review_hash': citation['review_hash'], 'new_review_hash': fresh_citation['review_hash'],
        'original_frozen_plan_unchanged': True, 'same_version_scope_fault_observed': True,
        'recovery_via_actual_review_form': True, 'fixture_restore_called': False,
    }
    p.no_external()


def dataset_source_recovery(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    owner_id, trusted = _begin(p, 'I6: latest payload/hash mismatch → preview refusal → real trusted v1 restore as v2 → local report',
                              repository_root, data_dir, expected_web_tree, expected_server_tree)
    original_revision = _trusted_revision_bytes(p, data_dir, owner_id, trusted)
    revision_api = p.get('/api/workspace/datasets/' + trusted['id'] + '/revisions')['items']
    assert len(revision_api) == 1 and revision_api[0]['version'] == 1 and revision_api[0]['integrity_valid']
    assert revision_api[0]['content_hash'] == trusted['content_hash']
    draft = _draft_plan(p)
    fault = inject_fault(p, data_dir=data_dir, kind='dataset_payload',
                         record_id=trusted['id'], expected_payload_hash=trusted['content_hash'])
    assert fault.receipt['owner_id'] == owner_id and fault.receipt['record_id'] == trusted['id']
    assert fault.receipt['kind'] == 'dataset_payload' and fault.receipt['version_preserved'] == 1
    p.observations['dataset_payload_fault'] = fault.receipt
    broken = p.get('/api/datasets/' + trusted['id'])
    expected_payload = deepcopy(trusted['payload'])
    expected_payload['periods'][-1]['cost'] += 1
    assert broken['id'] == trusted['id'] and broken['user_id'] == owner_id
    assert broken['version'] == trusted['version'] == 1 and broken['content_hash'] == trusted['content_hash']
    assert broken['payload'] == expected_payload and canonical_hash(broken['payload']) != broken['content_hash']
    assert _trusted_revision_bytes(p, data_dir, owner_id, trusted) == original_revision
    rejected = _error_submit(p, '#plan-form', '/api/workspace/plans', 'SOURCE_INTEGRITY')
    message = rejected['error']['message']
    assert all(word in message for word in ('财务', '校验', '未采用', '重新预览'))
    assert any(word in message for word in ('原始资料', '可信'))
    observe_text_by_normal_scroll(p, _visible_response_error(p, '#plan-form', message), message,
                                  'I6新计划预览拒绝的准确说明与恢复方向')
    assert {name: p.visible('#plan-form [name="' + name + '"]').input_value() for name in draft} == draft
    assert not p.visible('#use-llm').is_checked()
    assert p.page.locator('#execute-plan-form').count() == 0
    _no_report_ui(p)
    assert p.get('/api/datasets/' + trusted['id']) == broken
    p.observations['I6_rejection_zero_output'] = _no_created_output(p, owner_id, [])
    p.step('失败预览保留问题和企业选择，未保存计划或伪造报告', lambda: None)

    p.with_expected_dialog(dialog_type='confirm', message=UNSAVED_CONFIRM,
        action=lambda: p.navigate('data'))
    assert p.visible('#dataset-editor').get_attribute('data-id') == trusted['id']
    p.click('#main [data-action="data-revisions"]', after='#modal[open]')
    assert '恢复历史内容会创建新的修订' in p.visible('#modal').inner_text()
    summary = p.page.locator('#modal summary').filter(has_text=re.compile(r'^修订 1 · '))
    assert summary.count() == 1
    p.step('在真实修订记录中展开通过完整性校验的原修订1', lambda: summary.click())
    section = summary.locator('..')
    restore = section.get_by_role('button', name='以此内容创建新修订', exact=True)
    assert restore.count() == 1 and restore.is_visible()
    assert restore.get_attribute('data-action') == 'restore-revision'
    assert restore.get_attribute('data-revision') == '1'
    assert trusted['content_hash'] in section.inner_text() and '完整性异常' not in summary.inner_text()

    def restore_trusted():
        status, saved = _capture_response(p, 'POST', '/api/workspace/datasets/' + trusted['id'] + '/restore',
            lambda: p.with_expected_dialog(dialog_type='confirm', message=RESTORE_CONFIRM,
                action=lambda: restore.click()))
        assert status == 200 and saved['id'] == trusted['id'] and saved['version'] == 2
        p.visible('#dataset-editor[data-version="2"]')
        assert p.page.locator('#modal').get_attribute('open') is None
        return saved

    p.step('真实确认以可信历史内容创建同一数据集的新修订2', restore_trusted)
    current = p.get('/api/datasets/' + trusted['id'])
    assert current['id'] == trusted['id'] and current['user_id'] == owner_id and current['version'] == 2
    assert current['payload'] == trusted['payload'] and current['content_hash'] == trusted['content_hash']
    assert canonical_hash(current['payload']) == current['content_hash']
    datasets = p.get('/api/datasets')['items']
    assert len(datasets) == 1 and datasets[0]['id'] == trusted['id'] and datasets[0]['version'] == 2
    assert _trusted_revision_bytes(p, data_dir, owner_id, trusted) == original_revision
    revisions = p.get('/api/workspace/datasets/' + trusted['id'] + '/revisions')['items']
    assert [row['version'] for row in revisions] == [1, 2]
    assert revisions[0] == revision_api[0], 'Trusted original revision metadata must not be rewritten.'
    assert all(row['integrity_valid'] and row['content_hash'] == trusted['content_hash'] for row in revisions)
    assert not fault.restored
    _no_created_output(p, owner_id, [])
    fresh = _preview_plan(p, owner_id, current)
    _no_created_output(p, owner_id, [fresh['id']])
    _execute_local_report(p, fresh, current, owner_id)
    assert _trusted_revision_bytes(p, data_dir, owner_id, trusted) == original_revision
    p.observations['dataset_source_recovery'] = {
        'dataset_id': trusted['id'], 'trusted_original_revision': 1, 'new_revision': 2,
        'original_payload_bytes_sha256': hashlib.sha256(original_revision['payload'].encode()).hexdigest(),
        'original_revision_content_hash': trusted['content_hash'], 'original_revision_byte_preserved': True,
        'current_payload_equals_trusted_v1': True, 'no_replacement_dataset_created': True,
        'revision_byte_corroboration': 'non-UI read-only mode=ro/query_only, exact synthetic owner/dataset/v1',
        'recovery_via_actual_revision_controls': True, 'fixture_restore_called': False,
    }
    p.no_external()
