"""2026-10-09: new claim-based writes bind the review actually viewed.

Isolated synthetic stores and the named in-process StudioProvider test double;
never external provider traffic, migrations, or edits to saved report bytes.
"""
from copy import deepcopy

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from conftest import Actor
from server import workspace_store as ws
from server.business_provenance import SourceRef, resolve_source
from server.store import digest, encode
from test_business_provenance import action, action_ref, ok
from test_report_source_integrity import watch_request
from test_workspace_api import StudioProvider, execute, plan


def case(factory, reviewed=True):
    actor = Actor(factory(providers=StudioProvider())); dataset = actor.dataset()
    report = execute(actor, plan(actor, dataset, use_llm=True), True)
    claim = report['result']['llm']['review']['claims'][0]['id']
    review = ok(actor.post('/workspace/runs/' + report['id'] + '/reviews', json={
        'claim_id': claim, 'verdict': 'accepted', 'note': 'Viewed original review of isolated synthetic evidence'})) if reviewed else None
    ref = {'kind': 'report', 'run_id': report['id'], 'claim_id': claim,
           'claim_review_version': review['version'] if review else 0,
           'claim_review_hash': digest(review['payload']) if review else None}
    return actor, dataset, report, review, ref


def write(actor, dataset, ref, target, request_id=None):
    if target == 'action':
        return action(actor, dataset, source_ref=ref, **({'request_id': request_id} if request_id else {}))
    body = {'title': 'Track viewed claim review', 'dataset_id': dataset['id'],
            'metric': 'gross_margin', 'operator': 'lt', 'threshold': 0.9, 'source_ref': ref}
    if request_id: body['request_id'] = request_id
    return actor.post('/services/watches', json=body)


def frozen(store):
    # Raw rows retain every saved JSON byte, including malformed test records.
    return {table: [tuple(r) for r in store.db.execute('SELECT * FROM ' + table + ' ORDER BY rowid')]
            for table in ('runs', 'run_events', 'event_integrity', 'agent_artifacts', 'workspace_objects', 'audit')}


@pytest.mark.parametrize('target', ['action', 'watch'])
@pytest.mark.parametrize('historical', [False, True])
@pytest.mark.parametrize('change', ['note_revision', 'needs_evidence', 'same_version_note', 'same_version_verdict'])
def test_stale_viewed_claim_review_is_conflict_before_business_write(factory, target, historical, change):
    actor, dataset, report, review, ref = case(factory)
    store = actor.client.app.state.store
    changed = {**review['payload'], 'note': 'Unseen revised rationale',
               'verdict': 'needs_evidence' if change in {'needs_evidence', 'same_version_verdict'} else 'accepted'}
    if change.startswith('same_version'):
        with store.transaction() as db:
            db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(changed), review['id']))
    else:
        ok(actor.post('/workspace/runs/' + report['id'] + '/reviews', json={
            **{k: changed[k] for k in ('claim_id', 'verdict', 'note')}, 'version': review['version']}))
    before = frozen(store); count = store.db.total_changes
    response = write(actor, dataset, {**ref, 'allow_historical': historical}, target)
    assert response.status_code == 409, response.text
    assert response.json()['error']['code'] == 'SOURCE_CHANGED'
    assert frozen(store) == before and store.db.total_changes == count
    assert store.owned('runs', actor.user['id'], report['id']) == report
    # A genuine new view can be explicitly chosen, without changing history.
    fresh = ok(actor.get('/workspace/runs/' + report['id'] + '/reviews?include_source_refs=true'))['claim_source_refs'][ref['claim_id']]
    result = ok(write(actor, dataset, fresh, target), 201)
    assert result['payload']['provenance']['claim_review_hash'] == fresh['claim_review_hash']
    assert result['source_impact']['state'] == 'current'


@pytest.mark.parametrize('target', ['action', 'watch'])
@pytest.mark.parametrize('reviewed', [False, True])
@pytest.mark.parametrize('missing', ['both', 'version', 'hash', 'null_version'])
def test_missing_viewed_claim_binding_requires_reselection_without_writes(factory, target, reviewed, missing):
    actor, dataset, _, _, ref = case(factory, reviewed)
    if missing in {'both', 'version'}: ref.pop('claim_review_version')
    if missing in {'both', 'hash'}: ref.pop('claim_review_hash')
    if missing == 'null_version': ref['claim_review_version'] = None
    store = actor.client.app.state.store; before = frozen(store); count = store.db.total_changes
    response = write(actor, dataset, {**ref, 'allow_historical': True}, target)
    assert response.status_code == 409, response.text
    assert response.json()['error']['code'] == 'CLAIM_REVIEW_REFERENCE_REQUIRED'
    assert frozen(store) == before and store.db.total_changes == count


@pytest.mark.parametrize('target', ['action', 'watch'])
@pytest.mark.parametrize('direction', ['appeared', 'disappeared'])
def test_explicit_no_review_baseline_detects_appearance_and_removal(factory, target, direction):
    actor, dataset, report, review, ref = case(factory, direction == 'disappeared')
    store = actor.client.app.state.store
    if direction == 'appeared':
        ok(actor.post('/workspace/runs/' + report['id'] + '/reviews', json={
            'claim_id': ref['claim_id'], 'verdict': 'accepted', 'note': 'New review after original selection'}))
    else:
        with store.transaction() as db: db.execute('DELETE FROM workspace_objects WHERE id=?', (review['id'],))
    before = frozen(store)
    assert write(actor, dataset, {**ref, 'allow_historical': True}, target).status_code == 409
    assert frozen(store) == before


@pytest.mark.parametrize('reviewed', [False, True])
def test_opt_in_catalog_exposes_exact_claim_refs_without_changing_default_review_or_report(factory, reviewed):
    actor, dataset, report, review, ref = case(factory, reviewed)
    store = actor.client.app.state.store; before = frozen(store)
    default = ok(actor.get('/workspace/runs/' + report['id'] + '/reviews'))
    assert default == {'items': [review] if review else []}
    response = ok(actor.get('/workspace/runs/' + report['id'] + '/reviews?include_source_refs=true'))
    assert response['items'] == default['items']
    assert response['claim_source_refs'][ref['claim_id']] == ref
    for claim in report['result']['llm']['review']['claims'][1:]:
        assert response['claim_source_refs'][claim['id']]['claim_review_version'] == 0
        assert response['claim_source_refs'][claim['id']]['claim_review_hash'] is None
    assert frozen(store) == before
    for target in ('action', 'watch'):
        saved = ok(write(actor, dataset, ref, target), 201)
        assert saved['source_impact']['state'] == 'current'
        assert saved['payload']['provenance']['claim_review_version'] == ref['claim_review_version']
        assert saved['payload']['provenance']['claim_review_hash'] == ref['claim_review_hash']
    assert store.owned('runs', actor.user['id'], report['id']) == report


def test_unavailable_selected_review_never_becomes_zero_revision_in_catalog(factory):
    actor, _, report, review, ref = case(factory)
    store = actor.client.app.state.store
    with store.transaction() as db: db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', ('{bad-json', review['id']))
    before = frozen(store)
    response = ok(actor.get('/workspace/runs/' + report['id'] + '/reviews?include_source_refs=true'))
    assert ref['claim_id'] not in response['claim_source_refs']
    assert response['unavailable'] and frozen(store) == before


def test_claim_bindings_do_not_override_owner_or_claim_existence(factory):
    actor, dataset, report, _, ref = case(factory)
    foreign = Actor(actor.client)
    assert foreign.get('/workspace/runs/' + report['id'] + '/reviews?include_source_refs=true').status_code == 404
    for target in ('action', 'watch'):
        assert write(foreign, dataset, ref, target).status_code == 404
        assert write(actor, dataset, {**ref, 'claim_id': 'missing-claim'}, target).status_code == 404


def test_internal_resolver_also_requires_explicit_null_hash_and_preserves_plain_source_serialization(factory):
    actor, dataset, _, _, ref = case(factory, False); store = actor.client.app.state.store
    missing = {k: v for k, v in ref.items() if k != 'claim_review_hash'}
    with store.transaction():
        with pytest.raises(HTTPException) as error: resolve_source(store, actor.user['id'], '', dataset['id'], missing)
    assert error.value.status_code == 409 and error.value.detail['code'] == 'CLAIM_REVIEW_REFERENCE_REQUIRED'
    assert SourceRef.model_validate(ref).model_dump()['claim_review_hash'] is None
    for value in ({'kind': 'report', 'run_id': ref['run_id']}, {'kind': 'dataset', 'dataset_version': 1, 'dataset_hash': 'a' * 64}):
        dumped = SourceRef.model_validate(value).model_dump()
        assert 'claim_review_version' not in dumped and 'claim_review_hash' not in dumped
    for value in ({'kind': 'report', 'run_id': ref['run_id'], 'claim_review_version': 0, 'claim_review_hash': None},
                  {'kind': 'dataset', 'dataset_version': 1, 'dataset_hash': 'a' * 64, 'claim_review_hash': None}):
        with pytest.raises(ValidationError): SourceRef.model_validate(value)


@pytest.mark.parametrize('target', ['action', 'watch'])
def test_exact_created_claim_retry_returns_saved_object_after_review_changes_without_new_writes(factory, target):
    actor, dataset, report, review, ref = case(factory)
    token = 'review-bound-retry-20261009'
    first = ok(write(actor, dataset, ref, target, token), 201)
    ok(actor.post('/workspace/runs/' + report['id'] + '/reviews', json={
        'claim_id': ref['claim_id'], 'version': review['version'], 'verdict': 'needs_evidence', 'note': 'Changed after successful original creation'}))
    store = actor.client.app.state.store; before = frozen(store); count = store.db.total_changes
    replay = ok(write(actor, dataset, ref, target, token), 201)
    assert replay['id'] == first['id'] and replay['payload'] == first['payload']
    assert replay['source_impact']['state'] == 'changed'
    assert frozen(store) == before and store.db.total_changes == count
    assert write(actor, dataset, ref, target).status_code == 409


@pytest.mark.parametrize('target', ['action', 'watch'])
def test_genuine_r1_creation_receipt_without_new_claim_fields_still_recovers_exact_saved_outcome(actor, target):
    import json
    from pathlib import Path
    capture = json.loads((Path(__file__).parent / 'fixtures/legacy-claim-receipts-r1.json').read_text())
    original = capture['rows'][target]
    request = capture['requests'][target]
    assert 'claim_review_version' not in request['source_ref']
    assert 'claim_review_hash' not in request['source_ref']
    assert SourceRef.model_validate(request['source_ref']).model_dump() == request['source_ref']
    assert digest(original['payload']['creation_request']) == original['payload']['creation_request_hash']
    # Other contract fields may have new API-level compatibility projection.
    # The actual endpoint below must recover the original complete receipt.
    row = {**original, 'user_id': actor.user['id']}
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('INSERT INTO workspace_objects VALUES(?,?,?,?,?,?,?,?)',
                   tuple(encode(row[k]) if k == 'payload' else row[k] for k in
                         ('id', 'user_id', 'kind', 'natural_key', 'payload', 'version', 'created_at', 'updated_at')))
    before = frozen(store); count = store.db.total_changes
    endpoint = '/workspace/actions' if target == 'action' else '/services/watches'
    replay = ok(actor.post(endpoint, json=request), 201)
    assert replay['id'] == row['id'] and replay['payload'] == row['payload']
    assert frozen(store) == before and store.db.total_changes == count
    conflict = actor.post(endpoint, json={**request, 'title': request['title'] + ' changed'})
    assert conflict.status_code == 409 and conflict.json()['error']['code'] == 'IDEMPOTENCY_CONFLICT'
    assert frozen(store) == before and store.db.total_changes == count
