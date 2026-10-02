"""Presentation metadata for existing calculator outputs, not financial formulas."""

RATIO_METRICS = {'gross_margin', 'net_margin', 'cash_ratio', 'leverage', 'revenue_growth', 'rd_ratio', 'roe', 'margin_change'}
AMOUNT_METRICS = {'revenue', 'cost', 'net_profit', 'cash_flow'}


def fact_comparison(key, value, analysis):
    current = analysis['current_period']
    year, quarter = int(current[:4]), int(current[-1])
    expected = (f'{year if quarter > 1 else year - 1}-Q{quarter - 1 if quarter > 1 else 4}'
                if analysis['comparison'] == 'previous' else f'{year - 1}-Q{quarter}')
    baseline = next((p for p in analysis['series'] if p['period'] == analysis['baseline_period']), None)
    comparison = {'kind': analysis['comparison'], 'period': expected, 'operation': 'difference',
                  'value': baseline.get(key) if baseline else None, 'change': None,
                  'change_unit': 'ratio_points' if key in RATIO_METRICS else 'CNY' if key in AMOUNT_METRICS else 'times'}
    if key == 'revenue_growth':
        # The fact already is growth against this revenue baseline. It is not a
        # difference between two growth rates, and CNY must not become a ratio.
        base_revenue = baseline.get('revenue') if baseline else None
        comparison.update(operation='growth_rate', value=None, change=value, change_unit='ratio',
            baseline_input={'metric': 'revenue', 'period': expected, 'value': base_revenue, 'unit': 'CNY'})
        if baseline is None:
            status, reason = 'missing_baseline', '缺少指定基期收入，不能计算收入增速'
        elif base_revenue is None:
            status, reason = 'missing_input', '指定基期收入缺失，不能计算收入增速'
        elif base_revenue <= 0:
            status, reason = 'invalid_baseline', '基期收入必须大于0，不能计算收入增速'
        elif value is None:
            status, reason = 'missing_input', '缺少可用收入输入，不能计算收入增速'
        else:
            status, reason = 'available', ''
    else:
        base_value = comparison['value']
        comparison['change'] = value - base_value if value is not None and base_value is not None else None
        if baseline is None:
            status, reason = 'missing_baseline', '缺少指定的可比基期'
        elif value is None or base_value is None:
            status, reason = 'missing_input', '本期或基期指标输入不足，不能计算变化'
        else:
            status, reason = 'available', ''
    return {**comparison, 'status': status, 'reason': reason}
