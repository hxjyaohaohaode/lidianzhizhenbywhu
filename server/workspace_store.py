"""Versioned user-owned workspace objects; transactions are controlled by the caller."""
from __future__ import annotations
from .store import encode, digest, uid, now, unpack
from .security import fail

KINDS = frozenset({'profile','plan','action','experiment','comparison','evidence_review','claim_review','template','import_stage','dismissal','assessment','strategy','strategy_active','strategy_evaluation','identity','assistant_thread','assistant_proposal','watch','alert'})


def migrate(store):
    # Separate extension schema: original schema stays backward-readable; no old secrets imported.
    with store.transaction() as db:
        db.execute('CREATE TABLE IF NOT EXISTS workspace_schema(version INTEGER PRIMARY KEY)')
        row = db.execute('SELECT MAX(version) FROM workspace_schema').fetchone()
        if row[0] is not None and row[0] > 3:
            raise RuntimeError('工作区数据库版本高于程序，拒绝降级写入')
        db.execute('''CREATE TABLE IF NOT EXISTS workspace_objects(
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL, natural_key TEXT NOT NULL, payload TEXT NOT NULL,
            version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(user_id,kind,natural_key))''')
        db.execute('CREATE INDEX IF NOT EXISTS workspace_owner ON workspace_objects(user_id,kind,updated_at)')
        db.execute('''CREATE TABLE IF NOT EXISTS dataset_revisions(
            dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            version INTEGER NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL, PRIMARY KEY(dataset_id,version))''')
        db.execute('''CREATE TABLE IF NOT EXISTS dataset_import_receipts(
            dataset_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            version INTEGER NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL, PRIMARY KEY(dataset_id,version),
            FOREIGN KEY(dataset_id,version) REFERENCES dataset_revisions(dataset_id,version) ON DELETE CASCADE)''')
        db.execute('''CREATE TABLE IF NOT EXISTS event_integrity(
            event_seq INTEGER PRIMARY KEY REFERENCES run_events(seq) ON DELETE CASCADE,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL)''')
        db.execute('''CREATE TABLE IF NOT EXISTS agent_artifacts(
            id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            node TEXT NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL)''')
        db.execute('CREATE INDEX IF NOT EXISTS artifacts_run ON agent_artifacts(run_id,node)')
        db.execute('''INSERT OR IGNORE INTO dataset_revisions SELECT id,user_id,version,payload,content_hash,updated_at FROM datasets''')
        # SQLite triggers make all old and new update paths version-history aware.
        db.execute('''CREATE TRIGGER IF NOT EXISTS dataset_insert_revision AFTER INSERT ON datasets BEGIN
            INSERT INTO dataset_revisions VALUES(new.id,new.user_id,new.version,new.payload,new.content_hash,new.updated_at); END''')
        db.execute('''CREATE TRIGGER IF NOT EXISTS dataset_update_revision AFTER UPDATE OF payload ON datasets
            WHEN new.version != old.version BEGIN
            INSERT INTO dataset_revisions VALUES(new.id,new.user_id,new.version,new.payload,new.content_hash,new.updated_at); END''')
        # Backfill baseline events once; this is local integrity evidence, not a trusted external timestamp.
        previous = {}
        legacy_rows = db.execute('SELECT * FROM run_events ORDER BY seq').fetchall() if row[0] is None else []
        for row in legacy_rows:
            e = unpack(row)
            p = previous.get(e['run_id'], '')
            h = digest({'previous':p, 'event':e})
            db.execute('INSERT OR IGNORE INTO event_integrity VALUES(?,?,?,?)', (e['seq'],e['run_id'],p,h))
            previous[e['run_id']] = h
        db.execute('INSERT OR IGNORE INTO workspace_schema VALUES(1)')
        # New source/receipt contracts must not be silently written by an older app.
        db.execute('INSERT OR IGNORE INTO workspace_schema VALUES(2)')
        # Older dispatchers do not understand approved multi-company inputs.
        db.execute('INSERT OR IGNORE INTO workspace_schema VALUES(3)')


def get(store, user, kind, id):
    if kind not in KINDS:
        raise ValueError('Unknown workspace object kind')
    row = store.one('SELECT * FROM workspace_objects WHERE user_id=? AND kind=? AND id=?', (user,kind,id))
    if not row:
        fail('NOT_FOUND','资源不存在或无访问权限',404)
    return row


def keyed(store, user, kind, key):
    if kind not in KINDS:
        raise ValueError('Unknown workspace object kind')
    return store.one('SELECT * FROM workspace_objects WHERE user_id=? AND kind=? AND natural_key=?', (user,kind,key))


def objects(store, user, kind, limit=200):
    if kind not in KINDS:
        raise ValueError('Unknown workspace object kind')
    return store.all('SELECT * FROM workspace_objects WHERE user_id=? AND kind=? ORDER BY updated_at DESC,id LIMIT ?', (user,kind,limit))


def save(store, db, user, kind, payload, *, key=None, expected=0, id=None):
    if kind not in KINDS:
        raise ValueError('Unknown workspace object kind')
    key = key or id or uid()
    current = keyed(store,user,kind,key)
    if current:
        if expected != current['version']:
            fail('VERSION_CONFLICT','记录已改变；请刷新，未覆盖他人的修改',409)
        db.execute('UPDATE workspace_objects SET payload=?,version=version+1,updated_at=? WHERE id=?', (encode(payload),now(),current['id']))
        id = current['id']
    else:
        if expected:
            fail('VERSION_CONFLICT','记录已删除或版本不匹配',409)
        n = db.execute('SELECT count(*) FROM workspace_objects WHERE user_id=? AND kind=?', (user,kind)).fetchone()[0]
        if n >= (1000 if kind in {'plan','action','claim_review'} else 200):
            fail('RESOURCE_LIMIT','该类记录已达上限，请导出并整理后重试',409)
        id = id or uid(); at = now()
        db.execute('INSERT INTO workspace_objects VALUES(?,?,?,?,?,?,?,?)', (id,user,kind,key,encode(payload),1,at,at))
    store.audit(db,user,kind,id,'updated' if current else 'created', {'version':(current['version']+1) if current else 1})
    return get(store,user,kind,id)


def verify_ledger(store, run_id):
    rows = store.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq', (run_id,))
    ledger = {r['event_seq']:r for r in store.all('SELECT * FROM event_integrity WHERE run_id=?', (run_id,))}
    previous = ''; errors = []
    for e in rows:
        h = digest({'previous':previous, 'event':e})
        l = ledger.get(e['seq'])
        if not l or l['entry_hash'] != h or l['previous_hash'] != previous:
            errors.append(e['seq'])
        previous = h
    if set(ledger) != {e['seq'] for e in rows}:
        errors.append(-1)
    return {'valid':not errors, 'event_count':len(rows), 'head_hash':previous, 'invalid_sequences':errors,
            'scope':'本地哈希链一致性；数据库管理者可重写链，不是第三方公证或事实认证'}
