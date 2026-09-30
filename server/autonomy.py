"""Capability compiler and persistent control. No LLM may add tools or enlarge consent."""
from __future__ import annotations
from .store import now, encode
from .security import fail
from . import workspace_store as ws

CAPABILITIES = {
    'quality': ('数据核验', '口径、时效、异常与缺失项检查', 'deterministic'),
    'quant': ('量化建模', '唯一计算源、指标贡献与输入血缘', 'deterministic'),
    'evidence': ('证据检索', '冻结且已披露的企业作用域证据', 'lexical'),
    'counterevidence': ('反向证据对照', '对照人工标注的支持与反向资料，不冒充语义认证', 'deterministic'),
    'gaps': ('缺口补全规划', '将无法计算的字段转成具体待补清单，不填假值', 'deterministic'),
    'forecast': ('序列回测', '相同验证折比较透明基线；样本不足则停止预测', 'deterministic'),
    'sensitivity': ('情景建模', '仅使用明确批准的价格、成本、销量与成本结构假设', 'deterministic'),
    'context': ('上下文装配', '完整条目预算、来源隔离与最小披露', 'deterministic'),
    'planner': ('任务规划专家', '在已批准能力集合内提出分工建议，不能新增权限', 'optional_llm'),
    'analyst': ('经营研究员', '指标与业务解释假设', 'optional_llm'),
    'researcher': ('证据研究员', '外部资料的适用性、时效和反向信息', 'optional_llm'),
    'challenger': ('反证审阅员', '检查前序解释的替代原因及不能推出的结论', 'optional_llm'),
    'revision': ('解释修订者', '根据结构复核反馈做有限修订，不接纳未知引用', 'optional_llm'),
    'review': ('证据门禁', '验证输出合同、数值和实际发送引用', 'deterministic'),
    'reflection': ('执行复盘', '实测调用、异常、覆盖和未达成条件；不修改模型权重', 'deterministic'),
    'report': ('报告归档', '输入、节点和结论一一对应，冻结归档', 'deterministic'),
}
REQUIRED = {'quality', 'quant', 'evidence', 'context', 'review', 'reflection', 'report'}
MODEL_CAPS = {'planner', 'analyst', 'researcher', 'challenger', 'revision'}
REPLAY_CAPABILITIES = {'quality', 'quant', 'evidence', 'counterevidence', 'gaps', 'forecast', 'sensitivity'}


def execute_local_capability(capability, snapshot, request, execution, outputs, *, today=None):
    """The same read-only operations serve production execution and local replay."""
    from .analytics import quality_report, forecast_baselines, extended_scenario
    from .models import calculate
    data = snapshot['dataset']
    if capability == 'quality':
        return quality_report(data, today=today)
    if capability == 'quant':
        return calculate(data, request.get('comparison', 'year_over_year'))
    if capability == 'evidence':
        return {'items': snapshot['citations'], 'source': 'frozen_approved_scope',
                'status': 'completed' if snapshot['citations'] else 'missing'}
    if capability == 'counterevidence':
        groups = {'supports': [], 'contradicts': [], 'context': []}
        for citation in snapshot['citations']:
            groups.get(citation.get('stance', 'context'), groups['context']).append(citation['id'])
        return {'groups': groups, 'conflicting_labels': bool(groups['supports'] and groups['contradicts']),
                'status': 'completed' if snapshot['citations'] else 'missing',
                'limitation': '标签对照不是自动语义矛盾检测'}
    if capability == 'gaps':
        quality = outputs['quality']; missing = quality['field_coverage']['missing']
        return {'items': [{'field': key, 'action': '补充同口径的原始报表字段并保存新修订', 'auto_imputed': False} for key in missing],
                'findings': quality['findings'], 'status': 'needs_input' if missing else 'completed'}
    if capability == 'forecast':
        try:
            out = forecast_baselines(data, execution['forecast_metric'], execution['horizon'], today=today)
            return {**out, 'status': out.get('status', 'completed')}
        except ValueError as exc:
            return {'status': 'blocked', 'error_class': 'ValueError', 'reason': str(exc)}
    if capability == 'sensitivity':
        assumptions = execution['scenario']
        if not assumptions:
            return {'status': 'blocked', 'reason': '没有授权情景假设，拒绝生成'}
        try:
            result = extended_scenario(data, assumptions['price_change'], assumptions['cost_change'],
                                      assumptions['volume_change'], assumptions['fixed_cost_share'])
            return {**result, 'approved_assumptions': assumptions, 'status': 'completed'}
        except ValueError as exc:
            return {'status': 'blocked', 'error_class': 'ValueError', 'reason': str(exc)}
    raise ValueError('UNKNOWN_LOCAL_CAPABILITY')


def migrate(store):
    with store.transaction() as db:
        db.execute('CREATE TABLE IF NOT EXISTS adaptive_schema(version INTEGER PRIMARY KEY)')
        v = db.execute('SELECT max(version) FROM adaptive_schema').fetchone()[0]
        if v and v > 1:
            raise RuntimeError('自主编排数据库版本高于程序，拒绝降级写入')
        db.execute('''CREATE TABLE IF NOT EXISTS adaptive_controls(
            run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL)''')
        db.execute('''CREATE TABLE IF NOT EXISTS adaptive_graphs(
            run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL)''')
        db.execute('''CREATE TABLE IF NOT EXISTS adaptive_checkpoints(
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            node_id TEXT NOT NULL, capability TEXT NOT NULL, state TEXT NOT NULL,
            input_hash TEXT NOT NULL, artifact_id TEXT, started_at TEXT NOT NULL,
            finished_at TEXT, PRIMARY KEY(run_id,node_id))''')
        db.execute('''CREATE TABLE IF NOT EXISTS adaptive_calls(
            id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            node_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
            state TEXT NOT NULL, characters INTEGER NOT NULL, payload TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')
        db.execute('CREATE INDEX IF NOT EXISTS adaptive_calls_run ON adaptive_calls(run_id,created_at)')
        db.execute('INSERT OR IGNORE INTO adaptive_schema VALUES(1)')


def strategy(store, user_id):
    active = ws.keyed(store, user_id, 'strategy_active', 'active')
    return (active['payload'].get('spec') if active else None), (active['version'] if active else 0)


def node(capability, dependencies=(), *, id=None, enabled=True, reason=''):
    if capability not in CAPABILITIES:
        raise ValueError('未知能力')
    name, purpose, engine = CAPABILITIES[capability]
    return {'id': id or capability, 'capability': capability, 'name': name,
            'purpose': purpose, 'engine': engine, 'tools': [] if engine == 'optional_llm' else [capability],
            'depends_on': list(dependencies), 'enabled': enabled,
            'reason': reason, 'skip_reason': None if enabled else reason or '本次任务不需要该能力'}


def validate_graph(nodes, max_nodes=24, *, require_mandatory=False):
    """Reject duplicate/cyclic/unknown capabilities before any execution or side effect."""
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= max_nodes:
        raise ValueError('节点数量超出边界')
    if any(not isinstance(n, dict) for n in nodes):
        raise ValueError('节点必须是声明式能力对象')
    ids = [n.get('id') for n in nodes]
    if any(not isinstance(x, str) for x in ids):
        raise ValueError('无效的节点标识')
    if len(ids) != len(set(ids)) or any(not isinstance(x, str) or not x or len(x) > 60 for x in ids):
        raise ValueError('重复或无效的节点标识')
    for n in nodes:
        if n.get('capability', n['id']) not in CAPABILITIES:
            raise ValueError('未登记的工具或专家')
        deps = n.get('depends_on', [])
        if not isinstance(deps, list) or any(not isinstance(d, str) for d in deps):
            raise ValueError('依赖必须为节点标识列表')
        if len(deps) != len(set(deps)) or any(d not in ids or d == n['id'] for d in deps):
            raise ValueError('依赖缺失或自环')
    if require_mandatory:
        by_id = {n['id']: n for n in nodes}
        if any(cap not in by_id or by_id[cap].get('capability') != cap or not by_id[cap].get('enabled', True) for cap in REQUIRED):
            raise ValueError('执行图不得移除或跳过强制核验与归档能力')
    left = {n['id']: set(n.get('depends_on', [])) for n in nodes}
    layers = []
    while left:
        ready = sorted(k for k, v in left.items() if not v)
        if not ready:
            raise ValueError('执行图存在环')
        layers.append(ready)
        for k in ready:
            left.pop(k)
        for deps in left.values():
            deps.difference_update(ready)
    return layers


def compile_graph(payload, *, policy=None):
    r = payload['request']; s = payload['snapshot']; ex = r['execution']
    depth = ex.get('depth') or (policy['depth'] if policy else 'balanced')
    q = r['query'].lower(); decisions = []
    forecast = ex['forecast'] or any(w in q for w in ('预测', '趋势回测', 'forecast'))
    scenario = ex['scenario'] is not None
    counter = depth == 'deep' or r['mode'] in ('industry', 'investment', 'deep_dive') or any(w in q for w in ('反证', '反向', '不同解释', '矛盾')) or bool(policy and policy.get('require_counterevidence'))
    gaps = depth == 'deep' or bool(policy and policy.get('require_gap_analysis'))
    for cap, selected, reason in [
        ('forecast', forecast, '明确预测开关或问题中的预测意图；执行时仍须通过样本门槛'),
        ('sensitivity', scenario, '仅在已填写并批准情景假设时启用'),
        ('counterevidence', counter, '研究方向、反向证据意图或已激活策略要求'),
        ('gaps', gaps, '研究深度或已激活策略要求；运行中也可根据数据缺失追加')]:
        decisions.append({'capability': cap, 'selected': selected, 'reason': reason})
    nodes = [node('quality', reason='所有结论的输入门槛'), node('quant', ['quality']), node('evidence', ['quality'])]
    for cap, selected, deps in [('forecast', forecast, ['quality']), ('sensitivity', scenario, ['quality']),
                                ('counterevidence', counter, ['evidence']), ('gaps', gaps, ['quality'])]:
        if selected:
            nodes.append(node(cap, deps, reason=next(d['reason'] for d in decisions if d['capability'] == cap)))
    nodes.append(node('context', [n['id'] for n in nodes if n['id'] != 'quality']))
    calls = []; remaining = r['max_calls'] if r['use_llm'] else 0
    if r['use_llm'] and ex['model_planning'] and remaining:
        nodes.append(node('planner', ['context'], reason='模型建议只能在授权能力集合内改变后续分工'))
        calls.append('planner'); remaining -= 1
    roles = []
    if remaining:
        roles.append('analyst'); remaining -= 1
    if remaining:
        roles.append('challenger'); remaining -= 1
    if remaining and s['citations'] and (depth == 'deep' or r['mode'] in ('industry', 'investment', 'deep_dive')):
        roles.insert(1, 'researcher'); remaining -= 1
    for cap in roles:
        deps = ['context'] + (['planner'] if 'planner' in calls else [])
        if cap == 'challenger':
            deps += [c for c in roles if c != 'challenger']
        nodes.append(node(cap, deps, reason='按研究职责与剩余调用预算选择')); calls.append(cap)
    nodes.append(node('review', ['quant', 'evidence', *calls] if calls else ['context']))
    nodes.append(node('reflection', ['review']))
    nodes.append(node('report', ['reflection']))
    validate_graph(nodes, require_mandatory=True)
    return {'nodes': nodes, 'decisions': decisions, 'call_ids': calls,
            'reserved_calls': max(0, r['max_calls'] - len(calls)) if r['use_llm'] else 0,
            'revision_limit': ex['max_revisions'], 'depth': depth,
            'allowed_dynamic': ['gaps', 'counterevidence', 'forecast', 'revision', 'registered_specialist_dependencies'],
            'strategy_basis': 'approved_local_policy' if policy else 'built_in_rules',
            'planner_kind': 'bounded_model_and_rules' if 'planner' in calls else 'deterministic_adaptive'}


def attach_plan(store, user, payload, providers):
    from .connections import provider_binding
    if not payload['request'].get('execution'):
        return
    policy, active_version = strategy(store, user['id'])
    graph = compile_graph(payload, policy=policy)
    ex = payload['request']['execution']; r = payload['request']
    selections = {}
    if r['use_llm']:
        default = providers.select(r['provider'])
        for role in MODEL_CAPS:
            target = providers.select(ex['role_providers'].get(role, r['provider']))
            if target:
                selections[role] = {**provider_binding(target), 'host': target.host, 'path': target.path}
            elif role in graph['call_ids'] or role in ex['role_providers']:
                payload['blockers'].append(f'{role} 所选模型没有配置，不能模拟执行')
        fallbacks = []
        for id in ex['fallback_providers']:
            p = providers.select(id)
            if not p:
                payload['blockers'].append(f'候补模型 {id} 未配置')
            else:
                fallbacks.append({**provider_binding(p), 'host':p.host, 'path':p.path})
        # Default provider is already checked by the legacy binding path.
        if not default:
            payload['blockers'].append('默认模型未配置')
    else:
        fallbacks = []
    graph['provider_bindings'] = selections
    graph['fallback_bindings'] = fallbacks
    graph['active_strategy_version'] = active_version
    graph['policy'] = policy
    graph['envelope'] = {'max_calls': r['max_calls'] if r['use_llm'] else 0,
                         'total_context_chars': ex['total_context_chars'],
                         'parallelism': ex['parallelism'], 'max_revisions': ex['max_revisions'],
                         'can_write_business_data': False, 'can_execute_code': False,
                         'external_search': False, 'unknown_call_retry': False,
                         'local_recovery': ex['local_recovery'],
                         'read_only_model_tools':['forecast','gaps','counterevidence'],
                         'specialist_routing':['analyst','researcher','challenger'],
                         'scenario_requires_explicit_assumptions':True}
    payload['adaptive'] = graph
    payload['nodes'] = graph['nodes']
    payload['call_ids'] = graph['call_ids']
    payload['max_calls'] = graph['envelope']['max_calls']
    payload['bindings']['active_strategy_version'] = active_version
    if ex['scenario']:
        payload['consent_scope'].append('明确填写的情景建模假设') if r['use_llm'] else None


def validate_extra_bindings(store, user, p, providers):
    a = p.get('adaptive')
    if not a:
        return
    if strategy(store, user['id'])[1] != a['active_strategy_version']:
        fail('PLAN_STALE', '编排策略已改变，请重新预览', 409)
    for b in [*a['provider_bindings'].values(), *a['fallback_bindings']]:
        live = providers.select(b['id'])
        if not live or any(getattr(live, k) != b[k] for k in ('id', 'model', 'host', 'path')) or (live and b.get('configuration_version')!=getattr(live,'configuration_version',None)):
            fail('PROVIDER_CHANGED', '分工模型或候补连接已变化，请重新授权', 409)


def initialize_run(store, db, run_id, user_id, adaptive):
    db.execute('INSERT INTO adaptive_controls VALUES(?,?,?,?,?)', (run_id, user_id, 'active', 1, now()))
    db.execute('INSERT INTO adaptive_graphs VALUES(?,?,?,?,?)', (run_id, user_id, encode(adaptive), 1, now()))


def runtime_view(store, user_id, run_id):
    run = store.owned('runs', user_id, run_id)
    if not run:
        fail('NOT_FOUND', '运行不存在或无访问权限', 404)
    control = store.one('SELECT * FROM adaptive_controls WHERE run_id=? AND user_id=?', (run_id, user_id))
    if not control:
        fail('LEGACY_RUN', '此运行来自旧执行器，不支持断点控制；仍可查看原报告', 409)
    graph = store.one('SELECT * FROM adaptive_graphs WHERE run_id=?', (run_id,))
    calls = store.all('SELECT * FROM adaptive_calls WHERE run_id=? ORDER BY created_at,id', (run_id,))
    checkpoints = store.all('SELECT * FROM adaptive_checkpoints WHERE run_id=? ORDER BY started_at,node_id', (run_id,))
    state = control['status'] if control['status'] in ('pause_requested', 'paused') and run['state'] not in ('succeeded','degraded','cancelled','failed') else run['state']
    return {'control': control, 'state': state, 'run_state': run['state'], 'graph': graph,
            'checkpoints': checkpoints, 'calls': calls,
            'usage': {'attempts': len(calls), 'characters': sum(c['characters'] for c in calls),
                      'tokens': sum(c['payload'].get('usage', {}).get('total_tokens', 0) for c in calls),
                      'tokens_complete': all('total_tokens' in c['payload'].get('usage', {}) for c in calls) if calls else True},
            'checkpoint_guarantee': '复用哈希一致的已完成节点；未知外部调用不自动重发'}


def control_run(store, user, run_id, body, queue_limit=6):
    with store.transaction() as db:
        r = store.owned('runs', user['id'], run_id)
        if not r:
            fail('NOT_FOUND', '运行不存在或无访问权限', 404)
        c = store.one('SELECT * FROM adaptive_controls WHERE run_id=? AND user_id=?', (run_id, user['id']))
        if not c:
            fail('LEGACY_RUN', '旧运行不支持断点控制', 409)
        if c['version'] != body.version:
            fail('VERSION_CONFLICT', '控制状态已改变，请刷新后操作', 409)
        if r['state'] in ('succeeded', 'degraded', 'failed', 'cancelled'):
            fail('RUN_TERMINAL', '任务已结束，不重新执行已付费步骤', 409)
        if body.action == 'pause':
            if c['status'] in ('pause_requested', 'paused'):
                return c
            status = 'paused' if r['state'] in ('queued', 'interrupted') else 'pause_requested'
            if status == 'paused':
                db.execute("UPDATE runs SET state='interrupted',error=?,updated_at=? WHERE id=?", ('已在执行边界暂停；可以显式继续', now(), run_id))
        else:
            if r['state'] != 'interrupted':
                fail('NOT_PAUSED', '等待当前步骤到达安全边界后再继续', 409)
            pending = db.execute("SELECT count(*) FROM runs WHERE user_id=? AND state IN ('queued','running')", (user['id'],)).fetchone()[0]
            if pending >= queue_limit:
                fail('QUEUE_FULL', '队列已满，请先整理正在运行的任务', 429)
            status = 'active'
            db.execute("UPDATE runs SET state='queued',error=NULL,updated_at=? WHERE id=?", (now(), run_id))
        db.execute('UPDATE adaptive_controls SET status=?,version=version+1,updated_at=? WHERE run_id=?', (status, now(), run_id))
        store.event(db, run_id, 'control_' + body.action, {'status': status, 'note': '已发出远端请求不能撤回；继续不重复未知外部调用'})
        store.audit(db, user['id'], 'runs', run_id, 'control_' + body.action)
    return store.one('SELECT * FROM adaptive_controls WHERE run_id=?', (run_id,))
