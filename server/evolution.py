"""Governed local planning-policy improvement, distinct from model training.

Only user-consented, completed runs are replayed. The evaluation measures capability
coverage against HUMAN requirements and real local calculations; it does not measure
LLM truthfulness, profitability, or remote-provider performance. Activation is explicit.
"""
from __future__ import annotations
import copy
from datetime import date
from .store import digest, encode, now
from .security import fail
from .autonomy import compile_graph, strategy, node, validate_graph
from .autonomy_contracts import ExecutionOptions
from .analytics import quality_report, forecast_baselines, extended_scenario
from .models import calculate
from . import workspace_store as ws


def assessment(store, user, run_id, body):
    run = store.owned('runs', user['id'], run_id)
    if not run: fail('NOT_FOUND', '运行不存在或无权限', 404)
    if not run['result']: fail('NO_REPORT', '只有产生实际报告的任务才能用于复盘', 409)
    if body.consent_replay and not body.expected_capabilities:
        fail('MISSING_RUBRIC', '加入回放前须明确至少一个预期能力，不能让系统自行给自己评分', 422)
    payload = body.model_dump(mode='json', exclude={'version'})
    payload.update({'run_id': run_id, 'snapshot_hash': digest(run['snapshot']),
                    'result_hash': digest(run['result']), 'dataset_hash': run['snapshot']['dataset_hash']})
    with store.transaction() as db:
        return ws.save(store, db, user['id'], 'assessment', payload, key=run_id, expected=body.version)


def cases(store, user_id):
    rows = []
    for a in ws.objects(store, user_id, 'assessment', 1000):
        if not a['payload']['consent_replay']: continue
        run = store.owned('runs', user_id, a['payload']['run_id'])
        if not run or not run['result']: continue
        if digest(run['snapshot']) != a['payload']['snapshot_hash'] or digest(run['result']) != a['payload']['result_hash']:continue
        rows.append((a, run))
    return rows


def binding(a, run):
    return {'assessment_id': a['id'], 'assessment_version': a['version'], 'run_id': run['id'],
            'snapshot_hash': digest(run['snapshot']), 'result_hash': digest(run['result'])}


def replay(run, rubric, spec):
    s = copy.deepcopy(run['snapshot']); original = s.get('studio', {})
    ex = copy.deepcopy(original.get('execution') or ExecutionOptions().model_dump())
    # Policy affects only planning defaults. It never alters financial inputs/thresholds.
    # Preserve explicitly selected depth: replay must match the production compiler.
    r = {**run['payload'], 'execution': ex, 'max_calls': 0, 'use_llm': False}
    payload = {'request': r, 'snapshot': s}
    graph = compile_graph(payload, policy=spec)
    q = quality_report(s['dataset'], today=date.fromisoformat(run['result']['quality'].get('as_of', date.today().isoformat())))
    if ex['local_recovery'] and q['field_coverage']['missing'] and not any(n['id']=='gaps' for n in graph['nodes']):
        graph['nodes'].append(node('gaps', ['quality']))
        next(n for n in graph['nodes'] if n['id']=='context')['depends_on'].append('gaps')
    validate_graph(graph['nodes'])
    caps = {n['capability'] for n in graph['nodes'] if n['enabled']}
    expected = set(rubric)
    maths = calculate(s['dataset'], r.get('comparison', 'year_over_year'))
    math_hash = digest(maths)
    computations = {'quant': {'hash': math_hash}, 'quality': {'hash': digest(q)}}
    if 'forecast' in caps:
        try:computations['forecast'] = forecast_baselines(s['dataset'], ex['forecast_metric'], ex['horizon'], today=date.fromisoformat(q['as_of']))
        except ValueError as exc:
            computations['forecast'] = {'status':'blocked','reason':str(exc)}
            caps.discard('forecast')
    if 'sensitivity' in caps and ex['scenario']:
        a = ex['scenario']; computations['sensitivity'] = extended_scenario(s['dataset'], a['price_change'], a['cost_change'], a['volume_change'], a['fixed_cost_share'])
    return {'covered': sorted(caps & expected), 'missing': sorted(expected - caps),
            'recall': len(caps & expected) / len(expected) if expected else 0,
            'node_count': len(graph['nodes']), 'math_hash': math_hash,
            'computation_hash': digest(computations), 'external_calls': 0, 'capabilities': sorted(caps)}


def input_signature(run):
    d=run['snapshot']['dataset']
    return digest({k:d.get(k) for k in ('currency','amount_unit','volume_unit','period_basis','periods')})


def evaluate(store, user, candidate_id):
    candidate = ws.get(store, user['id'], 'strategy', candidate_id)
    baseline, active_version = strategy(store, user['id'])
    available = cases(store, user['id'])
    # Deduplicate by financial input content, not the number of duplicated report runs.
    grouped = {}
    for a, run in sorted(available, key=lambda p:p[0]['updated_at']):
        grouped[input_signature(run)] = (a, run)
    groups = sorted(grouped)
    holdout = set(groups[-max(1, len(groups)//3):]) if groups else set()
    results = []; bindings = []
    for key in groups:
        a, run = grouped[key]; rubric = a['payload']['expected_capabilities']
        b = replay(run, rubric, baseline); c = replay(run, rubric, candidate['payload'])
        results.append({'run_id': run['id'], 'dataset_hash': key, 'partition': 'holdout' if key in holdout else 'development',
                        'expected': rubric, 'baseline': b, 'candidate': c})
        bindings.append(binding(a, run))
    regressions = [r['run_id'] for r in results if r['candidate']['recall'] < r['baseline']['recall'] or r['candidate']['math_hash'] != r['baseline']['math_hash']]
    improvements = [r['run_id'] for r in results if r['candidate']['recall'] > r['baseline']['recall'] or
                    (r['candidate']['recall'] == r['baseline']['recall'] and r['candidate']['node_count'] < r['baseline']['node_count'])]
    reasons = []
    if len(groups)<3: reasons.append('至少需要3份不同财务输入且明确授权的已完成人工验收案例')
    if regressions: reasons.append('存在人工需求覆盖或数学结果回归')
    if not improvements: reasons.append('未观察到需求覆盖改善或相同覆盖下的节点减少')
    if results and any(r['candidate']['missing'] for r in results if r['partition']=='holdout'):
        reasons.append('保留组仍有未覆盖的人工预期能力')
    p = {'candidate_id': candidate_id, 'candidate_version': candidate['version'], 'candidate_hash': digest(candidate['payload']),
         'baseline': baseline, 'active_version': active_version, 'case_bindings': bindings, 'cases': results,
         'unique_inputs': len(groups), 'raw_consented_runs': len(available), 'regressions': regressions, 'improvements': improvements,
         'eligible': not reasons, 'blockers': reasons, 'external_calls': 0, 'evaluated_at': now(),
         'scope': '人工标注需求的本地规划覆盖与数学结果不变性；不是模型准确率、真实收益或生产性能',
         'holdout_notice': '按输入内容分组的确定性保留组，不能作为独立外部验证数据集'}
    with store.transaction() as db:
        return ws.save(store, db, user['id'], 'strategy_evaluation', p)


def activate(store, user, candidate_id, body):
    with store.transaction() as db:
        candidate = ws.get(store, user['id'], 'strategy', candidate_id)
        report = ws.get(store, user['id'], 'strategy_evaluation', body.evaluation_id)['payload']
        current = ws.keyed(store, user['id'], 'strategy_active', 'active')
        version = current['version'] if current else 0
        if version != body.expected_active_version or report['active_version'] != version:
            fail('VERSION_CONFLICT', '当前策略或评估基线已变化，请重新回放', 409)
        if report['candidate_id'] != candidate_id or report['candidate_version'] != candidate['version'] or report['candidate_hash'] != digest(candidate['payload']):
            fail('EVALUATION_STALE', '候选与评估不一致', 409)
        if not report['eligible']: fail('EVALUATION_BLOCKED', '候选没有通过本地评估门槛', 409)
        grouped={}
        for a,r in sorted(cases(store,user['id']),key=lambda p:p[0]['updated_at']):grouped[input_signature(r)]=(a,r)
        live = {a['id']: binding(a,r) for a,r in grouped.values()}
        if set(live)!={b['assessment_id'] for b in report['case_bindings']} or any(live.get(b['assessment_id']) != b for b in report['case_bindings']):
            fail('EVALUATION_STALE', '验收记录、授权或输入已经变化，须重新回放', 409)
        old = current['payload'] if current else {'spec': None, 'candidate_id': None, 'history': []}
        history = [*old.get('history', []), {'spec': old.get('spec'), 'candidate_id': old.get('candidate_id')}][-20:]
        p = {'spec': candidate['payload'], 'candidate_id': candidate_id, 'evaluation_id': body.evaluation_id,
             'history': history, 'activated_at': now(), 'scope': '仅影响之后创建的计划，不修改历史报告、模型权重或程序'}
        row = ws.save(store, db, user['id'], 'strategy_active', p, key='active', expected=version)
        store.audit(db, user['id'], 'strategy', candidate_id, 'activated', {'evaluation_id': body.evaluation_id})
        return row


def rollback(store, user, body):
    with store.transaction() as db:
        current = ws.keyed(store, user['id'], 'strategy_active', 'active')
        if not current or current['version'] != body.expected_active_version:fail('VERSION_CONFLICT','策略版本不一致',409)
        history = current['payload'].get('history', [])
        if not history:fail('NO_ROLLBACK','没有可恢复的前一策略',409)
        previous = history[-1]
        p = {**previous, 'history': history[:-1], 'activated_at': now(), 'evaluation_id': None, 'scope':'显式恢复此前本地规划策略'}
        return ws.save(store, db, user['id'], 'strategy_active', p, key='active', expected=current['version'])


def overview(store, user_id):
    rows = store.all('SELECT id,state,result FROM runs WHERE user_id=? ORDER BY updated_at DESC LIMIT 200', (user_id,))
    counts = {}
    for r in rows:counts[r['state']] = counts.get(r['state'], 0) + 1
    rejects = sum((r['result'] or {}).get('llm',{}).get('review',{}).get('rejected_claims',0) for r in rows)
    active=ws.keyed(store,user_id,'strategy_active','active')
    return {'active':active,'candidates':ws.objects(store,user_id,'strategy'),'evaluations':ws.objects(store,user_id,'strategy_evaluation',50),
        'assessments':ws.objects(store,user_id,'assessment',200),
        'observations':{'observed_runs':len(rows),'states':counts,'structural_rejections':rejects,
                        'consented_cases':len(cases(store,user_id)),'automatic_model_updates':0},
        'suggestion':{'name':'加强反证与缺口复核','depth':'balanced','require_counterevidence':True,'require_gap_analysis':True,
                      'note':'候选要求显式覆盖反向证据与数据缺口；必须先与当前策略做有人工标签的本地回放比较'},
        'scope':'仅有受治理的本地策略改进，不自动训练模型或修改生产代码'}


def propose_from_assessments(store, user):
    """Derive and replay a candidate from consented HUMAN omissions, not model scores."""
    available=cases(store,user['id'])
    if not available:fail('NO_CONSENTED_CASES','先在实际报告上记录预期能力并明确同意本地回放',409)
    current,_=strategy(store,user['id'])
    base=copy.deepcopy(current) if current else {'name':'当前内置策略','depth':'balanced','require_counterevidence':False,'require_gap_analysis':False,'note':'默认目标驱动策略'}
    gaps={};references=[]
    for a,run in available:
        result=replay(run,a['payload']['expected_capabilities'],current)
        for capability in result['missing']:gaps[capability]=gaps.get(capability,0)+1
        if result['missing']:references.append({'assessment_id':a['id'],'run_id':run['id'],'missing':result['missing']})
    adjustable=set(gaps)&{'counterevidence','gaps'}
    if not adjustable:fail('NO_SUPPORTED_IMPROVEMENT','没有发现可由当前策略合同修复的人工标注缺口；不会制造改善分数或扩大能力权限',409)
    base.update({'name':'验收驱动 · '+('反向证据' if 'counterevidence' in adjustable else '')+('与缺口核查' if 'gaps' in adjustable else ''),
        'require_counterevidence':base['require_counterevidence'] or 'counterevidence' in adjustable,
        'require_gap_analysis':base['require_gap_analysis'] or 'gaps' in adjustable,
        'note':'根据已授权的人工验收缺口建立候选。缺口计数：'+ '；'.join(k+'='+str(v) for k,v in sorted(gaps.items()))+'。不能保证模型事实正确，激活需再次明确确认。'})
    with store.transaction() as db:
        row=ws.save(store,db,user['id'],'strategy',base)
        store.audit(db,user['id'],'strategy',row['id'],'assessment_driven_candidate',{'source_assessments':references,'unsupported_gaps':sorted(set(gaps)-adjustable)})
    evaluation=evaluate(store,user,row['id'])
    return {'candidate':row,'evaluation':evaluation,'sources':references,'automatic_activation':False,'external_calls':0}
