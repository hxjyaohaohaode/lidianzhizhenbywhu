"""Prepared L12 reading of its original report; no native execution here.

These fixed expectations belong only to L12's unchanged two-quarter CSV and
Q1 question. Missing baseline input is not an invented 2023-Q1 observation.
Geometry, ancestor clipping, native wheels and screenshots use the existing
strict reader unchanged. API/renderer tests are not native browser evidence.
"""
from __future__ import annotations

import json

try:
    from .product_strategy_journey import _read_groups
except ImportError:
    from product_strategy_journey import _read_groups


GAP_FIELDS = (
    'assets', 'liabilities', 'inventory', 'sales_volume', 'production_volume', 'rd_expense',
    'equity_begin', 'equity_end', 'gmps:margin', 'gmps:gap', 'gmps:lithium', 'gmps:unit_cost',
    'gmps:inventory', 'gmps:sales_production', 'gmps:manufacturing', 'gmps:volatility',
    'gmps:leverage', 'dqi:profit', 'dqi:growth', 'dqi:cash', 'dqi:assets', 'dqi:rd',
    'dqi:inventory', 'comparison_baseline',
)
GAP_NAMES = (
    '总资产', '总负债', '库存金额', '销量', '产量', '研发费用', '期初净资产', '期末净资产',
    '毛利压力规则 · 毛利率下降幅度', '毛利压力规则 · 成本收入增速差', '毛利压力规则 · 锂价变化',
    '毛利压力规则 · 单位销售成本变化', '毛利压力规则 · 库存变化', '毛利压力规则 · 产销率',
    '毛利压力规则 · 制造费用占比', '毛利压力规则 · 行业波动率', '毛利压力规则 · 资产负债率',
    '经营质量规则 · 盈利质量', '经营质量规则 · 收入成长', '经营质量规则 · 现金质量',
    '经营质量规则 · 资产效率', '经营质量规则 · 研发强度', '经营质量规则 · 库存效率', '指定比较基期',
)
GAP_COLUMNS = ['缺口项目', '期间与原计算依据', '待补充工作']
ISSUE_COLUMNS = ['节点', '已保存状态', '限制 / 原因与下一步']
# Whole cells, including all paragraphs. Never reduce these to short needles to
# accommodate a clipped viewport. Newlines normalize rendered block spacing only.
SELECTED_ROWS = {
    0: ['总资产', '已保存缺失期间：2024-Q1', '补充同口径的原始报表字段并保存新修订'],
    10: ['毛利压力规则 · 锂价变化',
         '已保存计算定义：本期锂价/基期锂价-1\n当前期（2024-Q1）：锂价未提供\n指定基期（期间未记录）：该期输入未记录',
         '核对锂价变化的当前期与指定基期输入：本期锂价/基期锂价-1'],
    23: ['指定比较基期',
         '当前期：2024-Q1\n比较口径：同比（上年同季）\n指定基期对应季度未记录；请按原比较口径核对，不改用其他季度。',
         '补充指定同/环比季度；不自动改用其他季度，也不将缺失基期当作零'],
}
GAP_GUIDANCE = ('在“经营数据”核对原始资料、期间和单位，如需补充或更正，保存新修订后再生成新的研判报告。'
                '缺失不等于零；已保存的旧报告不会自动更新。')
ISSUE_ROWS = [
    ['证据检索', '缺少所需资料或输入',
     '本次冻结报告的引用为 0 条。请在“证据资料”补充并审阅适用于本企业的资料，再生成新计划；这不表示外部没有相关资料。'],
    ['缺口补全规划', '输入待核对或补充',
     '已列出 24 项待核对或补充事项：' + '、'.join(GAP_NAMES) +
     '。请按上方缺口清单核对期间与输入，在“经营数据”保存新修订后重新研判；清单已生成，相关输入仍需核对或补充。'],
]


def _cell_text(value):
    return '\n'.join(line.strip() for line in value.splitlines() if line.strip())


def expect_original_gap_report(run):
    """Bind the reader to real saved inputs, never infer null score's cause."""
    report = run['result']
    analysis, adaptive = report['analysis'], report['adaptive']
    gaps = adaptive['mathematical_outputs']['gaps']
    assert report['citations'] == run['snapshot']['citations'] == []
    assert analysis['model_version'] == 'rules-3.0.0'
    assert analysis['current_period'] == '2024-Q1' and analysis['baseline_period'] is None
    assert len(analysis['series']) == 1
    current = analysis['series'][0]
    assert current['period'] == '2024-Q1'
    assert current['assets'] is None and current['lithium_price'] is None
    assert current['revenue'] == 100000 and current['cost'] == 80000 and current['gross_margin'] == .2
    assert gaps['status'] == 'needs_input'
    assert tuple(item['field'] for item in gaps['items']) == GAP_FIELDS
    assert all(item['auto_imputed'] is False for item in gaps['items'])
    assert gaps['baseline_requirement']['current_period'] == '2024-Q1'
    assert gaps['baseline_requirement']['comparison'] == 'year_over_year'
    assert report['quality']['field_coverage']['period'] == '2024-Q1'
    assert 'assets' in report['quality']['field_coverage']['missing']
    for key, formula in [('margin', '-(本期毛利率-基期毛利率)'), ('lithium', '本期锂价/基期锂价-1')]:
        dimension = next(row for row in analysis['gmps']['dimensions'] if row['id'] == key)
        unavailable = next(row for row in gaps['unavailable_rule_components'] if row['model'] == 'gmps' and row['id'] == key)
        assert dimension['formula'] == unavailable['formula'] == formula
        assert dimension['score'] is None and dimension['value'] is None
    assert adaptive['reflection']['issues'] == [
        {'node': 'evidence', 'state': 'missing', 'reason': None},
        {'node': 'gaps', 'state': 'needs_input', 'reason': None},
    ]
    for key in ('evidence', 'gaps'):
        assert next(n for n in adaptive['nodes'] if n['id'] == key)['capability'] == key


def expect_gap_cells(rows, issues):
    assert len(rows) == len(GAP_NAMES) and all(len(row) == 3 for row in rows)
    assert [row[0] for row in rows] == list(GAP_NAMES), 'Main labels must name the saved fields in Chinese.'
    for index, expected in SELECTED_ROWS.items():
        assert [_cell_text(value) for value in rows[index]] == expected, 'Missing or substituted period, inputs, definition or next step.'
    assert issues == ISSUE_ROWS, 'Read the actual frozen citation boundary and complete generated-list reason.'
    main_text = '\n'.join(value for row in rows + issues for value in row)
    assert all(key not in main_text for key in GAP_FIELDS)
    assert all(key not in main_text for key in ('needs_input', 'missing', '查看对应产物', '执行失败', '资料尚未补齐'))


def _rows(table):
    return [[cell.inner_text().strip() for cell in row.locator('td').all()]
            for row in table.locator('tbody tr').all()]


def _read_table(p, table, columns, selected, label):
    """Keep header/row/column binding while measuring complete individual cells."""
    headers = table.locator('thead th').all()
    assert [cell.inner_text().strip() for cell in headers] == columns
    assert all(cell.get_attribute('scope') == 'col' for cell in headers)
    groups = [(cell, [column]) for cell, column in zip(headers, columns)]
    bindings = [{'column': column, 'kind': 'header'} for column in columns]
    rows = table.locator('tbody tr').all()
    for index, expected in selected.items():
        cells = rows[index].locator('td').all()
        assert [_cell_text(cell.inner_text()) for cell in cells] == expected
        for column, cell, value in zip(columns, cells, expected):
            groups.append((cell, value.splitlines()))
            bindings.append({'row': index + 1, 'row_name': expected[0], 'column': column, 'value': value})
    start = len(p.observations.get('complete_text_groups', []))
    _read_groups(p, groups, label)
    readings = p.observations['complete_text_groups'][start:]
    assert len(readings) == len(bindings)
    p.observations.setdefault('report_gap_table_readings', []).append({'label': label, 'columns': columns,
        'cells': [{**binding, 'reading_index': start + index} for index, binding in enumerate(bindings)],
        'manual_pixel_review': 'pending'})


def read_original_report_gaps(p, run):
    expect_original_gap_report(run)
    section = p.visible('#run-tab-summary .adaptive-results')
    gaps = section.locator(':scope > [data-math-kind="gaps"]')
    gap_table = gaps.locator(':scope > .table-scroll > table').first
    issues = section.locator(':scope > .table-scroll > table').nth(1)
    expect_gap_cells(_rows(gap_table), _rows(issues))
    # Disclosure retention is a DOM/source contract, never used as a visible
    # reading or as a replacement for the Chinese main cells below.
    for box, original in [(gaps, run['result']['adaptive']['mathematical_outputs']['gaps']),
                          (section, run['result']['adaptive']['reflection'])]:
        details = box.locator(':scope > details')
        assert details.count() == 1 and details.get_attribute('open') is None
        assert json.loads(details.locator('pre').text_content()) == original
    _read_groups(p, [(gaps.locator(':scope > h3'), ['数据缺口与补充计划'])], '读取原报告的数据缺口标题')
    _read_table(p, gap_table, GAP_COLUMNS, SELECTED_ROWS, '完整读取原报告缺字段与原规则条件的表头和单元格')
    _read_groups(p, [(gaps.locator(':scope > .notice > span'), [GAP_GUIDANCE]),
        (section.locator(':scope > h3'), ['执行复盘与未达成条件'])], '读到补录位置、旧报告边界与执行复盘标题')
    _read_table(p, issues, ISSUE_COLUMNS, dict(enumerate(ISSUE_ROWS)), '完整读取原报告复盘节点、状态及实际未达成原因')
    p.observations['original_report_gap_reading'] = {'run_id': run['id'], 'current_period': '2024-Q1',
        'saved_baseline_period': None, 'comparison': 'year_over_year', 'frozen_citation_count': 0,
        'gap_count': 24, 'geometrically_read_fields': [GAP_FIELDS[i] for i in SELECTED_ROWS],
        'all_gap_labels_semantically_checked': True, 'zero_denominator_native_coverage': False,
        'manual_pixel_review': 'pending'}
