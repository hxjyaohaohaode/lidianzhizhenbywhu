import { comparisonReceiptView } from './saved-comparisons.js';
import { esc, badge, notice, routeButton, timeText, field, textarea } from './components.js';
const states = { current: '来源与当前一致', changed: '来源已有变化', unavailable: '部分来源不可用', unknown: '历史来源未绑定' };
export function sourceBadge(row) { const impact = row?.source_impact; return badge(states[impact?.state] ?? states.unknown, impact?.state === 'current' ? 'good' : impact?.state === 'changed' || impact?.state === 'unavailable' ? 'warm' : 'neutral'); }
export function sourcePanel(row) { const p = row?.payload?.provenance, impact = row?.source_impact; return `<section class="subpanel business-source"><div class="row-between"><h4>创建依据与当前状态</h4>${sourceBadge(row)}</div>${p ? `<p class="micro">${esc(p.company || '通用事项')} · 原始数据修订 ${esc(p.dataset_version ?? '未记录')} · ${timeText(p.captured_at)}</p><p class="micro wrap">输入校验：${esc(p.dataset_hash ?? '未记录')}</p>${p.run_id && !(impact?.reasons ?? []).some((r) => r.code === 'report_removed') ? routeButton('查看原始报告', 'agents:run-' + p.run_id, 'text-button') : ''}${p.source_message_id ? `<p class="micro">助手原消息 ${esc(p.source_message_id)}</p>` : ''}${p.alert_id ? `<p class="micro">源提醒 ${esc(p.alert_id)}</p>` : ''}` : notice('旧记录未保存完整来源绑定，不能推定它基于当前数据。')}${comparisonReceiptView(p?.comparison_reference)}${(impact?.reasons ?? []).map((r) => `<p class="micro">${esc(r.message ?? r.code)}</p>`).join('')}${impact?.current ? `<p class="micro">当前数据修订 ${esc(impact.current.version)}；原行动、阈值与历史验收不会自动改写。</p>` : ''}</section>`; }
export function sourceForm(reference) { return reference ? `<input type="hidden" name="source_ref" value="${esc(JSON.stringify(reference))}"><p class="micro">将保留原始依据及版本；保存时重新核对来源。</p>${['report', 'alert', 'action'].includes(reference.kind) ? `<label class="check-label"><input type="checkbox" name="allow_historical"> 若来源已有更新，我明确选择仍以这份历史报告 / 提醒 / 行动为依据，并自行核查其适用性</label>` : ''}` : ''; }
function reviewedDataset(reference) {
    if (!Number.isSafeInteger(reference.dataset_version) || reference.dataset_version < 1 || typeof reference.dataset_hash !== 'string' || !/^[a-f0-9]{64}$/.test(reference.dataset_hash))
        throw new Error('来源数据版本或指纹缺失，请刷新并重新打开表单；不会自动使用最新数据');
    return reference;
}
export function formSource(fd, requiredDatasetId = '') {
    const value = fd.get('source_ref');
    if (value) {
        const reference = JSON.parse(String(value));
        if (reference.kind === 'dataset')
            reviewedDataset(reference);
        return { source_ref: { ...reference, allow_historical: fd.has('allow_historical') } };
    }
    const datasets = fd.get('source_datasets');
    if (datasets) {
        const reference = JSON.parse(String(datasets))[String(fd.get('dataset_id') ?? '')];
        if (!reference)
            throw new Error('所选数据不在此表单的来源范围，请重新打开表单');
        return { source_ref: reviewedDataset({ kind: 'dataset', dataset_version: reference.version, dataset_hash: reference.hash }) };
    }
    if (requiredDatasetId)
        throw new Error('来源数据版本或指纹缺失，请刷新并重新打开表单；不会自动使用最新数据');
    return {};
}
export function acceptanceEvidence(history) { const rows = history.evidence_snapshots ?? []; return rows.length ? `<details><summary>本次验收冻结的证据 · ${rows.length} 份</summary>${rows.map((r) => `<article><h4>${esc(r.title ?? r.payload?.title ?? r.id)}</h4><p class="micro">原文版本 ${esc(r.version)} · 审阅版本 ${esc(r.review_version)} · ${esc(r.content_hash)}</p>${r.text ? `<p class="preserve-lines">${esc(r.text)}</p>` : ''}${r.text_truncated ? notice('冻结原文仅保存前 12,000 字符；完整原文指纹与原长度 ' + r.text_length + ' 已记录。', 'warm') : ''}${r.review?.note ? `<p class="micro">当时审阅：${esc(r.review.note)}</p>` : ''}</article>`).join('')}</details>` : ''; }
/** Continue a known-created unique insight action as an explicit edit, never bypass dedup. */
export function continueInsightDraft(form, saved) {
    if (!form.dataset.sourceKey)
        return false;
    if (saved.payload.status === 'done') {
        form.insertAdjacentHTML('afterbegin', notice('原行动已经验收，请先在行动详情重新打开，再修改；你的新草稿仍保留。', 'warm') + routeButton('打开行动列表查看原记录', 'actions', 'text-button'));
        return true;
    }
    form.id = 'action-edit-form';
    form.dataset.id = saved.id;
    form.dataset.version = String(saved.version);
    form.insertAdjacentHTML('afterbegin', notice('此核查项的行动已创建。保留你的新内容；填写修改原因，再明确保存对同一行动的修改。', 'warm'));
    const footer = form.querySelector('.form-footer');
    footer?.insertAdjacentHTML('beforebegin', field('继续修改的原因', textarea('note', '', 'required minlength="5" maxlength="2000" rows="2"')));
    const submit = form.querySelector('button[type="submit"]');
    if (submit)
        submit.textContent = '保存此行动的修改';
    return true;
}
