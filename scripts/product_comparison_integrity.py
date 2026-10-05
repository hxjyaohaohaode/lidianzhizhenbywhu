"""Independent I4: a corrupt archived comparison is not usable historical evidence.

Import-only module. The existing hosted native runner owns browser/server setup.
Normal records are created through visible UI; only the named disposable-DB
fault is synthetic. API GETs corroborate identity and frozen values, never
substitute for the user's comparison/report/action/Watch flow.
"""
from __future__ import annotations
from copy import deepcopy
from pathlib import Path
import json
import math
import re

try:
    from .product_browser_audit import FIXTURE_COMPANY, FIXTURE_QUARTERS
    from .product_integrity_outcomes import _guard, _error_submit
    from .product_first_use_audit import canonical_hash
    from .native_integrity_faults import inject_fault
except ImportError:
    from product_browser_audit import FIXTURE_COMPANY, FIXTURE_QUARTERS
    from product_integrity_outcomes import _guard, _error_submit
    from product_first_use_audit import canonical_hash
    from native_integrity_faults import inject_fault

PEER = '独立I4对照合成企业（非真实财报）'
COMPARISON = 'I4两家合成企业的明确口径对照'
NOTE = '两家均为隔离合成单季度输入，仅核查保存来源与恢复链；不作为行业排名或投资建议。'
QUERY = '2024-Q4毛利率核查：核对两家合成企业的明确可比口径'
ORIGINAL_ACTION = 'I4原报告的第一份合成核对行动'
RECOVERED_ACTION = 'I4从完整原报告重新建立的核对行动'
WATCH = 'I4拒绝坏摘要后重新建立的跟踪'


def _one(rows, predicate):
    found = [row for row in rows if predicate(row)]
    assert len(found) == 1, f'Expected one independently identifiable record, got {len(found)}'
    return found[0]


def _select_label(p, selector, prefix, expected):
    element = p.visible(selector)
    choices = element.locator('option').evaluate_all('(items) => items.map(x=>({label:x.label,value:x.value}))')
    choice = _one(choices, lambda x: x['label'].startswith(prefix))
    assert choice['value'] == expected
    p.step('按实际可读名称选择：' + prefix, lambda: element.select_option(label=choice['label']))
    assert element.input_value() == expected


def _open_action(p, title, expected_id):
    p.navigate('actions')
    card = p.page.locator('#main .action-card').filter(has=p.page.get_by_role('heading', name=title, exact=True))
    card.wait_for(state='visible', timeout=10000)
    assert card.count() == 1 and card.get_attribute('data-id') == expected_id
    p.step('从真实行动列表按标题打开：' + title, lambda: card.click())
    return p.visible('#inspector .business-source')


def _create_from_report(p, title, run):
    p.click('#main [data-action="action-from-report"]', after='#action-form')
    p.fill('#action-form [name="title"]', title)
    p.fill('#action-form [name="acceptance"]', '人工核对两家企业的完整原报告、保存口径与实际来源，记录是否可以继续使用。')
    assert not p.visible('#action-form [name="allow_historical"]').is_checked()
    p.submit('#action-form')
    row = _one(p.get('/api/workspace/actions')['items'], lambda x: x['payload']['title'] == title)
    assert row['source_impact']['state'] == 'current'
    assert row['payload']['provenance']['run_id'] == run['id']
    assert row['payload']['provenance']['report_hash'] == canonical_hash(run['result'])
    return row


def _source_link(p, panel, run):
    link = panel.get_by_role('button', name='查看原始报告', exact=True)
    assert link.count() == 1 and link.get_attribute('data-route') == 'agents:run-' + run['id']
    p.step('通过行动详情的原始报告入口核对完整来源', lambda: link.click())
    p.visible('#run-tab-summary')
    assert p.get('/api/runs/' + run['id'])['result'] == run['result']


def _watch_fields(p):
    form = 'form[data-service-form="watch"]'
    p.fill(form + ' [name="title"]', WATCH)
    p.select(form + ' [name="metric"]', 'gross_margin')
    p.select(form + ' [name="operator"]', 'lt')
    p.fill(form + ' [name="threshold"]', '0.1')
    return form


def comparison_receipt_recovery(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    _guard(p, repository_root, data_dir, expected_web_tree, expected_server_tree)
    if not callable(getattr(p, 'with_expected_dialog', None)):
        raise RuntimeError('I4 needs the reviewed one-shot exact unsaved-draft confirmation helper before starting.')
    p.observations['scope'] = 'One independent I4 task; real two-company comparison/report/action creation, one explicit temporary action-archive fault, real rejection and reconstruction from the intact report.'
    p.bootstrap()
    p.record_artifact(Path(p.directory) / 'synthetic-financial-input.csv', kind='synthetic-input')
    primary_id = p.dataset_id
    primary = p.get('/api/datasets/' + primary_id)
    p.navigate('data')
    p.click('#main [data-action="import-dialog"]', after='#import-file-form')
    assert p.visible('#import-file-form [name="target_id"]').input_value() == ''
    p.fill('#import-file-form [name="company"]', PEER)
    p.select('#import-file-form [name="amount_unit"]', 'yuan')
    p.select('#import-file-form [name="basis"]', 'standalone_quarter')
    csv = '季度,营业收入,营业成本,经营现金流,净利润,总资产,总负债,期末净资产,期初净资产,库存金额,研发费用\n'
    csv += ''.join(f'{q},120000,84000,12000,6000,600000,240000,360000,360000,24000,3600\n' for q in FIXTURE_QUARTERS)
    source = Path(p.directory) / 'i4-peer-synthetic-input.csv'
    source.write_bytes(csv.encode('utf-8-sig'))
    p.record_artifact(source, kind='synthetic-input')
    p.step('真实文件控件选择第二家合成企业输入', lambda: p.visible('#import-file-form [name="file"]').set_input_files(str(source)))
    p.submit('#import-file-form', after='#modal [data-action="commit-stage"]')
    assert len(p.get('/api/datasets')['items']) == 1
    assert PEER in p.visible('#modal').inner_text() and '尚未写入财务库' in p.visible('#modal').inner_text()
    p.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="1"]')
    datasets = p.get('/api/datasets')['items']
    assert len(datasets) == 2
    peer = _one(datasets, lambda x: x['payload']['company'] == PEER)
    assert peer['version'] == 1 and peer['id'] != primary_id
    assert all(x['revenue'] == 120000 and x['cost'] == 84000 for x in peer['payload']['periods'])

    p.navigate('compare')
    # The second import can leave its company active; choose the actual primary
    # via the visible global selector before later Action list filtering.
    _select_label(p, '#active-dataset', FIXTURE_COMPANY + ' · ', primary_id)
    p.visible('#compare-form')
    assert p.visible('#active-dataset').input_value() == primary_id
    for company, dataset_id in ((FIXTURE_COMPANY, primary_id), (PEER, peer['id'])):
        choice = p.visible('#compare-form').locator('label.choice').filter(has=p.page.get_by_text(company, exact=True))
        assert choice.count() == 1 and choice.locator('input[name="dataset_ids"]').get_attribute('value') == dataset_id
        p.step('明确勾选实际企业：' + company, lambda choice=choice: choice.locator('input').check())
    p.select('#compare-form [name="comparison"]', 'year_over_year')
    p.submit('#compare-form', after='#comparison-save-form')
    assert '共同季度 · 2024-Q4' in p.visible('#comparison-output').inner_text()
    p.fill('#comparison-save-form [name="name"]', COMPARISON)
    p.fill('#comparison-save-form [name="comparability_note"]', NOTE)
    p.submit('#comparison-save-form', after='#comparison-transfer-form')
    comparison_id = p.visible('#comparison-transfer-form').get_attribute('data-id')
    comparison = p.get('/api/workspace/comparisons/' + comparison_id)
    assert comparison['payload']['name'] == COMPARISON and comparison['payload']['comparability_note'] == NOTE
    assert comparison['payload']['period'] == '2024-Q4'
    assert {x['id'] for x in comparison['payload']['members']} == {primary_id, peer['id']}
    for dataset_id, margin in ((primary_id, .2), (peer['id'], .3)):
        item = _one(comparison['payload']['result']['items'], lambda x: x['id'] == dataset_id)
        assert math.isclose(item['analysis']['metrics']['gross_margin'], margin, abs_tol=1e-12)
    _select_label(p, '#comparison-transfer-form [name="primary_dataset_id"]', FIXTURE_COMPANY + ' · ', primary_id)
    p.submit('#comparison-transfer-form', after='#plan-form')
    assert p.visible('#plan-comparison').input_value() == comparison_id
    assert all(company in p.visible('#selected-comparison-details').inner_text() for company in (FIXTURE_COMPANY, PEER))
    p.fill('#plan-form [name="query"]', QUERY)
    assert not p.visible('#use-llm').is_checked()
    p.submit('#plan-form', after='#execute-plan-form')
    plan_id = p.visible('#execute-plan-form').get_attribute('data-id')
    plan = p.get('/api/workspace/plans/' + plan_id)
    assert plan['payload']['bindings']['comparison_artifact'] == {'id':comparison_id,'version':comparison['version'],'hash':comparison['comparison_hash']}
    assert p.page.locator('#execute-plan-form [name="external_consent"]').count() == 0
    assert '本计划不会调用外部模型' in p.visible('#execute-plan-form').inner_text()
    p.submit('#execute-plan-form', after='#run-tab-summary .metric-row')
    href = p.visible('#main a[href$="export?format=json"]').get_attribute('href')
    match = re.fullmatch(r'/api/runs/([A-Za-z0-9_-]+)/export\?format=json', href or '')
    assert match
    run = p.get('/api/runs/' + match.group(1))
    assert run['dataset_id'] == primary_id and run['result']['llm']['state'] == 'not_requested'
    assert run['snapshot']['comparison_artifact']['payload'] == comparison['payload']
    assert p.get('/api/workspace/runs/' + run['id'] + '/audit')['report_integrity']['valid']
    p.dataset_id = primary_id
    original = _create_from_report(p, ORIGINAL_ACTION, run)
    original_receipt = deepcopy(original['payload']['provenance']['comparison_reference'])
    assert original_receipt['projection_hash'] == canonical_hash(original_receipt['payload'])
    panel = _open_action(p, ORIGINAL_ACTION, original['id'])
    assert panel.locator('.comparison-receipt').count() == 1 and NOTE in panel.inner_text()
    p.step('正常原行动可阅读已校验的两企业摘要', lambda: panel.locator('.comparison-receipt').scroll_into_view_if_needed())
    p.click('#inspector [data-action="close-inspector"]')

    fault = inject_fault(p, data_dir=data_dir, kind='action_comparison', record_id=original['id'], expected_payload_hash=original['object_hash'])
    p.observations['action_comparison_fault'] = fault.receipt
    panel = _open_action(p, ORIGINAL_ACTION, original['id'])  # real fresh list refreshes the action hash
    broken = _one(p.get('/api/workspace/actions')['items'], lambda x: x['id'] == original['id'])
    assert broken['version'] == original['version'] and broken['object_hash'] != original['object_hash']
    assert broken['source_impact']['state'] == 'unavailable'
    assert any(x['code'] == 'comparison_receipt_changed' for x in broken['source_impact']['reasons'])
    assert panel.locator('.comparison-receipt').count() == 0, 'Unverified archived numbers must not retain a trustworthy original-summary presentation.'
    assert '校验失败' in panel.inner_text() and '原始企业对照摘要' not in panel.inner_text()
    assert '仅隔离验收：对照摘要被临时损坏' not in panel.inner_text(), 'Faulted note is not usable source prose.'
    p.step('实际行动详情只说明坏摘要不可用，并保留原报告入口', lambda: panel.scroll_into_view_if_needed())
    p.click('#inspector [data-x-action="watch-from-action"]', after='form[data-service-form="watch"]')
    form = _watch_fields(p)
    ref = json.loads(p.page.locator(form + ' [name="source_ref"]').get_attribute('value'))
    assert ref['action_id'] == broken['id'] and ref['action_hash'] == broken['object_hash']
    p.step('明确勾选历史依据也不能把损坏档案变成可信来源', lambda: p.visible(form + ' [name="allow_historical"]').check())
    assert p.get('/api/services/tracking?identity_id=')['rules'] == []
    _error_submit(p, form, '/api/services/watches', 'SOURCE_INTEGRITY')
    assert p.get('/api/services/tracking?identity_id=')['rules'] == []
    assert p.visible(form + ' [name="title"]').input_value() == WATCH
    assert p.visible(form + ' [name="threshold"]').input_value() == '0.1'
    assert p.visible(form + ' [name="metric"]').input_value() == 'gross_margin'
    assert p.visible(form + ' [name="allow_historical"]').is_checked()
    assert '重新建立行动' in p.visible(form).inner_text()
    p.step('拒绝后真实表单保留标题阈值和明确选择，未生成跟踪', lambda: None)
    p.click('#modal [data-action="close-modal"]')
    panel = p.visible('#inspector .business-source')
    p.with_expected_dialog(
        dialog_type='confirm',
        message='当前输入尚未保存。离开后这些修改将丢失，是否继续？',
        action=lambda: _source_link(p, panel, run),
    )
    recovered = _create_from_report(p, RECOVERED_ACTION, run)
    assert recovered['id'] != original['id']
    assert recovered['payload']['provenance']['comparison_reference'] == original_receipt
    panel = _open_action(p, RECOVERED_ACTION, recovered['id'])
    assert '来源与当前一致' in panel.inner_text() and panel.locator('.comparison-receipt').count() == 1
    p.click('#inspector [data-x-action="watch-from-action"]', after=form)
    _watch_fields(p)
    assert not p.visible(form + ' [name="allow_historical"]').is_checked()
    p.submit(form)
    # The Watch modal can close while its underlying Action inspector remains.
    # Dismiss that real surface before reaching the actual sidebar.
    if p.page.locator('#inspector').get_attribute('open') is not None:
        p.click('#inspector [data-action="close-inspector"]')
    rules = p.get('/api/services/tracking?identity_id=')['rules']
    assert len(rules) == 1 and rules[0]['payload']['title'] == WATCH and rules[0]['source_impact']['state'] == 'current'
    assert rules[0]['payload']['provenance']['comparison_reference'] == original_receipt
    assert rules[0]['payload']['provenance']['run_id'] == run['id']
    p.navigate('tracking')
    card = p.page.locator('#main .watch-card').filter(has=p.page.get_by_role('heading', name=WATCH, exact=True))
    card.wait_for(state='visible', timeout=10000)
    assert card.count() == 1 and '来源与当前一致' in card.locator('.business-source').inner_text()
    p.step('实际跟踪页面显示重建来源；坏原行动并未被修写', lambda: card.locator('.business-source').scroll_into_view_if_needed())
    current_actions = p.get('/api/workspace/actions')['items']
    assert len(current_actions) == 2
    unchanged_broken = _one(current_actions, lambda x: x['id'] == original['id'])
    assert unchanged_broken['payload'] == broken['payload'] and unchanged_broken['version'] == broken['version']
    assert unchanged_broken['source_impact']['state'] == 'unavailable'
    assert p.get('/api/workspace/comparisons/' + comparison_id)['payload'] == comparison['payload']
    assert p.get('/api/runs/' + run['id'])['result'] == run['result']
    assert p.get('/api/datasets/' + primary_id)['payload'] == primary['payload']
    assert not fault.restored
    p.observations['comparison_receipt_recovery'] = {'comparison_id':comparison_id,'run_id':run['id'],
        'original_action_id':original['id'],'reconstructed_action_id':recovered['id'],'rule_id':rules[0]['id'],
        'faulted_action_version_unchanged':broken['version'],'original_archive_left_faulted':True,
        'intact_comparison_and_report_unchanged':True,'history_consent_could_not_override_integrity':True,
        'normal_setup_all_visible_ui':True,'fixture_restore_called':False}
    p.no_external()
