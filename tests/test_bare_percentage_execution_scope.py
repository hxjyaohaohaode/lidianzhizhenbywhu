"""Authentic old plans retain their bytes but cannot substitute amount for percent."""
import hashlib

import pytest

from server import workspace_store as ws
from server.execution_scope import plan_scope_issue
from server.question_scope import unsupported_amount_percentage
from server.studio import approved_run_valid
from test_legacy_execution_scope import approve, frozen
from test_percentage_execution_scope import captured_actor, objects
from test_services import ok

pytestmark = pytest.mark.parametrize('captured_actor', ['bare-percentage-scope-80defc9.json'], indirect=True)


@pytest.mark.parametrize('key', [
    'bare_'+engine+'_'+str(index)+'_draft' for engine in ('legacy', 'adaptive') for index in range(3)
] + ['bare_source_bad_draft'])
def test_real_old_bare_percent_draft_refuses_approval_without_writes(captured_actor, key):
    actor = captured_actor; store, case, plan, _ = objects(actor, key)
    assert unsupported_amount_percentage(plan['payload']['scope_query'])
    assert plan_scope_issue(store, plan)['reason'] == 'amount_percentage_unsupported'
    before = frozen(store, case); changes = store.db.total_changes
    assert ok(approve(actor, case, plan), 409)['error']['code'] == 'PLAN_SCOPE_REPREVIEW'
    assert frozen(store, case) == before and store.db.total_changes == changes


@pytest.mark.parametrize('key', [
    'bare_'+engine+'_'+str(index)+'_queued' for engine in ('legacy', 'adaptive') for index in range(3)
])
def test_real_old_bare_percent_queue_stops_before_new_execution(captured_actor, key):
    actor = captured_actor; store, case, plan, run = objects(actor, key)
    assert plan_scope_issue(store, plan)['reason'] == 'amount_percentage_unsupported'
    before = frozen(store, case); done = actor.execute(run)
    assert done['state'] == 'interrupted' and done['result'] is None
    assert '分母' in done['error'] and frozen(store, case) == before
    assert approved_run_valid(store, done) and ws.verify_ledger(store, run['id'])['valid']
    events = store.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq', (run['id'],))
    assert [event['type'] for event in events] == ['queued', 'running', 'scope_repreview_required']
    assert events[-1]['payload']['reason'] == 'amount_percentage_unsupported'


@pytest.mark.parametrize('key', ['bare_legacy_0_completed', 'bare_adaptive_0_completed'])
def test_completed_old_bare_percentage_exports_and_repeated_approval_remain_frozen(captured_actor, key):
    actor = captured_actor; store, case, plan, run = objects(actor, key)
    assert plan_scope_issue(store, plan)['reason'] == 'amount_percentage_unsupported'
    before = frozen(store, case); changes = store.db.total_changes
    assert ok(actor.get('/runs/'+run['id']))['result'] == run['result']
    for kind, expected in case['export_sha256'].items():
        response = actor.get('/runs/'+run['id']+'/export?format='+kind)
        assert response.status_code == 200 and hashlib.sha256(response.content).hexdigest() == expected
    assert ok(approve(actor, case, plan), 202)['id'] == run['id']
    assert actor.execute(run)['result'] == run['result']
    assert frozen(store, case) == before and store.db.total_changes == changes


@pytest.mark.parametrize('key', ['bare_amount_draft', 'bare_revenue_draft', 'bare_ratio_draft',
    'bare_mixed_draft', 'bare_source_good_draft'])
def test_old_supported_amount_ratio_growth_and_edited_targets_execute(captured_actor, key):
    actor = captured_actor; store, case, plan, _ = objects(actor, key)
    assert plan_scope_issue(store, plan) is None
    if key == 'bare_source_good_draft':
        prop = store.one('SELECT * FROM workspace_objects WHERE id=?', (case['proposal_id'],))
        source = store.one('SELECT * FROM copilot_messages WHERE id=?', (prop['payload']['source_message_id'],))
        assert unsupported_amount_percentage(source['payload']['question'])
    snapshot = plan['payload']['snapshot']; fingerprint = plan['payload']['fingerprint']
    approved = ok(approve(actor, case, plan), 200 if case['proposal_id'] else 202)
    run = ok(actor.get('/runs/'+approved['payload']['result']['run_id'])) if case['proposal_id'] else approved
    done = actor.execute(run)
    assert done['state'] in ('succeeded', 'degraded') and done['result']
    comparison = snapshot['comparison']
    assert done['result']['analysis']['baseline_period'] == ('2024-Q1' if comparison == 'previous' else None)
    assert done['result']['analysis']['metrics']['gross_margin'] == pytest.approx(1/3)
    if comparison == 'previous':
        assert done['result']['analysis']['metrics']['revenue_growth'] == .5
    current = store.one('SELECT * FROM workspace_objects WHERE id=?', (case['plan_id'],))
    assert current['payload']['snapshot'] == snapshot and current['payload']['fingerprint'] == fingerprint
