"""Saved-comparison cleanup uses temporary accounts and actual authenticated APIs."""
from copy import deepcopy

from conftest import Actor
from test_saved_comparisons import inputs, saved, spec, reference
from test_services import identity, thread, proposal, confirm, ok
from test_copilot_research_inputs import execute_proposal


def test_account_comparison_capacity_is_released_only_by_valid_owned_delete(actor):
    ds = inputs(actor)
    ident = identity(actor, dataset_ids=[d['id'] for d in ds])
    rows = [saved(actor, ds, name=f'容量边界合成对照 {i}',
                  identity_id=ident['id'] if i % 2 else '') for i in range(200)]
    for scope in ('', ident['id']):
        response = actor.post('/workspace/comparisons', json=spec(ds, identity_id=scope))
        assert response.status_code == 409 and response.json()['error']['code'] == 'RESOURCE_LIMIT'
        assert len(ok(actor.get('/workspace/comparisons', params={'identity_id': scope}))['items']) == 100
    target = rows[1]
    path = '/workspace/comparisons/' + target['id']
    params = {'identity_id': ident['id'], 'version': target['version']}
    other = Actor(actor.client)
    # A different account's capacity and record remain independent.
    other_record = saved(other, inputs(other))
    assert other.delete(path, params=params).status_code == 404
    assert actor.delete(path, params={**params, 'identity_id': ''}).status_code == 403
    assert actor.delete(path, params={'identity_id': ident['id']}).status_code == 428
    assert actor.delete(path, params={**params, 'version': target['version'] + 1}).status_code == 409
    assert actor.delete(path, params=params, headers={'X-CSRF-Token': ''}).status_code == 403
    assert ok(actor.get(path, params={'identity_id': ident['id']}))['payload'] == target['payload']
    removed = ok(actor.delete(path, params=params))
    assert removed['deleted'] is True
    assert actor.delete(path, params=params).status_code == 404
    assert actor.get(path, params={'identity_id': ident['id']}).status_code == 404
    replacement = saved(actor, ds, name='清理后实际恢复的容量')
    assert replacement['id'] != target['id']
    assert actor.post('/workspace/comparisons', json=spec(ds)).status_code == 409
    assert ok(other.get('/workspace/comparisons'))['items'][0]['id'] == other_record['id']
    assert all(ok(actor.get('/datasets/' + d['id'])) == d for d in ds)


def test_deleted_comparison_invalidates_new_research_but_keeps_chat_history(actor):
    ds = inputs(actor); comparison = saved(actor, ds); conversation = thread(actor, ds[0])
    first = ok(proposal(actor, conversation, comparison_artifact=reference(comparison)), 201)
    run = execute_proposal(actor, first)
    frozen = deepcopy(run['result'])
    pending = ok(proposal(actor, conversation, text='继续核查企业经营风险与可比口径',
                          request_id='cleanup-pending-research', comparison_artifact=reference(comparison)), 201)
    ok(actor.delete('/workspace/comparisons/' + comparison['id'],
                    params={'identity_id': '', 'version': comparison['version']}))
    assert ok(actor.get('/workspace/comparisons'))['items'] == []
    rejected = confirm(actor, pending)
    assert rejected.status_code == 409 and rejected.json()['error']['code'] == 'PLAN_STALE'
    assert proposal(actor, conversation, request_id='cleanup-new-research',
                    comparison_artifact=reference(comparison)).status_code == 404
    loaded = ok(actor.get('/services/threads/' + conversation['id']))
    current = next(r for r in loaded['runs'] if r['id'] == run['id'])
    assert current['result'] == frozen
    assert current['source_impact']['state'] == 'unavailable'
    assert any(r['code'] == 'comparison_removed' for r in current['source_impact']['reasons'])
    assert ok(actor.get('/runs/' + run['id']))['result'] == frozen
    assert ok(confirm(actor, first))['payload']['result']['run_id'] == run['id']
    assert len(actor.client.app.state.store.all('SELECT * FROM runs')) == 1


def test_existing_owner_delete_can_cleanup_orphan_without_reviving_identity(actor):
    ds = inputs(actor); ident = identity(actor, dataset_ids=[d['id'] for d in ds])
    for index in range(200):
        saved(actor, ds, identity_id=ident['id'], name=f'失效身份容量合成记录 {index}')
    ok(actor.delete('/services/identities/' + ident['id'], params={'version': ident['version']}))
    history = ok(actor.get('/services/history'))
    archived = next(r for r in history['items'] if r['kind'] == 'comparison')
    assert archived['read_only'] and archived['identity_id'] == ident['id']
    assert archived['source_impact']['state'] == 'unavailable'
    assert actor.post('/workspace/comparisons', json=spec(ds)).json()['error']['code'] == 'RESOURCE_LIMIT'
    path = '/workspace/comparisons/' + archived['id']
    params = {'identity_id': ident['id'], 'version': archived['version']}
    assert Actor(actor.client).delete(path, params=params).status_code == 404
    assert actor.delete(path, params={**params, 'identity_id': ''}).status_code == 403
    assert actor.delete(path, params={**params, 'version': 2}).status_code == 409
    ok(actor.delete(path, params=params))
    assert not any(r['id'] == archived['id'] for r in ok(actor.get('/services/history'))['items'])
    replacement = saved(actor, ds, name='清理孤立身份对照后恢复容量')
    assert replacement['payload']['identity_id'] == ''
    assert actor.post('/workspace/comparisons', json=spec(ds)).json()['error']['code'] == 'RESOURCE_LIMIT'
    assert ok(actor.get('/services/identities'))['items'] == []
    assert actor.post('/workspace/comparisons', json=spec(ds, identity_id=ident['id'])).status_code == 404
