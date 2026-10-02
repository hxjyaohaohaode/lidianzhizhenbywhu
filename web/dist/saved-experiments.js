import { esc, field, select, notice, jsonView } from './components.js';
/** A saved result cannot replace newer navigation or inputs while a write waits. */
export function unchangedInputGuard(current, read) {
    const initial = read();
    return () => current() && read() === initial;
}
export function experimentProblem(row, datasets) {
    const d = datasets.find(d => d.id === row.payload.dataset_id);
    if (!d)
        return '实验数据集不在当前身份范围内';
    if (d.version !== row.payload.dataset_version || d.content_hash !== row.payload.dataset_hash)
        return '原始数据已有新版本，请重新计算实验';
    if (row.payload.request.kind === 'forecast' && !row.payload.analysis_as_of)
        return '旧预测实验未记录计算日期，请重新保存';
    return '';
}
export function experimentSelection(rows, selected = '') {
    return field('复用已保存数学实验（可选）', select('experiment_id', [{ value: '', label: '不引用旧实验，使用下方本次参数' }, ...rows.map(e => ({ value: e.id, label: e.payload.request.name + ' · ' + (e.payload.target_period ?? '原始最新季度') + ' · v' + e.version }))], selected, 'id="plan-experiment"')) + '<div id="selected-experiment-details" aria-live="polite"></div>';
}
export function experimentProvenance(p) {
    return p ? `<section class="subpanel"><h3>已选数学实验 · ${esc(p.name)}</h3><p>${esc(p.assumptions)}</p><p class="micro">原始实验 v${esc(p.version)} · 目标 ${esc(p.target_period)} · 计算日期 ${esc(p.analysis_as_of ?? '无时间依赖的情景计算')}</p><details><summary>实验来源与结果指纹</summary>${jsonView(p)}</details></section>` : '';
}
export function syncExperimentControls(root, rows, datasets) {
    const form = root.querySelector('#plan-form');
    if (!form)
        return;
    const selector = form.querySelector('#plan-experiment');
    if (!selector)
        return;
    const row = rows.find(r => r.id === selector.value);
    const kind = row?.payload.request.kind;
    for (const name of ['with_scenario', 'scenario_price', 'scenario_cost', 'scenario_volume', 'scenario_fixed', 'scenario_note', 'forecast', 'forecast_metric', 'forecast_horizon']) {
        const input = form.querySelector(`[name="${name}"]`);
        if (input)
            input.disabled = !!row && (kind === 'scenario' ? !name.startsWith('forecast') : name.startsWith('forecast'));
    }
    const detail = form.querySelector('#selected-experiment-details');
    if (detail)
        detail.innerHTML = row ? notice(experimentProblem(row, datasets) || '将直接复用此实验的原始参数和假设；对应参数已锁定，须在下一步审阅并批准。', experimentProblem(row, datasets) ? 'warm' : 'neutral') + `<p>${esc(row.payload.request.assumptions)}</p><p class="micro">实验 v${esc(row.version)} · 数据 v${esc(row.payload.dataset_version)} · ${esc(row.payload.target_period ?? '原始最新季度')}</p>` : '';
}
export function selectedExperimentRequest(row, datasetId, datasets) {
    if (!row)
        throw new Error('所选实验已不可用，请重新选择');
    const problem = experimentProblem(row, datasets);
    if (problem)
        throw new Error(problem);
    if (row.payload.dataset_id !== datasetId)
        throw new Error('实验与所选数据集不一致，请选择实验所属数据集或取消实验选择');
    return { id: row.id, version: row.version, hash: row.experiment_hash };
}
