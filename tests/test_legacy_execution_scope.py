"""Authentic a20a9c4 API objects reopened under current admission rules.

The fixture contains untouched serialized synthetic business rows and original
fingerprints, captured by scripts/capture_legacy_scope_fixture.py. Only outer
owner columns are mapped to this isolated test account; no payload is rehashed.
"""
import copy
import hashlib
import json
from datetime import datetime
from pathlib import Path

import pytest

from conftest import Actor
from server import workspace_store as ws
from server.execution_scope import plan_scope_issue
from server.providers import Provider, ProviderService
from server.question_scope import resolve_question
from server.store import encode
from server.studio import approved_run_valid, plan_fingerprint_valid
from test_services import ok

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/legacy-execution-scope-a20a9c4.json').read_text())


class ForbiddenProviders(ProviderService):
    def __init__(self):
        super().__init__()
        self.providers = {'fixture': Provider('fixture', 'synthetic.invalid', '/never', 'fixture', 'NOT-A-REAL-KEY')}
        self.calls = []

    async def complete(self, *args, **kwargs):
        self.calls.append('complete')
        raise AssertionError('No provider completion may occur')

    async def propose(self, *args, **kwargs):
        self.calls.append('propose')
        raise AssertionError('No provider planning may occur')


@pytest.fixture
def old_actor(factory, monkeypatch):
    providers = ForbiddenProviders()
    actor = Actor(factory(providers=providers, max_queued_per_user=100))
    store = actor.client.app.state.store
    captured = datetime.fromisoformat(FIXTURE['source']['captured_at'])
    class CapturedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return captured.astimezone(tz) if tz else captured.replace(tzinfo=None)
    for module in ('studio', 'copilot', 'adaptive_runtime', 'clock'):
        monkeypatch.setattr('server.' + module + '.datetime', CapturedDatetime)
    with store.transaction() as db:
        for table, rows in FIXTURE['tables'].items():
            for raw in rows:
                row = dict(raw)
                if 'user_id' in row:
                    row['user_id'] = actor.user['id']
                if table == 'dataset_revisions':
                    actual = dict(db.execute('SELECT * FROM dataset_revisions WHERE dataset_id=? AND version=?', (row['dataset_id'], row['version'])).fetchone())
                    assert actual == row
                    continue
                columns = list(row)
                db.execute('INSERT INTO ' + table + '(' + ','.join(columns) + ') VALUES(' + ','.join('?' for _ in columns) + ')', [row[k] for k in columns])
    yield actor
    assert providers.calls == []


def objects(actor, key):
    case = FIXTURE['cases'][key]; store = actor.client.app.state.store
    plan = store.one('SELECT * FROM workspace_objects WHERE id=?', (case['plan_id'],))
    assert plan_fingerprint_valid(plan['payload'])
    assert 'scope_query' not in plan['payload']
    run = store.owned('runs', actor.user['id'], case['run_id']) if case['run_id'] else None
    if run:
        assert approved_run_valid(store, run)
    return store, case, plan, run


def frozen(store, case):
    values = {'plan': dict(store.db.execute('SELECT * FROM workspace_objects WHERE id=?', (case['plan_id'],)).fetchone())}
    if case['proposal_id']:
        values['proposal'] = dict(store.db.execute('SELECT * FROM workspace_objects WHERE id=?', (case['proposal_id'],)).fetchone())
    if case['run_id']:
        row = dict(store.db.execute('SELECT * FROM runs WHERE id=?', (case['run_id'],)).fetchone())
        values['run'] = {k: row[k] for k in ('payload', 'snapshot', 'result', 'request_hash', 'idempotency_key')}
        for table in ('adaptive_checkpoints', 'adaptive_calls', 'agent_artifacts', 'messages'):
            values[table] = [dict(r) for r in store.db.execute('SELECT * FROM ' + table + ' WHERE run_id=?', (case['run_id'],))]
    return values


def approve(actor, case, plan):
    if case['proposal_id']:
        p = actor.client.app.state.store.one('SELECT * FROM workspace_objects WHERE id=?', (case['proposal_id'],))
        return actor.post('/services/proposals/' + p['id'] + '/confirm', json={'version': p['version'], 'fingerprint': p['payload']['fingerprint']})
    return actor.post('/workspace/plans/' + plan['id'] + '/execute', json={'version': plan['version'], 'fingerprint': plan['payload']['fingerprint']})


@pytest.mark.parametrize('key', ['usd_draft', 'eur_draft', 'overview_draft', 'overview_evidence_draft',
    'qoq_draft', 'qoq_space_draft', 'qoq_hyphen_draft', 'yoy_draft', 'yoy_hyphen_draft',
    'both_comparisons_draft', 'source_usd_draft', 'source_qoq_draft', 'source_edited_usd_draft'])
def test_old_drafts_reject_new_approval_without_any_business_write(old_actor, key):
    actor = old_actor; store, case, plan, _ = objects(actor, key)
    before = frozen(store, case); changes = store.db.total_changes
    response = ok(approve(actor, case, plan), 409)
    assert response['error']['code'] == 'PLAN_SCOPE_REPREVIEW'
    assert '重新预览' in response['error']['message']
    assert store.db.total_changes == changes and frozen(store, case) == before


@pytest.mark.parametrize('key', ['usd_legacy_queued', 'usd_adaptive_queued', 'qoq_legacy_queued',
    'qoq_adaptive_queued', 'source_usd_queued', 'source_qoq_queued'])
def test_old_approved_queue_stops_before_calculation_without_changing_frozen_bytes(old_actor, key):
    actor = old_actor; store, case, plan, run = objects(actor, key)
    before = frozen(store, case); done = actor.execute(run)
    assert done['state'] == 'interrupted' and done['result'] is None
    assert '重新预览' in done['error'] and frozen(store, case) == before
    events = store.all('SELECT * FROM run_events WHERE run_id=?', (run['id'],))
    assert [e['type'] for e in events] == ['queued', 'running', 'scope_repreview_required']
    assert events[-1]['payload']['code'] == 'PLAN_SCOPE_REPREVIEW'
    assert plan_fingerprint_valid(plan['payload']) and approved_run_valid(store, done)
    assert ws.verify_ledger(store, run['id'])['valid']


@pytest.mark.parametrize('key', ['usd_paused', 'qoq_paused', 'qoq_unknown_paused'])
def test_old_resume_is_refused_before_requeue_and_preserves_real_checkpoints_and_unknown_calls(old_actor, key):
    actor = old_actor; store, case, _, run = objects(actor, key)
    before = frozen(store, case); changes = store.db.total_changes
    assert before['adaptive_checkpoints']
    if key == 'qoq_unknown_paused':
        assert before['adaptive_calls'] and any(c['state'] == 'unknown' for c in before['adaptive_calls'])
    control = store.one('SELECT * FROM adaptive_controls WHERE run_id=?', (run['id'],))
    response = actor.post('/workspace/runs/' + run['id'] + '/control', json={'action': 'resume', 'version': control['version']})
    assert ok(response, 409)['error']['code'] == 'PLAN_SCOPE_REPREVIEW'
    assert store.db.total_changes == changes and frozen(store, case) == before
    assert store.one('SELECT * FROM adaptive_controls WHERE run_id=?', (run['id'],)) == control
    assert ok(actor.get('/runs/' + run['id']))['state'] == 'interrupted'


@pytest.mark.parametrize('key,baseline', [('cny_draft', '2023-Q4'), ('cn_yoy_draft', '2023-Q4'), ('yoy_space_draft', '2023-Q4'),
    ('default_draft', '2023-Q4'), ('cn_qoq_draft', '2024-Q3'), ('form_qoq_draft', '2024-Q3'),
    ('evidence_draft', '2024-Q1'), ('source_history_draft', '2024-Q3'),
    ('source_edited_cny_draft', '2024-Q3'), ('source_followup_draft', '2024-Q3')])
def test_genuine_old_compatible_targets_and_form_choices_still_execute(old_actor, key, baseline):
    actor = old_actor; store, case, plan, _ = objects(actor, key)
    assert plan_scope_issue(store, plan) is None
    snapshot = copy.deepcopy(plan['payload']['snapshot']); fingerprint = plan['payload']['fingerprint']
    response = ok(approve(actor, case, plan), 200 if case['proposal_id'] else 202)
    run = ok(actor.get('/runs/' + response['payload']['result']['run_id'])) if case['proposal_id'] else response
    done = actor.execute(run)
    assert done['state'] in ('succeeded', 'degraded') and done['result']
    assert done['result']['analysis']['baseline_period'] == baseline
    if baseline == '2024-Q3':
        assert done['result']['analysis']['metrics']['revenue_growth'] == .5
    current = store.one('SELECT * FROM workspace_objects WHERE id=?', (plan['id'],))
    assert current['payload']['snapshot'] == snapshot and current['payload']['fingerprint'] == fingerprint
    assert approved_run_valid(store, done)


@pytest.mark.parametrize('key', ['cny_legacy_queued', 'cny_adaptive_queued', 'source_history_queued', 'cny_paused'])
def test_old_compatible_queue_and_resume_keep_normal_execution(old_actor, key):
    actor = old_actor; store, case, plan, run = objects(actor, key)
    assert plan_scope_issue(store, plan) is None
    if key.endswith('paused'):
        control = store.one('SELECT * FROM adaptive_controls WHERE run_id=?', (run['id'],))
        ok(actor.post('/workspace/runs/' + run['id'] + '/control', json={'action': 'resume', 'version': control['version']}))
    done = actor.execute(run)
    assert done['state'] in ('succeeded', 'degraded') and done['result']
    assert done['snapshot'] == run['snapshot']


@pytest.mark.parametrize('key', ['usd_legacy_completed', 'usd_adaptive_completed', 'qoq_legacy_completed',
    'qoq_adaptive_completed', 'source_usd_completed'])
def test_old_completed_reports_remain_readable_export_identically_and_repeat_confirmation_is_pure(old_actor, key):
    actor = old_actor; store, case, plan, run = objects(actor, key)
    assert plan_scope_issue(store, plan)
    before = frozen(store, case); changes = store.db.total_changes
    assert ok(actor.get('/runs/' + run['id']))['result'] == run['result']
    audit = ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    assert audit['report_integrity']['valid'] and audit['ledger']['valid']
    for kind, expected in case['export_sha256'].items():
        exported = actor.get('/runs/' + run['id'] + '/export?format=' + kind)
        assert exported.status_code == 200 and hashlib.sha256(exported.content).hexdigest() == expected
    response = ok(approve(actor, case, plan), 200 if case['proposal_id'] else 202)
    assert (response['payload']['result']['run_id'] if case['proposal_id'] else response['id']) == run['id']
    assert actor.execute(run)['result'] == run['result']
    assert frozen(store, case) == before and store.db.total_changes == changes


def test_old_source_target_is_not_replaced_by_conflicting_chat_or_unedited_source(old_actor):
    store, _, plan, _ = objects(old_actor, 'source_history_queued')
    assert resolve_question(plan['payload']['request']['query'], plan['payload']['snapshot']['dataset'], [])['unsupported_currency']
    assert plan_scope_issue(store, plan) is None
    store, _, edited, _ = objects(old_actor, 'source_edited_cny_draft')
    assert plan_scope_issue(store, edited) is None


@pytest.mark.parametrize('change', ['status', 'result_run', 'result_route', 'result_extra', 'version', 'text', 'owner', 'message', 'missing'])
def test_old_source_normalization_does_not_authorize_arbitrary_executed_proposals(old_actor, change):
    actor = old_actor; store, case, plan, run = objects(actor, 'source_history_queued')
    assert plan_scope_issue(store, plan) is None
    proposal = store.one('SELECT * FROM workspace_objects WHERE id=?', (case['proposal_id'],))
    payload = copy.deepcopy(proposal['payload'])
    other = Actor(actor.client) if change == 'owner' else None
    with store.transaction() as db:
        if change == 'owner':
            db.execute('UPDATE workspace_objects SET user_id=? WHERE id=?', (other.user['id'], proposal['id']))
        elif change == 'missing':
            db.execute('DELETE FROM workspace_objects WHERE id=?', (proposal['id'],))
        elif change == 'message':
            db.execute('UPDATE copilot_messages SET payload=? WHERE id=?', (encode({'question': 'altered'}), payload['source_message_id']))
        else:
            if change == 'status': payload['status'] = 'discarded'
            elif change == 'result_run': payload['result']['run_id'] = 'other-run'
            elif change == 'result_route': payload['result']['route'] = 'other-route'
            elif change == 'result_extra': payload['result']['extra'] = True
            elif change == 'version': payload['plan_version'] += 1
            else: payload['text'] = '2024-Q4 USD revenue'
            db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(payload), proposal['id']))
    assert plan_fingerprint_valid(plan['payload']) and approved_run_valid(store, run)
    assert plan_scope_issue(store, plan)['reason'] == 'original_target_unavailable'
    assert actor.execute(run)['state'] == 'interrupted'


@pytest.mark.parametrize('key', ['usd_legacy_external_queued', 'usd_adaptive_external_queued',
    'qoq_legacy_external_queued', 'qoq_adaptive_external_queued', 'qoq_unknown_queued'])
def test_authentic_old_external_approvals_and_requeued_unknown_results_never_dispatch(old_actor, key):
    actor = old_actor; store, case, _, run = objects(actor, key)
    before = frozen(store, case)
    events_before = store.all("SELECT * FROM run_events WHERE run_id=? AND type IN ('external_call_reserved','external_dispatch')", (run['id'],))
    done = actor.execute(run)
    assert done['state'] == 'interrupted' and done['result'] is None
    assert frozen(store, case) == before
    assert store.all("SELECT * FROM run_events WHERE run_id=? AND type IN ('external_call_reserved','external_dispatch')", (run['id'],)) == events_before


@pytest.mark.parametrize('engine', ['legacy', 'adaptive'])
@pytest.mark.parametrize('boundary', ['authorization', 'dispatch_guard', 'first_send'])
def test_each_unsent_boundary_rechecks_scope_even_if_start_check_was_missed(old_actor, monkeypatch, engine, boundary):
    # This fault injection skips earlier checks on the genuine old approval;
    # it does not alter its query, envelope, signature, plan or frozen snapshot.
    from server import execution_scope
    actor = old_actor; store, case, _, run = objects(actor, 'usd_' + engine + '_external_queued')
    original = execution_scope.stop_for_scope
    calls = []; checks = []; enabled = boundary == 'authorization'
    def delayed(worker, row):
        checks.append(True)
        return original(worker, row) if len(checks) > 1 and enabled else None
    monkeypatch.setattr(execution_scope, 'stop_for_scope', delayed)
    async def transport(selected, *args, **kwargs):
        nonlocal enabled
        calls.append('local_transport_double'); enabled = True
        if boundary == 'dispatch_guard':
            assert selected.dispatch_guard() is False
        else:
            with pytest.raises(ValueError, match='MODEL_AUTHORIZATION_CHANGED'):
                selected.dispatch_started()
        raise ValueError('MODEL_AUTHORIZATION_CHANGED')
    monkeypatch.setattr(actor.client.app.state.providers, 'complete', transport)
    done = actor.execute(run)
    assert done['state'] == 'interrupted' and done['result'] is None
    assert '重新预览' in done['error'] and done['snapshot'] == run['snapshot']
    assert calls == ([] if boundary == 'authorization' else ['local_transport_double'])
    events = store.all('SELECT * FROM run_events WHERE run_id=?', (run['id'],))
    assert any(e['type'] == 'scope_repreview_required' for e in events)
    assert not any(e['type'] == 'external_dispatch' for e in events)
    if boundary != 'authorization':
        assert any(e['type'] == 'external_call_reserved' for e in events)
        closure = next(e for e in events if e['type'] == ('external_call_closed' if engine == 'adaptive' else 'external_call_result'))
        payload = (store.one('SELECT * FROM adaptive_calls WHERE id=?', (closure['payload']['call_id'],))['payload']
                   if engine == 'adaptive' else closure['payload'])
        assert payload['dispatched'] is False and payload['remote_outcome_known'] is True
    assert ws.verify_ledger(store, run['id'])['valid'] and approved_run_valid(store, done)


def test_current_preview_binds_actual_scope_target_and_tampering_still_fails_integrity(actor):
    from test_services import thread, message, proposal, confirm
    dataset = actor.dataset(); t = thread(actor, dataset)
    prior = ok(message(actor, t, '2025-Q2 USD revenue 同比'), 201)
    current = ok(message(actor, prior['thread'], '2025-Q2收入环比', key='current-scope'), 201)
    p = ok(proposal(actor, current['thread'], text='', source_message_id=current['message']['id'], include_thread_history=True), 201)
    plan = ok(actor.get('/workspace/plans/' + p['payload']['plan_id']))
    assert plan['payload']['scope_query'] == p['payload']['text']
    assert 'USD' in plan['payload']['request']['query'] and 'USD' not in plan['payload']['scope_query']
    assert plan_scope_issue(actor.client.app.state.store, plan) is None
    changed = copy.deepcopy(plan['payload']); changed['scope_query'] = '2025-Q2 USD revenue'
    with actor.client.app.state.store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(changed), plan['id']))
    assert ok(confirm(actor, p), 409)['error']['code'] == 'PLAN_INTEGRITY'
