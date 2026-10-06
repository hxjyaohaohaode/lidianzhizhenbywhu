"""Read stored report text without serializing a decoded result as its original."""
import json

from .security import fail


def read_result_record(store, owner, run_id):
    # Alias only result so Store.unpack never discards malformed report text.
    row = store.one('''SELECT id,user_id,session_id,dataset_id,state,error,created_at,updated_at,
        idempotency_key,request_hash,payload,snapshot,result AS saved_result
        FROM runs WHERE id=? AND user_id=?''', (run_id, owner))
    if not row:
        fail('NOT_FOUND', '资源不存在或无访问权限', 404)
    raw = row.pop('saved_result')
    unreadable = False
    try:
        if raw is not None and not isinstance(raw, str):
            raise ValueError('stored result is not text')
        row['result'] = json.loads(raw) if raw is not None else None
    except (TypeError, ValueError, OverflowError):
        row['result'] = None
        unreadable = True
    return row, raw, unreadable


def unverified_text(raw):
    if isinstance(raw, str):
        return {'raw': raw, 'notice': '未核验的已保存报告原文，仅供排查；不是可用结论。'}
    return {'raw': None, 'notice': '原文不是可保真的文本类型，无法提供原字节阅读或下载；请核对可信原始记录。'}
