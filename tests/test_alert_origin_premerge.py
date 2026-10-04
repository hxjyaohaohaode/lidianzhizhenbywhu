"""Alert values remain frozen; inherited source integrity cannot be laundered."""
from copy import deepcopy
from datetime import date

import pytest

from conftest import Actor
from server import workspace_store as ws
from server.business_provenance import MAX_RULE_ORIGIN_DEPTH, source_impact, with_source_impact
from server.copilot import evaluate_watches
from server.store import digest, encode
from test_business_provenance import action, action_ref, ok, revise
from test_evolution import assessment
from test_report_source_integrity import corrupt, watch_request
from test_workspace_api import execute, plan


def alert_from_report(actor, via_action=False, memory=False):
    dataset = actor.dataset()
    saved_memory = None
    if memory:
        saved_memory = ok(actor.post('/memories', json={'text': '合成已批准经营核查目标',
            'company': dataset['payload']['company'], 'approved': True}), 201)
    report = execute(actor, plan(actor, dataset))
    source = {'kind': 'report', 'run_id': report['id']}
    if via_action:
        source = action_ref(ok(action(actor, dataset, source_ref=source), 201))
    watch = ok(watch_request(actor, dataset, source), 201)
    store = actor.client.app.state.store
    evaluated = evaluate_watches(store, actor.user['id'], today=date(2026, 10, 1))
    alert = ws.get(store, actor.user['id'], 'alert', evaluated['evaluations'][0]['alert_id'])
    return dataset, report, watch, alert, saved_memory


@pytest.mark.parametrize('via_action', [False, True])
@pytest.mark.parametrize('damage', ['artifact', 'result', 'ledger', 'snapshot', 'missing_final_artifact'])
def test_alert_does_not_launder_corrupt_report_into_new_writes(actor, via_action, damage):
    dataset, report, watch, alert, _ = alert_from_report(actor, via_action)
    store = actor.client.app.state.store
    source = {'kind': 'alert', 'alert_id': alert['id']}
    parent = ok(action(actor, dataset, source_ref=source), 201)
    derived_watch = ok(watch_request(actor, dataset, action_ref(parent)), 201)
    assert parent['payload']['provenance']['rule_origin'] == watch['payload']['provenance']
    assert parent['payload']['provenance']['dataset_hash'] == alert['payload']['dataset_hash']
    frozen = {r['id']: deepcopy(r['payload']) for r in (watch, alert, parent, derived_watch)}
    corrupt(store, report, damage)
    before = store.all('SELECT * FROM workspace_objects ORDER BY id')
    for selected in (source, action_ref(parent)):
        for historical in (False, True):
            ref = {**selected, 'allow_historical': historical}
            for response in (action(actor, dataset, source_ref=ref), watch_request(actor, dataset, ref)):
                assert response.status_code == 409, response.text
                assert response.json()['error']['code'] == 'REPORT_INTEGRITY'
    for row in (watch, alert, parent, derived_watch):
        saved = ws.get(store, actor.user['id'], row['kind'], row['id'])
        assert saved['payload'] == frozen[row['id']]
        impact = with_source_impact(store, actor.user['id'], saved)['source_impact']
        assert impact['state'] == 'unavailable'
        assert 'report_integrity_failed' in {r['code'] for r in impact['reasons']}
    assert store.all('SELECT * FROM workspace_objects ORDER BY id') == before


def test_old_derived_action_rechecks_hash_bound_alert_origin_without_rewriting_it(actor):
    dataset, report, _, alert, _ = alert_from_report(actor)
    store = actor.client.app.state.store
    parent = ok(action(actor, dataset, source_ref={'kind': 'alert', 'alert_id': alert['id']}), 201)
    old = deepcopy(parent['payload'])
    old['provenance'].pop('rule_origin')
    old['origin']['provenance'].pop('rule_origin')
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(old), parent['id']))
    parent = ws.get(store, actor.user['id'], 'action', parent['id'])
    new_watch = ok(watch_request(actor, dataset, action_ref(parent)), 201)
    assert new_watch['payload']['provenance']['rule_origin'] == alert['payload']['provenance']['rule_origin']
    corrupt(store, report, 'artifact')
    before = store.db.total_changes
    impact = with_source_impact(store, actor.user['id'], parent)['source_impact']
    assert impact['state'] == 'unavailable' and any(r['dependency'] == 'watch_origin' for r in impact['reasons'])
    for historical in (False, True):
        response = watch_request(actor, dataset, {**action_ref(parent), 'allow_historical': historical})
        assert response.status_code == 409 and response.json()['error']['code'] == 'REPORT_INTEGRITY'
    assert store.db.total_changes == before
    assert ws.get(store, actor.user['id'], 'action', parent['id'])['payload'] == old


@pytest.mark.parametrize('change', ['data_revision', 'memory_withdrawn'])
def test_changed_rule_origin_requires_ack_but_does_not_rewrite_numeric_alert(actor, change):
    dataset, report, watch, alert, memory = alert_from_report(actor, memory=True)
    store = actor.client.app.state.store
    if change == 'data_revision':
        dataset = revise(actor, dataset)
        evaluated = evaluate_watches(store, actor.user['id'], today=date(2026, 10, 1))
        alert = ws.get(store, actor.user['id'], 'alert', evaluated['evaluations'][0]['alert_id'])
    else:
        ok(actor.put('/memories/' + memory['id'], json={**memory['payload'], 'version': 1, 'approved': False}))
    frozen = deepcopy(alert['payload'])
    source = {'kind': 'alert', 'alert_id': alert['id']}
    assert action(actor, dataset, source_ref=source).status_code == 409
    accepted = ok(action(actor, dataset, source_ref={**source, 'allow_historical': True}), 201)
    p = accepted['payload']['provenance']
    assert p['dataset_version'] == alert['payload']['dataset_version']
    assert p['dataset_hash'] == alert['payload']['dataset_hash']
    assert p['rule_origin'] == watch['payload']['provenance']
    assert p['alert_snapshot']['value'] == alert['payload']['value']
    assert accepted['source_impact']['state'] == 'changed'
    assert accepted['source_impact']['baseline']['version'] == alert['payload']['dataset_version']
    assert any(r.get('dependency') == 'watch_origin' for r in accepted['source_impact']['reasons'])
    assert ws.get(store, actor.user['id'], 'alert', alert['id'])['payload'] == frozen
    assert ok(actor.get('/runs/' + report['id']))['result'] == report['result']


def test_strategy_replay_consent_is_not_blanket_revocation_of_numerical_business_use(actor):
    dataset, report, _, alert, _ = alert_from_report(actor)
    first = assessment(actor, report)
    assessment(actor, report, version=first['version'], consent_replay=False)
    created = ok(action(actor, dataset, source_ref={'kind': 'alert', 'alert_id': alert['id']}), 201)
    assert created['source_impact']['state'] == 'current'
    assert created['payload']['provenance']['alert_snapshot']['value'] == alert['payload']['value']


def test_nested_origin_keeps_owner_and_identity_authorization(actor):
    dataset, _, _, alert, _ = alert_from_report(actor, via_action=True)
    foreign = Actor(actor.client)
    foreign_dataset = foreign.dataset()
    source = {'kind': 'alert', 'alert_id': alert['id']}
    assert action(foreign, foreign_dataset, source_ref=source).status_code == 404
    identity = ok(actor.post('/services/identities', json={'name': '另一隔离身份', 'dataset_ids': [dataset['id']]}), 201)
    assert action(actor, dataset, identity_id=identity['id'], source_ref=source).status_code == 403


def test_real_alert_chain_stops_before_exceeding_bounded_inheritance(actor):
    dataset, _, watch, alert, _ = alert_from_report(actor)
    store = actor.client.app.state.store
    for _ in range(MAX_RULE_ORIGIN_DEPTH):
        watch = ok(watch_request(actor, dataset, {'kind': 'alert', 'alert_id': alert['id']}), 201)
        evaluation = next(e for e in evaluate_watches(store, actor.user['id'], today=date(2026, 10, 1))['evaluations'] if e['rule_id'] == watch['id'])
        alert = ws.get(store, actor.user['id'], 'alert', evaluation['alert_id'])
    before = store.all('SELECT * FROM workspace_objects ORDER BY id')
    response = watch_request(actor, dataset, {'kind': 'alert', 'alert_id': alert['id'], 'allow_historical': True})
    assert response.status_code == 409 and response.json()['error']['code'] == 'SOURCE_DEPTH_LIMIT'
    assert store.all('SELECT * FROM workspace_objects ORDER BY id') == before


@pytest.mark.parametrize('malformed', [[], 'invalid', {'schema_version': 0}, {'schema_version': 1}, {'schema_version': 1, 'kind': 'report'}])
def test_malformed_recorded_origin_cannot_be_historically_acknowledged(actor, malformed):
    dataset, _, _, alert, _ = alert_from_report(actor)
    store = actor.client.app.state.store
    p = deepcopy(alert['payload']);p['provenance']['rule_origin'] = malformed
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(p), alert['id']))
    before = store.db.total_changes
    response = action(actor, dataset, source_ref={'kind': 'alert', 'alert_id': alert['id'], 'allow_historical': True})
    assert response.status_code == 409 and response.json()['error']['code'] == 'SOURCE_INTEGRITY'
    assert store.db.total_changes == before


def test_legacy_missing_origin_is_unknown_and_requires_explicit_historical_choice(actor):
    dataset, _, _, alert, _ = alert_from_report(actor)
    store = actor.client.app.state.store
    old = deepcopy(alert['payload']);old['provenance'].pop('rule_origin')
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(old), alert['id']))
    source = {'kind': 'alert', 'alert_id': alert['id']}
    assert action(actor, dataset, source_ref=source).status_code == 409
    accepted = ok(action(actor, dataset, source_ref={**source, 'allow_historical': True}), 201)
    assert accepted['source_impact']['state'] == 'unknown'
    assert accepted['payload']['provenance']['rule_origin'] is None
    assert ws.get(store, actor.user['id'], 'alert', alert['id'])['payload'] == old


@pytest.mark.parametrize('bad_field', [{'evidence': None}, {'evidence': [{}]}, {'action_dependencies': [{}]},
    {'comparison_reference': {'payload': {}, 'projection_hash': '0'*64}},
    {'kind': 'report', 'run_id': ''}, {'kind': []}, {'dataset_version': True}, {'identity_binding': []}])
def test_incomplete_v1_origin_fields_fail_closed_without_read_500_or_new_write(actor, bad_field):
    dataset, _, _, alert, _ = alert_from_report(actor)
    store = actor.client.app.state.store
    changed = deepcopy(alert['payload'])
    changed['provenance']['rule_origin'].update(bad_field)
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(changed), alert['id']))
    saved = ws.get(store, actor.user['id'], 'alert', alert['id'])
    impact = with_source_impact(store, actor.user['id'], saved)['source_impact']
    assert impact['state'] == 'unavailable'
    before = store.db.total_changes
    for historical in (False, True):
        source = {'kind': 'alert', 'alert_id': alert['id'], 'allow_historical': historical}
        for response in (action(actor, dataset, source_ref=source), watch_request(actor, dataset, source)):
            assert response.status_code == 409 and response.json()['error']['code'] == 'SOURCE_INTEGRITY'
    assert store.db.total_changes == before
