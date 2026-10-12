"""Windows-native three-input strategy activation/rollback acceptance.

Only visible controls mutate application state. Corroboration uses same-origin
GETs. Synthetic human labels test local coverage, never real evidence quality.
This independent suite does not replace the held Linux one-input L9 journey.
"""
from __future__ import annotations

import csv
import hashlib
import io
import math
from pathlib import Path
from urllib.parse import urlsplit

try:
    from .product_audit_config import require_suite_runner
    from .product_first_use_audit import canonical_hash, csv_headers, download_visible, register_empty_workspace, require_native_contract
    from .product_integrity_outcomes import _capture_response, _error_submit
    from .product_strategy_journey import _read_groups, _rows
except ImportError:
    from product_audit_config import require_suite_runner
    from product_first_use_audit import canonical_hash, csv_headers, download_visible, register_empty_workspace, require_native_contract
    from product_integrity_outcomes import _capture_response, _error_submit
    from product_strategy_journey import _read_groups, _rows

COMPANY = '策略成功链合成电池企业（非真实财报）'
QUESTION = '2024-Q1毛利率是多少'
PERIODS = ('2024-Q1', '2024-Q2')
REVENUES = (100000, 125000, 160000)
MARGINS = (.2, .36, .5)
CAPABILITIES = ['quality', 'quant', 'counterevidence']
EVIDENCE_TITLE = '合成反向资料：仅用于本地能力回放'
EVIDENCE_TEXT = (COMPANY + '：2024-Q1毛利率是多少。以下为隔离验收而编写的合成反向资料。'
    '收入与成本的比例不能证明经营现金已经回收；还需原始现金流水。人工标记此段为反向资料仅供回放，'
    '不代表真实企业情况、事实核验、因果结论或模型准确率。')
REVIEW_NOTE = '人工接受此合成测试资料并标注反向立场，只检验本地能力覆盖，不代表事实认证。'
ASSESSMENT_NOTE = '隔离合成验收：原报告数值与输入相符；人工预期包含数据核验、量化计算和反向对照。仅允许冻结输入的本地回放。'
PASSWORD = 'Synthetic-only-L1-password-2026'


def fixture_csv(template, index):
    assert type(index) is int and 0 <= index < 3
    headers = csv_headers(template)
    values = {'营业收入': str(REVENUES[index]), '营业成本': '80000', '净利润': '5000', '经营现金流': '10000'}
    out = io.StringIO(newline='')
    writer = csv.writer(out, lineterminator='\n')
    writer.writerow(headers)
    for quarter in PERIODS:
        writer.writerow([quarter if name == '季度' else values.get(name, '') for name in headers])
    return out.getvalue().encode('utf-8-sig')


def expect_dataset(row, index):
    d = row['payload']
    assert row['version'] == 1 and row['content_hash'] == canonical_hash(d)
    assert d['company'] == COMPANY and d['currency'] == 'CNY'
    assert d['amount_unit'] == d['input_amount_unit'] == 'yuan'
    assert d['period_basis'] == 'standalone_quarter'
    assert d['source_kind'] == 'user_provided' and d['verification'] == 'unverified_user_input'
    assert d['source_url'] == '' and [x['period'] for x in d['periods']] == list(PERIODS)
    for x in d['periods']:
        assert (x['revenue'], x['cost'], x['net_profit'], x['cash_flow']) == (REVENUES[index], 80000, 5000, 10000)
        assert all(x.get(k) is None for k in ('assets', 'liabilities', 'equity_begin', 'equity_end', 'inventory',
            'sales_volume', 'production_volume', 'manufacturing_cost', 'rd_expense', 'lithium_price', 'industry_volatility'))


def expect_plan(row, dataset, *, version, counterevidence):
    p = row['payload']
    assert p['request']['query'] == QUESTION and p['snapshot']['dataset'] == dataset['payload']
    assert p['request']['execution']['depth'] is None and p['request']['execution']['local_recovery'] is False
    assert not p['request']['use_llm'] and p['max_calls'] == 0
    assert p['adaptive']['active_strategy_version'] == version
    assert ('counterevidence' in [n['id'] for n in p['nodes']]) is counterevidence
    assert p['adaptive']['strategy_basis'] == ('approved_local_policy' if counterevidence else 'built_in_rules')


def expect_report(run, dataset, index):
    r, s = run['result'], run['snapshot']
    assert run['state'] in ('succeeded', 'degraded')
    assert run['dataset_id'] == dataset['id'] and run['user_id'] == dataset['user_id']
    assert r['query'] == QUESTION and s['dataset'] == dataset['payload']
    assert s['dataset_version'] == r['dataset_version'] == 1
    assert s['dataset_hash'] == r['dataset_hash'] == dataset['content_hash']
    assert r['analysis']['current_period'] == '2024-Q1'
    assert math.isclose(r['analysis']['metrics']['gross_margin'], MARGINS[index], rel_tol=0, abs_tol=1e-12)
    assert r['llm']['state'] == 'not_requested' and r['llm']['calls'] == []
    assert len(r['readout']['facts']) == 1 and r['readout']['facts'][0]['id'] == 'gross_margin'
    assert math.isclose(r['readout']['facts'][0]['value'], MARGINS[index], abs_tol=1e-12)
    assert r['readout']['input_source']['file']['name'] == f'strategy-success-input-{index + 1}.csv'
    assert len(r['citations']) == 1 and r['citations'][0]['stance'] == 'contradicts'
    assert r['citations'][0]['title'] == EVIDENCE_TITLE and r['citations'][0]['excerpt'] == EVIDENCE_TEXT


def expect_evaluation(row, candidate, runs):
    p = row['payload']
    assert p['candidate_id'] == candidate['id'] and p['candidate_version'] == candidate['version']
    assert p['candidate_hash'] == canonical_hash(candidate['payload'])
    assert p['active_version'] == 0 and p['baseline'] is None
    assert p['unique_inputs'] == p['raw_consented_runs'] == p['scenario_cases'] == 3
    assert p['eligible'] is True and p['blockers'] == [] and p['regressions'] == []
    assert len(p['improvements']) == len(p['cases']) == len(p['case_bindings']) == 3 and p['external_calls'] == 0
    assert {c['partition'] for c in p['cases']} == {'development', 'holdout'}
    by_id = {r['id']: r for r in runs}
    assert {c['run_id'] for c in p['cases']} == set(by_id)
    signatures = []
    for case in p['cases']:
        run = by_id[case['run_id']]
        assert case['expected'] == CAPABILITIES
        assert case['source'] == {'query': QUESTION, 'company': COMPANY, 'target_period': '2024-Q1',
            'dataset_version': 1, 'dataset_hash': run['snapshot']['dataset_hash']}
        expected_math = canonical_hash(run['result']['analysis'])
        assert case['reference_math_hash'] == expected_math
        assert case['baseline']['covered'] == ['quality', 'quant']
        assert case['baseline']['missing'] == ['counterevidence']
        assert 'counterevidence' not in case['baseline']['planned_capabilities']
        assert 'counterevidence' not in case['baseline']['computations']
        assert 'counterevidence' in case['candidate']['planned_capabilities']
        assert case['candidate']['covered'] == sorted(CAPABILITIES) and case['candidate']['missing'] == []
        for side in ('baseline', 'candidate'):
            out = case[side]
            assert out['math_hash'] == expected_math and out['external_calls'] == 0
            assert out['comparison_hash'] is None and out['comparison_provenance'] is None
            assert all(out['computations'][cap]['status'] == 'completed' for cap in ('quality', 'quant'))
        reverse = case['candidate']['computations']['counterevidence']
        assert reverse['status'] == 'completed' and reverse['group_counts'] == {'supports': 0, 'contradicts': 1, 'context': 0}
        d = run['snapshot']['dataset']
        # These complete inputs differ in numeric content, not only filename/company.
        signatures.append(canonical_hash({k: d.get(k) for k in ('currency', 'amount_unit', 'volume_unit', 'period_basis', 'periods')}))
    assert len(set(signatures)) == 3
    return signatures


def expect_readable_reverse(*, baseline, candidate, baseline_evidence, candidate_evidence):
    assert all(word in baseline for word in ('未计划', '未满足', '未记录实际执行'))
    assert '已执行 · 完成' not in baseline and '满足已标注要求' not in baseline
    assert all(word in candidate for word in ('已计划', '已执行 · 完成', '满足已标注要求'))
    assert '未满足' not in candidate and '缺少所需资料' not in candidate
    assert all(word in baseline_evidence for word in ('支持资料：未记录', '反向资料：未记录', '背景资料：未记录'))
    assert all(word in candidate_evidence for word in ('支持资料：0 条', '反向资料：1 条', '背景资料：0 条'))


def _import(p, index):
    p.navigate('data')
    p.click('#main [data-action="import-dialog"]', after='#import-file-form')
    template = download_visible(p, p.visible('#import-file-form a[href="/api/import/template"]'),
        f'empty-template-{index + 1}.csv', '下载实际空白模板')
    blob = fixture_csv(template, index)
    name = f'strategy-success-input-{index + 1}.csv'
    path = Path(p.directory) / name
    path.write_bytes(blob)
    p.record_artifact(path, kind='synthetic-input')
    item = {'file': name, 'csv_sha256': hashlib.sha256(blob).hexdigest(), 'revenue_yuan': REVENUES[index]}
    p.observations.setdefault('fixture', {'synthetic': True, 'inputs': []})['inputs'].append(item)
    def fill():
        p.visible('#import-file-form [name="company"]').fill(COMPANY)
        p.visible('#import-file-form [name="amount_unit"]').select_option('yuan')
        p.visible('#import-file-form [name="basis"]').select_option('standalone_quarter')
        p.visible('#import-file-form [name="file"]').set_input_files(str(path))
    p.step(f'选择第{index + 1}份真实不同数值的合成CSV，金额为元', fill)
    p.submit('#import-file-form', after='#modal section.import-readable')
    for quarter in PERIODS:
        detail = p.visible('#modal section.import-readable').locator(f'details[data-preview-period="{quarter}"]')
        if detail.get_attribute('open') is None:
            p.step('展开导入季度 ' + quarter, lambda: detail.locator(':scope > summary').click())
        table = detail.locator(':scope > .preview-values')
        rows = _rows(table)
        assert rows[:4] == [['营业收入', format(REVENUES[index], ','), '元'], ['营业成本', '80,000', '元'],
                            ['经营现金流', '10,000', '元'], ['净利润', '5,000', '元']]
        _read_groups(p, [(table.locator('tbody tr').nth(i), rows[i]) for i in range(2)],
                     f'阅读第{index + 1}份{quarter}的原收入和成本')
    control = p.visible('#modal [data-action="commit-stage"]')
    status, saved = _capture_response(p, 'POST', '/api/workspace/imports/' + control.get_attribute('data-id') + '/commit',
        lambda: p.click('#modal [data-action="commit-stage"]'))
    assert status == 201
    p.step('等待本次新数据集保存并真实显示，不匹配上一份编辑器',
        lambda: p.visible(f'#dataset-editor[data-id="{saved["id"]}"][data-version="1"]'))
    expect_dataset(saved, index)
    item.update(dataset_id=saved['id'], dataset_hash=saved['content_hash'])
    p.dataset_id = saved['id']
    return saved


def _evidence(p):
    p.navigate('evidence')
    p.click('#main > header.page-heading [data-action="evidence-dialog"]', after='#evidence-form')
    def fill():
        for field, value in (('title', EVIDENCE_TITLE), ('text', EVIDENCE_TEXT), ('company', COMPANY)):
            p.visible(f'#evidence-form [name="{field}"]').fill(value)
        assert not p.visible('#evidence-form [name="global_scope"]').is_checked()
    p.step('通过原表单录入明确合成的企业内反向资料', fill)
    status, row = _capture_response(p, 'POST', '/api/evidence', lambda: p.submit('#evidence-form', after='#main[data-page="evidence"]'))
    assert status == 201
    p.click(f'#main [data-action="review-evidence"][data-id="{row["id"]}"]', after='#evidence-review-form')
    def review():
        p.visible('#evidence-review-form [name="status"]').select_option('accepted')
        p.visible('#evidence-review-form [name="stance"]').select_option('contradicts')
        p.visible('#evidence-review-form [name="note"]').fill(REVIEW_NOTE)
        assert not p.visible('#evidence-review-form [name="global_scope"]').is_checked()
    p.step('明确人工接受并标注反向立场，不声称资料事实正确', review)
    status, _ = _capture_response(p, 'PUT', '/api/workspace/evidence/' + row['id'] + '/review',
        lambda: p.submit('#evidence-review-form', after='#main[data-page="evidence"]'))
    assert status == 200
    saved = p.get('/api/workspace/evidence')['items']
    assert len(saved) == 1 and saved[0]['eligible'] and saved[0]['review']['stance'] == 'contradicts'
    return saved


def _preview(p, dataset, *, version=0, counterevidence=False):
    p.navigate('agents')
    def fill():
        p.visible('#plan-form [name="dataset_id"]').select_option(dataset['id'])
        p.visible('#plan-form [name="query"]').fill(QUESTION)
        p.visible('#plan-form [name="depth"]').select_option('')
        p.visible('#plan-form [name="local_recovery"]').uncheck()
        assert not p.visible('#use-llm').is_checked()
        assert not p.visible('#plan-form [name="forecast"]').is_checked()
    p.step('实际选择企业、原问题、遵循策略，并关闭自动追加本地核查', fill)
    status, row = _capture_response(p, 'POST', '/api/workspace/plans', lambda: p.submit('#plan-form', after='#execute-plan-form'))
    assert status == 201
    expect_plan(row, dataset, version=version, counterevidence=counterevidence)
    _read_groups(p, [(p.visible('#execute-plan-form').locator(':scope > p.micro'), ['本计划不会调用外部模型'])], '核对原授权表单的零外部调用范围')
    return row


def _read_report(p, index):
    section = p.visible('#run-tab-summary [data-report-readout]')
    facts = section.locator('table').first
    rows = _rows(facts)
    assert len(rows) == 1 and rows[0][:2] == ['2024-Q1', '毛利率']
    assert math.isclose(float(rows[0][2].rstrip('%')), MARGINS[index] * 100, abs_tol=.001)
    _read_groups(p, [(facts.locator('tbody tr'), ['2024-Q1', '毛利率', str(round(MARGINS[index] * 100))])], '阅读由本份原输入产生的毛利率')
    p.observations.setdefault('native_report_readouts', []).append({'index': index, 'fact_rows': rows})


def _report_and_assess(p, dataset, index):
    plan = _preview(p, dataset)
    status, accepted = _capture_response(p, 'POST', '/api/workspace/plans/' + plan['id'] + '/execute',
        lambda: p.submit('#execute-plan-form', after='#run-tab-summary [data-report-readout]'))
    assert status == 202
    run = p.get('/api/runs/' + accepted['id'])
    expect_report(run, dataset, index)
    _read_report(p, index)
    p.click('#run-tab-summary [data-action="assessment-dialog"]', after='#assessment-form')
    def assess():
        form = p.visible('#assessment-form')
        assert not form.locator('[name="consent_replay"]').is_checked()
        form.locator('[name="verdict"]').select_option('needs_revision')
        form.locator('[name="note"]').fill(ASSESSMENT_NOTE)
        for cap in CAPABILITIES:
            form.locator(f'[name="expected_capabilities"][value="{cap}"]').check()
        form.locator('[name="consent_replay"]').check()
    p.step('逐份明确人工预期与本地回放同意', assess)
    status, assessment = _capture_response(p, 'POST', '/api/workspace/runs/' + run['id'] + '/assessment',
        lambda: p.submit('#assessment-form', after='#run-tab-summary [data-report-readout]'))
    assert status == 200 and assessment['payload']['consent_replay'] is True
    assert assessment['payload']['expected_capabilities'] == CAPABILITIES
    return p.get('/api/workspace/plans/' + plan['id']), run, assessment


def _relogin(p, owner):
    p.step('原生刷新后核对策略持久化', lambda: p.page.reload(wait_until='domcontentloaded'))
    p.visible('#main[data-page="evolution"]')
    before = p.get('/api/workspace/evolution')['active']
    p.click('#sidebar [data-action="logout"]', after='#auth-form')
    if p.page.locator('#auth-form [name="name"]').count():
        p.click('[data-action="auth-toggle"]', after='#auth-form')
    def fill():
        p.visible('#auth-form [name="email"]').fill(owner['email'])
        p.visible('#auth-form [name="password"]').fill(PASSWORD)
    p.step('重新登录同一隔离合成账号', fill)
    p.submit('#auth-form', after='#main')
    p.navigate('evolution')
    assert p.get('/api/workspace/evolution')['active'] == before
    return before


def _decision(p, operation, accept, mutations, candidate, evaluation):
    selector = (f'#main [data-action="strategy-activate"][data-id="{candidate["id"]}"][data-evaluation="{evaluation["id"]}"]'
                if operation == 'activate' else '#main [data-action="strategy-rollback"]')
    path = '/api/workspace/strategies/' + (candidate['id'] + '/activate' if operation == 'activate' else 'rollback')
    before = p.get('/api/workspace/evolution')['active']
    offset = len(mutations)
    def action():
        return p.with_strategy_decision(operation=operation, accept=accept, action=lambda: p.visible(selector).click())
    if accept:
        status, result = _capture_response(p, 'POST', path, lambda: p.step('明确确认策略' + operation, action))
        assert status == 200
        p.page.locator('#main[data-page="evolution"] .evolution-hero h2').filter(
            has_text=candidate['payload']['name'] if operation == 'activate' else '内置目标驱动策略').wait_for()
        expected = {'evaluation_id': evaluation['id'], 'expected_active_version': 0} if operation == 'activate' else {'expected_active_version': 1}
        assert mutations[offset:] == [{'method': 'POST', 'path': path, 'body': expected}]
    else:
        p.step('真实取消策略' + operation + '并验证没有写请求', action)
        result = p.get('/api/workspace/evolution')['active']
        assert result == before and mutations[offset:] == []
    p.observations.setdefault('strategy_decision_receipts', []).append({'operation': operation, 'accepted': accept,
        'before': before, 'after': result, 'mutations': mutations[offset:]})
    return result


def strategy_success_journey(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_suite_runner('strategy-success')
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir,
        expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    p.observations['scope'] = {'financial_inputs': 3, 'native_budget_seconds': 300, 'synthetic_only': True,
        'human_labels_are_not_fact_verification': True, 'linux_L9_hold_unchanged': True}
    mutations = []
    def record(request):
        path = urlsplit(request.url).path
        if path.startswith('/api/') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            # Only preserve selected strategy mutation bodies; never auth/password payloads.
            row = {'method': request.method, 'path': path}
            if path.startswith('/api/workspace/strategies/') and path.endswith(('/activate', '/rollback')):
                row['body'] = request.post_data_json
            mutations.append(row)
    p.page.on('request', record)
    try:
        register_empty_workspace(p)
        owner = p.get('/api/auth/me')['user']
        evidence = _evidence(p)
        datasets, plans, runs, assessments = [], [], [], []
        for index in range(3):
            d = _import(p, index)
            plan, run, assessment = _report_and_assess(p, d, index)
            datasets.append(d); plans.append(plan); runs.append(run); assessments.append(assessment)
        stale = _preview(p, datasets[-1])
        p.navigate('evolution')
        before = p.get('/api/workspace/evolution')
        assert before['active'] is None and before['observations']['consented_cases'] == 3
        status, proposal = _capture_response(p, 'POST', '/api/workspace/evolution/propose',
            lambda: p.click('#main [data-action="strategy-propose"]', after='#main [data-action="strategy-activate"]'))
        assert status == 201 and proposal['automatic_activation'] is False and proposal['external_calls'] == 0
        candidate, evaluation = proposal['candidate'], proposal['evaluation']
        signatures = expect_evaluation(evaluation, candidate, runs)
        p.observations['native_created_strategy_success'] = {'synthetic': True, 'created_through_visible_controls': True,
            'candidate_id': candidate['id'], 'evaluation_id': evaluation['id']}
        card = p.visible('#main').locator('.evaluation-card').filter(has=p.page.locator(f'[data-action="evaluation-detail"][data-id="{evaluation["id"]}"]'))
        _read_groups(p, [(card.locator('.row-between .badge'), ['本地门槛通过']),
            (card.locator(':scope > p').first, ['3 份不同输入', '3 项改善', '0 项回归'])], '阅读三输入真实本地门槛结果')
        p.step('实际打开三份原始案例的逐例回放', lambda: card.locator('[data-action="evaluation-detail"]').click())
        for i, case in enumerate(evaluation['payload']['cases']):
            visible = p.visible(f'#inspector [data-replay-case="{i}"]')
            _read_groups(p, [(visible.locator('[data-replay-query]'), [QUESTION]),
                (visible.locator(':scope > .row-between'), ['保留组' if case['partition'] == 'holdout' else '开发组']),
                (visible.locator(':scope > p.micro').first, [COMPANY, '2024-Q1', '第 1 次修订'])], '读取真实输入分组与原问题')
            table = visible.locator('table').nth(0)
            reverse = table.locator('tbody tr').filter(has_text='反向对照')
            evidence_table = visible.locator('table').nth(1)
            evidence_row = evidence_table.locator('tbody tr').first
            columns = {'baseline': reverse.locator('td').nth(1).inner_text(),
                'candidate': reverse.locator('td').nth(2).inner_text(),
                'baseline_evidence': evidence_row.locator('td').nth(0).inner_text(),
                'candidate_evidence': evidence_row.locator('td').nth(1).inner_text()}
            expect_readable_reverse(**columns)
            p.observations.setdefault('readable_case_columns', []).append({'index': i, **columns})
            _read_groups(p, [(table.locator('thead'), ['人工预期能力', '基线', '候选']),
                (reverse.locator('td').nth(0), ['反向对照']),
                (reverse.locator('td').nth(1), ['未计划', '未满足']),
                (reverse.locator('td').nth(2), ['已执行 · 完成', '满足已标注要求'])],
                '逐列读取基线缺失与候选真实完成，不允许交换两列')
            _read_groups(p, [(evidence_table.locator('thead'), ['基线', '候选']),
                (evidence_row.locator('td').nth(0), ['反向资料：未记录']),
                (evidence_row.locator('td').nth(1), ['反向资料：1 条'])],
                '逐列读取基线未执行与候选一条合成人工标签')
            math_row = visible.locator('table').nth(2).locator('tbody tr').first
            assert _rows(visible.locator('table').nth(2))[0] == ['数学结果', '与原报告一致', '与原报告一致']
            _read_groups(p, [(math_row, ['与原报告一致']),
                (visible.locator(':scope > .notice > span'), ['人工标签', '不证明有效反证或事实正确性'])],
                '核对两侧数学结果不变，同时阅读合成人工标签的限制')
        # Close the inspector using its real control before clicking main-page decisions.
        p.click('#inspector [data-action="close-inspector"]')
        _decision(p, 'activate', False, mutations, candidate, evaluation)
        active = _decision(p, 'activate', True, mutations, candidate, evaluation)
        assert active['version'] == 1 and active['payload']['candidate_id'] == candidate['id']
        assert _relogin(p, owner) == active
        p.navigate('agents')
        p.click(f'#main [data-route="agents:plan-{stale["id"]}"]', after='#execute-plan-form',
                label='从当前范围计划的真实入口找回最近未执行旧计划')
        before_runs = p.get('/api/runs')['items']
        denied = _error_submit(p, '#execute-plan-form', '/api/workspace/plans/' + stale['id'] + '/execute', 'PLAN_STALE')
        assert p.get('/api/runs')['items'] == before_runs
        assert p.get('/api/workspace/plans/' + stale['id']) == stale
        future = _preview(p, datasets[-1], version=1, counterevidence=True)
        p.navigate('evolution')
        _decision(p, 'rollback', False, mutations, candidate, evaluation)
        rolled = _decision(p, 'rollback', True, mutations, candidate, evaluation)
        assert rolled['version'] == 2 and rolled['payload']['spec'] is None
        assert _relogin(p, owner) == rolled
        after_rollback = _preview(p, datasets[-1], version=2, counterevidence=False)
        p.navigate('reports')
        p.click(f'#main [data-route="agents:run-{runs[0]["id"]}"]', after='#run-tab-summary [data-report-readout]',
                label='回滚后从真实报告列表打开第一份原报告')
        _read_report(p, 0)
        final = p.get('/api/workspace/evolution')
        assert final['candidates'] == [candidate]
        assert [r['payload'] for r in final['evaluations']] == [evaluation['payload']]
        assert {r['id']: r['payload'] for r in final['assessments']} == {r['id']: r['payload'] for r in assessments}
        assert p.get('/api/workspace/evidence')['items'] == evidence
        for i, run in enumerate(runs):
            now = p.get('/api/runs/' + run['id'])
            assert now['result'] == run['result'] and now['snapshot'] == run['snapshot']
            assert p.get('/api/workspace/runs/' + run['id'] + '/audit')['report_integrity']['valid']
            assert p.get('/api/workspace/plans/' + plans[i]['id']) == plans[i]
        assert {d['id']: d for d in p.get('/api/datasets')['items']} == {d['id']: d for d in datasets}
        for draft in (stale, future, after_rollback):
            assert p.get('/api/workspace/plans/' + draft['id']) == draft
        assert len(p.get('/api/runs')['items']) == 3 and len(p.get('/api/workspace/plans')['items']) == 6
        assert sum(r['path'] == '/api/workspace/evolution/propose' for r in mutations) == 1
        assert sum(r['path'] == '/api/workspace/plans' for r in mutations) == 6
        for draft in [*plans, stale]:
            assert sum(r['path'] == '/api/workspace/plans/' + draft['id'] + '/execute' for r in mutations) == 1
        p.observations['success_chain'] = {'input_signatures': signatures, 'candidate': candidate, 'evaluation': evaluation,
            'original_runs': runs, 'original_plans': plans, 'stale_plan': stale, 'stale_error': denied,
            'active_plan': future, 'rollback_plan': after_rollback, 'mutations': mutations,
            'historical_snapshots_unchanged': True, 'real_external_supplier_calls': 0}
        p.no_external()
    finally:
        p.page.remove_listener('request', record)
