import { esc, icon, routeButton } from './components.js';
import { activeDataset, activeIdentity } from './state.js';
const stages = [
    { label: '准备输入', detail: '数据 · 原始证据', route: 'data', icon: 'database', pages: ['data', 'evidence', 'memory'] },
    { label: '提出问题', detail: '工具核查 · 对照', route: 'copilot', icon: 'spark', pages: ['brief', 'copilot', 'compare'] },
    { label: '审阅研判', detail: '建模 · Agent · 报告', route: 'agents', icon: 'network', pages: ['agents', 'lab', 'reports', 'evolution', 'ops'] },
    { label: '持续跟进', detail: '行动 · 指标跟踪', route: 'actions', icon: 'check', pages: ['actions', 'tracking'] }
];
/** Navigation through actual workspaces, not a fabricated completion indicator. */
export function workflowGuide(route) {
    if (['services', 'settings', 'copilot'].includes(route))
        return '';
    return `<nav class="workflow-map" aria-label="研究工作路径">${stages.map((s, n) => `<button type="button" data-route="${s.route}" class="workflow-step ${s.pages.includes(route) ? 'current' : ''}" ${s.pages.includes(route) ? 'aria-current="step"' : ''} title="${s.label}：${s.detail}"><span class="workflow-index">${String(n + 1).padStart(2, '0')}</span><span><strong>${s.label}</strong><small>${s.detail}</small></span>${icon(s.icon)}</button>`).join('')}</nav>`;
}
export function contextBanner() {
    const d = activeDataset(), identity = activeIdentity();
    return `<div class="research-context"><span class="context-symbol">${icon('database')}</span><div><span class="eyebrow">当前研究范围</span><strong>${esc(d?.payload.company ?? '尚未选择企业')}</strong><p>${d ? esc(d.payload.name) + ' · 修订 ' + d.version + ' · ' + esc(d.payload.periods.at(-1)?.period ?? '未录入季度') : '使用你的报表与证据开始，工作区不填充演示结论'}</p></div><span class="context-identity">${icon('memory')}${esc(identity?.payload.name ?? '默认身份')}</span>${routeButton(d ? '核对输入' : '准备数据', 'data', 'text-button')}</div>`;
}
