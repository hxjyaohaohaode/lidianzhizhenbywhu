"""Versioned service lenses with explicit data and memory context boundaries."""
from __future__ import annotations
from . import workspace_store as ws
from .security import fail
from .store import digest

PERSPECTIVES = {
    'operator': '企业经营', 'executive': '经营管理', 'investor': '投资研究',
    'researcher': '行业研究', 'auditor': '风险审阅', 'custom': '自定义服务',
}


def resolve_identity(store, user_id, identity_id='', dataset_id='', *, external=False, max_calls=0):
    if not identity_id:
        return None
    row = ws.get(store, user_id, 'identity', identity_id)
    p = row['payload']
    if dataset_id and p['dataset_ids'] and dataset_id not in p['dataset_ids']:
        fail('IDENTITY_SCOPE', '该企业不在此服务身份的选择范围，请切换身份或调整范围', 403)
    if external and (not p['allow_external'] or max_calls > p['max_calls']):
        fail('IDENTITY_BUDGET', '该身份未允许外部分析，或本次预算超过身份上限', 403)
    return row


def identity_binding(row):
    return {'id': row['id'], 'version': row['version'], 'hash': digest(row['payload'])} if row else None


def identity_context(row):
    if not row:
        return None
    p = row['payload']
    return {'id': row['id'], 'name': p['name'], 'perspective': p['perspective'],
            'objective': p['objective'], 'depth': p['depth'], 'output_style': p['output_style']}


def context_user(user, row):
    if not row:
        return user
    prefs = dict(user['preferences'])
    prefs['role'] = 'investor' if row['payload']['perspective'] in ('investor', 'researcher') else 'enterprise'
    return {**user, 'preferences': prefs, 'service_identity': row}


def validate_identity_binding(store, user, binding, dataset_id, *, external=False, max_calls=0):
    if not binding:
        return
    row = resolve_identity(store, user['id'], binding['id'], dataset_id,
                           external=external, max_calls=max_calls)
    if identity_binding(row) != binding:
        fail('IDENTITY_CHANGED', '服务身份或其外发权限已经改变，请重新预览并批准', 409)
