"""Read-only checks for the content and scope of approved research sources.

Frozen reports remain historical facts. These checks grant no new authority and
never repair stored hashes, re-pack an approved prompt, or rewrite a snapshot.
"""
from .clock import utc_today
from .store import digest


def dataset_content_valid(row):
    from .schemas import Dataset
    try:
        payload = row['payload']
        if not isinstance(payload, dict) or digest(payload) != row['content_hash']:
            return False
        Dataset.model_validate({k: v for k, v in payload.items() if k in Dataset.model_fields})
        return payload.get('amount_unit') == 'yuan'
    except (KeyError, TypeError, ValueError, OverflowError):
        return False


def require_dataset_content(row):
    from .security import fail
    if not dataset_content_valid(row):
        fail('SOURCE_INTEGRITY', '财务输入与保存的校验值不一致，未采用该内容；请核对原始资料或可信备份后重新预览', 409)


def evidence_document_valid(document):
    """A stored hash alone does not verify the live document bytes."""
    try:
        text = document['payload']['text']
        return isinstance(text, str) and digest(text) == document['content_hash']
    except (KeyError, TypeError, ValueError):
        return False


def identity_context_valid(identity):
    """Validate stored scope fields without supplying missing consent defaults."""
    from .service_contracts import IdentitySpec
    try:
        payload = identity['payload']
        if not isinstance(payload, dict) or not {'dataset_ids', 'perspective', 'include_shared_memory'} <= payload.keys():
            return False
        IdentitySpec.model_validate(payload, strict=True)
        return True
    except (KeyError, TypeError, ValueError):
        return False


def effective_memory_user(user, identity):
    """Malformed live settings supply no effective memory authority."""
    from .schemas import Preferences
    from .identities import context_user
    try:
        preferences = user['preferences']
        if not isinstance(preferences, dict) or not {'role', 'memory_enabled'} <= preferences.keys():
            return None
        Preferences.model_validate({**preferences, 'name': user['name'], 'version': user['version']}, strict=True)
        if identity is not None and not identity_context_valid(identity):
            return None
        return context_user(user, identity)
    except (KeyError, TypeError, ValueError):
        return None


def memory_eligible(payload, effective_user, company):
    """Current consent and scope, independent of retrieval order or its budget."""
    identity = effective_user.get('service_identity')
    identity_id = identity['id'] if identity else ''
    return bool(payload['approved'] and effective_user['preferences'].get('memory_enabled', True)
        and not (payload.get('expires_at') and payload['expires_at'] < utc_today().isoformat())
        and (not payload.get('company') or payload['company'] == company)
        and payload.get('role') in ('all', effective_user['preferences'].get('role'))
        and (not payload.get('identity_id') or payload['identity_id'] == identity_id)
        and (not identity or identity['payload']['include_shared_memory'] or payload.get('identity_id')))


def evidence_content_valid(document, citation):
    try:
        text = document['payload']['text']
        start, end, excerpt = citation['start'], citation['end'], citation['excerpt']
        return (evidence_document_valid(document)
                and type(start) is int and type(end) is int and 0 <= start < end <= len(text)
                and end - start <= 1100 and excerpt == text[start:end]
                and citation['document_hash'] == document['content_hash']
                and digest(excerpt) == citation['content_hash'])
    except (KeyError, TypeError, ValueError):
        return False


def review_eligible(review, company):
    if not review or not isinstance(review.get('payload'), dict):
        return False
    p = review['payload']
    return (p.get('status') in ('unreviewed', 'accepted')
            and not (p.get('expires_at') and p['expires_at'] < utc_today().isoformat())
            and (p.get('company') == company or bool(p.get('global_scope')) and not p.get('company')))


def source_error(store, user, request, snapshot, bindings):
    """Check all frozen selected sources, including references used by model tools.

    Base excerpt packing is not a complete disclosure list: deterministic tools
    can refer to selected citations omitted from that list.

    Session versions are checked at approval by the caller. Approval itself appends
    a message, so its preview version cannot be compared at every future send.
    """
    from . import workspace_store as ws
    from .identities import context_user
    from .intelligence import profile_for
    try:
        if not user:
            return '账户已不可用，请重新登录并预览'
        owner = user['id']; company = snapshot['dataset']['company']
        if digest(snapshot['dataset']) != snapshot['dataset_hash'] or snapshot['dataset_hash'] != bindings['dataset_hash']:
            return '冻结财务输入与批准指纹不一致，请重新预览'
        data = store.owned('datasets', owner, bindings['dataset_id'])
        if not data:
            return '财务输入已删除或不可访问，请重新选择可信资料并预览'
        if not dataset_content_valid(data):
            return '财务输入校验失败，未采用该内容；请从可信修订恢复或核对原始文件后重新导入'
        if (data['version'], data['content_hash']) != (bindings['dataset_version'], bindings['dataset_hash']):
            return '财务输入已修订，请以当前版本重新预览'
        identity = None
        if bindings.get('identity'):
            b = bindings['identity']
            identity = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='identity' AND id=?", (owner, b['id']))
            if not identity or identity['version'] != b['version'] or digest(identity['payload']) != b['hash']:
                return '服务身份或其适用范围已变化，请重新预览'
        effective = context_user(user, identity)
        if user['version'] != bindings['user_version'] or digest(effective['preferences']) != digest(snapshot['preferences']):
            return '用户偏好或记忆使用选择已变化，请重新预览'
        profile = ws.keyed(store, owner, 'profile', company)
        if (profile['version'] if profile else 0) != bindings['profile_version'] or digest(profile_for(store, owner, company)) != digest(snapshot['profile']):
            return '企业目标已变化，请重新预览'
        for citation in snapshot['citations']:
            doc = store.owned('evidence', owner, citation['document_id'])
            review = ws.keyed(store, owner, 'evidence_review', citation['document_id'])
            if not citation.get('review_hash') or not citation.get('document_payload_hash'):
                return '旧计划未记录完整证据授权指纹，请重新预览并批准；原报告保持不变'
            if not doc:
                return '证据已删除或不可访问，请重新选择可信资料并预览'
            if not evidence_content_valid(doc, citation):
                return '证据原文或片段校验失败，未采用该内容；请核对原始资料后重新录入并预览'
            if doc['version'] != citation['document_version'] or digest(doc['payload']) != citation['document_payload_hash']:
                return '证据内容或元数据已变化，请重新核对并预览'
            if (not review_eligible(review, company) or review['version'] != citation['review_version']
                    or digest(review['payload']) != citation['review_hash']):
                return '证据的企业适用范围或审阅授权已变化，请重新审阅并新建计划'
        memory_bindings = {m['id']: m for m in bindings['memory']}
        for memory in snapshot['memory']:
            baseline = memory.get('payload_hash') or memory_bindings.get(memory['id'], {}).get('hash')
            if not baseline:
                return '旧计划未记录完整记忆授权指纹，请重新预览并批准；原报告保持不变'
            row = store.owned('memories', owner, memory['id'])
            if not row or row['version'] != memory['version'] or digest(row['payload']) != baseline:
                return '记忆已修改、撤回或删除，请重新预览'
            if not memory_eligible(row['payload'], effective, company):
                return '记忆的企业、角色、身份或使用许可已变化，请重新预览'
        from .saved_comparisons import current_impact
        if current_impact(store, owner, snapshot.get('comparison_artifact'))['state'] != 'current':
            return '比较来源或成员输入已变化，请重新保存比较并预览'
        return None
    except (KeyError, TypeError, ValueError, OverflowError):
        return '来源授权记录不完整或校验失败，请重新预览并批准；原报告保持不变'
