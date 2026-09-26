export const state = {
    user: null, caps: null, identities: [], identity: '', datasets: [], active: '', brief: null, route: 'brief', id: '', cache: {}, query: '', dirty: false, busy: false, cursor: 0
};
export function activeDataset() { return state.datasets.find(d => d.id === state.active) ?? null; }
export const roleNames = { enterprise: '企业经营', investor: '投资研究', analyst: '财务分析', advisor: '顾问服务' };
export const routes = {
    brief: { label: '我的工作', icon: 'overview', section: '工作空间' },
    copilot: { label: '研究助手', icon: 'spark', section: '工作空间' },
    agents: { label: 'Agent 协同', icon: 'network', section: '核心能力' },
    lab: { label: '数学建模', icon: 'sliders', section: '核心能力' },
    evolution: { label: '策略演进', icon: 'activity', section: '核心能力' },
    data: { label: '经营数据', icon: 'database', section: '研究资产' },
    evidence: { label: '证据资料', icon: 'files', section: '研究资产' },
    compare: { label: '企业对照', icon: 'compare', section: '研究资产' },
    reports: { label: '研判报告', icon: 'report', section: '研究资产' },
    tracking: { label: '主动跟踪', icon: 'clock', section: '跟进与服务' },
    actions: { label: '跟进行动', icon: 'check', section: '跟进与服务' },
    memory: { label: '长期记忆', icon: 'memory', section: '跟进与服务' },
    services: { label: '身份与连接', icon: 'lock', section: '管理' },
    ops: { label: '执行记录', icon: 'activity', section: '管理' },
    settings: { label: '偏好设置', icon: 'settings', section: '管理' }
};
export function activeIdentity() { return state.identities.find(x => x.id === state.identity) ?? null; }
export function scopedDatasets() { const ids = activeIdentity()?.payload.dataset_ids ?? []; return ids.length ? state.datasets.filter(x => ids.includes(x.id)) : state.datasets; }
