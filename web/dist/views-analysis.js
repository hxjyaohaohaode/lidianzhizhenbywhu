import { actionEvidenceChoice } from './action-evidence.js';
import { experimentContextAttributes, experimentRecoveryPanel } from './experiment-recovery.js';
import { comparisonIndex, savedComparisonPage, comparisonResultView, comparisonModes } from './saved-comparisons.js';
import { experimentProblem } from './saved-experiments.js';
import { sourceBadge, sourcePanel, sourceForm, acceptanceEvidence } from './business-source.js';
import { viewWorkspace as workspace, contextGuard } from './api.js';
import { state, scopedDatasets, scopeQuery } from './state.js';
import { esc, num, pct, amount, unitName, icon, button, routeButton, badge, status, notice, empty, heading, field, input, textarea, select, formFooter, jsonView, table, metricNames, timeText, lineChart } from './components.js';
import { datasetOptions } from './views-studio.js';
export async function labPage(id = '') {
    const saved = await workspace('/experiments' + scopeQuery());
    state.cache.experiments = saved.items;
    if (id)
        return experimentPage(id);
    return heading('情景与预测', '把假设、计算与回测放在同一个可复核的实验里。') + experimentRecoveryPanel(saved.items) +
        `<div class="two-columns"><section class="panel"><div class="section-heading"><h2>新建分析实验</h2></div>${scopedDatasets().length ? `<form id="experiment-form" class="stack" ${experimentContextAttributes()}>${field('数据集', select('dataset_id', datasetOptions(), state.active))}${field('目标季度（可选）', input('target_period', '', 'pattern="(19|20)[0-9]{2}-Q[1-4]" placeholder="例如 2024-Q2；留空使用最新季度"'))}<div class="form-grid">${field('实验名称', input('name', '', 'required maxlength="200" placeholder="为这次分析命名"'))}${field('分析方法', select('kind', { scenario: '固定 / 变动成本情景', forecast: '可解释时间序列基线' }, 'scenario', 'id="experiment-kind"'))}</div><fieldset id="scenario-fields"><div class="form-grid">${field('售价变化 / %', input('price_change', 0, 'type="number" step="any" min="-80" max="100" required'))}${field('单位变动成本变化 / %', input('cost_change', 0, 'type="number" step="any" min="-80" max="100" required'))}${field('销量变化 / %', input('volume_change', 0, 'type="number" step="any" min="-80" max="100" required'))}${field('固定成本占比 / %', input('fixed_cost_share', 0, 'type="number" step="any" min="0" max="100" required'))}</div><p class="micro">0 表示你明确设定“无变化”，不表示系统推测。固定成本份额不会随销量或单位成本冲击变化。</p></fieldset><fieldset id="forecast-fields" hidden disabled><div class="form-grid">${field('预测指标', select('metric', { revenue: '营业收入', cost: '营业成本', cash_flow: '经营现金流', gross_margin: '毛利率' }))}${field('预测期数', select('horizon', { '1': '下一季度', '2': '未来两个季度', '3': '未来三个季度', '4': '未来四个季度' }, '2'))}</div><p class="micro">至少 6 个连续且已结束的季度；用相同滚动起点比较上一期、四季均值、季节基线和线性趋势。缺失时拒绝自动填补。</p></fieldset>${field('本次假设与使用边界', textarea('assumptions', '', 'rows="3" required minlength="5" maxlength="2000" placeholder="说明为何采用这些参数、适用业务范围，以及未包含的成本或外部因素"'))}${formFooter('计算并保存实验')}</form>` : empty('需要真实输入才能开展实验', '先录入财务数据。不会提供伪装成预测的占位曲线。', routeButton('添加经营数据', 'data', 'primary'))}</section>
 <section class="panel"><div class="section-heading row-between"><h2>当前企业范围实验</h2><span class="micro">${saved.items.length} 份</span></div>${saved.items.length ? saved.items.map((e) => `<button class="list-link" data-route="lab:${esc(e.id)}"><span>${badge(e.payload.request.kind === 'scenario' ? '情景假设' : '统计基线')}<strong>${esc(e.payload.request.name)}</strong><small>${esc(e.payload.company)} · ${timeText(e.created_at)}</small></span>${icon('chevron')}</button>`).join('') : empty('还没有分析实验', '保存后保留输入快照、假设、方法与输出，修改原始数据不改变旧实验。')}</section></div>`;
}
const recordedQuarter = (value) => typeof value === 'string' && /^[0-9]{4}-Q[1-4]$/.test(value) ? value : '未记录';
export async function experimentPage(id) {
    const e = await workspace('/experiments/' + id);
    state.cache.experiment = e;
    const p = e.payload, r = p.result;
    const unit = state.user.preferences.amount_unit;
    const u = unitName(unit), factor = { yuan: 1, wan: 1e4, yi: 1e8 }[unit] ?? 1e4;
    const sourceSummary = `<p data-experiment-source>原数据修订：${Number.isSafeInteger(p.dataset_version) && p.dataset_version > 0 ? String(p.dataset_version) : '未记录'} · 目标季度：${esc(recordedQuarter(p.target_period))}</p>`;
    let content = '';
    if (r.kind === 'scenario') {
        const results = r.result;
        content = `<div class="metric-row"><article class="metric"><span>假设情景收入</span><strong>${amount(results.revenue, unit)}</strong><small>${u}</small></article><article class="metric"><span>假设情景毛利率</span><strong>${pct(results.gross_margin)}</strong><small>基准 ${pct(r.baseline.gross_margin)}</small></article><article class="metric"><span>毛利额变化</span><strong>${amount(r.delta_gross_profit, unit)}</strong><small>${u} · 机械计算，不是预测</small></article></div><div class="two-columns"><section class="panel"><h2>敏感性对照</h2><p class="muted">在本次假设附近，每项单独减 / 加 5 个百分点时的毛利额。</p>${table(['参数', '−5 个百分点', '当前假设', '+5 个百分点'], r.sensitivity.map((s) => [esc(s.label), amount(s.minus_five_pp, unit), amount(s.center, unit), amount(s.plus_five_pp, unit)]))}<p class="micro">单位：${u}；其他假设不变，不应解读为因果估计。</p><dl class="definition-list"><div><dt>固定成本</dt><dd>${amount(results.fixed_cost, unit)} ${u}</dd></div><div><dt>变动成本</dt><dd>${amount(results.variable_cost, unit)} ${u}</dd></div><div><dt>盈亏平衡销量倍数</dt><dd>${num(r.break_even_volume_multiplier)} × 基准销量</dd></div></dl></section><section class="panel"><h2>售价 × 变动成本二维敏感性</h2><p class="muted">单元格为毛利率。销量与固定成本占比保持本次假设。</p>${table(['售价变化 / 成本变化', ...r.grid.slice(0, 5).map((v) => pct(v.cost_change))], [0, 1, 2, 3, 4].map(i => [pct(r.grid[i * 5].price_change), ...r.grid.slice(i * 5, i * 5 + 5).map((v) => `<span class="heat-cell ${v.gross_margin === null ? '' : v.gross_margin < 0 ? 'negative' : v.gross_margin > .2 ? 'positive' : ''}">${pct(v.gross_margin)}</span>`)]))}</section></div><section class="panel"><h2>计算口径</h2><p><code>${esc(r.formula)}</code></p>${jsonView(r.assumptions)}</section>`;
    }
    else {
        const isPct = r.metric === 'gross_margin', scale = isPct ? .01 : factor;
        const series = [...r.history.map((v) => ({ period: v.period, actual: v.value })), ...r.forecast.map((v) => ({ period: v.period, prediction: v.value }))];
        content = `<div class="panel"><div class="section-heading row-between"><div><h2>${esc(metricNames[r.metric])} · ${esc(r.selected_label)}</h2><p class="muted">实测历史与未来基线分开标记，没有风险概率。</p><p data-experiment-input-period>历史输入截至：${esc(recordedQuarter(r.train_end))}</p></div>${badge('统计基线', 'warm')}</div>${lineChart(series, [{ id: 'actual', name: '已输入实际值' }, { id: 'prediction', name: '未来基线' }], isPct ? '%' : u, scale)}${table(['季度', '点估计', '单步经验误差带'], r.forecast.map((f) => [esc(f.period), isPct ? pct(f.value) : amount(f.value, unit), f.lower === null ? '无足够校准 / 多步不提供' : (isPct ? pct(f.lower) : amount(f.lower, unit)) + ' — ' + (isPct ? pct(f.upper) : amount(f.upper, unit))]))}</div><section class="panel"><h2>相同滚动起点的回测比较</h2><p class="muted">${esc(r.selection)}</p>${table(['基线', 'MAE', 'RMSE', 'WAPE', '验证点'], r.backtests.map((b) => [esc(b.label) + (b.method === r.selected ? ' ' + badge('本次选择', 'good') : ''), num(b.mae / scale), num(b.rmse / scale), pct(b.wape), String(b.folds.length)]))}<p class="micro">MAE / RMSE单位：${isPct ? '百分点' : u}；WAPE 在实际值绝对和为 0 时留空。</p>${r.backtests.map((b) => `<details><summary>${esc(b.label)} · 逐折检查</summary>${table(['训练截至', '预测季度', '训练条数', '预测值', '实际值'], b.folds.map((f) => [esc(f.train_end), esc(f.target), String(f.train_count), num(f.prediction / scale), num(f.actual / scale)]))}</details>`).join('')}${r.locked_holdout ? `<details><summary>锁定方法的末两季保留检验 · ${r.locked_holdout.status === 'completed' ? '有结果' : '样本不足'}</summary><p class="micro">与上方全滚动期选出的预测方法分开检查，不把选择后误差当作泛化证明。</p>${jsonView(r.locked_holdout)}</details>` : ''}${r.excluded_periods.length ? notice('已排除未结束季度：' + r.excluded_periods.join('、'), 'warm') : ''}</section>`;
    }
    return heading(p.request.name, `${p.company} · ${r.kind === 'scenario' ? '参数化情景实验' : '滚动回测与预测'}`, routeButton('返回实验室', 'lab', 'secondary') + button(icon('download') + ' 导出实验', 'export-experiment') + (experimentProblem(e, scopedDatasets()) ? '' : routeButton('交给 Agent 研判', 'agents:experiment-' + e.id, 'primary'))) + sourceSummary + (experimentProblem(e, scopedDatasets()) ? notice(experimentProblem(e, scopedDatasets()), 'warm') : '') + `<div class="notice neutral"><span><strong>你的假设</strong>　${esc(p.request.assumptions)}</span></div>` + content + `<section class="panel"><details open><summary>本次方法边界</summary>${r.limitations.map((s) => `<p class="micro">${esc(s)}</p>`).join('')}</details><details><summary>可复现输入快照</summary>${jsonView({ experiment_id: e.id, experiment_version: e.version, experiment_hash: e.experiment_hash, target_period: p.target_period, analysis_as_of: p.analysis_as_of, dataset_version: p.dataset_version, dataset_hash: p.dataset_hash, request: p.request, snapshot: p.snapshot })}</details></section>`;
}
export async function comparePage(id = '') {
    if (id)
        return savedComparisonPage(id);
    const saved = await comparisonIndex();
    return heading('企业对照', '先核对共同季度与业务可比性；可保存为明确批准后才进入 Agent 的研究依据。') + `<section class="panel">${scopedDatasets().length >= 2 ? `<form id="compare-form" class="stack">${input('displayed_bindings', JSON.stringify(scopedDatasets().map(d => ({ id: d.id, version: d.version, hash: d.content_hash }))), 'type="hidden"')}<h2>选择 2–8 份数据集</h2><div class="choice-grid">${scopedDatasets().map(d => `<label class="choice"><input type="checkbox" name="dataset_ids" value="${esc(d.id)}"><span><strong>${esc(d.payload.company)}</strong><small>${esc(d.payload.name)} · 修订 ${d.version}</small></span></label>`).join('')}</div>${field('比较基期', select('comparison', comparisonModes, 'year_over_year'))}<p class="micro">使用所选数据的最新共同季度；结果显示后可明确命名并保存。数据不会自动发给模型。</p>${formFooter('对照共同季度')}</form>` : empty('至少需要两份数据集', '可以是不同企业，也可以是同一家企业不同口径的数据；先核实可比性。', routeButton('管理数据', 'data', 'primary'))}</section><div id="comparison-output"></div>` + saved;
}
export function comparisonOutput(result) { return comparisonResultView(result); }
export async function reportsPage(pageText = '0') {
    if (!/^(0|[1-9]\d?)$/.test(pageText) || Number(pageText) > 49)
        throw new Error('报告页码无效，请从研判报告重新打开。');
    const page = Number(pageText), size = 20, offset = page * size;
    const rows = await workspace('/reports' + scopeQuery() + '&limit=' + size + '&offset=' + offset);
    state.cache.reports = rows.items;
    const range = rows.items.length ? `${offset + 1}–${offset + rows.items.length} / ${rows.total} 份` : `本页无记录 · 当前范围共 ${rows.total} 份`;
    const pages = `<nav class="inline-actions" aria-label="报告历史分页">${page > 0 ? routeButton('上一页', 'reports:' + String(page - 1), 'secondary') : ''}${rows.has_more ? routeButton('下一页', 'reports:' + String(page + 1), 'secondary') : ''}</nav>`;
    return heading('研判报告', '当前身份与企业范围内的报告；历史结论绑定原始快照，数据修订不会静默改写旧报告。', rows.total > 1 ? button('对比两份报告', 'report-compare-dialog') : '') +
        `<section class="panel flush"><div class="section-heading row-between"><h2>已保存的报告</h2><span data-report-range>${range}</span></div>${pages}${rows.items.length ? table(['报告', '执行状态', '数据状态', '生成时间', ''], rows.items.map((r) => [`<button class="title-button" data-route="agents:run-${esc(r.id)}">${icon('report')}<span><strong>${esc(r.title)}</strong><small>${esc(r.query)}</small></span></button>`, status(r.state), sourceBadge(r) + (r.stale ? badge('原数据已有更新', 'warm') : ''), timeText(r.created_at), r.source_impact?.reasons?.some((reason) => reason.code === 'report_integrity_failed') ? '<span class="micro danger-text" data-report-export-unavailable>导出已停用：冻结报告完整性校验未通过，请核对可信记录或新建研判。</span>' : `<a class="text-button" href="/api/runs/${esc(r.id)}/export?format=md" download>${icon('download')} 导出</a> <a class="text-button" href="/api/runs/${esc(r.id)}/export?format=json" download>完整 JSON</a>`])) : empty(rows.total ? '此页没有报告' : '尚未生成研判报告', rows.total ? '记录数量可能已变化，请返回第一页核对。' : '完成一次有明确输入的研判，报告、规则和证据将一同归档。', routeButton(rows.total ? '返回第一页' : '发起研判', rows.total ? 'reports' : 'agents', 'primary'))}${pages}</section>`;
}
/** Load the bounded account history only when the user opens comparison. */
export async function loadReportComparisonSources(current) {
    const sameContext = contextGuard(), scope = scopeQuery(), items = [];
    let total;
    const valid = () => sameContext() && current();
    for (let offset = 0; offset < 1000; offset += 200) {
        if (!valid())
            return false;
        const page = await workspace('/reports' + scope + '&limit=200&offset=' + offset);
        if (!valid())
            return false;
        if (!Number.isSafeInteger(page.total) || page.total < 0 || page.total > 1000 || !Array.isArray(page.items) || page.items.length > 200 || page.offset !== offset || page.limit !== 200)
            throw new Error('报告历史分页信息无效，请重新读取后再对比。');
        if (total !== undefined && page.total !== total)
            throw new Error('读取期间报告数量已变化，请重新打开对比。');
        total = page.total;
        items.push(...page.items);
        if (new Set(items.map(r => r.id)).size !== items.length)
            throw new Error('读取期间报告历史已变化，请重新打开对比。');
        if (!page.has_more) {
            if (items.length !== total)
                throw new Error('报告历史尚未完整读取，请重新打开对比。');
            state.cache.reports = items;
            return true;
        }
        if (page.items.length !== 200)
            throw new Error('报告历史尚未完整读取，请重新打开对比。');
    }
    throw new Error('报告历史超出当前容量，请核对记录后再对比。');
}
function reportTime(value) { const d = new Date(String(value ?? '')); return Number.isFinite(d.valueOf()) ? d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '生成时间未记录'; }
export function reportSelectionDetails(left, right) {
    return `<div class="two-columns">${[['基准报告', left], ['对照报告', right]].map(([label, id]) => {
        const r = (state.cache.reports ?? []).find((v) => v.id === id);
        return `<section class="subpanel"><h3>${label}</h3>${r ? table(['保存范围', '原始内容'], [['研究问题', esc(r.query ?? '问题未记录')], ['目标季度', esc(r.current_period ?? '季度未记录')], ['数据修订', esc(r.dataset_version ?? '未记录')], ['生成时间', esc(reportTime(r.created_at))], ['报告标识', esc(r.id)]]) : notice('请选择当前范围内的已保存报告。')}</section>`;
    }).join('')}</div>`;
}
export function reportCompareForm() {
    const options = (state.cache.reports ?? []).map((r) => ({ value: r.id, label: String(r.query ?? r.title ?? '问题未记录').slice(0, 100) + ' · ' + (r.current_period ?? '季度未记录') + ' · 数据修订 ' + (r.dataset_version ?? '未记录') + ' · ' + reportTime(r.created_at) + ' · #' + String(r.id).slice(0, 8) }));
    const left = options[1]?.value ?? '', right = options[0]?.value ?? '';
    return `<form id="report-compare-form" class="stack">${field('基准报告', select('left', options, left))}${field('对照报告', select('right', options, right))}<div id="report-selection-details" aria-live="polite">${reportSelectionDetails(left, right)}</div>${formFooter('查看差异')}</form><div id="report-comparison" role="region" aria-label="报告差异结果" tabindex="-1"></div>`;
}
const reportMultiples = new Set(['inventory_turnover', 'asset_turnover', 'sales_production_ratio']);
const reportRatios = new Set(['gross_margin', 'net_margin', 'roe', 'cash_ratio', 'leverage', 'rd_ratio', 'revenue_growth', 'margin_change']);
function reportNumber(id, value, delta = false) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return '—';
    const sign = delta && value > 0 ? '+' : '';
    if (reportMultiples.has(id))
        return sign + num(value) + ' 倍';
    if (reportRatios.has(id))
        return delta || id === 'margin_change' ? sign + num(value * 100) + ' 个百分点' : pct(value);
    return num(value) + '（单位未记录）';
}
/** Describe the immutable report selected by the response, never the current dataset. */
function comparedReportSource(label, id) {
    const row = (state.cache.reports ?? []).find((v) => v.id === id);
    return `<p><strong>${label}</strong> ${row ? esc(row.query ?? '问题未记录') + ' · ' + esc(row.current_period ?? '季度未记录') + ' · 数据修订 ' + esc(row.dataset_version ?? '未记录') + ' · ' + esc(reportTime(row.created_at)) : '来源摘要未加载'} <span class="micro">#${esc(String(id ?? '未记录').slice(0, 8))}</span></p>`;
}
export function reportComparisonView(r) {
    const comparable = r.changes.filter((c) => typeof c.delta === 'number' && Number.isFinite(c.delta));
    const changed = comparable.filter((c) => c.delta !== 0);
    const summary = changed.length ? `<ul class="report-change-summary">${changed.map((c) => `<li data-change-metric="${esc(c.metric)}"><strong>${esc(metricNames[c.metric] ?? c.metric)}</strong><span>${reportNumber(c.metric, c.before)} → ${reportNumber(c.metric, c.after)}</span><strong>${reportNumber(c.metric, c.delta, true)}</strong></li>`).join('')}</ul>` : notice(comparable.length ? '可比较指标没有数值变化。' : '没有可计算的数值差异，请核对下方缺失值。');
    return `<section class="panel"><h3>${esc(r.left_period)} → ${esc(r.right_period)}</h3><h4>数值变化摘要</h4>${summary}<p class="micro">变化 = 对照 − 基准；比率差值以百分点表示，倍数差值以倍表示。这里只说明冻结数值差异，不直接判断经营改善或恶化。</p>${notice(r.warning, r.same_period ? 'neutral' : 'warm')}${!r.same_rule_version ? notice('规则版本不同，不可直接将得分变化解释为经营变化。', 'warm') : ''}<div class="report-bound-sources" data-report-left="${esc(r.left)}" data-report-right="${esc(r.right)}">${comparedReportSource('基准报告', r.left)}${comparedReportSource('对照报告', r.right)}</div><h4>完整冻结指标</h4><p class="micro">以下保留两份报告的冻结数值；缺失值不作为零值计算。</p>${table(['指标', '基准', '对照', '变化'], r.changes.map((c) => [esc(metricNames[c.metric] ?? c.metric), reportNumber(c.metric, c.before), reportNumber(c.metric, c.after), reportNumber(c.metric, c.delta, true)]))}<details><summary>输入修订差异</summary>${jsonView(r.input_diff)}</details></section>`;
}
export async function actionsPage() {
    const rows = await workspace('/actions');
    rows.items = rows.items.filter((a) => (a.payload.identity_id ?? '') === state.identity && (!state.active || a.payload.dataset_id === state.active));
    state.cache.actions = rows.items;
    const columns = [['open', '待开展'], ['in_progress', '进行中'], ['blocked', '已阻塞'], ['done', '已验收']];
    return heading('跟进行动', '当前服务身份与所选企业范围内的行动；切换身份或企业查看其他记录。', button(icon('plus') + ' 新建行动', 'action-dialog', 'primary')) +
        `<div class="kanban">${columns.map(([key, label]) => { const items = rows.items.filter((a) => a.payload.status === key); return `<section class="kanban-column"><div class="row-between"><h2>${esc(label)}</h2><span class="count">${items.length}</span></div>${items.map((a) => { const p = a.payload; const late = p.due_at && p.due_at < new Date().toISOString().slice(0, 10) && p.status !== 'done'; return `<button class="action-card" data-action="action-detail" data-id="${esc(a.id)}"><div class="row-between">${badge(p.priority === 'high' ? '优先处理' : p.priority === 'low' ? '低优先级' : '常规', p.priority === 'high' ? 'warm' : 'neutral')}${late ? badge('已逾期', 'danger') : ''}</div><h3>${esc(p.title)}</h3><p>${esc(p.company || '通用事项')}</p>${sourceBadge(a)}<div class="micro-row"><span>${icon('clock')} ${esc(p.due_at ?? '未设置期限')}</span><span>${esc(p.owner || '待指定负责人')}</span></div></button>`; }).join('') || '<div class="column-empty">暂无事项</div>'}</section>`; }).join('')}</div>${rows.items.some((a) => a.payload.status === 'dismissed') ? `<section class="panel"><details><summary>已搁置事项</summary>${rows.items.filter((a) => a.payload.status === 'dismissed').map((a) => button(esc(a.payload.title), 'action-detail', 'text-button', `data-id="${esc(a.id)}"`)).join('')}</details></section>` : ''}`;
}
export function actionForm(source = {}) { const dataset = state.datasets.find(d => d.id === (source.dataset_id ?? state.active)); const reference = source.source_ref ?? (source.run_id ? { kind: 'report', run_id: source.run_id } : source.key ? { kind: 'insight', source_key: source.key } : dataset ? { kind: 'dataset', dataset_version: dataset.version, dataset_hash: dataset.content_hash } : null); return `<form id="action-form" class="stack" data-request-id="${esc(crypto.randomUUID())}" data-identity-id="${esc(state.identity)}" data-source-key="${esc(source.key ?? '')}" data-run-id="${esc(source.run_id ?? '')}" data-dataset-id="${esc(source.dataset_id ?? state.active)}">${sourceForm(reference)}${field('行动标题', input('title', source.title, 'required maxlength="200"'))}<div class="form-grid">${field('所属企业', input('company', source.company ?? dataset?.payload.company ?? '', dataset ? 'readonly' : ''))}${field('负责人', input('owner', state.user.name, 'maxlength="100"'))}${field('优先级', select('priority', { high: '优先处理', normal: '常规', low: '低优先级' }, source.priority ?? 'normal'))}${field('截止日期', input('due_at', '', 'type="date"'))}</div>${field('背景与依据', textarea('description', source.message ?? '', 'rows="3" maxlength="3000"'))}${field('明确的验收标准', textarea('acceptance', source.acceptance ?? '', 'required minlength="5" rows="3" maxlength="2000"'))}${formFooter('创建跟进行动')}</form>`; }
export function actionEditForm(a) { const p = a.payload; return `<form id="action-edit-form" class="stack" data-id="${esc(a.id)}" data-version="${a.version}">${notice('修改将保留原始来源和逐项变更历史。已验收事项须先重新打开。')}${field('行动标题', input('title', p.title, 'required maxlength="200"'))}<div class="form-grid">${field('负责人', input('owner', p.owner, 'maxlength="100"'))}${field('截止日期', input('due_at', p.due_at ?? '', 'type="date"'))}${field('优先级', select('priority', { high: '优先处理', normal: '常规', low: '低优先级' }, p.priority))}</div>${field('背景与依据', textarea('description', p.description, 'rows="3" maxlength="3000"'))}${field('验收标准', textarea('acceptance', p.acceptance, 'required minlength="5" maxlength="2000" rows="3"'))}${field('修改原因', textarea('note', '', 'required minlength="5" maxlength="2000" rows="2"'))}${formFooter('保存修改并记录历史')}</form>`; }
export function actionDetail(a, evidence = []) { const p = a.payload; const next = { open: { in_progress: '开始进行', blocked: '记录阻塞', dismissed: '暂时搁置' }, in_progress: { done: '验收完成', blocked: '记录阻塞', dismissed: '暂时搁置' }, blocked: { in_progress: '解除阻塞', dismissed: '暂时搁置' }, done: { open: '重新打开' }, dismissed: { open: '重新打开' } }; const labels = { title: '标题', owner: '负责人', due_at: '截止日期', priority: '优先级', acceptance: '验收标准', description: '背景与依据' }; const sources = evidence.filter(e => e.eligible && e.review && (!e.review.company || e.review.company === p.company)); return `<div class="stack"><div class="row-between"><h3>${esc(p.title)}</h3>${status(p.status)}</div><div class="inline-actions">${p.dataset_id ? `<button type="button" class="secondary" data-x-action="watch-from-action" data-id="${esc(a.id)}">为此行动跟踪指标</button>` : ''}${p.status !== 'done' ? button('编辑行动', 'action-edit', 'secondary', `data-id="${esc(a.id)}"`) : notice('已验收：重新打开后可编辑')}</div>${table(['负责人', '截止日期', '优先级', '所属企业'], [[esc(p.owner || '待指定负责人'), esc(p.due_at || '未设置期限'), esc({ high: '优先处理', normal: '常规', low: '低优先级' }[p.priority]), esc(p.company || '通用事项')]])}<p class="micro">服务身份：${esc(state.identities.find(i => i.id === p.identity_id)?.payload.name || (p.identity_id ? '已删除身份' : '默认身份'))} · 数据集：${esc(p.dataset_id || '未关联')} · 报告来源：${esc(p.run_id || '未关联')} · 核查项：${esc(p.source_key || '手动创建')}</p>${sourcePanel(a)}${a.acceptance_impact && a.acceptance_impact.state !== 'current' ? notice('验收证据的当前状态已有变化，请核对原始验收记录；不会自动撤销或重新验收。', 'warm') : ''}<p>${esc(p.description)}</p><div class="subpanel"><span class="eyebrow">验收标准</span><p>${esc(p.acceptance)}</p></div><form id="action-transition-form" data-id="${esc(a.id)}" data-version="${a.version}" data-evidence-refs="${esc(JSON.stringify(sources.map(e => ({ id: e.id, version: e.version, content_hash: e.content_hash, review_version: e.review_version, review_hash: e.review_hash }))))}" class="stack">${field('下一步', select('status', next[p.status]))}${field('处理记录 / 验收结果', textarea('note', '', 'rows="3" minlength="5" maxlength="2000" required placeholder="说明完成了什么、依据是什么，或因何阻塞"'))}${sources.length ? `<fieldset><legend>关联证据（最多 10 份）</legend><p class="micro">先核对当前审阅与原文，再勾选本次依据。人工接受仅记录审阅意见，不代表系统已验证资料真实；展开详情不会选中证据。</p><div class="action-evidence-list">${sources.map(actionEvidenceChoice).join('')}</div></fieldset>` : notice('当前企业范围内暂无可选证据。可先在证据资料中保存并审阅来源。')}${formFooter('记录状态变更')}</form><details><summary>状态历史 · ${p.history.length} 条</summary>${p.history.map((h) => `<div class="timeline-entry"><span>${timeText(h.at)}</span><div>${status(h.status ?? h.to)}<p>${esc(h.note)}</p><small>${esc((h.evidence_ids ?? []).map((id) => evidence.find(e => e.id === id)?.payload.title ?? id).join('，'))}</small>${acceptanceEvidence(h)}</div></div>`).join('')}</details><details><summary>修改历史 · ${(p.changes ?? []).length} 条</summary>${(p.changes ?? []).map((h) => `<div class="timeline-entry"><span>${timeText(h.at)} · 版本 ${h.version}</span><div><p>${esc(h.note)}</p>${Object.entries(h.fields).map(([k, v]) => `<p>${esc(labels[k] ?? k)}：${esc(v.before ?? '未设置')} → ${esc(v.after ?? '未设置')}</p>`).join('')}</div></div>`).join('') || '<p class="muted">尚无内容修改</p>'}</details>${p.origin ? `<details><summary>${p.origin_kind === 'before_first_edit' ? '首次编辑前内容（旧版记录）' : '原始行动内容'}</summary>${table(['字段', p.origin_kind === 'before_first_edit' ? '首次编辑前内容' : '创建时内容'], Object.entries(labels).map(([k, label]) => [esc(label), esc(p.origin[k] ?? '未设置')]))}</details>` : ''}</div>`; }
