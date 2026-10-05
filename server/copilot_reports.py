"""Safe, read-only report cards for the copilot's saved proposal results.

Report bytes stay in storage. Only a current successful integrity check admits
normal result rendering; damaged JSON is isolated to its own card.
"""
import json

from .business_provenance import report_impact
from .historical_question_scope import report_question_warning
from .report_integrity import inspect_report_integrity

UNAVAILABLE = '报告完整性校验未通过或记录无法读取；已暂停展示主答案、数学结果与衍生入口。原记录保留，请核对可信记录后再使用。'


def _unavailable_impact(integrity):
    return {'state':'unavailable','reasons':[{'code':'report_integrity_failed',
        'message':'原报告的冻结产物、事件或输入快照完整性无法核验','checks':integrity['failures']}],
        'baseline':None,'current':None,'historical_report_preserved':True}


def read_proposal_run(store, owner, proposal, current_version):
    """Keep the saved bytes and their read-time integrity check consistent."""
    with store.read_snapshot():
        return _read_proposal_run(store, owner, proposal, current_version)


def _read_proposal_run(store, owner, proposal, current_version):
    """Owner-bound lookup, defensive decoding, then the canonical report check."""
    reference = proposal['payload'].get('result') or {}
    if not isinstance(reference, dict) or not isinstance(reference.get('run_id'), str):
        return None
    row = store.one('''SELECT id,user_id,session_id,dataset_id,state,error,created_at,updated_at,
        idempotency_key,request_hash,payload AS saved_payload,snapshot AS saved_snapshot,
        result AS saved_result FROM runs WHERE id=? AND user_id=?''', (reference['run_id'], owner))
    if not row:
        return None
    run = {k:v for k,v in row.items() if not k.startswith('saved_')}
    audit = None
    try:
        for field in ('payload','snapshot','result'):
            raw = row['saved_'+field]
            run[field] = json.loads(raw) if raw is not None else None
        if not isinstance(run['payload'],dict) or not isinstance(run['snapshot'],dict):
            raise ValueError('unreadable run scope')
        audit = inspect_report_integrity(store, run)
        integrity = audit['report_integrity']
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        integrity = {'valid':False,'format':'unreadable','failures':['report_record_unreadable']}
    expected = row['saved_result'] is not None or row['state'] in {'succeeded','degraded'}
    if integrity['valid']:
        availability = {'status':'available','notice':''}
    elif not expected and audit and audit['ledger']['valid'] and audit['data_hash_valid']:
        availability = {'status':'pending' if row['state'] in {'queued','running'} else 'no_report',
            'notice':'报告尚未生成，完成后再核验与展示。' if row['state'] in {'queued','running'} else '本次执行没有保存报告，未生成替代结果。'}
    else:
        availability = {'status':'unavailable','notice':UNAVAILABLE}
    available = availability['status'] == 'available'
    if available:
        try:
            impact = report_impact(store, owner, run, integrity=integrity)
        except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
            # A current-source reading failure does not rewrite or invalidate
            # an independently checked frozen report.
            impact = {'state':'unavailable','reasons':[{'code':'source_context_unavailable',
                'message':'当前来源状态无法读取；不推定历史报告仍适用于当前数据。'}],
                'baseline':None,'current':None,'historical_report_preserved':True}
    else:
        impact = _unavailable_impact(integrity) if availability['status']=='unavailable' else None
    snapshot = run.get('snapshot') if isinstance(run.get('snapshot'),dict) else {}
    request = run.get('payload') if isinstance(run.get('payload'),dict) else {}
    question = request.get('query') if isinstance(request.get('query'),str) else proposal['payload'].get('text','')
    return {'id':row['id'],'state':row['state'],'error':row['error'],'query':question,
        'result':run['result'] if available else None,
        'unverified_report':{'raw':row['saved_result'],'notice':'未核验的已保存报告原文，仅供排查；不是可用结论。'}
            if availability['status']=='unavailable' and row['saved_result'] is not None else None,
        'report_availability':availability,'report_integrity':integrity,
        'report_hash_valid':audit['report_hash_valid'] if audit else None,
        'updated_at':row['updated_at'],'proposal_id':proposal['id'],
        'dataset_version':snapshot.get('dataset_version'),'source_impact':impact,
        'question_compatibility':report_question_warning(store,run,integrity) if available else None,
        'current_dataset_version':current_version}
