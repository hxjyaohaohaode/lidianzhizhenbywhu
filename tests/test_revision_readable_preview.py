"""Validated original values and source receipts are readable before recovery."""
from copy import deepcopy
import json
import pytest
from conftest import Actor
from server.store import encode,digest
from test_workspace_scope import ok
from test_workspace_analytics import series


def imported(actor):
    p=ok(actor.post('/workspace/imports/preview',json={'dataset':series(8)}),201)
    return ok(actor.post('/workspace/imports/'+p['id']+'/commit',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']}),201)


def test_revision_returns_exact_original_values_not_changed_current_input(actor):
    original=imported(actor);store=actor.client.app.state.store
    before=deepcopy(original['payload'])
    changed=deepcopy(before);changed['periods'][-1]['cost']+=123
    with store.transaction() as db:
        db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(changed),original['id']))
    total=store.db.total_changes
    history=ok(actor.get('/workspace/datasets/'+original['id']+'/revisions'))['items']
    assert len(history)==1 and history[0]['integrity_valid']
    assert history[0]['snapshot']==before and history[0]['snapshot']!=changed
    assert history[0]['snapshot']['amount_unit']=='yuan'
    assert history[0]['import_receipt']['integrity_valid']
    assert history[0]['import_receipt']['payload']['dataset_hash']==original['content_hash']
    assert store.db.total_changes==total
    assert Actor(actor.client).get('/workspace/datasets/'+original['id']+'/revisions').status_code==404


@pytest.mark.parametrize('damage',['bad_json','wrong_hash','wrong_version','wrong_dataset'])
def test_broken_receipt_is_metadata_only_and_does_not_hide_sound_revision(actor,damage):
    original=imported(actor);store=actor.client.app.state.store
    row=store.one('SELECT * FROM dataset_import_receipts WHERE dataset_id=?',(original['id'],));p=deepcopy(row['payload'])
    if damage=='wrong_version':p['dataset_version']+=1
    if damage=='wrong_dataset':p['dataset_id']='other'
    payload='not json' if damage=='bad_json' else encode(p)
    hash='x'*64 if damage=='wrong_hash' else digest(p)
    with store.transaction() as db:db.execute('UPDATE dataset_import_receipts SET payload=?,content_hash=? WHERE dataset_id=?',(payload,hash,original['id']))
    total=store.db.total_changes
    r=ok(actor.get('/workspace/datasets/'+original['id']+'/revisions'))['items'][0]
    assert r['integrity_valid'] and r['snapshot']==original['payload']
    assert r['import_receipt']['integrity_valid'] is False and 'payload' not in r['import_receipt']
    assert store.db.total_changes==total


def test_bad_historical_financial_bytes_never_become_readable_preview(actor):
    original=imported(actor);store=actor.client.app.state.store
    p=deepcopy(original['payload']);p['periods'][-1]['cost']+=1
    with store.transaction() as db:db.execute('UPDATE dataset_revisions SET payload=? WHERE dataset_id=?',(encode(p),original['id']))
    r=ok(actor.get('/workspace/datasets/'+original['id']+'/revisions'))['items'][0]
    assert r['integrity_valid'] is False and r['snapshot'] is None and r['diff']==[]
    assert actor.post('/workspace/datasets/'+original['id']+'/restore',json={'version':1,'target_revision':1}).status_code==409
