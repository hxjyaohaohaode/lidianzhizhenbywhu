"""Transport/DOM adapters are doubles; real API oracles run guarded in-process.

No browser, local socket listener, DB mutation/fault, or supplier is launched.
These tests do not count as native execution of the prepared journey.
"""
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts import product_late_action_journey as journey
from scripts.product_browser_audit import Probe
from scripts.product_first_use_audit import HarnessContractError


def delay_probe():
    return SimpleNamespace(base_url='http://127.0.0.1:8000', observations={},
        page=SimpleNamespace(route=Mock(), unroute=Mock(), wait_for_timeout=Mock()))


def route(method='DELETE', path='/api/evidence/synthetic?version=1', *, status=200, body=None):
    body = {'ok': True, 'notice': 'original server response'} if body is None else body
    response = SimpleNamespace(status=status, body=Mock(return_value=json.dumps(body).encode()), json=Mock(return_value=body))
    request = SimpleNamespace(method=method, url='http://127.0.0.1:8000' + path)
    return SimpleNamespace(request=request, fetch=Mock(return_value=response), fulfill=Mock(), abort=Mock(), continue_=Mock()), response


def test_delete_is_forwarded_once_before_native_continuation_and_only_original_response_delivered():
    p = delay_probe()
    r, response = route()
    with journey.DelayedResponses(p, requests=[('DELETE', '/api/evidence/synthetic?version=1')], label='contract double') as delay:
        delay._route(r)
        r.fetch.assert_called_once_with(timeout=10_000, max_redirects=0, max_retries=0)
        assert delay.ready()['responses'][0]['response']['ok'] is True
        r.fulfill.assert_not_called()
        r.abort.assert_not_called()
        # Native action is not simulated here; only route delivery ordering.
        delay.release()
        r.fulfill.assert_called_once_with(response=response)
    assert p.page.route.call_count == p.page.unroute.call_count == 1
    assert delay.record['responses'][0]['delivered'] is True


def test_four_refresh_results_remain_original_and_auth_body_is_never_logged():
    p = delay_probe()
    routes = [route('GET', path, body={'csrf': 'contract-only-sensitive-token', 'value': path})
              for path in journey.REFRESH_PATHS]
    with journey.DelayedResponses(p, requests=[('GET', path) for path in journey.REFRESH_PATHS], label='contract double') as delay:
        for r, _ in routes:
            delay._route(r)
            r.fulfill.assert_not_called()
        assert len(delay.ready()['responses']) == 4
        delay.release()
    for r, response in routes:
        r.fetch.assert_called_once_with(timeout=10_000, max_redirects=0, max_retries=0)
        r.fulfill.assert_called_once_with(response=response)
        response.json.assert_not_called()
    assert 'contract-only-sensitive-token' not in json.dumps(p.observations)


@pytest.mark.parametrize('status', [201, 302, 401, 404, 409, 500, 503])
def test_unexpected_upstream_status_aborts_once_and_never_makes_success(status):
    p = delay_probe(); r, response = route(status=status)
    with pytest.raises(AssertionError, match='actual successful'):
        with journey.DelayedResponses(p, requests=[('DELETE', '/api/evidence/synthetic?version=1')], label='contract double') as delay:
            delay._route(r)
    r.fetch.assert_called_once()
    r.fulfill.assert_not_called()
    r.abort.assert_called_once_with('failed')
    response.json.assert_not_called()


def test_missing_delete_success_is_rejected_without_delivering():
    p = delay_probe(); r, _ = route(body={'ok': False})
    with pytest.raises(AssertionError, match='already have succeeded'):
        with journey.DelayedResponses(p, requests=[('DELETE', '/api/evidence/synthetic?version=1')], label='contract double') as delay:
            delay._route(r)
    r.abort.assert_called_once_with('failed')
    r.fulfill.assert_not_called()


@pytest.mark.parametrize('error', [TimeoutError('timed out'), OSError('connection reset')])
def test_upstream_failure_is_never_retried_and_original_error_survives(error):
    p = delay_probe(); r, _ = route(); r.fetch.side_effect = error
    with pytest.raises(type(error)) as caught:
        with journey.DelayedResponses(p, requests=[('DELETE', '/api/evidence/synthetic?version=1')], label='contract double') as delay:
            delay._route(r)
    assert caught.value is error
    r.fetch.assert_called_once()
    r.abort.assert_called_once_with('failed')
    r.fulfill.assert_not_called()


def test_duplicate_delete_is_rejected_before_second_upstream_fetch():
    p = delay_probe(); first, _ = route(); second, _ = route()
    with pytest.raises(AssertionError, match='more than once'):
        with journey.DelayedResponses(p, requests=[('DELETE', '/api/evidence/synthetic?version=1')], label='contract double') as delay:
            delay._route(first)
            delay._route(second)
    first.fetch.assert_called_once()
    second.fetch.assert_not_called()
    for r in (first, second):
        r.abort.assert_called_once_with('failed')
        r.fulfill.assert_not_called()


def test_undeclared_requests_are_not_fetched_delayed_or_changed():
    p = delay_probe(); r, _ = route('GET')
    delay = journey.DelayedResponses(p, requests=[('DELETE', '/api/evidence/synthetic?version=1')], label='contract double')
    delay._route(r)
    r.continue_.assert_called_once_with()
    r.fetch.assert_not_called(); r.fulfill.assert_not_called(); r.abort.assert_not_called()
    assert delay.record['responses'] == []


def test_cleanup_aborts_held_response_if_native_step_fails_without_retry():
    p = delay_probe(); r, _ = route()
    with pytest.raises(RuntimeError, match='native step failed'):
        with journey.DelayedResponses(p, requests=[('DELETE', '/api/evidence/synthetic?version=1')], label='contract double') as delay:
            delay._route(r)
            raise RuntimeError('native step failed')
    r.fetch.assert_called_once(); r.abort.assert_called_once_with('failed'); r.fulfill.assert_not_called()
    assert delay.record['responses'][0]['aborted'] is True


def test_fulfill_failure_cleans_remaining_responses_without_refetching():
    p = delay_probe(); r, _ = route(); r.fulfill.side_effect = OSError('closed page')
    with pytest.raises(OSError, match='closed page'):
        with journey.DelayedResponses(p, requests=[('DELETE', '/api/evidence/synthetic?version=1')], label='contract double') as delay:
            delay._route(r); delay.release()
    r.fetch.assert_called_once(); r.fulfill.assert_called_once(); r.abort.assert_called_once()


@pytest.mark.parametrize('requests', [[], [('POST', '/api/evidence')], [('GET', 'https://other.test/api/data')],
    [('GET', '/api/../data')], [('GET', '/api/data'), ('GET', '/api/data')]])
def test_invalid_delay_declaration_rejected_before_route_registration(requests):
    p = delay_probe()
    with pytest.raises(ValueError): journey.DelayedResponses(p, requests=requests, label='invalid')
    p.page.route.assert_not_called()


def dialog_probe(tmp_path):
    control = SimpleNamespace(wait_for=Mock(), count=lambda: 1, is_visible=lambda: True, is_enabled=lambda: True)
    p = Probe(SimpleNamespace(locator=Mock(return_value=control)), 'http://127.0.0.1:8000', tmp_path, None)
    p.observations['native_created_synthetic_evidence'] = {'target': {'id': 'synthetic', 'version': 1},
        'synthetic': True, 'created_through_visible_form': True}
    dialog = SimpleNamespace(type='confirm', message=journey.DELETE_CONFIRM, accept=Mock())
    return p, control, dialog


def confirm(p, dialog, *, target=None):
    return p.with_expected_dialog(dialog_type='confirm', message=journey.DELETE_CONFIRM,
        evidence_target=target, action=lambda: p.handle_expected_dialog(dialog))


def test_default_probe_still_rejects_evidence_delete(tmp_path):
    p, _, d = dialog_probe(tmp_path)
    with pytest.raises(ValueError): confirm(p, d)
    d.accept.assert_not_called()


def test_bound_native_fixture_allows_exact_single_dialog_only_once(tmp_path):
    p, _, d = dialog_probe(tmp_path)
    assert confirm(p, d, target={'id': 'synthetic', 'version': 1}) is True
    d.accept.assert_called_once_with()
    assert p.observations['expected_dialogs'][0]['accepted'] == 1
    with pytest.raises(ValueError): confirm(p, d, target={'id': 'synthetic', 'version': 1})
    d.accept.assert_called_once_with()


@pytest.mark.parametrize('change', ['no_fixture', 'wrong_id', 'wrong_version', 'extra_key', 'not_synthetic',
                                    'not_native', 'unsafe_id', 'boolean_version', 'zero_version'])
def test_bad_evidence_binding_cannot_enable_confirmation(tmp_path, change):
    p, _, d = dialog_probe(tmp_path); target = {'id': 'synthetic', 'version': 1}
    fixture = p.observations['native_created_synthetic_evidence']
    if change == 'no_fixture': p.observations.clear()
    elif change == 'wrong_id': target['id'] = 'other'
    elif change == 'wrong_version': target['version'] = 2
    elif change == 'extra_key': target['other'] = 'not allowed'
    elif change == 'not_synthetic': fixture['synthetic'] = False
    elif change == 'not_native': fixture['created_through_visible_form'] = False
    elif change == 'unsafe_id': target['id'] = 'x"]'; fixture['target'] = deepcopy(target)
    elif change == 'boolean_version': target['version'] = True
    else: target['version'] = 0; fixture['target'] = deepcopy(target)
    with pytest.raises(ValueError): confirm(p, d, target=target)
    d.accept.assert_not_called()


@pytest.mark.parametrize('change', ['hidden', 'disabled', 'ambiguous', 'missing'])
def test_inaccessible_delete_control_cannot_enable_confirmation(tmp_path, change):
    p, control, d = dialog_probe(tmp_path)
    if change == 'hidden': control.is_visible = lambda: False
    elif change == 'disabled': control.is_enabled = lambda: False
    else: control.count = lambda: 2 if change == 'ambiguous' else 0
    with pytest.raises((ValueError, AssertionError)): confirm(p, d, target={'id': 'synthetic', 'version': 1})
    d.accept.assert_not_called()


@pytest.mark.parametrize('change', ['message', 'type', 'duplicate', 'absent'])
def test_bound_deletion_still_rejects_unexpected_or_multiple_dialog_events(tmp_path, change):
    p, _, d = dialog_probe(tmp_path)
    if change == 'message': d.message = 'Delete everything?'
    elif change == 'type': d.type = 'prompt'
    def action():
        if change != 'absent': p.handle_expected_dialog(d)
        if change == 'duplicate': p.handle_expected_dialog(d)
    with pytest.raises(AssertionError, match='exact single'):
        p.with_expected_dialog(dialog_type='confirm', message=journey.DELETE_CONFIRM,
            evidence_target={'id': 'synthetic', 'version': 1}, action=action)
    assert d.accept.call_count == (1 if change == 'duplicate' else 0)


@pytest.fixture
def offline_oracle(tmp_path):
    from in_process_oracle import offline_test_client
    from server.app import make_app
    from server.config import Settings
    def build_app(providers):
        return make_app(Settings(data_dir=tmp_path, origin='http://testserver'), providers=providers, worker_enabled=False)
    with offline_test_client(build_app) as oracle:
        yield oracle


def test_actual_api_shapes_deletion_and_edited_research_proposal_match_native_expectations(offline_oracle):
    """Actual ASGI APIs, not native proof; no detached-form POST is attempted."""
    from conftest import Actor
    from test_services import ok, thread, message
    from scripts.product_first_use_audit import HEADERS
    client, providers, network_attempts = offline_oracle
    actor = Actor(client)
    csv = journey.fixture_csv((','.join(HEADERS) + '\n').encode('utf-8-sig'))
    staged = ok(actor.post('/workspace/imports/file', data={
        'company': journey.COMPANY, 'amount_unit': 'yuan', 'basis': 'standalone_quarter',
        'target_id': '', 'target_version': '0', 'merge_mode': 'replace'},
        files={'file': ('late-actions-synthetic-input.csv', csv, 'text/csv')}), 201)
    saved = ok(actor.post('/workspace/imports/' + staged['id'] + '/commit', json={
        'version': staged['version'], 'fingerprint': staged['payload']['fingerprint']}), 201)
    journey.expect_fixture(saved)
    experiment = ok(actor.post('/workspace/experiments', json={
        'request_id': 'native-late-action-api-oracle', 'dataset_id': saved['id'],
        'dataset_version': saved['version'], 'dataset_hash': saved['content_hash'],
        'name': journey.EXPERIMENT_NAME, 'kind': 'scenario', 'target_period': journey.TARGET,
        'assumptions': journey.ASSUMPTIONS,
        **{key: float(value) / 100 for key, value in journey.SCENARIO_FIELDS.items()}}), 201)
    journey.expect_saved(experiment, saved, name=journey.EXPERIMENT_NAME, kind='scenario')
    evidence = ok(actor.post('/evidence', json={'title': journey.EVIDENCE_TITLE,
        'text': journey.EVIDENCE_TEXT, 'company': journey.COMPANY, 'source_url': '', 'global_scope': False}), 201)
    assert ok(actor.get('/evidence'))['items'] == [evidence]
    removed = ok(actor.delete('/evidence/' + evidence['id'] + '?version=' + str(evidence['version'])))
    assert removed['ok'] is True
    assert ok(actor.get('/evidence'))['items'] == []
    assert ok(actor.get('/datasets/' + saved['id'])) == saved
    t = thread(actor, saved)
    posted = ok(message(actor, t, journey.ASSISTANT_QUERY), 201)
    msg = posted['message']
    assert any(a['kind'] == 'proposal' and a['type'] == 'research' for a in msg['payload']['response']['actions'])
    body = {'kind': 'research', 'text': journey.RESEARCH_QUERY,
        'request_id': 'current-reopened-native-form-contract', 'source_message_id': msg['id'],
        'mode': 'operational', 'use_llm': False, 'max_calls': 0, 'provider': '',
        'include_thread_history': False, 'acceptance': '',
        'execution': {'depth': 'deep', 'model_planning': False, 'forecast': False, 'forecast_metric': 'revenue', 'horizon': 2},
        'experiment': {'id': experiment['id'], 'version': experiment['version'], 'hash': experiment['experiment_hash']}}
    created = ok(actor.post('/services/threads/' + t['id'] + '/proposals', json=body), 201)
    proposal = ok(actor.get('/services/proposals/' + created['id']))
    plan = ok(actor.get('/workspace/plans/' + proposal['payload']['plan_id']))
    journey.expect_proposal(proposal, plan, saved, experiment, message_id=msg['id'], request_id=body['request_id'])
    snapshot = ok(actor.get('/services/threads/' + t['id']))
    assert len(snapshot['proposals']) == 1 and snapshot['proposals'][0]['id'] == proposal['id']
    assert snapshot['runs'] == []
    assert ok(actor.get('/datasets/' + saved['id'])) == saved
    assert ok(actor.get('/workspace/experiments/' + experiment['id'])) == experiment
    assert ok(actor.get('/runs'))['items'] == []
    assert not any(row['configured'] for row in ok(actor.get('/capabilities'))['providers'])
    assert providers.calls == [] and network_attempts == []
    # Independently perturb material bindings/meaning and demand oracle failure.
    for field, value in [('text', journey.OBSOLETE_QUERY), ('status', 'confirmed'), ('external_calls', 1)]:
        changed = deepcopy(proposal); changed['payload'][field] = value
        with pytest.raises(AssertionError):
            journey.expect_proposal(changed, plan, saved, experiment, message_id=msg['id'], request_id=body['request_id'])
    for field, value in [('request_id', 'obsolete-form-key'), ('experiment', None), ('use_llm', True)]:
        changed = deepcopy(proposal); changed['payload']['request'][field] = value
        with pytest.raises(AssertionError):
            journey.expect_proposal(changed, plan, saved, experiment, message_id=msg['id'], request_id=body['request_id'])


def test_local_journey_rejected_before_probe_activity(monkeypatch):
    monkeypatch.delenv('GITHUB_ACTIONS', raising=False)
    p = Mock()
    with pytest.raises(HarnessContractError, match='restricted'):
        journey.late_action_journey(p, repository_root='unused', data_dir='unused', expected_web_tree='a'*40, expected_server_tree='b'*40)
    p.assert_not_called()
    assert p.mock_calls == []


def test_duplicate_delivery_is_rejected_without_fetch_fulfill_or_wait():
    p = delay_probe(); r, _ = route()
    with journey.DelayedResponses(p, requests=[('DELETE', '/api/evidence/synthetic?version=1')], label='contract double') as delay:
        delay._route(r); delay.release()
        with pytest.raises(AssertionError, match='already released'): delay.release()
    r.fetch.assert_called_once(); r.fulfill.assert_called_once(); p.page.wait_for_timeout.assert_not_called()


def test_closed_browser_cleanup_does_not_replace_original_native_failure():
    p = delay_probe(); r, _ = route()
    p.page.unroute.side_effect = OSError('browser already closed')
    r.abort.side_effect = OSError('request already gone')
    error = RuntimeError('original native action failed')
    with pytest.raises(RuntimeError) as caught:
        with journey.DelayedResponses(p, requests=[('DELETE', '/api/evidence/synthetic?version=1')], label='contract double') as delay:
            delay._route(r)
            raise error
    assert caught.value is error
    assert delay.record['cleanup_errors'] == ['request already gone', 'browser already closed']
    r.fetch.assert_called_once(); r.abort.assert_called_once(); r.fulfill.assert_not_called()


@pytest.mark.parametrize('extra', [
    ('POST', '/api/workspace/imports/preview'), ('POST', '/api/services/proposals/p/confirm'),
    ('PUT', '/api/datasets/d'), ('DELETE', '/api/evidence/e?version=1'),
    ('POST', '/api/services/threads/t/proposals'),
])
def test_request_accounting_rejects_hidden_writes_and_duplicate_submissions(extra):
    mutations = [{'method': method, 'path': path} for method, path in [
        ('POST', '/api/workspace/experiments'), ('POST', '/api/evidence'),
        ('DELETE', '/api/evidence/e?version=1'), ('POST', '/api/services/threads'),
        ('POST', '/api/services/threads/t/messages'), ('POST', '/api/services/threads/t/proposals')]]
    journey.expect_mutations(mutations, evidence={'id': 'e', 'version': 1}, thread_id='t')
    mutations.append({'method': extra[0], 'path': extra[1]})
    with pytest.raises(AssertionError, match='six explicit native writes'):
        journey.expect_mutations(mutations, evidence={'id': 'e', 'version': 1}, thread_id='t')


def test_cleanup_aborts_pending_original_before_removing_interceptor():
    p=delay_probe();r,_=route();order=[]
    r.abort.side_effect=lambda reason:order.append('abort:'+reason)
    p.page.unroute.side_effect=lambda *args:order.append('unroute')
    with pytest.raises(RuntimeError,match='stop'):
        with journey.DelayedResponses(p,requests=[('DELETE','/api/evidence/synthetic?version=1')],label='order double') as delay:
            delay._route(r)
            raise RuntimeError('stop')
    assert order==['abort:failed','unroute']
    r.fetch.assert_called_once();r.fulfill.assert_not_called()
