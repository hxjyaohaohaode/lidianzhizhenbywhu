"""Genuine 80defc9 API plans re-opened with new transformation admission.

The capture preserves serialized business rows and original fingerprints. Only
outer owner columns are mapped to a fresh isolated account, never saved payloads.
"""
import json
from datetime import datetime
from pathlib import Path

import pytest

from conftest import Actor
from server.execution_scope import plan_scope_issue
from server.studio import approved_run_valid, plan_fingerprint_valid
from test_currency_comparison_scope import ForbiddenProviders
from test_legacy_execution_scope import approve, frozen
from test_services import ok

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/percentage-execution-scope-80defc9.json').read_text())


@pytest.fixture
def captured_actor(factory, monkeypatch, request):
    fixture = (json.loads((Path(__file__).parent / 'fixtures' / request.param).read_text())
               if hasattr(request, 'param') else FIXTURE)
    providers = ForbiddenProviders()
    actor = Actor(factory(providers=providers, max_queued_per_user=100))
    actor.scope_capture = fixture
    store = actor.client.app.state.store
    captured = datetime.fromisoformat(fixture['source']['captured_at'])
    class CapturedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return captured.astimezone(tz) if tz else captured.replace(tzinfo=None)
    for module in ('studio', 'copilot', 'adaptive_runtime', 'clock'):
        monkeypatch.setattr('server.'+module+'.datetime', CapturedDatetime)
    with store.transaction() as db:
        for table, rows in fixture['tables'].items():
            for raw in rows:
                row = dict(raw)
                if 'user_id' in row: row['user_id'] = actor.user['id']
                if table == 'dataset_revisions':
                    actual = dict(db.execute('SELECT * FROM dataset_revisions WHERE dataset_id=? AND version=?', (row['dataset_id'], row['version'])).fetchone())
                    assert actual == row
                    continue
                columns = list(row)
                db.execute('INSERT INTO '+table+'('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')', [row[k] for k in columns])
    yield actor
    assert providers.calls == []


def objects(actor, key):
    case = actor.scope_capture['cases'][key]; store = actor.client.app.state.store
    plan = store.one('SELECT * FROM workspace_objects WHERE id=?', (case['plan_id'],))
    assert plan_fingerprint_valid(plan['payload'])
    run = store.owned('runs', actor.user['id'], case['run_id']) if case['run_id'] else None
    if run: assert approved_run_valid(store, run)
    return store, case, plan, run


@pytest.mark.parametrize('key', ['legacy_draft', 'adaptive_draft', 'source_bad_draft'])
def test_old_transformation_plan_refuses_new_approval_without_writes(captured_actor, key):
    actor = captured_actor; store, case, plan, _ = objects(actor, key)
    assert plan_scope_issue(store, plan)['reason'] == 'percentage_transformation_unsupported'
    before = frozen(store, case); changes = store.db.total_changes
    assert ok(approve(actor, case, plan), 409)['error']['code'] == 'PLAN_SCOPE_REPREVIEW'
    assert store.db.total_changes == changes and frozen(store, case) == before


@pytest.mark.parametrize('key', ['legacy_queued', 'adaptive_queued'])
def test_already_approved_bad_plan_stops_before_new_execution(captured_actor, key):
    actor = captured_actor; store, case, plan, run = objects(actor, key)
    before = frozen(store, case); done = actor.execute(run)
    assert done['state'] == 'interrupted' and done['result'] is None
    assert '百分比变化' in done['error'] and frozen(store, case) == before
    assert approved_run_valid(store, done)
    event = store.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq', (run['id'],))[-1]
    assert event['type'] == 'scope_repreview_required'


@pytest.mark.parametrize('key', ['legacy_completed', 'adaptive_completed'])
def test_old_completed_answer_and_exports_are_retained_byte_for_byte(captured_actor, key):
    import hashlib
    actor = captured_actor; store, case, plan, run = objects(actor, key)
    assert plan_scope_issue(store, plan)['reason'] == 'percentage_transformation_unsupported'
    before = frozen(store, case); changes = store.db.total_changes
    assert ok(actor.get('/runs/'+run['id']))['result'] == run['result']
    for kind, expected in case['export_sha256'].items():
        response = actor.get('/runs/'+run['id']+'/export?format='+kind)
        assert response.status_code == 200 and hashlib.sha256(response.content).hexdigest() == expected
    assert ok(approve(actor, case, plan), 202)['id'] == run['id']
    assert actor.execute(run)['result'] == run['result']
    assert store.db.total_changes == changes and frozen(store, case) == before


@pytest.mark.parametrize('key', ['amount_draft', 'revenue_draft', 'points_draft', 'source_good_draft'])
def test_old_supported_operations_and_explicit_edited_target_still_execute(captured_actor, key):
    actor = captured_actor; store, case, plan, _ = objects(actor, key)
    assert plan_scope_issue(store, plan) is None
    original = plan['payload']['snapshot']; fingerprint = plan['payload']['fingerprint']
    approved = ok(approve(actor, case, plan), 200 if case['proposal_id'] else 202)
    run = ok(actor.get('/runs/'+approved['payload']['result']['run_id'])) if case['proposal_id'] else approved
    done = actor.execute(run)
    assert done['state'] in ('succeeded', 'degraded') and done['result']
    assert done['result']['analysis']['baseline_period'] == '2024-Q1'
    current = store.one('SELECT * FROM workspace_objects WHERE id=?', (case['plan_id'],))
    assert current['payload']['snapshot'] == original and current['payload']['fingerprint'] == fingerprint


@pytest.mark.parametrize('captured_actor', ['percentage-word-order-scope-80defc9.json'], indirect=True)
@pytest.mark.parametrize('index', range(4))
def test_old_omitted_verb_and_reordered_percentage_drafts_cannot_gain_new_approval(captured_actor, index):
    actor = captured_actor; store, case, plan, _ = objects(actor, 'word_order_'+str(index)+'_draft')
    assert plan_scope_issue(store, plan)['reason'] == 'percentage_transformation_unsupported'
    before = frozen(store, case); changes = store.db.total_changes
    assert ok(approve(actor, case, plan), 409)['error']['code'] == 'PLAN_SCOPE_REPREVIEW'
    assert store.db.total_changes == changes and frozen(store, case) == before


@pytest.mark.parametrize('captured_actor', ['percentage-word-order-scope-80defc9.json'], indirect=True)
@pytest.mark.parametrize('index', range(4))
def test_old_omitted_verb_and_reordered_percentage_queues_stop_before_execution(captured_actor, index):
    actor = captured_actor; store, case, plan, run = objects(actor, 'word_order_'+str(index)+'_queued')
    before = frozen(store, case); done = actor.execute(run)
    assert done['state'] == 'interrupted' and done['result'] is None
    assert '百分比变化' in done['error'] and frozen(store, case) == before
    assert approved_run_valid(store, done)
