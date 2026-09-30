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


def execution_service_valid(store, user_id, bindings, request, providers, expected_provider):
    """Revalidate identity and owner-scoped connection at each dispatch boundary.

    Approval is not a permanent grant. This check never initiates a network call;
    a revoked identity, rotated key or unavailable credential blocks future sends.
    Already dispatched requests cannot be recalled.
    """
    from fastapi import HTTPException
    from .connections import scoped_providers, provider_binding
    try:
        user = store.one('SELECT * FROM users WHERE id=?', (user_id,))
        if not user:
            return False
        validate_identity_binding(store, user, bindings.get('identity'), bindings['dataset_id'],
                                  external=True, max_calls=request.get('max_calls', 1))
        if not expected_provider:
            return False
        live = scoped_providers(providers, user_id).select(expected_provider['id'])
        if not live:
            return False
        expected = {k: expected_provider[k] for k in ('id', 'model', 'configuration_version') if k in expected_provider}
        if provider_binding(live) != expected:
            return False
        return all(getattr(live, k) == expected_provider[k] for k in ('host', 'path') if k in expected_provider)
    except (HTTPException, RuntimeError, ValueError, KeyError):
        return False


def workspace_scope(store, user_id, identity_id=None, dataset_id=''):
    """Resolve an optional service lens before list aggregation, never as account RBAC.

    Omitting identity_id retains legacy account-wide lists. An explicit empty
    identity selects the default identity; dataset assets remain account-owned.
    """
    identity = resolve_identity(store, user_id, identity_id or '', dataset_id)
    datasets = store.items('datasets', user_id)
    if dataset_id and not any(row['id'] == dataset_id for row in datasets):
        fail('NOT_FOUND', '数据不存在或无权访问', 404)
    allowed = set(identity['payload']['dataset_ids']) if identity and identity['payload']['dataset_ids'] else None
    datasets = [row for row in datasets if (allowed is None or row['id'] in allowed) and (not dataset_id or row['id'] == dataset_id)]
    return datasets, {'mode': 'account' if identity_id is None else 'identity',
        'identity_id': identity_id, 'dataset_id': dataset_id,
        'dataset_ids': [row['id'] for row in datasets],
        'label': '账户全部记录' if identity_id is None else (identity['payload']['name'] if identity else '默认身份')}


def scope_sql(scope, dataset_expr, identity_expr=None):
    """Only trusted code supplies expressions; values always use bound parameters."""
    clauses=[]; values=[]
    if scope['mode'] != 'account' or scope['dataset_id']:
        ids=scope['dataset_ids']
        clauses.append(dataset_expr+' IN ('+','.join('?' for _ in ids)+')' if ids else '0')
        values.extend(ids)
    if identity_expr and scope['mode'] == 'identity':
        clauses.append("COALESCE("+identity_expr+",'')=?")
        values.append(scope['identity_id'])
    return ''.join(' AND '+clause for clause in clauses), values
