"""Execution admission for known currency/comparison/transformation incompatibilities.

This is separate from historical integrity: no saved plan, report, approval,
snapshot or checkpoint is rewritten, and ordinary reads never call this gate.
"""
import re

from .question_scope import COMPARISON_PATTERNS, resolve_question, unsupported_amount_percentage, unsupported_growth
from .store import digest, now


def plan_scope_target(store, plan):
    p = plan['payload']
    # New previews bind exactly the text used to select scope, before copilot
    # history is appended. It remains usable if its old conversation is removed.
    if 'scope_query' in p:
        return p['scope_query']
    proposals = store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='assistant_proposal' AND json_extract(payload,'$.plan_id')=?",
                          (plan['user_id'], plan['id']))
    if not proposals and not p.get('proposal_id'):
        return p['request']['query']
    if len(proposals) != 1:
        return None
    proposal = proposals[0]; q = proposal['payload']
    if (p.get('proposal_id', proposal['id']) != proposal['id'] or q.get('kind') != 'research'
        or q.get('plan_id') != plan['id'] or q.get('plan_fingerprint') != p['fingerprint']):
        return None
    dispatched = p['status'] == 'dispatched'
    expected_result = {'run_id': p['run_id'], 'route': 'agents:run-' + p['run_id']} if dispatched else None
    if (q.get('status') != ('executed' if dispatched else 'draft') or q.get('result') != expected_result
        or q.get('plan_version') != plan['version'] - int(dispatched)):
        return None
    original = {k: v for k, v in q.items() if k != 'fingerprint'}
    original.update(status='draft', result=None)
    if digest(original) != q.get('fingerprint') or digest(q['request']) != q.get('request_hash'):
        return None
    b = q['binding']; frozen = p['bindings']; origin = q['provenance']
    if (b.get('thread_id') != q['thread_id'] or origin.get('thread_id') != q['thread_id']
        or origin.get('proposal_id') != proposal['id']
        or any(b.get(key) != frozen.get(key) for key in ('dataset_id', 'dataset_version', 'dataset_hash', 'identity'))):
        return None
    thread = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='assistant_thread' AND id=?",
                       (plan['user_id'], q['thread_id']))
    if (not thread or thread['payload'].get('dataset_id') != frozen['dataset_id']
        or thread['payload'].get('identity_id', '') != p['request'].get('identity_id', '')):
        return None
    if q.get('source_message_id'):
        if origin.get('source_message_id') != q['source_message_id']:
            return None
        message = store.one('SELECT payload FROM copilot_messages WHERE user_id=? AND thread_id=? AND id=?',
                            (plan['user_id'], q['thread_id'], q['source_message_id']))
        if not message or digest(message['payload']) != origin.get('message_hash'):
            return None
    # The proposal text is the approved edited/scoped target. Its original
    # source question and included chat history must not replace it.
    return q.get('text')


def plan_scope_issue(store, plan):
    """Return a bounded, explainable incompatibility; callers check integrity."""
    def issue(reason, message):
        return {'code': 'PLAN_SCOPE_REPREVIEW', 'reason': reason, 'message': message}
    try:
        target = plan_scope_target(store, plan)
        if not isinstance(target, str) or not target.strip():
            raise ValueError('unavailable target')
        p = plan['payload']; q = target.lower()
        # Check bounded incompatible operations, not every new metric/period
        # interpretation. Unspecified comparisons retain the approved form.
        if resolve_question(target, p['snapshot']['dataset'], [])['unsupported_currency']:
            return issue('foreign_currency_unsupported', '原批准目标要求外币口径，当前金额计算仅支持人民币（CNY）；不能用人民币替代，请重新预览并确认研究目标。')
        if unsupported_growth(target):
            return issue('percentage_transformation_unsupported', '原批准目标要求当前不支持的指标增长率或百分比变化，不能用原始金额、原比率或比较差额替代；请重新预览并确认研究目标。')
        if unsupported_amount_percentage(target):
            return issue('amount_percentage_unsupported', '原批准目标要求金额指标的百分比，但未明确受支持的分母与比率口径，不能用原始金额替代；请重新预览并确认研究目标。')
        explicit = [key for key, pattern in COMPARISON_PATTERNS.items() if re.search(pattern, q)]
        if len(explicit) > 1 or '同环比' in q:
            return issue('explicit_comparison_ambiguous', '原批准目标同时要求同比与环比；一次计划只支持一个比较基期，请明确后重新预览。')
        if explicit and any(value != explicit[0] for value in (p['request']['comparison'], p['snapshot']['comparison'])):
            label = '环比' if explicit[0] == 'previous' else '同比'
            return issue('explicit_comparison_mismatch', '原批准目标明确要求' + label + '，但已批准比较基期不一致；请重新预览，旧计划不会自动改写。')
    except (KeyError, TypeError, ValueError, AttributeError):
        return issue('original_target_unavailable', '无法核验原提案绑定的当前研究目标；请重新预览，未从历史聊天猜测或改写旧计划。')
    return None


def run_scope_issue(store, row):
    plan = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='plan' AND id=?",
                     (row['user_id'], row['snapshot']['studio']['plan_id']))
    return plan_scope_issue(store, plan)


def require_plan_scope(store, plan):
    from .security import fail
    issue = plan_scope_issue(store, plan)
    if issue:
        fail(issue['code'], issue['message'], 409)


def stop_for_scope(worker, row):
    """Stop new execution visibly while keeping all frozen history intact."""
    issue = run_scope_issue(worker.store, row)
    if issue:
        with worker.store.transaction() as db:
            if db.execute("UPDATE runs SET state='interrupted',error=?,updated_at=? WHERE id=? AND user_id=? AND state='running'",
                          (issue['message'], now(), row['id'], row['user_id'])).rowcount:
                db.execute("UPDATE adaptive_controls SET status='paused',version=version+1,updated_at=? WHERE run_id=? AND user_id=?",
                           (now(), row['id'], row['user_id']))
                worker.store.event(db, row['id'], 'scope_repreview_required', issue)
                worker.store.audit(db, row['user_id'], 'runs', row['id'], 'scope_repreview_required', issue)
    return issue
