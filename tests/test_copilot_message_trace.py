"""Saved question scope → current-input read-only trace, without provider calls."""
from copy import deepcopy
from urllib.parse import urlencode

import pytest

from conftest import Actor, editable
from server.store import encode
from test_services import identity, message, ok, thread


def trace(actor, t, m, **scope):
    params = {'identity_id': t['payload']['identity_id'], 'dataset_id': t['payload']['dataset_id'], **scope}
    return actor.get(f"/services/threads/{t['id']}/messages/{m['id']}/trace?" + urlencode(params))


def continuation(actor, profile=False):
    d = actor.dataset()
    i = identity(actor, d) if profile else None
    t = thread(actor, d, i)
    target = d['payload']['periods'][0]['period']
    ok(message(actor, t, text=target + '毛利率环比核查'), 201)
    m = ok(message(actor, t, text='继续看现金流', version=2, key='continue-cash'), 201)['message']
    return d, t, m


def test_current_trace_preserves_continuation_period_baseline_and_topics(actor):
    d, t, m = continuation(actor)
    frozen = deepcopy(ok(actor.get('/services/threads/' + t['id'])))
    saved_scope = m['payload']['response']['context']['question_scope']
    for _ in range(2):
        result = ok(trace(actor, t, m))
        assert {k: result['question_scope'][k] for k in ('period', 'comparison', 'topics')} == {
            k: saved_scope[k] for k in ('period', 'comparison', 'topics')}
        assert [(f['id'], f['period'], f['value']) for f in result['facts']] == [
            (f['id'], f['period'], f['value']) for f in m['payload']['response']['facts']]
        assert result['source_message_id'] == m['id'] and result['external_calls'] == 0
        assert result['scope']['dataset_version'] == d['version']
    assert ok(actor.get('/services/threads/' + t['id'])) == frozen
    assert actor.client.app.state.store.all('SELECT * FROM runs') == []
    assert ok(actor.get('/workspace/plans'))['items'] == []


def test_trace_uses_current_revision_without_rewriting_the_historical_message(actor):
    d, t, m = continuation(actor)
    change = editable(d)
    change['periods'][0]['cash_flow'] += 500
    updated = ok(actor.put('/datasets/' + d['id'], json=change))
    result = ok(trace(actor, t, m))
    assert result['scope']['dataset_version'] == updated['version']
    assert result['facts'][0]['value'] == m['payload']['response']['facts'][0]['value'] + 500
    assert result['facts'][0]['period'] == m['payload']['response']['facts'][0]['period']
    stored = ok(actor.get('/services/threads/' + t['id']))['messages'][-1]
    assert stored['payload'] == m['payload']


@pytest.mark.parametrize('change', ['dataset', 'identity', 'foreign_owner', 'other_thread', 'revoked_scope', 'deleted_identity', 'deleted_dataset', 'removed_period'])
def test_trace_rejects_unavailable_or_mismatched_current_scope(actor, change):
    d, t, m = continuation(actor, profile=True)
    who = actor
    params = {}
    if change == 'dataset':
        params['dataset_id'] = actor.dataset()['id']
    elif change == 'identity':
        params['identity_id'] = ''
    elif change == 'foreign_owner':
        who = Actor(actor.client)
    elif change == 'other_thread':
        t = thread(actor, d, {'id': t['payload']['identity_id']})
    elif change in ('revoked_scope', 'deleted_identity'):
        i = next(r for r in ok(actor.get('/services/identities'))['items'] if r['id'] == t['payload']['identity_id'])
        if change == 'deleted_identity':
            ok(actor.delete('/services/identities/' + i['id'] + '?version=1'))
        else:
            other = actor.dataset()
            ok(actor.put('/services/identities/' + i['id'], json={**i['payload'], 'version': 1, 'dataset_ids': [other['id']]}))
    elif change == 'deleted_dataset':
        ok(actor.delete('/datasets/' + d['id'] + '?version=1'))
    else:
        body = editable(d)
        body['periods'] = body['periods'][1:]
        ok(actor.put('/datasets/' + d['id'], json=body))
    result = trace(who, t, m, **params)
    assert result.status_code in (403, 404, 409), result.text
    assert actor.client.app.state.store.all('SELECT * FROM runs') == []


@pytest.mark.parametrize('patch', [None, {}, {'period': '2026-Q8'}, {'comparison': 'unrecognized'}, {'topics': ['not-a-metric']}, {'topics': ['cash_flow', 'cash_flow']}, {'topics': []}, {'can_calculate': False}, {'topics': 'cash_flow'}])
def test_trace_does_not_guess_missing_or_malformed_saved_scope(actor, patch):
    _, t, m = continuation(actor)
    payload = deepcopy(m['payload'])
    if patch is None:
        payload['response']['context'].pop('question_scope')
    elif patch == {}:
        payload['response']['context']['question_scope'] = {}
    else:
        payload['response']['context']['question_scope'].update(patch)
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE copilot_messages SET payload=? WHERE id=?', (encode(payload), m['id']))
    result = trace(actor, t, m)
    assert result.status_code == 409, result.text
    assert result.json()['error']['code'] == 'TRACE_SCOPE_UNAVAILABLE'


def test_trace_rejects_unresolved_question_and_ignores_client_scope_injection(actor):
    d, t, m = continuation(actor)
    result = ok(trace(actor, t, m, period=d['payload']['periods'][-1]['period'], comparison='year_over_year', topics='revenue'))
    assert result['question_scope']['period'] == m['payload']['response']['context']['question_scope']['period']
    assert result['question_scope']['comparison'] == 'previous'
    unresolved = ok(message(actor, t, text='2025年度毛利率', version=3, key='unresolved-query'), 201)['message']
    assert trace(actor, t, unresolved).status_code == 409


def test_trace_requires_explicit_current_context_parameters(actor):
    _, t, m = continuation(actor)
    assert actor.get(f"/services/threads/{t['id']}/messages/{m['id']}/trace").status_code == 422
