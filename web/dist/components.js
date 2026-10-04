export function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function num(v, d = 2) { return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('zh-CN', { maximumFractionDigits: d }) : '—'; }
export function pct(v) { return typeof v === 'number' && Number.isFinite(v) ? num(v * 100) + '%' : '—'; }
// A display-unit change must not round an otherwise visible yuan amount to zero.
// Retain precision down to cents in each unit; this formats persisted values only.
export function amount(v, unit = 'wan') { const scale = { yuan: 1, wan: 1e4, yi: 1e8 }[unit] ?? 1e4; return typeof v === 'number' ? num(v / scale, 2 + Math.log10(scale)) : '—'; }
export function unitName(unit) { return { yuan: '元', wan: '万元', yi: '亿元' }[unit] ?? '万元'; }
export function timeText(v) { if (!v)
    return '—'; const d = new Date(String(v)); return Number.isFinite(d.valueOf()) ? d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }
export function safeLink(url, label) { try {
    const u = new URL(url);
    return u.protocol === 'https:' ? `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(label ?? u.hostname)} ${icon('external')}</a>` : esc(label ?? url);
}
catch {
    return esc(label ?? url);
} }
const icons = { overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    network: '<circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m10 8-4 7m8-7 4 7M8 18h8"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    files: '<path d="M7 3h9l4 4v14H7zM16 3v5h4M3 7v14M10 12h7m-7 4h7"/>',
    sliders: '<path d="M5 3v5m0 4v9M12 3v11m0 4v3M19 3v3m0 4v11M2 8h6m1 10h6m1-12h6"/>',
    compare: '<path d="M4 4v16h16M8 17V9m5 8V5m5 12v-6"/>',
    report: '<path d="M6 3h10l4 4v14H6zM16 3v5h4M9 12h8m-8 4h5"/>',
    check: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7 12 3 3 7-7"/>',
    memory: '<path d="M9 4a4 4 0 0 0-6 4c-3 2-2 7 1 8 0 4 6 6 8 2V6c0-3-2-4-3-2Zm6 0a4 4 0 0 1 6 4c3 2 2 7-1 8 0 4-6 6-8 2V6c0-3 2-4 3-2Z"/><path d="M5 8h3m8 8h3"/>',
    activity: '<path d="M2 12h4l4-8 4 16 4-8h4"/>', settings: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
    plus: '<path d="M12 4v16M4 12h16"/>', arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', external: '<path d="M14 3h7v7M10 14 21 3M10 3H3v18h18v-7"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>', close: '<path d="m5 5 14 14M19 5 5 19"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>', spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 6v2"/>', logout: '<path d="M10 3H4v18h6m-1-9h12m-5-5 5 5-5 5"/>', refresh: '<path d="M20 7V2m0 5h-5M4 17v5m0-5h5M4 9a8 8 0 0 1 14-4m2 10a8 8 0 0 1-14 4"/>', chevron: '<path d="m8 4 8 8-8 8"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>', trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>', upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' };
export function icon(name) { return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.info}</svg>`; }
export function button(label, action, style = 'secondary', attrs = '') { return `<button type="button" class="${style}" data-action="${esc(action)}" ${attrs}>${label}</button>`; }
export function routeButton(label, route, style = 'text-button') { return `<button type="button" class="${style}" data-route="${esc(route)}">${label}</button>`; }
export function badge(label, tone = 'neutral') { return `<span class="badge ${esc(tone)}">${esc(label)}</span>`; }
const names = { draft: '待确认', proposal_preview: '提案预览', dispatched: '已派发', queued: '排队中', running: '执行中', succeeded: '已完成', degraded: '结果受限', failed: '执行失败', cancelled: '已取消', interrupted: '已中断', not_requested: '未调用模型', completed: '模型已响应', partial: '部分响应', unavailable: '未配置模型', open: '待开展', in_progress: '进行中', blocked: '已阻塞', done: '已验收', dismissed: '已搁置', unreviewed: '未审阅', accepted: '人工接受', rejected: '已排除' };
export function status(v) { return badge(names[v] ?? v, ['succeeded', 'completed', 'done', 'accepted'].includes(v) ? 'good' : ['failed', 'blocked', 'rejected'].includes(v) ? 'danger' : ['running', 'queued', 'draft', 'degraded', 'interrupted'].includes(v) ? 'warm' : 'neutral'); }
export function notice(text, tone = 'neutral') { return `<div class="notice ${tone}">${icon('info')}<span>${esc(text)}</span></div>`; }
export function empty(title, detail, action = '') { return `<div class="empty"><span class="empty-symbol">${icon('files')}</span><h3>${esc(title)}</h3><p>${esc(detail)}</p>${action}</div>`; }
export function heading(title, subtitle, actions = '') { return `<header class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="heading-actions">${actions}</div></header>`; }
export function field(label, control, hint = '') { return `<label class="field"><span>${esc(label)}</span>${control}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`; }
export function input(name, value = '', attrs = '') { return `<input name="${esc(name)}" value="${esc(value)}" ${attrs}>`; }
export function textarea(name, value = '', attrs = '') { return `<textarea name="${esc(name)}" ${attrs}>${esc(value)}</textarea>`; }
export function select(name, options, selected = '', attrs = '') { const opts = Array.isArray(options) ? options.map(o => [o.value, o.label]) : Object.entries(options); return `<select name="${esc(name)}" ${attrs}>${opts.map(([v, t]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`; }
export function formFooter(label) { return `<p class="form-error" role="alert"></p><div class="form-footer"><button class="primary" type="submit">${esc(label)} ${icon('arrow')}</button></div>`; }
export function jsonView(value) { return `<pre class="json-view">${esc(JSON.stringify(value, null, 2))}</pre>`; }
export function table(headers, rows, cls = '') { return `<div class="table-scroll ${cls}" role="region" tabindex="0" aria-label="${esc(headers.join('、'))}"><table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
export const metricNames = { revenue: '营业收入', cost: '营业成本', net_profit: '净利润', cash_flow: '经营现金流', gross_margin: '毛利率', net_margin: '净利率', roe: '季度净资产收益率', cash_ratio: '经营现金收入比', leverage: '资产负债率', asset_turnover: '资产周转率', rd_ratio: '研发强度', inventory_turnover: '库存周转率', sales_production_ratio: '产销率', revenue_growth: '收入增速', margin_change: '毛利率变化' };
export function metricValue(id, v) { return ['inventory_turnover', 'asset_turnover', 'sales_production_ratio'].includes(id) ? num(v) : pct(v); }
export function metricCard(label, value, detail, action = '') { return `<article class="metric"><div class="metric-label">${esc(label)}${action ? button(icon('info'), action, 'icon-button', 'aria-label="查看计算依据"') : ''}</div><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`; }
export function quarterOrdinal(label) { return Number(label.slice(0, 4)) * 4 + Number(label.slice(-1)) - 1; }
export function lineChart(series, keys, unit = '万元', scale = 1e4) {
    if (!series.length)
        return empty('尚无时间序列', '保存财务数据后显示真实曲线');
    const width = 680, height = 246, left = 58, right = 20, top = 18, bottom = 35;
    const points = series.flatMap(r => keys.map(k => r[k.id])).filter(v => typeof v === 'number' && Number.isFinite(v));
    if (!points.length)
        return empty('指标不可计算', '所选序列没有有效值，不以零代替');
    const lo = Math.min(0, ...points), hi0 = Math.max(...points), hi = hi0 === lo ? lo + 1 : hi0 + (hi0 - lo) * .1;
    const min = quarterOrdinal(series[0].period), max = quarterOrdinal(series.at(-1).period);
    const x = (p) => left + (quarterOrdinal(p.period) - min) / Math.max(max - min, 1) * (width - left - right);
    const y = (v) => top + (hi - v) / (hi - lo) * (height - top - bottom);
    const grid = [0, 1, 2, 3, 4].map(i => { const v = lo + (hi - lo) * i / 4; return `<line x1="${left}" y1="${y(v)}" x2="${width - right}" y2="${y(v)}" class="gridline"/><text x="${left - 10}" y="${y(v) + 4}" text-anchor="end">${esc(num(v / scale, 1))}</text>`; }).join('');
    const graphs = keys.map((k, index) => {
        let path = '';
        let previous = -99;
        for (const p of series) {
            const v = p[k.id];
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                previous = -99;
                continue;
            }
            const ix = quarterOrdinal(p.period);
            path += (ix === previous + 1 ? 'L' : 'M') + x(p) + ',' + y(v) + ' ';
            previous = ix;
        }
        return `<path d="${path}" class="line series-${index}"/>` + series.filter(p => typeof p[k.id] === 'number' && Number.isFinite(p[k.id])).map(p => `<circle cx="${x(p)}" cy="${y(p[k.id])}" r="3.2" class="dot series-${index}"><title>${esc(p.period + ' ' + k.name + ' ' + num(p[k.id] / scale) + ' ' + unit)}</title></circle>`).join('');
    }).join('');
    const ticks = series.filter((_, i) => series.length <= 8 || i % Math.ceil(series.length / 7) === 0 || i === series.length - 1).map(p => `<text x="${x(p)}" y="${height - 10}" text-anchor="middle">${esc(p.period)}</text>`).join('');
    return `<div class="chart-legend">${keys.map((k, i) => `<span><i class="swatch swatch-${i}"></i>${esc(k.name)}</span>`).join('')}<small>${esc(unit)}</small></div><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(keys.map(k => k.name).join('与') + '历史趋势；季度缺口不连线')}">${grid}${graphs}${ticks}</svg>`;
}
export function citationCard(c) {
    const origins = { search_snippet: '搜索摘要（非全文）', uploaded_document: '上传文档提取内容', public_document: '公开来源获取内容', user_provided: '用户提供文本' };
    const verified = { search_snippet_unverified: '搜索摘要，未经独立核验', fetched_not_fact_checked: '已获取内容，未经事实核验', unverified: '未经独立核验' };
    return `<article class="citation"><div class="row-between"><h4>${esc(c.title)}</h4>${badge(c.review_state === 'accepted' ? '人工已审阅' : '未独立核验', c.review_state === 'accepted' ? 'good' : 'warm')}</div><div class="tag-row">${badge(origins[c.source_kind] ?? '来源类型未记录')}${badge(verified[c.verification] ?? c.verification ?? '核验状态未记录', 'warm')}</div><p>${esc(c.excerpt)}</p><div class="micro-row"><span>当前展示来源：${safeLink(c.url ?? '', '查看展示地址')}</span><span>发布日期：${esc(c.published_at ?? '未提供')}</span><span>字符 ${num(c.start, 0)}–${num(c.end, 0)}</span></div><div class="micro-row"><span>原始采集来源：${c.original_source_url ? safeLink(c.original_source_url, c.original_source_url) : '未记录'}</span><span>搜索摘要采集：${esc(c.retrieved_at ?? '未记录')}</span><span>公开原文获取：${esc(c.fetched_at ?? '未记录')}</span></div><p class="micro">更正展示地址或人工接受资料，不改变原始采集方式和核验状态。</p><details><summary>引用定位</summary><code>${esc(c.id)}</code><p class="micro">片段 SHA-256 ${esc(c.content_hash)}</p></details></article>`;
}
export function nodeFlow(nodes, trace = [], overall = '') { return `<div class="agent-flow">${nodes.map(n => { const events = trace.filter(e => e.payload?.node === n.id); const last = events.at(-1); const terminal = ['failed', 'cancelled', 'interrupted', 'succeeded', 'degraded'].includes(overall); const state = last?.type === 'step_completed' ? (['failed', 'blocked', 'unavailable'].includes(last.payload.outcome) ? 'stopped' : 'complete') : last?.type === 'step_started' ? (terminal ? 'stopped' : 'live') : last?.type === 'step_skipped' || n.enabled === false ? 'skip' : terminal ? 'not-reached' : 'pending'; return `<button type="button" class="agent-node ${state}" title="${esc({ stopped: '已停止或调用未完成，请查看产物', 'not-reached': '任务结束前未到达', complete: '该节点已记录产物' }[state] ?? '查看节点职责与产物')}" data-action="node-details" data-id="${esc(n.id)}"><span class="node-symbol">${icon(n.engine === 'optional_llm' ? 'spark' : n.id === 'evidence' ? 'files' : 'network')}</span><span><strong>${esc(n.name ?? n.label)}</strong><small>${esc(n.engine === 'optional_llm' ? '模型专家' : n.engine === 'lexical' ? '词法检索' : '确定性工具')}</small></span><i class="node-status">${state === 'complete' ? '✓' : state === 'live' ? '●' : state === 'skip' ? '—' : state === 'stopped' ? '!' : '·'}</i></button>`; }).join('')}</div>`; }
