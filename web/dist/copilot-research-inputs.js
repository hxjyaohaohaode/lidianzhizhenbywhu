import { experimentProblem, experimentProvenance, selectedExperimentRequest } from './saved-experiments.js';
import { comparisonProblem, comparisonArtifactView, selectedComparisonRequest, comparisonModes } from './saved-comparisons.js';
import { mathResult } from './math-results.js';
import { esc, field, select, notice, table, pct, metricNames, routeButton } from './components.js';
const hashPattern = /^[a-f0-9]{64}$/;
export function scopedResearchInputs(identityId, datasetId, experiments, comparisons, datasets) {
    const allowed = new Set(datasets.map(d => d.id));
    return { identityId, datasetId,
        experiments: (experiments.items ?? []).filter((r) => allowed.has(datasetId) && r.payload?.dataset_id === datasetId),
        comparisons: (comparisons.items ?? []).filter((r) => (r.payload?.identity_id ?? '') === identityId && r.payload?.members?.some((m) => m.id === datasetId) && r.payload.members.every((m) => allowed.has(m.id))),
        hasMore: !!(experiments.has_more || comparisons.has_more) };
}
export function researchInputFields(inputs) {
    return `<section class="subpanel"><h3>明确选择已保存研究依据</h3><p class="micro">仅列出当前身份可访问、与本会话企业匹配的记录。默认不引用；所选记录的原始假设和目标季度会在确认页再次展示。</p>${field('数学实验（可选）', select('experiment_id', [{ value: '', label: '不引用已保存实验' }, ...inputs.experiments.map(r => ({ value: r.id, label: r.payload.request.name + ' · ' + (r.payload.target_period ?? '原始目标季度未记录') + ' · v' + r.version }))], '', 'id="copilot-experiment"'))}<div id="copilot-experiment-details" aria-live="polite"></div>${field('企业对照（可选）', select('comparison_artifact_id', [{ value: '', label: '不加入多企业对照' }, ...inputs.comparisons.map(r => ({ value: r.id, label: r.payload.name + ' · ' + r.payload.period + ' · v' + r.version + ' · ' + r.payload.members.length + ' 份输入' }))], '', 'id="copilot-comparison"'))}<div id="copilot-comparison-details" aria-live="polite"></div><div id="copilot-input-conflicts" aria-live="polite"></div>${!inputs.experiments.length && !inputs.comparisons.length ? notice('当前范围还没有已保存的数学实验或企业对照。可以先在数学建模或企业对照工作区保存，也可直接继续本次研判。') : ''}${inputs.hasMore ? notice('仅列出最近 200 份记录，较早记录仍保留；未自动选用任何记录。') : ''}</section>`;
}
function experimentView(row) {
    const p = row.payload, r = p.request;
    return experimentProvenance({ id: row.id, version: row.version, hash: row.experiment_hash ?? row.hash, name: r.name, kind: r.kind, assumptions: r.assumptions, target_period: p.target_period ?? '原始目标季度未记录', analysis_as_of: p.analysis_as_of, dataset_id: p.dataset_id, dataset_version: p.dataset_version, dataset_hash: p.dataset_hash }) +
        `<p class="micro">冻结企业：${esc(p.company ?? p.dataset_id)} · 数据修订 ${esc(p.dataset_version)}</p>` +
        (r.kind === 'forecast' ? table(['冻结预测目标', '冻结步数'], [[esc(metricNames[r.metric] ?? r.metric), esc(r.horizon) + ' 个季度']]) : table(['冻结假设', '变化 / 比例'], [['售价变化', pct(r.price_change)], ['单位变动成本变化', pct(r.cost_change)], ['销量变化', pct(r.volume_change)], ['固定成本占比', pct(r.fixed_cost_share)]]));
}
function comparisonView(row, label, showResult = false) { return `<p class="micro">冻结对照记录 v${esc(row.version ?? '未记录')}</p>` + comparisonArtifactView(row, label, showResult); }
function jointProblem(experiment, comparison) {
    if (!experiment || !comparison)
        return '';
    if (!experiment.payload.target_period)
        return '旧实验摘要未记录目标季度，请重新保存实验后再与对照组合使用。';
    if (experiment.payload.target_period !== comparison.payload.period)
        return '数学实验目标季度与企业对照共同季度不一致，请改选相同季度的记录或取消其中一项。';
    if (experiment.payload.analysis_as_of && experiment.payload.analysis_as_of !== comparison.payload.analysis_as_of)
        return '数学实验与企业对照的计算核验日期不一致，请重新保存到相同日期后再组合使用。';
    return '';
}
/** Keep local forecast edits while showing the saved values in locked controls. */
export function syncResearchInputControls(form, inputs, datasets) {
    const selected = (name) => form.querySelector(`[name="${name}"]`)?.value ?? '';
    const experimentId = selected('experiment_id'), comparisonId = selected('comparison_artifact_id');
    const experiment = inputs.experiments.find(r => r.id === experimentId), comparison = inputs.comparisons.find(r => r.id === comparisonId);
    const frozen = experiment?.payload.request.kind === 'forecast';
    for (const name of ['forecast', 'forecast_metric', 'horizon']) {
        const input = form.querySelector(`[name="${name}"]`);
        if (!input)
            continue;
        if (frozen) {
            if (input.dataset.researchBefore === undefined)
                input.dataset.researchBefore = JSON.stringify({ value: input.value, checked: name === 'forecast' ? input.checked : null, disabled: input.disabled });
            if (name === 'forecast')
                input.checked = true;
            else
                input.value = String(name === 'horizon' ? experiment.payload.request.horizon : experiment.payload.request.metric);
            input.disabled = true;
        }
        else if (input.dataset.researchBefore !== undefined) {
            const before = JSON.parse(input.dataset.researchBefore);
            input.value = before.value;
            input.disabled = before.disabled;
            if (name === 'forecast')
                input.checked = before.checked;
            delete input.dataset.researchBefore;
        }
    }
    const e = form.querySelector('#copilot-experiment-details');
    if (e) {
        const problem = experiment ? experimentProblem(experiment, datasets) : experimentId ? '所选数学实验已不可用，请重新打开提案' : '';
        e.innerHTML = problem ? notice(problem, 'warm') : experiment ? notice('将复用此实验的原始参数和假设。研究问题须与下列目标季度一致；不会自动改写你的问题。') + experimentView(experiment) : '';
    }
    const c = form.querySelector('#copilot-comparison-details');
    if (c) {
        const problem = comparison ? comparisonProblem(comparison, datasets, inputs.identityId) : comparisonId ? '所选企业对照已不可用，请重新打开提案' : '';
        c.innerHTML = problem ? notice(problem, 'warm') : comparison ? comparisonView(comparison, '本次明确纳入的全部对照成员') + notice('确认时将核对所有成员的名称、季度、派生指标与来源范围；主企业选择不会隐去其他成员。不会自动获取同行资料或召回同行记忆。') : '';
    }
    const conflict = form.querySelector('#copilot-input-conflicts');
    if (conflict) {
        const problem = jointProblem(experiment, comparison);
        conflict.innerHTML = problem ? notice(problem, 'warm') : '';
    }
}
export function researchInputRequest(fd, inputs, identityId, datasetId, datasets) {
    if (inputs.identityId !== identityId || inputs.datasetId !== datasetId || !datasets.some(d => d.id === datasetId))
        throw new Error('身份或企业范围已变化，请从当前会话重新打开提案。');
    const id = String(fd.get('experiment_id') ?? ''), comparisonId = String(fd.get('comparison_artifact_id') ?? '');
    const experiment = inputs.experiments.find(r => r.id === id), comparison = inputs.comparisons.find(r => r.id === comparisonId);
    const exact = (row, hash) => { if (!Number.isInteger(row?.version) || row.version < 1 || !hashPattern.test(hash ?? ''))
        throw new Error('所选记录缺少完整版本指纹，请刷新后重新选择'); };
    const result = {};
    if (id) {
        if (!experiment)
            throw new Error('所选数学实验不在当前会话范围');
        exact(experiment, experiment.experiment_hash);
        result.experiment = selectedExperimentRequest(experiment, datasetId, datasets);
    }
    if (comparisonId) {
        if (!comparison)
            throw new Error('所选企业对照不在当前身份与企业范围');
        exact(comparison, comparison.comparison_hash);
        result.comparison_artifact = selectedComparisonRequest(comparison, datasetId, datasets, identityId);
    }
    const problem = jointProblem(experiment, comparison);
    if (problem)
        throw new Error(problem);
    // Omit all fields bound by a saved forecast, even if a stale FormData included them.
    const forecast = experiment?.payload.request.kind === 'forecast' ? {} : { forecast: fd.has('forecast'), forecast_metric: String(fd.get('forecast_metric') ?? 'revenue'), horizon: Number(fd.get('horizon') ?? 2) };
    return { references: result, forecast };
}
export function researchApprovalInputs(plan) {
    const s = plan.snapshot ?? {}, experiment = s.experiment, comparison = s.comparison_artifact ?? plan.context?.selected_comparison;
    const scope = s.research_scope ?? plan.context?.research_scope, comparisonMode = s.comparison ?? plan.request?.comparison;
    return `<section class="subpanel"><h3>本次研判目标与冻结输入</h3><p><strong>目标季度：</strong>${esc(scope?.period ?? '以计划列明的输入为准')} · <strong>比较基期：</strong>${esc(comparisonModes[comparisonMode] ?? comparisonMode ?? '以计划列明的输入为准')}</p>${scope?.notice ? notice(scope.notice) : ''}${experiment ? experimentView(experiment) : experimentProvenance(plan.context?.selected_experiment)}${comparison ? comparisonView(comparison, '确认纳入的全部企业对照') + notice('范围包括以上全部成员的派生指标、名称、季度、版本和可比性说明；主企业只是报告主线，不会隐去其他成员。不会自动外发完整同行财务快照。', 'warm') : ''}</section>`;
}
export function researchRunOutputs(result, unit = 'wan') {
    if (!result)
        return '';
    const outputs = Object.entries(result.adaptive?.mathematical_outputs ?? {}).filter(([kind, value]) => ['forecast', 'sensitivity', 'comparison'].includes(kind) && value && typeof value === 'object');
    const comparison = result.comparison_artifact ?? result.comparison_provenance;
    if (!outputs.length && !result.experiment && !comparison)
        return '';
    return `<section class="chat-math-results"><h4>本次已保存的数学依据</h4>${experimentProvenance(result.experiment)}${outputs.map(([kind, value]) => mathResult(kind, value, unit)).join('')}${comparison ? comparisonView(comparison, '报告冻结的全部企业对照', !outputs.some(([kind]) => kind === 'comparison')) : ''}${result.experiment?.id ? routeButton('查看原始数学实验', 'lab:' + result.experiment.id) : ''}${comparison?.id ? routeButton('查看原始企业对照', 'compare:' + comparison.id) : ''}<p class="micro">以上仅展示本次保存的真实产物；未按当前企业数据重算，未补造缺失结果。</p></section>`;
}
