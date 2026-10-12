"""Current PR review findings; all rows are isolated synthetic fixtures."""
from copy import deepcopy

from conftest import editable
from server import saved_experiments
from server.schemas import MAX_SAFE_INTEGER
from server.store import encode


def test_deleted_thread_creation_token_cannot_revive_removed_history(actor):
    body = {'title': 'Synthetic deleted history', 'request_id': 'synthetic-thread-token-0001'}
    created = actor.post('/services/threads', json=body)
    assert created.status_code == 201, created.text
    row = created.json()
    assert actor.delete('/services/threads/' + row['id'] + '?version=' + str(row['version'])).status_code == 200
    retried = actor.post('/services/threads', json=body)
    assert retried.status_code == 409, retried.text
    assert actor.get('/services/threads').json()['items'] == []


def test_recalculated_experiment_with_invalid_creation_seal_cannot_enter_plan(actor):
    dataset = actor.dataset()
    body = {'dataset_id': dataset['id'], 'dataset_version': dataset['version'],
            'dataset_hash': dataset['content_hash'], 'kind': 'scenario',
            'name': 'Synthetic sealed calculation', 'price_change': .1, 'cost_change': .03,
            'volume_change': -.05, 'fixed_cost_share': .4, 'assumptions': 'Synthetic original assumptions',
            'request_id': 'synthetic-experiment-token-0001'}
    created = actor.post('/workspace/experiments', json=body)
    assert created.status_code == 201, created.text
    row = created.json()
    changed = deepcopy(row['payload'])
    changed['request']['price_change'] = .3
    changed['result'] = saved_experiments.calculate_experiment(changed)
    # Deliberate corruption only in this test's temporary DB; preserve original
    # creation hashes and version to test the seal instead of the recalculation.
    with actor.client.app.state.store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(changed), row['id']))
    current = actor.get('/workspace/experiments/' + row['id'])
    if current.status_code == 409:
        assert current.json()['error']['code'] == 'EXPERIMENT_INTEGRITY'
        return
    assert current.status_code == 200, current.text
    displayed = current.json()
    planned = actor.post('/workspace/plans', json={
        'dataset_id': dataset['id'], 'query': '经营毛利及现金研判', 'execution': {},
        'experiment': {'id': row['id'], 'version': displayed['version'], 'hash': displayed['experiment_hash']}})
    assert planned.status_code == 409, planned.text
    assert planned.json()['error']['code'] == 'EXPERIMENT_INTEGRITY'
    assert actor.get('/workspace/plans').json()['items'] == []


def test_explicit_unsupported_financial_operation_cannot_dispatch(actor):
    dataset = actor.dataset()
    preview = actor.post('/workspace/plans', json={'dataset_id': dataset['id'], 'query': '2025-Q4现金余额', 'execution': {}})
    assert preview.status_code == 201, preview.text
    plan = preview.json()
    dispatched = actor.post('/workspace/plans/' + plan['id'] + '/execute', json={
        'version': plan['version'], 'fingerprint': plan['payload']['fingerprint'], 'external_consent': False})
    assert dispatched.status_code == 409, dispatched.text
    assert actor.get('/runs').json()['items'] == []


def test_version_at_safe_integer_cap_cannot_be_incremented(actor):
    response = actor.post('/services/identities', json={'name': 'Synthetic version boundary'})
    assert response.status_code == 201, response.text
    row = response.json()
    with actor.client.app.state.store.transaction() as db:
        db.execute('UPDATE workspace_objects SET version=? WHERE id=?', (MAX_SAFE_INTEGER, row['id']))
    response = actor.put('/services/identities/' + row['id'], json={'name': 'Synthetic changed', 'version': MAX_SAFE_INTEGER})
    assert response.status_code == 409, response.text
    stored = actor.client.app.state.store.one('SELECT version FROM workspace_objects WHERE id=?', (row['id'],))
    assert stored['version'] == MAX_SAFE_INTEGER


def test_search_capture_cannot_add_unattested_publication_date(actor):
    text = 'Synthetic search snippet for the receipt boundary only. ' * 8
    class SearchDouble:
        def status(self):
            return {'configured': True}
        def search(self, query):
            return {'items': [{'title': 'Synthetic source', 'source_url': 'https://www.sse.com.cn/synthetic',
                              'text': text, 'retrieved_at': '2026-01-01T00:00:00Z',
                              'verification': 'search_snippet_unverified'}], 'rejected': 0, 'credits_reported': None}
    actor.client.app.state.research = SearchDouble()
    searched = actor.post('/research/search', json={'query': '毛利率', 'consent': True})
    assert searched.status_code == 200, searched.text
    item = searched.json()['items'][0]
    body = {key: item[key] for key in ('title', 'source_url', 'text', 'retrieved_at', 'search_receipt')}
    captured = actor.post('/evidence', json={**body, 'company': 'Synthetic company', 'published_at': '2026-01-01'})
    assert captured.status_code == 422, captured.text
    assert actor.get('/evidence').json()['items'] == []


# Negative coverage is deliberately broader than the five original reproductions.
import json
from concurrent.futures import ThreadPoolExecutor
from itertools import combinations
from unittest.mock import patch

import pytest
from conftest import Actor
from server.saved_experiments import verify_payload_seal, verified_result
from server.store import digest
from test_saved_experiments import save, reference


def test_thread_tombstone_is_owner_bound_atomic_and_allows_only_explicit_new_key(actor):
    body={'title':'Synthetic deleted scope','request_id':'thread-boundary-retry-0001'}
    first=actor.post('/services/threads',json=body).json();store=actor.client.app.state.store
    before=store.all('SELECT * FROM audit')
    assert actor.delete('/services/threads/'+first['id']+'?version=2').status_code==409
    assert store.all('SELECT * FROM audit')==before
    assert actor.post('/services/threads',json=body).json()['id']==first['id']
    assert actor.delete('/services/threads/'+first['id']+'?version=1').status_code==200
    before=store.all('SELECT * FROM audit')
    with ThreadPoolExecutor(max_workers=3) as pool:
        replies=list(pool.map(lambda _:actor.post('/services/threads',json=body),range(3)))
    assert all(r.status_code==409 and r.json()['error']['code']=='THREAD_REMOVED' for r in replies)
    assert actor.post('/services/threads',json={**body,'title':'Changed retry'}).json()['error']['code']=='IDEMPOTENCY_CONFLICT'
    assert store.all('SELECT * FROM audit')==before
    assert actor.get('/services/threads').json()['items']==[]
    tombstone=next(x for x in before if x['resource']=='assistant_thread_request')
    assert tombstone['resource_id']==body['request_id']
    assert set(tombstone['metadata'])=={'creation_request_hash'}
    assert actor.post('/services/threads',json={**body,'request_id':'thread-explicit-new-0002'}).status_code==201
    assert Actor(actor.client).post('/services/threads',json=body).status_code==201


@pytest.mark.parametrize('metadata',['{}','null','[]','not valid JSON',json.dumps({'creation_request_hash':'bad'})])
def test_damaged_thread_tombstone_never_revives_deleted_token(actor,metadata):
    body={'title':'Synthetic damaged tombstone','request_id':'thread-damaged-retry-0001'}
    row=actor.post('/services/threads',json=body).json();store=actor.client.app.state.store
    assert actor.delete('/services/threads/'+row['id']+'?version=1').status_code==200
    with store.transaction() as db:
        db.execute("UPDATE audit SET metadata=? WHERE resource IN ('assistant_thread','assistant_thread_request') AND action='deleted'",(metadata,))
    response=actor.post('/services/threads',json=body)
    assert response.status_code==409 and response.json()['error']['code']=='THREAD_CREATION_INTEGRITY'
    assert actor.get('/services/threads').json()['items']==[]


SEAL_FIELDS=('creation_request_id','creation_request_hash','creation_payload_hash','analysis_as_of','dataset_version','dataset_hash')
@pytest.mark.parametrize('removed',[combo for size in (1,2,len(SEAL_FIELDS)) for combo in combinations(SEAL_FIELDS,size)])
def test_stripping_modern_envelope_fields_is_untrusted_without_mutating_archive(actor,removed):
    d=actor.dataset();row=save(actor,d,request_id='modern-experiment-stripping-0001');payload=deepcopy(row['payload'])
    for key in removed:payload.pop(key)
    store=actor.client.app.state.store;raw=encode(payload)
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(raw,row['id']))
    changes=store.db.total_changes
    shown=actor.get('/workspace/experiments/'+row['id'])
    assert shown.status_code==200 and shown.json()['payload']==payload and not shown.json()['integrity']['valid']
    assert not actor.get('/workspace/experiments').json()['items'][0]['integrity']['valid']
    with patch('server.saved_experiments.calculate_experiment',side_effect=AssertionError('untrusted bytes must not calculate')):
        response=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'经营毛利研判','experiment':reference(shown.json())})
    assert response.status_code==409 and response.json()['error']['code']=='EXPERIMENT_INTEGRITY'
    assert store.db.total_changes==changes
    assert store.db.execute('SELECT payload FROM workspace_objects WHERE id=?',(row['id'],)).fetchone()[0]==raw


@pytest.mark.parametrize('version',[None,0,2,MAX_SAFE_INTEGER])
@pytest.mark.parametrize('strip_seal',[False,True])
def test_missing_or_changed_record_version_cannot_downgrade_seal(actor,version,strip_seal):
    row=save(actor,actor.dataset());payload=deepcopy(row['payload'])
    if strip_seal:
        for key in SEAL_FIELDS[:3]:payload.pop(key)
    with pytest.raises(ValueError):verify_payload_seal(payload,version)
    frozen={'payload':payload,'hash':digest(payload)}
    if version is not None:frozen['version']=version
    with pytest.raises((ValueError,KeyError)):verified_result(frozen)


@pytest.mark.parametrize('payload',[None,[],{'request':None}])
def test_unreadable_experiment_shape_does_not_hide_healthy_catalog_or_gain_execution(actor,payload):
    d=actor.dataset();bad=save(actor,d);good=save(actor,d);store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(payload),bad['id']))
    detail=actor.get('/workspace/experiments/'+bad['id'])
    assert detail.status_code==200 and detail.json()['payload']==payload and not detail.json()['integrity']['valid']
    catalog=actor.get('/workspace/experiments')
    assert catalog.status_code==200 and any(r['id']==good['id'] and r['integrity']['valid'] for r in catalog.json()['items'])
    response=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'经营毛利研判','experiment':reference(detail.json())})
    assert response.status_code==409 and response.json()['error']['code']=='EXPERIMENT_INTEGRITY'


@pytest.mark.parametrize('query',['2025-Q4现金余额','2025-Q4存货金额','2025-Q4研发费用','2025-Q4成本率','2025-Q4毛利金额增长率'])
def test_known_unsupported_operation_blocks_preview_and_legacy_scope_readmission(actor,query):
    from server.execution_scope import plan_scope_issue
    d=actor.dataset();response=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':query,'execution':{}})
    assert response.status_code==201,response.text
    p=response.json();assert p['payload']['snapshot']['research_scope']['status']=='blocked'
    response=actor.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']})
    assert response.status_code==409 and actor.get('/runs').json()['items']==[]
    assert plan_scope_issue(actor.client.app.state.store,p) is not None


def test_last_legal_version_update_and_cap_rejection_leave_data_and_audit_unchanged(actor):
    d=actor.dataset();store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE datasets SET version=? WHERE id=?',(MAX_SAFE_INTEGER-1,d['id']))
    d=actor.get('/datasets/'+d['id']).json();body=editable(d);body['notes']='Synthetic final permitted revision'
    response=actor.put('/datasets/'+d['id'],json=body)
    assert response.status_code==200 and response.json()['version']==MAX_SAFE_INTEGER
    before=store.all('SELECT * FROM audit');frozen=store.owned('datasets',actor.user['id'],d['id'])
    body=editable(response.json());body['notes']='Must not persist'
    response=actor.put('/datasets/'+d['id'],json=body)
    assert response.status_code==409 and response.json()['error']['code']=='VERSION_LIMIT'
    assert store.owned('datasets',actor.user['id'],d['id'])==frozen and store.all('SELECT * FROM audit')==before
    assert actor.delete('/datasets/'+d['id']+'?version='+str(MAX_SAFE_INTEGER)).status_code==200


@pytest.mark.parametrize('resource',['preferences','role','evidence','conversation'])
def test_direct_version_increment_routes_fail_before_any_mutation_at_cap(actor,resource):
    store=actor.client.app.state.store
    if resource in {'preferences','role'}:
        table='users';id=actor.user['id']
        path='/preferences'+('/role' if resource=='role' else '')
        body={'role':'analyst','version':MAX_SAFE_INTEGER}
        if resource=='preferences':body={**actor.user['preferences'],'name':'Synthetic changed','version':MAX_SAFE_INTEGER}
    elif resource=='evidence':
        row=actor.post('/evidence',json={'title':'Synthetic evidence','text':'Synthetic isolated text. '*20}).json()
        table='evidence';id=row['id'];path='/evidence/'+id+'/metadata';body={'title':'Changed','version':MAX_SAFE_INTEGER}
    else:
        d=actor.dataset();row=actor.conversation();table='conversations';id=row['id'];path='/runs'
        body={'dataset_id':d['id'],'session_id':id,'query':'经营毛利研判'}
    with store.transaction() as db:db.execute('UPDATE '+table+' SET version=? WHERE id=?',(MAX_SAFE_INTEGER,id))
    before=store.db.total_changes;raw=dict(store.db.execute('SELECT * FROM '+table+' WHERE id=?',(id,)).fetchone())
    response=actor.post(path,json=body,headers={'Idempotency-Key':'cap-synthetic-run'}) if resource=='conversation' else actor.put(path,json=body)
    assert response.status_code==409,response.text
    assert response.json()['error']['code']=='VERSION_LIMIT'
    assert store.db.total_changes==before and dict(store.db.execute('SELECT * FROM '+table+' WHERE id=?',(id,)).fetchone())==raw


@pytest.mark.parametrize('original,changed',[(None,'2025-01-01'),('2025-01-01',None),('2025-01-01','2025-02-01')])
def test_search_receipt_authenticates_exact_publication_date_and_explicit_edits_remain_audited(actor,original,changed):
    text='Synthetic publication provenance. '*20
    class Search:
        def status(self):return {'configured':True}
        def search(self,q):return {'items':[{'title':'Synthetic dated source','source_url':'https://www.sse.com.cn/synthetic','text':text,'retrieved_at':'2026-01-01T00:00:00Z','published_at':original,'verification':'search_snippet_unverified'}],'rejected':0,'credits_reported':None}
    actor.client.app.state.research=Search()
    item=actor.post('/research/search',json={'query':'毛利率','consent':True}).json()['items'][0]
    body={k:item[k] for k in ('title','source_url','text','retrieved_at','search_receipt','published_at')}
    rejected=actor.post('/evidence',json={**body,'published_at':changed})
    assert rejected.status_code==422 and rejected.json()['error']['code']=='INVALID_SEARCH_RECEIPT'
    assert actor.get('/evidence').json()['items']==[]
    accepted=actor.post('/evidence',json=body)
    assert accepted.status_code==201,accepted.text
    row=accepted.json();assert row['payload']['published_at']==original
    edited=actor.put('/evidence/'+row['id']+'/metadata',json={'title':body['title'],'source_url':body['source_url'],'published_at':changed,'version':row['version']})
    assert edited.status_code==200 and edited.json()['payload']['published_at']==changed
    assert actor.client.app.state.store.all("SELECT * FROM audit WHERE resource='evidence' AND action='updated'")


def test_private_connection_cap_refuses_rotation_before_encrypting_or_auditing(actor):
    from test_services import connection
    row=connection(actor).json();store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE private_connections SET version=? WHERE id=?',(MAX_SAFE_INTEGER,row['id']))
    original=store.one('SELECT * FROM private_connections WHERE id=?',(row['id'],));audit=store.all('SELECT * FROM audit')
    with patch('cryptography.fernet.Fernet.encrypt',side_effect=AssertionError('cap must reject before rotation')):
        response=actor.put('/services/connections/'+row['id'],json={'name':'Synthetic rotation','base_url':'https://models.test.example/v1','model':'fixture-model','api_key':'TEST-ONLY-ROTATION','password':actor.password,'version':MAX_SAFE_INTEGER})
    assert response.status_code==409 and response.json()['error']['code']=='VERSION_LIMIT'
    assert store.one('SELECT * FROM private_connections WHERE id=?',(row['id'],))==original and store.all('SELECT * FROM audit')==audit


@pytest.mark.parametrize('mode',['control','graph','dispatch_conversation'])
def test_adaptive_version_cap_cannot_overflow_or_partially_mutate_runtime(actor,mode):
    from fastapi import HTTPException
    from test_adaptive import preview,dispatch
    from server.adaptive_runtime import AdaptiveRun
    store=actor.client.app.state.store
    if mode=='dispatch_conversation':
        session=actor.conversation();p=preview(actor,session_id=session['id'])
        with store.transaction() as db:db.execute('UPDATE conversations SET version=? WHERE id=?',(MAX_SAFE_INTEGER,session['id']))
        before=store.db.total_changes
        response=actor.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']})
        assert response.status_code==409 and response.json()['error']['code']=='VERSION_LIMIT'
        assert store.db.total_changes==before and actor.get('/runs').json()['items']==[]
        return
    run=dispatch(actor,preview(actor));table='adaptive_controls' if mode=='control' else 'adaptive_graphs'
    with store.transaction() as db:
        db.execute('UPDATE '+table+' SET version=? WHERE run_id=?',(MAX_SAFE_INTEGER,run['id']))
        if mode=='graph':db.execute("UPDATE runs SET state='running' WHERE id=?",(run['id'],))
    before=store.db.total_changes
    if mode=='control':
        response=actor.post('/workspace/runs/'+run['id']+'/control',json={'version':MAX_SAFE_INTEGER,'action':'pause'})
        assert response.status_code==409 and response.json()['error']['code']=='VERSION_LIMIT'
    else:
        runtime=AdaptiveRun(actor.client.app.state.worker,run['id'])
        with pytest.raises(HTTPException) as error:runtime.graph_update('Synthetic cap')
        assert error.value.detail['code']=='VERSION_LIMIT' and runtime.version==MAX_SAFE_INTEGER
    assert store.db.total_changes==before
    assert store.one('SELECT version FROM '+table+' WHERE run_id=?',(run['id'],))['version']==MAX_SAFE_INTEGER


def test_import_commit_at_dataset_cap_preserves_preview_and_receipt_tables(actor):
    d=actor.dataset();store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE datasets SET version=? WHERE id=?',(MAX_SAFE_INTEGER,d['id']))
    body=editable(d);body.pop('version');body['notes']='Synthetic cap import'
    response=actor.post('/workspace/imports/preview',json={'dataset':body,'target_id':d['id'],'target_version':MAX_SAFE_INTEGER})
    assert response.status_code==201,response.text
    stage=response.json();before=store.db.total_changes
    response=actor.post('/workspace/imports/'+stage['id']+'/commit',json={'fingerprint':stage['payload']['fingerprint'],'version':stage['version']})
    assert response.status_code==409 and response.json()['error']['code']=='VERSION_LIMIT'
    assert store.db.total_changes==before
    assert actor.get('/datasets/'+d['id']).json()['version']==MAX_SAFE_INTEGER
    assert store.one('SELECT payload FROM workspace_objects WHERE id=?',(stage['id'],))['payload']['status']=='preview'


def test_watch_evaluation_revision_cap_never_wraps_or_leaves_partial_history(actor):
    from test_services import watch
    row=watch(actor,actor.dataset());store=actor.client.app.state.store;p=deepcopy(row['payload']);p['evaluation_revision']=MAX_SAFE_INTEGER
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(p),row['id']))
    from server.service_contracts import WatchSpec
    body={key:value for key,value in p.items() if key in WatchSpec.model_fields and key not in ('source_ref','request_id')}
    body.update(version=row['version'],threshold=.01)
    before=store.db.total_changes
    response=actor.put('/services/watches/'+row['id'],json=body)
    assert response.status_code==409 and response.json()['error']['code']=='VERSION_LIMIT'
    assert store.db.total_changes==before and store.one('SELECT payload FROM workspace_objects WHERE id=?',(row['id'],))['payload']==p


def test_concurrent_last_permitted_identity_revision_has_one_winner(actor):
    row=actor.post('/services/identities',json={'name':'Synthetic last revision'}).json();store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET version=? WHERE id=?',(MAX_SAFE_INTEGER-1,row['id']))
    def update(name):return actor.put('/services/identities/'+row['id'],json={'name':name,'version':MAX_SAFE_INTEGER-1})
    with ThreadPoolExecutor(max_workers=2) as pool:replies=list(pool.map(update,['Synthetic A','Synthetic B']))
    assert sorted(r.status_code for r in replies)==[200,409]
    assert store.one('SELECT version FROM workspace_objects WHERE id=?',(row['id'],))['version']==MAX_SAFE_INTEGER
    assert actor.delete('/services/identities/'+row['id']+'?version='+str(MAX_SAFE_INTEGER)).status_code==200
