/** Saved comparison presentation and exact, explicit multi-company input bindings. */
import { viewWorkspace as workspace, workspace as writeWorkspace, contextGuard, ApiError } from './api.js';
import { state, scopedDatasets, scopeQuery } from './state.js';
import { esc, field, input, textarea, select, notice, jsonView, table, pct, heading, routeButton, button, badge, empty, timeText, formFooter } from './components.js';
/** Mutation revision only, not another comparison store. Re-read GET batches whose
 * response could predate a confirmed removal, before publishing any cache or UI. */
let comparisonRevision = 0;
const pendingRemovals = new Set();
export async function currentComparisonRead(read) {
    const valid = contextGuard();
    for (let attempt = 0; attempt < 3; attempt++) {
        const revision = comparisonRevision;
        const value = await read();
        if (!valid())
            throw new ApiError('账户或服务身份已变化，已丢弃旧对照读取。', 409, 'STALE_SESSION', '');
        if (revision === comparisonRevision)
            return value;
    }
    throw new ApiError('企业对照在读取期间已变化，请重新读取当前记录。', 409, 'COMPARISON_CHANGED', '');
}
export function comparisonRemovalTarget(id, version, identityId, source) {
    if (source === 'history') {
        const history = state.cache.serviceHistory;
        const row = history?.scope === 'account_owned_orphan_history' && !!state.user?.id && state.cache.serviceHistoryOwner === state.user.id ? history.items.find((r) => r.id === id && r.kind === 'comparison') : null;
        if (!row || row.identity_id !== identityId || row.payload?.identity_id !== identityId || !Number.isSafeInteger(version) || version < 1 || row.version !== version)
            throw new Error('账户历史对照已变化或尚未加载，请从历史列表重新核对');
        return { id: row.id, version: row.version, identityId, name: row.payload.name, period: row.payload.period, source: 'history' };
    }
    if (identityId !== state.identity)
        throw new Error('服务身份已经变化，请在当前身份中重新打开清理窗口');
    const rows = [state.cache.comparison, ...(state.cache.comparisons ?? []), ...(state.cache.planComparisons ?? [])].filter(Boolean);
    const row = rows.find(r => r.id === id && (r.payload?.identity_id ?? '') === identityId);
    if (!row || !Number.isSafeInteger(version) || version < 1 || row.version !== version)
        throw new Error('当前显示的对照已变化或不可用，请刷新核对后重新清理');
    return { id: row.id, version: row.version, identityId, name: row.payload.name, period: row.payload.period };
}
export function comparisonDeleteForm(target) {
    return `<form id="comparison-delete-form" class="stack" data-id="${esc(target.id)}" data-version="${target.version}" data-identity-id="${esc(target.identityId)}" data-source="${target.source ?? 'current'}">${target.source === 'history' ? notice('这是当前账户已加载的失效范围历史对照，原服务身份：' + (target.identityId || '默认身份') + '。这里只清理原始记录，不恢复历史身份的执行或编辑权限。', 'warm') : ''}<p>即将永久清理已保存企业对照 <strong>${esc(target.name)}</strong></p><p><strong>共同季度：</strong>${esc(target.period)} · <strong>记录版本：</strong>v${target.version}</p><p class="micro">对象 ID：${esc(target.id)}</p>${notice('删除后不可恢复。这份原始对照及其完整输入快照将被移除，不能再加入新计划；引用它的计划后续外发将停止，关联来源将标记为不可用。', 'danger')}${notice('已批准计划、历史报告和已归档摘要保留当时的冻结内容，不会连带删除或重新计算。当前草稿中对此对照的选择会取消，其他输入保留。')}<p class="micro">${target.source === 'history' ? '此处是当前账户的失效范围历史，清理后释放账户的对照记录容量，无需切回已删除的原身份；其他类型的历史记录仍仅供只读核查。' : '清理后释放账户的对照记录容量。当前列表仅显示本身份与企业筛选范围，其他记录需切换范围查看。原身份已删除或范围已失效时，请到“身份与连接 → 已失效研究范围的历史”只读核查并清理原对照。'}</p><label class="check-label"><input type="checkbox" name="confirm_delete" required>我已核对上述对象、季度和版本，确认永久删除并了解关联影响</label><p class="form-error" role="alert"></p><div class="form-footer">${button('取消', 'close-modal')}<button class="primary" type="submit">永久删除这份对照</button></div></form>`;
}
export function comparisonHistoryDeleteButton(row) { return row.kind === 'comparison' ? button('永久清理原对照', 'delete-comparison', 'text-button danger-text', `data-id="${esc(row.id)}" data-version="${row.version}" data-identity-id="${esc(row.identity_id)}" data-source="history"`) : ''; }
function comparisonDeleteButton(row) { return button('清理对照', 'delete-comparison', 'text-button danger-text', `data-id="${esc(row.id)}" data-version="${row.version}" data-identity-id="${esc(row.payload.identity_id ?? '')}" aria-label="清理对照：${esc(row.payload.name)}"`); }
/** Remove only live object references. Approved plans, reports and receipts stay frozen. */
export function forgetComparison(target) {
    const history = state.cache.serviceHistory;
    if (history && state.cache.serviceHistoryOwner === state.user?.id) {
        const before = history.items.length;
        history.items = history.items.filter((r) => r.kind !== 'comparison' || r.id !== target.id || r.identity_id !== target.identityId);
        if (history.next_offset !== null && history.next_offset !== undefined)
            history.next_offset = Math.max(0, history.next_offset - (before - history.items.length));
    }
    for (const key of ['comparisons', 'planComparisons'])
        if (Array.isArray(state.cache[key]))
            state.cache[key] = state.cache[key].filter((r) => r.id !== target.id || (r.payload?.identity_id ?? '') !== target.identityId);
    if (state.cache.comparison?.id === target.id && (state.cache.comparison.payload?.identity_id ?? '') === target.identityId)
        delete state.cache.comparison;
}
export function removeComparisonOption(selector, id) {
    if (!selector)
        return false;
    const selected = selector.value === id;
    for (const option of [...selector.options])
        if (option.value === id)
            option.remove();
    if (selected)
        selector.value = '';
    return selected;
}
export function refreshComparisonReferences(root, target) {
    const selected = target.identityId === state.identity && removeComparisonOption(root.querySelector('#plan-comparison'), target.id);
    syncComparisonControls(root, state.cache.planComparisons ?? [], scopedDatasets(), state.identity);
    if (selected) {
        const detail = root.querySelector('#selected-comparison-details');
        if (detail)
            detail.innerHTML = notice('原选企业对照已清理，已取消该引用；研究问题和其他输入保留，请核对后再生成计划。', 'warm');
    }
    for (const marker of root.querySelectorAll('[data-history-comparison]'))
        if (marker.dataset.historyComparison === target.id)
            marker.closest('tr,article')?.remove();
    for (const more of root.querySelectorAll('[data-x-action="history-more"]'))
        if (state.cache.serviceHistory?.next_offset != null)
            more.dataset.offset = String(state.cache.serviceHistory.next_offset);
    for (const detail of root.querySelectorAll('[data-comparison-history-detail]'))
        if (detail.dataset.comparisonHistoryDetail === target.id)
            detail.innerHTML = notice('这份原始历史对照已永久清理；历史报告、已批准计划和归档摘要仍保留冻结内容。', 'warm');
    for (const row of root.querySelectorAll('[data-comparison-record]'))
        if (row.dataset.comparisonRecord === target.id)
            row.remove();
    const rows = root.querySelector('[data-comparison-rows]');
    if (rows && !rows.querySelector('[data-comparison-record]'))
        rows.innerHTML = empty('当前范围没有已保存对照', '可继续保存新的对照，或切换服务身份与企业范围查看其他记录。');
    for (const detail of root.querySelectorAll('[data-comparison-detail]'))
        if (detail.dataset.comparisonDetail === target.id)
            detail.innerHTML = heading('此企业对照已清理', '原始对照不可恢复；已批准计划、历史报告和摘要中的冻结内容仍保留。', routeButton('返回企业对照', 'compare', 'secondary'));
}
/** The form's explicit confirmation precedes this call; never retry a DELETE. */
export async function removeSavedComparison(target, onRemoved = () => { }) {
    const owner = state.user?.id, identity = state.identity, dataset = state.active, sameContext = contextGuard();
    const sameOwnerIdentity = () => state.user?.id === owner && state.identity === identity;
    const key = JSON.stringify([owner, target.identityId, target.id]);
    if (pendingRemovals.has(key))
        return false;
    const current = comparisonRemovalTarget(target.id, target.version, target.identityId, target.source);
    if (current.name !== target.name || current.period !== target.period)
        throw new Error('清理对象已变化，请重新核对名称、季度和版本');
    pendingRemovals.add(key);
    try {
        try {
            const result = await writeWorkspace('/comparisons/' + encodeURIComponent(target.id) + '?' + new URLSearchParams({ identity_id: target.identityId, version: String(target.version) }), 'DELETE');
            if (result.deleted !== true)
                throw new Error('未收到明确的删除结果，请刷新核对；不会自动重试。');
        }
        catch (error) {
            if (error instanceof ApiError && error.code === 'STALE_SESSION' && sameOwnerIdentity() && state.active !== dataset) {
                // A dataset switch discards the write response. Verify absence in the new
                // context instead of assuming success or repeating the destructive request.
                const checkedContext = contextGuard();
                try {
                    await writeWorkspace('/comparisons/' + encodeURIComponent(target.id) + '?' + new URLSearchParams({ identity_id: target.identityId }));
                    return false;
                }
                catch (check) {
                    if (!checkedContext() || !sameOwnerIdentity())
                        return false;
                    if (!(check instanceof ApiError && check.status === 404 && check.code === 'NOT_FOUND'))
                        return false;
                }
            }
            else {
                if (!sameContext() || !sameOwnerIdentity())
                    return false;
                throw error;
            }
        }
        if (!sameOwnerIdentity())
            return false;
        forgetComparison(target);
        onRemoved();
        return true;
    }
    finally {
        comparisonRevision++;
        pendingRemovals.delete(key);
    }
}
export const comparisonModes = { year_over_year: '上年同季', previous: '上一季度' };
const hashPattern = /^[a-f0-9]{64}$/;
export function frozenComparisonMembers(ids, datasets) {
    if (ids.length < 2 || ids.length > 8 || new Set(ids).size !== ids.length)
        throw new Error('请选择 2–8 份不同的数据集');
    return ids.map(id => { const row = datasets.find(d => d.id === id); if (!row || !Number.isInteger(row.version) || !hashPattern.test(row.content_hash ?? ''))
        throw new Error('所选数据不在当前身份范围或缺少版本指纹，请刷新核对'); return { id: row.id, version: row.version, hash: row.content_hash }; });
}
export function displayedComparisonMembers(fd, datasets) {
    let shown;
    try {
        shown = JSON.parse(String(fd.get('displayed_bindings') ?? ''));
    }
    catch {
        throw new Error('当前表单缺少已显示的数据版本，请刷新后重试');
    }
    if (!Array.isArray(shown))
        throw new Error('当前表单的数据绑定无效，请重新打开');
    const ids = fd.getAll('dataset_ids').map(String);
    if (ids.some(id => !datasets.some(d => d.id === id)))
        throw new Error('所选数据已不在当前身份范围');
    return frozenComparisonMembers(ids, shown.map(m => ({ id: m.id, version: m.version, content_hash: m.hash })));
}
export function comparisonPreviewDraft(result, members, comparison, identityId) {
    if (!/^\d{4}-Q[1-4]$/.test(result?.period ?? '') || !Array.isArray(result.items) || result.items.length !== members.length)
        throw new Error('对照结果缺少完整的共同季度或成员，未准备保存');
    const ids = new Set();
    for (const item of result.items) {
        const source = members.find(m => m.id === item.id);
        if (!source || ids.has(item.id) || source.version !== item.dataset_version || (item.dataset_hash && item.dataset_hash !== source.hash))
            throw new Error('对照读取期间数据已有变化，请刷新后重新对照；不会把旧指纹绑定到新结果');
        ids.add(item.id);
    }
    if (!Object.hasOwn(comparisonModes, comparison))
        throw new Error('请选择明确的比较基期');
    return { identity_id: identityId, datasets: members.map(m => ({ ...m })), comparison, target_period: result.period };
}
export function comparisonResultView(result) {
    if (!result?.items)
        return notice('此记录没有保存可展示的对照结果，未重新计算或补造。', 'warm');
    return `<section class="panel"><div class="section-heading row-between"><h2>共同季度 · ${esc(result.period)}</h2>${badge('用户样本，不是行业排名')}</div>${table(['企业', '毛利率', '净利率', '经营现金收入比', '资产负债率', '收入增速'], result.items.map((r) => [esc(r.company), ...['gross_margin', 'net_margin', 'cash_ratio', 'leverage', 'revenue_growth'].map(k => pct(r.analysis?.metrics?.[k]))]))}${notice(result.warning ?? '同季度输入对照；须人工核实业务、合并范围与财务口径的可比性。')}<details><summary>原始结果、数据版本与计算口径</summary>${jsonView(result.items)}</details></section>`;
}
export function comparisonSaveForm(draft) {
    return `<section class="panel"><h2>把这次对照保存为研究依据</h2><p class="micro">将保存刚才显示的共同季度、各份数据的版本和指纹。保存只做本地计算，不批准任何外发。保存时按当日 UTC 重新核验，时效或季度警告可能与预览不同；不会替换所选输入版本或季度。</p><form id="comparison-save-form" class="stack" data-request-id="${esc(crypto.randomUUID())}">${input('identity_id', draft.identity_id, 'type="hidden"')}${input('datasets', JSON.stringify(draft.datasets), 'type="hidden"')}${input('target_period', draft.target_period, 'type="hidden"')}${input('comparison', draft.comparison, 'type="hidden"')}<p><strong>冻结目标：</strong>${esc(draft.target_period)} · ${esc(comparisonModes[draft.comparison])}</p>${field('对照名称', input('name', draft.name ?? '', 'required maxlength="200" placeholder="为这份共同季度对照命名"'))}${field('可比性说明与使用边界', textarea('comparability_note', draft.comparability_note ?? '', 'required minlength="5" maxlength="2000" rows="3" placeholder="说明企业、产品结构、合并范围或不同数据口径是否可比；不要把样本排序当行业排名"'))}<details><summary>即将绑定的数据版本与指纹</summary>${jsonView(draft.datasets)}</details>${formFooter('计算核验并保存这份对照')}</form></section>`;
}
export function comparisonCreateRequest(fd, identityId, requestId) {
    const str = (name) => String(fd.get(name) ?? '').trim();
    if (str('identity_id') !== identityId)
        throw new Error('服务身份已经变化，请在当前身份中重新对照');
    let members;
    try {
        members = JSON.parse(str('datasets'));
    }
    catch {
        throw new Error('保存表单缺少原始版本绑定，请重新对照');
    }
    if (!Array.isArray(members) || members.length < 2 || members.length > 8 || new Set(members.map(m => m.id)).size !== members.length || members.some(m => typeof m.id !== 'string' || !m.id || !Number.isInteger(m.version) || m.version < 1 || !hashPattern.test(m.hash ?? '')))
        throw new Error('原始数据版本绑定不完整，请重新对照');
    if (!Object.hasOwn(comparisonModes, str('comparison')) || !/^\d{4}-Q[1-4]$/.test(str('target_period')))
        throw new Error('共同季度或比较口径已失效，请重新对照');
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId))
        throw new Error('保存提交标识缺失，请重新对照');
    if (!str('name') || str('comparability_note').length < 5)
        throw new Error('请填写对照名称和至少5个字符的可比性说明');
    return { request_id: requestId, identity_id: identityId, name: str('name'), datasets: members.map(m => ({ id: m.id, version: m.version, hash: m.hash })), comparison: str('comparison'), target_period: str('target_period'), comparability_note: str('comparability_note') };
}
export function comparisonProblem(row, datasets, identityId) {
    if (!row?.payload)
        return '已保存对照不存在或已删除';
    const p = row.payload;
    if ((p.identity_id ?? '') !== identityId)
        return '对照属于另一服务身份，请切回原身份';
    if (!Array.isArray(p.members) || p.members.length < 2 || !p.period || !hashPattern.test(row.comparison_hash ?? ''))
        return '对照未保留完整来源，请重新保存';
    const impact = row.source_impact;
    if (impact && impact.state !== 'current')
        return (impact.reasons ?? []).map((r) => r.message).join('；') || '对照来源已变化，请用当前数据重新保存';
    for (const member of p.members) {
        const live = datasets.find(d => d.id === member.id);
        if (!live)
            return '对照中的企业已删除或不在当前身份范围';
        if (live.version !== member.version || live.content_hash !== member.hash)
            return '对照中的企业数据已有修订，请重新保存对照后再建计划';
    }
    return '';
}
export function comparisonMemberTable(members) { return table(['企业 / 数据集', '冻结修订', '输入指纹'], members.map((m) => [`${esc(m.company)}<br><small>${esc(m.id)}</small>`, String(m.version ?? '未知'), `<code>${esc(m.hash ?? '未保存')}</code>`])); }
export function comparisonArtifactView(artifact, label = '冻结企业对照', showResult = true) {
    if (!artifact)
        return '';
    const p = artifact.payload ?? artifact;
    const members = p.members ?? [];
    return `<section class="panel saved-comparison"><h2>${esc(label)} · ${esc(p.name ?? '企业对照')}</h2><p><strong>目标季度：</strong>${esc(p.period ?? '未记录')} · <strong>比较基期：</strong>${esc(comparisonModes[p.comparison] ?? p.comparison ?? '未记录')} · <strong>期间口径：</strong>${esc(p.period_basis === 'standalone_quarter' ? '独立单季度' : p.period_basis ?? '未记录')}</p><p><strong>计算核验日期（UTC）：</strong>${esc(p.analysis_as_of ?? '未记录')}</p><p><strong>可比性说明：</strong>${esc(p.comparability_note ?? '未记录')}</p>${comparisonMemberTable(members)}<p class="micro">以上为全部 ${members.length} 份对照成员；主企业只是报告主线，其余企业的对照派生指标及来源信息同样属于本次范围。</p><details><summary>对照来源与保存指纹</summary>${jsonView({ id: artifact.id, version: artifact.version, hash: artifact.hash ?? artifact.comparison_hash ?? artifact.object_hash, analysis_as_of: p.analysis_as_of, period: p.period, comparison: p.comparison, members: members.map((m) => ({ id: m.id, company: m.company, version: m.version, hash: m.hash })) })}</details></section>` + (showResult && p.result ? comparisonResultView(p.result) : '');
}
export function comparisonSelection(rows, selected = '') {
    return field('复用已保存企业对照（可选）', select('comparison_artifact_id', [{ value: '', label: '不加入多企业对照' }, ...rows.map(r => ({ value: r.id, label: r.payload.name + ' · ' + r.payload.period + ' · ' + r.payload.members.length + ' 份输入' }))], selected, 'id="plan-comparison"')) + '<div id="selected-comparison-details" aria-live="polite"></div>';
}
export function selectedComparisonRequest(row, primaryId, datasets, identityId) {
    const problem = comparisonProblem(row, datasets, identityId);
    if (problem)
        throw new Error(problem);
    if (!row.payload.members.some((m) => m.id === primaryId))
        throw new Error('请明确选择对照中的一家主企业作为本次研判主线');
    return { id: row.id, version: row.version, hash: row.comparison_hash };
}
export function syncComparisonControls(root, rows, datasets, identityId) {
    const form = root.querySelector('#plan-form');
    if (!form)
        return;
    const selector = form.querySelector('#plan-comparison');
    if (!selector)
        return;
    const row = rows.find(r => r.id === selector.value);
    const mode = form.querySelector('[name="comparison"]');
    const detail = form.querySelector('#selected-comparison-details');
    if (mode) {
        if (row) {
            if (!mode.disabled)
                mode.dataset.beforeComparison = mode.value;
            mode.value = row.payload.comparison;
            mode.disabled = true;
        }
        else {
            if (mode.disabled && mode.dataset.beforeComparison !== undefined)
                mode.value = mode.dataset.beforeComparison;
            mode.disabled = false;
            delete mode.dataset.beforeComparison;
        }
    }
    if (detail) {
        const problem = row ? comparisonProblem(row, datasets, identityId) : selector.value ? '所选对照已删除或不在当前列表中' : '';
        detail.innerHTML = problem ? notice(problem, 'warm') : row ? notice('已明确加入多企业范围：目标 ' + row.payload.period + '，比较口径已锁定。请在上方选择其中一家主企业，并在下一步核对所有成员的派生指标与来源信息后批准。不会额外检索同行资料或召回同行记忆；此选择本身不会调用模型。') + comparisonArtifactView(row, '本次计划将纳入的企业', false) : '';
    }
}
export async function savedComparisonPage(id) {
    const row = await currentComparisonRead(() => workspace('/comparisons/' + encodeURIComponent(id) + '?' + new URLSearchParams({ identity_id: state.identity })));
    state.cache.comparison = row;
    const p = row.payload;
    const problem = comparisonProblem(row, scopedDatasets(), state.identity);
    return `<div data-comparison-detail="${esc(row.id)}">` + heading(p.name, '保留共同季度、明确可比性说明与全部输入快照；当前数据更新不改写这份历史对照。', routeButton('返回企业对照', 'compare', 'secondary') + button('导出完整对照', 'export-comparison') + comparisonDeleteButton(row)) + (problem ? notice('当前适用性需核对：' + problem + '。下方仍展示原始保存结果。', 'warm') : notice('来源版本仍匹配当前企业数据；这不等于已证明业务口径可比。')) + comparisonArtifactView(row, '已保存企业对照') +
        `<section class="panel"><h2>明确交给 Agent 研判</h2>${problem ? notice('此对照当前不能加入新计划，请核对原始来源并重新保存。', 'warm') : `<form id="comparison-transfer-form" class="stack" data-id="${esc(row.id)}" data-version="${row.version}" data-hash="${esc(row.comparison_hash)}" data-identity-id="${esc(state.identity)}">${field('主企业（须是本对照成员）', select('primary_dataset_id', [{ value: '', label: '请选择本次报告的主企业' }, ...p.members.map((m) => ({ value: m.id, label: m.company + ' · ' + m.id }))], '', 'required'))}<p>目标季度固定为 <strong>${esc(p.period)}</strong>；将同时纳入以上 ${p.members.length} 份成员的对照派生指标和来源信息；主企业选择不会隐去额外成员。完整同行财务快照不会因此自动外发。</p><p class="micro">下一步仍需生成计划、审阅外发范围并明确批准；此按钮不会执行模型。</p>${formFooter('带入 Agent 计划草稿')}</form>`}</section><section class="panel"><details><summary>完整冻结输入快照</summary>${jsonView(p.members)}</details></section></div>`;
}
export function savedComparisonList(rows, hasMore = false) {
    return `<section class="panel"><div class="section-heading"><h2>已保存企业对照</h2><p class="micro">仅显示当前身份与企业筛选范围，保留原始结果和来源版本。清理不再需要的记录可释放账户的对照容量；其他身份或企业的记录需切换范围查看。原身份已失效的对照可到“身份与连接 → 已失效研究范围的历史”核查并清理。</p></div><div data-comparison-rows>${rows.length ? rows.map(row => `<div class="saved-comparison-row" data-comparison-record="${esc(row.id)}"><button class="list-link" data-route="compare:${esc(row.id)}"><span><strong>${esc(row.payload.name)}</strong><small>${esc(row.payload.period)} · ${esc(row.payload.members.map((m) => m.company).join(' / '))} · ${timeText(row.created_at)}</small><small>${row.source_impact?.state === 'current' ? '来源版本匹配' : '来源需复核'} · ${esc(comparisonModes[row.payload.comparison] ?? row.payload.comparison)}</small></span>${badge('v' + row.version)}</button>${comparisonDeleteButton(row)}</div>`).join('') : empty('尚未保存对照', '先计算共同季度，再明确命名、说明可比性并保存。')}</div>${hasMore ? notice('仅显示最近记录；清理后重新读取可继续整理更早记录，或从账户导出查阅。') : ''}</section>`;
}
export async function comparisonIndex() { const rows = await currentComparisonRead(() => workspace('/comparisons' + scopeQuery())); state.cache.comparisons = rows.items; return savedComparisonList(rows.items, rows.has_more); }
/** Bounded historical receipt, usable after the original report/artifact is removed. */
export function comparisonReceiptView(reference) {
    if (!reference?.payload)
        return '';
    const p = reference.payload;
    const rows = p.result?.items ?? [];
    return `<details class="comparison-receipt" open><summary>原始企业对照摘要 · ${esc(p.name)}</summary><p>${esc(p.period)} · ${esc(comparisonModes[p.comparison] ?? p.comparison)} · ${esc(p.period_basis === 'standalone_quarter' ? '独立单季度' : p.period_basis ?? '未记录口径')}</p><p><strong>当时的可比性说明：</strong>${esc(p.comparability_note)}</p>${notice(p.summary_notice ?? '此处仅保留有界的对照摘要与来源指纹，不包含完整成员快照；原报告或原对照删除后仍可核查这些原始数值。', 'warm')}${comparisonMemberTable(p.members ?? [])}${table(['企业', '毛利率（%）', '经营现金收入比（%）', '资产负债率（%）', '收入增速（%）', '净利率（%）'], rows.map((r) => [esc(r.company), ...['gross_margin', 'cash_ratio', 'leverage', 'revenue_growth', 'net_margin'].map(k => pct(r.analysis?.metrics?.[k]))]))}<p class="micro">五项比例均以百分比展示。以上数值只来自保存时的摘要，未读取当前数据重新计算。</p><details><summary>原对照与本摘要的独立指纹</summary>${jsonView({ comparison_id: reference.id, comparison_version: reference.version, comparison_hash: reference.hash, projection_hash: reference.projection_hash, analysis_as_of: p.analysis_as_of, units: p.units })}</details></details>`;
}
