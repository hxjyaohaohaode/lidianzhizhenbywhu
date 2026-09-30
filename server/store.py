from __future__ import annotations
import contextlib
import hashlib
import json
import os
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any, Iterator

JSON_FIELDS={'payload','result','snapshot','preferences','metadata'}
TABLES={'datasets','conversations','memories','evidence','runs','feedback','messages'}

def now() -> str:
    from datetime import datetime,timezone
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')

def uid() -> str:return uuid.uuid4().hex

def encode(value: Any) -> str:
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True,allow_nan=False)

def digest(value: Any) -> str:
    return hashlib.sha256((value if isinstance(value,str) else encode(value)).encode()).hexdigest()

def unpack(row):
    if row is None:return None
    data=dict(row)
    for k in JSON_FIELDS:
        if k in data and data[k] is not None:data[k]=json.loads(data[k])
    return data

class Store:
    """Single-process WAL persistence, explicit transactions and durable ownership."""
    def __init__(self,path: Path):
        path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        if os.name!='nt':os.chmod(path.parent,0o700)
        self.path=path;self._lock=threading.RLock()
        self.db=sqlite3.connect(path,timeout=5,check_same_thread=False,isolation_level=None)
        self.db.row_factory=sqlite3.Row
        if self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'").fetchone():
            version=self.db.execute('SELECT MAX(version) FROM schema_version').fetchone()[0]
            if version and version>3:self.db.close();raise RuntimeError('数据库版本高于此程序；拒绝降级写入。')
        self.db.execute('PRAGMA foreign_keys=ON');self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL');self.db.execute('PRAGMA busy_timeout=5000')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
        INSERT OR IGNORE INTO schema_version VALUES(1);
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,name TEXT NOT NULL,preferences TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,content_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,content_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,content_hash));
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,session_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE RESTRICT,state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','degraded','failed','cancelled','interrupted')),payload TEXT NOT NULL,snapshot TEXT NOT NULL,result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,UNIQUE(user_id,idempotency_key));
        CREATE TABLE IF NOT EXISTS run_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,type TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,session_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,role TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,payload TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,resource TEXT NOT NULL,resource_id TEXT NOT NULL,action TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence_chunks(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,start INTEGER NOT NULL,excerpt TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS evidence_fts USING fts5(chunk_id UNINDEXED,owner,terms);
        CREATE TRIGGER IF NOT EXISTS chunks_remove_fts AFTER DELETE ON evidence_chunks BEGIN DELETE FROM evidence_fts WHERE chunk_id=old.id; END;
        CREATE INDEX IF NOT EXISTS chunks_owner ON evidence_chunks(user_id,document_id);
        CREATE INDEX IF NOT EXISTS datasets_owner ON datasets(user_id,updated_at);
        CREATE INDEX IF NOT EXISTS sessions_owner ON conversations(user_id,updated_at);
        CREATE INDEX IF NOT EXISTS memories_owner ON memories(user_id,updated_at);
        CREATE INDEX IF NOT EXISTS evidence_owner ON evidence(user_id,updated_at);
        CREATE INDEX IF NOT EXISTS runs_owner ON runs(user_id,created_at);
        CREATE INDEX IF NOT EXISTS queue_state ON runs(state,created_at);
        CREATE INDEX IF NOT EXISTS events_run ON run_events(run_id,seq);
        CREATE INDEX IF NOT EXISTS audit_owner ON audit(user_id,seq);
        CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id,created_at);
        ''')
        if not self.db.execute('SELECT 1 FROM schema_version WHERE version=2').fetchone():
            with self.transaction() as db:
                for row in self.all('SELECT * FROM evidence'):self.index_evidence(db,row['id'],row['user_id'],row['payload']['text'])
                db.execute('INSERT INTO schema_version VALUES(2)')
        from .workspace_store import migrate
        migrate(self)
        from .autonomy import migrate as migrate_adaptive
        migrate_adaptive(self)
        from .connections import migrate as migrate_connections
        migrate_connections(self)
        from .copilot import migrate as migrate_copilot
        migrate_copilot(self)
        with self.transaction() as db:db.execute('INSERT OR IGNORE INTO schema_version VALUES(3)')
        for private in (path,Path(str(path)+'-wal'),Path(str(path)+'-shm')):
            try:os.chmod(private,0o600)
            except OSError:pass

    @contextlib.contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self.db.execute('BEGIN IMMEDIATE')
            try:yield self.db;self.db.execute('COMMIT')
            except BaseException:self.db.execute('ROLLBACK');raise

    def one(self,sql: str,params: tuple=()):
        with self._lock:return unpack(self.db.execute(sql,params).fetchone())

    def all(self,sql: str,params: tuple=()):
        with self._lock:return [unpack(r) for r in self.db.execute(sql,params).fetchall()]

    def owned(self,table,user,id):
        if table not in TABLES:raise ValueError('invalid table')
        return self.one(f'SELECT * FROM {table} WHERE id=? AND user_id=?',(id,user))

    def items(self,table,user,limit=200):
        if table not in TABLES:raise ValueError('invalid table')
        return self.all(f'SELECT * FROM {table} WHERE user_id=? ORDER BY created_at DESC LIMIT ?',(user,limit))

    def audit(self,db,user,resource,id,action,metadata=None):
        db.execute('INSERT INTO audit(user_id,resource,resource_id,action,metadata,created_at) VALUES(?,?,?,?,?,?)',(user,resource,id,action,encode(metadata or {}),now()))

    def event(self,db,run,type,payload):
        at = now()
        cursor = db.execute('INSERT INTO run_events(run_id,type,payload,created_at) VALUES(?,?,?,?)',(run,type,encode(payload),at))
        seq = cursor.lastrowid
        prev = db.execute('SELECT entry_hash FROM event_integrity WHERE run_id=? ORDER BY event_seq DESC LIMIT 1',(run,)).fetchone()
        previous = prev[0] if prev else ''
        event = {'seq':seq,'run_id':run,'type':type,'payload':payload,'created_at':at}
        db.execute('INSERT INTO event_integrity VALUES(?,?,?,?)',(seq,run,previous,digest({'previous':previous,'event':event})))

    def create(self,table,user,payload):
        if table not in {'datasets','conversations','memories','evidence'}:raise ValueError('invalid table')
        id,at=uid(),now()
        with self.transaction() as db:
            if db.execute(f'SELECT count(*) FROM {table} WHERE user_id=?',(user,)).fetchone()[0]>=200:raise ValueError('该类资源已达200条上限，请先导出并整理')
            if table in {'datasets','evidence'}:
                h=digest(payload['text'] if table=='evidence' else payload)
                db.execute(f'INSERT INTO {table}(id,user_id,payload,version,content_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(id,user,encode(payload),1,h,at,at))
            else:db.execute(f'INSERT INTO {table}(id,user_id,payload,version,created_at,updated_at) VALUES(?,?,?,?,?,?)',(id,user,encode(payload),1,at,at))
            if table=='evidence':self.index_evidence(db,id,user,payload['text'])
            self.audit(db,user,table,id,'created',{'version':1})
        return self.owned(table,user,id)

    def index_evidence(self,db,id,user,text):
        from .retrieval import terms
        for start in range(0,len(text),900):
            chunk=f'{id}:{start}';excerpt=text[start:start+1100]
            db.execute('INSERT INTO evidence_chunks VALUES(?,?,?,?,?)',(chunk,id,user,start,excerpt))
            db.execute('INSERT INTO evidence_fts(chunk_id,owner,terms) VALUES(?,?,?)',(chunk,user,' '.join(terms(excerpt))))

    def update(self,table,user,id,version,payload):
        if table not in {'datasets','memories','conversations'}:raise ValueError('invalid table')
        with self.transaction() as db:
            extra,args=(',content_hash=?',[digest(payload)]) if table=='datasets' else ('',[])
            c=db.execute(f'UPDATE {table} SET payload=?,version=version+1,updated_at=?{extra} WHERE id=? AND user_id=? AND version=?',(encode(payload),now(),*args,id,user,version))
            if c.rowcount!=1:return None
            self.audit(db,user,table,id,'updated',{'version':version+1})
        return self.owned(table,user,id)

    def delete(self,table,user,id,version=None):
        if table not in TABLES:raise ValueError('invalid table')
        with self.transaction() as db:
            from .security import check_version,fail
            row=self.owned(table,user,id)
            if not row:fail('NOT_FOUND','资源不存在或无访问权限。',404)
            check_version(row,version)
            c=db.execute(f'DELETE FROM {table} WHERE id=? AND user_id=? AND version=?',(id,user,version))
            if c.rowcount:self.audit(db,user,table,id,'deleted')
        return bool(c.rowcount)

    def backup(self,target: Path):
        with self._lock:
            destination=sqlite3.connect(target)
            try:self.db.backup(destination)
            finally:destination.close()
        os.chmod(target,0o600)

    def close(self):
        with self._lock:self.db.close()
