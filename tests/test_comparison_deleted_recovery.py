"""Deleted saved outcomes cannot be revived by an old creation retry."""
from copy import deepcopy
import pytest
from conftest import Actor
from test_saved_comparisons import inputs, spec
from test_services import ok


def test_saved_retry_then_deleted_retry_never_recreates_and_new_token_is_explicit(actor):
    ds=inputs(actor);body=spec(ds,request_id='synthetic-comparison-save-1')
    original=ok(actor.post('/workspace/comparisons',json=body),201)
    assert ok(actor.post('/workspace/comparisons',json=body),201)==original
    ok(actor.delete('/workspace/comparisons/'+original['id'],params={'version':original['version']}))
    store=actor.client.app.state.store;before=store.db.total_changes
    for _ in range(2):
        r=actor.post('/workspace/comparisons',json=body)
        assert r.status_code==409 and r.json()['error']['code']=='COMPARISON_REMOVED'
    changed=actor.post('/workspace/comparisons',json={**body,'name':'明确不同内容'})
    assert changed.status_code==409 and changed.json()['error']['code']=='IDEMPOTENCY_CONFLICT'
    assert ok(actor.get('/workspace/comparisons'))['items']==[] and store.db.total_changes==before
    receipt=store.one("SELECT metadata FROM audit WHERE user_id=? AND resource='comparison' AND resource_id=? AND action='deleted'",(actor.user['id'],original['id']))['metadata']
    assert receipt=={'version':1,'creation_request_id':body['request_id'],'creation_request_hash':original['payload']['creation_request_hash']}
    replacement=ok(actor.post('/workspace/comparisons',json={**body,'request_id':'synthetic-comparison-new-2'}),201)
    assert replacement['id']!=original['id']
    assert all(ok(actor.get('/datasets/'+d['id']))==d for d in ds)


def test_deleted_token_is_owner_scoped_and_precedes_current_source_checks(actor):
    ds=inputs(actor);body=spec(ds,request_id='synthetic-shared-token')
    row=ok(actor.post('/workspace/comparisons',json=body),201)
    ok(actor.delete('/workspace/comparisons/'+row['id'],params={'version':row['version']}))
    ok(actor.delete('/datasets/'+ds[1]['id'],params={'version':ds[1]['version']}))
    r=actor.post('/workspace/comparisons',json=body)
    assert r.status_code==409 and r.json()['error']['code']=='COMPARISON_REMOVED'
    other=Actor(actor.client);other_body=spec(inputs(other),request_id=body['request_id'])
    assert other.post('/workspace/comparisons',json=other_body).status_code==201


@pytest.mark.parametrize('failure', ['version','owner','csrf'])
def test_rejected_delete_does_not_create_a_tombstone(actor,failure):
    body=spec(inputs(actor),request_id='synthetic-retained-token');row=ok(actor.post('/workspace/comparisons',json=body),201)
    who=Actor(actor.client) if failure=='owner' else actor
    headers={'X-CSRF-Token':''} if failure=='csrf' else {}
    r=who.delete('/workspace/comparisons/'+row['id'],params={'version':2 if failure=='version' else 1},headers=headers)
    assert r.status_code=={'owner':404,'version':409,'csrf':403}[failure]
    assert ok(actor.post('/workspace/comparisons',json=body),201)==row


def test_malformed_unrelated_audit_does_not_hide_known_deleted_receipt(actor):
    body=spec(inputs(actor),request_id='synthetic-known-deleted-token');row=ok(actor.post('/workspace/comparisons',json=body),201)
    ok(actor.delete('/workspace/comparisons/'+row['id'],params={'version':1}))
    store=actor.client.app.state.store
    with store.transaction() as db:
        store.audit(db,actor.user['id'],'comparison','synthetic-unrelated','deleted',{'bad':'fixture'})
        db.execute("UPDATE audit SET metadata='{' WHERE resource_id='synthetic-unrelated'")
    r=actor.post('/workspace/comparisons',json=body)
    assert r.status_code==409 and r.json()['error']['code']=='COMPARISON_REMOVED'


@pytest.mark.parametrize('where',['comparison','comparison_request'])
@pytest.mark.parametrize('payload',['{','[]','{}','{"creation_request_hash":null}'])
def test_known_deletion_stays_reserved_when_one_receipt_body_is_damaged(actor,where,payload):
    body=spec(inputs(actor),request_id='synthetic-damaged-deleted-token');row=ok(actor.post('/workspace/comparisons',json=body),201)
    ok(actor.delete('/workspace/comparisons/'+row['id'],params={'version':1}))
    store=actor.client.app.state.store
    with store.transaction() as db:
        db.execute("UPDATE audit SET metadata=? WHERE user_id=? AND resource=? AND action='deleted'",(payload,actor.user['id'],where))
    before=store.db.total_changes
    r=actor.post('/workspace/comparisons',json=body)
    assert r.status_code==409 and r.json()['error']['code']=='COMPARISON_REMOVED'
    assert ok(actor.get('/workspace/comparisons'))['items']==[] and store.db.total_changes==before


def test_deleted_token_column_alone_still_blocks_when_both_metadata_bodies_are_damaged(actor):
    body=spec(inputs(actor),request_id='synthetic-two-damaged-bodies');row=ok(actor.post('/workspace/comparisons',json=body),201)
    ok(actor.delete('/workspace/comparisons/'+row['id'],params={'version':1}))
    store=actor.client.app.state.store
    with store.transaction() as db:
        db.execute("UPDATE audit SET metadata='{' WHERE user_id=? AND resource IN ('comparison','comparison_request') AND action='deleted'",(actor.user['id'],))
    before=store.db.total_changes;r=actor.post('/workspace/comparisons',json=body)
    assert r.status_code==409 and r.json()['error']['code']=='COMPARISON_REMOVED' and store.db.total_changes==before


def test_legacy_valid_json_receipt_still_reserves_old_token_without_new_binding_row(actor):
    body=spec(inputs(actor),request_id='synthetic-legacy-receipt');row=ok(actor.post('/workspace/comparisons',json=body),201)
    ok(actor.delete('/workspace/comparisons/'+row['id'],params={'version':1}))
    store=actor.client.app.state.store
    with store.transaction() as db:
        db.execute("DELETE FROM audit WHERE user_id=? AND resource='comparison_request'",(actor.user['id'],))
    r=actor.post('/workspace/comparisons',json=body)
    assert r.status_code==409 and r.json()['error']['code']=='COMPARISON_REMOVED'
