"""Verified saved mathematics reused by plans, execution and local replay.

No formula lives here. The original analytics functions remain authoritative;
saved results are checked against their frozen inputs before granting provenance.
"""
from __future__ import annotations
from .clock import utc_today
import copy
from datetime import date
from .analytics import extended_scenario, forecast_baselines
from .autonomy_contracts import ExecutionOptions
from .security import fail
from .store import digest, now
from . import workspace_store as ws


def experiment_data(payload):
    data = payload['snapshot']
    target = payload.get('target_period') or max(p['period'] for p in data['periods'])
    if target not in {p['period'] for p in data['periods']}:
        raise ValueError('实验目标季度不在冻结输入中')
    return {**data, 'periods': [p for p in data['periods'] if p['period'] <= target]}


def calculate_experiment(payload):
    r = payload['request']; data = experiment_data(payload)
    if r['kind'] == 'scenario':
        return extended_scenario(data, r['price_change'], r['cost_change'], r['volume_change'], r['fixed_cost_share'])
    if not payload.get('analysis_as_of'):
        raise ValueError('旧预测实验未记录计算日期；请重新保存实验后再交给Agent')
    return forecast_baselines(data, r['metric'], r['horizon'], today=date.fromisoformat(payload['analysis_as_of']))


def create_payload(dataset, request):
    if request.dataset_version != dataset['version'] or request.dataset_hash != dataset['content_hash']:
        fail('EXPERIMENT_STALE', '财务输入已变化，请刷新后重新计算实验', 409)
    target = request.target_period or max(p['period'] for p in dataset['payload']['periods'])
    if target not in {p['period'] for p in dataset['payload']['periods']}:
        fail('EXPERIMENT_PERIOD', '所选目标季度不在当前数据中', 409)
    p = {'request': request.model_dump(mode='json'), 'dataset_id': dataset['id'],
         'company': dataset['payload']['company'], 'dataset_version': dataset['version'],
         'dataset_hash': dataset['content_hash'], 'snapshot': dataset['payload'],
         'target_period': target, 'analysis_as_of': utc_today().isoformat(), 'created_at': now()}
    p['result'] = calculate_experiment(p)
    return p


def public_record(row, *, summary=False):
    # Hash the full archived payload, never the trimmed list projection.
    return {**row, 'experiment_hash': digest(row['payload']),
            'payload': {k: v for k, v in row['payload'].items() if not summary or k not in ('snapshot', 'result')}}


def provenance(frozen):
    if not frozen:
        return None
    p = frozen['payload']
    return {k: frozen[k] for k in ('id', 'version', 'hash')} | {
        'name': p['request']['name'], 'kind': p['request']['kind'],
        'dataset_id': p['dataset_id'], 'dataset_version': p['dataset_version'], 'dataset_hash': p['dataset_hash'],
        'target_period': max(row['period'] for row in experiment_data(p)['periods']),
        'analysis_as_of': p.get('analysis_as_of'), 'assumptions': p['request']['assumptions'],
        'result_hash': digest(p['result'])}


def verified_result(frozen):
    p = frozen['payload']
    if digest(p) != frozen['hash'] or digest(p['snapshot']) != p['dataset_hash']:
        raise ValueError('实验冻结输入或结果指纹不一致')
    if p['request']['dataset_id'] != p['dataset_id'] or (p['request'].get('target_period') and p['request']['target_period'] != p.get('target_period')):
        raise ValueError('实验请求与冻结数据范围不一致')
    result = calculate_experiment(p)
    if digest(result) != digest(p['result']):
        raise ValueError('实验结果无法由原始输入与日期复现，请重新保存实验')
    return result


def select_experiment(store, user_id, request, dataset, scope):
    """Resolve only an explicit owner/version/hash reference, then freeze it."""
    ref = request.experiment
    if not ref:
        return request, None
    row = ws.get(store, user_id, 'experiment', ref.id)
    if row['version'] != ref.version or digest(row['payload']) != ref.hash:
        fail('EXPERIMENT_STALE', '实验版本或指纹已变化，请重新选择', 409)
    p = row['payload']
    if (p['dataset_id'], p['dataset_version'], p['dataset_hash']) != (dataset['id'], dataset['version'], dataset['content_hash']):
        fail('EXPERIMENT_DATASET', '实验必须属于所选数据集的当前相同版本；请重新保存实验', 409)
    frozen = {**ref.model_dump(), 'payload': copy.deepcopy(p)}
    try:
        verified_result(frozen)
        target = provenance(frozen)['target_period']
    except (ValueError, KeyError, TypeError) as exc:
        fail('EXPERIMENT_INTEGRITY', str(exc), 409)
    if scope['status'] != 'selected' or scope['period'] != target:
        fail('EXPERIMENT_PERIOD', '问题目标季度与实验目标季度不一致，请统一后重新预览', 409)
    ex = request.execution or ExecutionOptions()
    options = ex.model_dump(mode='json'); saved = p['request']
    updates = ({'scenario': {k: saved[k] for k in ('price_change', 'cost_change', 'volume_change', 'fixed_cost_share')} | {'note': saved['assumptions']}}
               if saved['kind'] == 'scenario' else {'forecast': True, 'forecast_metric': saved['metric'], 'horizon': saved['horizon']})
    for key, value in updates.items():
        if key in ex.model_fields_set and options[key] != value:
            fail('EXPERIMENT_ASSUMPTIONS', '本次参数与已选择的实验冲突；请保留原实验假设或取消实验选择', 409)
    return request.model_copy(update={'execution': ExecutionOptions.model_validate({**options, **updates})}), frozen


def binding_current(store, user_id, binding):
    if not binding:
        return True
    row = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='experiment' AND id=?", (user_id, binding['id']))
    return bool(row and row['version'] == binding['version'] and digest(row['payload']) == binding['hash'])


def check_binding(store, user_id, binding):
    if not binding_current(store, user_id, binding):
        fail('PLAN_STALE', '选中的数学实验已修改或删除，请重新预览并批准', 409)


def selected_output(capability, snapshot, execution):
    frozen = snapshot.get('experiment')
    if not frozen:
        return None
    p = frozen['payload']; r = p['request']
    expected = 'sensitivity' if r['kind'] == 'scenario' else 'forecast'
    if capability != expected:
        return None
    from .question_scope import analysis_dataset
    if digest(experiment_data(p)) != digest(analysis_dataset(snapshot)):
        raise ValueError('已批准实验与执行目标输入不一致')
    if expected == 'sensitivity':
        assumptions = {k: r[k] for k in ('price_change', 'cost_change', 'volume_change', 'fixed_cost_share')} | {'note': r['assumptions']}
        if execution.get('scenario') != assumptions:
            raise ValueError('执行情景假设与批准实验不一致')
    else:
        if not execution.get('forecast') or (execution.get('forecast_metric'), execution.get('horizon')) != (r['metric'], r['horizon']):
            raise ValueError('执行预测参数与批准实验不一致')
        assumptions = {'metric': r['metric'], 'horizon': r['horizon'], 'note': r['assumptions']}
    return {**verified_result(frozen), 'status': 'completed', 'approved_assumptions': assumptions,
            'experiment': provenance(frozen)}
