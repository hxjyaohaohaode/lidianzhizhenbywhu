"""Governed replay rejects known-corrupt completed reports, with synthetic local fixtures only."""
import pytest

from server import evolution, workspace_store as ws
from test_adaptive import completed, preview
from test_evolution import assessment, candidate, three_cases
from test_report_source_integrity import corrupt, execute_unanchored_legacy
from test_strategy_source_lifecycle import activate, assert_revoked, execute as dispatch, ok
from test_workspace_api import execute, plan


CORRUPTIONS = ('artifact', 'nonfinal_artifact', 'artifact_rehashed', 'anchor_hash', 'ledger',
               'missing_terminal_event', 'missing_all_artifacts', 'malformed_event',
               'malformed_snapshot', 'result', 'dataset')


def consent_body(version=0, **changes):
    return {'version': version, 'verdict': 'needs_revision', 'note': '人工核对能力覆盖并明确本地回放范围',
            'expected_capabilities': ['quality', 'quant', 'counterevidence'], 'consent_replay': True, **changes}


@pytest.mark.parametrize('change', CORRUPTIONS)
def test_known_corruption_excludes_case_and_cannot_be_reconsented_without_writes(actor, change):
    run = completed(actor)
    saved = assessment(actor, run)
    store = actor.client.app.state.store
    corrupt(store, run, change)
    before_run = store.owned('runs', actor.user['id'], run['id'])
    before_objects = store.all('SELECT * FROM workspace_objects ORDER BY id')
    before_changes = store.db.total_changes
    audit = ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    assert not audit['report_integrity']['valid']
    assert evolution.current_case(store, actor.user['id'], saved) is None
    assert evolution.cases(store, actor.user['id']) == []
    rejected = ok(actor.post('/workspace/runs/' + run['id'] + '/assessment',
                             json=consent_body(saved['version'])), 409)
    assert rejected['error']['code'] == 'REPORT_INTEGRITY'
    assert store.all('SELECT * FROM workspace_objects ORDER BY id') == before_objects
    assert store.owned('runs', actor.user['id'], run['id']) == before_run
    assert store.db.total_changes == before_changes


def test_new_consent_to_already_corrupt_report_does_not_create_an_assessment(actor):
    run = completed(actor)
    store = actor.client.app.state.store
    corrupt(store, run, 'nonfinal_artifact')
    before = store.db.total_changes
    response = ok(actor.post('/workspace/runs/' + run['id'] + '/assessment', json=consent_body()), 409)
    assert response['error']['code'] == 'REPORT_INTEGRITY'
    assert ws.keyed(store, actor.user['id'], 'assessment', run['id']) is None
    assert store.db.total_changes == before


def test_artifact_corruption_blocks_saved_activation_and_is_excluded_from_fresh_evaluation(actor, example):
    runs = three_cases(actor, example)
    policy = candidate(actor)
    evaluated = ok(actor.post('/workspace/strategies/' + policy['id'] + '/evaluate'), 201)
    assert evaluated['payload']['eligible']
    store = actor.client.app.state.store
    corrupt(store, runs[0], 'nonfinal_artifact')
    before = store.all('SELECT * FROM workspace_objects ORDER BY id')
    response = ok(actor.post('/workspace/strategies/' + policy['id'] + '/activate', json={
        'evaluation_id': evaluated['id'], 'expected_active_version': 0}), 409)
    assert response['error']['code'] == 'EVALUATION_STALE'
    assert store.all('SELECT * FROM workspace_objects ORDER BY id') == before
    fresh = ok(actor.post('/workspace/strategies/' + policy['id'] + '/evaluate'), 201)
    assert fresh['payload']['unique_inputs'] == fresh['payload']['raw_consented_runs'] == 2
    assert not fresh['payload']['eligible']
    assert ws.get(store, actor.user['id'], 'strategy_evaluation', evaluated['id']) == evaluated


def test_corrupt_source_invalidates_future_policy_and_draft_but_retains_approved_run(actor, example):
    runs, evaluated, active = activate(actor, example)
    already_approved = ok(dispatch(actor, preview(actor)), 202)
    pending = preview(actor)
    store = actor.client.app.state.store
    corrupt(store, runs[0], 'missing_terminal_event')
    before_source = store.owned('runs', actor.user['id'], runs[0]['id'])
    assert ok(dispatch(actor, pending), 409)['error']['code'] == 'PLAN_STALE'
    ok(actor.get('/workspace/evolution'))
    assert_revoked(actor, active, pending, evaluated)
    assert store.owned('runs', actor.user['id'], already_approved['id']) == already_approved
    assert store.owned('runs', actor.user['id'], runs[0]['id']) == before_source


def test_rollback_rejects_corrupt_report_artifact_without_rewriting_history(actor, example):
    runs, _, first = activate(actor, example, require_gap_analysis=True)
    policy = candidate(actor, name='保留实际历史的精简候选', require_gap_analysis=False)
    evaluated = ok(actor.post('/workspace/strategies/' + policy['id'] + '/evaluate'), 201)
    second = ok(actor.post('/workspace/strategies/' + policy['id'] + '/activate', json={
        'evaluation_id': evaluated['id'], 'expected_active_version': first['version']}))
    store = actor.client.app.state.store
    corrupt(store, runs[0], 'nonfinal_artifact')
    before = store.all('SELECT * FROM workspace_objects ORDER BY id')
    response = ok(actor.post('/workspace/strategies/rollback', json={
        'expected_active_version': second['version']}), 409)
    assert response['error']['code'] == 'EVALUATION_STALE'
    assert store.all('SELECT * FROM workspace_objects ORDER BY id') == before


@pytest.mark.parametrize('change', ('nonfinal_artifact', 'malformed_snapshot', 'missing_result', 'result'))
def test_corrupt_report_does_not_prevent_consent_withdrawal_or_rewrite_frozen_assessment_basis(actor, change):
    run = completed(actor)
    saved = assessment(actor, run)
    store = actor.client.app.state.store
    corrupt(store, run, change)
    before_run = store.owned('runs', actor.user['id'], run['id'])
    withdrawn = ok(actor.post('/workspace/runs/' + run['id'] + '/assessment', json=consent_body(
        saved['version'], consent_replay=False, note='发现归档校验异常，明确撤回后续回放授权')))
    assert withdrawn['version'] == saved['version'] + 1
    assert not withdrawn['payload']['consent_replay']
    for field in ('snapshot_hash', 'result_hash', 'dataset_hash', 'request_hash'):
        assert withdrawn['payload'][field] == saved['payload'][field]
    assert store.owned('runs', actor.user['id'], run['id']) == before_run
    assert evolution.current_case(store, actor.user['id'], withdrawn) is None


@pytest.mark.parametrize('workflow', ('studio', 'adaptive', 'legacy', 'legacy_unanchored'))
def test_healthy_and_partial_legacy_reports_remain_eligible_case_inputs(actor, monkeypatch, workflow):
    dataset = actor.dataset()
    if workflow == 'legacy':
        run = actor.execute(ok(actor.run(dataset), 202))
    elif workflow == 'legacy_unanchored':
        run = execute_unanchored_legacy(actor, dataset, monkeypatch)
    else:
        run = execute(actor, plan(actor, dataset, **({'execution': {}} if workflow == 'adaptive' else {})))
    saved = assessment(actor, run)
    store = actor.client.app.state.store
    assert evolution.current_case(store, actor.user['id'], saved) == run
    assert len(evolution.cases(store, actor.user['id'])) == 1
    audit = ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    assert audit['report_integrity']['valid']
    if workflow == 'legacy_unanchored':
        assert audit['report_hash_valid'] is None
    assert store.owned('runs', actor.user['id'], run['id']) == run
