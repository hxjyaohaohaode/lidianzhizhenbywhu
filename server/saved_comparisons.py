"""Owner/identity-scoped frozen enterprise comparisons using unchanged formulas."""
from __future__ import annotations
import copy
from datetime import date
from .clock import utc_today
from .models import calculate
from .store import digest, now
from .security import fail
from .identities import resolve_identity, identity_binding
from .autonomy_contracts import ExecutionOptions
from . import workspace_store as ws

WARNING = '同季度用户数据对照，不是行业基准或投资排名；请核实业务口径。'
METRICS = ('gross_margin', 'cash_ratio', 'leverage', 'revenue_growth', 'net_margin')


def calculate_comparison(datasets, comparison, *, period=None, as_of=None, hashes=False):
    """Shared with the original compare API; only the approved input prefix changes."""
    common = set.intersection(*({p['period'] for p in d['payload']['periods']} for d in datasets))
    if not common:
        fail('NO_COMMON_PERIOD', '没有共同季度，禁止跨期假比较。', 422)
    period = period or max(common)
    if period not in common:
        fail('COMPARISON_PERIOD', '指定季度不是全部比较企业的共同季度', 409)
    items = []
    for d in datasets:
        payload = {**d['payload'], 'periods': [p for p in d['payload']['periods'] if p['period'] <= period]}
        item = {'id': d['id'], 'company': payload['company'], 'source_kind': payload['source_kind'],
                'dataset_version': d['version'], 'analysis': calculate(payload, comparison, today=as_of)}
        if hashes:
            item['dataset_hash'] = d['content_hash']
        items.append(item)
    return {'period': period, 'items': items, 'warning': WARNING}


def create_payload(store, user_id, request):
    identity = resolve_identity(store, user_id, request.identity_id)
    datasets = []
    for ref in request.datasets:
        d = store.owned('datasets', user_id, ref.id)
        if not d:
            fail('NOT_FOUND', '比较输入不存在或无访问权限', 404)
        if identity and identity['payload']['dataset_ids'] and ref.id not in identity['payload']['dataset_ids']:
            fail('IDENTITY_SCOPE', '全部比较企业必须在当前服务身份范围内', 403)
        if d['version'] != ref.version or d['content_hash'] != ref.hash:
            fail('COMPARISON_STALE', '比较输入版本或指纹已变化，请重新选择全部企业', 409)
        if (d['payload'].get('currency'), d['payload'].get('amount_unit'), d['payload'].get('period_basis')) != ('CNY', 'yuan', 'standalone_quarter'):
            fail('COMPARISON_BASIS', '比较输入必须使用规范化人民币元与独立季度口径', 409)
        datasets.append(d)
    as_of = utc_today()
    result = calculate_comparison(datasets, request.comparison, period=request.target_period, as_of=as_of, hashes=True)
    return {'identity_id': request.identity_id, 'identity_binding': identity_binding(identity), 'name': request.name, 'comparison': request.comparison,
            'period': result['period'], 'period_basis': 'standalone_quarter', 'analysis_as_of': as_of.isoformat(),
            'comparability_note': request.comparability_note,
            'members': [{'id': d['id'], 'version': d['version'], 'hash': d['content_hash'],
                         'company': d['payload']['company'], 'snapshot': d['payload']} for d in datasets],
            'result': result, 'created_at': now(),
            'creation_request_id': request.request_id,
            'creation_request_hash': digest(request.model_dump(mode='json'))}


def freeze(row):
    return {'id': row['id'], 'version': row['version'], 'hash': digest(row['payload']), 'payload': copy.deepcopy(row['payload'])}


def provenance(frozen):
    if not frozen:
        return None
    p = frozen['payload']
    return {k: frozen[k] for k in ('id', 'version', 'hash')} | {
        'identity_id': p['identity_id'], 'name': p['name'], 'period': p['period'], 'comparison': p['comparison'],
        'period_basis': p['period_basis'], 'analysis_as_of': p['analysis_as_of'],
        'comparability_note': p['comparability_note'], 'result_hash': digest(p['result']),
        'members': [{k: m[k] for k in ('id', 'version', 'hash', 'company')} for m in p['members']]}


def verified_result(frozen):
    p = frozen['payload']; members = p['members']
    if digest(p) != frozen['hash'] or not 2 <= len(members) <= 8 or len({m['id'] for m in members}) != len(members):
        raise ValueError('比较产物指纹或成员数量不一致')
    if p['period_basis'] != 'standalone_quarter' or p['comparison'] not in ('previous', 'year_over_year'):
        raise ValueError('比较产物口径不一致')
    if any(digest(m['snapshot']) != m['hash'] or m['snapshot']['company'] != m['company'] for m in members):
        raise ValueError('比较企业冻结输入与指纹不一致')
    if any((m['snapshot'].get('currency'), m['snapshot'].get('amount_unit'), m['snapshot'].get('period_basis')) != ('CNY','yuan','standalone_quarter') for m in members):
        raise ValueError('比较企业币种、单位或季度口径不一致')
    data = [{'id': m['id'], 'version': m['version'], 'content_hash': m['hash'], 'payload': m['snapshot']} for m in members]
    result = calculate_comparison(data, p['comparison'], period=p['period'], as_of=date.fromisoformat(p['analysis_as_of']), hashes=True)
    if digest(result) != digest(p['result']):
        raise ValueError('比较结果不能由原始日期与冻结输入复现')
    return result


def current_impact(store, user_id, frozen):
    """Read-only live impact. Never change the archived comparison or its report."""
    if not frozen:
        return {'state': 'current', 'reasons': []}
    p = frozen['payload']; reasons = []; unavailable = False
    row = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='comparison' AND id=?", (user_id, frozen['id']))
    if not row:
        unavailable = True; reasons.append({'code': 'comparison_removed', 'message': '原始企业比较已删除或不可访问'})
    elif row['version'] != frozen['version'] or digest(row['payload']) != frozen['hash']:
        reasons.append({'code': 'comparison_changed', 'message': '原始企业比较版本或内容已变化'})
    identity = None
    if p['identity_id']:
        identity = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='identity' AND id=?", (user_id,p['identity_id']))
        if not identity:
            unavailable = True; reasons.append({'code': 'comparison_identity_removed', 'message': '比较所属服务身份已删除'})
    allowed = identity['payload']['dataset_ids'] if identity else []
    for m in p['members']:
        d = store.owned('datasets', user_id, m['id'])
        if not d:
            unavailable = True; reasons.append({'code': 'comparison_member_removed', 'dataset_id': m['id'], 'message': m['company']+'的原始财务输入已删除或不可访问'})
        elif (d['version'], d['content_hash']) != (m['version'], m['hash']):
            reasons.append({'code': 'comparison_member_changed', 'dataset_id': m['id'], 'message': m['company']+'的财务输入已修订'})
        if allowed and m['id'] not in allowed:
            unavailable = True; reasons.append({'code': 'comparison_identity_scope', 'dataset_id': m['id'], 'message': m['company']+'已不在原服务身份范围内'})
    return {'state': 'unavailable' if unavailable else 'changed' if reasons else 'current', 'reasons': reasons}


def public_record(store, user_id, row, *, summary=False):
    p = copy.deepcopy(row['payload'])
    if summary:
        p.pop('result', None)
        for m in p['members']:
            m.pop('snapshot', None)
    return {**row, 'comparison_hash': digest(row['payload']), 'payload': p,
            'source_impact': current_impact(store, user_id, freeze(row))}


def check_binding(store, user_id, frozen):
    impact = current_impact(store, user_id, frozen)
    if impact['state'] != 'current':
        fail('PLAN_STALE', '比较来源、成员财务数据或身份范围已变化，请重新保存比较并批准计划', 409)


def select_comparison(store, user_id, request, dataset, scope):
    ref = request.comparison_artifact
    if not ref:
        return request, None
    row = ws.get(store, user_id, 'comparison', ref.id)
    if row['version'] != ref.version or digest(row['payload']) != ref.hash:
        fail('COMPARISON_STALE', '比较版本或指纹不一致，请重新选择', 409)
    frozen = freeze(row); p = frozen['payload']
    if p['identity_id'] != request.identity_id:
        fail('IDENTITY_SCOPE', '比较属于另一服务身份，请切换身份或重新保存比较', 403)
    if dataset['id'] not in {m['id'] for m in p['members']}:
        fail('COMPARISON_DATASET', '研判主企业必须是所选比较的成员', 409)
    check_binding(store, user_id, frozen)
    try:
        verified_result(frozen)
    except (ValueError, KeyError, TypeError) as exc:
        fail('COMPARISON_INTEGRITY', str(exc), 409)
    if scope['status'] == 'selected' and not scope.get('explicit'):
        scope.update(period=p['period'], selection_basis='explicit_saved_comparison',
                     notice='按明确选中的企业比较限定共同季度；仅发送列明成员的派生指标，不追加同行资料或记忆。')
    if scope['status'] != 'selected' or scope['period'] != p['period']:
        fail('COMPARISON_PERIOD', '问题目标季度必须与已保存企业比较的共同季度一致', 409)
    if request.comparison != p['comparison'] and ('comparison' in request.model_fields_set or scope.get('requested_comparison')):
        fail('COMPARISON_BASIS', '计划比较基期必须与已保存企业比较一致', 409)
    request = request.model_copy(update={'comparison': p['comparison'], 'execution': request.execution or ExecutionOptions()})
    return request, frozen


def selected_output(snapshot, request):
    frozen = snapshot.get('comparison_artifact')
    if not frozen:
        raise ValueError('没有明确批准的企业比较产物')
    p = frozen['payload']; member = next((m for m in p['members'] if m['id'] == request['dataset_id']), None)
    if not member or digest(snapshot['dataset']) != member['hash'] or snapshot['dataset_version'] != member['version']:
        raise ValueError('执行主企业与比较冻结输入不一致')
    if snapshot.get('research_scope', {}).get('period') != p['period'] or request['comparison'] != p['comparison']:
        raise ValueError('执行季度或比较基期与批准比较不一致')
    return {**verified_result(frozen), 'status': 'completed', 'comparison': p['comparison'],
            'period_basis': p['period_basis'], 'analysis_as_of': p['analysis_as_of'],
            'comparability_note': p['comparability_note'], 'comparison_provenance': provenance(frozen),
            'limitations': [WARNING, '不同企业规模、业务结构和会计口径仍需人工核实，不推导行业分位或因果结论']}
