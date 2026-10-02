"""Fault-injected recovery boundaries; synthetic data stays in temporary databases."""
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
import copy
import sqlite3
import pytest
from conftest import Actor, editable
from server.store import Store, encode, digest


def snapshot(path):
    with closing(sqlite3.connect(path)) as db:
        return '\n'.join(db.iterdump())


@pytest.mark.parametrize('table',['schema_version','workspace_schema','adaptive_schema'])
def test_every_future_schema_is_rejected_before_any_schema_or_journal_mutation(tmp_path,table):
    path=tmp_path/'db';store=Store(path);store.close()
    with closing(sqlite3.connect(path)) as db:
        db.execute('DELETE FROM workspace_schema WHERE version>1')
        db.execute(f'INSERT INTO {table} VALUES(999)');db.commit()
        db.execute('PRAGMA journal_mode=DELETE')
    before=path.read_bytes()
    with pytest.raises(RuntimeError,match='拒绝降级'):Store(path)
    assert path.read_bytes()==before
    with closing(sqlite3.connect(path)) as db:assert db.execute('PRAGMA journal_mode').fetchone()[0]=='delete'


@pytest.mark.parametrize('module',['workspace_store','autonomy','connections','copilot'])
def test_failed_new_database_migration_commits_no_partial_tables(tmp_path,monkeypatch,module):
    import importlib
    part=importlib.import_module('server.'+module);original=part.migrate
    def fail_after_writes(store):
        original(store)
        raise RuntimeError('injected migration failure')
    monkeypatch.setattr(part,'migrate',fail_after_writes)
    path=tmp_path/'db'
    with pytest.raises(RuntimeError,match='injected'):Store(path)
    with closing(sqlite3.connect(path)) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()==[]
    monkeypatch.setattr(part,'migrate',original)
    recovered=Store(path);recovered.close()


@pytest.mark.parametrize('module',['workspace_store','autonomy','connections','copilot'])
def test_failed_upgrade_preserves_existing_rows_markers_and_missing_objects(tmp_path,monkeypatch,module):
    import importlib
    path=tmp_path/'db';store=Store(path);store.close()
    with closing(sqlite3.connect(path)) as db:
        db.execute('DELETE FROM workspace_schema WHERE version>1')
        db.execute('DROP TABLE dataset_import_receipts')
        db.execute("INSERT INTO users VALUES('owner','owner@test.example','hash','private name','{}',1,'old','old')")
        db.commit()
    before=snapshot(path)
    part=importlib.import_module('server.'+module);original=part.migrate
    def fail_after_writes(store):
        original(store)
        raise RuntimeError('injected migration failure')
    monkeypatch.setattr(part,'migrate',fail_after_writes)
    with pytest.raises(RuntimeError,match='injected'):Store(path)
    assert snapshot(path)==before
    monkeypatch.setattr(part,'migrate',original)
    recovered=Store(path)
    assert recovered.one('SELECT name FROM users')['name']=='private name'
    assert recovered.one('SELECT max(version) AS n FROM workspace_schema')['n']==3
    recovered.close()


def test_initialization_failure_closes_connection_and_rolls_back(tmp_path,monkeypatch):
    captured=[]
    def interrupted(store):
        captured.append(store.db)
        store.db.execute('CREATE TABLE marker(id INTEGER)')
        raise KeyboardInterrupt()
    monkeypatch.setattr(Store,'_migrate',interrupted)
    with pytest.raises(KeyboardInterrupt):Store(tmp_path/'db')
    with pytest.raises(sqlite3.ProgrammingError,match='closed'):captured[0].execute('SELECT 1')
    with closing(sqlite3.connect(tmp_path/'db')) as db:
        assert not db.execute("SELECT name FROM sqlite_master WHERE name='marker'").fetchone()


def test_nested_transaction_failure_rolls_back_only_savepoint(tmp_path):
    store=Store(tmp_path/'db')
    try:
        with store.transaction() as db:
            db.execute('CREATE TABLE marker(id INTEGER)')
            db.execute('INSERT INTO marker VALUES(1)')
            with pytest.raises(RuntimeError):
                with store.transaction() as nested:
                    nested.execute('INSERT INTO marker VALUES(2)')
                    raise RuntimeError('local failure')
            db.execute('INSERT INTO marker VALUES(3)')
        assert [r['id'] for r in store.all('SELECT id FROM marker')]==[1,3]
        with pytest.raises(RuntimeError):
            with store.transaction() as db:
                with store.transaction() as nested:nested.execute('INSERT INTO marker VALUES(4)')
                raise RuntimeError('outer failure')
        assert [r['id'] for r in store.all('SELECT id FROM marker')]==[1,3]
    finally:store.close()


def test_orphaned_database_is_rejected_without_creating_missing_schema(tmp_path):
    path=tmp_path/'db';store=Store(path);store.close()
    with closing(sqlite3.connect(path)) as db:
        db.execute('DROP TABLE dataset_import_receipts')
        db.execute("INSERT INTO auth_sessions VALUES('token','missing-owner','csrf',99999999999)")
        db.commit()
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    before=snapshot(path)
    with pytest.raises(RuntimeError,match='引用完整性'):Store(path)
    assert snapshot(path)==before


@pytest.mark.parametrize('corruption',['payload','hash','invalid_payload_with_hash','malformed_json','not_normalized'])
def test_corrupt_history_never_becomes_a_new_live_revision(actor,corruption):
    row=actor.dataset();store=actor.client.app.state.store
    changed=editable(row);changed['notes']='current revision must remain unchanged'
    current=actor.put('/datasets/'+row['id'],json=changed).json()
    payload=copy.deepcopy(row['payload']);content_hash=row['content_hash']
    if corruption=='hash':content_hash='0'*64
    elif corruption=='not_normalized':payload['amount_unit']='yi';content_hash=digest(payload)
    elif corruption=='invalid_payload_with_hash':payload['periods'][0]['revenue']=-1;content_hash=digest(payload)
    else:payload['periods'][0]['revenue']+=1
    raw='{"private":' if corruption=='malformed_json' else encode(payload)
    with store.transaction() as db:
        db.execute('UPDATE dataset_revisions SET payload=?,content_hash=? WHERE dataset_id=? AND version=1',(raw,content_hash,row['id']))
    audit_before=store.all('SELECT * FROM audit')
    result=actor.post('/workspace/datasets/'+row['id']+'/restore',json={'version':2,'target_revision':1})
    assert result.status_code==409,result.text
    assert result.json()['error']['code']=='REVISION_INTEGRITY'
    assert actor.get('/datasets/'+row['id']).json()==current
    assert store.one('SELECT count(*) AS n FROM dataset_revisions WHERE dataset_id=?',(row['id'],))['n']==2
    assert store.all('SELECT * FROM audit')==audit_before
    lineage=actor.get('/workspace/datasets/'+row['id']+'/lineage?revision=1')
    assert lineage.status_code==409 and lineage.json()['error']['code']=='REVISION_INTEGRITY'
    history=actor.get('/workspace/datasets/'+row['id']+'/revisions')
    assert history.status_code==200,history.text
    items=history.json()['items']
    assert [r['version'] for r in items]==[1,2]
    assert items[0]['integrity_valid'] is False and items[0]['diff']==[]
    assert items[1]['integrity_valid'] is True and items[1]['diff_available'] is False
    assert all('payload' not in r and 'revision_payload' not in r for r in items)


def test_restore_is_owner_checked_before_history_validation_and_records_source(actor):
    row=actor.dataset();other=Actor(actor.client);store=actor.client.app.state.store
    assert other.post('/workspace/datasets/'+row['id']+'/restore',json={'version':1,'target_revision':1}).status_code==404
    original=store.dataset_revision(actor.user['id'],row['id'],1)
    restored=actor.post('/workspace/datasets/'+row['id']+'/restore',json={'version':1,'target_revision':1})
    assert restored.status_code==200,restored.text
    assert restored.json()['version']==2 and restored.json()['payload']==row['payload']
    assert store.dataset_revision(actor.user['id'],row['id'],1)==original
    record=store.one("SELECT * FROM audit WHERE action='revision_restored'")
    assert record['metadata']=={'from_version':1,'target_revision':1,'source_hash':row['content_hash'],'version':2}
    assert other.get('/workspace/datasets/'+row['id']+'/lineage?revision=1').status_code==404


def test_competing_restores_commit_exactly_one_version_and_one_source_audit(actor):
    row=actor.dataset();store=actor.client.app.state.store
    def restore(_):return actor.post('/workspace/datasets/'+row['id']+'/restore',json={'version':1,'target_revision':1})
    with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(restore,range(2)))
    assert sorted(r.status_code for r in responses)==[200,409]
    assert actor.get('/datasets/'+row['id']).json()['version']==2
    assert store.one("SELECT count(*) AS n FROM audit WHERE action='revision_restored'")['n']==1


def test_process_exit_during_upgrade_leaves_existing_database_unchanged(tmp_path):
    import os
    from pathlib import Path
    import subprocess
    import sys
    path=tmp_path/'db';store=Store(path);store.close()
    with closing(sqlite3.connect(path)) as db:
        db.execute('DELETE FROM workspace_schema WHERE version>1')
        db.execute('DROP TABLE dataset_import_receipts');db.commit()
    before=snapshot(path)
    script="""import os,sys
from pathlib import Path
from server.store import Store
import server.connections as connections
original=connections.migrate
def interrupted(store):
    original(store)
    os._exit(91)
connections.migrate=interrupted
Store(Path(sys.argv[1]))
"""
    result=subprocess.run([sys.executable,'-c',script,str(path)],cwd=Path(__file__).resolve().parents[1],timeout=15)
    assert result.returncode==91
    assert snapshot(path)==before
    recovered=Store(path)
    assert recovered.one('SELECT max(version) AS n FROM workspace_schema')['n']==3
    recovered.close()
