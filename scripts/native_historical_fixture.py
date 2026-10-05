"""Single genuine old completed-report closure, never a product import API.

The native entry requires its own explicit admission and the unchanged CI gate.
The transaction core is exercised separately with real isolated TestClient DBs;
that is fixture/API evidence, never native registration or migration evidence.
"""
from __future__ import annotations

import hashlib
import json
import os
from contextlib import closing
from pathlib import Path
import sqlite3

SCOPE = 'historical-cost-percentage-legacy-completed-v1'
ARTIFACT_KIND = 'legacy-history-preparation'
FIXTURE_NAME = 'percentage-execution-scope-80defc9.json'
FIXTURE_SHA256 = '4c69e0787c384443cd31eebb425d90cb90d60333a2524175b8496690080382fc'
MANIFEST_NAME = 'historical-warning-single-report-manifest.json'
MANIFEST_SHA256 = 'c6bf16cc600fb2f3d819255e8250ffaeeec454c1799d7e5dfa5d611fabb9852f'
RUN_ID = 'a24a13629faa46a586cbcb3fb2995d4d'
PLAN_ID = 'e090aa41e6514479884710c61abf62e6'
DATASET_ID = '56f504d3099c41e6b7799b09f41be292'
SESSION_ID = '37614b1d23064f0c97c5663523323fe3'
SOURCE_OWNER = 'b1d5566c1d8e4f1b9e5126e57f4ade0e'
COUNTS = {'datasets': 1, 'dataset_revisions': 1, 'conversations': 1,
          'workspace_objects': 1, 'copilot_messages': 0, 'runs': 1,
          'messages': 2, 'run_events': 18, 'event_integrity': 18,
          'adaptive_controls': 0, 'adaptive_graphs': 0, 'agent_artifacts': 6,
          'adaptive_checkpoints': 0, 'adaptive_calls': 0}
EMPTY_BUSINESS_TABLES = ('memories', 'evidence', 'feedback')
EXPORT_SHA256 = {'json': 'b462099b2f3848bfcbf8ed32f08873f6c8166743ffaa031cd692864f2aa32770',
                 'md': '7eb624c4fbca239a4e14d573e18dcf93a0d6dd34b08eb54bd818ef7f787ef9ef'}


def sha256(blob):
    return hashlib.sha256(blob).hexdigest()


def row_manifest_hash(row):
    # The reviewed manifest retained original dictionary/column order. This is
    # only a review receipt; it never replaces persisted business fingerprints.
    return sha256(json.dumps(row, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode())


def verified_closure(repository_root):
    root = Path(repository_root) / 'tests' / 'fixtures'
    fixture_bytes = (root / FIXTURE_NAME).read_bytes()
    manifest_bytes = (root / MANIFEST_NAME).read_bytes()
    if sha256(fixture_bytes) != FIXTURE_SHA256 or sha256(manifest_bytes) != MANIFEST_SHA256:
        raise RuntimeError('Original fixture or separately reviewed 49-row manifest hash differs.')
    fixture, manifest = json.loads(fixture_bytes), json.loads(manifest_bytes)
    if (set(fixture['tables']) != set(COUNTS) or set(manifest['selected']) != set(COUNTS)
            or manifest['selected_row_count'] != 49 or manifest['case'] != 'legacy_completed'
            or fixture['cases']['legacy_completed'] != manifest['case_references']):
        raise RuntimeError('Only the reviewed single completed-report closure is admitted.')
    selected = {}
    for table, count in COUNTS.items():
        specs = manifest['selected'][table]
        if (specs['source_count'] != len(fixture['tables'][table])
                or specs['selected_count'] != count or len(specs['rows']) != count):
            raise RuntimeError('Reviewed closure count differs: ' + table)
        selected[table] = []
        for item in specs['rows']:
            rows = [row for row in fixture['tables'][table]
                    if all(row.get(k) == v for k, v in item['key'].items())]
            if len(rows) != 1 or row_manifest_hash(rows[0]) != item['original_complete_row_manifest_sha256']:
                raise RuntimeError('Original complete row differs: ' + table)
            row = rows[0]
            if any(sha256(row[column].encode()) != expected
                   for column, expected in item['serialized_column_sha256'].items()):
                raise RuntimeError('Original serialized bytes differ: ' + table)
            if 'user_id' in row and row['user_id'] != SOURCE_OWNER:
                raise RuntimeError('Unexpected original synthetic owner.')
            selected[table].append(row)
    run = selected['runs'][0]
    if (run['id'] != RUN_ID or run['state'] != 'succeeded' or not run['result']
            or run['dataset_id'] != DATASET_ID or run['session_id'] != SESSION_ID
            or selected['workspace_objects'][0]['id'] != PLAN_ID
            or fixture['cases']['legacy_completed']['proposal_id'] is not None):
        raise RuntimeError('The original completed report and its genuine binding are required.')
    if [r['seq'] for r in selected['run_events']] != list(range(2, 20)):
        raise RuntimeError('Original event sequences must remain 2 through 19.')
    return selected, manifest, fixture['source']


def _mapped(row, owner_id):
    return {key: owner_id if key == 'user_id' else value for key, value in row.items()}


def _where(key):
    # Identifiers originate only from the verified, pinned manifest.
    return ' AND '.join(column + '=?' for column in key), list(key.values())


def _read_closed_rows(db, selected, manifest, owner_id):
    actual = {}
    for table, originals in selected.items():
        actual[table] = []
        for source, item in zip(originals, manifest['selected'][table]['rows']):
            clause, values = _where(item['key'])
            rows = db.execute('SELECT * FROM ' + table + ' WHERE ' + clause, values).fetchall()
            expected = _mapped(source, owner_id)
            if len(rows) != 1 or dict(rows[0]) != expected:
                raise RuntimeError('Frozen row changed beyond declared outer-owner mapping: ' + table)
            actual[table].append({key: rows[0][key] for key in source})
    return actual


def _restore_closed_report(db, *, owner_id, repository_root, write_receipt, admission_scope):
    """Internal transactional core; callers must supply an isolated test DB.

    This is not a local native runner. Native callers must use prepare_native_history,
    which applies policy, origin, path and independently scoped admission first.
    Receipt failure rolls back, without trying to repair/rewrite any old record.
    """
    if admission_scope != SCOPE:
        raise RuntimeError('Separate historical fixture scope is required even for isolated transaction contracts.')
    selected, manifest, source = verified_closure(repository_root)
    if db.in_transaction:
        raise RuntimeError('Historical preparation requires its own transaction.')
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('BEGIN IMMEDIATE')
    try:
        if db.execute('PRAGMA foreign_keys').fetchone()[0] != 1 or db.execute('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('Pre-import foreign-key verification failed.')
        user = db.execute('SELECT id,email FROM users WHERE id=?', (owner_id,)).fetchone()
        if not user or not user['email'].endswith('@test.example') or owner_id == SOURCE_OWNER:
            raise RuntimeError('A newly registered, distinct synthetic owner is required.')
        # No existing business history is merged. In particular, never import
        # a queued row and then convert its state to make the worker ignore it.
        for table in COUNTS:
            if db.execute('SELECT count(*) FROM ' + table).fetchone()[0]:
                raise RuntimeError('Historical preparation requires empty capture tables: ' + table)
        for table in EMPTY_BUSINESS_TABLES:
            if db.execute('SELECT count(*) FROM ' + table).fetchone()[0]:
                raise RuntimeError('Historical preparation requires an empty business database: ' + table)
        for table, rows in selected.items():
            for source_row in rows:
                row = _mapped(source_row, owner_id)
                if table == 'dataset_revisions':
                    actual = db.execute('SELECT * FROM dataset_revisions WHERE dataset_id=? AND version=?',
                                        (row['dataset_id'], row['version'])).fetchone()
                    if actual is None or dict(actual) != row:
                        raise RuntimeError('Unmodified dataset insert trigger must produce the exact original revision.')
                    continue
                columns = list(row)
                db.execute('INSERT INTO ' + table + '(' + ','.join(columns) + ') VALUES('
                           + ','.join('?' for _ in columns) + ')', [row[key] for key in columns])
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('Post-import foreign-key verification failed.')
        actual = _read_closed_rows(db, selected, manifest, owner_id)
        counts = {table: db.execute('SELECT count(*) FROM ' + table).fetchone()[0] for table in COUNTS}
        if counts != COUNTS or db.execute("SELECT count(*) FROM runs WHERE state IN ('queued','running')").fetchone()[0]:
            raise RuntimeError('Only 49 completed-report rows and zero old queues are admitted.')
        receipt = {'scope': SCOPE, 'receipt_phase': 'validated_before_commit',
                   'source': source, 'source_fixture_sha256': FIXTURE_SHA256,
                   'closure_manifest_sha256': MANIFEST_SHA256, 'selected_row_count': 49,
                   'row_counts': counts, 'owner_mapping': {'from': SOURCE_OWNER, 'to': owner_id},
                   'only_changed_column': 'outer user_id', 'all_other_columns_exact': True,
                   'foreign_key_check_before': [], 'foreign_key_check_after': [],
                   'revision_created_by_unchanged_trigger': True, 'queued_or_running': 0,
                   'authentication_rows_copied': 0, 'ui_mutation_claimed': False,
                   'old_account_upgrade_claimed': False, 'current_native_report_creation_claimed': False,
                   'assistant_proposal_binding': None, 'original_export_sha256': EXPORT_SHA256,
                   'original_and_mapped_row_receipts': {
                       table: [{'key': spec['key'], 'original_sha256': row_manifest_hash(original),
                                'mapped_sha256': row_manifest_hash(mapped),
                                'serialized_column_sha256': spec['serialized_column_sha256']}
                               for original, mapped, spec in zip(selected[table], actual[table], manifest['selected'][table]['rows'])]
                       for table in COUNTS}}
        write_receipt(receipt)  # Record explicitly before commit; failure must roll back.
        db.commit()
        return {**receipt, 'commit_confirmed': True}
    except BaseException:
        db.rollback()
        raise


def require_history_admission(probe, admission_scope):
    if admission_scope != SCOPE or ARTIFACT_KIND not in getattr(probe, 'artifact_kinds', ()):
        raise RuntimeError('Separate historical fixture admission and preparation receipt kind are required; fault-injection is insufficient.')


def require_history_environment(probe, data_dir, admission_scope):
    """No browser or DB access before independently scoped native admission."""
    require_history_admission(probe, admission_scope)
    try:
        from .product_browser_audit import require_isolated_runner
    except ImportError:
        from product_browser_audit import require_isolated_runner
    require_isolated_runner(probe.base_url, data_dir)
    root = Path(data_dir)
    if root.is_symlink() or root.resolve() != Path(os.environ.get('DATA_DIR', '')).resolve():
        raise RuntimeError('Legacy fixture must use this running isolated DATA_DIR without a symlink.')
    path = root / 'lidian.sqlite3'
    if not path.is_file() or path.is_symlink():
        raise RuntimeError('Existing isolated native database required.')
    return path.resolve()


def prepare_native_history(probe, *, data_dir, repository_root, registration_owner, admission_scope=None):
    database = require_history_environment(probe, data_dir, admission_scope)
    owner = probe.get('/api/auth/me')['user']['id']
    if registration_owner != owner or probe.observations.get('historical_native_registration_owner') != owner:
        raise RuntimeError('Fixture destination must be the owner from this journey’s actual registration response.')
    path = Path(probe.directory) / 'historical-preparation.json'
    if path.exists():
        raise RuntimeError('Historical preparation is single-use; never reuse a previous receipt.')
    def record(receipt):
        with path.open('x', encoding='utf-8') as stream:
            json.dump(receipt, stream, ensure_ascii=False, indent=2)
        probe.record_artifact(path, kind=ARTIFACT_KIND)
    with closing(sqlite3.connect(database.as_uri() + '?mode=rw', uri=True, timeout=5)) as db:
        receipt = _restore_closed_report(db, owner_id=owner, repository_root=repository_root,
            write_receipt=record, admission_scope=admission_scope)
    probe.observations['historical_preparation'] = receipt
    return receipt


def _verify_rows_and_counts(db, *, selected, manifest, owner, current_thread_id=None, current_message_id=None):
    if (current_thread_id is None) != (current_message_id is None):
        raise RuntimeError('Both actual current message and thread IDs are required together.')
    actual = _read_closed_rows(db, selected, manifest, owner)
    for table in EMPTY_BUSINESS_TABLES:
        if db.execute('SELECT count(*) FROM ' + table).fetchone()[0]:
            raise RuntimeError('Unexpected business rows in required-empty table: ' + table)
    expected_counts = dict(COUNTS)
    if current_thread_id is not None:
        thread = db.execute("SELECT user_id,kind FROM workspace_objects WHERE id=?", (current_thread_id,)).fetchone()
        message = db.execute('SELECT user_id,thread_id FROM copilot_messages WHERE id=?', (current_message_id,)).fetchone()
        if (not thread or dict(thread) != {'user_id': owner, 'kind': 'assistant_thread'}
                or not message or dict(message) != {'user_id': owner, 'thread_id': current_thread_id}):
            raise RuntimeError('Only this owner’s actual one new current thread and message are allowed.')
        expected_counts['workspace_objects'] += 1
        expected_counts['copilot_messages'] += 1
    if {table: db.execute('SELECT count(*) FROM ' + table).fetchone()[0] for table in COUNTS} != expected_counts:
        raise RuntimeError('Unexpected business rows beyond the 49-row closure and declared current question.')
    if db.execute('PRAGMA foreign_key_check').fetchall():
        raise RuntimeError('Historical verification found broken foreign keys.')
    return {table: [row_manifest_hash(row) for row in rows] for table, rows in actual.items()}


def verify_native_history(probe, *, data_dir, repository_root, admission_scope=None,
                          current_thread_id=None, current_message_id=None):
    database = require_history_environment(probe, data_dir, admission_scope)
    selected, manifest, _ = verified_closure(repository_root)
    owner = probe.get('/api/auth/me')['user']['id']
    receipt = probe.observations.get('historical_preparation', {})
    if receipt.get('owner_mapping', {}).get('to') != owner:
        raise RuntimeError('History verification requires this exact prepared owner.')
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=5)) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        return _verify_rows_and_counts(db, selected=selected, manifest=manifest, owner=owner,
            current_thread_id=current_thread_id, current_message_id=current_message_id)
