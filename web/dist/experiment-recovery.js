/** Tab-scoped, bounded receipts for explicit experiment retries. No automatic POST. */
import { workspace, ApiError } from './api.js';
import { state, scopedDatasets } from './state.js';
import { esc, notice, formFooter, button, routeButton } from './components.js';
const storageKey = 'lidian:experiment-attempts:v1', maxEntries = 20, maxBytes = 160000;
const keyPattern = /^[a-zA-Z0-9_-]{8,80}$/;
const pending = new Map();
const storageProblem = '无法保留本次实验的重试凭据，尚未提交。请恢复此标签页的本地保存功能后再试。';
const signature = (value) => JSON.stringify(Object.fromEntries(Object.keys(value).filter(k => k !== 'request_id').sort().map(k => [k, value[k]])));
const ownerKey = (owner = state.user?.id) => storageKey + ':' + String(owner ?? '');
function readAttempts(owner = state.user?.id) {
    try {
        const raw = sessionStorage.getItem(ownerKey(owner)) ?? '[]';
        if (new TextEncoder().encode(raw).length > maxBytes)
            throw new Error();
        const rows = JSON.parse(raw);
        if (!Array.isArray(rows) || rows.length > maxEntries || rows.some(r => !r || r.owner !== owner || typeof r.identity !== 'string' || typeof r.active !== 'string' || !r.request || !keyPattern.test(r.request.request_id ?? '') || typeof r.request.dataset_id !== 'string' || !['scenario', 'forecast'].includes(r.request.kind) || (r.rejection !== undefined && (typeof r.rejection !== 'string' || r.rejection.length > 500))))
            throw new Error();
        return rows;
    }
    catch {
        throw new Error(storageProblem);
    }
}
function writeAttempts(rows, owner = state.user?.id) {
    const raw = JSON.stringify(rows);
    if (rows.length > maxEntries || new TextEncoder().encode(raw).length > maxBytes)
        throw new Error('未确认的实验提交过多，尚未提交本次实验。请先核对并结束下方的旧提交。');
    try {
        sessionStorage.setItem(ownerKey(owner), raw);
        if (sessionStorage.getItem(ownerKey(owner)) !== raw)
            throw new Error();
    }
    catch {
        throw new Error(storageProblem);
    }
}
function sameScope(row) { return !!state.user?.id && row.owner === state.user.id && row.identity === state.identity && row.active === state.active; }
export function experimentContextAttributes() { return `data-owner="${esc(state.user?.id ?? '')}" data-identity="${esc(state.identity)}" data-active="${esc(state.active)}"`; }
function checkFormScope(form) {
    if (!state.user?.id || form.dataset.owner !== state.user.id || form.dataset.identity !== state.identity || form.dataset.active !== state.active)
        throw new Error('账户、服务身份或企业范围已变化，请在当前范围重新打开实验。');
}
function currentAttempt(id) {
    const row = readAttempts().find(r => sameScope(r) && r.request.request_id === id);
    if (!row)
        throw new Error('原实验提交不属于当前范围或已经结束，请重新核对。');
    if (!scopedDatasets().some(d => d.id === row.request.dataset_id))
        throw new Error('原实验数据已不在当前可访问范围，未重新提交。');
    return row;
}
export function forgetExperimentAttempt(id, owner) {
    if (owner !== undefined && owner !== state.user?.id)
        throw new Error('账户已变化，请重新打开本账户的实验提交管理。');
    const rows = readAttempts(), row = rows.find(r => r.request.request_id === id && (owner !== undefined || sameScope(r)));
    if (!row)
        throw new Error('原实验提交不属于当前管理范围或已经结束，请重新核对。');
    if (pending.has(row.owner + ':' + id))
        throw new Error('这次实验仍在提交，请等待本次请求结束后再核对。');
    // Explicit account management can end an inaccessible local receipt. It has
    // no authority to retry that scope or change the archived business record.
    writeAttempts(rows.filter(r => r !== row));
}
export async function saveExperiment(form, payload) {
    checkFormScope(form);
    let attempt;
    if (payload) {
        if (!scopedDatasets().some(d => d.id === payload.dataset_id))
            throw new Error('请选择当前身份可访问的数据集');
        const rows = readAttempts();
        attempt = rows.find(r => sameScope(r) && signature(r.request) === signature(payload)) ?? { owner: state.user.id, identity: state.identity, active: state.active, request: { ...payload, request_id: crypto.randomUUID() } };
        if (!rows.includes(attempt))
            writeAttempts([...rows, attempt]);
    }
    else
        attempt = currentAttempt(form.dataset.requestId ?? '');
    const pendingKey = attempt.owner + ':' + attempt.request.request_id;
    pending.set(pendingKey, (pending.get(pendingKey) ?? 0) + 1);
    try {
        const result = await workspace('/experiments', 'POST', attempt.request);
        if (result?.payload?.creation_request_id !== attempt.request.request_id || result?.payload?.dataset_id !== attempt.request.dataset_id || !result.id)
            throw new Error('服务未返回可核对的原实验记录');
        // Cleanup failure must never turn a confirmed save into a reported failure.
        // Keeping the receipt is safe: an explicit retry still returns the same row.
        try {
            writeAttempts(readAttempts(attempt.owner).filter(r => !(r.owner === attempt.owner && r.identity === attempt.identity && r.active === attempt.active && r.request.request_id === attempt.request.request_id)), attempt.owner);
        }
        catch { /* retain safe retry */ }
        return result;
    }
    catch (error) {
        if (error instanceof ApiError) {
            // A rejected retry does not prove an earlier uncertain call failed. Keep
            // its original key, but disclose the concrete rejection on the next view.
            if (error.code !== 'STALE_SESSION')
                try {
                    writeAttempts(readAttempts(attempt.owner).map(r => r.request.request_id === attempt.request.request_id ? { ...r, rejection: error.message.slice(0, 500) } : r), attempt.owner);
                }
                catch { /* preserve the original receipt */ }
            throw error;
        }
        throw new Error('实验保存结果尚未确认。原提交已保留；保持内容不变可再次提交，或刷新后在“待确认的实验提交”中核对原提交。不会自动重发。' + (error instanceof Error ? '\n' + error.message : ''));
    }
    finally {
        const count = (pending.get(pendingKey) ?? 1) - 1;
        if (count)
            pending.set(pendingKey, count);
        else
            pending.delete(pendingKey);
    }
}
export function experimentRecoveryPanel(saved) {
    let rows, all;
    try {
        all = readAttempts();
        rows = all.filter(r => sameScope(r) && scopedDatasets().some(d => d.id === r.request.dataset_id));
    }
    catch {
        return notice('此标签页暂时无法保留实验重试凭据；恢复本地保存功能后才能提交新实验。', 'warm');
    }
    const manage = all.length ? button('管理本账户待确认提交', 'manage-experiment-requests') : '';
    if (!rows.length)
        return manage;
    return `<section class="panel"><h2>待确认的实验提交</h2>${manage}${notice('下方保留的是你曾提交的原始参数。请先核对记录；只有点击确认按钮才会再次发送原提交。若之前已保存，将确认同一份实验。刷新后也不会自动重发。', 'warm')}${rows.map(row => {
        const p = row.request, found = saved.find(r => r.payload?.creation_request_id === p.request_id);
        const d = scopedDatasets().find(d => d.id === p.dataset_id);
        const parameters = p.kind === 'scenario' ? `售价 ${esc(p.price_change * 100)}% · 单位变动成本 ${esc(p.cost_change * 100)}% · 销量 ${esc(p.volume_change * 100)}% · 固定成本占比 ${esc(p.fixed_cost_share * 100)}%` : `预测指标 ${esc({ revenue: '营业收入', cost: '营业成本', cash_flow: '经营现金流', gross_margin: '毛利率' }[p.metric] ?? p.metric)} · ${esc(p.horizon)} 个季度`;
        return `<form id="experiment-retry-${esc(p.request_id)}" data-experiment-retry="true" class="stack subpanel" ${experimentContextAttributes()} data-request-id="${esc(p.request_id)}"><h3>${esc(p.name)}</h3><p>${esc(d?.payload?.company ?? p.dataset_id)} · 原数据 v${esc(p.dataset_version)} · ${esc(p.target_period ?? '原数据最新季度')} · ${p.kind === 'scenario' ? '情景假设' : '统计基线'}</p><p>${parameters}</p><p>${esc(p.assumptions)}</p><p class="micro">原数据指纹：${esc(p.dataset_hash)}</p>${found ? routeButton('查看已经保存的实验', 'lab:' + found.id) : notice('保存结果尚未确认；原数据变化时，未成功保存的旧提交会被拒绝，不会套用新数据。')}${row.rejection ? notice('最近一次请求被拒绝：' + row.rejection + '。这不代表更早的未知提交未保存，请先核对记录。', 'warm') : ''}${formFooter('确认原提交结果')}${button('结束这次重试', 'forget-experiment-request', 'text-button', `data-id="${esc(p.request_id)}"`)}</form>`;
    }).join('')}</section>`;
}
export function experimentAttemptManager() {
    const rows = readAttempts();
    return notice('这里仅管理当前账户在此标签页保留的实验提交，包括原身份或企业已不可用的记录。结束重试不会删除已保存的实验；结果未知时请先核对历史记录。这里不会重新提交任何实验。', 'warm') + (rows.length ? rows.map(row => {
        const p = row.request, identity = state.identities.find(i => i.id === row.identity), dataset = state.datasets.find(d => d.id === p.dataset_id);
        const scope = row.identity ? (identity?.payload?.name ?? '原服务身份已不可用') : '默认身份';
        const parameters = p.kind === 'scenario' ? `售价 ${esc(p.price_change * 100)}% · 单位变动成本 ${esc(p.cost_change * 100)}% · 销量 ${esc(p.volume_change * 100)}% · 固定成本占比 ${esc(p.fixed_cost_share * 100)}%` : `预测指标 ${esc(p.metric)} · ${esc(p.horizon)} 个季度`;
        return `<article class="subpanel" data-experiment-receipt data-experiment-management="true" data-owner="${esc(row.owner)}"><h3>${esc(p.name)}</h3><p>${esc(scope)} · ${esc(dataset?.payload?.company ?? '原企业已不可用')} · 原数据 v${esc(p.dataset_version)} · ${esc(p.target_period ?? '原数据最新季度')}</p><p>${parameters}</p><p>${esc(p.assumptions)}</p><p class="micro">原身份：${esc(row.identity || '默认')} · 原企业标识：${esc(p.dataset_id)} · 原页面企业范围：${esc(row.active || '全部企业')}<br>原数据指纹：${esc(p.dataset_hash)}</p>${row.rejection ? notice('最近一次请求未确认成功：' + row.rejection, 'warm') : ''}${button('结束这次重试', 'forget-experiment-request', 'text-button', `data-id="${esc(p.request_id)}"`)}</article>`;
    }).join('') : notice('本账户在此标签页没有待确认的实验提交。'));
}
