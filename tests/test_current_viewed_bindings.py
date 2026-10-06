"""2026-10-05 real ASGI current-input bindings; synthetic, socket/provider guarded."""
from copy import deepcopy

import pytest

from conftest import Actor, editable
from in_process_oracle import offline_test_client
from server.app import make_app
from server.config import Settings
from server.store import digest, encode
from test_action_evidence_binding import capture, selection
from test_action_lifecycle import create
from test_copilot_message_trace import continuation, trace
from test_services import message, ok


@pytest.fixture
def actor(tmp_path):
    with offline_test_client(lambda providers: make_app(
            Settings(data_dir=tmp_path, origin='http://testserver'),
            providers=providers, worker_enabled=False)) as (client, providers, attempts):
        yield Actor(client)
        assert providers.calls == [] and attempts == []


def current_answer(actor, endpoint, dataset, thread, saved):
    if endpoint == 'trace':
        return trace(actor, thread, saved)
    question = saved['payload']['response']['context']['question_scope']['period'] + '经营现金流环比'
    if endpoint == 'workspace':
        return actor.post('/workspace/assistant', json={'query': question, 'dataset_id': dataset['id']})
    return message(actor, thread, text=question, version=3, key='current-input-check')


def business_state(store):
    # Login/session bookkeeping is excluded; business history and audit are not.
    return {name: store.all('SELECT * FROM ' + name + ' ORDER BY rowid') for name in
            ('datasets', 'dataset_revisions', 'copilot_messages', 'workspace_objects', 'runs', 'audit')}


@pytest.mark.parametrize('endpoint', ['trace', 'workspace', 'copilot'])
@pytest.mark.parametrize('corruption', ['cash_flow', 'periods', 'payload', 'hash_matching_bad_shape'])
def test_current_fact_reads_validate_content_before_using_financial_fields(actor, endpoint, corruption):
    dataset, thread, saved = continuation(actor)
    original_thread = ok(actor.get('/services/threads/' + thread['id']))
    report = actor.execute(ok(actor.run(dataset), 202))
    assert report['state'] == 'succeeded'
    store = actor.client.app.state.store
    bad = deepcopy(dataset['payload'])
    if corruption == 'cash_flow':
        bad['periods'][0]['cash_flow'] += 5000
    elif corruption in ('periods', 'hash_matching_bad_shape'):
        bad['periods'] = None
    else:
        bad = None
    with store.transaction() as db:
        db.execute('UPDATE datasets SET payload=?,content_hash=? WHERE id=?',
                   (encode(bad), digest(bad) if corruption == 'hash_matching_bad_shape' else dataset['content_hash'], dataset['id']))
    before = business_state(store)
    result = current_answer(actor, endpoint, dataset, thread, saved)
    assert result.status_code == 409, result.text
    assert result.json()['error']['code'] == 'SOURCE_INTEGRITY'
    assert business_state(store) == before
    assert ok(actor.get('/services/threads/' + thread['id'])) == original_thread
    reread = ok(actor.get('/runs/' + report['id']))
    assert reread['result'] == report['result'] and reread['snapshot'] == report['snapshot']
    # An identical replay serves the original stored answer, never recalculates it.
    replay = ok(message(actor, thread, text='继续看现金流', version=2, key='continue-cash'), 201)
    assert replay['replayed'] is True and replay['message'] == saved
    assert business_state(store) == before


@pytest.mark.parametrize('endpoint', ['trace', 'workspace', 'copilot'])
def test_integrity_failure_does_not_leak_foreign_owned_scope(actor, endpoint):
    dataset, thread, saved = continuation(actor)
    other = Actor(actor.client)
    with actor.client.app.state.store.transaction() as db:
        db.execute('UPDATE datasets SET payload=? WHERE id=?', (encode(None), dataset['id']))
    response = current_answer(other, endpoint, dataset, thread, saved)
    assert response.status_code == 404, response.text
    assert response.json()['error']['code'] == 'NOT_FOUND'


def test_trace_checks_saved_message_owner_before_current_input_integrity(actor):
    dataset, thread, _ = continuation(actor)
    _, _, foreign = continuation(Actor(actor.client))
    with actor.client.app.state.store.transaction() as db:
        db.execute('UPDATE datasets SET payload=? WHERE id=?', (encode(None), dataset['id']))
    response = trace(actor, thread, foreign)
    assert response.status_code == 404 and response.json()['error']['code'] == 'NOT_FOUND'


@pytest.mark.parametrize('endpoint', ['trace', 'workspace', 'copilot'])
def test_healthy_current_revision_returns_its_actual_hash_and_keeps_saved_answer(actor, endpoint):
    dataset, thread, saved = continuation(actor)
    change = editable(dataset)
    change['periods'][0]['cash_flow'] += 5000
    revised = ok(actor.put('/datasets/' + dataset['id'], json=change))
    response = current_answer(actor, endpoint, revised, thread, saved)
    result = ok(response, 201 if endpoint == 'copilot' else 200)
    if endpoint == 'copilot':
        result = result['message']['payload']['response']
    fact = next(f for f in result['facts'] if f['id'] == 'cash_flow')
    assert fact['value'] == revised['payload']['periods'][0]['cash_flow']
    assert fact['input_hash'] == revised['content_hash'] == digest(revised['payload'])
    assert fact['dataset_version'] == 2
    stored = next(m for m in ok(actor.get('/services/threads/' + thread['id']))['messages'] if m['id'] == saved['id'])
    assert stored == {key: saved[key] for key in ('id', 'payload', 'created_at')}
    assert actor.client.app.state.store.one('SELECT * FROM copilot_messages WHERE id=?', (saved['id'],)) == saved


def viewed_action(actor):
    action = create(actor, company='测试企业')
    action = ok(actor.put('/workspace/actions/' + action['id'] + '/status', json={
        'version': action['version'], 'status': 'in_progress', 'note': '开始核对原始凭据'}))
    doc = capture(actor)
    selected = selection(actor, doc)
    ok(actor.put('/workspace/evidence/' + doc['id'] + '/review', json={
        **selected['review'], 'version': selected['review_version'], 'status': 'accepted',
        'stance': 'supports', 'company': '测试企业', 'note': '实际查看的原审阅说明'}))
    viewed = selection(actor, doc)
    ref = {k: viewed[k] for k in ('id', 'version', 'content_hash', 'review_version', 'review_hash')}
    assert ref['review_hash'] == digest(viewed['review'])
    return action, doc, viewed, ref


def complete_action(actor, action, refs, **patch):
    return actor.put('/workspace/actions/' + action['id'] + '/status', json={
        'version': action['version'], 'status': 'done', 'note': '根据已查看的原文和审阅完成人工核查',
        'evidence_refs': refs, **patch})


@pytest.mark.parametrize('field,value', [('note', '同一版本替换后尚未查看的说明'), ('stance', 'context')])
def test_same_version_review_change_requires_fresh_viewed_hash_without_writes(actor, field, value):
    action, doc, viewed, ref = viewed_action(actor)
    store = actor.client.app.state.store
    review = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='evidence_review' AND natural_key=?",
                       (actor.user['id'], doc['id']))
    changed = {**review['payload'], field: value}
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(changed), review['id']))
    before = business_state(store)
    response = complete_action(actor, action, [ref])
    assert response.status_code == 409 and response.json()['error']['code'] == 'ACTION_EVIDENCE_CHANGED'
    assert '重新' in response.json()['error']['message']
    assert business_state(store) == before
    fresh = selection(actor, doc)
    assert fresh['review_version'] == viewed['review_version'] and fresh['review_hash'] != ref['review_hash']
    refreshed_ref = {key: fresh[key] for key in ref}
    saved = ok(complete_action(actor, action, [refreshed_ref]))
    frozen = saved['payload']['history'][-1]['evidence_snapshots'][0]
    assert {key: frozen[key] for key in ref} == refreshed_ref
    assert frozen['review'] == changed and frozen['review_hash'] == digest(changed)
    assert saved['payload']['history'][:-1] == action['payload']['history']


@pytest.mark.parametrize('kind', ['missing', 'null', 'wrong', 'invalid'])
def test_unverifiable_review_reference_cannot_be_repaired_from_current_catalog(actor, kind):
    action, _, _, ref = viewed_action(actor)
    if kind == 'missing':
        ref.pop('review_hash')
    else:
        ref['review_hash'] = {'null': None, 'wrong': '0' * 64, 'invalid': 'old-unverifiable'}[kind]
    store = actor.client.app.state.store
    before = business_state(store)
    response = complete_action(actor, action, [ref])
    assert response.status_code == (422 if kind == 'invalid' else 409), response.text
    if kind in ('missing', 'null'):
        assert response.json()['error']['code'] == 'ACTION_EVIDENCE_REVIEW_REQUIRED'
        assert '刷新' in response.json()['error']['message'] and '重新' in response.json()['error']['message']
    assert business_state(store) == before


@pytest.mark.parametrize('boundary', ['owner', 'evidence_owner', 'action_version', 'csrf', 'scope', 'excluded', 'expired', 'original_text'])
def test_review_hash_does_not_bypass_existing_action_guards(actor, boundary):
    action, doc, viewed, ref = viewed_action(actor)
    store = actor.client.app.state.store
    who = actor
    if boundary == 'owner':
        who = Actor(actor.client)
    elif boundary == 'evidence_owner':
        other = Actor(actor.client)
        ref = other.evidence_ref(capture(other))
    elif boundary == 'action_version':
        action = {**action, 'version': action['version'] - 1}
    elif boundary == 'csrf':
        actor.csrf = 'unapproved-token'
    elif boundary == 'original_text':
        with store.transaction() as db:
            db.execute('UPDATE evidence SET payload=? WHERE id=?', (encode({**doc['payload'], 'text': 'changed original text'}), doc['id']))
    else:
        changes = {'scope': {'company': '其他企业'}, 'excluded': {'status': 'rejected'}, 'expired': {'expires_at': '2020-01-01'}}[boundary]
        ok(actor.put('/workspace/evidence/' + doc['id'] + '/review', json={
            **viewed['review'], **changes, 'version': viewed['review_version']}))
        ref = actor.evidence_ref(doc)
    before = business_state(store)
    response = complete_action(who, action, [ref])
    expected = 404 if boundary in ('owner', 'evidence_owner') else 403 if boundary == 'csrf' else 409
    assert response.status_code == expected, response.text
    assert business_state(store) == before


def test_second_stale_selection_rolls_back_entire_transition_and_keeps_old_history_readable(actor):
    action, _, _, ref = viewed_action(actor)
    second = capture(actor, '第二份')
    another = actor.evidence_ref(second)
    another['review_hash'] = '0' * 64
    store = actor.client.app.state.store
    before = business_state(store)
    response = complete_action(actor, action, [ref, another])
    assert response.status_code == 409 and business_state(store) == before
    saved = ok(complete_action(actor, action, [ref]))
    # Explicit legacy compatibility fixture: absence of old frozen hash remains
    # absent on reads and is never repaired with today's review.
    historical = deepcopy(saved['payload'])
    historical['history'][-1]['evidence_snapshots'][0].pop('review_hash')
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(historical), saved['id']))
    before = business_state(store)
    reread = next(a for a in ok(actor.get('/workspace/actions'))['items'] if a['id'] == saved['id'])
    assert reread['payload'] == historical and reread['version'] == saved['version']
    assert business_state(store) == before
