"""Real SQLite/worker publication interleavings; no HTTP listener or providers."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from conftest import Actor
from server.store import Store
from server.workflows import Worker
from test_report_export_integrity import frozen_tables
from test_report_source_integrity import corrupt
from test_workspace_api import approve, execute, good, plan


@pytest.mark.parametrize('boundary', ('run', 'artifacts', 'ledger_events'))
def test_audit_keeps_one_snapshot_when_real_worker_publishes(actor, monkeypatch, boundary):
    app = actor.client.app
    store = app.state.store
    run = good(approve(actor, plan(actor, actor.dataset(), execution={})), 202)
    # A second connection proves SQLite snapshot isolation, not just the Python
    # lock. Both connections belong to this one in-process test application.
    writer = Store(store.path)
    worker = Worker(writer, app.state.providers, app.state.settings)
    ready, publish = Event(), Event()
    original_event = worker.event

    def pause_before_publication(run_id, kind, payload):
        original_event(run_id, kind, payload)
        if kind == 'node_timing' and payload.get('node') == 'report':
            ready.set()
            assert publish.wait(10), 'audit did not reach its read boundary'

    monkeypatch.setattr(worker, 'event', pause_before_publication)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            completion = pool.submit(asyncio.run, worker.execute(run['id']))
            try:
                assert ready.wait(10), 'worker did not reach real report publication'
                original_one, original_all = store.one, store.all
                event_reads, fired = 0, False
                completed_tables = None

                def advance():
                    nonlocal fired, completed_tables
                    fired = True
                    publish.set()
                    completion.result(timeout=10)
                    assert writer.owned('runs', actor.user['id'], run['id'])['result']
                    completed_tables = frozen_tables(writer)

                def one(sql, params=()):
                    value = original_one(sql, params)
                    # The first owned audit read preserves saved report text.
                    # Match that complete query, including its owner binding.
                    run_read = ('SELECT id,user_id,session_id,dataset_id,state,error,created_at,updated_at, '
                        'idempotency_key,request_hash,payload,snapshot,result AS saved_result '
                        'FROM runs WHERE id=? AND user_id=?')
                    if not fired and boundary == 'run' and ' '.join(sql.split()) == run_read:
                        assert params == (run['id'], actor.user['id'])
                        assert store.db.in_transaction
                        assert value['state'] == 'running' and value['saved_result'] is None
                        advance()
                    return value

                def all_rows(sql, params=()):
                    nonlocal event_reads
                    value = original_all(sql, params)
                    if sql == 'SELECT * FROM run_events WHERE run_id=? ORDER BY seq':
                        event_reads += 1
                    if not fired and ((boundary == 'artifacts' and sql.startswith('SELECT * FROM agent_artifacts'))
                            or (boundary == 'ledger_events' and event_reads == 2)):
                        advance()
                    return value

                with monkeypatch.context() as reads:
                    reads.setattr(store, 'one', one)
                    reads.setattr(store, 'all', all_rows)
                    changes = store.db.total_changes
                    audit = good(actor.get('/workspace/runs/' + run['id'] + '/audit'))
                assert fired
                assert audit['ledger']['valid'], audit['ledger']
                assert audit['run']['state'] == 'running' and audit['run']['result'] is None
                assert audit['report_hash_valid'] is None and audit['snapshot_hash_valid'] is None
                assert all(a['integrity_valid'] and a['event_anchor_valid'] for a in audit['artifacts'])
                assert audit['trace'][-1]['type'] == 'node_timing'
                assert audit['source_impact'] is None
                latest = good(actor.get('/workspace/runs/' + run['id'] + '/audit'))
                assert latest['report_integrity']['valid'] and latest['ledger']['valid']
                assert latest['run'] == good(actor.get('/runs/' + run['id']))
                assert latest['report_hash_valid'] and latest['snapshot_hash_valid']
                assert len(latest['trace']) == len(audit['trace']) + 1
                assert frozen_tables(store) == completed_tables
                assert store.db.total_changes == changes
                assert not store.db.in_transaction
            finally:
                publish.set()
                completion.result(timeout=10)
    finally:
        writer.close()


@pytest.mark.parametrize('change', ('result', 'ledger', 'missing_terminal_event', 'anchor_hash'))
def test_bound_audit_keeps_corrupt_reports_unavailable_without_writes(actor, change):
    report = execute(actor, plan(actor, actor.dataset(), execution={}))
    store = actor.client.app.state.store
    other = Actor(actor.client)
    corrupt(store, report, change)
    before, changes = frozen_tables(store), store.db.total_changes
    audit = good(actor.get('/workspace/runs/' + report['id'] + '/audit'))
    assert audit['run'] == good(actor.get('/runs/' + report['id']))
    assert not audit['report_integrity']['valid']
    assert audit['source_impact']['state'] == 'unavailable'
    assert actor.get('/runs/' + report['id'] + '/export?format=json').status_code == 409
    assert other.get('/workspace/runs/' + report['id'] + '/audit').status_code == 404
    assert frozen_tables(store) == before and store.db.total_changes == changes
    assert not store.db.in_transaction


def test_read_snapshot_reuses_an_outer_transaction_and_releases_after_error(actor):
    store = actor.client.app.state.store
    before, changes = frozen_tables(store), store.db.total_changes
    with store.transaction():
        with store.read_snapshot():
            assert store.one('SELECT id FROM users WHERE id=?', (actor.user['id'],))
        assert store.db.in_transaction
    with pytest.raises(RuntimeError, match='read interrupted'):
        with store.read_snapshot():
            store.one('SELECT id FROM users WHERE id=?', (actor.user['id'],))
            raise RuntimeError('read interrupted')
    assert not store.db.in_transaction
    assert frozen_tables(store) == before and store.db.total_changes == changes
