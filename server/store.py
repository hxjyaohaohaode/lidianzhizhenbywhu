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
        try:
            # Check every independently versioned extension before writable PRAGMAs
            # or schema creation. A later extension must not reject an already
            # partially upgraded database.
            self._check_schema_versions()
            self.db.execute('PRAGMA foreign_keys=ON')
            self._check_foreign_keys()
            self.db.execute('PRAGMA journal_mode=WAL')
            self.db.execute('PRAGMA synchronous=FULL');self.db.execute('PRAGMA busy_timeout=5000')
            with self.transaction():
                self._check_schema_versions()
                self._migrate()
                self._check_foreign_keys()
        except BaseException:
            self.db.close()
            raise
        for private in (path,Path(str(path)+'-wal'),Path(str(path)+'-shm')):
            try:os.chmod(private,0o600)
            except OSError:pass

    def _check_schema_versions(self):
        for table, maximum in (('schema_version',3), ('workspace_schema',3), ('adaptive_schema',1)):
            if self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                version=self.db.execute(f'SELECT MAX(version) FROM {table}').fetchone()[0]
                if version is not None and version>maximum:
                    raise RuntimeError('数据库版本高于此程序；拒绝降级写入。')

    def _check_foreign_keys(self):
        if self.db.execute('PRAGMA foreign_key_check').fetchone():
            raise RuntimeError('数据库引用完整性检查失败；请保留原库并使用可信备份恢复。')

    def _execute_schema(self, script):
        # executescript commits an existing transaction implicitly. Execute complete
        # statements instead, keeping DDL, FTS backfill and extension markers atomic.
        statement=''
        for line in script.splitlines():
            statement+=line+'\n'
            if sqlite3.complete_statement(statement):
                self.db.execute(statement)
                statement=''
        if statement.strip():raise RuntimeError('数据库迁移语句不完整')

    def _migrate(self):
        self._execute_schema('''
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
        self.db.execute('INSERT OR IGNORE INTO schema_version VALUES(3)')

    @contextlib.contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            # Extension migrations compose inside one startup transaction. A
            # nested failure can roll back its own writes without committing the
            # outer unit, including when the caller catches that failure.
            nested=self.db.in_transaction
            savepoint='tx_'+uuid.uuid4().hex if nested else None
            self.db.execute('SAVEPOINT '+savepoint if nested else 'BEGIN IMMEDIATE')
            try:
                yield self.db
                self.db.execute('RELEASE SAVEPOINT '+savepoint if nested else 'COMMIT')
            except BaseException:
                if nested:
                    self.db.execute('ROLLBACK TO SAVEPOINT '+savepoint)
                    self.db.execute('RELEASE SAVEPOINT '+savepoint)
                elif self.db.in_transaction:self.db.execute('ROLLBACK')
                raise

    @contextlib.contextmanager
    def read_snapshot(self):
        """Keep a multi-query read on one SQLite snapshot without a writer lock.

        The lock protects this shared connection; BEGIN excludes later commits
        on other connections. Nested callers reuse their enclosing transaction.
        """
        with self._lock:
            nested = self.db.in_transaction
            if not nested:self.db.execute('BEGIN')
            try:
                yield
            finally:
                if not nested and self.db.in_transaction:self.db.execute('ROLLBACK')

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

    @staticmethod
    def validate_dataset_identity(current,payload):
        """Company is the shared business key; a revision cannot reassign its history."""
        from .security import fail
        if current['payload']['company'] != payload['company']:
            fail('COMPANY_MISMATCH','不能在修订中更换企业身份，请创建新数据集',409)

    def update(self,table,user,id,version,payload):
        if table not in {'datasets','memories','conversations'}:raise ValueError('invalid table')
        with self.transaction() as db:
            if table=='datasets':
                current=self.owned(table,user,id)
                if not current or current['version']!=version:return None
                self.validate_dataset_identity(current,payload)
            extra,args=(',content_hash=?',[digest(payload)]) if table=='datasets' else ('',[])
            c=db.execute(f'UPDATE {table} SET payload=?,version=version+1,updated_at=?{extra} WHERE id=? AND user_id=? AND version=?',(encode(payload),now(),*args,id,user,version))
            if c.rowcount!=1:return None
            self.audit(db,user,table,id,'updated',{'version':version+1})
        return self.owned(table,user,id)

    @staticmethod
    def validate_dataset_revision(row):
        """Verify persisted history before using it as a live input, never repair it."""
        from .security import fail
        from .source_bindings import dataset_content_valid
        if not dataset_content_valid(row):
            fail('REVISION_INTEGRITY','历史修订内容或校验值不一致；未采用该内容，请保留原记录并检查可信备份',409)
        return row

    def dataset_revision(self,user,id,version):
        from .security import fail
        try:
            row=self.one('SELECT * FROM dataset_revisions WHERE dataset_id=? AND user_id=? AND version=?',(id,user,version))
        except (ValueError,TypeError):
            fail('REVISION_INTEGRITY','历史修订无法读取；未采用该内容，请保留原记录并检查可信备份',409)
        if not row:fail('NOT_FOUND','历史修订不存在',404)
        return self.validate_dataset_revision(row)

    def restore_dataset_revision(self,user,id,version,target_revision):
        from .security import check_version,fail
        with self.transaction() as db:
            current=self.owned('datasets',user,id)
            if not current:fail('NOT_FOUND','资源不存在或无访问权限',404)
            check_version(current,version)
            old=self.dataset_revision(user,id,target_revision)
            row=self.update('datasets',user,id,version,old['payload'])
            if not row:fail('VERSION_CONFLICT','当前版本已变，请刷新',409)
            self.audit(db,user,'datasets',id,'revision_restored',{
                'from_version':version,'target_revision':target_revision,
                'source_hash':old['content_hash'],'version':row['version']})
            return row

    def _delete_current_reviews(self,db,table,user,id):
        """Remove live children only, after the caller validates their root revision.

        Reviews in workspace_objects have logical rather than foreign-key parents.
        Independent plans, actions and evaluation/report snapshots keep their frozen
        provenance; their payloads and all original audit entries remain unchanged.
        """
        if table=='evidence':
            rows=db.execute("SELECT id,kind FROM workspace_objects WHERE user_id=? AND kind='evidence_review' AND natural_key=?",(user,id)).fetchall()
        elif table=='conversations':
            # The saved run-key anchors unreadable/absent payload bindings too.
            # An explicit conflicting run_id must never widen this deletion.
            from .workspace_store import claim_review_parent_match
            rows=db.execute(f'''SELECT w.id,w.kind FROM workspace_objects w JOIN runs r
                ON r.user_id=w.user_id AND (
                    (w.kind='assessment' AND w.natural_key=r.id) OR
                    (w.kind='claim_review' AND {claim_review_parent_match('w','r')}))
                WHERE w.user_id=? AND r.session_id=?''',(user,id)).fetchall()
        else:return
        for child in rows:
            db.execute('DELETE FROM workspace_objects WHERE id=? AND user_id=? AND kind=?',(child['id'],user,child['kind']))
            self.audit(db,user,child['kind'],child['id'],'deleted_with_parent',{'parent_resource':table,'parent_id':id})
        if table=='conversations':
            # Both single and batch deletion use this transaction-bound path.
            # Removed assessments revoke future strategy/plan bindings, while
            # archived evaluations and unrelated users' policies stay untouched.
            from .evolution import current_active
            current_active(self,user)

    def delete(self,table,user,id,version=None):
        if table not in TABLES:raise ValueError('invalid table')
        with self.transaction() as db:
            from .security import check_version,fail
            row=self.owned(table,user,id)
            if not row:fail('NOT_FOUND','资源不存在或无访问权限。',404)
            check_version(row,version)
            self._delete_current_reviews(db,table,user,id)
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
