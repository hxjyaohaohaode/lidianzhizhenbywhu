"""Active planning policies never outlive their current consented replay sources."""
import copy

import pytest

from conftest import Actor
from server import workspace_store as ws
from server.store import encode
from test_adaptive import completed, preview
from test_evolution import assessment, candidate, three_cases


def ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def activate(actor, example, **options):
    runs = three_cases(actor, example)
    policy = candidate(actor, **options)
    evaluation = ok(actor.post('/workspace/strategies/' + policy['id'] + '/evaluate'), 201)
    assert evaluation['payload']['eligible']
    active = ok(actor.post('/workspace/strategies/' + policy['id'] + '/activate', json={
        'evaluation_id': evaluation['id'], 'expected_active_version': 0}))
    return runs, evaluation, active


def execute(actor, plan):
    return actor.post('/workspace/plans/' + plan['id'] + '/execute', json={
        'version': plan['version'], 'fingerprint': plan['payload']['fingerprint'], 'external_consent': False})


def delete_sessions(actor, sessions, batch):
    if batch:
        return actor.post('/conversations/delete-batch', json={
            'ids': [s['id'] for s in sessions], 'versions': {s['id']: s['version'] for s in sessions}})
    return actor.delete('/conversations/' + sessions[0]['id'], params={'version': sessions[0]['version']})


def assert_revoked(actor, active, plan, evaluation):
    store = actor.client.app.state.store
    current = ws.keyed(store, actor.user['id'], 'strategy_active', 'active')
    assert current['version'] == active['version'] + 1
    assert current['payload']['spec'] is None
    assert current['payload']['history'][-1]['evaluation_id'] == evaluation['id']
    rejected = ok(execute(actor, plan), 409)
    assert rejected['error']['code'] == 'PLAN_STALE'
    assert ws.get(store, actor.user['id'], 'plan', plan['id']) == plan
    assert ws.get(store, actor.user['id'], 'strategy_evaluation', evaluation['id']) == evaluation
    fresh = preview(actor)['payload']['adaptive']
    assert fresh['active_strategy_version'] == current['version']
    assert fresh['strategy_basis'] == 'built_in_rules'
    assert 'counterevidence' not in {n['id'] for n in fresh['nodes']}
    # Repeated reads must not advance an already-invalidated policy version.
    assert ok(actor.get('/workspace/evolution'))['active'] == current
    return current


@pytest.mark.parametrize('batch', [False, True])
def test_source_conversation_deletion_revokes_active_and_outstanding_plan(actor, example, batch):
    runs, evaluation, active = activate(actor, example)
    plan = preview(actor)
    assert plan['payload']['adaptive']['policy'] == active['payload']['spec']
    store = actor.client.app.state.store
    targets = runs[:2 if batch else 1]
    sessions = [store.owned('conversations', actor.user['id'], r['session_id']) for r in targets]
    ok(delete_sessions(actor, sessions, batch))
    assert_revoked(actor, active, plan, evaluation)
    for run in runs[len(targets):]:
        assert store.owned('runs', actor.user['id'], run['id']) == run
    assert store.all('PRAGMA foreign_key_check') == []


@pytest.mark.parametrize('change', [{'consent_replay': False}, {'note': '人工验收内容变更后需要重新评估'}])
def test_current_source_assessment_change_revokes_future_use_only(actor, example, change):
    runs, evaluation, active = activate(actor, example)
    plan = preview(actor)
    saved = ok(actor.get('/workspace/runs/' + runs[0]['id'] + '/assessment'))['item']
    assessment(actor, runs[0], version=saved['version'], **change)
    current = assert_revoked(actor, active, plan, evaluation)
    response = ok(actor.post('/workspace/strategies/rollback', json={
        'expected_active_version': current['version']}), 409)
    assert response['error']['code'] == 'EVALUATION_STALE'
    for run in runs:
        assert ok(actor.get('/runs/' + run['id'])) == run


@pytest.mark.parametrize('malformed',[None,[],{'history':None},{'history':7},{'history':'invalid'}])
@pytest.mark.parametrize('operation',['withdraw','delete'])
def test_malformed_active_history_cannot_prevent_source_revocation(actor,example,malformed,operation):
    runs,_,active=activate(actor,example)
    store=actor.client.app.state.store
    payload={**active['payload'],**malformed} if isinstance(malformed,dict) else malformed
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(payload),active['id']))
    if operation=='withdraw':
        saved=ok(actor.get('/workspace/runs/'+runs[0]['id']+'/assessment'))['item']
        assessment(actor,runs[0],version=saved['version'],consent_replay=False)
        assert not ws.keyed(store,actor.user['id'],'assessment',runs[0]['id'])['payload']['consent_replay']
    else:
        session=store.owned('conversations',actor.user['id'],runs[0]['session_id'])
        ok(delete_sessions(actor,[session],False))
        assert not store.owned('runs',actor.user['id'],runs[0]['id'])
    current=ws.keyed(store,actor.user['id'],'strategy_active','active')
    assert current['payload']['spec'] is None
    assert current['version']==active['version']+1


@pytest.mark.parametrize('batch', [False, True])
def test_unrelated_case_changes_and_foreign_deletion_do_not_revoke_policy(actor, example, batch):
    _, _, active = activate(actor, example)
    other = Actor(actor.client)
    unrelated = completed(actor)
    saved = assessment(actor, unrelated)
    # Adding and editing an assessment outside the original cohort is harmless.
    assessment(actor, unrelated, version=saved['version'], consent_replay=False)
    plan = preview(actor)
    store = actor.client.app.state.store
    session = store.owned('conversations', actor.user['id'], unrelated['session_id'])
    ok(delete_sessions(other, [session], batch), 404)
    ok(delete_sessions(actor, [{**session, 'version': session['version'] + 1}], batch), 409)
    ok(delete_sessions(actor, [session], batch))
    assert ws.keyed(store, actor.user['id'], 'strategy_active', 'active') == active
    assert ok(actor.get('/workspace/evolution'))['active'] == active
    ok(execute(actor, plan), 202)
    assert ws.keyed(store, other.user['id'], 'strategy_active', 'active') is None


@pytest.mark.parametrize('batch', [False, True])
def test_rejected_bound_source_deletion_leaves_active_and_all_bindings_intact(actor, example, batch):
    runs, _, active = activate(actor, example)
    other = Actor(actor.client)
    foreign = other.conversation()
    store = actor.client.app.state.store
    source = store.owned('conversations', actor.user['id'], runs[0]['session_id'])
    plan = preview(actor)
    before = store.all('SELECT * FROM workspace_objects ORDER BY id')
    ok(delete_sessions(other, [source], batch), 404)
    ok(delete_sessions(actor, [{**source, 'version': source['version'] + 1}], batch), 409)
    if batch:
        ok(delete_sessions(actor, [source, foreign], True), 404)
    assert store.all('SELECT * FROM workspace_objects ORDER BY id') == before
    assert ws.keyed(store, actor.user['id'], 'strategy_active', 'active') == active
    ok(execute(actor, plan), 202)


def test_one_owners_revocation_does_not_invalidate_another_owners_active_policy(actor, example):
    runs, _, active = activate(actor, example)
    other = Actor(actor.client)
    _, _, foreign_active = activate(other, example)
    foreign_plan = preview(other)
    saved = ok(actor.get('/workspace/runs/' + runs[0]['id'] + '/assessment'))['item']
    assessment(actor, runs[0], version=saved['version'], consent_replay=False)
    store = actor.client.app.state.store
    assert ws.keyed(store, actor.user['id'], 'strategy_active', 'active')['version'] == active['version'] + 1
    assert ok(other.get('/workspace/evolution'))['active'] == foreign_active
    ok(execute(other, foreign_plan), 202)


def test_reconsenting_a_source_requires_fresh_evaluation_and_explicit_activation(actor, example):
    runs, evaluation, active = activate(actor, example)
    saved = ok(actor.get('/workspace/runs/' + runs[0]['id'] + '/assessment'))['item']
    withdrawn = assessment(actor, runs[0], version=saved['version'], consent_replay=False)
    assessment(actor, runs[0], version=withdrawn['version'], consent_replay=True)
    current = ok(actor.get('/workspace/evolution'))['active']
    assert current['version'] == active['version'] + 1 and current['payload']['spec'] is None
    assert ok(actor.post('/workspace/strategies/rollback', json={
        'expected_active_version': current['version']}), 409)['error']['code'] == 'EVALUATION_STALE'
    candidate_id = active['payload']['candidate_id']
    fresh = ok(actor.post('/workspace/strategies/' + candidate_id + '/evaluate'), 201)
    restored = ok(actor.post('/workspace/strategies/' + candidate_id + '/activate', json={
        'evaluation_id': fresh['id'], 'expected_active_version': current['version']}))
    assert restored['payload']['spec'] == active['payload']['spec']
    assert restored['payload']['evaluation_id'] != evaluation['id']


@pytest.mark.parametrize('batch', [False, True])
def test_source_deletion_failure_rolls_back_policy_invalidation(actor, example, monkeypatch, batch):
    runs, _, active = activate(actor, example)
    store = actor.client.app.state.store
    sessions = [store.owned('conversations', actor.user['id'], r['session_id']) for r in runs[:2 if batch else 1]]
    before = store.all('SELECT * FROM workspace_objects ORDER BY id')
    audit = store.all('SELECT * FROM audit ORDER BY seq')
    original = store.audit

    def fail_root(db, user, resource, id, action, metadata=None):
        if resource == 'conversations' and id == sessions[-1]['id']:
            raise RuntimeError('isolated injected parent-deletion failure')
        return original(db, user, resource, id, action, metadata)

    monkeypatch.setattr(store, 'audit', fail_root)
    ok(delete_sessions(actor, sessions, batch), 500)
    assert store.all('SELECT * FROM workspace_objects ORDER BY id') == before
    assert store.all('SELECT * FROM audit ORDER BY seq') == audit
    assert ws.keyed(store, actor.user['id'], 'strategy_active', 'active') == active
    for run in runs:
        assert store.owned('runs', actor.user['id'], run['id']) == run


@pytest.mark.parametrize('mutation', ['deleted_run', 'withdrawn_consent', 'changed_result', 'changed_feedback'])
def test_consumption_gate_rejects_legacy_and_out_of_band_source_changes(actor, example, mutation):
    runs, evaluation, active = activate(actor, example)
    plan = preview(actor)
    store = actor.client.app.state.store
    run = runs[0]
    with store.transaction() as db:
        if mutation == 'deleted_run':
            db.execute('DELETE FROM runs WHERE id=?', (run['id'],))
        elif mutation == 'withdrawn_consent':
            saved = ws.keyed(store, actor.user['id'], 'assessment', run['id'])
            payload = {**saved['payload'], 'consent_replay': False}
            db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(payload), saved['id']))
        elif mutation == 'changed_result':
            result = copy.deepcopy(run['result'])
            result['analysis']['metrics']['gross_margin'] = .123456
            db.execute('UPDATE runs SET result=? WHERE id=?', (encode(result), run['id']))
        else:
            ws.save(store, db, actor.user['id'], 'claim_review', {
                'run_id': run['id'], 'verdict': 'rejected', 'note': '新增人工复核使原授权上下文失效'})
    # Dispatch itself must reject it even before an overview/new preview heals
    # the active pointer. Its failed transaction must not alter the old plan.
    assert ok(execute(actor, plan), 409)['error']['code'] == 'PLAN_STALE'
    ok(actor.get('/workspace/evolution'))
    assert_revoked(actor, active, plan, evaluation)


def test_rollback_replays_healthy_target_and_rejects_changed_replay_artifact(actor, example):
    _, first_evaluation, first = activate(actor, example, require_gap_analysis=True)
    second_policy = candidate(actor, name='减少多余节点的测试候选', require_gap_analysis=False)
    second_evaluation = ok(actor.post('/workspace/strategies/' + second_policy['id'] + '/evaluate'), 201)
    second = ok(actor.post('/workspace/strategies/' + second_policy['id'] + '/activate', json={
        'evaluation_id': second_evaluation['id'], 'expected_active_version': first['version']}))
    store = actor.client.app.state.store
    report = copy.deepcopy(first_evaluation['payload'])
    report['cases'][0]['candidate']['computation_hash'] = 'changed-artifact'
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(report), first_evaluation['id']))
    response = ok(actor.post('/workspace/strategies/rollback', json={
        'expected_active_version': second['version']}), 409)
    assert response['error']['code'] == 'EVALUATION_STALE'
    assert ws.keyed(store, actor.user['id'], 'strategy_active', 'active') == second
    # The same genuine activation history works after restoring only this
    # isolated tampering fixture; no production activation gate is bypassed.
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(first_evaluation['payload']), first_evaluation['id']))
    restored = ok(actor.post('/workspace/strategies/rollback', json={
        'expected_active_version': second['version']}))
    assert restored['payload']['evaluation_id'] == first_evaluation['id']
    assert preview(actor)['payload']['adaptive']['policy'] == first['payload']['spec']
