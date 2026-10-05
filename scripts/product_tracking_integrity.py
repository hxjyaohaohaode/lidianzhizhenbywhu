"""Independent I7 native existing-watch rejection and real revision recovery.

Import-only. The existing authorized native CI host owns Probe, server,
browser, screenshots, trace and video. Only one declared disposable-database
fixture write is admitted. All normal creation, navigation and recovery uses
visible product controls; tracking responses are captured from those controls.
Receipt/revision SELECTs are explicitly non-UI corroboration, not UI evidence.
"""
from __future__ import annotations

from contextlib import closing
from copy import deepcopy
from datetime import date, datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3

try:
    from .product_browser_audit import (
        FIXTURE_COMPANY, FORM_TIMEOUT_MS, percentage_display, require_isolated_runner,
    )
    from .product_first_use_audit import canonical_hash
    from .product_integrity_outcomes import _guard, _capture_response
    from .product_readout_oracles import observe_text_by_normal_scroll
    from .product_source_integrity import _trusted_revision_bytes
    from .native_integrity_faults import inject_fault
except ImportError:
    from product_browser_audit import (
        FIXTURE_COMPANY, FORM_TIMEOUT_MS, percentage_display, require_isolated_runner,
    )
    from product_first_use_audit import canonical_hash
    from product_integrity_outcomes import _guard, _capture_response
    from product_readout_oracles import observe_text_by_normal_scroll
    from product_source_integrity import _trusted_revision_bytes
    from native_integrity_faults import inject_fault


QUERY = '2024-Q4毛利率是多少'
WATCH_TITLE = 'I7合成原报告毛利率持续核对'
RESTORE_CONFIRM = '确认恢复此历史内容并创建新的数据修订？'
INTEGRITY_REASON = '当前财务输入校验失败，未计算或生成提醒；请核对原始资料或从可信修订恢复'
CLEAR_REASON = '已按用户阈值核对'
STALE_AFTER_DAYS = 1460


def _one(rows, predicate):
    matches = [row for row in rows if predicate(row)]
    assert len(matches) == 1, f'Expected one independently identified record, found {len(matches)}'
    return matches[0]


def _rule_record(row):
    # Live applicability is intentionally separate from immutable saved content.
    return deepcopy({key: value for key, value in row.items() if key != 'source_impact'})


def _receipt_rows(p, data_dir, owner_id, rule):
    """Read only the exact existing synthetic owner's original rule receipts."""
    require_isolated_runner(p.base_url, data_dir)
    root = Path(data_dir).resolve()
    if root != Path(os.environ.get('DATA_DIR', '')).resolve():
        raise RuntimeError('Receipt reads must use the already-running native fixture DATA_DIR.')
    owner = p.get('/api/auth/me')['user']
    assert owner['id'] == owner_id and owner['email'].endswith('@test.example')
    assert rule['user_id'] == owner_id and rule['kind'] == 'watch'
    assert rule['payload']['dataset_id'] == p.dataset_id
    database = root / 'lidian.sqlite3'
    if not database.is_file() or database.is_symlink() or database.resolve().parent != root:
        raise RuntimeError('Existing regular native fixture database required.')
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        assert db.execute('PRAGMA query_only').fetchone()[0] == 1
        originals = db.execute(
            "SELECT id,user_id,version,payload FROM workspace_objects WHERE id=? AND user_id=? AND kind='watch'",
            (rule['id'], owner_id),
        ).fetchall()
        assert len(originals) == 1
        original = dict(originals[0])
        assert original['version'] == rule['version']
        assert json.loads(original['payload']) == rule['payload']
        rows = db.execute(
            'SELECT rule_id,user_id,rule_version,dataset_version,created_at FROM tracking_receipts '
            'WHERE rule_id=? AND user_id=? ORDER BY rule_version,dataset_version,created_at',
            (rule['id'], owner_id),
        ).fetchall()
        result = [dict(row) for row in rows]
    p.observations.setdefault('tracking_receipt_reads', []).append({
        'evidence_kind': 'non-UI guarded read-only exact-owner/rule SQLite SELECT',
        'rule_id': rule['id'], 'owner_id': owner_id, 'rows': result,
    })
    return result


def _frozen_report(p, original, trusted):
    current = p.get('/api/runs/' + original['id'])
    assert current['id'] == original['id'] and current['user_id'] == original['user_id']
    assert current['dataset_id'] == trusted['id'] and current['payload'] == original['payload']
    assert current['result'] == original['result'] and current['snapshot'] == original['snapshot']
    assert current['snapshot']['dataset'] == trusted['payload']
    assert current['snapshot']['dataset_version'] == current['result']['dataset_version'] == 1
    assert current['snapshot']['dataset_hash'] == current['result']['dataset_hash'] == trusted['content_hash']
    audit = p.get('/api/workspace/runs/' + original['id'] + '/audit')
    assert audit['report_integrity']['valid'], audit['report_integrity']
    return audit


def _read_report(p, label):
    """Preserve natural arrival first, then observe original report value/source."""
    def inspect():
        readout = p.visible('#run-tab-summary [data-report-readout]')
        assert QUERY in readout.inner_text()
        facts = readout.locator('table').nth(0).locator('tbody tr')
        assert facts.count() == 1
        cells = facts.first.locator('td')
        assert cells.nth(0).inner_text().strip() == '2024-Q4'
        assert cells.nth(1).inner_text().strip() == '毛利率'
        value = cells.nth(2)
        assert percentage_display(value.inner_text(), '已保存结果', .2)
        text = value.locator('strong').inner_text().strip()
        source = readout.locator('table').nth(1).locator('tbody tr').filter(
            has=p.page.locator('td').filter(has_text=re.compile(r'^目标季度 / 数据修订$')))
        assert source.count() == 1
        authority = source.locator('td').nth(1)
        assert authority.inner_text().strip() == '2024-Q4 / 1'
        return value, text, authority
    value, text, authority = p.step(label + '：先保存自然报告视口并核对冻结回答', inspect)
    observe_text_by_normal_scroll(p, value, text, label + '：原报告毛利率20%')
    observe_text_by_normal_scroll(p, authority, '2024-Q4 / 1', label + '：原报告仍为修订1')


def _tracking_read(p, original_rule, dataset, expected_state, phase):
    """Exactly the real sidebar read; do not call p.get on tracking here."""
    status, body = _capture_response(
        p, 'GET', '/api/services/tracking', lambda: p.navigate('tracking'))
    assert status == 200 and body['engine'] == 'local_rules' and body['external_calls'] == 0
    assert len(body['rules']) == len(body['evaluations']) == 1
    rule = _one(body['rules'], lambda row: row['id'] == original_rule['id'])
    entry = _one(body['evaluations'], lambda row: row['rule_id'] == original_rule['id'])
    assert _rule_record(rule) == _rule_record(original_rule), 'Tracking reads/recovery must not rewrite the existing rule.'
    assert entry['rule_version'] == original_rule['version'] == 1
    assert entry['evaluation_revision'] == original_rule['payload']['evaluation_revision'] == 1
    assert entry['dataset_id'] == dataset['id'] and entry['dataset_version'] == dataset['version']
    assert entry['dataset_hash'] == dataset['content_hash']
    assert entry['operator'] == 'lt' and math.isclose(entry['threshold'], .1, abs_tol=1e-12)
    assert entry['state'] == expected_state and 'alert_id' not in entry
    assert body['alerts'] == [], 'An integrity failure or clear result must not generate an alert.'
    if expected_state == 'unknown':
        assert entry['reason'] == INTEGRITY_REASON
        assert 'value' not in entry and 'period' not in entry
    else:
        assert expected_state == 'clear' and entry['reason'] == CLEAR_REASON
        assert entry['metric'] == 'gross_margin' and entry['period'] == '2024-Q4'
        assert math.isclose(entry['value'], .2, abs_tol=1e-12)

    def inspect_card():
        card = p.page.locator('#main .watch-card').filter(
            has=p.page.get_by_role('heading', name=WATCH_TITLE, exact=True))
        card.wait_for(state='visible', timeout=FORM_TIMEOUT_MS)
        assert card.count() == 1 and p.page.locator('#main .watch-card').count() == 1
        assert card.locator('[data-x-action="watch-edit"]').get_attribute('data-id') == rule['id']
        assert card.locator('[data-x-action="watch-toggle"]').inner_text().strip() == '暂停'
        badge = card.locator(':scope > .row-between > .badge')
        wanted_status = '无法判断' if expected_state == 'unknown' else '未触发'
        assert badge.count() == 1 and badge.inner_text().strip() == wanted_status
        # Only direct child micro-paragraphs contain the actual evaluation line;
        # source applicability paragraphs inside .business-source are distinct.
        reason = card.locator(':scope > p.micro').filter(has_text=entry['reason'])
        assert reason.count() == 1
        reason_text = reason.inner_text().strip()
        if expected_state == 'unknown':
            assert reason_text == INTEGRITY_REASON and '当前值' not in reason_text
        else:
            assert '2024-Q4' in reason_text and re.search(r'当前值\s+0\.2(?!\d)', reason_text)
        assert p.page.locator('#main .alert-card').count() == 0
        empty = p.page.locator('#main').get_by_text('当前没有已触发提醒', exact=True)
        assert empty.count() == 1
        source = card.locator('.business-source')
        assert source.count() == 1 and '原始数据修订 1' in source.inner_text()
        source_badge = source.locator(':scope > .row-between > .badge')
        source_labels = {'current': '来源与当前一致', 'changed': '来源已有变化',
                         'unknown': '历史来源未绑定', 'unavailable': '部分来源不可用'}
        assert source_badge.count() == 1
        assert source_badge.inner_text().strip() == source_labels[rule['source_impact']['state']]
        assert original_rule['payload']['provenance']['dataset_hash'] in source.inner_text()
        reference = source.get_by_role('button', name='查看原始报告', exact=True)
        assert reference.count() == 1
        assert reference.get_attribute('data-route') == 'agents:run-' + original_rule['payload']['provenance']['run_id']
        return card, badge, reason, reason_text, empty

    card, badge, reason, reason_text, empty = p.step(phase + '：保留真实到达帧并核对现有规则结果', inspect_card)
    observe_text_by_normal_scroll(p, badge, badge.inner_text().strip(), phase + '：实际评估状态')
    observe_text_by_normal_scroll(p, reason, reason_text, phase + '：实际原因及当前数值是否存在')
    observe_text_by_normal_scroll(p, empty, '当前没有已触发提醒', phase + '：无提醒的真实列表')
    source_badge = card.locator('.business-source > .row-between > .badge')
    observe_text_by_normal_scroll(p, source_badge, source_badge.inner_text().strip(),
                                  phase + '：创建依据适用性与本次评估分开')
    if dataset['version'] == 2:
        source = card.locator('.business-source')
        current = source.locator('p').filter(has_text='当前数据修订 2；')
        assert current.count() == 1
        observe_text_by_normal_scroll(p, current, current.inner_text().strip(), phase + '：当前修订2与历史依据分开')
    p.observations.setdefault('tracking_native_reads', []).append({
        'phase': phase, 'method': 'GET', 'path': '/api/services/tracking',
        'read_origin': 'actual visible Tracking sidebar; this GET itself evaluates rules',
        'response': body, 'rendered_evaluation_text': reason_text,
        'evaluation_state': entry['state'], 'source_impact_state': rule['source_impact']['state'],
        'rendered_source_badge': source_badge.inner_text().strip(),
        'ratio_human_unit_readability': 'L4 remains open; raw 0.1/0.2 is not a percentage-unit pass',
    })
    return rule, entry, card


def _restore_from_revision(p, trusted, owner_id, data_dir, original_revision, revision_api):
    p.navigate('data')
    assert p.visible('#dataset-editor').get_attribute('data-id') == trusted['id']
    assert p.visible('#dataset-editor').get_attribute('data-version') == '1'
    p.click('#main [data-action="data-revisions"]', after='#modal[open]')
    notice = p.visible('#modal').get_by_text('恢复历史内容会创建新的修订，不会修改或抹除旧报告。', exact=True)
    assert notice.count() == 1
    summary = p.page.locator('#modal summary').filter(has_text=re.compile(r'^修订 1 · '))
    assert summary.count() == 1 and '完整性异常' not in summary.inner_text()
    p.step('I7真实展开可信原修订1，保留展开后的自然视口', lambda: summary.click())
    section = summary.locator('..')
    restore = section.get_by_role('button', name='以此内容创建新修订', exact=True)
    assert restore.count() == 1 and restore.is_visible()
    assert restore.get_attribute('data-action') == 'restore-revision'
    assert restore.get_attribute('data-revision') == '1'
    hash_line = section.locator(':scope > p.micro').filter(has_text=trusted['content_hash'])
    assert hash_line.count() == 1 and hash_line.inner_text().strip() == trusted['content_hash']
    observe_text_by_normal_scroll(p, notice, notice.inner_text().strip(), 'I7恢复说明保留旧报告与新建修订')
    observe_text_by_normal_scroll(p, hash_line, trusted['content_hash'], 'I7可信原修订1的真实校验值')
    observe_text_by_normal_scroll(p, restore, '以此内容创建新修订', 'I7用户可用的真实恢复控制')

    def restore_trusted():
        status, saved = _capture_response(
            p, 'POST', '/api/workspace/datasets/' + trusted['id'] + '/restore',
            lambda: p.with_expected_dialog(dialog_type='confirm', message=RESTORE_CONFIRM,
                                          action=lambda: restore.click()))
        assert status == 200 and saved['id'] == trusted['id'] and saved['version'] == 2
        p.visible('#dataset-editor[data-version="2"]')
        assert p.page.locator('#modal').get_attribute('open') is None
        return saved

    saved = p.step('I7明确原生确认，用可信原内容创建同一数据集修订2', restore_trusted)
    current = p.get('/api/datasets/' + trusted['id'])
    assert current['id'] == trusted['id'] and current['user_id'] == owner_id and current['version'] == 2
    assert current['payload'] == saved['payload'] == trusted['payload']
    assert current['content_hash'] == saved['content_hash'] == trusted['content_hash']
    assert canonical_hash(current['payload']) == current['content_hash']
    datasets = p.get('/api/datasets')['items']
    assert len(datasets) == 1 and datasets[0]['id'] == trusted['id'] and datasets[0]['version'] == 2
    revisions = p.get('/api/workspace/datasets/' + trusted['id'] + '/revisions')['items']
    assert [row['version'] for row in revisions] == [1, 2]
    assert revisions[0] == revision_api[0], 'Trusted v1 revision metadata must not be overwritten.'
    assert all(row['integrity_valid'] and row['content_hash'] == trusted['content_hash'] for row in revisions)
    assert _trusted_revision_bytes(p, data_dir, owner_id, trusted) == original_revision
    return current


def tracking_source_recovery(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    _guard(p, repository_root, data_dir, expected_web_tree, expected_server_tree)
    if not callable(getattr(p, 'with_expected_dialog', None)):
        raise RuntimeError('Reviewed exact single-shot native restore confirmation helper required.')
    if 'fault-injection' not in getattr(p, 'artifact_kinds', ()):
        raise RuntimeError('Host must explicitly admit fixture fault receipts.')
    age = (datetime.now(timezone.utc).date() - date(2024, 12, 31)).days
    assert 0 <= age <= STALE_AFTER_DAYS, 'Fixture quarter must be closed and within the explicitly selected rule age.'
    p.observations['scope'] = 'I7: existing normal watch → same-dataset checksum fault → unknown/no value → real trusted v1 restore as v2 → normal reevaluation'
    p.observations['recovery_boundary'] = {
        'normal_setup': 'actual visible product controls',
        'fault': 'one declared exact-owner disposable dataset-payload mutation',
        'recovery': 'actual trusted original revision restore with exact native confirm',
        'fixture_restore_called': False,
        'tracking_read_origin': 'actual UI GET response; no separate evaluating GET',
        'browser_server_trace_video_owner': 'existing native runner',
        'rule_stale_after_days': STALE_AFTER_DAYS, 'quarter_age_days_at_start': age,
        'L4_ratio_human_unit_readability': 'unclosed; I7 is not a percentage-unit readability pass',
    }
    p.bootstrap()
    p.record_artifact(Path(p.directory) / 'synthetic-financial-input.csv', kind='synthetic-input')
    owner = p.get('/api/auth/me')['user']
    owner_id = owner['id']
    assert owner['email'].endswith('@test.example')
    trusted = p.get('/api/datasets/' + p.dataset_id)
    assert trusted['id'] == p.dataset_id and trusted['user_id'] == owner_id and trusted['version'] == 1
    assert canonical_hash(trusted['payload']) == trusted['content_hash']
    assert trusted['payload']['company'] == FIXTURE_COMPANY and trusted['payload']['amount_unit'] == 'yuan'
    assert trusted['payload']['periods'][-1]['period'] == '2024-Q4'
    assert trusted['payload']['periods'][-1]['revenue'] == 100000
    assert trusted['payload']['periods'][-1]['cost'] == 80000
    original_revision = _trusted_revision_bytes(p, data_dir, owner_id, trusted)
    revision_api = p.get('/api/workspace/datasets/' + trusted['id'] + '/revisions')['items']
    assert len(revision_api) == 1 and revision_api[0]['version'] == 1 and revision_api[0]['integrity_valid']
    assert revision_api[0]['content_hash'] == trusted['content_hash']
    original_run = deepcopy(p.create_local_report(QUERY))
    assert original_run['user_id'] == owner_id and original_run['dataset_id'] == trusted['id']
    assert math.isclose(original_run['result']['analysis']['metrics']['gross_margin'], .2, abs_tol=1e-12)
    _read_report(p, 'I7建立规则前的原报告')
    _frozen_report(p, original_run, trusted)

    button = p.visible('#main [data-x-action="watch-from-report"]')
    assert button.inner_text().strip() == '从本报告建立跟踪'
    p.click('#main [data-x-action="watch-from-report"]', after='form[data-service-form="watch"]')
    form = 'form[data-service-form="watch"]'
    assert p.visible(form).get_attribute('data-version') == '0'
    chosen_dataset = p.visible(form + ' select[name="dataset_id"]')
    assert chosen_dataset.is_disabled() and chosen_dataset.input_value() == trusted['id']
    p.fill(form + ' [name="title"]', WATCH_TITLE)
    p.select(form + ' [name="metric"]', 'gross_margin')
    p.select(form + ' [name="operator"]', 'lt')
    p.fill(form + ' [name="threshold"]', '0.1')
    p.fill(form + ' [name="stale_after_days"]', str(STALE_AFTER_DAYS))
    assert p.visible(form + ' [name="expires_at"]').input_value() == ''
    assert p.visible(form + ' [name="active"]').is_checked()
    assert not p.visible(form + ' [name="allow_historical"]').is_checked()
    status, created = _capture_response(p, 'POST', '/api/services/watches', lambda: p.submit(form))
    assert status == 201 and created['kind'] == 'watch' and created['user_id'] == owner_id and created['version'] == 1
    assert p.page.locator('#modal').get_attribute('open') is None
    assert created['payload']['title'] == WATCH_TITLE and created['payload']['dataset_id'] == trusted['id']
    assert created['payload']['identity_id'] == '' and created['payload']['metric'] == 'gross_margin'
    assert created['payload']['operator'] == 'lt' and created['payload']['threshold'] == .1
    assert created['payload']['active'] and created['payload']['stale_after_days'] == STALE_AFTER_DAYS
    assert created['payload']['expires_at'] is None and created['payload']['changes'] == []
    assert created['payload']['evaluation_revision'] == 1
    origin = created['payload']['provenance']
    assert origin['kind'] == 'report' and origin['run_id'] == original_run['id']
    assert origin['report_hash'] == canonical_hash(original_run['result'])
    assert origin['dataset_id'] == trusted['id'] and origin['dataset_version'] == 1
    assert origin['dataset_hash'] == trusted['content_hash'] and created['source_impact']['state'] == 'current'
    original_rule = deepcopy(created)
    baseline_rule, _, _ = _tracking_read(p, original_rule, trusted, 'clear', 'I7健康基线')
    receipts = _receipt_rows(p, data_dir, owner_id, original_rule)
    assert receipts == []
    _frozen_report(p, original_run, trusted)
    assert baseline_rule['source_impact']['state'] == 'current'
    # Leave before the fixture change so the rejection is observed on a real
    # fresh Tracking navigation, never an in-memory mutation or extra API read.
    p.navigate('data')
    fault = inject_fault(p, data_dir=data_dir, kind='dataset_payload',
                         record_id=trusted['id'], expected_payload_hash=trusted['content_hash'])
    assert fault.receipt['owner_id'] == owner_id and fault.receipt['record_id'] == trusted['id']
    assert fault.receipt['kind'] == 'dataset_payload' and fault.receipt['version_preserved'] == 1
    broken = p.get('/api/datasets/' + trusted['id'])
    expected_payload = deepcopy(trusted['payload'])
    expected_payload['periods'][-1]['cost'] += 1
    assert broken['id'] == trusted['id'] and broken['user_id'] == owner_id
    assert broken['version'] == 1 and broken['content_hash'] == trusted['content_hash']
    assert broken['payload'] == expected_payload and canonical_hash(broken['payload']) != broken['content_hash']
    assert _trusted_revision_bytes(p, data_dir, owner_id, trusted) == original_revision
    broken_rule, _, _ = _tracking_read(p, original_rule, broken, 'unknown', 'I7损坏输入拒绝评估')
    assert broken_rule['source_impact']['state'] != 'current'
    assert _receipt_rows(p, data_dir, owner_id, original_rule) == receipts
    _frozen_report(p, original_run, trusted)
    assert p.get('/api/datasets/' + trusted['id']) == broken

    current = _restore_from_revision(p, trusted, owner_id, data_dir, original_revision, revision_api)
    recovered_rule, entry, card = _tracking_read(p, original_rule, current, 'clear', 'I7真实恢复后的同规则重读')
    assert recovered_rule['source_impact']['state'] == 'changed'
    assert recovered_rule['source_impact']['current']['version'] == 2
    assert recovered_rule['payload']['provenance'] == original_rule['payload']['provenance']
    assert _receipt_rows(p, data_dir, owner_id, original_rule) == receipts
    assert not fault.restored, 'Fixture byte repair cannot stand in for the real application restore.'
    reference = card.locator('.business-source').get_by_role('button', name='查看原始报告', exact=True)
    assert reference.get_attribute('data-route') == 'agents:run-' + original_run['id']
    p.step('I7从同一规则的实际创建依据入口打开原报告', lambda: reference.click())
    p.visible('#run-tab-summary [data-report-readout]')
    _read_report(p, 'I7恢复后重新打开的原报告')
    audit = _frozen_report(p, original_run, trusted)
    assert audit['source_impact']['state'] == 'changed'
    assert _trusted_revision_bytes(p, data_dir, owner_id, trusted) == original_revision
    runs = p.get('/api/runs')
    assert len(runs['items']) == 1 and runs['items'][0]['id'] == original_run['id'] and not runs['has_more']
    assert p.get('/api/workspace/actions')['items'] == []
    p.observations['tracking_source_recovery'] = {
        'rule_id': original_rule['id'], 'report_id': original_run['id'], 'dataset_id': trusted['id'],
        'original_rule_record_unchanged': True, 'original_rule_provenance_unchanged': True,
        'original_report_result_snapshot_unchanged': True, 'original_report_version': 1,
        'original_revision_byte_preserved': True,
        'original_revision_payload_sha256': hashlib.sha256(original_revision['payload'].encode()).hexdigest(),
        'current_dataset_version': 2, 'recovered_evaluation': entry,
        'same_dataset_restored_from_trusted_v1': True, 'fixture_restore_called': False,
        'no_new_alerts_or_tracking_receipts': True,
        'post_restore_source_impact': recovered_rule['source_impact'],
        'fault_source_impact': broken_rule['source_impact'],
        'native_watch_creation_status': status,
        'ratio_readability_L4': 'still open; raw threshold/current ratios do not prove human-unit readability',
    }
    p.no_external()
