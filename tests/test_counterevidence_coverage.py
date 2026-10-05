"""Human stance presence, actual local execution, and replay-version migration.

Every ordinary source/run/assessment/policy uses the real isolated APIs. The
explicit legacy harness emulates v4's old counterevidence rule, never a provider.
"""
import copy

import pytest

from server import adaptive_runtime, evolution, workspace_store as ws
from server.autonomy import execute_local_capability
from server.research_context import project_tools
from server.store import digest
from test_adaptive import completed, preview
from test_evolution import candidate, three_cases
from test_strategy_source_lifecycle import execute, ok


@pytest.mark.parametrize('stances,expected', [
    ((), False), (('context',), False), (('supports',), False),
    (('contradicts',), True), (('supports', 'contradicts'), True),
], ids=['empty', 'context-only', 'supports-only', 'contradicts-only', 'both-sides'])
def test_real_api_stance_matrix_covers_only_present_human_counter_labels(actor, example, stances, expected):
    runs = three_cases(actor, example, stances=stances)
    policy = candidate(actor)
    evaluated = ok(actor.post('/workspace/strategies/' + policy['id'] + '/evaluate'), 201)
    report = evaluated['payload']
    assert report['unique_inputs'] == report['scenario_cases'] == 3
    assert report['eligible'] is expected
    assert len(report['improvements']) == (3 if expected else 0)
    assert report['external_calls'] == 0 and report['regressions'] == []
    for case in report['cases']:
        source = next(run for run in runs if run['id'] == case['run_id'])
        result = case['candidate']
        assert case['source'] == {
            'query': source['payload']['query'], 'company': source['snapshot']['dataset']['company'],
            'target_period': source['result']['analysis']['current_period'],
            'dataset_version': source['snapshot']['dataset_version'], 'dataset_hash': source['snapshot']['dataset_hash']}
        assert 'counterevidence' not in case['baseline']['planned_capabilities']
        assert 'counterevidence' in result['planned_capabilities']
        assert ('counterevidence' in result['covered']) is expected
        assert result['missing'] == ([] if expected else ['counterevidence'])
        counter = result['computations']['counterevidence']
        assert counter['status'] == ('completed' if expected else 'missing')
        assert counter['group_counts'] == {key: int(key in stances) for key in ('supports', 'contradicts', 'context')}
        assert bool(counter['reason']) is not expected
        assert '不证明有效反证、逻辑矛盾或事实正确性' in counter['limitation']
        assert result['math_hash'] == case['baseline']['math_hash'] == case['reference_math_hash']
    activation = ok(actor.post('/workspace/strategies/' + policy['id'] + '/activate', json={
        'evaluation_id': evaluated['id'], 'expected_active_version': 0}), 200 if expected else 409)
    if not expected:
        assert activation['error']['code'] == 'EVALUATION_BLOCKED'
        assert ok(actor.get('/workspace/evolution'))['active'] is None
    # Exercise the real production node even for candidates that cannot activate.
    dataset = ok(actor.get('/datasets/' + runs[0]['dataset_id']))
    production = completed(actor, dataset=dataset, query='核验企业经营变化及现金情况，核对反向证据')
    output = production['result']['adaptive']['mathematical_outputs']['counterevidence']
    assert output['status'] == ('completed' if expected else 'missing')
    assert output['conflicting_labels'] is (len(stances) == 2)
    assert {key: len(ids) for key, ids in output['groups'].items()} == counter['group_counts']
    replayed = evolution.replay(production, ['counterevidence'], policy['payload'])
    assert replayed['computations']['counterevidence']['output_hash'] == digest(output)
    assert replayed['covered'] == (['counterevidence'] if expected else [])
    assert project_tools({'counterevidence': output})['counterevidence']['reason'] == output['reason']
    exported = actor.get('/runs/' + production['id'] + '/export?format=md')
    assert exported.status_code == 200
    readable = exported.text.split('完整已保存产物（包含输入、逐折与网格，未重新计算）')[0]
    if not expected:
        assert output['reason'] in readable
        assert any(issue['node'] == 'counterevidence' and issue['reason'] == output['reason']
                   for issue in production['result']['adaptive']['reflection']['issues'])
    assert '不证明有效反证、逻辑矛盾或事实正确性' in readable
    store = actor.client.app.state.store
    assert store.all('SELECT * FROM adaptive_calls') == []
    for run in runs:
        assert ok(actor.get('/runs/' + run['id'])) == run
    assert ws.get(store, actor.user['id'], 'strategy_evaluation', evaluated['id']) == evaluated


def test_needs_input_counts_only_for_actual_gap_planning(actor, example, monkeypatch):
    data = copy.deepcopy(example)
    data['source_kind'] = 'user_provided'
    data['periods'][-1]['cash_flow'] = None
    dataset = ok(actor.post('/datasets', json=data), 201)
    run = completed(actor, dataset=dataset, query='核验现金流并核对反向证据')
    gaps = run['result']['adaptive']['mathematical_outputs']['gaps']
    assert gaps['status'] == 'needs_input' and gaps['items']
    original = evolution.execute_local_capability

    def unmet_counter(capability, *args, **kwargs):
        out = original(capability, *args, **kwargs)
        # A future status rename must not turn an unsatisfied evidence request
        # into a completed rubric. Concrete gap planning still counts.
        return {**out, 'status': 'needs_input'} if capability == 'counterevidence' else out

    monkeypatch.setattr(evolution, 'execute_local_capability', unmet_counter)
    result = evolution.replay(run, ['gaps', 'counterevidence'], None)
    assert result['covered'] == ['gaps'] and result['missing'] == ['counterevidence']
    assert result['computations']['gaps']['output_hash'] == digest(gaps)
    assert result['math_hash'] == digest(run['result']['analysis'])


def legacy_counter(capability, *args, **kwargs):
    output = execute_local_capability(capability, *args, **kwargs)
    if capability == 'counterevidence':
        output = {'groups': output['groups'], 'conflicting_labels': output['conflicting_labels'],
                  'status': 'completed' if any(output['groups'].values()) else 'missing',
                  'limitation': '标签对照不是自动语义矛盾检测'}
    return output


def legacy_setup(actor, example, monkeypatch, *, activate=False, stacked=False, stances=('context',)):
    with monkeypatch.context() as legacy:
        legacy.setattr(evolution, 'REPLAY_VERSION', 'local-capability-replay-v4')
        legacy.setattr(evolution, 'execute_local_capability', legacy_counter)
        legacy.setattr(adaptive_runtime, 'execute_local_capability', legacy_counter)
        runs = three_cases(actor, example, stances=stances)
        historical = completed(actor, query='核验现金情况并核对反向证据')
        assert historical['result']['adaptive']['mathematical_outputs']['counterevidence']['status'] == 'completed'
        policy = candidate(actor, require_gap_analysis=stacked)
        evaluated = ok(actor.post('/workspace/strategies/' + policy['id'] + '/evaluate'), 201)
        assert evaluated['payload']['eligible']
        active = pending = None
        if activate:
            active = ok(actor.post('/workspace/strategies/' + policy['id'] + '/activate', json={
                'evaluation_id': evaluated['id'], 'expected_active_version': 0}))
            if stacked:
                second = candidate(actor, name='旧规则下减少额外节点', require_gap_analysis=False)
                second_eval = ok(actor.post('/workspace/strategies/' + second['id'] + '/evaluate'), 201)
                assert second_eval['payload']['eligible']
                active = ok(actor.post('/workspace/strategies/' + second['id'] + '/activate', json={
                    'evaluation_id': second_eval['id'], 'expected_active_version': active['version']}))
            pending = preview(actor)
    return runs, historical, policy, evaluated, active, pending


def assert_history_unchanged(actor, runs, historical, evaluations, assessments):
    store = actor.client.app.state.store
    for run in [*runs, historical]:
        assert store.owned('runs', actor.user['id'], run['id']) == run
        assert ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))['report_integrity']['valid']
    assert ws.objects(store, actor.user['id'], 'strategy_evaluation', 200) == evaluations
    assert ws.objects(store, actor.user['id'], 'assessment', 200) == assessments
    assert store.all('SELECT * FROM adaptive_calls') == []


def test_v4_success_is_historical_and_cannot_activate_without_new_replay(actor, example, monkeypatch):
    runs, historical, policy, evaluated, _, _ = legacy_setup(actor, example, monkeypatch)
    store = actor.client.app.state.store
    evaluations = ws.objects(store, actor.user['id'], 'strategy_evaluation', 200)
    assessments = ws.objects(store, actor.user['id'], 'assessment', 200)
    rejected = ok(actor.post('/workspace/strategies/' + policy['id'] + '/activate', json={
        'evaluation_id': evaluated['id'], 'expected_active_version': 0}), 409)
    assert rejected['error']['code'] == 'EVALUATION_STALE'
    current = ok(actor.get('/workspace/evolution'))
    assert current['active'] is None
    displayed = current['evaluations'][0]
    assert displayed['payload'] == evaluated['payload'] and displayed['payload']['eligible']
    assert displayed['implementation_context']['current'] is False
    assert '旧规则下的历史结果' in displayed['implementation_context']['message']
    assert_history_unchanged(actor, runs, historical, evaluations, assessments)
    fresh = ok(actor.post('/workspace/strategies/' + policy['id'] + '/evaluate'), 201)
    assert fresh['payload']['replay_version'] == evolution.REPLAY_VERSION != evaluated['payload']['replay_version']
    assert not fresh['payload']['eligible'] and not fresh['payload']['improvements']
    assert ok(actor.post('/workspace/strategies/' + policy['id'] + '/activate', json={
        'evaluation_id': fresh['id'], 'expected_active_version': 0}), 409)['error']['code'] == 'EVALUATION_BLOCKED'


@pytest.mark.parametrize('stacked', [False, True], ids=['active-old-policy', 'old-rollback-target'])
def test_v4_active_falls_back_truthfully_and_rollback_cannot_restore_it(actor, example, monkeypatch, stacked):
    runs, historical, policy, evaluated, active, pending = legacy_setup(actor, example, monkeypatch, activate=True, stacked=stacked)
    store = actor.client.app.state.store
    evaluations = ws.objects(store, actor.user['id'], 'strategy_evaluation', 200)
    assessments = ws.objects(store, actor.user['id'], 'assessment', 200)
    if stacked:
        rejected = ok(actor.post('/workspace/strategies/rollback', json={'expected_active_version': active['version']}), 409)
        assert rejected['error']['code'] == 'EVALUATION_STALE'
        assert '版本已变化' in rejected['error']['message']
    assert ok(execute(actor, pending), 409)['error']['code'] == 'PLAN_STALE'
    current = ok(actor.get('/workspace/evolution'))['active']
    assert current['version'] == active['version'] + 1 and current['payload']['spec'] is None
    assert current['payload']['invalidation_code'] == 'implementation_changed'
    assert '版本已变化' in current['payload']['invalidation_reason']
    assert '授权已变化' not in current['payload']['invalidation_reason']
    assert '撤回' not in current['payload']['invalidation_reason']
    audit = store.all("SELECT * FROM audit WHERE resource='strategy' AND action='invalidated'")
    assert audit[-1]['metadata']['reason'] == 'implementation_changed'
    assert ok(actor.post('/workspace/strategies/rollback', json={
        'expected_active_version': current['version']}), 409)['error']['code'] == 'EVALUATION_STALE'
    assert ws.get(store, actor.user['id'], 'plan', pending['id']) == pending
    fresh = preview(actor)['payload']['adaptive']
    assert fresh['strategy_basis'] == 'built_in_rules' and fresh['active_strategy_version'] == current['version']
    assert 'counterevidence' not in {node['id'] for node in fresh['nodes']}
    assert ok(actor.get('/workspace/evolution'))['active'] == current
    assert_history_unchanged(actor, runs, historical, evaluations, assessments)


def test_old_legitimate_labels_still_require_new_replay_and_explicit_activation(actor, example, monkeypatch):
    _, _, policy, evaluated, active, _ = legacy_setup(actor, example, monkeypatch, activate=True, stances=('contradicts',))
    current = ok(actor.get('/workspace/evolution'))['active']
    assert current['payload']['spec'] is None and current['version'] == active['version'] + 1
    fresh = ok(actor.post('/workspace/strategies/' + policy['id'] + '/evaluate'), 201)
    assert fresh['payload']['eligible']
    assert ok(actor.get('/workspace/evolution'))['active'] == current
    restored = ok(actor.post('/workspace/strategies/' + policy['id'] + '/activate', json={
        'evaluation_id': fresh['id'], 'expected_active_version': current['version']}))
    assert restored['payload']['evaluation_id'] == fresh['id'] != evaluated['id']
    assert restored['payload']['spec'] == policy['payload']
