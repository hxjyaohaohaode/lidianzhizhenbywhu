"""One-input human-assessment journey, awaiting reviewed native CI registration.

Importing starts nothing. The existing Probe/runner owns screenshots, trace,
video, the isolated server and its unchanged 300-second budget. All native
mutations below use visible controls; same-origin GETs only corroborate them.
No activation request is fabricated when the UI correctly offers no button.
This does not cover successful activation, rollback or three-input quality.
"""
from __future__ import annotations

import csv
import hashlib
import io
import math
from pathlib import Path
import re
from urllib.parse import urlsplit

try:
    from .product_first_use_audit import (
        canonical_hash, csv_headers, download_visible, register_empty_workspace,
        require_native_contract,
    )
    from .product_integrity_outcomes import _capture_response
    from .product_readout_oracles import _TEXT_GEOMETRY
except ImportError:
    from product_first_use_audit import (
        canonical_hash, csv_headers, download_visible, register_empty_workspace,
        require_native_contract,
    )
    from product_integrity_outcomes import _capture_response
    from product_readout_oracles import _TEXT_GEOMETRY

COMPANY = '策略回放合成电池企业（非真实财报）'
PERIODS = ('2024-Q1', '2024-Q2')
QUESTION = '2024-Q1毛利率是多少'
FILE_NAME = 'strategy-single-synthetic-input.csv'
EVIDENCE_TITLE = '合成背景资料：毛利率核查的适用边界'
EVIDENCE_TEXT = (COMPANY + '：2024-Q1毛利率是多少。收入100000元、成本80000元仅为隔离合成验收输入。'
    '本段只说明演示背景，不提供支持或反驳经营判断的证据；不是实际企业财报，也不是独立事实核验。')
REVIEW_NOTE = '隔离合成验收：仅作为本企业背景资料，人工接受不代表真实反证或事实认证。'
ASSESSMENT_NOTE = ('隔离合成验收：期望核验输入、量化计算及反向对照；收入100000元和成本80000元应得20%。'
    '只有一份财务输入和仅背景资料，未提供真实反证，不应制造改善或达到激活门槛。')
EXPECTED_CAPABILITIES = ['quality', 'quant', 'counterevidence']
MINIMUM_BLOCKER = '至少需要3份不同财务输入且明确授权的已完成人工验收案例'
NO_IMPROVEMENT = '未观察到需求覆盖改善或相同覆盖下的节点减少'
HOLDOUT_BLOCKER = '保留组仍有未覆盖的人工预期能力'
FORM_MS = 10_000


def fixture_csv(template):
    headers = csv_headers(template)
    values = {'营业收入': '100000', '营业成本': '80000', '净利润': '5000',
              '经营现金流': '10000'}
    stream = io.StringIO(newline='')
    writer = csv.writer(stream, lineterminator='\n')
    writer.writerow(headers)
    for period in PERIODS:
        writer.writerow([period if key == '季度' else values.get(key, '') for key in headers])
    return stream.getvalue().encode('utf-8-sig')


def expect_fixture(row):
    data = row['payload']
    assert row['version'] == 1 and row['content_hash'] == canonical_hash(data)
    assert data['company'] == COMPANY and data['currency'] == 'CNY'
    assert data['amount_unit'] == data['input_amount_unit'] == 'yuan'
    assert data['period_basis'] == 'standalone_quarter'
    assert data['source_kind'] == 'user_provided' and data['source_url'] == ''
    assert data['verification'] == 'unverified_user_input'
    assert [p['period'] for p in data['periods']] == list(PERIODS)
    for p in data['periods']:
        assert (p['revenue'], p['cost'], p['net_profit'], p['cash_flow']) == (100000, 80000, 5000, 10000)
        assert all(p.get(key) is None for key in ('assets', 'liabilities', 'equity_begin', 'equity_end',
            'inventory', 'sales_volume', 'production_volume', 'manufacturing_cost', 'rd_expense',
            'lithium_price', 'industry_volatility'))


def expect_report(run, dataset):
    result, snapshot = run['result'], run['snapshot']
    assert run['state'] in ('succeeded', 'degraded')
    assert run['user_id'] == dataset['user_id'] and run['dataset_id'] == dataset['id']
    assert run['payload']['query'] == result['query'] == QUESTION
    assert snapshot['dataset'] == dataset['payload']
    assert result['dataset_version'] == snapshot['dataset_version'] == 1
    assert result['dataset_hash'] == snapshot['dataset_hash'] == dataset['content_hash']
    assert result['analysis']['current_period'] == '2024-Q1'
    assert math.isclose(result['analysis']['metrics']['gross_margin'], .2, rel_tol=0, abs_tol=1e-12)
    assert result['llm']['state'] == 'not_requested' and result['llm']['calls'] == []
    assert snapshot['studio']['execution']['depth'] == 'balanced'
    facts = result['readout']['facts']
    assert len(facts) == 1 and facts[0]['id'] == 'gross_margin'
    assert facts[0]['value'] == .2 and facts[0]['period'] == '2024-Q1'
    assert [(x['path'], x['value'], x['unit']) for x in facts[0]['inputs']] == [
        ('periods/2024-Q1/revenue', 100000, 'CNY'), ('periods/2024-Q1/cost', 80000, 'CNY')]
    source = result['readout']['input_source']
    assert source['status'] == 'recorded' and source['file']['name'] == FILE_NAME
    assert source['input_amount_unit'] == 'yuan' and source['input_basis'] == 'standalone_quarter'
    assert len(result['citations']) == 1
    c = result['citations'][0]
    assert c['title'] == EVIDENCE_TITLE and c['excerpt'] == EVIDENCE_TEXT
    assert c['stance'] == 'context' and c['review_state'] == 'accepted'
    assert c['company_scope'] == COMPANY


def expect_blocked_evaluation(row, candidate, run=None):
    """An honest zero/one-input evaluation, with independently fixed math."""
    p = row['payload']
    count = 1 if run else 0
    assert row['user_id'] == candidate['user_id']
    assert p['candidate_id'] == candidate['id'] and p['candidate_version'] == candidate['version']
    assert p['candidate_hash'] == canonical_hash(candidate['payload'])
    assert p['active_version'] == 0 and p['baseline'] is None
    assert p['unique_inputs'] == p['raw_consented_runs'] == p['scenario_cases'] == count
    assert p['eligible'] is False and p['improvements'] == p['regressions'] == []
    assert p['external_calls'] == 0
    assert p['blockers'] == [MINIMUM_BLOCKER, NO_IMPROVEMENT] + ([HOLDOUT_BLOCKER] if run else [])
    assert len(p['cases']) == len(p['case_bindings']) == count
    if not run:
        return
    c = p['cases'][0]
    assert c['run_id'] == run['id'] and c['partition'] == 'holdout'
    assert c['expected'] == EXPECTED_CAPABILITIES
    assert c['source'] == {'query': QUESTION, 'company': COMPANY, 'target_period': '2024-Q1',
        'dataset_version': 1, 'dataset_hash': run['snapshot']['dataset_hash']}
    assert c['reference_math_hash'] == canonical_hash(run['result']['analysis'])
    for side in ('baseline', 'candidate'):
        out = c[side]
        assert out['covered'] == ['quality', 'quant'] and out['missing'] == ['counterevidence']
        assert math.isclose(out['recall'], 2 / 3, rel_tol=0, abs_tol=1e-12)
        assert out['math_hash'] == c['reference_math_hash'] and out['external_calls'] == 0
        assert out['comparison_hash'] is out['comparison_provenance'] is None
        assert all(out['computations'][cap]['status'] == 'completed' for cap in ('quality', 'quant'))
    assert c['reference_comparison_hash'] is None
    assert 'counterevidence' not in c['baseline']['planned_capabilities']
    assert 'counterevidence' not in c['baseline']['computations']
    candidate_output = c['candidate']['computations']['counterevidence']
    assert 'counterevidence' in c['candidate']['planned_capabilities']
    assert candidate_output['status'] == 'missing'
    assert candidate_output['group_counts'] == {'supports': 0, 'contradicts': 0, 'context': 1}
    assert candidate_output['reason'] and candidate_output['limitation']
    assert c['candidate']['node_count'] >= c['baseline']['node_count']


def expect_unchanged(actual, original):
    assert actual == original, 'Historical saved entity or payload was rewritten.'


def expect_readable_case(*, query, source, partition, capability_rows, evidence_cells, math_rows):
    """Human-table oracle; no technical JSON may stand in for these cells."""
    assert query == '原问题：' + QUESTION
    assert source.splitlines() == ['企业：' + COMPANY, '目标季度：2024-Q1', '原数据修订：第 1 次修订']
    assert partition == '保留组'
    assert len(capability_rows) == 3 and [r[0] for r in capability_rows] == ['数据核验', '量化计算', '反向对照']
    for row in capability_rows[:2]:
        assert len(row) == 3
        for cell in row[1:]:
            assert all(v in cell for v in ('已计划', '已执行 · 完成', '满足已标注要求', '依据 / 缺口：'))
    baseline, candidate = capability_rows[2][1:]
    assert all(v in baseline for v in ('未计划', '未记录实际执行', '未满足', '没有保存')) or all(
        v in baseline for v in ('未计划', '未记录实际执行', '未满足', '也未记录本地执行产物'))
    assert all(v in candidate for v in ('已计划', '已执行 · 缺少所需资料', '未满足', '依据 / 缺口：'))
    assert '满足已标注要求' not in baseline + candidate
    assert len(evidence_cells) == 2
    assert all(v in evidence_cells[0] for v in ('支持资料：未记录', '反向资料：未记录', '背景资料：未记录', '不能据此推断资料数量'))
    assert all(v in evidence_cells[1] for v in ('支持资料：0 条', '反向资料：0 条', '背景资料：1 条', '未提供此类资料'))
    assert math_rows == [['数学结果', '与原报告一致', '与原报告一致'],
        ['已选企业对照', '原任务未选企业对照（不适用）', '原任务未选企业对照（不适用）']]


def _read_groups(p, groups, label):
    """Read entire small related cells; preserve frames before scrolling onward.

    The locator must exclude SVG, hidden disclosures and raw JSON. Geometry is
    read-only; only ordinary scroll_into_view/pointer wheel changes the viewport.
    Several already visible cells share one screenshot. This keeps the original
    runner budget without shortening the reader's text or dropping evidence.
    """
    def read():
        pending = []
        frame = 0
        def capture():
            nonlocal frame
            if not pending:
                return
            frame += 1
            screenshot = p.screenshot('reader-' + str(frame))
            for item in pending:
                item['screenshot'] = screenshot
                p.observations.setdefault('complete_text_groups', []).append(item)
            pending.clear()
        for locator, required in groups:
            assert locator.count() == 1 and locator.is_visible()
            assert locator.locator('svg, pre, details:not([open]), [hidden]').count() == 0
            # Semantic needles come from rendered cell text, whose block breaks
            # are absent from textContent. Keep exact rendered-text checks and
            # use the complete original textContent only for DOM range geometry.
            rendered = locator.inner_text().strip()
            text = locator.text_content().strip()
            assert text and rendered and all(part in rendered for part in required), (label, rendered, required)
            geometry = locator.evaluate(_TEXT_GEOMETRY, text)
            if not geometry.get('visible'):
                capture()
                locator.scroll_into_view_if_needed()
            attempts = []
            for attempt in range(12):
                geometry = locator.evaluate(_TEXT_GEOMETRY, text)
                assert geometry.get('found'), 'Entire visible reading group is missing.'
                if geometry['visible']:
                    break
                box = geometry['root']
                assert box['right'] > box['left'] and box['bottom'] > box['top']
                clip = geometry['clip']
                # A nearly full-width row needs only its measured overflow:
                # a full horizontal page would overshoot to the opposite edge.
                dx = (max(-280, geometry['left'] - clip['left']) if geometry['left'] < clip['left']
                      else min(280, max(0, geometry['right'] - clip['right'])))
                dy = (-280 if geometry['top'] < clip['top']
                      else 280 if geometry['bottom'] > clip['bottom'] else 0)
                pointer = {'x': (box['left'] + box['right']) / 2, 'y': (box['top'] + box['bottom']) / 2}
                if not attempts:
                    p.observations.setdefault('reading_group_scrolls', []).append({
                        'label': label, 'text': text, 'required': required, 'attempts': attempts})
                movement = {'attempt': attempt + 1, 'before': geometry,
                    'pointer': pointer, 'wheel': {'delta_x': dx, 'delta_y': dy}}
                attempts.append(movement)
                p.page.mouse.move(pointer['x'], pointer['y'])
                p.page.mouse.wheel(dx, dy)
                p.page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                geometry = locator.evaluate(_TEXT_GEOMETRY, text)
                movement['after'] = geometry
                assert geometry.get('found'), 'Entire visible reading group is missing after scrolling.'
                movement['range_movement'] = {'x': geometry['left'] - movement['before']['left'],
                    'y': geometry['top'] - movement['before']['top']}
                if geometry['visible']:
                    break
            else:
                raise AssertionError('Complete reading group cannot fit through normal scrolling: ' + label)
            pending.append({'label': label, 'text': text, 'required': required,
                'geometry': geometry, 'manual_pixel_review': 'pending'})
        capture()
    p.step(label, read)


def _rows(table):
    return [[c.inner_text().strip() for c in row.locator('td').all()] for row in table.locator('tbody tr').all()]


def _import(p):
    p.navigate('data')
    p.click('#main [data-action="import-dialog"]', after='#import-file-form')
    template = download_visible(p, p.visible('#import-file-form a[href="/api/import/template"]'),
        'downloaded-empty-template.csv', '下载并打开真实空白CSV表头')
    blob = fixture_csv(template)
    path = Path(p.directory) / FILE_NAME
    path.write_bytes(blob)
    p.record_artifact(path, kind='synthetic-input')
    def fill():
        p.visible('#import-file-form [name="company"]').fill(COMPANY)
        p.visible('#import-file-form [name="amount_unit"]').select_option('yuan')
        p.visible('#import-file-form [name="basis"]').select_option('standalone_quarter')
        p.visible('#import-file-form [name="file"]').set_input_files(str(path))
    p.step('选择一份明确合成的两季度财务文件，金额为元、独立单季', fill)
    p.submit('#import-file-form', after='#modal section.import-readable')
    section = p.visible('#modal section.import-readable')
    _read_groups(p, [(p.visible('#modal .quality-strip'), ['2 个已结束季度']),
        (p.visible('#modal').locator('.notice').filter(has_text='输入来自用户提供').locator(':scope > span'),
         ['未独立核验', '不表示各季度字段完整或内容真实'])], '阅读两季度有效范围与合成输入未核验限制')
    for period in PERIODS:
        detail = section.locator('details[data-preview-period="' + period + '"]')
        if detail.get_attribute('open') is None:
            p.step('展开实际季度 ' + period, lambda: detail.locator(':scope > summary').click())
        table = detail.locator(':scope > .preview-values')
        expected = [['营业收入', '100,000', '元'], ['营业成本', '80,000', '元'],
                    ['经营现金流', '10,000', '元'], ['净利润', '5,000', '元'],
                    ['总资产', '未提供', '元'], ['总负债', '未提供', '元'], ['库存金额', '未提供', '元']]
        assert _rows(table) == expected
        _read_groups(p, [(table.locator('thead'), ['指标', '将保存值', '单位'])] +
            [(row, cells) for row, cells in zip(table.locator('tbody tr').all(), expected)], '完整阅读' + period + '合成输入和未提供字段')
        supplement = detail.locator(':scope > details.preview-supplement')
        p.step('展开' + period + '未提供的补充指标', lambda: supplement.locator(':scope > summary').click())
        extra = supplement.locator('table')
        expected_extra = [[label, '未提供', unit] for label, unit in (
            ('期初净资产', '元'), ('期末净资产', '元'), ('销量（统一单位）', '原填数量'),
            ('产量（相同单位）', '原填数量'), ('制造费用', '元'), ('研发费用', '元'),
            ('锂价 / 元每吨', '元/吨'), ('行业波动率 / 比值', '比值'))]
        assert _rows(extra) == expected_extra
        _read_groups(p, [(row, cells) for row, cells in zip(extra.locator('tbody tr').all(), expected_extra)],
            '完整阅读' + period + '补充指标为空，不补造数值')
        p.step('收起已读' + period + '补充指标', lambda: supplement.locator(':scope > summary').click())
    assert p.get('/api/datasets')['items'] == []
    status, saved = _capture_response(p, 'POST', '/api/workspace/imports/' +
        p.visible('#modal [data-action="commit-stage"]').get_attribute('data-id') + '/commit',
        lambda: p.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="1"]'))
    assert status == 201
    expect_fixture(saved)
    assert p.get('/api/datasets')['items'] == [saved]
    p.dataset_id = saved['id']
    p.observations['fixture'] = {'synthetic': True, 'company': COMPANY, 'quarters': list(PERIODS),
        'one_financial_input': True, 'dataset_id': saved['id'], 'csv_sha256': hashlib.sha256(blob).hexdigest(),
        'explanation': '两个已结束季度各为收入100000/成本80000/净利润5000/经营现金流10000元；其余字段未提供。'}
    return saved


def _background(p):
    p.navigate('evidence')
    p.click('#main > header.page-heading [data-action="evidence-dialog"]', after='#evidence-form')
    def fill():
        p.visible('#evidence-form [name="title"]').fill(EVIDENCE_TITLE)
        p.visible('#evidence-form [name="text"]').fill(EVIDENCE_TEXT)
        p.visible('#evidence-form [name="company"]').fill(COMPANY)
        assert not p.visible('#evidence-form [name="global_scope"]').is_checked()
    p.step('实际新增仅供本企业使用的合成背景资料', fill)
    status, document = _capture_response(p, 'POST', '/api/evidence',
        lambda: p.submit('#evidence-form', after='#main[data-page="evidence"]'))
    assert status == 201
    row = p.visible('#main').locator('tbody tr').filter(has=p.page.get_by_role('button', name=re.compile(re.escape(EVIDENCE_TITLE))))
    p.step('按真实资料标题打开人工审阅', lambda: row.get_by_role('button', name='审阅', exact=True).click())
    def review():
        p.visible('#evidence-review-form [name="status"]').select_option('accepted')
        p.visible('#evidence-review-form [name="stance"]').select_option('context')
        p.visible('#evidence-review-form [name="note"]').fill(REVIEW_NOTE)
        assert not p.visible('#evidence-review-form [name="global_scope"]').is_checked()
    p.step('明确审阅为背景资料，不标注虚假反证', review)
    status, _ = _capture_response(p, 'PUT', '/api/workspace/evidence/' + document['id'] + '/review',
        lambda: p.submit('#evidence-review-form', after='#main[data-page="evidence"]'))
    assert status == 200
    rows = p.get('/api/workspace/evidence')['items']
    assert len(rows) == 1
    evidence = rows[0]
    assert evidence['review']['stance'] == 'context' and evidence['review']['note'] == REVIEW_NOTE
    assert evidence['review']['company'] == COMPANY and evidence['eligible']
    return evidence


def _read_report(p, dataset):
    section = p.visible('#run-tab-summary [data-report-readout]')
    facts, source = section.locator('table').nth(0), section.locator('table').nth(1)
    rows = _rows(facts)
    assert len(rows) == 1 and rows[0][:2] == ['2024-Q1', '毛利率']
    assert re.fullmatch(r'20(?:\.0+)?%', rows[0][2])
    assert '营业收入：10 万元' in rows[0][3] and '营业成本：8 万元' in rows[0][3]
    sources = dict(_rows(source))
    assert sources['目标季度 / 数据修订'] == '2024-Q1 / 1'
    assert sources['确认使用的文件'] == FILE_NAME and sources['原文件金额单位'] == '元'
    assert sources['原文件期间口径'] == '单季度'
    _read_groups(p, [(section.locator(':scope > p.preserve-lines'), [QUESTION]),
        (facts.locator('thead'), ['目标季度', '所问指标', '已保存结果', '原输入与公式']),
        (facts.locator('tbody tr'), ['2024-Q1', '20%', '营业收入', '营业成本', '(收入−成本)/收入'])],
        '完整阅读原问题、20%以及100000/80000元的保存输入')
    _read_groups(p, [(row, cells) for row, cells in zip(source.locator('tbody tr').all(), _rows(source))] +
        [(section.locator(':scope > p.micro').last, ['未', '核验'])], '完整阅读报告文件来源、单位、修订与未核验限制')
    return {'fact_rows': rows, 'source_rows': _rows(source), 'dataset_id': dataset['id']}


def _plan_report(p, dataset):
    p.navigate('agents')
    p.fill('#plan-form [name="query"]', QUESTION)
    assert not p.visible('#use-llm').is_checked()
    status, plan = _capture_response(p, 'POST', '/api/workspace/plans',
        lambda: p.submit('#plan-form', after='#execute-plan-form'))
    assert status == 201 and plan['payload']['max_calls'] == 0
    assert not plan['payload']['request']['use_llm'] and plan['payload']['snapshot']['dataset'] == dataset['payload']
    assert plan['payload']['request']['execution']['depth'] == 'balanced'
    assert p.page.locator('#execute-plan-form [name="external_consent"]').count() == 0
    _read_groups(p, [(p.visible('#execute-plan-form').locator(':scope > p.micro'), ['本计划不会调用外部模型'])],
        '阅读真实计划的零外部模型调用批准边界')
    status, accepted = _capture_response(p, 'POST', '/api/workspace/plans/' + plan['id'] + '/execute',
        lambda: p.submit('#execute-plan-form', after='#run-tab-summary [data-report-readout]'))
    assert status == 202
    _read_report(p, dataset)
    run = p.get('/api/runs/' + accepted['id'])
    expect_report(run, dataset)
    plan = p.get('/api/workspace/plans/' + plan['id'])  # Freeze only after its normal execute transition.
    assert run['snapshot']['studio']['plan_id'] == plan['id']
    assert p.get('/api/workspace/runs/' + run['id'] + '/audit')['report_integrity']['valid']
    return plan, run


def _feedback(p, run, consent, *, initial=False):
    p.click('#run-tab-summary [data-action="assessment-dialog"]', after='#assessment-form')
    form = p.visible('#assessment-form')
    if initial:
        assert not form.locator('[name="consent_replay"]').is_checked()
        def fill():
            form.locator('[name="verdict"]').select_option('needs_revision')
            form.locator('[name="note"]').fill(ASSESSMENT_NOTE)
            for capability in EXPECTED_CAPABILITIES:
                form.locator('[name="expected_capabilities"][value="' + capability + '"]').check()
        p.step('实际填写隔离合成验收依据与三项人工预期，先不授权回放', fill)
    else:
        assert form.locator('[name="note"]').input_value() == ASSESSMENT_NOTE
        assert form.locator('[name="consent_replay"]').is_checked() is (not consent)
        _read_groups(p, [(form.locator('label.check-label').filter(has=p.page.locator('[name="consent_replay"]')),
            ['本次冻结输入', '本地策略回放', '不调用外部模型']),
            (form.locator(':scope > .notice > span').filter(has_text='回放仅检验'),
             ['人工标注的能力覆盖', '计算不变性', '不代表模型事实准确率', '可随时撤回'])],
            '完整阅读' + ('本次回放同意' if consent else '撤回同意') + '的真实控件与适用边界')
        p.step('明确' + ('允许本地回放' if consent else '撤回后续本地回放同意'),
            lambda: form.locator('[name="consent_replay"]').set_checked(consent))
    assert [box.get_attribute('value') for box in form.locator('[name="expected_capabilities"]:checked').all()] == EXPECTED_CAPABILITIES
    status, saved = _capture_response(p, 'POST', '/api/workspace/runs/' + run['id'] + '/assessment',
        lambda: p.submit('#assessment-form', after='#run-tab-summary [data-report-readout]'))
    assert status == 200 and saved['payload']['consent_replay'] is consent
    assert saved['payload']['note'] == ASSESSMENT_NOTE and saved['payload']['expected_capabilities'] == EXPECTED_CAPABILITIES
    return saved


def _overview(p, *, consented, expected):
    p.visible('#main[data-page="evolution"]')
    view = p.get('/api/workspace/evolution')
    assert view['active'] is None and view['observations']['consented_cases'] == consented
    assert [row['id'] for row in view['evaluations']] == [row['id'] for row in expected]
    for saved in expected:
        current = next(row for row in view['evaluations'] if row['id'] == saved['id'])
        expect_unchanged(current['payload'], saved['payload'])
    assert p.page.locator('#main [data-action="strategy-activate"]').count() == 0
    hero = p.visible('#main .evolution-hero')
    _read_groups(p, [(hero.locator(':scope > div').first, ['内置目标驱动策略', '不改写历史报告']),
        (hero.locator('.evolution-stats > div').filter(has=p.page.get_by_text('明确授权案例', exact=True)),
         [str(consented), '明确授权案例'])], '阅读当前内置策略与明确授权案例数' + str(consented))
    return view


def _evaluation_card(p, evaluation):
    card = p.visible('#main').locator('.evaluation-card').filter(has=p.page.locator(
        '[data-action="evaluation-detail"][data-id="' + evaluation['id'] + '"]'))
    assert card.count() == 1
    expected = evaluation['payload']
    _read_groups(p, [(card.locator('.row-between .badge'), ['未达到激活门槛']),
        (card.locator(':scope > p').first, [str(expected['unique_inputs']) + ' 份不同输入', '0 项改善', '0 项回归'])] +
        [(card.locator(':scope > p.micro').nth(i), [reason]) for i, reason in enumerate(expected['blockers'])],
        '阅读同一受阻回放的样本数、零改善和全部门槛原因')
    assert card.locator('[data-action="strategy-activate"]').count() == 0
    return card


def _read_candidate(p, candidate):
    card = p.visible('#main').locator('.strategy-card').filter(has=p.page.locator(
        '[data-action="strategy-evaluate"][data-id="' + candidate['id'] + '"]'))
    _read_groups(p, [(card.locator('h3'), [candidate['payload']['name']]),
        (card.locator(':scope > p'), [candidate['payload']['note']]),
        (card.locator('.tag-row'), ['均衡', '必须反向对照'])],
        '阅读待比较候选的真实名称、改善假设与反向要求，尚未激活')


def _detail(p, evaluation, *, full=True):
    card = _evaluation_card(p, evaluation)
    p.step('实际打开保存回放的中文逐例对照', lambda: card.locator('[data-action="evaluation-detail"]').click())
    summary = p.visible('#inspector [data-evaluation-summary]')
    assert p.page.locator('#inspector pre:visible').count() == 0, 'The journey must not open technical JSON.'
    _read_groups(p, [(summary.locator('h3'), ['未通过']),
        (summary.locator(':scope > p').nth(1), ['1', '份不同财务输入', '1', '个验收任务']),
        *[(li, [text]) for li, text in zip(summary.locator('li').all(), evaluation['payload']['blockers'])]],
        '阅读逐例详情保存时的门槛与一份不同财务输入')
    case = p.visible('#inspector [data-replay-case="0"]')
    tables = case.locator('table')
    capability_rows, math_rows = _rows(tables.nth(0)), _rows(tables.nth(2))
    evidence_cells = _rows(tables.nth(1))[0]
    values = {'query': case.locator('[data-replay-query]').inner_text().strip(),
        'source': case.locator(':scope > p.micro').first.inner_text().strip(),
        'partition': case.locator(':scope > .row-between .badge').inner_text().strip(),
        'capability_rows': capability_rows, 'evidence_cells': evidence_cells, 'math_rows': math_rows}
    expect_readable_case(**values)
    if full:
        _read_groups(p, [(case.locator(':scope > .row-between'), ['案例 1', '保留组']),
            (case.locator('[data-replay-query]'), [QUESTION]),
            (case.locator(':scope > p.micro').first, [COMPANY, '2024-Q1', '第 1 次修订'])],
            '完整阅读原问题、企业、季度、修订和真实保留组')
        for index, table in enumerate(tables.all()):
            _read_groups(p, [(table.locator('thead'), ['基线', '候选'])] +
                [(row, cells) for row, cells in zip(table.locator('tbody tr').all(), _rows(table))],
                ('逐项读取计划、执行、满足状态和缺口', '逐项读取背景与反向资料分组', '逐项读取基线和候选的数学一致性')[index])
        _read_groups(p, [(case.locator(':scope > .notice > span'), ['人工标签', '不证明有效反证或事实正确性']),
            (summary.locator(':scope > .notice > span').filter(has_text='实际激活仍须明确确认'),
             ['当前案例', '回放同意', '候选和基线', '此详情仅供阅读']),
            (summary.locator(':scope > p.micro').last, ['不是独立外部验证', '不代表模型事实准确率'])],
            '阅读人工标签与小样本本地回放的完整限制')
    p.observations.setdefault('readable_evaluations', []).append({'evaluation_id': evaluation['id'], **values})
    return case


def strategy_consent_journey(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir,
        expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    p.observations['scope'] = {'financial_inputs': 1, 'reports': 1, 'background_only': True,
        'successful_activation': False, 'rollback': False, 'three_input_quality': False,
        'api_activation_rejection_is_separate_evidence': True, 'native_budget_seconds': 300}
    mutations = []
    def record(request):
        path = urlsplit(request.url).path
        if path.startswith('/api/') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            mutations.append({'method': request.method, 'path': path})
    p.page.on('request', record)
    try:
        register_empty_workspace(p)
        dataset = _import(p)
        p.navigate('settings')
        p.select('#preferences-form [name="amount_unit"]', 'wan', '明确报告金额展示为万元，财务输入仍为元')
        p.submit('#preferences-form', after='#preferences-form')
        evidence = _background(p)
        plan, run = _plan_report(p, dataset)
        saved = _feedback(p, run, False, initial=True)
        assert saved['version'] == 1
        p.navigate('evolution')
        _overview(p, consented=0, expected=[])
        p.click('#main [data-route="agents:run-' + run['id'] + '"]', after='#run-tab-summary [data-report-readout]')
        saved = _feedback(p, run, True)
        assert saved['version'] == 2
        p.navigate('evolution')
        _overview(p, consented=1, expected=[])
        status, proposal = _capture_response(p, 'POST', '/api/workspace/evolution/propose',
            lambda: p.click('#main [data-action="strategy-propose"]', after='#main .evaluation-card'))
        assert status == 201 and proposal['automatic_activation'] is False and proposal['external_calls'] == 0
        candidate, evaluation = proposal['candidate'], proposal['evaluation']
        assert candidate['payload']['require_counterevidence'] is True
        expect_blocked_evaluation(evaluation, candidate, run)
        _overview(p, consented=1, expected=[evaluation])
        _read_candidate(p, candidate)
        case = _detail(p, evaluation)
        p.step('从逐例入口打开原报告，核对仍是原值', lambda: case.get_by_role('button', name='查看原报告与验收', exact=True).click())
        _read_report(p, dataset)
        p.step('真实浏览器Back返回策略页', lambda: p.page.go_back(wait_until='domcontentloaded'))
        _overview(p, consented=1, expected=[evaluation])
        p.step('真实重载后找回同一受阻评估与历史', lambda: p.page.reload(wait_until='domcontentloaded'))
        _overview(p, consented=1, expected=[evaluation])
        case = _detail(p, evaluation, full=False)
        p.step('从同一旧评估回到原报告撤回授权', lambda: case.get_by_role('button', name='查看原报告与验收', exact=True).click())
        p.visible('#run-tab-summary [data-report-readout]')
        saved = _feedback(p, run, False)
        assert saved['version'] == 3
        p.navigate('evolution')
        _overview(p, consented=0, expected=[evaluation])
        _evaluation_card(p, evaluation)
        status, empty = _capture_response(p, 'POST', '/api/workspace/strategies/' + candidate['id'] + '/evaluate',
            lambda: p.click('#main [data-action="strategy-evaluate"][data-id="' + candidate['id'] + '"]',
                after='#main [data-action="strategy-evaluate"]'))
        assert status == 201 and empty['id'] != evaluation['id']
        expect_blocked_evaluation(empty, candidate)
        # The request returns before the click handler's final render settles.
        p.page.locator('#main [data-action="evaluation-detail"][data-id="' + empty['id'] + '"]').wait_for(state='visible', timeout=FORM_MS)
        final = _overview(p, consented=0, expected=[empty, evaluation])
        _evaluation_card(p, empty)
        expect_unchanged(p.get('/api/datasets')['items'], [dataset])
        expect_unchanged(p.get('/api/runs/' + run['id'])['result'], run['result'])
        expect_unchanged(p.get('/api/runs/' + run['id'])['snapshot'], run['snapshot'])
        expect_unchanged(p.get('/api/workspace/plans/' + plan['id'])['payload'], plan['payload'])
        expect_unchanged(final['candidates'], [candidate])
        assert len(p.get('/api/runs')['items']) == len(p.get('/api/workspace/plans')['items']) == 1
        assert p.get('/api/workspace/runs/' + run['id'] + '/audit')['report_integrity']['valid']
        counts = {path: sum(r['path'] == path for r in mutations) for path in (
            '/api/workspace/evolution/propose', '/api/workspace/strategies/' + candidate['id'] + '/evaluate',
            '/api/workspace/runs/' + run['id'] + '/assessment')}
        assert list(counts.values()) == [1, 1, 3], 'No automatic resubmission is allowed.'
        assert not any('/strategies/' in r['path'] and r['path'].endswith(('/activate', '/rollback'))
            for r in mutations)
        p.observations['native_mutations'] = mutations
        p.observations['saved_identity'] = {'dataset_id': dataset['id'], 'evidence_id': evidence['id'],
            'plan_id': plan['id'], 'run_id': run['id'], 'candidate_id': candidate['id'],
            'evaluation_ids': [evaluation['id'], empty['id']], 'active_version': 0,
            'historical_report_and_plan_unchanged': True, 'historical_evaluation_payload_unchanged': True,
            'consent_sequence': [False, True, False], 'consented_cases_sequence': [0, 1, 0],
            'native_activation_action': 'not offered by UI; no hidden activation POST issued'}
        p.no_external()
    finally:
        p.page.remove_listener('request', record)
