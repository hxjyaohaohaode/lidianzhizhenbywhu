"""Read-time operation warnings, separate from frozen results and integrity.

Use the current bounded question router only to identify known unsupported
percentage operations. Never reconstruct old metrics, fill absent scope fields,
or treat a missing modern field as evidence that a historical answer is wrong.
"""
from .question_scope import unsupported_amount_percentage, unsupported_growth, unsupported_modifier


def question_warning(question):
    if not isinstance(question, str) or not question.strip():
        return None
    reason = ('percentage_transformation_unsupported' if unsupported_growth(question) else
              'amount_percentage_unsupported' if unsupported_amount_percentage(question) else None)
    if not reason:
        return None
    return {'status': 'unsupported_operation', 'reason': reason, 'question': question,
            'notice': unsupported_modifier(question.lower()),
            'history_notice': '已保存的指标值和原答复仅供历史查阅，不能作为该问题所要求百分比的答案；原记录未改写，未重新计算。'}


def saved_message_warning(message):
    payload = message.get('payload')
    if not isinstance(payload, dict):
        return None
    response = payload.get('response')
    context = response.get('context') if isinstance(response, dict) else None
    scope = context.get('question_scope') if isinstance(context, dict) else None
    # Current refusals already explain the boundary. Missing historical scope
    # is not enough to call a previous answer unsupported.
    if not isinstance(scope, dict) or scope.get('status') != 'supported' or scope.get('can_calculate') is not True:
        return None
    return question_warning(payload.get('question'))


def report_question_warning(store, run, integrity):
    if not integrity.get('valid') or not isinstance(run.get('result'), dict):
        return None
    try:
        if run['snapshot'].get('studio'):
            from .studio import approved_run_valid
            from .execution_scope import plan_scope_target
            if not approved_run_valid(store, run):
                return None
            plan = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='plan' AND id=?",
                             (run['user_id'], run['snapshot']['studio']['plan_id']))
            # Preserve the approved edited target. Included history and the
            # proposal's source question must not replace that target.
            question = plan_scope_target(store, plan)
        else:
            question = run['payload'].get('query')
            if question != run['result'].get('query'):
                return None
        return question_warning(question)
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
