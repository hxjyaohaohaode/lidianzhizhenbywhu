"""Only temporary SQLite and pure capture contracts; no local browser or socket."""
import json
from pathlib import Path
import sqlite3

import pytest

from scripts.native_integrity_faults import InjectedFault, canonical_hash, connect_existing, inject_fault
from scripts.product_browser_audit import Probe
from scripts.pack_product_audit import package
from scripts.product_audit_config import audit_suite
from server.store import digest
from test_product_audit_transfer import first_use_fixture


def probe(tmp_path):
    folder=tmp_path/'I-test';folder.mkdir()
    p=Probe(None,'unused-no-network',folder,None)
    p.artifact_kinds=(*p.artifact_kinds,'fault-injection')
    return p


def memory_lease(tmp_path):
    dbfile=tmp_path/'lidian.sqlite3';before=json.dumps({'text':'合成原记录'},ensure_ascii=False);after=json.dumps({'text':'合成故障'},ensure_ascii=False)
    with sqlite3.connect(dbfile) as db:
        db.execute('CREATE TABLE memories(id TEXT PRIMARY KEY,user_id TEXT,payload TEXT,version INT)')
        db.execute('INSERT INTO memories VALUES(?,?,?,?)',('record','owner',after,1))
    p=probe(tmp_path);lease=InjectedFault(p,dbfile,'owner','memories','record',before,after,'memory_text',1,None)
    lease._record('injected',lease.receipt)
    return lease,dbfile,before,after,p


def test_native_fault_entry_rejects_local_execution_before_owner_read_or_database(monkeypatch,tmp_path):
    monkeypatch.delenv('GITHUB_ACTIONS',raising=False)
    class Forbidden:
        base_url='http://127.0.0.1:8000'
        def get(self,*args):pytest.fail('Native fault must not reach an API read locally')
    with pytest.raises(RuntimeError,match='GitHub runner only'):
        inject_fault(Forbidden(),data_dir=tmp_path,kind='memory_text',record_id='unused')
    assert list(tmp_path.iterdir())==[]


def test_fault_hash_uses_the_actual_persisted_canonical_contract():
    value={'text':'仅合成测试','approved':True,'number':.29,'unknown':None}
    assert canonical_hash(value)==digest(value)
    with pytest.raises(ValueError):canonical_hash({'bad':float('nan')})


def test_fixture_connection_cannot_create_a_new_database(tmp_path):
    missing=tmp_path/'missing.sqlite3'
    with pytest.raises(RuntimeError,match='Existing'):connect_existing(missing)
    assert not missing.exists()


def test_original_bytes_restore_once_with_two_explicit_receipts(tmp_path):
    lease,dbfile,before,after,p=memory_lease(tmp_path)
    lease.restore()
    with sqlite3.connect(dbfile) as db:assert db.execute('SELECT payload,version FROM memories').fetchone()==(before,1)
    assert lease.restored and lease.receipt['restored']
    assert [a['kind'] for a in p.artifacts]==['fault-injection','fault-injection']
    assert json.loads((p.directory/p.artifacts[0]['file']).read_text())['restored'] is False
    assert json.loads((p.directory/p.artifacts[1]['file']).read_text())['restored'] is True
    with pytest.raises(RuntimeError,match='already'):lease.restore()


@pytest.mark.parametrize('change',['owner','version','payload'])
def test_fixture_restore_never_overwrites_a_newer_or_differently_owned_record(tmp_path,change):
    lease,dbfile,before,after,p=memory_lease(tmp_path)
    with sqlite3.connect(dbfile) as db:
        if change=='owner':db.execute("UPDATE memories SET user_id='another-owner'")
        elif change=='version':db.execute('UPDATE memories SET version=2')
        else:db.execute('UPDATE memories SET payload=?',('{"text":"legitimate newer content"}',))
        current=db.execute('SELECT * FROM memories').fetchone()
    with pytest.raises(RuntimeError):lease.restore()
    with sqlite3.connect(dbfile) as db:assert db.execute('SELECT * FROM memories').fetchone()==current
    assert not lease.restored and len(p.artifacts)==1


def test_fixture_restore_does_not_overwrite_a_new_artifact_hash(tmp_path):
    dbfile=tmp_path/'lidian.sqlite3';before='{"title":"original"}';after='{"title":"fixture fault"}';original_hash=canonical_hash(json.loads(before))
    with sqlite3.connect(dbfile) as db:
        db.execute('CREATE TABLE runs(id TEXT,user_id TEXT)');db.execute("INSERT INTO runs VALUES('run','owner')")
        db.execute('CREATE TABLE agent_artifacts(id TEXT,run_id TEXT,payload TEXT,content_hash TEXT)')
        db.execute('INSERT INTO agent_artifacts VALUES(?,?,?,?)',('record','run',after,'0'*64))
    lease=InjectedFault(probe(tmp_path),dbfile,'owner','agent_artifacts','record',before,after,'report_artifact',None,original_hash)
    with pytest.raises(RuntimeError,match='restoration'):lease.restore()
    with sqlite3.connect(dbfile) as db:assert db.execute('SELECT payload,content_hash FROM agent_artifacts').fetchone()==(after,'0'*64)


@pytest.mark.parametrize('suite',['integrity','comparison-integrity'])
def test_fault_receipt_transfer_is_explicit_and_declared_fault_suite_only(tmp_path,suite):
    configuration=audit_suite(suite)
    evidence=tmp_path/'evidence';directory=evidence/configuration['mode']/'I-test';directory.mkdir(parents=True)
    p=Probe(None,'unused',directory,None)
    receipt=directory/'fault-receipt.json';receipt.write_text('{"synthetic":true,"ui_mutation_claimed":false}')
    with pytest.raises(ValueError,match='kind'):p.record_artifact(receipt,kind='fault-injection')
    p.artifact_kinds=(*p.artifact_kinds,'fault-injection');p.record_artifact(receipt,kind='fault-injection')
    report={'suite':suite,'all_checks_passed':False,'scenarios':[{'id':'I-test','artifacts':p.artifacts}]}
    (evidence/configuration['report']).write_text(json.dumps(report))
    m=package(evidence,suite=suite,part_bytes=1024)
    assert m['suite']==suite and m['audit_passed'] is False
    assert set(m['files'])=={configuration['report'],configuration['mode']+'/I-test/fault-receipt.json'}


def test_existing_suites_do_not_gain_database_fault_artifacts(tmp_path):
    evidence,_,report=first_use_fixture(tmp_path)
    report['scenarios'][0]['artifacts'][0]['kind']='fault-injection'
    (evidence/'product-first-use-audit.json').write_text(json.dumps(report))
    with pytest.raises(ValueError,match='Unknown scenario artifact kind'):package(evidence,suite='first-use')
