"""Crash-boundary and planner-selection regressions using isolated provider doubles.

All runs use the real approval API; no test contacts an external model provider.
"""
import pytest

from conftest import Actor
from test_adaptive import ResearchProviders, completed, dispatch, preview, runtime
from server.adaptive_runtime import AdaptiveRun
from server.autonomy import REQUIRED
from server.store import digest, encode, now
from server import workspace_store as ws


class SimulatedProcessDeath(RuntimeError):
    pass


class RejectedProviders(ResearchProviders):
    def __init__(self, error):
        super().__init__()
        self.error = error
        self.attempts = 0

    async def complete(self, provider, system, context):
        self.attempts += 1
        raise self.error


def running_fixture(factory, providers, *, max_calls=1, **execution):
    actor = Actor(factory(providers))
    row = dispatch(actor, preview(actor, use_llm=True, provider='alpha', max_calls=max_calls,
        execution={'max_revisions':0, 'local_recovery':False, **execution}))
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute("UPDATE runs SET state='running' WHERE id=?", (row['id'],))
    runner = AdaptiveRun(actor.client.app.state.worker, row['id'])
    specialist = next(n for n in runner.graph['nodes'] if n['id'] == 'analyst')
    return actor, row, runner, specialist


def crash_before_checkpoint(actor, runner, specialist, monkeypatch):
    record = runner.record

    def crash(node, result, state):
        if node['id'] == specialist['id']:
            raise SimulatedProcessDeath()
        return record(node, result, state)

    monkeypatch.setattr(runner, 'record', crash)
    with pytest.raises(SimulatedProcessDeath):
        actor.client.portal.call(runner.execute_node, specialist)
    checkpoint = runner.store.one('SELECT * FROM adaptive_checkpoints WHERE run_id=? AND node_id=?',
                                  (runner.id, specialist['id']))
    assert checkpoint['state'] == 'running' and checkpoint['artifact_id'] is None
    assert runner.store.all('SELECT * FROM agent_artifacts WHERE run_id=?', (runner.id,)) == []


def use_legacy_closure(runner, monkeypatch):
    def legacy_close_call(call_id, state, metadata):
        # The previous release persisted closure metadata without a closure event.
        with runner.store.transaction() as db:
            payload = runner.store.one('SELECT payload FROM adaptive_calls WHERE id=?', (call_id,))['payload']
            db.execute('UPDATE adaptive_calls SET state=?,payload=?,updated_at=? WHERE id=?',
                       (state, encode({**payload, **metadata}), now(), call_id))

    monkeypatch.setattr(runner, 'close_call', legacy_close_call)


def restored_twice(actor, row, expected_status, expected_checkpoint):
    worker = actor.client.app.state.worker
    first = AdaptiveRun(worker, row['id'])
    first.verify_restore()
    result = first.outputs['analyst']
    checkpoint = first.store.one('SELECT * FROM adaptive_checkpoints WHERE run_id=? AND node_id=?',
                                 (row['id'], 'analyst'))
    assert result['status'] == expected_status and checkpoint['state'] == expected_checkpoint
    second = AdaptiveRun(worker, row['id'])
    second.verify_restore()
    assert second.outputs['analyst'] == result
    assert second.store.one('SELECT * FROM adaptive_checkpoints WHERE run_id=? AND node_id=?',
                            (row['id'], 'analyst')) == checkpoint
    assert len(second.store.all('SELECT * FROM agent_artifacts WHERE run_id=? AND node=?',
                                (row['id'], 'analyst'))) == 1
    return second, result


def resume_to_report(actor, row):
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute("UPDATE runs SET state='interrupted' WHERE id=?", (row['id'],))
    control = runtime(actor, row)['control']
    response = actor.post('/workspace/runs/'+row['id']+'/control',
                          json={'version':control['version'], 'action':'resume'})
    assert response.status_code == 200, response.text
    done = actor.execute(row)
    assert done['result'] and done['state'] == 'degraded', done
    return done


@pytest.mark.parametrize('code', ['AUTHORIZATION_CHANGED', 'MODEL_AUTHORIZATION_CHANGED',
                                  'MODEL_TRANSPORT_BUSY', 'MODEL_CIRCUIT_OPEN'])
@pytest.mark.parametrize('lost_checkpoint', [False, True])
def test_closed_non_dispatched_failure_survives_crash_without_retry(factory, monkeypatch, code, lost_checkpoint):
    providers = RejectedProviders(ValueError(code))
    actor, row, runner, specialist = running_fixture(factory, providers)
    if code == 'AUTHORIZATION_CHANGED':
        authorization_checks = iter([True, False])
        monkeypatch.setattr(runner, 'authorization_valid', lambda _: next(authorization_checks))
    crash_before_checkpoint(actor, runner, specialist, monkeypatch)
    before = runtime(actor, row)['calls'][0]
    assert before['state'] == 'failed' and before['payload']['error_class'] == code
    assert before['payload']['dispatched'] is False and before['payload']['remote_outcome_known'] is True
    closure = runner.store.one("SELECT * FROM run_events WHERE run_id=? AND type='external_call_closed'", (row['id'],))
    assert closure['payload']['payload_hash'] == digest(before['payload'])
    assert ws.verify_ledger(runner.store, row['id'])['valid']
    if lost_checkpoint:
        with runner.store.transaction() as db:
            db.execute('DELETE FROM adaptive_checkpoints WHERE run_id=? AND node_id=?', (row['id'], 'analyst'))
    _, result = restored_twice(actor, row, 'blocked' if code == 'AUTHORIZATION_CHANGED' else 'failed', 'degraded')
    assert result['error_class'] == code and result['call_id'] == before['id']
    done = resume_to_report(actor, row)
    assert runtime(actor, row)['calls'] == [before]
    assert providers.attempts == (0 if code == 'AUTHORIZATION_CHANGED' else 1)
    assert done['result']['missing'] and all('未知' not in missing for missing in done['result']['missing'])
    assert done['result']['citation_ids_sent'] == [] and done['result']['memory_used'] == []
    events = actor.get('/runs/'+row['id']+'/trace').json()['items']
    assert sum(e['type'] == 'known_call_failure_reused' for e in events) == 1
    assert not any(e['type'] == 'unknown_call_not_repeated' for e in events)
    assert ws.verify_ledger(runner.store, row['id'])['valid']


def test_acknowledged_throttle_before_non_dispatched_fallback_is_known(factory, monkeypatch):
    async def reject(provider, system, context, count):
        raise ValueError('MODEL_HTTP_429' if provider.id == 'alpha' else 'MODEL_TRANSPORT_BUSY')

    providers = ResearchProviders(handler=reject)
    actor, row, runner, specialist = running_fixture(factory, providers, max_calls=2,
                                                    fallback_providers=['beta'])
    crash_before_checkpoint(actor, runner, specialist, monkeypatch)
    before = runtime(actor, row)['calls']
    assert len(before) == len(providers.calls) == 2
    _, result = restored_twice(actor, row, 'failed', 'degraded')
    assert result['error_class'] == 'MODEL_TRANSPORT_BUSY'
    assert result['call_id'] == next(call['id'] for call in before if call['provider'] == 'beta')
    # The unused specialist is blocked by the unchanged cumulative call budget.
    resume_to_report(actor, row)
    assert runtime(actor, row)['calls'] == before and len(providers.calls) == 2


@pytest.mark.parametrize('tampered_artifact', [False, True])
def test_legacy_non_dispatched_failure_reuses_only_intact_terminal_checkpoint(factory, monkeypatch, tampered_artifact):
    providers = RejectedProviders(ValueError('MODEL_TRANSPORT_BUSY'))
    actor, row, runner, specialist = running_fixture(factory, providers)
    use_legacy_closure(runner, monkeypatch)
    actor.client.portal.call(runner.execute_node, specialist)
    before = runtime(actor, row)['calls'][0]
    assert before['state'] == 'failed' and before['payload']['dispatched'] is False
    assert not runner.store.all("SELECT * FROM run_events WHERE run_id=? AND type='external_call_closed'", (row['id'],))
    assert ws.verify_ledger(runner.store, row['id'])['valid']
    if tampered_artifact:
        with runner.store.transaction() as db:
            db.execute("UPDATE agent_artifacts SET payload='{}' WHERE run_id=? AND node='analyst'", (row['id'],))
        with pytest.raises(RuntimeError, match='CHECKPOINT_INTEGRITY_FAILED'):
            AdaptiveRun(actor.client.app.state.worker, row['id']).verify_restore()
    else:
        _, result = restored_twice(actor, row, 'failed', 'degraded')
        assert result == runner.outputs['analyst']
        assert result['error_class'] == 'MODEL_TRANSPORT_BUSY' and result['call_id'] == before['id']
        resume_to_report(actor, row)
        assert runtime(actor, row)['calls'] == [before]
        assert ws.verify_ledger(runner.store, row['id'])['valid']
    assert providers.attempts == 1


@pytest.mark.parametrize('forged_state', ['completed', 'sent', 'failed'])
def test_legacy_completed_checkpoint_cannot_authorize_forged_no_send_flags(factory, monkeypatch, forged_state):
    providers = ResearchProviders()
    actor, row, runner, specialist = running_fixture(factory, providers)
    use_legacy_closure(runner, monkeypatch)
    actor.client.portal.call(runner.execute_node, specialist)
    assert runner.outputs['analyst']['status'] == 'completed'
    call = runtime(actor, row)['calls'][0]
    assert call['state'] == 'completed' and 'dispatched' not in call['payload']
    assert not runner.store.all("SELECT * FROM run_events WHERE run_id=? AND type='external_call_closed'", (row['id'],))
    with runner.store.transaction() as db:
        payload = {**call['payload'], 'dispatched':False, 'remote_outcome_known':True,
                   'error_class':'MODEL_TRANSPORT_BUSY'}
        db.execute('UPDATE adaptive_calls SET state=?,payload=? WHERE id=?',
                   (forged_state, encode(payload), call['id']))
    assert ws.verify_ledger(runner.store, row['id'])['valid']
    for _ in range(2):
        with pytest.raises(RuntimeError, match='CALL_CLOSURE_INTEGRITY_FAILED'):
            AdaptiveRun(actor.client.app.state.worker, row['id']).verify_restore()
    assert len(providers.calls) == 1


def test_legacy_no_send_error_must_match_checkpoint_outcome(factory, monkeypatch):
    providers = RejectedProviders(ValueError('MODEL_TRANSPORT_BUSY'))
    actor, row, runner, specialist = running_fixture(factory, providers)
    use_legacy_closure(runner, monkeypatch)
    actor.client.portal.call(runner.execute_node, specialist)
    call = runtime(actor, row)['calls'][0]
    with runner.store.transaction() as db:
        db.execute('UPDATE adaptive_calls SET payload=? WHERE id=?',
                   (encode({**call['payload'], 'error_class':'MODEL_CIRCUIT_OPEN'}), call['id']))
    with pytest.raises(RuntimeError, match='CALL_CLOSURE_INTEGRITY_FAILED'):
        AdaptiveRun(actor.client.app.state.worker, row['id']).verify_restore()
    assert providers.attempts == 1


@pytest.mark.parametrize('closure_state', [None, 'unknown', 'completed'])
def test_uncertain_sent_call_stays_unknown_and_is_never_retried(factory, closure_state):
    providers = ResearchProviders()
    actor, row, runner, specialist = running_fixture(factory, providers)
    call_id, error = runner.reserve_call(specialist, runner.graph['provider_bindings']['analyst'],
                                         '{}', {'memory_ids':[], 'citation_ids':[]})
    assert call_id and error is None
    if closure_state:
        runner.close_call(call_id, closure_state, {'usage':{}} if closure_state == 'completed' else
                          {'error_class':'CANCELLED_REMOTE_OUTCOME_UNKNOWN'})
    _, result = restored_twice(actor, row, 'unknown', 'unknown')
    assert result['error_class'] == 'REMOTE_OUTCOME_UNKNOWN'
    done = resume_to_report(actor, row)
    assert not providers.calls
    assert runtime(actor, row)['usage']['attempts'] == 1
    assert done['result']['missing'] and any('未知' in missing for missing in done['result']['missing'])
    assert ws.verify_ledger(runner.store, row['id'])['valid']


@pytest.mark.parametrize('tamper', ['payload', 'state', 'closure_event', 'remove_anchor', 'unclosed_forgery'])
def test_non_dispatched_recovery_requires_untampered_closure_evidence(factory, tamper):
    actor, row, runner, specialist = running_fixture(factory, ResearchProviders())
    call_id, error = runner.reserve_call(specialist, runner.graph['provider_bindings']['analyst'],
                                         '{}', {'memory_ids':[], 'citation_ids':[]})
    assert call_id and error is None
    if tamper != 'unclosed_forgery':
        runner.close_call(call_id, 'failed', {'error_class':'MODEL_TRANSPORT_BUSY',
            'remote_outcome_known':True, 'dispatched':False})
    with runner.store.transaction() as db:
        if tamper in ('payload', 'unclosed_forgery'):
            payload = runner.store.one('SELECT payload FROM adaptive_calls WHERE id=?', (call_id,))['payload']
            payload.update(error_class='MODEL_CIRCUIT_OPEN', remote_outcome_known=True, dispatched=False)
            db.execute("UPDATE adaptive_calls SET state='failed',payload=? WHERE id=?", (encode(payload), call_id))
        elif tamper == 'state':
            db.execute("UPDATE adaptive_calls SET state='sent' WHERE id=?", (call_id,))
        elif tamper == 'closure_event':
            db.execute("UPDATE run_events SET payload='{}' WHERE run_id=? AND type='external_call_closed'", (row['id'],))
        else:
            db.execute("DELETE FROM run_events WHERE run_id=? AND type='external_call_closed'", (row['id'],))
    expected = 'CHECKPOINT_EVENT_CHAIN_INVALID' if tamper == 'closure_event' else 'CALL_CLOSURE_INTEGRITY_FAILED'
    with pytest.raises(RuntimeError, match=expected):
        AdaptiveRun(actor.client.app.state.worker, row['id']).verify_restore()
    assert runner.store.all('SELECT * FROM agent_artifacts WHERE run_id=?', (row['id'],)) == []


def test_call_closure_and_event_anchor_commit_atomically(factory, monkeypatch):
    actor, row, runner, specialist = running_fixture(factory, ResearchProviders())
    call_id, error = runner.reserve_call(specialist, runner.graph['provider_bindings']['analyst'],
                                         '{}', {'memory_ids':[], 'citation_ids':[]})
    assert call_id and error is None
    original = runtime(actor, row)['calls'][0]
    event = runner.store.event

    def failed_anchor(db, run_id, kind, payload):
        if kind == 'external_call_closed':
            raise RuntimeError('SIMULATED_EVENT_WRITE_FAILURE')
        return event(db, run_id, kind, payload)

    monkeypatch.setattr(runner.store, 'event', failed_anchor)
    with pytest.raises(RuntimeError, match='SIMULATED_EVENT_WRITE_FAILURE'):
        runner.close_call(call_id, 'failed', {'error_class':'MODEL_TRANSPORT_BUSY',
            'remote_outcome_known':True, 'dispatched':False})
    assert runtime(actor, row)['calls'] == [original]
    assert not runner.store.all("SELECT * FROM run_events WHERE run_id=? AND type='external_call_closed'", (row['id'],))
    restored_twice(actor, row, 'unknown', 'unknown')


@pytest.mark.parametrize('specialists', [[], ['analyst'], ['challenger'], ['analyst', 'challenger']])
def test_planner_only_calls_selected_optional_specialists(factory, specialists):
    providers = ResearchProviders(proposal={'focus':[], 'specialists':specialists,
        'rationale':'只执行明确选择的可选专家，保留本地证据门禁'})
    actor = Actor(factory(providers))
    done = completed(actor, use_llm=True, provider='alpha', max_calls=4,
        execution={'model_planning':True, 'max_revisions':0, 'local_recovery':False})
    assert done['result'], done
    state = runtime(actor, done)
    expected = {'planner', *specialists}
    assert {call['node_id'] for call in state['calls']} == expected
    assert state['usage']['attempts'] == len(providers.calls) == len(expected)
    checkpoints = {checkpoint['node_id']:checkpoint for checkpoint in state['checkpoints']}
    nodes = {n['id']:n for n in state['graph']['payload']['nodes']}
    for optional in ('analyst', 'challenger'):
        assert nodes[optional]['enabled'] == (optional in specialists)
        assert checkpoints[optional]['state'] == ('succeeded' if optional in specialists else 'skipped')
    assert REQUIRED <= set(nodes)
    assert all(nodes[cap]['enabled'] and checkpoints[cap]['state'] in ('succeeded', 'degraded')
               and checkpoints[cap]['artifact_id'] for cap in REQUIRED)
    assert done['result']['analysis']['metrics'] and 'review' in done['result']['llm']
    events = actor.get('/runs/'+done['id']+'/trace').json()['items']
    assert {e['payload']['node'] for e in events if e['type'] == 'external_dispatch'} == expected
