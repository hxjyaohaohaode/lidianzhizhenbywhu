"""Synthetic report corruption stays unusable as a new business origin.

All reports are executed locally through the real APIs; no external providers are
called. Corruption is injected only into each test's isolated temporary database.
"""
from copy import deepcopy

import pytest

from server.store import digest, encode
from server import workspace_store as ws
from server.business_provenance import with_source_impact
from test_business_provenance import action, action_ref, ok, revise
from test_workspace_api import execute, plan


CORRUPTIONS = (
    'result', 'artifact', 'nonfinal_artifact', 'artifact_rehashed',
    'result_and_artifact_rehashed', 'anchor_hash', 'anchor_node', 'ledger',
    'snapshot', 'dataset', 'missing_final_artifact', 'missing_nonfinal_artifact',
    'missing_final_event', 'missing_terminal_event', 'missing_all_artifacts',
    'malformed_snapshot', 'malformed_event', 'malformed_anchor',
    'malformed_result', 'missing_result', 'empty_result', 'dataset_binding',
)


def watch_request(actor, dataset, source):
    return actor.post('/services/watches', json={
        'title': '核查已保存报告的毛利率依据', 'dataset_id': dataset['id'],
        'metric': 'gross_margin', 'operator': 'lt', 'threshold': 0.9,
        'source_ref': source,
    })


def execute_unanchored_legacy(actor, dataset, monkeypatch):
    """Write the pre-anchor worker event contract, without rewriting any output."""
    store = actor.client.app.state.store
    original_event = store.event
    def old_event(db, run_id, type, payload):
        original_event(db, run_id, type, {k: v for k, v in payload.items() if k != 'report_hash'})
    with monkeypatch.context() as patch:
        patch.setattr(store, 'event', old_event)
        return actor.execute(ok(actor.run(dataset), 202))


def corrupt(store, report, change):
    run_id = report['id']
    final = store.one("SELECT * FROM agent_artifacts WHERE run_id=? AND node='report'", (run_id,))
    anchor = store.one("SELECT * FROM run_events WHERE run_id=? AND type='step_completed' AND json_extract(payload,'$.node')='report'", (run_id,))
    with store.transaction() as db:
        if change in {'result', 'result_and_artifact_rehashed'}:
            result = {**report['result'], 'title': '损坏后不应被重新认证的报告'}
            db.execute('UPDATE runs SET result=? WHERE id=?', (encode(result), run_id))
            if change == 'result_and_artifact_rehashed':
                db.execute('UPDATE agent_artifacts SET payload=?,content_hash=? WHERE id=?',
                           (encode(result), digest(result), final['id']))
        elif change in {'artifact', 'nonfinal_artifact', 'artifact_rehashed'}:
            artifact = final if change != 'nonfinal_artifact' else store.one(
                "SELECT * FROM agent_artifacts WHERE run_id=? AND node='quant'", (run_id,))
            altered = {'injected_corruption': True}
            db.execute('UPDATE agent_artifacts SET payload=?,content_hash=? WHERE id=?',
                       (encode(altered), digest(altered) if change == 'artifact_rehashed' else artifact['content_hash'], artifact['id']))
        elif change in {'anchor_hash', 'anchor_node'}:
            payload = {**anchor['payload'], **({'output_hash': '0' * 64} if change == 'anchor_hash' else {'node': 'quant'})}
            db.execute('UPDATE run_events SET payload=? WHERE seq=?', (encode(payload), anchor['seq']))
        elif change == 'malformed_event':
            db.execute('UPDATE run_events SET payload=? WHERE seq=?', (encode(None), anchor['seq']))
        elif change == 'malformed_anchor':
            db.execute('UPDATE run_events SET payload=? WHERE seq=?', (encode({**anchor['payload'], 'artifact_id': []}), anchor['seq']))
        elif change in {'malformed_result', 'missing_result', 'empty_result', 'dataset_binding'}:
            result = {'malformed_result': ['invalid output shape'], 'missing_result': None,
                      'empty_result': {}, 'dataset_binding': {**report['result'], 'dataset_version': 99}}[change]
            db.execute('UPDATE runs SET result=? WHERE id=?', (encode(result), run_id))
        elif change == 'ledger':
            db.execute('UPDATE event_integrity SET entry_hash=? WHERE event_seq=?', ('0' * 64, anchor['seq']))
        elif change in {'snapshot', 'dataset', 'malformed_snapshot'}:
            snapshot = deepcopy(report['snapshot'])
            if change == 'snapshot': snapshot['preferences']['risk_appetite'] = 'corrupted'
            elif change == 'dataset': snapshot['dataset']['periods'][-1]['revenue'] += 7
            else: snapshot = None
            db.execute('UPDATE runs SET snapshot=? WHERE id=?', (encode(snapshot), run_id))
        elif change == 'missing_final_artifact':
            db.execute('DELETE FROM agent_artifacts WHERE id=?', (final['id'],))
        elif change == 'missing_nonfinal_artifact':
            db.execute("DELETE FROM agent_artifacts WHERE run_id=? AND node='quant'", (run_id,))
        elif change == 'missing_final_event':
            db.execute('DELETE FROM run_events WHERE seq=?', (anchor['seq'],))
        elif change == 'missing_terminal_event':
            # Deleting the last event and its cascading ledger row leaves a valid
            # shortened hash chain, but no proof of completed report publication.
            db.execute("DELETE FROM run_events WHERE run_id=? AND type IN ('succeeded','degraded')", (run_id,))
        elif change == 'missing_all_artifacts':
            db.execute('DELETE FROM agent_artifacts WHERE run_id=?', (run_id,))
        else:
            raise AssertionError(change)


@pytest.mark.parametrize('change', CORRUPTIONS)
def test_corrupt_report_blocks_direct_and_inherited_actions_and_watches_without_writes(actor, change):
    dataset = actor.dataset()
    report = execute(actor, plan(actor, dataset))
    source = {'kind': 'report', 'run_id': report['id']}
    parent = ok(action(actor, dataset, source_ref=source), 201)
    child = ok(action(actor, dataset, source_ref=action_ref(parent)), 201)
    saved_watch = ok(watch_request(actor, dataset, action_ref(child)), 201)
    store = actor.client.app.state.store
    corrupt(store, report, change)
    before_changes = store.db.total_changes
    before_objects = store.all('SELECT * FROM workspace_objects ORDER BY id')
    before_run = store.owned('runs', actor.user['id'], report['id'])

    audit = ok(actor.get('/workspace/runs/' + report['id'] + '/audit'))
    assert audit['report_integrity']['valid'] is False
    assert audit['report_integrity']['format'] == 'studio'
    assert audit['source_impact']['state'] == 'unavailable'
    assert audit['source_impact']['reasons'][0]['code'] == 'report_integrity_failed'
    if change == 'missing_terminal_event':
        assert audit['ledger']['valid'] and 'report_completion' in audit['report_integrity']['failures']
    if change == 'dataset': assert audit['data_hash_valid'] is False
    if change in {'missing_result', 'empty_result'}: assert audit['snapshot_hash_valid'] is False
    if change == 'result_and_artifact_rehashed':
        assert audit['report_hash_valid'] and all(a['integrity_valid'] for a in audit['artifacts'])
        assert 'artifact_anchor' in audit['report_integrity']['failures']

    for ref in (source, action_ref(parent), action_ref(child)):
        for historical in (False, True):
            selected = {**ref, 'allow_historical': historical}
            for response in (action(actor, dataset, source_ref=selected), watch_request(actor, dataset, selected)):
                assert response.status_code == 409, response.text
                assert response.json()['error']['code'] == 'REPORT_INTEGRITY'

    listed_actions = ok(actor.get('/workspace/actions'))['items']
    assert {a['id'] for a in listed_actions} == {parent['id'], child['id']}
    assert all(a['source_impact']['state'] == 'unavailable' for a in listed_actions)
    assert all('report_integrity_failed' in {r['code'] for r in a['source_impact']['reasons']} for a in listed_actions)
    # The tracking endpoint intentionally evaluates existing rules. Exercise its
    # read-only overlay directly so that unrelated alert evaluation is excluded.
    current_watch = with_source_impact(store, actor.user['id'], ws.get(store, actor.user['id'], 'watch', saved_watch['id']))
    assert current_watch['payload'] == saved_watch['payload']
    assert current_watch['source_impact']['state'] == 'unavailable'
    assert store.all('SELECT * FROM workspace_objects ORDER BY id') == before_objects
    assert store.owned('runs', actor.user['id'], report['id']) == before_run
    assert store.db.total_changes == before_changes


@pytest.mark.parametrize('workflow', ('studio', 'adaptive', 'legacy', 'legacy_unanchored'))
def test_healthy_and_genuinely_historical_reports_keep_supported_source_workflows(actor, monkeypatch, workflow):
    dataset = actor.dataset()
    if workflow == 'legacy':
        report = actor.execute(ok(actor.run(dataset), 202))
    elif workflow == 'legacy_unanchored':
        report = execute_unanchored_legacy(actor, dataset, monkeypatch)
    else:
        report = execute(actor, plan(actor, dataset, **({'execution': {}} if workflow == 'adaptive' else {})))
    source = {'kind': 'report', 'run_id': report['id']}
    audit = ok(actor.get('/workspace/runs/' + report['id'] + '/audit'))
    assert audit['report_integrity'] == {'valid': True, 'format': 'legacy' if workflow.startswith('legacy') else 'studio', 'failures': []}
    assert audit['source_impact']['state'] == 'current'
    if workflow.startswith('legacy'):
        assert not audit['artifacts']
        assert all('output_hash' not in e['payload'] for e in audit['trace'])
    if workflow == 'legacy_unanchored':
        assert audit['report_hash_valid'] is None
        assert all('report_hash' not in e['payload'] for e in audit['trace'])
    else:
        assert audit['report_hash_valid']
    parent = ok(action(actor, dataset, source_ref=source), 201)
    direct_watch = ok(watch_request(actor, dataset, source), 201)
    inherited = ok(watch_request(actor, dataset, action_ref(parent)), 201)
    assert parent['source_impact']['state'] == direct_watch['source_impact']['state'] == inherited['source_impact']['state'] == 'current'

    revised = revise(actor, dataset)
    for ref in (source, action_ref(parent)):
        assert action(actor, revised, source_ref=ref).status_code == 409
        assert watch_request(actor, revised, ref).status_code == 409
        historical = {**ref, 'allow_historical': True}
        for row in (ok(action(actor, revised, source_ref=historical), 201), ok(watch_request(actor, revised, historical), 201)):
            assert row['source_impact']['state'] == 'changed'
            assert row['payload']['provenance']['report_hash'] == digest(report['result'])
            assert row['payload']['provenance']['dataset_version'] == 1
            assert row['payload']['provenance']['dataset_hash'] == dataset['content_hash']
    after = ok(actor.get('/workspace/runs/' + report['id'] + '/audit'))
    assert after['report_integrity']['valid'] and after['source_impact']['state'] == 'changed'
    assert actor.client.app.state.store.owned('runs', actor.user['id'], report['id']) == report


def test_inherited_legacy_report_digest_mismatch_cannot_be_historically_acknowledged(actor, monkeypatch):
    dataset = actor.dataset()
    report = execute_unanchored_legacy(actor, dataset, monkeypatch)
    parent = ok(action(actor, dataset, source_ref={'kind': 'report', 'run_id': report['id']}), 201)
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE runs SET result=? WHERE id=?', (encode({**report['result'], 'title': 'changed legacy output'}), report['id']))
    before = store.db.total_changes
    selected = {**action_ref(parent), 'allow_historical': True}
    for response in (action(actor, dataset, source_ref=selected), watch_request(actor, dataset, selected)):
        assert response.status_code == 409 and response.json()['error']['code'] == 'REPORT_INTEGRITY'
    assert len(ws.objects(store, actor.user['id'], 'action')) == 1
    assert not ws.objects(store, actor.user['id'], 'watch')
    assert store.db.total_changes == before


@pytest.mark.parametrize('change', ('title', 'claims', 'terminal_hash', 'removed_hash', 'empty_hash', 'result_and_hash', 'ledger'))
def test_new_legacy_report_hash_rejects_corruption_without_writes(actor, change):
    dataset = actor.dataset()
    report = actor.execute(ok(actor.run(dataset), 202))
    source = {'kind': 'report', 'run_id': report['id']}
    parent = ok(action(actor, dataset, source_ref=source), 201)
    store = actor.client.app.state.store
    terminal = store.one("SELECT * FROM run_events WHERE run_id=? AND type=?", (report['id'], report['state']))
    assert terminal['payload']['report_hash'] == digest(report['result'])
    with store.transaction() as db:
        if change in {'title', 'claims', 'result_and_hash'}:
            result = deepcopy(report['result'])
            if change == 'claims': result['llm']['review']['claims'] = [{'id': 'injected', 'text': 'unverified altered claim'}]
            else: result['title'] = 'Altered output must not become a fresh source'
            db.execute('UPDATE runs SET result=? WHERE id=?', (encode(result), report['id']))
            if change == 'result_and_hash':
                db.execute('UPDATE run_events SET payload=? WHERE seq=?',
                           (encode({**terminal['payload'], 'report_hash': digest(result)}), terminal['seq']))
        elif change in {'terminal_hash', 'removed_hash', 'empty_hash'}:
            payload = dict(terminal['payload'])
            if change == 'removed_hash': payload.pop('report_hash')
            else: payload['report_hash'] = '' if change == 'empty_hash' else '0' * 64
            db.execute('UPDATE run_events SET payload=? WHERE seq=?', (encode(payload), terminal['seq']))
        elif change == 'ledger':
            db.execute('UPDATE event_integrity SET entry_hash=? WHERE event_seq=?', ('0' * 64, terminal['seq']))
    before = store.db.total_changes
    saved_run = store.owned('runs', actor.user['id'], report['id'])
    audit = ok(actor.get('/workspace/runs/' + report['id'] + '/audit'))
    assert audit['report_integrity']['format'] == 'legacy' and not audit['artifacts']
    assert not audit['report_integrity']['valid'] and audit['source_impact']['state'] == 'unavailable'
    if change in {'title', 'claims'}:
        assert audit['ledger']['valid'] and audit['report_hash_valid'] is False
    elif change == 'result_and_hash':
        assert audit['report_hash_valid'] and not audit['ledger']['valid']
    elif change == 'removed_hash':
        assert audit['report_hash_valid'] is None and not audit['ledger']['valid']
    for ref in (source, action_ref(parent)):
        for historical in (False, True):
            selected = {**ref, 'allow_historical': historical}
            for response in (action(actor, dataset, source_ref=selected), watch_request(actor, dataset, selected)):
                assert response.status_code == 409 and response.json()['error']['code'] == 'REPORT_INTEGRITY'
    assert ws.get(store, actor.user['id'], 'action', parent['id'])['payload'] == parent['payload']
    assert len(ws.objects(store, actor.user['id'], 'action')) == 1
    assert not ws.objects(store, actor.user['id'], 'watch')
    assert store.owned('runs', actor.user['id'], report['id']) == saved_run
    assert store.db.total_changes == before


def test_new_legacy_report_publication_rolls_back_when_hash_event_cannot_be_saved(actor, monkeypatch):
    dataset = actor.dataset()
    store = actor.client.app.state.store
    original_event = store.event
    def reject_publication(db, run_id, type, payload):
        if type in {'succeeded', 'degraded'}:
            assert payload.get('report_hash')
            raise RuntimeError('isolated terminal event failure')
        original_event(db, run_id, type, payload)
    monkeypatch.setattr(store, 'event', reject_publication)
    report = actor.execute(ok(actor.run(dataset), 202))
    assert report['state'] == 'failed' and report['result'] is None
    assert not store.all("SELECT * FROM messages WHERE run_id=? AND role='assistant'", (report['id'],))
    assert not store.all("SELECT * FROM run_events WHERE run_id=? AND type IN ('succeeded','degraded')", (report['id'],))
    assert ws.verify_ledger(store, report['id'])['valid']


@pytest.mark.parametrize('state', ('queued', 'running', 'failed', 'cancelled', 'interrupted'))
def test_unfinished_report_source_remains_not_ready_without_writes(actor, state):
    dataset = actor.dataset()
    run = ok(actor.run(dataset), 202)
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE runs SET state=? WHERE id=?', (state, run['id']))
    before = store.db.total_changes
    audit = ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    assert audit['snapshot_hash_valid'] is None and audit['report_hash_valid'] is None
    assert audit['source_impact'] is None and audit['data_hash_valid'] and audit['ledger']['valid']
    assert 'snapshot_hash' not in audit['report_integrity']['failures']
    for historical in (False, True):
        source = {'kind': 'report', 'run_id': run['id'], 'allow_historical': historical}
        for response in (action(actor, dataset, source_ref=source), watch_request(actor, dataset, source)):
            assert response.status_code == 409 and response.json()['error']['code'] == 'NOT_READY'
    assert not ws.objects(store, actor.user['id'], 'action') and not ws.objects(store, actor.user['id'], 'watch')
    assert store.db.total_changes == before


@pytest.mark.parametrize('workflow', ('studio', 'adaptive'))
def test_final_artifact_before_report_publication_has_pending_audit_hashes(actor, workflow):
    dataset = actor.dataset()
    report = execute(actor, plan(actor, dataset, **({'execution': {}} if workflow == 'adaptive' else {})))
    store = actor.client.app.state.store
    # Reproduce the durable prefix at the actual boundary after the final
    # artifact/step transaction, before the separate publication transaction.
    # Keep every recorded artifact and its anchor; remove only publication.
    with store.transaction() as db:
        db.execute("UPDATE runs SET state='running',result=NULL WHERE id=?", (report['id'],))
        db.execute("DELETE FROM run_events WHERE run_id=? AND type IN ('succeeded','degraded')", (report['id'],))
        db.execute("DELETE FROM messages WHERE run_id=? AND role='assistant'", (report['id'],))
    before = store.db.total_changes
    audit = ok(actor.get('/workspace/runs/' + report['id'] + '/audit'))
    assert any(a['node'] == 'report' for a in audit['artifacts'])
    assert all(a['event_anchor_valid'] and a['integrity_valid'] for a in audit['artifacts'])
    assert audit['ledger']['valid'] and audit['data_hash_valid']
    assert audit['report_hash_valid'] is None and audit['snapshot_hash_valid'] is None
    assert audit['source_impact'] is None
    assert not {'report_hash', 'snapshot_hash'} & set(audit['report_integrity']['failures'])
    source = {'kind': 'report', 'run_id': report['id'], 'allow_historical': True}
    for response in (action(actor, dataset, source_ref=source), watch_request(actor, dataset, source)):
        assert response.status_code == 409 and response.json()['error']['code'] == 'NOT_READY'
    assert store.db.total_changes == before
