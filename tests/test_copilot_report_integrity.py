"""Authentic proposal execution and isolated damage never become normal chat answers."""
import copy
import threading
import asyncio

import pytest

from conftest import Actor
from server.store import encode
from test_historical_question_scope import CAPTURES, saved_tables
from test_legacy_execution_scope import approve
from test_percentage_execution_scope import captured_actor, objects
from test_services import ok, proposal, confirm, thread, identity
from test_copilot_research_inputs import execute_proposal


def executed_capture(actor):
    key = 'bare_source_good_draft' if 'bare_source_good_draft' in actor.scope_capture['cases'] else 'source_good_draft'
    store, case, plan, _ = objects(actor, key)
    approved = ok(approve(actor, case, plan))
    run = actor.execute(ok(actor.get('/runs/'+approved['payload']['result']['run_id'])))
    assert run['result'] and run['state'] in ('succeeded','degraded')
    t = store.one('SELECT * FROM workspace_objects WHERE id=?', (approved['payload']['thread_id'],))
    return store, t, approved, run


def report_from_thread(actor, t, run):
    return next(r for r in ok(actor.get('/services/threads/'+t['id']))['runs'] if r['id']==run['id'])


@pytest.mark.parametrize('captured_actor', CAPTURES, indirect=True)
@pytest.mark.parametrize('damage', ['amount','result_json','result_shape','missing_result','snapshot_json',
    'snapshot_shape','request_json','artifact_json','event_json','ledger','missing_artifact'])
def test_corrupt_captured_report_is_masked_and_healthy_neighbor_stays_readable(captured_actor, damage):
    actor = captured_actor; store, t, p, run = executed_capture(actor)
    neighbor = execute_proposal(actor, ok(proposal(actor,t,text='2024-Q2营业成本金额是多少',request_id='healthy-neighbor'),201))
    healthy = report_from_thread(actor,t,run)
    assert healthy['report_integrity']['valid'] and healthy['report_availability']['status']=='available'
    assert healthy['result']==run['result'] and healthy['unverified_report'] is None
    original = store.one('SELECT result AS raw_result FROM runs WHERE id=?', (run['id'],))['raw_result']
    with store.transaction() as db:
        if damage == 'amount':
            bad = copy.deepcopy(run['result']); bad['readout']['facts'][0]['value']=987654321
            db.execute('UPDATE runs SET result=? WHERE id=?',(encode(bad),run['id']))
        elif damage in ('result_json','snapshot_json','request_json'):
            field = {'result_json':'result','snapshot_json':'snapshot','request_json':'payload'}[damage]
            db.execute('UPDATE runs SET '+field+'=? WHERE id=?',('{not-json',run['id']))
        elif damage == 'result_shape': db.execute('UPDATE runs SET result=? WHERE id=?',('[]',run['id']))
        elif damage == 'snapshot_shape': db.execute('UPDATE runs SET snapshot=? WHERE id=?',('null',run['id']))
        elif damage == 'missing_result': db.execute('UPDATE runs SET result=NULL WHERE id=?',(run['id'],))
        elif damage == 'artifact_json': db.execute("UPDATE agent_artifacts SET payload=? WHERE run_id=? AND node='report'",('{not-json',run['id']))
        elif damage == 'event_json': db.execute("UPDATE run_events SET payload=? WHERE run_id=? AND type='step_completed'",('{not-json',run['id']))
        elif damage == 'ledger': db.execute('UPDATE event_integrity SET entry_hash=? WHERE run_id=?',('0'*64,run['id']))
        elif damage == 'missing_artifact': db.execute("DELETE FROM agent_artifacts WHERE run_id=? AND node='report'",(run['id'],))
    before = saved_tables(store,actor.scope_capture); changes=store.db.total_changes
    for _ in range(2):
        result = report_from_thread(actor,t,run)
        assert result['report_availability']['status']=='unavailable'
        assert result['report_integrity']['valid'] is False
        assert result['source_impact']['state']=='unavailable'
        assert result['result'] is None and result['question_compatibility'] is None
        assert result['query']==p['payload']['text']
        raw = store.one('SELECT result AS raw_result FROM runs WHERE id=?',(run['id'],))['raw_result']
        assert result['unverified_report']==({'raw':raw,'notice':'未核验的已保存报告原文，仅供排查；不是可用结论。'} if raw is not None else None)
        if damage=='amount':
            audit=ok(actor.get('/workspace/runs/'+run['id']+'/audit'))
            assert result['report_integrity']==audit['report_integrity']
            assert result['report_hash_valid'] is False
            assert '987654321' in raw
            assert ok(actor.get('/runs/'+run['id']+'/export'),409)['error']['code']=='REPORT_INTEGRITY'
        elif damage not in ('result_json','result_shape','missing_result'): assert raw==original
        current_neighbor=report_from_thread(actor,t,neighbor)
        assert current_neighbor['report_availability']['status']=='available'
        assert current_neighbor['report_integrity']['valid'] and current_neighbor['result']==neighbor['result']
    assert saved_tables(store,actor.scope_capture)==before and store.db.total_changes==changes


@pytest.mark.parametrize('captured_actor', CAPTURES, indirect=True)
def test_bad_report_does_not_expose_cross_owner_data_or_break_a_separate_thread(captured_actor):
    actor=captured_actor; store,t,p,run=executed_capture(actor)
    separate=thread(actor,store.owned('datasets',actor.user['id'],run['dataset_id']))
    neighbor=execute_proposal(actor,ok(proposal(actor,separate,text='2024-Q2营业成本金额是多少'),201))
    with store.transaction() as db:
        db.execute('UPDATE runs SET result=? WHERE id=?',('{unreadable',run['id']))
        # Another unreadable proposal has no usable thread binding; never guess
        # it belongs to the healthy thread or let json_extract abort its read.
        other=next(c for c in actor.scope_capture['cases'].values() if c['proposal_id'] and c['proposal_id']!=p['id'])
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',('{unreadable',other['proposal_id']))
    assert report_from_thread(actor,separate,neighbor)['result']==neighbor['result']
    foreign=Actor(actor.client)
    assert foreign.get('/services/threads/'+t['id']).status_code==404
    from server.copilot_reports import read_proposal_run
    assert read_proposal_run(store,foreign.user['id'],p,None) is None


@pytest.mark.parametrize('adaptive',[False,True])
def test_real_queued_running_cancelled_states_never_claim_corruption_or_a_report(actor,monkeypatch,adaptive):
    dataset=actor.dataset();t=thread(actor,dataset)
    kwargs={'execution':{}} if adaptive else {}
    p=ok(proposal(actor,t,text='核查营业成本和毛利率',**kwargs),201)
    approved=ok(confirm(actor,p));run=ok(actor.get('/runs/'+approved['payload']['result']['run_id']))
    queued=report_from_thread(actor,t,run)
    assert queued['state']=='queued' and queued['report_availability']['status']=='pending'
    assert queued['result'] is None and queued['source_impact'] is None
    entered=threading.Event()
    async def wait_during_perform(_):
        entered.set()
        await asyncio.Event().wait()
    worker=actor.client.app.state.worker
    monkeypatch.setattr(worker,'perform',wait_during_perform)
    future=actor.client.portal.start_task_soon(worker.execute,run['id'])
    try:
        assert entered.wait(2)
        running=report_from_thread(actor,t,run)
        assert running['state']=='running' and running['report_availability']['status']=='pending'
        assert running['result'] is None and running['source_impact'] is None
        ok(actor.post('/runs/'+run['id']+'/cancel'))
        cancelled=report_from_thread(actor,t,run)
        assert cancelled['state']=='cancelled' and cancelled['report_availability']['status']=='no_report'
        assert cancelled['result'] is None and cancelled['unverified_report'] is None
    finally: future.cancel()


@pytest.mark.parametrize('adaptive',[False,True])
def test_healthy_completed_report_stays_frozen_when_identity_access_is_revoked(actor,adaptive):
    dataset=actor.dataset();i=identity(actor,dataset);t=thread(actor,dataset,i)
    p=ok(proposal(actor,t,text='核查营业成本和毛利率',**({'execution':{}} if adaptive else {})),201)
    run=execute_proposal(actor,p)
    ok(actor.delete('/services/identities/'+i['id']+'?version=1'))
    loaded=ok(actor.get('/services/threads/'+t['id']))
    assert loaded['archived_mode'] and loaded['context']['writable'] is False
    card=loaded['runs'][0]
    assert card['result']==run['result'] and card['report_integrity']['valid']
    assert card['report_availability']['status']=='available' and card['source_impact']['state']=='unavailable'
    assert actor.post('/services/threads/'+t['id']+'/messages',json={'text':'继续研究成本问题','version':t['version'],'request_id':'forbidden-new-question'}).status_code in (404,409)
