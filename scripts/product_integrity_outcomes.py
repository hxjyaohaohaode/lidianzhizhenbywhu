"""Reviewer-owned native error/recovery tasks. Importing launches nothing.

Fixture mutation is explicitly separate from UI evidence and is restricted by
native_integrity_faults to the existing disposable hosted-CI database. The
owner must integrate that reviewed fixture and the exact report artifact kind.
"""
from __future__ import annotations
import math
from pathlib import Path
import re
from urllib.parse import urlsplit

try:
    from .product_browser_audit import (
        FORM_TIMEOUT_MS, FIXTURE_COMPANY, select_report_by_human_label,
        check_selection_summary, check_comparison, require_no_comparison,
    )
    from .product_first_use_audit import (
        require_native_contract, register_empty_workspace, download_visible,
        synthetic_csv, expect_dataset, canonical_hash,
    )
    from .service_browser_check import FORM_COMPLETION
    from .native_integrity_faults import inject_fault
except ImportError:
    from product_browser_audit import (
        FORM_TIMEOUT_MS, FIXTURE_COMPANY, select_report_by_human_label,
        check_selection_summary, check_comparison, require_no_comparison,
    )
    from product_first_use_audit import (
        require_native_contract, register_empty_workspace, download_visible,
        synthetic_csv, expect_dataset, canonical_hash,
    )
    from service_browser_check import FORM_COMPLETION
    from native_integrity_faults import inject_fault


def _capture_response(p, method, path, operation):
    with p.page.expect_response(lambda r: urlsplit(r.url).path == path and
                                r.request.method == method,
                                timeout=FORM_TIMEOUT_MS) as event:
        operation()
    response = event.value
    body = response.json()
    p.observations.setdefault('native_responses', []).append({
        'method': method, 'path': path, 'status': response.status,
        'error_code': (body.get('error') or {}).get('code') if isinstance(body, dict) else None,
    })
    return response.status, body


def _error_submit(p, form_selector, path, code, *, output=None):
    """Submit the real form, wait its original lifecycle, retain its error."""
    def operate():
        form = p.visible(form_selector)
        handle = form.element_handle()
        assert handle is not None
        status, body = _capture_response(p, 'GET' if form_selector == '#report-compare-form' else 'POST', path,
                                        lambda: form.locator('button[type="submit"]').click())
        assert status == 409 and body['error']['code'] == code, (status, body)
        errors = handle.evaluate(FORM_COMPLETION, FORM_TIMEOUT_MS)
        assert any(text.strip() for text in errors), 'Server rejection must remain visible in the actual form.'
        message = body['error']['message']
        error = form.locator('.form-error').filter(has_text=re.compile(r'^\s*' + re.escape(message) + r'\s*$'))
        error.wait_for(state='visible', timeout=FORM_TIMEOUT_MS)
        assert error.count() == 1, 'The exact current server error must identify one visible form message.'
        assert error.inner_text().strip() == message
        if output:
            require_no_comparison(p, output)
        return body
    return p.step('真实提交并核对拒绝与恢复说明：' + code, operate)



def _frontmost_dialog_geometry(locator):
    """Observe actual top-layer visibility; never scroll or alter the page."""
    view = locator.evaluate("""el => {
        const r = el.getBoundingClientRect(), dialog = el.closest('dialog');
        const d = dialog?.getBoundingClientRect(), head = dialog?.querySelector('.dialog-head')?.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {box:{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,right:r.right},
            viewport:{width:innerWidth,height:innerHeight},dialogOpen:!!dialog?.open,
            inModalTopLayer:!!dialog?.matches(':modal'),dialogTop:d?.top,dialogBottom:d?.bottom,
            headerBottom:head?.bottom,centerHit:!!hit && (el===hit || el.contains(hit)),
            focused:document.activeElement===el};
    }""")
    box = view['box']
    assert view['dialogOpen'] and view['inModalTopLayer'], view
    assert box['width'] > 0 and box['height'] > 0, view
    assert box['top'] >= max(0, view.get('headerBottom') or view['dialogTop']), view
    assert box['bottom'] <= min(view['viewport']['height'], view['dialogBottom']), view
    assert box['x'] >= 0 and box['right'] <= view['viewport']['width'] and view['centerHit'], view
    return view

def _form_state(p, form):
    return {name: p.visible(form + ' [name="' + name + '"]').input_value()
            for name in ('company', 'amount_unit', 'basis', 'target_id', 'merge_mode')}


def _guard(p, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir,
                            expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    p.observations['corruption_setup_boundary'] = 'Explicit owner-bound disposable database fixture, not a user interface mutation or production fault API.'


def integrity_import_recovery(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    _guard(p, repository_root, data_dir, expected_web_tree, expected_server_tree)
    register_empty_workspace(p)
    p.click('#main [data-action="import-dialog"]', after='#import-file-form')
    template = download_visible(p, p.visible('#import-file-form a[href="/api/import/template"]'),
                                'integrity-header-only-template.csv', '实际下载并打开导入模板')
    source = Path(p.directory) / 'integrity-intended-input.csv'
    source.write_bytes(synthetic_csv(template, corrected=True))
    p.record_artifact(source, kind='synthetic-input')
    p.fill('#import-file-form [name="company"]', '独立L1合成电池企业（非真实财报）')
    p.select('#import-file-form [name="amount_unit"]', 'wan')
    p.select('#import-file-form [name="basis"]', 'standalone_quarter')
    intended_form = _form_state(p, '#import-file-form')

    def preview():
        p.step('通过真实文件控件选择已核原文件', lambda: p.visible('#import-file-form [name="file"]').set_input_files(str(source)))
        status, result = _capture_response(p, 'POST', '/api/workspace/imports/file',
                                          lambda: p.submit('#import-file-form', after='#modal [data-action="commit-stage"]'))
        assert status == 201
        expect_dataset(result['payload']['dataset'])
        return result

    original = preview()
    assert p.get('/api/datasets')['items'] == []
    fault = inject_fault(p, data_dir=data_dir, kind='import_payload', record_id=original['id'])
    p.observations['import_fault'] = fault.receipt

    def reject_original():
        status, body = _capture_response(p, 'POST', '/api/workspace/imports/' + original['id'] + '/commit',
                                        lambda: p.visible('#modal [data-action="commit-stage"]').click())
        assert status == 409 and body['error']['code'] == 'PREVIEW_INTEGRITY', (status, body)
        error = p.visible('#modal [data-import-stage-error][role="alert"]')
        assert error.inner_text().strip() == body['error']['message'] and '未写入数据' in error.inner_text()
        error_geometry = _frontmost_dialog_geometry(error)
        assert error_geometry['focused'], 'The actual failure explanation must receive focus.'
        p.observations['import_error_visible'] = {'error':error_geometry,
            'back':_frontmost_dialog_geometry(p.visible('#modal [data-action="stage-back"]')),
            'confirm':_frontmost_dialog_geometry(p.visible('#modal [data-action="commit-stage"]')),
            'message':body['error']['message'],'probe_scroll_used':False}
        assert p.page.locator('#notifications .toast.error').filter(has_text=body['error']['message']).count() == 0
        assert p.get('/api/datasets')['items'] == [], 'A corrupt preview must not create any business data.'
        assert p.page.locator('#dataset-editor[data-version]').count() == 0
        return body
    rejected = p.step('损坏预览真实确认被拒绝，当前弹窗内说明及返回入口同屏可见且零写入', reject_original)
    p.click('#modal [data-action="stage-back"]', after='#import-file-form')
    assert p.page.locator('[data-import-stage-error]').count() == 0
    assert p.page.locator('#notifications .toast.error').filter(has_text=rejected['error']['message']).count() == 0
    assert _form_state(p, '#import-file-form') == intended_form
    assert p.visible('#import-file-form [name="file"]').input_value() == ''
    p.step('原生返回保留单位企业口径；原文件明确重选', lambda: None)
    fresh = preview()
    assert fresh['id'] != original['id'] and fresh['payload']['dataset']['periods'][0]['cost'] == 80000
    p.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="1"]')
    rows = p.get('/api/datasets')['items']
    assert len(rows) == 1 and rows[0]['version'] == 1
    expect_dataset(rows[0]['payload'])
    p.dataset_id = rows[0]['id']
    assert p.page.locator('#modal').get_attribute('open') is None
    assert not p.page.locator('#modal [data-import-stage-error]').is_visible()
    assert all(rejected['error']['message'] not in text for text in p.page.locator('#modal [data-import-stage-error]').all_text_contents())
    assert p.page.locator('#notifications .toast.error').filter(has_text=rejected['error']['message']).count() == 0
    p.step('新预览已保存同一份正确输入，原失败不再冒充当前状态', lambda: None)
    p.observations['import_recovery'] = {'original_stage': original['id'], 'fresh_stage': fresh['id'],
        'dataset_id': p.dataset_id, 'version': 1, 'intended_cost': 80000, 'non_file_context_preserved': True,
        'fault_left_only_in_disposable_original_stage': True}
    p.no_external()


def _revise_cost(p, value, version):
    p.navigate('data')
    row = p.visible('#dataset-editor').locator('[data-period-row]').filter(has=p.page.locator('[name="period"][value="2024-Q4"]'))
    # Inputs carry their initial value in this rendered form; verify the actual property too.
    assert row.count() == 1 and row.locator('[name="period"]').input_value() == '2024-Q4'
    p.step('在真实表单修改当前季度成本为' + str(value), lambda: row.locator('[name="cost"]').fill(str(value)))
    p.submit('#dataset-editor', after='#modal [data-action="commit-stage"]')
    p.click('#modal [data-action="commit-stage"]', after=f'#dataset-editor[data-version="{version}"]')
    current = p.get('/api/datasets/' + p.dataset_id)
    assert current['version'] == version and current['payload']['periods'][-1]['cost'] == value
    return current


def integrity_comparison_recovery(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    _guard(p, repository_root, data_dir, expected_web_tree, expected_server_tree)
    p.bootstrap()
    p.record_artifact(Path(p.directory) / 'synthetic-financial-input.csv', kind='synthetic-input')
    query = '2024-Q4毛利率是多少'
    left = p.create_local_report(query)
    assert math.isclose(left['result']['analysis']['metrics']['gross_margin'], .2, abs_tol=1e-9)
    _revise_cost(p, 75000, 2)
    right = p.create_local_report(query)
    assert math.isclose(right['result']['analysis']['metrics']['gross_margin'], .25, abs_tol=1e-9)
    _revise_cost(p, 70000, 3)
    p.navigate('reports')
    p.click('#main [data-action="report-compare-dialog"]', after='#report-compare-form')
    select_report_by_human_label(p, 'left', query, 1, left['id'])
    select_report_by_human_label(p, 'right', query, 2, right['id'])
    check_selection_summary(p, left, right, query)
    p.submit('#report-compare-form', after='#report-comparison table')
    check_comparison(p, left['id'], right['id'], .2, .25)
    for run in (left, right):
        audit = p.get('/api/workspace/runs/' + run['id'] + '/audit')
        assert audit['report_integrity']['valid'] and audit['source_impact']['state'] == 'changed'
    p.observations['healthy_historical_control'] = {'left': left['id'], 'right': right['id'], 'current_version': 3,
                                                   'frozen_values': [.2, .25], 'delta_points': 5}
    fault = inject_fault(p, data_dir=data_dir, kind='report_artifact', record_id=right['id'])
    p.observations['report_fault'] = fault.receipt
    _error_submit(p, '#report-compare-form', '/api/workspace/reports/compare', 'REPORT_INTEGRITY',
                  output='本次比较未完成，请核对错误后重新查看差异。')
    assert '对照报告' in p.visible('#report-compare-form .form-error').inner_text()
    for run in (left, right):
        assert p.get('/api/runs/' + run['id'])['result'] == run['result']
    fault.restore()  # Explicit fixture repair, never called a user control.
    p.submit('#report-compare-form', after='#report-comparison table')
    check_comparison(p, left['id'], right['id'], .2, .25)
    assert p.get('/api/workspace/runs/' + right['id'] + '/audit')['report_integrity']['valid']
    p.observations['report_retry'] = {'same_pair': [left['id'], right['id']], 'restored_original_bytes': True}
    p.no_external()


def _open_report_from_list(p, run, query):
    p.navigate('reports')
    target = p.page.locator('#main .title-button').filter(has=p.page.get_by_text(query, exact=True))
    assert target.count() == 1 and target.get_attribute('data-route') == 'agents:run-' + run['id']
    p.step('从真实列表按原问题打开冻结报告', lambda: target.click())
    p.visible('#run-tab-summary')


def integrity_memory_historical_choice(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    _guard(p, repository_root, data_dir, expected_web_tree, expected_server_tree)
    p.bootstrap()
    p.record_artifact(Path(p.directory) / 'synthetic-financial-input.csv', kind='synthetic-input')
    # Setting changes are explicit real user controls, not fixture preferences.
    if not p.visible('#preferences-form [name="memory_enabled"]').is_checked():
        p.step('明确允许批准记忆用于本地研究', lambda: p.visible('#preferences-form [name="memory_enabled"]').check())
        p.submit('#preferences-form', after='#preferences-form')
    p.navigate('memory')
    p.click('#main > header.page-heading [data-action="memory-dialog"]', after='#memory-form')
    note = '独立验收合成记忆：核对本企业毛利率原始收入与成本，不推断投资收益。'
    p.fill('#memory-form [name="text"]', note)
    p.fill('#memory-form [name="company"]', FIXTURE_COMPANY)
    p.select('#memory-form [name="role"]', 'all')
    p.step('由合成用户明确批准这条记忆', lambda: p.visible('#memory-form [name="approved"]').check())
    p.submit('#memory-form', after='#main[data-page="memory"]')
    memories = p.get('/api/memories')['items']
    assert len(memories) == 1 and memories[0]['payload']['text'] == note and memories[0]['payload']['approved']
    memory = memories[0]
    query = '2024-Q4毛利率是多少'
    p.navigate('agents'); p.fill('#plan-form [name="query"]', query)
    assert not p.visible('#use-llm').is_checked()
    p.submit('#plan-form', after='#execute-plan-form')
    summary = p.page.locator('#main summary').filter(has_text=re.compile(r'^已选记忆 · 1 条$'))
    assert summary.count() == 1
    p.step('真实展开执行前已选记忆，核对批准的原文', lambda: summary.click())
    assert note in summary.locator('..').inner_text()
    plan = p.get('/api/workspace/plans/' + p.visible('#execute-plan-form').get_attribute('data-id'))
    old_memory = plan['payload']['snapshot']['memory']
    assert len(old_memory) == 1 and old_memory[0]['id'] == memory['id']
    assert old_memory[0]['payload_hash'] == canonical_hash(memory['payload'])
    p.submit('#execute-plan-form', after='#run-tab-summary .metric-row')
    href = p.visible('#main a[href$="export?format=json"]').get_attribute('href')
    match = re.fullmatch(r'/api/runs/([A-Za-z0-9_-]+)/export\?format=json', href or '')
    assert match
    run = p.get('/api/runs/' + match.group(1))
    assert run['snapshot']['memory'] == old_memory
    fault = inject_fault(p, data_dir=data_dir, kind='memory_text', record_id=memory['id'], expected_payload_hash=old_memory[0]['payload_hash'])
    p.observations['memory_fault'] = fault.receipt
    current_memory = p.get('/api/memories')['items'][0]
    assert current_memory['version'] == memory['version'] and current_memory['payload']['text'] != note
    _open_report_from_list(p, run, query)
    audit = p.get('/api/workspace/runs/' + run['id'] + '/audit')
    assert audit['report_integrity']['valid'] and audit['source_impact']['state'] == 'changed'
    assert any(x['code'] == 'memory_changed' for x in audit['source_impact']['reasons'])
    assert '当前适用性需复核' in p.visible('#main').inner_text()
    assert p.get('/api/runs/' + run['id'])['result'] == run['result']
    p.step('相同版本的记忆变动可见，旧报告保持冻结', lambda: None)
    p.click('#main [data-action="action-from-report"]', after='#action-form')
    p.fill('#action-form [name="title"]', '合成历史报告跟进行动')
    p.fill('#action-form [name="acceptance"]', '人工重新核对原始收入成本及记忆变更，并记录适用范围。')
    assert not p.visible('#action-form [name="allow_historical"]').is_checked()
    assert p.get('/api/workspace/actions')['items'] == []
    _error_submit(p, '#action-form', '/api/workspace/actions', 'SOURCE_CHANGED')
    assert p.get('/api/workspace/actions')['items'] == []
    assert p.visible('#action-form [name="title"]').input_value() == '合成历史报告跟进行动'
    p.step('明确选择保留历史报告为依据', lambda: p.visible('#action-form [name="allow_historical"]').check())
    p.submit('#action-form')
    actions = p.get('/api/workspace/actions')['items']
    assert len(actions) == 1
    action = actions[0]
    assert action['source_impact']['state'] == 'changed'
    assert action['payload']['provenance']['run_id'] == run['id']
    assert action['payload']['provenance']['report_hash'] == canonical_hash(run['result'])
    p.navigate('actions')
    action_card = p.page.locator('#main .action-card').filter(has=p.page.get_by_role('heading', name='合成历史报告跟进行动', exact=True))
    assert action_card.count() == 1 and action_card.get_attribute('data-id') == action['id']
    p.step('从实际行动列表打开刚创建的历史依据事项', lambda: action_card.click())
    source_panel = p.visible('#inspector .business-source')
    assert '来源已有变化' in source_panel.inner_text()
    assert any(reason['message'] in source_panel.inner_text() for reason in action['source_impact']['reasons'] if reason['code'] == 'memory_changed')
    p.step('普通滚动阅读行动详情的历史依据与记忆变化', lambda: source_panel.scroll_into_view_if_needed())
    reference = source_panel.get_by_role('button', name='查看原始报告', exact=True)
    assert reference.count() == 1 and reference.get_attribute('data-route') == 'agents:run-' + run['id']
    p.step('从所建行动的真实来源链接回到原报告', lambda: reference.click())
    p.visible('#run-tab-summary')
    p.click('#main [data-x-action="watch-from-report"]', after='form[data-service-form="watch"]')
    form = 'form[data-service-form="watch"]'
    p.fill(form + ' [name="title"]', '合成历史依据指标跟踪')
    p.fill(form + ' [name="threshold"]', '.1')
    assert not p.visible(form + ' [name="allow_historical"]').is_checked()
    assert p.get('/api/services/tracking?identity_id=')['rules'] == []
    _error_submit(p, form, '/api/services/watches', 'SOURCE_CHANGED')
    assert p.get('/api/services/tracking?identity_id=')['rules'] == []
    p.step('明确选择历史依据后保存规则', lambda: p.visible(form + ' [name="allow_historical"]').check())
    p.submit(form)
    rules = p.get('/api/services/tracking?identity_id=')['rules']
    assert len(rules) == 1 and rules[0]['source_impact']['state'] == 'changed'
    assert rules[0]['payload']['provenance']['run_id'] == run['id']
    assert rules[0]['payload']['provenance']['report_hash'] == canonical_hash(run['result'])
    p.navigate('tracking')
    watch_card = p.page.locator('#main .watch-card').filter(has=p.page.get_by_role('heading', name='合成历史依据指标跟踪', exact=True))
    assert watch_card.count() == 1
    assert '来源已有变化' in watch_card.locator('.business-source').inner_text()
    assert any(reason['message'] in watch_card.inner_text() for reason in rules[0]['source_impact']['reasons'] if reason['code'] == 'memory_changed')
    p.step('真实跟踪规则页面保留来源变化状态而非当前可信标记', lambda: watch_card.scroll_into_view_if_needed())
    original_link = watch_card.get_by_role('button', name='查看原始报告', exact=True)
    assert original_link.count() == 1 and original_link.get_attribute('data-route') == 'agents:run-' + run['id']
    p.step('从新规则的真实来源链接核对原报告', lambda: original_link.click())
    p.visible('#run-tab-summary')
    assert p.get('/api/runs/' + run['id'])['result'] == run['result']
    p.observations['historical_reuse'] = {'run_id': run['id'], 'memory_id': memory['id'],
        'frozen_memory_hash': old_memory[0]['payload_hash'], 'action_id': action['id'], 'rule_id': rules[0]['id'],
        'explicit_choices': 2, 'both_rejections_zero_write': True, 'original_report_unchanged': True}
    p.no_external()
