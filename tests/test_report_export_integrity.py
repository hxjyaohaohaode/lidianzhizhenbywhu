"""Readable exports reject known corruption without rewriting frozen reports.

Local API/worker execution and genuine historical synthetic fixtures only.
Fault injection is restricted to each test's temporary SQLite database.
"""
from copy import deepcopy

import pytest

from conftest import Actor
from server import report_export
from server.store import encode
from test_business_provenance import ok, revise
from test_legacy_comparison_shape import restore_true_legacy
from test_report_source_integrity import CORRUPTIONS, corrupt, execute_unanchored_legacy
from test_workspace_api import execute, plan


FORMATS = ('json', 'md')


def frozen_tables(store):
    names = [row[0] for row in store.db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    return {name: sorted((tuple(row) for row in store.db.execute(
        'SELECT * FROM "' + name + '"')), key=repr) for name in names}


def original_export_bytes(store, run):
    """The pre-gate export contract, including export-time review context."""
    events = store.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq', (run['id'],))
    reviews = store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='claim_review' AND json_extract(payload,'$.run_id')=? ORDER BY created_at,id", (run['user_id'], run['id']))
    assessment = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='assessment' AND natural_key=?", (run['user_id'], run['id']))
    payload = report_export.report_payload(run, events, reviews, assessment)
    return {'json': encode(payload).encode(), 'md': report_export.markdown_report(payload).encode()}


def assert_exports(actor, run, expected):
    for format in FORMATS:
        response = actor.get('/runs/' + run['id'] + '/export?format=' + format)
        assert response.status_code == 200, response.text
        assert response.content == expected[format]
        assert response.headers['content-disposition'] == f'attachment; filename="diagnosis-{run["id"][:8]}.{format}"'
        assert response.headers['content-type'].startswith('application/json' if format == 'json' else 'text/markdown')
        if format == 'json':
            assert {k: v for k, v in response.json().items()
                    if k not in {'execution_events', 'export_context'}} == run['result']


@pytest.mark.parametrize('workflow', ('studio', 'adaptive', 'legacy', 'legacy_unanchored', 'actual_preanchor'))
def test_valid_and_current_source_changed_exports_preserve_exact_bytes(actor, monkeypatch, workflow):
    store = actor.client.app.state.store
    if workflow == 'actual_preanchor':
        store, run_id = restore_true_legacy(actor)
        run = store.owned('runs', actor.user['id'], run_id)
        dataset = store.owned('datasets', actor.user['id'], run['dataset_id'])
        assert 'readout' not in run['result']
    else:
        dataset = actor.dataset()
        if workflow == 'legacy':
            run = actor.execute(ok(actor.run(dataset), 202))
        elif workflow == 'legacy_unanchored':
            run = execute_unanchored_legacy(actor, dataset, monkeypatch)
        else:
            run = execute(actor, plan(actor, dataset, **({'execution': {}} if workflow == 'adaptive' else {})))
    expected = original_export_bytes(store, run)
    before, changes = frozen_tables(store), store.db.total_changes
    audit = ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    assert audit['report_integrity']['valid']
    if workflow in {'legacy_unanchored', 'actual_preanchor'}:
        assert audit['report_integrity']['format'] == 'legacy'
        assert audit['report_hash_valid'] is None
    assert_exports(actor, run, expected)
    assert frozen_tables(store) == before and store.db.total_changes == changes

    revised = revise(actor, dataset)
    assert revised['version'] == dataset['version'] + 1
    before, changes = frozen_tables(store), store.db.total_changes
    audit = ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    assert audit['report_integrity']['valid'] and audit['source_impact']['state'] == 'changed'
    assert_exports(actor, run, expected)
    assert store.owned('runs', actor.user['id'], run['id']) == run
    assert frozen_tables(store) == before and store.db.total_changes == changes


EXPORT_CORRUPTIONS = tuple(c for c in CORRUPTIONS if c not in {'missing_result', 'empty_result'}) + (
    'readout_number', 'missing_readout',
)


@pytest.mark.parametrize('change', EXPORT_CORRUPTIONS)
def test_corrupt_export_is_structured_error_before_formatting_and_never_writes(actor, monkeypatch, change):
    dataset = actor.dataset()
    run = execute(actor, plan(actor, dataset, query='核查2025-Q4毛利率'))
    healthy = execute(actor, plan(actor, dataset, query='核查2025-Q4经营现金流'))
    other = Actor(actor.client)
    store = actor.client.app.state.store
    expected = original_export_bytes(store, healthy)
    assert_exports(actor, healthy, expected)
    if change in {'readout_number', 'missing_readout'}:
        result = deepcopy(run['result'])
        assert result['readout']['facts'][0]['value'] == pytest.approx(.225)
        if change == 'readout_number':
            result['readout']['facts'][0]['value'] = 9876.54321
        else:
            del result['readout']
        with store.transaction() as db:
            db.execute('UPDATE runs SET result=? WHERE id=?', (encode(result), run['id']))
    else:
        corrupt(store, run, change)
    before, changes = frozen_tables(store), store.db.total_changes
    audit = ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    assert not audit['report_integrity']['valid']
    assert audit['report_integrity']['format'] == 'studio'
    assert audit['source_impact']['state'] == 'unavailable'
    if change in {'readout_number', 'missing_readout'}:
        assert audit['report_integrity']['failures'] == ['report_hash']

    formatted = []
    original_payload, original_markdown = report_export.report_payload, report_export.markdown_report
    with monkeypatch.context() as patch:
        patch.setattr(report_export, 'report_payload', lambda *args: formatted.append('payload') or original_payload(*args))
        patch.setattr(report_export, 'markdown_report', lambda *args: formatted.append('markdown') or original_markdown(*args))
        for format in FORMATS:
            path = '/runs/' + run['id'] + '/export?format=' + format
            response = actor.get(path)
            assert response.status_code == 409, response.text
            assert response.json()['error']['code'] == 'REPORT_INTEGRITY'
            assert '完整性' in response.json()['error']['message']
            assert response.json()['request_id']
            assert 'content-disposition' not in response.headers
            assert '9876.54321' not in response.text and '987,654' not in response.text
            assert '此历史报告当时未记录' not in response.text
            denied = other.get(path)
            assert denied.status_code == 404 and denied.json()['error']['code'] == 'NOT_FOUND'
    assert formatted == []
    assert_exports(actor, healthy, expected)
    assert frozen_tables(store) == before and store.db.total_changes == changes


def test_new_legacy_export_rejects_changed_output_using_terminal_digest(actor):
    run = actor.execute(ok(actor.run(), 202))
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE runs SET result=? WHERE id=?', (encode({**run['result'], 'title': 'corrupt legacy output'}), run['id']))
    before, changes = frozen_tables(store), store.db.total_changes
    audit = ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    assert audit['report_integrity'] == {'valid': False, 'format': 'legacy', 'failures': ['report_hash']}
    for format in FORMATS:
        response = actor.get('/runs/' + run['id'] + '/export?format=' + format)
        assert response.status_code == 409 and response.json()['error']['code'] == 'REPORT_INTEGRITY'
    assert frozen_tables(store) == before and store.db.total_changes == changes


@pytest.mark.parametrize('state', ('queued', 'failed', 'missing_result', 'empty_result'))
def test_not_ready_export_contract_still_precedes_integrity(actor, monkeypatch, state):
    run = ok(actor.run(), 202)
    store = actor.client.app.state.store
    if state in {'missing_result', 'empty_result'}:
        run = actor.execute(run)
        with store.transaction() as db:
            db.execute('UPDATE runs SET result=? WHERE id=?', (encode(None if state == 'missing_result' else {}), run['id']))
    elif state == 'failed':
        with store.transaction() as db:
            db.execute("UPDATE runs SET state='failed' WHERE id=?", (run['id'],))
    from server import report_integrity
    inspected = []
    monkeypatch.setattr(report_integrity, 'inspect_report_integrity', lambda *args: inspected.append(True))
    before, changes = frozen_tables(store), store.db.total_changes
    for format in FORMATS:
        response = actor.get('/runs/' + run['id'] + '/export?format=' + format)
        assert response.status_code == 409 and response.json()['error']['code'] == 'NOT_READY'
    assert inspected == []
    assert frozen_tables(store) == before and store.db.total_changes == changes


def test_export_format_validation_and_ownership_precede_integrity(actor, monkeypatch):
    dataset = actor.dataset()
    run = execute(actor, plan(actor, dataset))
    pending = ok(actor.run(dataset), 202)
    other = Actor(actor.client)
    store = actor.client.app.state.store
    corrupt(store, run, 'result')
    from server import report_integrity
    inspected = []
    monkeypatch.setattr(report_integrity, 'inspect_report_integrity', lambda *args: inspected.append(True))
    before, changes = frozen_tables(store), store.db.total_changes
    for run_id in (run['id'], pending['id'], 'missing-report'):
        for format in ('csv', '', 'JSON'):
            response = actor.get('/runs/' + run_id + '/export?format=' + format)
            assert response.status_code == 422 and response.json()['error']['code'] == 'VALIDATION_ERROR'
        for format in FORMATS:
            denied = other.get('/runs/' + run_id + '/export?format=' + format)
            assert denied.status_code == 404 and denied.json()['error']['code'] == 'NOT_FOUND'
    assert inspected == []
    assert frozen_tables(store) == before and store.db.total_changes == changes
