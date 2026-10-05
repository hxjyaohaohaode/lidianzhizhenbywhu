"""Bounded corruption fixtures for a disposable native CI database only.

No application endpoint exposes these functions. Browser actions must perform
the actual rejection/recovery; these explicit writes are never UI evidence.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import sqlite3


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def canonical_hash(value):
    return sha(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False))


def connect_existing(database):
    if not database.is_file() or database.is_symlink():raise RuntimeError('Existing native fixture database required.')
    return sqlite3.connect(database.resolve().as_uri()+'?mode=rw',uri=True,timeout=5)


class InjectedFault:
    def __init__(self, probe, database, owner_id, table, record_id, before, after, kind, version, stored_hash):
        self.probe,self.database,self.owner_id=probe,database,owner_id
        self.table,self.record_id,self.before,self.after=table,record_id,before,after
        self.kind,self.version=kind,version
        self.stored_hash=stored_hash
        self.restored=False
        self.ordinal=len(probe.observations.setdefault('database_faults',[]))+1
        self.receipt={'fixture':'temporary_native_database_corruption','kind':kind,'table':table,
            'record_id':record_id,'owner_id':owner_id,'column':'payload','version_preserved':version,
            'before_sha256':sha(before),'after_sha256':sha(after),'ui_mutation_claimed':False,
            'application_endpoint_added':False,'restored':False}
        probe.observations['database_faults'].append(self.receipt)

    def _record(self,phase,receipt):
        path=Path(self.probe.directory)/f'integrity-fault-{self.ordinal:02d}-{phase}.json'
        with path.open('x',encoding='utf-8') as stream:
            json.dump(receipt,stream,ensure_ascii=False,sort_keys=True,indent=2)
        self.probe.record_artifact(path,kind='fault-injection')

    def restore(self):
        self._restore(record_receipt=True)

    def _restore(self,*,record_receipt):
        if self.restored:raise RuntimeError('Fixture restoration was already performed.')
        with connect_existing(self.database) as db:
            db.execute('BEGIN IMMEDIATE')
            # Do not overwrite a newer application write, even in a test DB.
            row=db.execute('SELECT payload FROM '+self.table+' WHERE id=?',(self.record_id,)).fetchone()
            if row is None or row[0]!=self.after:raise RuntimeError('Faulted record changed; original bytes were not restored over it.')
            if self.table=='agent_artifacts':
                owned=db.execute('SELECT 1 FROM agent_artifacts a JOIN runs r ON r.id=a.run_id WHERE a.id=? AND r.user_id=?',(self.record_id,self.owner_id)).fetchone()
            else:
                owned=db.execute('SELECT 1 FROM '+self.table+' WHERE id=? AND user_id=? AND version=?',(self.record_id,self.owner_id,self.version)).fetchone()
            if not owned:raise RuntimeError('Faulted record owner/version no longer matches.')
            if self.table=='agent_artifacts':
                changed=db.execute('UPDATE agent_artifacts SET payload=? WHERE id=? AND payload=? AND content_hash=? AND EXISTS(SELECT 1 FROM runs r WHERE r.id=agent_artifacts.run_id AND r.user_id=?)',(self.before,self.record_id,self.after,self.stored_hash,self.owner_id)).rowcount
            else:
                changed=db.execute('UPDATE '+self.table+' SET payload=? WHERE id=? AND payload=? AND user_id=? AND version=?',(self.before,self.record_id,self.after,self.owner_id,self.version)).rowcount
            if changed!=1:raise RuntimeError('Exact original-record restoration failed.')
        self.restored=True
        self.receipt['restored']=True
        if record_receipt:
            self._record('restored',{'kind':self.kind,'record_id':self.record_id,'restored':True,
                'restored_sha256':sha(self.before),'only_original_bytes_restored':True,'ui_recovery_claimed':False})


def inject_fault(probe, *, data_dir, kind, record_id, committed_dataset_id=None, expected_payload_hash=None):
    """Return a receipt-bearing lease with optional explicit restore().

    kind: import_payload | import_fake_committed | report_artifact | memory_text
    record_id: ID observed from the current user's actual UI/API, never a route.
    The caller labels this as fixture setup and subsequently operates real UI.
    """
    try:
        from .product_browser_audit import require_isolated_runner
    except ImportError:
        from product_browser_audit import require_isolated_runner
    require_isolated_runner(probe.base_url,data_dir)
    if 'fault-injection' not in getattr(probe,'artifact_kinds',()):raise RuntimeError('Probe must admit explicit fault receipts before any database write.')
    root=Path(data_dir).resolve()
    if root!=Path(os.environ.get('DATA_DIR','')).resolve():raise RuntimeError('Fault fixture DATA_DIR differs from the running isolated service.')
    database=root/'lidian.sqlite3'
    if not database.is_file() or database.is_symlink():raise RuntimeError('Existing native temporary database required.')
    owner=probe.get('/api/auth/me')['user']['id']
    if kind=='report_artifact':
        audit=probe.get('/api/workspace/runs/'+record_id+'/audit')
        if not audit['report_integrity']['valid']:raise RuntimeError('Original report must pass its actual audit before fault injection.')
        originals=[r for r in audit['artifacts'] if r['node']=='report']
        if len(originals)!=1:raise RuntimeError('Missing independently audited final artifact.')
    with connect_existing(database) as db:
        db.row_factory=sqlite3.Row
        db.execute('BEGIN IMMEDIATE')
        user=db.execute('SELECT email FROM users WHERE id=?',(owner,)).fetchone()
        if not user or not user['email'].endswith('@test.example'):raise RuntimeError('Only an explicitly synthetic test owner may be faulted.')
        if kind in ('import_payload','import_fake_committed'):
            table='workspace_objects'
            row=db.execute("SELECT * FROM workspace_objects WHERE id=? AND user_id=? AND kind='import_stage'",(record_id,owner)).fetchone()
        elif kind=='report_artifact':
            table='agent_artifacts'
            rows=db.execute("SELECT a.* FROM agent_artifacts a JOIN runs r ON r.id=a.run_id WHERE r.id=? AND r.user_id=? AND a.node='report' AND r.state IN ('succeeded','degraded')",(record_id,owner)).fetchall()
            if len(rows)!=1:raise RuntimeError('Expected one final artifact for the current owner’s completed report.')
            row=rows[0];record_id=row['id']
        elif kind=='memory_text':
            table='memories';row=db.execute('SELECT * FROM memories WHERE id=? AND user_id=?',(record_id,owner)).fetchone()
        else:raise RuntimeError('Unsupported native fixture fault kind.')
        if row is None:raise RuntimeError('Fault target is not owned by the active synthetic account.')
        before=row['payload'];payload=json.loads(before)
        if not isinstance(payload,dict):raise RuntimeError('Fault setup requires an intact original object.')
        if kind.startswith('import_'):
            if payload['status']!='preview':raise RuntimeError('Only an uncommitted actual preview may be faulted.')
            if payload.get('fingerprint')!=canonical_hash({k:v for k,v in payload.items() if k!='fingerprint'}):raise RuntimeError('Original preview fingerprint was already inconsistent.')
            if kind=='import_payload':payload['dataset']['periods'][0]['cost']+=1
            else:
                if not db.execute('SELECT 1 FROM datasets WHERE id=? AND user_id=?',(committed_dataset_id,owner)).fetchone():raise RuntimeError('Forged completion control must reference this same test owner’s dataset.')
                payload.update(status='committed',committed_id=committed_dataset_id)
        elif kind=='report_artifact':
            if row['id']!=originals[0]['id'] or row['content_hash']!=originals[0]['content_hash'] or canonical_hash(payload)!=row['content_hash']:raise RuntimeError('Original artifact no longer matches its audited hash.')
            payload['title']+='（仅隔离验收的产物损坏）'
        else:
            if not isinstance(expected_payload_hash,str) or canonical_hash(payload)!=expected_payload_hash:raise RuntimeError('Live memory must still match the actual approved frozen hash before injection.')
            payload['text']=payload['text'][:1400]+'（仅隔离验收：原版本号不变的临时内容）'
        after=json.dumps(payload,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
        if after==before:raise RuntimeError('Fault setup did not change the target.')
        version=row['version'] if 'version' in row.keys() else None
        stored_hash=row['content_hash'] if 'content_hash' in row.keys() else None
        if table=='agent_artifacts':
            changed=db.execute('UPDATE agent_artifacts SET payload=? WHERE id=? AND payload=? AND content_hash=? AND EXISTS(SELECT 1 FROM runs r WHERE r.id=agent_artifacts.run_id AND r.user_id=?)',(after,record_id,before,stored_hash,owner)).rowcount
        else:
            changed=db.execute('UPDATE '+table+' SET payload=? WHERE id=? AND payload=? AND user_id=? AND version=?',(after,record_id,before,owner,version)).rowcount
        if changed!=1:raise RuntimeError('Target changed concurrently; no fixture retry is permitted.')
    lease=InjectedFault(probe,database,owner,table,record_id,before,after,kind,version,stored_hash)
    try:lease._record('injected',lease.receipt)
    except Exception as exc:
        lease._restore(record_receipt=False)
        lease.receipt['harness_receipt_failure_original_restored']=True
        raise RuntimeError('Fault receipt creation failed; original bytes restored; UI outcome was not exercised.') from exc
    return lease
