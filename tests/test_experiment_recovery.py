"""Durable create receipts; isolated TestClient only, no listeners or providers."""
from concurrent.futures import ThreadPoolExecutor
import copy
from unittest.mock import patch
from fastapi.testclient import TestClient
import pytest
from conftest import Actor, editable
from test_saved_experiments import long_dataset
from server.app import make_app
from server.config import Settings
from server.store import encode, digest
from server import workspace_store as ws


def request(d, **extra):
    return {'request_id': 'experiment-recovery-0001', 'dataset_id': d['id'],
            'dataset_version': d['version'], 'dataset_hash': d['content_hash'],
            'kind': 'scenario', 'name': '隔离重试实验', 'assumptions': '测试明确的原始假设',
            'price_change': .1, 'fixed_cost_share': .4, **extra}


def post(actor, body):
    return actor.post('/workspace/experiments', json=body)


def rows(actor):
    return actor.client.app.state.store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='experiment'", (actor.user['id'],))


@pytest.mark.parametrize('kind', ['scenario', 'forecast'])
def test_exact_retry_keeps_original_outcome_without_recalculation_or_audit(actor, kind):
    d=long_dataset(actor) if kind=='forecast' else actor.dataset()
    body=request(d, kind=kind); first=post(actor,body)
    assert first.status_code==201,first.text
    store=actor.client.app.state.store; audit=store.all('SELECT * FROM audit')
    # Models normalize explicit defaults and omitted defaults to one request.
    with patch('server.saved_experiments.create_payload',side_effect=AssertionError('retry must not calculate')):
        repeated=post(actor,{**body,'cost_change':0.0,'target_period':None,'metric':'revenue','horizon':2})
    assert repeated.status_code==201 and repeated.json()==first.json()
    assert store.all('SELECT * FROM audit')==audit and len(rows(actor))==1
    assert first.json()['payload']['creation_request_id']==body['request_id']
    assert 'request_id' not in first.json()['payload']['request']


@pytest.mark.parametrize('change', [{'name':'另一个实验'}, {'assumptions':'不同的实验边界'},
    {'price_change':.2}, {'kind':'forecast'}, {'target_period':'2024-Q1'},
    {'dataset_version':2}, {'dataset_hash':'0'*64}, {'metric':'cash_flow'}, {'horizon':3}])
def test_same_key_conflicts_on_any_normalized_request_change(actor, change):
    d=actor.dataset();body=request(d);assert post(actor,body).status_code==201
    response=post(actor,{**body,**change})
    assert response.status_code==409 and response.json()['error']['code']=='IDEMPOTENCY_CONFLICT'
    assert len(rows(actor))==1


def test_explicit_new_request_allowed_and_legacy_requests_remain_independent(actor):
    d=actor.dataset();body=request(d)
    first=post(actor,body).json();second=post(actor,{**body,'request_id':'experiment-recovery-0002'}).json()
    assert first['id']!=second['id']
    del body['request_id']
    assert post(actor,body).json()['id']!=post(actor,body).json()['id']


def test_retry_is_owner_bound_and_cross_dataset_reuse_conflicts(actor):
    d=actor.dataset();body=request(d);first=post(actor,body).json()
    second=actor.dataset()
    assert post(actor,request(second)).json()['error']['code']=='IDEMPOTENCY_CONFLICT'
    other=Actor(actor.client)
    assert post(other,body).status_code==404
    assert other.get('/workspace/experiments/'+first['id']).status_code==404
    own=post(other,request(other.dataset()))
    assert own.status_code==201 and own.json()['id']!=first['id']


def test_retry_survives_input_changes_and_capacity_but_new_writes_still_validate(actor):
    d=actor.dataset();body=request(d);first=post(actor,body).json()
    changed=editable(d);changed['notes']+='修订';assert actor.put('/datasets/'+d['id'],json=changed).status_code==200
    assert post(actor,body).json()==first
    stale=post(actor,{**body,'request_id':'new-stale-request'})
    assert stale.status_code==409 and stale.json()['error']['code']=='EXPERIMENT_STALE'
    store=actor.client.app.state.store
    with store.transaction() as db:
        for _ in range(199):ws.save(store,db,actor.user['id'],'experiment',first['payload'])
    assert len(rows(actor))==200
    assert post(actor,body).json()==first
    current=actor.get('/datasets/'+d['id']).json()
    full=post(actor,request(current,request_id='new-capacity-request'))
    assert full.status_code==409 and full.json()['error']['code']=='RESOURCE_LIMIT'


def test_deleted_receipt_never_recreates_old_submission(actor):
    body=request(actor.dataset());first=post(actor,body).json()
    assert actor.delete('/workspace/archive/experiment/'+first['id']+'?version=1').status_code==200
    store=actor.client.app.state.store;audit=store.all('SELECT * FROM audit')
    removed=post(actor,body)
    assert removed.status_code==409 and removed.json()['error']['code']=='EXPERIMENT_REMOVED'
    assert post(actor,{**body,'name':'改动原提交'}).json()['error']['code']=='IDEMPOTENCY_CONFLICT'
    assert rows(actor)==[] and store.all('SELECT * FROM audit')==audit
    tombstone=audit[-1]['metadata']
    assert set(tombstone)=={'creation_request_id','creation_request_hash'}
    replacement=post(actor,{**body,'request_id':'explicit-new-after-delete'})
    assert replacement.status_code==201 and replacement.json()['id']!=first['id']


def test_concurrent_equal_submissions_commit_once(actor):
    body=request(actor.dataset())
    with ThreadPoolExecutor(max_workers=4) as pool:
        replies=list(pool.map(lambda _:post(actor,body),range(4)))
    assert all(r.status_code==201 for r in replies)
    assert all(r.json()==replies[0].json() for r in replies)
    assert len(rows(actor))==1
    assert len(actor.client.app.state.store.all("SELECT * FROM audit WHERE resource='experiment' AND action='created'"))==1


def test_retry_receipt_and_deletion_tombstone_survive_fresh_app_store(tmp_path):
    settings=Settings(data_dir=tmp_path/'restart',origin='http://testserver')
    with TestClient(make_app(settings,worker_enabled=False)) as initial:
        actor=Actor(initial);body=request(actor.dataset());first=post(actor,body).json()
    with TestClient(make_app(settings,worker_enabled=False)) as restarted:
        actor.client=restarted
        assert post(actor,body).json()==first
        assert actor.delete('/workspace/archive/experiment/'+first['id']+'?version=1').status_code==200
    with TestClient(make_app(settings,worker_enabled=False)) as after_delete:
        actor.client=after_delete
        assert post(actor,body).json()['error']['code']=='EXPERIMENT_REMOVED'


@pytest.mark.parametrize('key', ['', 'short', '../bad-request', 'x'*81])
def test_invalid_keys_rejected_without_persistence(actor,key):
    response=post(actor,request(actor.dataset(),request_id=key))
    assert response.status_code==422 and rows(actor)==[]


@pytest.mark.parametrize('corruption', ['request','request_and_its_hash','result','snapshot',
    'dataset_version','dataset_hash','target_period','analysis_as_of','creation_request_id',
    'creation_request_hash','missing_envelope','bad_envelope','record_version','malformed_payload'])
def test_retry_rejects_changed_or_incomplete_creation_envelope_without_recalculation(actor,corruption):
    body=request(actor.dataset());first=post(actor,body).json();payload=copy.deepcopy(first['payload'])
    if corruption in {'request','request_and_its_hash'}:
        payload['request']['name']='被改变的实验名称'
        if corruption=='request_and_its_hash':payload['creation_request_hash']=digest(payload['request'])
    elif corruption=='result':payload['result']['result']['revenue']+=1
    elif corruption=='snapshot':payload['snapshot']['periods'][-1]['revenue']+=1
    elif corruption=='dataset_version':payload['dataset_version']+=1
    elif corruption=='dataset_hash':payload['dataset_hash']='f'*64
    elif corruption=='target_period':payload['target_period']='2001-Q1'
    elif corruption=='analysis_as_of':payload['analysis_as_of']='2001-01-01'
    elif corruption=='creation_request_id':payload['creation_request_id']='different-request-key'
    elif corruption=='creation_request_hash':payload['creation_request_hash']='f'*64
    elif corruption=='missing_envelope':payload.pop('creation_payload_hash')
    elif corruption=='bad_envelope':payload['creation_payload_hash']='f'*64
    elif corruption=='malformed_payload':payload=[]
    store=actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=?,version=? WHERE id=?', (encode(payload),2 if corruption=='record_version' else 1,first['id']))
    before=rows(actor);audit=store.all('SELECT * FROM audit')
    with patch('server.saved_experiments.calculate_experiment',side_effect=AssertionError('no retry calculation')):
        response=post(actor,body)
    assert response.status_code==409 and response.json()['error']['code']=='EXPERIMENT_INTEGRITY'
    assert rows(actor)==before and store.all('SELECT * FROM audit')==audit


def test_parent_dataset_removal_retains_verified_original_and_token_scope(actor):
    d=actor.dataset();body=request(d);first=post(actor,body).json()
    assert actor.delete('/datasets/'+d['id']+'?version=1').status_code==200
    assert post(actor,body).json()==first
    changed=post(actor,request(actor.dataset()))
    assert changed.status_code==409 and changed.json()['error']['code']=='IDEMPOTENCY_CONFLICT'
