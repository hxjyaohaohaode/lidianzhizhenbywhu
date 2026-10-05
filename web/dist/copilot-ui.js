import { watchMetrics, watchThresholdField, watchThresholdRequest, watchPreview } from './watch-units.js';
import { reportReadout } from './report-readout.js';
import { currentComparisonRead, removeComparisonOption } from './saved-comparisons.js';
import { scopedResearchInputs, researchInputFields, syncResearchInputControls, researchInputRequest, researchApprovalInputs, researchRunOutputs } from './copilot-research-inputs.js';
import { unchangedInputGuard } from './saved-experiments.js';
import { claimMathReferences } from './math-results.js';
import { interactionGuard, invalidateInteractions, renewSavedDraft } from './interactions.js';
import { api, workspace, ApiError } from './api.js';
import { assistantView } from './assistant.js';
import { metricComparison } from './metric-comparison.js';
import { state, activeDataset, activeIdentity, scopedDatasets } from './state.js';
import { esc, icon, notice, badge, status, jsonView, metricValue, metricNames, num, pct, amount, unitName, timeText, citationCard, field, textarea, input, select, formFooter, heading, routeButton, table, safeLink } from './components.js';
import { xbutton, serviceForm } from './views-services.js';
let researchForm = null;
let hooks;
let contextKey = '', threadId = '', current = null, epoch = 0, sending = false, loading = false, polling = false;
let draft = '', pendingKey = '', pendingText = '', creationKey = '';
let loadTask = null, creationTask = null;
let readSequence = 0, freshThread = false;
const remembered = new Map();
const drafts = new Map();
const traces = new Map();
const traceReads = new Map();
function token() { return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''); }
function key() { return (state.user?.id ?? '') + '|' + (state.user?.preferences.role ?? 'enterprise') + '|' + state.identity + '|' + state.active; }
export function configureCopilot(value) { hooks = value; }
export function resetCopilot() { researchForm = null; epoch++; contextKey = ''; threadId = ''; current = null; draft = ''; pendingKey = ''; pendingText = ''; creationKey = ''; freshThread = false; loadTask = null; creationTask = null; readSequence++; remembered.clear(); drafts.clear(); traces.clear(); traceReads.clear(); sending = false; loading = false; }
/** Invalidate the current editable catalog only; archived proposals/results stay intact. */
export function forgetCopilotComparison(target) {
    if (!researchForm || researchForm.identityId !== target.identityId || researchForm.identityId !== state.identity || researchForm.datasetId !== state.active || contextKey !== key())
        return;
    researchForm.comparisons = researchForm.comparisons.filter(r => r.id !== target.id);
    const form = document.querySelector('form[data-research-inputs]');
    if (!form || form.dataset.researchInputs !== researchForm.key || form.dataset.thread !== threadId || !researchForm.valid())
        return;
    const selected = removeComparisonOption(form.querySelector('[name="comparison_artifact_id"]'), target.id);
    syncResearchInputControls(form, researchForm, scopedDatasets());
    if (selected) {
        const detail = form.querySelector('#copilot-comparison-details');
        if (detail)
            detail.innerHTML = notice('原选企业对照已清理，已取消该引用；研究问题和其他输入保留，请核对后再生成提案。', 'warm');
    }
}
export function currentThread() { return current; }
function switchContext() { const next = key(); if (next === contextKey)
    return; researchForm = null; if (contextKey)
    drafts.set(contextKey, draft); contextKey = next; threadId = remembered.get(next) ?? ''; draft = drafts.get(next) ?? ''; current = null; pendingKey = ''; pendingText = ''; creationKey = ''; freshThread = false; loadTask = null; creationTask = null; readSequence++; traces.clear(); traceReads.clear(); epoch++; sending = false; loading = false; }
export function copilotShell(full = false) { switchContext(); const d = activeDataset(), i = activeIdentity(); return `<${full ? 'section' : 'aside'} id="${full ? 'copilot-full' : 'assistant-rail'}" class="${full ? 'copilot-full' : 'assistant-rail'}" aria-label="研究助手">${full ? '' : '<div id="assistant-resize" class="rail-resize" role="separator" aria-orientation="vertical" aria-label="调整研究助手宽度" tabindex="0" aria-valuenow="390" aria-valuemin="320" aria-valuemax="560"></div>'}<div class="copilot-header"><div class="copilot-title"><span class="copilot-orb">${icon('spark')}</span><div><h2>研究助手</h2><small>工具核查 · Agent 深入研判</small></div></div><div class="inline-actions">${xbutton(icon('plus'), 'chat-new', 'aria-label="新建研究会话" title="新建会话"', 'icon-button')}${xbutton(icon('clock'), 'chat-history', 'aria-label="查看历史会话" title="历史会话"', 'icon-button')}${full ? '' : `<button type="button" data-route="copilot" class="icon-button" aria-label="在主工作区打开研究助手" title="在主工作区打开">${icon('arrow')}</button>`} ${full ? '' : `<button type="button" data-action="close-assistant" class="icon-button" aria-label="收起助手">${icon('close')}</button>`}</div></div><div class="copilot-context"><span>${icon('memory')} ${esc(i?.payload.name ?? '默认身份')}</span><strong>${esc(d?.payload.company ?? '尚未选择企业')}</strong><span class="micro">${d ? '数据修订 ' + d.version : '先选择企业以获得业务分析'}</span></div><div class="copilot-messages" id="assistant-answer" aria-label="研究会话"><div class="loading"><span class="spinner"></span>读取会话…</div></div><div id="copilot-pending" class="copilot-pending" hidden></div><form id="assistant-form" class="assistant-composer"><label class="sr-only" for="assistant-query">研究问题</label><textarea id="assistant-query" name="query" rows="3" maxlength="3000" placeholder="查指标、证据与缺口；或明确要交给 Agent 的研究问题…" required>${esc(draft)}</textarea><div class="composer-footer"><span id="copilot-composer-status">本地工具不外发数据</span><button type="submit" class="primary icon-button" aria-label="发送研究问题">${icon('arrow')}</button></div><p class="form-error" role="alert"></p></form></${full ? 'section' : 'aside'}>`; }
export async function copilotPage() { return heading('连续研究，逐步求证', '在同一会话中核查事实、生成可审阅计划，并把结论转成行动与跟踪。') + copilotShell(true); }
function welcome() { const d = activeDataset(); return `<div class="copilot-welcome"><span class="eyebrow">${esc(activeIdentity()?.payload.name ?? '你的研究工作区')}</span><h3>${d ? '今天需要解决什么？' : '先把真实输入连接起来。'}</h3><p>${d ? '先用已保存的数据、证据和数学工具核对，再把需要解释的问题交给受控 Agent。' : '会话不会自动填充企业或结论。导入数据、配置工作身份后开始连续研究。'}</p><div class="prompt-grid">${['当前有哪些待核查问题？', '毛利和现金流为什么变化？', '预测收入并展示回测依据', '目前有什么任务和跟进行动？'].map(q => xbutton(esc(q) + icon('arrow'), 'chat-prompt', `data-query="${esc(q)}"`, 'prompt-chip')).join('')}</div><div class="copilot-boundary">${icon('lock')}查询只调用本地工具；分析外发和业务写入先出提案，由你确认。</div></div>`; }
function renderCard(c) {
    const d = c.data;
    if (c.kind === 'quality') {
        return `<section class="result-card"><h4>${esc(c.title)}</h4>${(d.findings ?? []).slice(0, 6).map((f) => `<p>${esc(f.message ?? f.title ?? f.code)}</p>`).join('') || '<p>当前规则没有发现新的质量提示。</p>'}<details><summary>完整质量检查</summary>${jsonView(d)}</details></section>`;
    }
    if (c.kind === 'lineage')
        return `<section class="result-card"><h4>${esc(c.title)}</h4>${(Array.isArray(d) ? d : []).map((l) => `<details><summary>${esc(l.label)} · ${metricValue(l.id, l.value)}</summary><code>${esc(l.formula)}</code>${table(['输入', '值', '单位'], l.inputs.map((v) => [esc(v.path), num(v.value), esc(v.unit)]))}</details>`).join('')}</section>`;
    if (c.kind === 'findings')
        return `<section class="result-card"><h4>${esc(c.title)}</h4>${d.length ? d.slice(0, 5).map((v) => `<p><strong>${esc(v.title)}</strong><br>${esc(v.message)}</p>`).join('') : '<p>当前规则未触发新事项，不代表企业不存在风险。</p>'}</section>`;
    if (c.kind === 'runs')
        return `<section class="result-card"><h4>${esc(c.title)}</h4>${d.length ? d.map((r) => `<div class="row-between">${routeButton('查看执行 ' + r.id.slice(0, 6), 'agents:run-' + r.id)}${status(r.state)}</div>`).join('') : '<p>当前企业还没有任务。</p>'}</section>`;
    if (c.kind === 'actions')
        return `<section class="result-card"><h4>${esc(c.title)}</h4>${d.length ? d.slice(0, 8).map((r) => `<div class="row-between"><span>${esc(r.payload.title)}</span>${status(r.payload.status)}</div>`).join('') : '<p>尚无跟进行动。</p>'}${routeButton('进入行动工作区', 'actions')}</section>`;
    if (c.kind === 'forecast') {
        const result = d ?? {}, metric = result.metric, known = ['revenue', 'cost', 'cash_flow', 'gross_margin'].includes(metric), ratio = metric === 'gross_margin', unit = state.user?.preferences?.amount_unit ?? 'wan', blocked = ['blocked', 'failed', 'unavailable'].includes(result.status);
        const values = known && !blocked && Array.isArray(result.forecast) ? result.forecast : [];
        const inputEnd = typeof result.train_end === 'string' && /^[0-9]{4}-Q[1-4]$/.test(result.train_end) ? result.train_end : '未记录';
        return `<section class="result-card" data-card-kind="forecast" tabindex="-1" aria-label="预测结果"><h4>${esc(c.title)}</h4>${known ? `<p><strong>${esc(metricNames[metric])} · ${ratio ? '%' : unitName(unit)}</strong></p>` : blocked ? '' : notice('指标未记录，不能确定展示单位；请核对已保存的原始产物。', 'warm')}${known && !blocked ? `<p data-forecast-input-period>历史输入截至：${esc(inputEnd)}</p>` : ''}<p>${esc(result.reason ?? result.selected_label ?? '数据不足时不生成预测')}</p>${values.length ? table(['期间', '基线点估计'], values.map((v) => [esc(v.period), ratio ? pct(v.value) : amount(v.value, unit)])) : ''}<p class="micro">统计基线来自已保存历史数据，不是因果预测或未来表现保证。</p>${(Array.isArray(result.limitations) ? result.limitations : []).map((v) => `<p class="micro">${esc(v)}</p>`).join('')}<details><summary>回测、边界与每折结果</summary>${jsonView(result)}</details>${routeButton('在数学工作区调整参数', 'lab')}</section>`;
    }
    if (c.kind === 'inventory')
        return `<section class="result-card"><h4>${esc(c.title)}</h4><div class="micro-row"><span>数据 ${d.datasets}</span><span>行动 ${d.actions}</span><span>报告 ${d.reports}</span></div></section>`;
    return `<section class="result-card"><h4>${esc(c.title)}</h4><details><summary>查看实际工具产物</summary>${jsonView(d)}</details></section>`;
}
function factView(f) {
    return `<article class="fact-tile"><span>${esc(f.label)}</span><strong>${f.display_value ? esc(f.display_value) : metricValue(f.id, f.value)}</strong><small>${esc(f.period)} · 数据修订 ${esc(f.dataset_version)}</small>${metricComparison(f)}${f.formula ? `<details class="fact-basis"><summary>计算与来源</summary><p>${esc(f.formula)}</p>${(f.inputs ?? []).map((v) => `<div><code>${esc(v.path)}</code><span>${num(v.value)} ${esc(v.unit ?? '')}</span></div>`).join('')}<p class="micro">输入状态：${esc(f.verification === 'verified' ? '已核验' : f.verification === 'unverified' ? '尚未独立核验' : f.verification ?? '未记录')}</p>${f.source_url ? safeLink(f.source_url, '原始来源') : ''}</details>` : ''}</article>`;
}
function researchBrief(r) { const b = r.research_brief; if (!b)
    return ''; return `<div class="evidence-boundary"><span>${icon('files')} 依据范围</span><strong>${esc(b.matched_document_count ?? 0)} 份匹配资料</strong><small>${b.causal_claims_supported === false ? '本地核查不支持因果断言' : '结合原始来源复核'}${b.missing_metric_ids?.length ? ' · ' + b.missing_metric_ids.length + ' 项指标输入不足' : ''}</small></div>`; }
export function messageView(m) {
    const r = m.payload.response, trace = traces.get(m.id), receipts = r.receipts ?? [], facts = r.facts ?? [], forecastCards = (r.cards ?? []).filter((c) => c.kind === 'forecast');
    return `<article class="chat-turn" data-message="${esc(m.id)}"><div class="user-message"><span>你 · ${timeText(m.created_at)}</span><p>${esc(m.payload.question)}</p></div><div class="copilot-response"><div class="response-heading">${icon('spark')}<strong>研究核查</strong>${badge(receipts.length + ' 次本地工具')}</div><p class="research-answer">${esc(r.answer)}</p>${researchBrief(r)}${forecastCards.length ? `<div class="inline-actions">${xbutton('查看预测结果', 'chat-forecast', `data-message="${esc(m.id)}"`, 'secondary')}</div>` : ''}${forecastCards.map(renderCard).join('')}${facts.length ? `<div class="fact-grid">${facts.map(factView).join('')}</div>` : ''}${(r.cards ?? []).filter((c) => c.kind !== 'forecast').map(renderCard).join('')}${(r.citations ?? []).length ? `<section class="answer-evidence"><h4>匹配的原文证据</h4>${r.citations.map(citationCard).join('')}</section>` : ''}${(r.warnings ?? []).map((w) => notice(w, 'warm')).join('')}${r.next_steps?.length ? `<section class="research-next"><div class="section-heading"><span class="eyebrow">继续求证</span><h4>下一步要解决的问题</h4></div>${r.next_steps.map((n, index) => `<article><span class="next-index">${index + 1}</span><div><strong>${esc(n.title)}</strong><p>${esc(n.reason)}</p>${n.acceptance ? `<details><summary>怎样算核查完成</summary><p>${esc(n.acceptance)}</p></details>` : ''}${n.route ? routeButton('前往核查 ' + icon('arrow'), n.route, 'text-button') : ''}</div></article>`).join('')}</section>` : ''}<details class="tool-receipts"><summary>调用凭据与输入范围 · ${receipts.length} 项</summary>${receipts.map((t) => `<div><strong>${esc(t.tool)}</strong><span> ${num(t.milliseconds, 1)} ms · ${esc(t.state)}</span><p class="hash-label">输出 ${esc(t.output_hash)}</p></div>`).join('')}${jsonView(r.context)}<small>外部调用 ${r.external_calls ?? 0} 次；不是隐藏推理过程。</small></details><div class="trace-container">${(trace ? notice('以下复核保留原问题的季度、基期与指标，使用读取时的数据修订 ' + trace.scope.dataset_version + '；原始会话结果保留在上方。') + assistantView(m.payload.question, trace) : '') + xbutton(trace ? '重新按当前修订复核' : '按当前输入复核公式与季度轨迹', 'chat-trace', `data-message="${esc(m.id)}"`, 'text-button')}</div><div class="response-actions">${(r.actions ?? []).map((a) => a.kind === 'navigate' ? routeButton(esc(a.label), a.route, 'text-button') : xbutton(esc(a.label), 'chat-propose', `data-kind="${esc(a.type)}" data-message="${esc(m.id)}"`, 'secondary')).join('')}</div></div></article>`;
}
function proposalCard(row) { const p = row.payload; const run = current.runs.find((r) => r.proposal_id === row.id); return `<article class="proposal-card" data-proposal="${esc(row.id)}"><div class="row-between"><span class="eyebrow">${{ research: 'Agent 研判', action: '跟进行动', watch: '指标跟踪', memory: '长期记忆' }[p.kind]}</span>${badge(p.status === 'draft' ? '待你确认' : p.status === 'executed' ? '已确认执行' : '已放弃', p.status === 'executed' ? 'good' : 'warm')}</div><h4>${esc(p.title)}</h4>${p.kind === 'watch' ? watchPreview(p.preview) : ''}${run ? `<div class="row-between">${status(run.state)}${routeButton('查看节点与审阅结果', 'agents:run-' + run.id)}</div>${run.error ? notice(run.error, 'danger') : ''}${run.source_impact && run.source_impact.state !== 'current' ? notice('当前适用性需复核：' + (run.source_impact.reasons ?? []).map((r) => r.message ?? r.code).join('；') + '。以下报告与计算仍是原始冻结内容。', 'warm') : run.current_dataset_version !== run.dataset_version ? notice('企业数据已有新修订，以下报告仍依据当时的输入。', 'warm') : ''}${run.result ? `<div class="chat-run-result">${reportReadout(run.result)}${run.result.findings.slice(0, 4).map((f) => `<p>${esc(f)}</p>`).join('')}${researchRunOutputs(run.result, state.user?.preferences?.amount_unit ?? 'wan')}<h4>模型解释</h4>${status(run.result.llm.state)}${run.result.llm.review.claims.map((c) => `<p>${esc(c.text)}</p>${claimMathReferences(c)}`).join('') || '<p class="micro">本次没有通过结构核验的模型解释，不用模板内容替代。</p>'}${run.result.missing?.length ? `<details><summary>尚需核对的问题</summary>${run.result.missing.map((v) => `<p>${esc(v)}</p>`).join('')}</details>` : ''}</div>` : ''}` : ''}<div class="inline-actions">${p.status === 'draft' ? xbutton('查看范围并确认', 'chat-review', `data-id="${esc(row.id)}"`, 'primary') : p.result?.route && !run ? routeButton('查看已创建记录', p.result.route) : ''}${xbutton('查看完整提案', 'chat-detail', `data-id="${esc(row.id)}"`, 'text-button')}</div></article>`; }
function detailState(host) { const map = new Map(); host.querySelectorAll('.chat-turn[data-message],.proposal-card[data-proposal]').forEach(row => map.set(row.dataset.message ?? row.dataset.proposal ?? '', [...row.querySelectorAll('details')].flatMap((d, i) => d.open ? [i] : []))); return map; }
export function alignChatBlock(host, target) { host.scrollTop += target.getBoundingClientRect().top - host.getBoundingClientRect().top; }
function paint(scroll = false) {
    const host = document.querySelector('#assistant-answer');
    if (!host)
        return;
    const opened = detailState(host), prior = host.scrollTop, atEnd = host.scrollHeight - host.scrollTop - host.clientHeight < 100;
    host.innerHTML = current ? (current.messages.map(messageView).join('') || welcome()) + (current.proposals.length ? `<section class="chat-proposals"><h3>计划与执行结果</h3>${current.proposals.map(proposalCard).join('')}</section>` : '') : welcome();
    host.querySelectorAll('.chat-turn[data-message],.proposal-card[data-proposal]').forEach(row => { const details = row.querySelectorAll('details'); for (const n of opened.get(row.dataset.message ?? row.dataset.proposal ?? '') ?? [])
        if (details[n])
            details[n].open = true; });
    if (scroll) {
        const latest = [...host.querySelectorAll('.chat-turn')].at(-1);
        if (latest)
            alignChatBlock(host, latest);
        else
            host.scrollTop = host.scrollHeight;
    }
    else if (atEnd)
        host.scrollTop = host.scrollHeight;
    else
        host.scrollTop = prior;
    const composer = document.querySelector('#assistant-query');
    if (composer && composer.value !== draft)
        composer.value = draft;
    setSending();
}
function setSending() { const p = document.querySelector('#copilot-pending'); if (p) {
    p.hidden = !sending;
    p.innerHTML = sending ? '<span class="spinner"></span>正在核查本地数据；没有发出付费请求。' : '';
} const button = document.querySelector('#assistant-form button[type="submit"]'); if (button) {
    button.disabled = sending || loading || current?.context?.writable === false;
    button.setAttribute('aria-busy', String(sending || loading));
} const label = document.querySelector('#copilot-composer-status'); if (label)
    label.textContent = loading ? '正在复核会话与来源状态…' : current?.context?.writable === false ? (current.context.unavailable_reason ?? '历史会话仅供查阅，请新建会话') : '本地工具不外发数据 · Ctrl/⌘ + Enter 发送'; }
function validContext(started, scope) { return started === epoch && scope === contextKey && scope === key(); }
function acceptThread(loaded, id, started, scope, sequence) {
    if (!validContext(started, scope) || id !== threadId || sequence !== readSequence)
        return false;
    if (current?.thread.id === id && loaded.thread.version < current.thread.version)
        return false;
    current = loaded;
    remembered.set(scope, id);
    return true;
}
export async function mountCopilot() {
    switchContext();
    if (loadTask)
        return loadTask;
    if (freshThread) {
        paint();
        return;
    }
    // Completed runs still need live source-impact checks when this view is mounted.
    // Reuse the in-flight read and retain the composer draft; never rerun the analysis.
    const e = epoch, scope = contextKey, seq = ++readSequence;
    loading = true;
    setSending();
    const task = (async () => {
        try {
            if (!threadId) {
                const found = await api('/services/threads?identity_id=' + encodeURIComponent(state.identity) + '&dataset_id=' + encodeURIComponent(state.active));
                if (!validContext(e, scope) || seq !== readSequence)
                    return;
                threadId = found.items[0]?.id ?? '';
            }
            if (threadId) {
                const id = threadId, loaded = await api('/services/threads/' + id);
                if (!acceptThread(loaded, id, e, scope, seq))
                    return;
            }
            if (validContext(e, scope))
                paint();
        }
        catch (error) {
            if (!validContext(e, scope) || seq !== readSequence)
                return;
            const host = document.querySelector('#assistant-answer');
            if (host)
                host.innerHTML = notice(error instanceof Error ? error.message : '会话读取失败', 'danger') + xbutton('重新读取', 'chat-refresh', '', 'primary');
            throw error;
        }
        finally {
            if (validContext(e, scope)) {
                loading = false;
                loadTask = null;
                setSending();
            }
        }
    })();
    loadTask = task;
    return task;
}
async function ensureThread() {
    const e = epoch, scope = contextKey;
    if (loadTask)
        await loadTask;
    else if (!freshThread && !threadId && !current)
        await mountCopilot();
    if (!validContext(e, scope))
        throw new Error('上下文已经切换，没有创建或提交会话。');
    if (threadId && current)
        return;
    if (creationTask)
        return creationTask;
    creationKey ||= token();
    const task = (async () => {
        try {
            const row = await api('/services/threads', 'POST', { identity_id: state.identity, dataset_id: state.active, title: '新的研究', request_id: creationKey });
            if (!validContext(e, scope))
                throw new Error('上下文已经切换，没有继续提交问题。');
            threadId = row.id;
            remembered.set(scope, threadId);
            current = { thread: row, messages: [], proposals: [], runs: [] };
            freshThread = false;
            creationKey = '';
            readSequence++;
        }
        finally {
            if (validContext(e, scope))
                creationTask = null;
        }
    })();
    creationTask = task;
    return task;
}
export async function sendCopilot(text, isCurrent = () => true) {
    if (!isCurrent())
        return;
    switchContext();
    if (sending)
        return;
    text = text.trim();
    if (!text)
        return;
    if (current?.context?.writable === false)
        throw new Error(current.context.unavailable_reason ?? '此历史会话为只读，请新建会话。');
    const e = epoch, scope = contextKey;
    sending = true;
    draft = text;
    setSending();
    if (!pendingKey || pendingText !== text) {
        pendingKey = token();
        pendingText = text;
    }
    try {
        await ensureThread();
        if (!isCurrent() || !validContext(e, scope))
            return;
        if (current?.context?.writable === false)
            throw new Error(current.context.unavailable_reason ?? '此历史会话为只读，请新建会话。');
        const id = threadId;
        readSequence++;
        await api('/services/threads/' + id + '/messages', 'POST', { text, request_id: pendingKey, version: current.thread.version });
        if (!validContext(e, scope) || id !== threadId)
            return;
        // Preserve text typed while the sent question was being processed.
        if (draft.trim() === text) {
            draft = '';
            drafts.delete(scope);
        }
        pendingKey = '';
        pendingText = '';
        await reloadThread();
        if (validContext(e, scope))
            paint(true);
    }
    catch (error) {
        if (validContext(e, scope)) {
            if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
                await reloadThread();
                if (!validContext(e, scope))
                    return;
            }
            const out = document.querySelector('#assistant-form .form-error');
            if (out)
                out.textContent = error instanceof Error ? error.message : '查询失败；请核对状态后重试。';
            throw error;
        }
    }
    finally {
        if (validContext(e, scope)) {
            sending = false;
            setSending();
        }
    }
}
export async function handoffCopilot(text, current = () => true) { if (!current())
    return; switchContext(); const e = epoch, scope = contextKey; await mountCopilot(); if (current() && validContext(e, scope))
    await sendCopilot(text, current); }
export function rememberDraft(text) { draft = text; drafts.set(contextKey, text); }
export async function chatAction(action, el) {
    if (['chat-history', 'chat-open', 'chat-propose', 'chat-review', 'chat-detail'].includes(action))
        invalidateInteractions();
    const id = el.dataset.id ?? '', valid = interactionGuard(), started = epoch, scope = contextKey;
    const active = () => valid() && validContext(started, scope);
    if (action === 'chat-forecast') {
        if (!active() || !current?.messages.some((m) => m.id === el.dataset.message))
            return;
        const host = document.querySelector('#assistant-answer');
        const row = host && [...host.querySelectorAll('.chat-turn')].find(r => r.dataset.message === el.dataset.message);
        const card = row?.querySelector('[data-card-kind="forecast"]');
        if (!host || !card)
            throw new Error('该答复的预测结果尚未显示，请重新读取会话。');
        alignChatBlock(host, card);
        card.focus({ preventScroll: true });
        return;
    }
    if (action === 'chat-refresh') {
        await reloadThread();
        if (!threadId)
            await mountCopilot();
        return;
    }
    if (action === 'chat-trace') {
        const message = current?.messages.find((m) => m.id === el.dataset.message);
        if (!message || !state.active)
            throw new Error('请先选择企业数据再查看追踪。');
        if (current?.context?.writable === false)
            throw new Error(current.context.unavailable_reason ?? '原会话范围已失效，不能复核当前输入。');
        const e = epoch, scope = contextKey, id = threadId, dataset = state.active, seq = (traceReads.get(message.id) ?? 0) + 1;
        traceReads.set(message.id, seq);
        const result = await api('/services/threads/' + encodeURIComponent(id) + '/messages/' + encodeURIComponent(message.id) + '/trace?' + new URLSearchParams({ identity_id: state.identity, dataset_id: dataset }));
        if (!validContext(e, scope) || id !== threadId || dataset !== state.active || traceReads.get(message.id) !== seq)
            return;
        traces.set(message.id, result);
        paint();
        return;
    }
    if (action === 'chat-new') {
        if (sending)
            throw new Error('当前问题尚在处理，请等待返回后新建会话。');
        if (draft && !confirm('保留在当前窗口的未发送草稿将清空，是否新建会话？'))
            return;
        invalidateInteractions();
        epoch++;
        loading = false;
        loadTask = null;
        creationTask = null;
        sending = false;
        threadId = '';
        current = null;
        researchForm = null;
        draft = '';
        pendingKey = '';
        pendingText = '';
        creationKey = '';
        freshThread = true;
        traces.clear();
        traceReads.clear();
        remembered.delete(contextKey);
        drafts.delete(contextKey);
        paint();
        return;
    }
    if (action === 'chat-prompt') {
        await sendCopilot(el.dataset.query ?? '');
        return;
    }
    if (action === 'chat-history') {
        const e = epoch;
        const r = await api('/services/threads?identity_id=' + encodeURIComponent(state.identity) + '&dataset_id=' + encodeURIComponent(state.active));
        if (e !== epoch || !active())
            return;
        hooks.dialog('当前身份与企业的研究会话', r.items.length ? r.items.map((t) => `<article class="thread-history"><h3>${esc(t.payload.title)}</h3><small>${timeText(t.updated_at)}</small><div class="inline-actions">${xbutton('打开', 'chat-open', `data-id="${esc(t.id)}"`)}${xbutton('导出', 'chat-export', `data-id="${esc(t.id)}"`)}${xbutton('删除', 'chat-delete', `data-id="${esc(t.id)}" data-version="${t.version}"`, 'text-button danger-text')}</div></article>`).join('') : notice('当前上下文没有历史会话。'));
        return;
    }
    if (action === 'chat-open') {
        if (sending)
            throw new Error('当前问题尚在处理，请等待返回后切换会话。');
        if (draft && !confirm('当前未发送草稿将清空，继续打开历史会话？'))
            return;
        const e = ++epoch;
        const target = contextKey;
        loading = false;
        loadTask = null;
        creationTask = null;
        const loaded = await api('/services/threads/' + id);
        if (e !== epoch || target !== contextKey)
            return;
        if (!valid() || target !== key())
            return;
        threadId = id;
        readSequence++;
        traces.clear();
        traceReads.clear();
        current = loaded;
        researchForm = null;
        draft = '';
        pendingKey = '';
        pendingText = '';
        drafts.delete(contextKey);
        remembered.set(contextKey, id);
        document.querySelector('#modal')?.close();
        paint();
        return;
    }
    if (action === 'chat-export') {
        const r = await api('/services/threads/' + id);
        if (!active())
            return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = '研究会话-' + id.slice(0, 8) + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
    }
    if (action === 'chat-delete') {
        if (!confirm('永久删除此助手会话及提案副本？已批准的任务和报告作为独立记录保留。'))
            return;
        await api('/services/threads/' + id + '?version=' + encodeURIComponent(el.dataset.version ?? ''), 'DELETE');
        if (!active())
            return;
        document.querySelector('#modal')?.close();
        if (threadId === id) {
            epoch++;
            readSequence++;
            current = null;
            threadId = '';
            researchForm = null;
            loadTask = null;
            creationTask = null;
            creationKey = '';
            pendingKey = '';
            pendingText = '';
            loading = false;
            sending = false;
            traces.clear();
            traceReads.clear();
            remembered.delete(contextKey);
        }
        paint();
        return;
    }
    if (action === 'chat-propose') {
        await proposalForm(el.dataset.kind ?? 'research', el.dataset.message ?? '', active);
        return;
    }
    if (action === 'chat-review') {
        const p = await api('/services/proposals/' + id);
        if (active())
            await reviewProposal(p, active);
        return;
    }
    if (action === 'chat-detail') {
        const row = await api('/services/proposals/' + id);
        if (active())
            hooks.inspect('提案、输入绑定与执行结果', (row.payload?.kind === 'watch' ? watchPreview(row.payload.preview) : '') + jsonView(row));
        return;
    }
    if (action === 'chat-discard') {
        await api('/services/proposals/' + id + '?version=' + encodeURIComponent(el.dataset.version ?? ''), 'DELETE');
        if (!active())
            return;
        document.querySelector('#modal')?.close();
        await reloadThread();
        return;
    }
    throw new Error('未识别的研究助手操作');
}
async function proposalForm(kind, messageId, valid) {
    await ensureThread();
    if (!valid())
        return;
    if (current?.context?.writable === false)
        throw new Error(current.context.unavailable_reason ?? '此历史会话为只读，请新建会话。');
    const source = current.messages.find((m) => m.id === messageId);
    const text = source?.payload.question ?? draft;
    const i = activeIdentity();
    let inputs = null;
    let body = field('具体目标或要保存的内容', textarea('text', text, `required minlength="${kind === 'research' && source ? 1 : 5}" maxlength="3000" rows="4"`));
    if (kind === 'research') {
        const identityId = state.identity, datasetId = state.active, bound = current.thread.payload;
        if (bound?.identity_id !== undefined && bound.identity_id !== identityId || bound?.dataset_id !== undefined && bound.dataset_id !== datasetId)
            throw new Error('历史会话与当前身份或企业不一致，请切回原范围后再生成提案。');
        if (!datasetId || !scopedDatasets().some(d => d.id === datasetId))
            throw new Error('请先选择当前身份范围内的企业，再生成研判提案。');
        const query = '?' + new URLSearchParams({ identity_id: identityId, dataset_id: datasetId });
        const [c, experiments, comparisons] = await currentComparisonRead(() => Promise.all([api('/services/connections'), workspace('/experiments' + query), workspace('/comparisons' + query)]));
        if (!valid())
            return;
        inputs = scopedResearchInputs(identityId, datasetId, experiments, comparisons, scopedDatasets());
        const opts = c.items.filter((x) => x.configured).map((x) => ({ value: x.id, label: (x.name ?? x.id) + ' · ' + x.model }));
        body += `<div class="form-grid">${field('任务类型', select('mode', { operational: '经营诊断', margin: '毛利压力', industry: '行业证据', investment: '投资研究', deep_dive: '深入核验' }))}${field('深度', select('depth', { '': '遵循已激活策略', concise: '聚焦要点', balanced: '均衡', deep: '深入' }, i?.payload.depth ?? 'balanced'))}</div>${researchInputFields(inputs)}${field('希望结果满足什么标准', textarea('acceptance', '', 'rows="2" maxlength="1000" placeholder="例如：区分数据变化、解释假设、替代原因和缺失证据"'))}<details><summary>模型参与与数学工具</summary><div class="stack">${field('已配置模型', select('provider', [{ value: '', label: '选择连接（不选择则只使用本地工具）' }, ...opts]))}<label class="check-label"><input type="checkbox" name="use_llm" ${i && !i.payload.allow_external ? 'disabled' : ''}>允许在确认后调用模型${i && !i.payload.allow_external ? '（当前身份禁止外部调用）' : ''}</label>${field('全部外部尝试上限', input('max_calls', Math.min(i?.payload.max_calls ?? 3, 3), 'type="number" min="0" max="' + (i?.payload.max_calls ?? 8) + '" required'))}<label class="check-label"><input type="checkbox" name="include_thread_history">纳入本会话最近4轮原问题，完整内容在确认页展示</label><label class="check-label"><input type="checkbox" name="model_planning">在相同预算内允许模型调整编排</label><label class="check-label"><input type="checkbox" name="forecast">加入本地预测与回测</label>${field('预测目标', select('forecast_metric', { revenue: '营业收入', cost: '营业成本', cash_flow: '经营现金流', gross_margin: '毛利率' }))}${field('预测步数（季度）', input('horizon', 2, 'type="number" min="1" max="4" required'))}</div></details>`;
    }
    else if (kind === 'action') {
        body += field('验收标准', textarea('acceptance', '', 'rows="3" minlength="5" required maxlength="2000"')) + field('截止日期', input('due_at', '', 'type="date"'));
    }
    else if (kind === 'watch') {
        body += field('跟踪截止日期（可选）', input('expires_at', '', 'type="date"'), '按 UTC 日期，含截止日；到期后不再生成提醒。') + field('跟踪指标', select('metric', watchMetrics, 'gross_margin')) + field('触发条件', select('operator', { lt: '低于', gt: '高于' })) + watchThresholdField();
    }
    else
        body += notice('确认后作为当前服务身份的已批准记忆保存。请勿写入密钥、口令或不必要的敏感信息。');
    const formKey = token();
    body += formFooter('生成提案，不立即执行');
    hooks.dialog({ research: '交给 Agent 深入研判', action: '创建跟进行动提案', watch: '创建指标跟踪提案', memory: '保存记忆提案' }[kind], serviceForm('proposal', body, `data-thread="${esc(threadId)}" data-kind="${esc(kind)}" data-message="${esc(messageId)}" data-key="${formKey}" data-research-inputs="${formKey}"`), true);
    researchForm = inputs ? { ...inputs, key: formKey, threadId, valid: interactionGuard() } : null;
}
export async function reviewProposal(row, valid = interactionGuard()) {
    if (!valid())
        return;
    const p = row.payload;
    if (p.status !== 'draft') {
        hooks.inspect('提案状态', (p.kind === 'watch' ? watchPreview(p.preview) : '') + jsonView(p));
        return;
    }
    let body = `<h3>${esc(p.title)}</h3><p>${esc(p.text)}</p><div class="micro-row"><span>当前身份 ${esc(activeIdentity()?.payload.name ?? '默认身份')}</span><span>数据修订 ${p.binding.dataset_version}</span></div>`;
    if (p.kind === 'research') {
        const plan = await api('/workspace/plans/' + p.plan_id), d = plan.payload;
        if (!valid())
            return;
        body += researchApprovalInputs(d) + `<div class="proposal-nodes">${d.nodes.filter((n) => n.enabled !== false).map((n) => `<div>${icon(n.engine === 'optional_llm' ? 'spark' : 'network')}<span><strong>${esc(n.name ?? n.label)}</strong><small>${esc(n.purpose ?? n.engine)}</small></span></div>`).join('')}</div>${d.blockers.map((v) => notice(v, 'danger')).join('')}<div class="micro-row"><span>外部调用最多 ${d.max_calls} 次</span><span>上下文 ${d.packing.characters} 字符</span></div><details><summary>必须核对：实际上下文、证据与外发对象</summary>${jsonView({ context: d.context, models: d.adaptive?.provider_bindings, scope: d.consent_scope, excluded: d.packing.dropped })}</details>` + serviceForm('confirm-proposal', `${d.max_calls ? '<label class="check-label consent"><input type="checkbox" name="external_consent" required>已核对上述实际上下文与接收方，同意在列明范围和累计预算内外发。</label>' : '<p class="micro">本任务不会调用模型或自动检索网络。</p>'}${formFooter('批准并执行')}`, `data-thread="${esc(threadId)}" data-id="${esc(row.id)}" data-version="${row.version}" data-fingerprint="${esc(p.fingerprint)}"`);
    }
    else {
        body += (p.kind === 'watch' ? `<section aria-label="将要创建的跟踪规则">${watchPreview(p.preview)}</section><details><summary>完整提案原始记录</summary>${jsonView(p.preview)}</details>` : `<details open><summary>将要创建的记录</summary>${jsonView(p.preview)}</details>`) + serviceForm('confirm-proposal', formFooter('确认创建'), `data-thread="${esc(threadId)}" data-id="${esc(row.id)}" data-version="${row.version}" data-fingerprint="${esc(p.fingerprint)}"`);
    }
    body += xbutton('放弃此提案', 'chat-discard', `data-id="${esc(row.id)}" data-version="${row.version}"`, 'text-button');
    hooks.dialog('核对后确认', body, true);
}
export async function copilotSubmit(form, fd) {
    if (form.dataset.thread !== threadId || contextKey !== key())
        throw new Error('会话已切换，请从当前会话重新打开提案。');
    const valid = unchangedInputGuard(interactionGuard(), () => form.isConnected ? JSON.stringify([...new FormData(form)]) : null), e = epoch, scope = contextKey;
    const active = () => valid() && validContext(e, scope);
    const get = (n) => String(fd.get(n) ?? '');
    if (form.dataset.serviceForm === 'proposal') {
        const kind = form.dataset.kind;
        const body = { kind, text: get('text'), source_message_id: form.dataset.message, request_id: form.dataset.key, use_llm: fd.has('use_llm') };
        if (kind === 'research') {
            if (!researchForm || researchForm.key !== form.dataset.researchInputs || researchForm.threadId !== threadId || !researchForm.valid())
                throw new Error('提案窗口或范围已变化，请重新打开后选择研究依据。');
            const selected = researchInputRequest(fd, researchForm, state.identity, state.active, scopedDatasets());
            if (body.use_llm && !get('provider'))
                throw new Error('先选择一个已经配置的模型连接。');
            Object.assign(body, { ...selected.references, include_thread_history: fd.has('include_thread_history'), provider: get('provider'), mode: get('mode'), acceptance: get('acceptance'), max_calls: Number(get('max_calls')), execution: { depth: get('depth') || null, model_planning: body.use_llm && fd.has('model_planning'), ...selected.forecast } });
        }
        else if (kind === 'action')
            Object.assign(body, { acceptance: get('acceptance'), due_at: get('due_at') || null });
        else if (kind === 'watch')
            Object.assign(body, { metric: get('metric'), operator: get('operator'), threshold: watchThresholdRequest(form, get('metric'), get('threshold')), expires_at: get('expires_at') || null });
        const row = await api('/services/threads/' + threadId + '/proposals', 'POST', body);
        const keepDraft = () => { if (validContext(e, scope) && renewSavedDraft(JSON.stringify([...fd]), () => form.isConnected ? JSON.stringify([...new FormData(form)]) : null, () => { form.dataset.key = crypto.randomUUID(); })) {
            state.dirty = true;
            hooks.toast('上一版提案已保存到此会话；保留你的新草稿，再次提交会生成新的提案。');
        } };
        if (!active()) {
            keepDraft();
            return;
        }
        await reloadThread();
        if (!active()) {
            keepDraft();
            return;
        }
        state.dirty = false;
        await reviewProposal(row, active);
        if (form.isConnected && !active())
            keepDraft();
        return;
    }
    if (form.dataset.serviceForm === 'confirm-proposal') {
        await api('/services/proposals/' + form.dataset.id + '/confirm', 'POST', { version: Number(form.dataset.version), fingerprint: form.dataset.fingerprint, external_consent: fd.has('external_consent') });
        if (!active())
            return;
        state.dirty = false;
        document.querySelector('#modal')?.close();
        await reloadThread();
        hooks.toast('已确认。实际执行和结果会保留在会话中。');
        return;
    }
}
export async function reloadThread() { const e = epoch, scope = contextKey, id = threadId; if (!id)
    return; const seq = ++readSequence; const loaded = await api('/services/threads/' + id); if (acceptThread(loaded, id, e, scope, seq))
    paint(); }
document.addEventListener('input', e => { const t = e.target; if (t.id === 'assistant-query')
    rememberDraft(t.value); });
document.addEventListener('keydown', e => { if (e.target.id === 'assistant-query' && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    e.target.form?.requestSubmit();
} });
setInterval(async () => { if (polling || sending || loading || document.hidden || document.querySelector('dialog[open]') || document.activeElement?.closest('#assistant-answer') || !state.user || !current?.runs.some((r) => ['queued', 'running'].includes(r.state)))
    return; if (!document.querySelector('#assistant-answer')?.getClientRects().length)
    return; polling = true; try {
    await reloadThread();
}
catch (error) {
    const label = document.querySelector('#copilot-composer-status');
    if (label)
        label.textContent = '状态读取中断，请重新读取；任务未被标记成功。';
}
finally {
    polling = false;
} }, 2200);
// Selection changes are synchronous and belong only to the currently open scoped form.
document.addEventListener('change', e => { const el = e.target; if (!['copilot-experiment', 'copilot-comparison'].includes(el.id))
    return; const form = el.form; if (!form || !researchForm || form.dataset.researchInputs !== researchForm.key || form.dataset.thread !== threadId || contextKey !== key() || !researchForm.valid())
    return; syncResearchInputControls(form, researchForm, scopedDatasets()); });
