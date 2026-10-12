"""Explicit revenue-growth approval scope, separate from immutable history.

No text/title inference and no legacy backfill. Dataset provenance is admitted by
resolve_source; copilot scope additionally binds the exact saved message/scope.
Ongoing evaluation uses the newest saved quarter only once it has completed.
"""
from .service_contracts import WatchSourceScope
from .store import digest
from .security import fail
from .historical_question_scope import saved_message_warning

BASES = {'previous', 'year_over_year'}
UNAVAILABLE = '收入增速比较基期或来源无法核验，未计算或生成提醒；请从可核验的原回答，或明确选择数据及同/环比后另建规则。历史记录保持不变。'


def _scope(store, user_id, provenance, comparison, dataset_id):
    if (not isinstance(provenance, dict) or provenance.get('dataset_id') != dataset_id
            or type(provenance.get('schema_version')) is not int or provenance['schema_version'] != 1):
        raise ValueError(UNAVAILABLE)
    kind = provenance.get('kind')
    if kind == 'dataset':
        if comparison not in BASES:
            raise ValueError('收入增速跟踪必须明确选择环比或同比。')
        if (type(provenance.get('dataset_version')) is not int or provenance['dataset_version'] < 1
                or not isinstance(provenance.get('dataset_hash'), str) or len(provenance['dataset_hash']) != 64
                or any(c not in '0123456789abcdef' for c in provenance['dataset_hash'])):
            raise ValueError(UNAVAILABLE)
        return WatchSourceScope(comparison=comparison, source_kind=kind).model_dump(mode='json', exclude_none=True)
    if kind != 'copilot':
        raise ValueError('此来源尚不能可靠绑定收入增速的比较基期；请从可核验的原回答或企业数据重新建立规则并明确选择同/环比。')
    mid, tid = provenance.get('source_message_id'), provenance.get('thread_id')
    if not isinstance(mid, str) or not mid or not isinstance(tid, str) or not tid:
        raise ValueError(UNAVAILABLE)
    message = store.one('SELECT * FROM copilot_messages WHERE id=? AND user_id=? AND thread_id=?', (mid, user_id, tid))
    if not message or digest(message['payload']) != provenance.get('message_hash') or saved_message_warning(message):
        raise ValueError(UNAVAILABLE)
    payload = message['payload']; response = payload.get('response') if isinstance(payload, dict) else None
    context = response.get('context') if isinstance(response, dict) else None
    scope = context.get('question_scope') if isinstance(context, dict) else None
    if (not isinstance(scope, dict) or scope.get('status') != 'supported' or scope.get('can_calculate') is not True
            or not isinstance(scope.get('topics'), list) or 'revenue_growth' not in scope['topics']
            or scope.get('comparison') not in BASES or not scope.get('period')
            or context.get('dataset_id') != dataset_id):
        raise ValueError(UNAVAILABLE)
    if comparison is not None and comparison != scope['comparison']:
        raise ValueError('跟踪比较基期与原回答不一致；请保留原回答的同/环比，或从企业数据另建明确基期的规则。')
    return WatchSourceScope(comparison=scope['comparison'], source_kind=kind,
        source_period=scope['period'], question_scope_hash=digest(scope)).model_dump(mode='json', exclude_none=True)


def bind_watch_scope(store, user_id, metric, provenance, comparison, dataset_id):
    if metric != 'revenue_growth':
        if comparison is not None:
            fail('WATCH_SCOPE_INVALID', '只有收入增速需要选择同/环比。', 422)
        return {}
    try:
        scope = _scope(store, user_id, provenance, comparison, dataset_id)
    except ValueError as exc:
        fail('WATCH_SCOPE_REQUIRED', str(exc) if not hasattr(exc, 'errors') else UNAVAILABLE, 422)
    except (TypeError, KeyError):
        fail('WATCH_SCOPE_REQUIRED', UNAVAILABLE, 422)
    return {'comparison': scope['comparison'], 'source_scope': scope}


def watch_scope_warning(store, user_id, payload):
    if payload.get('metric') != 'revenue_growth':
        return None
    try:
        if payload.get('comparison') not in BASES or not isinstance(payload.get('source_scope'), dict):
            return UNAVAILABLE
        saved = WatchSourceScope.model_validate(payload['source_scope'], strict=True).model_dump(mode='json', exclude_none=True)
        if saved != payload['source_scope'] or type(payload['source_scope'].get('schema_version')) is not int:
            return UNAVAILABLE
        expected = _scope(store, user_id, payload.get('provenance'), payload['comparison'], payload.get('dataset_id'))
        if saved != expected:
            return UNAVAILABLE
    except (ValueError, TypeError, KeyError, AttributeError):
        return UNAVAILABLE
    return None


def require_watch_scope(store, user_id, payload):
    warning = watch_scope_warning(store, user_id, payload)
    if warning:
        fail('WATCH_SCOPE_REQUIRED', warning, 409)
