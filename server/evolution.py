"""Governed local planning-policy improvement, distinct from model training.

Only user-consented, completed runs are replayed. The evaluation measures capability
coverage against HUMAN requirements and real local calculations; it does not measure
LLM truthfulness, profitability, or remote-provider performance. Activation is explicit.
"""
from __future__ import annotations
import copy
from datetime import date
from .store import digest, encode, now
from .security import fail, check_version
from .autonomy import compile_graph, strategy, node, validate_graph, REPLAY_CAPABILITIES, execute_local_capability
from .autonomy_contracts import ExecutionOptions
from .models import MODEL_VERSION
from .report_integrity import inspect_report_integrity
from . import workspace_store as ws

REPLAY_VERSION = 'local-capability-replay-v5'
COMPLETED_STATES = {'succeeded', 'degraded'}



def review_context(store,user_id,run_id):
    rows=store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='claim_review' AND json_extract(payload,'$.run_id')=? ORDER BY id",(user_id,run_id))
    actions=store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='action' AND (json_extract(payload,'$.run_id')=? OR json_extract(payload,'$.provenance.run_id')=?) ORDER BY id",(user_id,run_id,run_id))
    bindings=[{'kind':'claim_review','id':r['id'],'version':r['version'],'hash':digest(r['payload'])} for r in rows]
    bindings.extend({'kind':'action','id':r['id'],'version':r['version'],'hash':digest(r['payload'])} for r in actions)
    feedback=[]
    for action in actions:
        p=action['payload'];last=(p.get('history') or [{}])[-1]
        feedback.append({'id':action['id'],'version':action['version'],'title':p['title'],'status':p['status'],
            'acceptance':p['acceptance'],'latest_record':{k:last.get(k) for k in ('at','status','note')},
            'evidence':[{'id':e['id'],'version':e['version'],'content_hash':e['content_hash'],'review_version':e['review_version']} for e in last.get('evidence_snapshots',[])]})
    return {'hash':digest(bindings),'bindings':bindings,'items':rows,'related_actions':feedback,
            'disputed':sum(r['payload']['verdict']!='accepted' for r in rows)}


def assessment_context(store,user_id,row):
    context=review_context(store,user_id,row['payload']['run_id'])
    saved=row['payload'].get('feedback_context_hash',row['payload'].get('claim_review_hash',digest([])))
    return {**row,'feedback_context':{'current_hash':context['hash'],'saved_hash':saved,
        'state':'current' if saved==context['hash'] else 'changed','disputed':context['disputed'],
        'message':'解释复核或关联行动反馈已变化，请重新查看并确认回放授权' if saved!=context['hash'] else '回放仅核对能力覆盖，不替代对模型解释的人工复核'}}


def assessment(store, user, run_id, body):
    if body.consent_replay and not body.expected_capabilities:
        fail('MISSING_RUBRIC', '加入回放前须明确至少一个预期能力，不能让系统自行给自己评分', 422)
    with store.transaction() as db:
        run = store.owned('runs', user['id'], run_id)
        if not run: fail('NOT_FOUND', '运行不存在或无权限', 404)
        existing = ws.keyed(store, user['id'], 'assessment', run_id)
        withdrawing = not body.consent_replay and existing is not None
        if (run['state'] not in COMPLETED_STATES or not run['result']) and not withdrawing:
            fail('NO_REPORT', '只有已完成且产生实际报告的任务才能用于复盘', 409)
        if body.consent_replay and not inspect_report_integrity(store, run)['report_integrity']['valid']:
            fail('REPORT_INTEGRITY', '报告的冻结产物、事件或输入快照校验失败，不能授权本地策略回放', 409)
        reviews=review_context(store,user['id'],run_id)
        if body.consent_replay and (reviews['items'] or reviews['related_actions']) and body.review_context_hash!=reviews['hash']:
            fail('REVIEW_CONTEXT_CHANGED','解释复核或关联行动反馈已变化，请查看当前意见并重新确认回放授权',409)
        payload = body.model_dump(mode='json', exclude={'version','review_context_hash'})
        # Withdrawal must remain possible even if the saved report is damaged.
        # Preserve its previously assessed basis rather than certifying new hashes
        # from the corrupt content. Nonconsenting notes never become replay cases.
        source_fields = ('snapshot_hash', 'result_hash', 'dataset_hash', 'request_hash')
        source = {k: existing['payload'][k] for k in source_fields if k in existing['payload']} if withdrawing else {
            'snapshot_hash': digest(run['snapshot']), 'result_hash': digest(run['result']),
            'dataset_hash': (run['snapshot'] if isinstance(run['snapshot'], dict) else {}).get('dataset_hash'),
            'request_hash': digest(run['payload'])}
        payload.update({'run_id': run_id, **source, 'feedback_context_hash':reviews['hash'],
                        'claim_reviews':reviews['items'],'action_feedback':reviews['related_actions']})
        row = ws.save(store, db, user['id'], 'assessment', payload, key=run_id, expected=body.version)
        current_active(store, user['id'])
        return row


def current_case(store, user_id, a):
    """Share the current ownership, consent and immutable-input gate everywhere."""
    try:
        if not a or a['user_id'] != user_id or not a['payload']['consent_replay'] or not a['payload'].get('expected_capabilities'): return None
        run = store.owned('runs', user_id, a['payload']['run_id'])
        if not run or a['natural_key'] != run['id'] or run['state'] not in COMPLETED_STATES or not run['result']: return None
        if digest(run['snapshot']) != a['payload']['snapshot_hash'] or digest(run['result']) != a['payload']['result_hash']: return None
        if a['payload'].get('request_hash', digest(run['payload'])) != digest(run['payload']): return None
        if not inspect_report_integrity(store, run)['report_integrity']['valid']: return None
        if a['payload'].get('feedback_context_hash',a['payload'].get('claim_review_hash',digest([]))) != review_context(store,user_id,run['id'])['hash']: return None
        return run
    except (KeyError, TypeError, ValueError):
        return None


def cases(store, user_id):
    rows = []
    for a in ws.objects(store, user_id, 'assessment', 1000):
        run = current_case(store, user_id, a)
        if run: rows.append((a, run))
    return rows


def binding(a, run):
    return {'assessment_id': a['id'], 'assessment_version': a['version'], 'run_id': run['id'],
            'snapshot_hash': digest(run['snapshot']), 'result_hash': digest(run['result']),
            'request_hash': digest(run['payload']), 'assessment_hash': digest(a['payload'])}


def implementation_current(report):
    return report.get('replay_version') == REPLAY_VERSION and report.get('model_version') == MODEL_VERSION


def evaluation_context(row):
    current = implementation_current(row['payload'])
    return {**row, 'implementation_context': {'current': current,
            'message': '' if current else '旧规则下的历史结果，本地回放或数学实现版本已变化；须重新回放后再决定是否激活'}}


def policy_implementation_changed(store, user_id, payload):
    evaluation = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='strategy_evaluation' AND id=?",
                           (user_id, payload.get('evaluation_id')))
    return bool(evaluation and isinstance(evaluation['payload'], dict) and not implementation_current(evaluation['payload']))


def policy_context(store, user_id, payload):
    """Resolve only this policy's still-consenting, unchanged replay sources.

    New or unrelated cases do not revoke an already-approved policy. Activation
    still checks the complete current cohort; continued use and rollback must
    retain every original source, including its owner and review-context binding.
    """
    if not isinstance(payload,dict):return None
    try:
        evaluation = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='strategy_evaluation' AND id=?",
                               (user_id, payload.get('evaluation_id')))
        candidate = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='strategy' AND id=?",
                              (user_id, payload.get('candidate_id')))
        if not evaluation or not candidate or not isinstance(evaluation['payload'],dict) or not isinstance(candidate['payload'],dict): return None
        report = evaluation['payload']
        if (not report['eligible'] or report['candidate_id'] != candidate['id'] or
                report['candidate_version'] != candidate['version'] or
                report['candidate_hash'] != digest(candidate['payload']) or
                payload['spec'] != candidate['payload'] or
                report['baseline_hash'] != digest(report['baseline']) or
                not implementation_current(report)):
            return None
        saved = report['case_bindings']
        if not saved or len({b['assessment_id'] for b in saved}) != len(saved): return None
        selected = []
        for b in saved:
            a = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='assessment' AND id=?",
                          (user_id, b['assessment_id']))
            run = current_case(store, user_id, a)
            if not run or binding(a, run) != b: return None
            selected.append((a, run))
        return report, grouped_cases(selected)
    except (KeyError, TypeError, ValueError):
        # Incomplete legacy provenance and malformed evidence cannot authorize
        # future planning. Keep the original records available for inspection.
        return None


def policy_history_entry(payload):
    return {key: payload.get(key) for key in ('spec', 'candidate_id', 'evaluation_id')}


def current_active(store, user_id):
    """Fail closed and advance the binding version without rewriting reports.

    Mutations call this eagerly in their transaction. Consumption also calls it
    for legacy deletions, changed review context and other stale source records.
    """
    with store.transaction() as db:
        active = ws.keyed(store, user_id, 'strategy_active', 'active')
        if not active:
            return active
        raw = active['payload']
        if isinstance(raw,dict) and raw.get('spec') is None:return active
        old = raw if isinstance(raw,dict) else {}
        if policy_context(store, user_id, old) is not None:
            return active
        implementation_changed = policy_implementation_changed(store, user_id, old)
        reason_code = 'implementation_changed' if implementation_changed else 'source_or_consent_changed'
        reason = ('本地回放或数学实现版本已变化，旧评估不再适用；当前使用内置规划规则，恢复策略须重新评估并明确激活'
                  if implementation_changed else '回放来源、人工验收或授权已变化，或策略依据未通过完整性校验；当前使用内置规划规则，恢复策略须重新通过验证')
        invalidated_at = now()
        # Corrupt optional history must never roll back a user's consent
        # withdrawal or source deletion. Only structured entries can be reused.
        history = old.get('history')
        history = [entry for entry in history if isinstance(entry,dict)] if isinstance(history,list) else []
        payload = {'spec': None, 'candidate_id': None, 'evaluation_id': None,
                   'history': [*history, policy_history_entry(old)][-20:],
                   'invalidated_at': invalidated_at,
                   'invalidation_code': reason_code, 'invalidation_reason': reason,
                   'scope': '仅撤销之后计划的策略依据，不修改历史报告或回放证据'}
        row = ws.save(store, db, user_id, 'strategy_active', payload, key='active', expected=active['version'])
        store.audit(db, user_id, 'strategy', old.get('candidate_id') or active['id'], 'invalidated',
                    {'evaluation_id': old.get('evaluation_id'), 'reason': reason_code,
                     'active_version': row['version']})
        return row


def replay(run, rubric, spec):
    from .saved_experiments import provenance
    from .saved_comparisons import provenance as comparison_provenance
    s = copy.deepcopy(run['snapshot']); original = s.get('studio', {})
    ex = copy.deepcopy(original.get('execution') or ExecutionOptions().model_dump())
    # Policy affects only planning defaults. It never alters financial inputs/thresholds.
    # Preserve explicitly selected depth: replay must match the production compiler.
    r = {**run['payload'], 'execution': ex, 'max_calls': 0, 'use_llm': False}
    payload = {'request': r, 'snapshot': s}
    graph = compile_graph(payload, policy=spec)
    as_of = date.fromisoformat(run['result']['quality'].get('as_of', run['created_at'][:10]))
    q = execute_local_capability('quality', s, r, ex, {}, today=as_of)
    from .research_gaps import needs_gap_analysis
    quant=execute_local_capability('quant',s,r,ex,{},today=as_of)
    if ex['local_recovery'] and needs_gap_analysis(q,quant) and not any(n['id']=='gaps' for n in graph['nodes']):
        graph['nodes'].append(node('gaps', ['quality']))
        next(n for n in graph['nodes'] if n['id']=='context')['depends_on'].append('gaps')
    layers = validate_graph(graph['nodes'], require_mandatory=True)
    planned = {n['capability'] for n in graph['nodes'] if n['enabled']}
    expected = set(rubric)
    computations = {}; by_id = {n['id']: n for n in graph['nodes']}
    for layer in layers:
        for id in layer:
            capability = by_id[id]['capability']
            if by_id[id]['enabled'] and capability in REPLAY_CAPABILITIES:
                computations[capability] = execute_local_capability(capability, s, r, ex, computations, today=as_of)
    math_hash = digest(computations['quant'])
    # A declared node with unavailable data is not a completed capability. Gap
    # planning is useful precisely when it returns concrete needs_input actions.
    caps = {cap for cap, output in computations.items() if output.get('status', 'completed') == 'completed'
            or (cap == 'gaps' and output.get('status') == 'needs_input')}
    return {'covered': sorted(caps & expected), 'missing': sorted(expected - caps),
            'recall': len(caps & expected) / len(expected) if expected else 0,
            'node_count': len(graph['nodes']), 'math_hash': math_hash,
            'computation_hash': digest(computations), 'external_calls': 0, 'capabilities': sorted(caps),
            'planned_capabilities': sorted(planned), 'as_of': as_of.isoformat(),
            'experiment': provenance(s.get('experiment')),
            'comparison_provenance': comparison_provenance(s.get('comparison_artifact')),
            'comparison_hash': digest(computations['comparison']) if 'comparison' in computations else None,
            'computations': {cap: {'status': out.get('status', 'completed'), 'output_hash': digest(out),
                                   **({'reason': out.get('reason'), 'limitation': out.get('limitation'),
                                       'group_counts': {key: len(out['groups'][key]) for key in ('supports', 'contradicts', 'context')}}
                                      if cap == 'counterevidence' else {})}
                             for cap, out in computations.items()},
            'scope': '共享生产实现的本地执行与人工需求覆盖；资料不足节点不计为已完成'}


def input_signature(run):
    from .question_scope import analysis_dataset
    d=analysis_dataset(run['snapshot'])
    return digest({k:d.get(k) for k in ('currency','amount_unit','volume_unit','period_basis','periods')})


def grouped_cases(available):
    grouped = {}
    for assessment, run in sorted(available, key=lambda pair: (pair[0]['updated_at'], pair[0]['id'])):
        grouped.setdefault(input_signature(run), []).append((assessment, run))
    return grouped


def replay_cohort(grouped, baseline, candidate):
    groups = sorted(grouped)
    holdout = set(groups[-max(1, len(groups)//3):]) if groups else set()
    results = []; bindings = []
    for key in groups:
        # Grouping prevents repeated inputs inflating sample independence; it must
        # never discard another real question, scenario or human requirement.
        for a, run in grouped[key]:
            rubric = a['payload']['expected_capabilities']
            b = replay(run, rubric, baseline); c = replay(run, rubric, candidate)
            results.append({'run_id': run['id'], 'dataset_hash': key, 'partition': 'holdout' if key in holdout else 'development',
                            'source': {'query': run['payload']['query'], 'company': run['snapshot']['dataset']['company'],
                                       'target_period': run['result']['analysis'].get('current_period'),
                                       'dataset_version': run['snapshot']['dataset_version'], 'dataset_hash': run['snapshot']['dataset_hash']},
                            'expected': rubric, 'baseline': b, 'candidate': c, 'reference_math_hash': digest(run['result']['analysis']),
                            'reference_comparison_hash': digest(run['result']['adaptive']['mathematical_outputs']['comparison']) if run['snapshot'].get('comparison_artifact') else None})
            bindings.append(binding(a, run))
    regressions = [r['run_id'] for r in results if r['candidate']['recall'] < r['baseline']['recall'] or r['candidate']['math_hash'] != r['baseline']['math_hash'] or r['baseline']['math_hash'] != r['reference_math_hash']
                   or r['candidate']['comparison_hash'] != r['baseline']['comparison_hash'] or r['baseline']['comparison_hash'] != r['reference_comparison_hash']]
    improvements = [r['run_id'] for r in results if r['candidate']['recall'] > r['baseline']['recall'] or
                    (r['candidate']['recall'] == r['baseline']['recall'] and r['candidate']['node_count'] < r['baseline']['node_count'])]
    reasons = []
    if len(groups)<3: reasons.append('至少需要3份不同财务输入且明确授权的已完成人工验收案例')
    if regressions: reasons.append('存在人工需求覆盖或数学结果回归')
    if not improvements: reasons.append('未观察到需求覆盖改善或相同覆盖下的节点减少')
    if results and any(r['candidate']['missing'] for r in results if r['partition']=='holdout'):
        reasons.append('保留组仍有未覆盖的人工预期能力')
    return {'case_bindings': bindings, 'cases': results, 'scenario_cases': len(results), 'unique_inputs': len(groups),
            'regressions': regressions, 'improvements': improvements, 'eligible': not reasons, 'blockers': reasons}


def evaluate(store, user, candidate_id):
    candidate = ws.get(store, user['id'], 'strategy', candidate_id)
    baseline, active_version = strategy(store, user['id'])
    available = cases(store, user['id'])
    # Financial-input groups, not duplicated report counts, define the cohort.
    cohort = replay_cohort(grouped_cases(available), baseline, candidate['payload'])
    p = {'candidate_id': candidate_id, 'candidate_version': candidate['version'], 'candidate_hash': digest(candidate['payload']),
         'baseline': baseline, 'active_version': active_version, **cohort, 'raw_consented_runs': len(available),
         'external_calls': 0, 'evaluated_at': now(),
         'baseline_hash': digest(baseline), 'replay_version': REPLAY_VERSION, 'model_version': MODEL_VERSION,
         'scope': '人工标注需求的本地规划覆盖与数学结果不变性；不是模型准确率、真实收益或生产性能',
         'holdout_notice': '按输入内容分组的确定性保留组，不能作为独立外部验证数据集'}
    with store.transaction() as db:
        return ws.save(store, db, user['id'], 'strategy_evaluation', p)


def activate(store, user, candidate_id, body):
    with store.transaction() as db:
        candidate = ws.get(store, user['id'], 'strategy', candidate_id)
        report = ws.get(store, user['id'], 'strategy_evaluation', body.evaluation_id)['payload']
        current = current_active(store, user['id'])
        version = current['version'] if current else 0
        if version != body.expected_active_version or report['active_version'] != version:
            fail('VERSION_CONFLICT', '当前策略或评估基线已变化，请重新回放', 409)
        baseline = current['payload'].get('spec') if current else None
        if report.get('baseline_hash') != digest(baseline) or not implementation_current(report):
            fail('EVALUATION_STALE', '基线内容或本地回放实现已变化，请重新评估', 409)
        if report['candidate_id'] != candidate_id or report['candidate_version'] != candidate['version'] or report['candidate_hash'] != digest(candidate['payload']):
            fail('EVALUATION_STALE', '候选与评估不一致', 409)
        if not report['eligible']: fail('EVALUATION_BLOCKED', '候选没有通过本地评估门槛', 409)
        grouped=grouped_cases(cases(store,user['id']))
        live = {a['id']: binding(a,r) for group in grouped.values() for a,r in group}
        if set(live)!={b['assessment_id'] for b in report['case_bindings']} or any(live.get(b['assessment_id']) != b for b in report['case_bindings']):
            fail('EVALUATION_STALE', '验收记录、授权或输入已经变化，须重新回放', 409)
        # Confirmation never trusts a stored eligibility bit. Execute the bounded
        # local cohort again under the same lock before activating a future policy.
        verified = replay_cohort(grouped, baseline, candidate['payload'])
        if not verified['eligible']:
            fail('EVALUATION_BLOCKED', '当前案例未通过重新执行的基线与候选门槛', 409)
        if any(report.get(key) != value for key, value in verified.items()):
            fail('EVALUATION_STALE', '评估产物与当前实际回放不一致，请重新评估', 409)
        old = current['payload'] if current else {'spec': None, 'candidate_id': None, 'history': []}
        history = [*old.get('history', []), policy_history_entry(old)][-20:]
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
        if previous.get('spec') is not None:
            context = policy_context(store, user['id'], previous)
            if context is None:
                if policy_implementation_changed(store, user['id'], previous):
                    fail('EVALUATION_STALE', '本地回放或数学实现版本已变化，不能用旧评估回滚；请重新评估并明确激活', 409)
                fail('EVALUATION_STALE', '此前策略的验收记录、授权或来源已经变化，不能回滚；请重新评估', 409)
            report, grouped = context
            verified = replay_cohort(grouped, report['baseline'], previous['spec'])
            if not verified['eligible']:
                fail('EVALUATION_BLOCKED', '此前策略未通过当前本地回放门槛，不能回滚', 409)
            if any(report.get(key) != value for key, value in verified.items()):
                fail('EVALUATION_STALE', '此前策略的评估与当前实际回放不一致，不能回滚', 409)
        p = {**previous, 'history': history[:-1], 'activated_at': now(), 'evaluation_id': previous.get('evaluation_id'), 'scope':'显式恢复此前本地规划策略'}
        return ws.save(store, db, user['id'], 'strategy_active', p, key='active', expected=current['version'])


def overview(store, user_id):
    rows = store.all('SELECT id,state,result FROM runs WHERE user_id=? ORDER BY updated_at DESC LIMIT 200', (user_id,))
    counts = {}
    for r in rows:counts[r['state']] = counts.get(r['state'], 0) + 1
    rejects = sum((r['result'] or {}).get('llm',{}).get('review',{}).get('rejected_claims',0) for r in rows)
    active=current_active(store,user_id)
    return {'active':active,'candidates':ws.objects(store,user_id,'strategy'),
        'evaluations':[evaluation_context(row) for row in ws.objects(store,user_id,'strategy_evaluation',200)],
        'assessments':[assessment_context(store,user_id,a) for a in ws.objects(store,user_id,'assessment',200)],
        'observations':{'observed_runs':len(rows),'states':counts,'structural_rejections':rejects,
                        'consented_cases':len(cases(store,user_id)),'automatic_model_updates':0},
        'suggestion':{'name':'加强反证与缺口复核','depth':'balanced','require_counterevidence':True,'require_gap_analysis':True,
                      'note':'候选要求显式覆盖反向证据与数据缺口；必须先与当前策略做有人工标签的本地回放比较'},
        'scope':'仅有受治理的本地策略改进，不自动训练模型或修改生产代码'}


def propose_from_assessments(store, user):
    """Derive and replay a candidate from consented HUMAN omissions, not model scores."""
    grouped=grouped_cases(cases(store,user['id']))
    keys=sorted(grouped)
    # Automatic candidate construction cannot learn from the same reserved cases
    # later presented as holdout gates. Small cohorts can only produce blocked drafts.
    development=keys[:-max(1,len(keys)//3)] if len(keys)>=3 else keys
    available=[case for key in development for case in grouped[key]]
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
    return {'candidate':row,'evaluation':evaluation,'sources':references,'source_partition':'development',
            'held_out_inputs':len(keys)-len(development),'automatic_activation':False,'external_calls':0}


def delete_record(store,user,kind,id,version):
    """Explicit cleanup can free bounded capacity without erasing active governance."""
    with store.transaction() as db:
        row=ws.get(store,user['id'],kind,id)
        check_version(row,version)
        active=ws.keyed(store,user['id'],'strategy_active','active')
        payload=active['payload'] if active else {}
        if kind=='strategy':
            protected={payload.get('candidate_id'),*(h.get('candidate_id') for h in payload.get('history',[]))}
            if id in protected:fail('STRATEGY_IN_USE','当前或可回滚策略不能删除',409)
            if any(r['payload'].get('candidate_id')==id for r in ws.objects(store,user['id'],'strategy_evaluation',200)):
                fail('STRATEGY_HAS_EVALUATIONS','请先检查并清理此候选的回放记录',409)
        else:
            chain=[payload,*payload.get('history',[])]
            protected_evaluations={item.get('evaluation_id') for item in chain}
            legacy_candidates={item.get('candidate_id') for item in chain if item.get('candidate_id') and not item.get('evaluation_id')}
            if id in protected_evaluations or row['payload'].get('candidate_id') in legacy_candidates:
                fail('EVALUATION_IN_USE','当前或可回滚策略依赖的回放证据不能删除',409)
        db.execute('DELETE FROM workspace_objects WHERE user_id=? AND kind=? AND id=?',(user['id'],kind,id))
        store.audit(db,user['id'],kind,id,'deleted',{'historical_runs':'retained'})
    return {'ok':True,'notice':'已清理选中实验记录；历史报告与原始数据保持不变'}
