import { watchValue, watchRawValues, watchThresholdRequest, syncWatchMetric } from './watch-units.js';
import { comparisonArtifactView, comparisonHistoryDeleteButton, currentComparisonRead } from './saved-comparisons.js';
import { unchangedInputGuard } from './saved-experiments.js';
import { formSource, sourcePanel } from './business-source.js';
import { actionForm } from './views-analysis.js';
import { interactionGuard, invalidateInteractions, renewSavedDraft } from './interactions.js';
import { api, contextGuard, invalidateContext } from './api.js';
import { state, scopedDatasets } from './state.js';
import { esc, field, input, textarea, formFooter, notice, jsonView, table, metricNames } from './components.js';
import { identityForm, connectionForm, watchForm, serviceForm } from './views-services.js';
import { configureCopilot, chatAction, copilotSubmit, resetCopilot, handoffCopilot } from './copilot-ui.js';
let hooks;
export async function selectIdentity(id) { if (id === state.identity)
    return true; if (id && !state.identities.some(x => x.id === id))
    throw new Error('服务身份已失效，请刷新。'); if (state.dirty && !confirm('切换身份将放弃当前未保存表单，是否继续？'))
    return false; invalidateInteractions(); invalidateContext(); state.identity = id; state.dirty = false; state.cache = {}; if (state.active && !scopedDatasets().some(x => x.id === state.active))
    state.active = ''; try {
    sessionStorage.setItem('lidian:identity:' + state.user.id, id);
}
catch { /* optional */ } document.querySelector('#modal')?.close(); document.querySelector('#inspector')?.close(); await hooks.render(); return true; }
export function restoreIdentity() { try {
    const id = sessionStorage.getItem('lidian:identity:' + state.user.id) ?? '';
    state.identity = state.identities.some(x => x.id === id) ? id : '';
}
catch {
    state.identity = '';
} }
function sensitive(title, action, id = '', version = 0) { hooks.dialog(title, serviceForm(action, notice('需要当前账户密码确认；不会读取或显示其他设备的会话令牌。') + field('当前登录密码', input('password', '', 'type="password" required maxlength="128" autocomplete="current-password"')) + formFooter('验证并执行'), `data-id="${esc(id)}" data-version="${version}"`)); }
export function setupExperience(value) {
    hooks = value;
    configureCopilot(value);
    document.addEventListener('click', async (e) => {
        const el = e.target.closest('[data-x-action]');
        if (!el)
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (el.dataset.pending)
            return;
        el.dataset.pending = 'true';
        el.setAttribute('aria-busy', 'true');
        const act = el.dataset.xAction, id = el.dataset.id ?? '', clickCurrent = interactionGuard();
        try {
            if (act.startsWith('chat-')) {
                await chatAction(act, el);
                return;
            }
            switch (act) {
                case 'identity-new':
                    hooks.dialog('新建服务身份', identityForm(), true);
                    break;
                case 'identity-edit': {
                    const r = state.identities.find(x => x.id === id);
                    if (!r)
                        throw new Error('身份已变化，请刷新');
                    hooks.dialog('编辑服务身份', identityForm(r), true);
                    break;
                }
                case 'identity-use':
                    await selectIdentity(id);
                    break;
                case 'identity-delete':
                    if (!confirm('删除此服务身份？尚未外发的关联调用将停止；历史报告与会话快照仍然保留。'))
                        return;
                    await api('/services/identities/' + id + '?version=' + encodeURIComponent(el.dataset.version ?? ''), 'DELETE');
                    await hooks.refresh();
                    if (state.identity === id)
                        state.identity = '';
                    await hooks.render();
                    break;
                case 'connection-new':
                    hooks.dialog('配置私有模型连接', connectionForm());
                    break;
                case 'connection-edit': {
                    const r = state.cache.connections?.find((x) => x.id === id);
                    if (!r)
                        throw new Error('连接不存在，请刷新');
                    hooks.dialog('更新模型连接', connectionForm(r));
                    break;
                }
                case 'connection-delete':
                    sensitive('删除模型连接', 'remove-connection', id, Number(el.dataset.version));
                    break;
                case 'sessions-others':
                    sensitive('退出其他登录会话', 'revoke-others');
                    break;
                case 'session-revoke':
                    sensitive('撤销登录会话', 'revoke-session', id);
                    break;
                case 'history-more': {
                    const valid = interactionGuard();
                    const next = await currentComparisonRead(() => api('/services/history?offset=' + encodeURIComponent(state.cache.serviceHistory?.next_offset ?? el.dataset.offset ?? '0')));
                    if (!valid())
                        break;
                    const prior = state.cache.serviceHistory;
                    state.cache.serviceHistory = { ...next, items: [...prior.items, ...next.items] };
                    hooks.inspect('更多失效范围历史', state.cache.serviceHistory.items.map((r) => `<article ${r.kind === 'comparison' ? `data-history-comparison="${esc(r.id)}"` : ''}><h4>${esc(r.title ?? r.payload.title ?? r.payload.name ?? '历史记录')}</h4><p>${esc(r.company || r.dataset_id || '通用范围')} · ${esc(r.history_reason)}</p><button type="button" class="text-button" data-x-action="history-detail" data-id="${esc(r.id)}">只读核查</button></article>`).join('') + (next.has_more ? `<button type="button" class="text-button" data-x-action="history-more" data-offset="${next.next_offset}">继续加载历史</button>` : ''));
                    break;
                }
                case 'history-detail': {
                    const valid = interactionGuard();
                    const row = state.cache.serviceHistory.items.find((r) => r.id === id);
                    if (!row)
                        throw new Error('历史列表已变化，请刷新');
                    let content = notice('只读历史：' + row.history_reason, 'warm');
                    if (row.kind === 'assistant_thread') {
                        const thread = await api('/services/threads/' + id);
                        if (!valid())
                            break;
                        content += (thread.messages ?? []).map((m) => `<article class="subpanel"><h4>${esc(m.payload.question)}</h4><p class="preserve-lines">${esc(m.payload.response.answer)}</p><details><summary>当时的完整上下文与工具回执</summary>${jsonView(m.payload.response)}</details></article>`).join('');
                    }
                    else if (row.kind === 'comparison') {
                        content += `<div data-comparison-history-detail="${esc(row.id)}">${comparisonArtifactView(row, '只读历史企业对照')}${comparisonHistoryDeleteButton(row)}</div>`;
                    }
                    else {
                        content += sourcePanel(row) + `<p>${esc(row.payload.description ?? row.payload.acceptance ?? '')}</p><details><summary>冻结记录与状态历史</summary>${jsonView(row.payload)}</details>`;
                    }
                    hooks.inspect(row.title ?? '历史记录', content);
                    break;
                }
                case 'watch-new':
                    hooks.dialog('跟踪一项已保存指标', watchForm());
                    break;
                case 'watch-from-action': {
                    const row = state.cache.actions?.find((a) => a.id === id);
                    if (!row)
                        throw new Error('行动已不在当前列表，请刷新');
                    hooks.dialog('为行动建立指标跟踪', watchForm(null, { dataset_id: row.payload.dataset_id, title: '跟踪：' + row.payload.title.slice(0, 100), source_ref: { kind: 'action', action_id: row.id, action_version: row.version, action_hash: row.object_hash } }));
                    break;
                }
                case 'watch-from-report': {
                    const r = state.cache.run;
                    hooks.dialog('从报告建立跟踪规则', watchForm(null, { dataset_id: r.dataset_id, title: '跟踪：' + r.payload.query.slice(0, 100), source_ref: { kind: 'report', run_id: r.id } }));
                    break;
                }
                case 'watch-edit': {
                    const row = state.cache.tracking.rules.find((x) => x.id === id);
                    hooks.dialog('调整跟踪规则', watchForm(row));
                    break;
                }
                case 'watch-toggle': {
                    const w = state.cache.tracking.rules.find((x) => x.id === id);
                    await api('/services/watches/' + id, 'PUT', Object.fromEntries([...['title', 'identity_id', 'dataset_id', 'metric', 'operator', 'threshold', 'stale_after_days', 'expires_at'].map(k => [k, w.payload[k]]), ['active', !w.payload.active], ['version', w.version]]));
                    if (clickCurrent())
                        await hooks.render();
                    break;
                }
                case 'watch-delete':
                    if (!confirm('删除此跟踪规则？过去的提醒保留供你核查。'))
                        return;
                    await api('/services/watches/' + id + '?version=' + encodeURIComponent(el.dataset.version ?? ''), 'DELETE');
                    if (clickCurrent())
                        await hooks.render();
                    break;
                case 'alert-ack': {
                    const row = state.cache.tracking.alerts.find((x) => x.id === id);
                    hooks.dialog('记录核对结果', serviceForm('alert-ack', field('已核对的内容与后续处理', textarea('note', '', 'required minlength="2" maxlength="1000" rows="3"')) + formFooter('保存核对记录'), `data-id="${esc(id)}" data-version="${row.version}"`));
                    break;
                }
                case 'alert-archive':
                    await api('/services/alerts/' + id + '?version=' + encodeURIComponent(el.dataset.version ?? ''), 'DELETE');
                    if (clickCurrent())
                        await hooks.render();
                    break;
                case 'alert-investigate': {
                    const row = state.cache.tracking.alerts.find((x) => x.id === id);
                    if (!row)
                        throw new Error('提醒已变化，请刷新');
                    const p = row.payload;
                    const current = state.datasets.find(d => d.id === p.dataset_id);
                    hooks.inspect('历史提醒的判定依据', `<h3>${esc(p.title)}</h3>${table(['判定期间', '输入修订', '历史观测值', '历史阈值'], [[esc(p.period), esc(p.dataset_version), esc(watchValue(p.metric, p.value)), esc(p.operator === 'lt' ? '低于' : '高于') + ' ' + esc(watchValue(p.metric, p.threshold))]])}${watchRawValues(p.metric, p.threshold, p.value)}<p class="micro wrap">当时输入校验：${esc(p.dataset_hash ?? '旧提醒未记录')}</p>${notice(current ? '当前数据为修订 ' + current.version + '。历史提醒不按新数据重算；后续助手核查将明确使用当前修订。' : '源数据已删除；这条提醒仍保留当时的判定记录。', 'warm')}${current ? `<div class="inline-actions"><button type="button" class="secondary" data-x-action="alert-current-investigate" data-id="${esc(id)}">明确用当前修订继续核查</button><button type="button" class="primary" data-x-action="alert-action" data-id="${esc(id)}">以此历史提醒创建行动</button></div>` : ''}${p.acknowledgement ? `<h4>已记录的核对说明</h4><p>${esc(p.acknowledgement)}</p>` : ''}`);
                    break;
                }
                case 'alert-action': {
                    const row = state.cache.tracking.alerts.find((x) => x.id === id);
                    const p = row.payload;
                    hooks.dialog('从历史提醒创建行动', actionForm({ title: '跟进：' + p.title, dataset_id: p.dataset_id, message: '历史提醒：' + p.period + '，数据修订 ' + p.dataset_version + '；当时' + (metricNames[p.metric] ?? p.metric) + ' ' + watchValue(p.metric, p.value) + '，阈值 ' + (p.operator === 'lt' ? '低于' : '高于') + ' ' + watchValue(p.metric, p.threshold), source_ref: { kind: 'alert', alert_id: row.id } }));
                    break;
                }
                case 'alert-current-investigate': {
                    const row = state.cache.tracking.alerts.find((x) => x.id === id);
                    const p = row.payload;
                    if (!scopedDatasets().some(d => d.id === p.dataset_id))
                        throw new Error('原企业数据已删除或不在当前身份范围，请先调整研究范围');
                    if (state.dirty && !confirm('继续将离开未保存表单，是否继续？'))
                        return;
                    if (!hooks.navigateRendered)
                        throw new Error('研究导航尚未就绪，请刷新后重试');
                    state.active = p.dataset_id;
                    invalidateContext();
                    const sameContext = contextGuard();
                    const continuation = await hooks.navigateRendered('copilot');
                    if (!continuation || !sameContext() || !continuation())
                        break;
                    await handoffCopilot('核查当前企业的' + (metricNames[p.metric] ?? p.metric) + '指标。参考历史提醒 ' + row.id + '：' + p.period + '，数据修订 ' + p.dataset_version + '，当时值 ' + watchValue(p.metric, p.value) + '、阈值 ' + (p.operator === 'lt' ? '低于' : '高于') + ' ' + watchValue(p.metric, p.threshold) + '。本次明确使用当前保存的修订，不能把当前计算当成历史提醒复现。', () => sameContext() && continuation());
                    break;
                }
                default: throw new Error('此操作未识别，没有执行写入。');
            }
        }
        catch (error) {
            hooks.toast(error instanceof Error ? error.message : '操作失败', true);
        }
        finally {
            delete el.dataset.pending;
            el.removeAttribute('aria-busy');
        }
    }, true);
    document.addEventListener('submit', async (e) => {
        const form = e.target;
        if (!form.dataset.serviceForm)
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (form.dataset.pending)
            return;
        if (form.dataset.completed === 'true') {
            hooks.toast('此操作已保存，请刷新查看结果；无需重复提交。');
            return;
        }
        if (!form.reportValidity())
            return;
        const submittedContext = contextGuard();
        const valid = unchangedInputGuard(interactionGuard(), () => form.isConnected ? JSON.stringify([...new FormData(form)]) : null);
        form.dataset.pending = 'true';
        form.setAttribute('aria-busy', 'true');
        const fd = new FormData(form), str = (n) => String(fd.get(n) ?? '');
        const out = form.querySelector('.form-error');
        if (out)
            out.textContent = '';
        const buttons = [...form.querySelectorAll('button[type="submit"]')];
        buttons.forEach(b => b.disabled = true);
        const type = form.dataset.serviceForm;
        let saved = false, savedWatchCreate = false, watchDraftRenewed = false, savedDraftMessage = '已保存；保留你当前的页面和输入，稍后可刷新核对。';
        const retainSavedDraft = () => { if (savedWatchCreate && !watchDraftRenewed && submittedContext() && renewSavedDraft(JSON.stringify([...fd]), () => form.isConnected ? JSON.stringify([...new FormData(form)]) : null, () => { form.querySelector('[name="request_id"]').value = crypto.randomUUID(); })) {
            watchDraftRenewed = true;
            savedDraftMessage = '上一版规则已保存；保留你的新草稿，再次提交会创建新的跟踪规则。';
        } };
        try {
            if (['proposal', 'confirm-proposal'].includes(type)) {
                await copilotSubmit(form, fd);
                return;
            }
            const id = form.dataset.id ?? '', version = Number(form.dataset.version ?? 0);
            switch (type) {
                case 'identity': {
                    const body = { name: str('name'), perspective: str('perspective'), objective: str('objective'), depth: str('depth'), output_style: str('output_style'), dataset_ids: fd.getAll('dataset_ids').map(String), include_shared_memory: fd.has('include_shared_memory'), allow_external: fd.has('allow_external'), max_calls: Number(str('max_calls')), version };
                    const saved = await api('/services/identities' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', body);
                    if (submittedContext() && form.isConnected) {
                        form.dataset.id = saved.id;
                        form.dataset.version = String(saved.version);
                    }
                    break;
                }
                case 'connection': {
                    const row = await api('/services/connections' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', { name: str('name'), base_url: str('base_url'), model: str('model'), api_key: str('api_key'), password: str('password'), version });
                    if (submittedContext() && form.isConnected) {
                        form.dataset.id = row.id;
                        form.dataset.version = String(row.version);
                    }
                    break;
                }
                case 'remove-connection':
                    await api('/services/connections/' + id + '/remove', 'POST', { password: str('password'), version });
                    form.dataset.completed = 'true';
                    break;
                case 'revoke-others':
                case 'revoke-session': {
                    const r = await api('/services/sessions/revoke', 'POST', { password: str('password'), others: type === 'revoke-others', id });
                    if (r.relogin_required) {
                        resetCopilot();
                        hooks.reset();
                        return;
                    }
                    form.dataset.completed = 'true';
                    break;
                }
                case 'watch': {
                    const saved = await api('/services/watches' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', { request_id: str('request_id') || null, ...formSource(fd, id ? '' : str('dataset_id')), title: str('title'), identity_id: state.identity, dataset_id: str('dataset_id'), metric: str('metric'), operator: str('operator'), threshold: watchThresholdRequest(form, str('metric'), str('threshold')), active: fd.has('active'), stale_after_days: Number(str('stale_after_days')), expires_at: str('expires_at') || null, version });
                    if (submittedContext() && form.isConnected && id)
                        form.dataset.version = String(saved.version);
                    savedWatchCreate = !id;
                    break;
                }
                case 'alert-ack': {
                    const row = await api('/services/alerts/' + id + '/acknowledge', 'POST', { note: str('note'), version });
                    if (submittedContext() && form.isConnected)
                        form.dataset.version = String(row.version);
                    break;
                }
                default: throw new Error('表单尚未识别，没有执行写入。');
            }
            saved = true;
            retainSavedDraft();
            if (!submittedContext())
                return;
            if (!valid()) {
                hooks.toast(savedDraftMessage);
                return;
            }
            const refreshed = await hooks.refresh(() => submittedContext() && valid());
            retainSavedDraft();
            if (!submittedContext())
                return;
            if (!refreshed || !valid()) {
                hooks.toast(savedDraftMessage);
                return;
            }
            state.dirty = false;
            document.querySelector('#modal')?.close();
            await hooks.render();
            if (submittedContext())
                hooks.toast('已保存。');
        }
        catch (error) {
            if (!submittedContext())
                return;
            if (saved) {
                retainSavedDraft();
                if (valid()) {
                    state.dirty = false;
                    document.querySelector('#modal')?.close();
                }
                hooks.toast('已保存，但同步读取未完成；保留当前页面和新输入，请刷新核对，无需重复提交。', true);
            }
            else if (out && form.isConnected)
                out.textContent = error instanceof Error ? error.message : '提交失败，请核对状态后重试。';
            else
                hooks.toast(error instanceof Error ? error.message : '提交失败，请核对状态后重试。', true);
        }
        finally {
            delete form.dataset.pending;
            form.removeAttribute('aria-busy');
            buttons.forEach(b => b.disabled = form.dataset.completed === 'true');
        }
    }, true);
    document.addEventListener('change', async (e) => { const el = e.target; const watch = el.closest('form[data-service-form="watch"],form[data-service-form="proposal"][data-kind="watch"]'); if (watch && el.name === 'metric') {
        syncWatchMetric(watch, el.value);
        state.dirty = true;
        return;
    } if (el.id !== 'active-identity')
        return; try {
        await selectIdentity(el.value);
        el.value = state.identity;
    }
    catch (error) {
        hooks.toast(String(error), true);
        el.value = state.identity;
    } });
}
