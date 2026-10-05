"""Disposable SQLite fixture contracts, not native browser execution."""
from pathlib import Path
import pytest
from scripts.native_integrity_faults import inject_fault, canonical_hash
from scripts.product_browser_audit import Probe
from source_binding_cases import ok
from conftest import Actor


def local_fixture_probe(actor,tmp_path,monkeypatch):
    # Bypass only the runner-location predicate in this isolated fixture unit
    # test. No browser/listener exists; the production native guard is unchanged.
    monkeypatch.setattr('scripts.product_browser_audit.require_isolated_runner',lambda *_:None)
    root=actor.client.app.state.store.path.parent
    monkeypatch.setenv('DATA_DIR',str(root))
    directory=tmp_path/'explicit-fault-files';directory.mkdir()
    probe=Probe(None,'http://127.0.0.1:8000',directory,None)
    probe.artifact_kinds=(*probe.artifact_kinds,'fault-injection')
    probe.get=lambda path:ok(actor.get(path.removeprefix('/api')))
    return probe,root


def test_dataset_fixture_preserves_verified_history_for_actual_application_restore(actor,tmp_path,monkeypatch):
    d=actor.dataset();store=actor.client.app.state.store;p,root=local_fixture_probe(actor,tmp_path,monkeypatch)
    original=store.all('SELECT * FROM dataset_revisions')
    fault=inject_fault(p,data_dir=root,kind='dataset_payload',record_id=d['id'],expected_payload_hash=d['content_hash'])
    damaged=store.owned('datasets',actor.user['id'],d['id'])
    assert damaged['version']==1 and damaged['content_hash']==d['content_hash']
    assert canonical_hash(damaged['payload'])!=d['content_hash']
    assert store.all('SELECT * FROM dataset_revisions')==original
    recovered=ok(actor.post('/workspace/datasets/'+d['id']+'/restore',json={'version':1,'target_revision':1}))
    assert recovered['version']==2 and recovered['payload']==d['payload'] and recovered['content_hash']==d['content_hash']
    assert not fault.restored and len(p.artifacts)==1
    with pytest.raises(RuntimeError):fault.restore()


def test_scope_fixture_keeps_original_version_and_requires_normal_review_to_reauthorize(actor,tmp_path,monkeypatch):
    d=actor.dataset();doc=ok(actor.post('/evidence',json={'title':'合成资料','text':'现金流毛利率原始资料。'*10,'company':d['payload']['company']}),201)
    store=actor.client.app.state.store;review=store.one("SELECT * FROM workspace_objects WHERE kind='evidence_review' AND natural_key=?",(doc['id'],))
    p,root=local_fixture_probe(actor,tmp_path,monkeypatch)
    fault=inject_fault(p,data_dir=root,kind='evidence_review_scope',record_id=doc['id'],expected_payload_hash=canonical_hash(review['payload']))
    current=store.one('SELECT * FROM workspace_objects WHERE id=?',(review['id'],))
    assert current['version']==review['version'] and current['payload']['company']=='另一家隔离企业'
    ok(actor.put('/workspace/evidence/'+doc['id']+'/review',json={**review['payload'],'version':current['version']}))
    current=store.one('SELECT * FROM workspace_objects WHERE id=?',(review['id'],))
    assert current['version']==review['version']+1 and current['payload']==review['payload'] and not fault.restored
    with pytest.raises(RuntimeError):fault.restore()


def test_fault_cannot_target_another_owner_or_a_changed_viewed_hash(actor,tmp_path,monkeypatch):
    d=actor.dataset();other=Actor(actor.client);peer=other.dataset();store=actor.client.app.state.store
    p,root=local_fixture_probe(actor,tmp_path,monkeypatch)
    for record,hash_value in ((peer['id'],peer['content_hash']),(d['id'],'0'*64)):
        before=store.owned('datasets',other.user['id'] if record==peer['id'] else actor.user['id'],record)
        with pytest.raises(RuntimeError):inject_fault(p,data_dir=root,kind='dataset_payload',record_id=record,expected_payload_hash=hash_value)
        assert store.owned('datasets',before['user_id'],record)==before
    assert p.artifacts==[]
