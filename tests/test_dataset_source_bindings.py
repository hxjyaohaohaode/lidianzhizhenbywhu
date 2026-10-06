"""Reviewed dataset contracts over authenticated API writes; isolated fixtures only."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Event
import sqlite3
import pytest
from fastapi import HTTPException
from conftest import Actor, dataset_ref, editable
from server import business_provenance
from server.store import digest, encode, now
from test_services import identity, thread


PATHS={'action':'/workspace/actions','watch':'/services/watches'}


def body(kind,d):
    value={'title':'按已查看的数据版本保存','dataset_id':d['id'],'source_ref':dataset_ref(d)}
    if kind=='action':value['acceptance']='核对原始数据版本并记录验收结果'
    else:value.update(metric='cash_ratio',operator='lt',threshold=0.1)
    return value


def snapshot(actor):
    store=actor.client.app.state.store
    return {table:store.all('SELECT * FROM '+table+' ORDER BY rowid') for table in
            ('datasets','dataset_revisions','workspace_objects','audit')}


def revise(actor,d):
    value=editable(d);value['periods'][-1]['revenue']+=100
    result=actor.put('/datasets/'+d['id'],json=value)
    assert result.status_code==200,result.text
    return result.json()


@pytest.mark.parametrize('kind',PATHS)
@pytest.mark.parametrize('missing',['reference','null','both','dataset_version','dataset_hash'])
def test_incomplete_dataset_origins_rejected_without_any_write(actor,kind,missing):
    d=actor.dataset();request=body(kind,d)
    if missing=='reference':request.pop('source_ref')
    elif missing=='null':request['source_ref']=None
    else:
        for field in (['dataset_version','dataset_hash'] if missing=='both' else [missing]):
            request['source_ref'].pop(field)
    before=snapshot(actor)
    result=actor.post(PATHS[kind],json=request)
    assert result.status_code==422,result.text
    assert snapshot(actor)==before


@pytest.mark.parametrize('kind',PATHS)
@pytest.mark.parametrize('patch',[{'dataset_version':None},{'dataset_hash':None},
    {'dataset_version':True},{'dataset_version':'1'},{'dataset_version':1.0},
    {'dataset_version':0},{'dataset_version':2**53},{'dataset_hash':'x'}, {'dataset_hash':''}])
def test_invalid_dataset_bindings_never_become_latest_revision(actor,kind,patch):
    d=actor.dataset();request=body(kind,d);request['source_ref'].update(patch)
    before=snapshot(actor)
    assert actor.post(PATHS[kind],json=request).status_code==422
    assert snapshot(actor)==before


@pytest.mark.parametrize('kind',PATHS)
@pytest.mark.parametrize('historical',[False,True])
@pytest.mark.parametrize('bad',['old_revision','wrong_hash','wrong_version'])
def test_complete_stale_binding_is_conflict_even_with_historical_ack(actor,kind,historical,bad):
    d=actor.dataset();request=body(kind,d)
    if bad=='old_revision':revise(actor,d)
    elif bad=='wrong_hash':request['source_ref']['dataset_hash']='0'*64
    else:request['source_ref']['dataset_version']+=1
    request['source_ref']['allow_historical']=historical
    before=snapshot(actor);result=actor.post(PATHS[kind],json=request)
    assert result.status_code==409 and result.json()['error']['code']=='SOURCE_CHANGED',result.text
    assert snapshot(actor)==before


@pytest.mark.parametrize('kind',PATHS)
def test_exact_binding_is_owner_and_identity_scoped(actor,kind):
    d=actor.dataset();other=Actor(actor.client);other_d=other.dataset()
    # Identical content/revision cannot substitute for ownership of the dataset ID.
    assert dataset_ref(other_d)==dataset_ref(d)
    before=snapshot(other)
    assert other.post(PATHS[kind],json=body(kind,d)).status_code==404
    assert snapshot(other)==before
    lens=identity(actor,d);outside=actor.dataset();request=body(kind,outside);request['identity_id']=lens['id']
    before=snapshot(actor)
    assert actor.post(PATHS[kind],json=request).status_code==403
    assert snapshot(actor)==before
    result=actor.post(PATHS[kind],json=body(kind,d));assert result.status_code==201,result.text
    p=result.json()['payload']['provenance']
    assert (p['dataset_id'],p['dataset_version'],p['dataset_hash'])==(d['id'],d['version'],d['content_hash'])


@pytest.mark.parametrize('kind',PATHS)
def test_missing_dataset_is_not_stale_or_historical_authority(actor,kind):
    d=actor.dataset();request=body(kind,d);request['source_ref']['allow_historical']=True
    assert actor.delete('/datasets/'+d['id'],params={'version':d['version']}).status_code==200
    before=snapshot(actor)
    assert actor.post(PATHS[kind],json=request).status_code==404
    assert snapshot(actor)==before


@pytest.mark.parametrize('kind',PATHS)
def test_exact_idempotent_retry_retains_original_revision_after_change(actor,kind):
    d=actor.dataset();request={**body(kind,d),'request_id':'dataset-source-retry-01'}
    first=actor.post(PATHS[kind],json=request);assert first.status_code==201,first.text
    first=first.json();current=revise(actor,d);before=snapshot(actor)
    retry=actor.post(PATHS[kind],json=request);assert retry.status_code==201,retry.text
    assert retry.json()['payload']==first['payload'] and retry.json()['id']==first['id']
    assert retry.json()['source_impact']['state']=='changed'
    assert snapshot(actor)==before
    changed={**request,'source_ref':dataset_ref(current)}
    assert actor.post(PATHS[kind],json=changed).status_code==409
    assert actor.post(PATHS[kind],json={**request,'request_id':'dataset-source-retry-02'}).status_code==409
    assert snapshot(actor)==before


def test_manual_action_and_versioned_watch_edit_preserve_their_distinct_contracts(actor):
    manual=actor.post(PATHS['action'],json={'title':'不绑定企业的人工行动','acceptance':'完成后记录具体人工核验说明'})
    assert manual.status_code==201 and manual.json()['payload']['provenance']['kind']=='manual'
    d=actor.dataset();watch=actor.post(PATHS['watch'],json=body('watch',d)).json();revise(actor,d)
    fields=('title','identity_id','dataset_id','metric','operator','threshold','active','stale_after_days','expires_at')
    update={k:watch['payload'][k] for k in fields};update.update(version=watch['version'],active=False)
    saved=actor.put(PATHS['watch']+'/'+watch['id'],json=update);assert saved.status_code==200,saved.text
    assert saved.json()['payload']['provenance']==watch['payload']['provenance']
    assert saved.json()['source_impact']['state']=='changed'
    assert actor.put(PATHS['watch']+'/'+watch['id'],json={**update,'version':2,'source_ref':dataset_ref(d)}).status_code==409


@pytest.mark.parametrize('kind',PATHS)
def test_copilot_thread_without_frozen_message_cannot_implicitly_bind_current_data(actor,kind):
    d=actor.dataset();t=thread(actor,d);request=body(kind,d)
    request['source_ref']={'kind':'copilot','thread_id':t['id']}
    before=snapshot(actor)
    assert actor.post(PATHS[kind],json=request).status_code==422
    assert snapshot(actor)==before
    request['source_ref'].update(dataset_version=d['version'],dataset_hash=d['content_hash'])
    result=actor.post(PATHS[kind],json=request);assert result.status_code==201,result.text
    assert result.json()['payload']['provenance']['dataset_hash']==d['content_hash']


def test_resolver_rechecks_contract_for_internal_callers_and_unknown_legacy_labels(actor):
    d=actor.dataset();store=actor.client.app.state.store;before=snapshot(actor)
    for ref in (None,{'kind':'dataset'},{'kind':'dataset','dataset_version':1},
                {'kind':'dataset','dataset_version':True,'dataset_hash':d['content_hash']}):
        with pytest.raises(HTTPException) as error:
            with store.transaction():business_provenance.resolve_source(store,actor.user['id'],'',d['id'],ref)
        assert error.value.status_code==422
    for dataset_id in (d['id'],):
        request={'title':'未经核验的旧来源标签','dataset_id':dataset_id,'source_key':'invented-legacy-label','acceptance':'不能将旧标签自动绑定到当前数据'}
        assert actor.post(PATHS['action'],json=request).status_code==422
    assert snapshot(actor)==before


@pytest.mark.parametrize('kind',PATHS)
def test_source_check_and_business_insert_hold_one_sqlite_write_transaction(actor,kind,monkeypatch):
    from server import workspace_api, service_api
    d=actor.dataset();store=actor.client.app.state.store
    target=workspace_api if kind=='action' else service_api
    original=target.resolve_source;resolved=Event();attempting=Event();committed=Event();release=Event()
    def pause_after_resolve(*args,**kwargs):
        result=original(*args,**kwargs)
        assert store.db.in_transaction
        resolved.set();assert attempting.wait(5)
        assert not committed.wait(.05), 'Dataset revision must not commit between source check and insert'
        assert release.wait(5)
        return result
    monkeypatch.setattr(target,'resolve_source',pause_after_resolve)
    changed=deepcopy(d['payload']);changed['periods'][-1]['revenue']+=77
    def revise_other_connection():
        # Independent SQLite writer models a concurrent process, not the Store RLock.
        db=sqlite3.connect(store.path,timeout=5,isolation_level=None)
        try:
            attempting.set();db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE datasets SET payload=?,version=version+1,content_hash=?,updated_at=? WHERE id=? AND user_id=?',
                       (encode(changed),digest(changed),now(),d['id'],actor.user['id']))
            db.execute('COMMIT');committed.set()
        finally:db.close()
    with ThreadPoolExecutor(max_workers=2) as pool:
        saving=pool.submit(actor.post,PATHS[kind],json=body(kind,d))
        assert resolved.wait(5)
        updating=pool.submit(revise_other_connection)
        try:
            assert attempting.wait(5);assert not committed.wait(.1)
        finally:release.set()
        result=saving.result(timeout=5);updating.result(timeout=5)
    assert result.status_code==201,result.text
    p=result.json()['payload']['provenance']
    assert p['dataset_version']==1 and p['dataset_hash']==d['content_hash']
    assert committed.is_set() and store.owned('datasets',actor.user['id'],d['id'])['version']==2
    # A subsequent old-view request cannot silently adopt the just-committed version.
    monkeypatch.setattr(target,'resolve_source',original);before=snapshot(actor)
    assert actor.post(PATHS[kind],json=body(kind,d)).status_code==409
    assert snapshot(actor)==before
