import { esc, num } from './components.js';
/** Format metadata only; never calculate another financial rate in the client. */
export function metricComparison(f) {
    const c = f.comparison;
    if (!c)
        return '';
    const label = { year_over_year: '同比', previous: '环比' }[c.kind] ?? c.kind;
    const growth = c.operation === 'growth_rate' || f.id === 'revenue_growth';
    // Saved older growth facts already contain the rate even when change is null.
    const change = growth ? f.value : c.change;
    const unit = growth ? 'ratio' : c.change_unit;
    const missing = c.reason || (growth ? '缺少可用收入或有效基期；基期收入必须大于0' : '本期或基期指标输入不足，不能计算变化');
    const value = change == null ? esc(missing) : (growth ? '收入增速 ' : '') + (change > 0 ? '+' : '') + num(change * (unit === 'ratio' || unit === 'ratio_points' ? 100 : 1), 2) + ' ' + esc({ ratio: '%', ratio_points: '个百分点', CNY: '元', times: '倍' }[unit] ?? unit ?? '');
    const baseline = growth && c.baseline_input?.value != null ? `<br><small>基期收入 ${num(c.baseline_input.value, 2)} 元</small>` : '';
    return `<p class="fact-comparison">${esc(label)} · ${esc(c.period ?? '基期未记录')}<br>${value}${baseline}</p>`;
}
