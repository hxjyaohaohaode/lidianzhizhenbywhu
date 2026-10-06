"""Adaptive first-send races and repeated recovery; all transports are isolated."""
import copy
import pytest
from server.adaptive_runtime import AdaptiveRun
from server.network import PinnedHTTPS
from server.store import digest
from server import workspace_store as ws
from test_legacy_studio_lifecycle import prepared, trace
from test_transport_lifecycle import Socket, response
from test_workspace_api import good
from test_adaptive_recovery_selection import resume_to_report, SimulatedProcessDeath


def running(actor,run):
    with actor.client.app.state.store.transaction() as db:
        db.execute("UPDATE runs SET state='running' WHERE id=?",(run['id'],))
    runner=AdaptiveRun(actor.client.app.state.worker,run['id'])
    node=next(n for n in runner.graph['nodes'] if n['id']=='analyst')
    disclosure={'memory_ids':runner.st['packing']['included_memory_ids'],
                'citation_ids':runner.st['packing']['included_citation_ids']}
    binding=runner.graph['provider_bindings']['analyst']
    call_id,error=runner.reserve_call(node,binding,'{}',disclosure)
    assert call_id and error is None
    return runner,node,binding,call_id


@pytest.mark.parametrize('mutation',['delete_conversation','delete_reservation','close_reservation','cancel_run'])
def test_first_send_rechecks_live_reservation_in_transaction(factory,monkeypatch,mutation):
    actor,providers,_,run,_=prepared(factory,'adaptive')
    runner,node,binding,call_id=running(actor,run);store=runner.store
    sent=[];lookups=[];sock=Socket();approved=[]
    def guard():
        approved.append(True)
        return True  # deterministic race after the transport's previous check
    def boundary():
        if mutation=='delete_conversation':
            session=store.owned('conversations',actor.user['id'],run['session_id'])
            good(actor.delete('/conversations/'+run['session_id'],params={'version':session['version']}))
        elif mutation=='delete_reservation':
            with store.transaction() as db:db.execute('DELETE FROM adaptive_calls WHERE id=?',(call_id,))
        elif mutation=='close_reservation':
            runner.close_call(call_id,'unknown',{'dispatched':None,'dispatch_state':'unknown','remote_outcome_known':False})
        else:good(actor.post('/runs/'+run['id']+'/cancel'))
        runner.mark_dispatch(call_id,boundary='first_http_send',binding=binding)
    class TLS(Socket):
        def do_handshake(self):pass
        def sendall(self,data):sent.append(data);super().sendall(data)
    tls=TLS()
    class Context:
        def wrap_socket(self,*args,**kwargs):return tls
    class Response:
        status=200
        def read(self,*args):return response()
    monkeypatch.setattr('server.providers.public_addresses',lambda _:lookups.append(True) or ['93.184.216.34'])
    monkeypatch.setattr('server.network.socket.create_connection',lambda *args:sock)
    monkeypatch.setattr('server.network.ssl.create_default_context',lambda:Context())
    monkeypatch.setattr(PinnedHTTPS,'getresponse',lambda self:Response())
    provider=copy.copy(providers.providers['fixture']);provider.dispatch_guard=guard;provider.dispatch_started=boundary
    with pytest.raises(ValueError,match='MODEL_AUTHORIZATION_CHANGED') as failure:
        actor.client.portal.call(providers.complete,provider,'safe','{}')
    assert failure.value.dispatched is False and sent==[] and lookups==[True] and approved
    assert providers.failures=={} and providers.open_until=={}
    if mutation=='delete_conversation':
        assert actor.get('/runs/'+run['id']).status_code==404
    elif mutation=='delete_reservation':
        with pytest.raises(RuntimeError,match='DISPATCH_LEDGER_INTEGRITY_FAILED'):
            AdaptiveRun(actor.client.app.state.worker,run['id']).verify_restore()
    elif mutation=='close_reservation':
        restored=AdaptiveRun(actor.client.app.state.worker,run['id']);restored.verify_restore()
        assert restored.outputs['analyst']['status']=='unknown'
        assert actor.client.portal.call(restored.model,node)['error_class']=='NODE_ALREADY_DISPATCHED'
    else:
        control=good(actor.get('/workspace/runs/'+run['id']+'/runtime'))['control']
        denied=actor.post('/workspace/runs/'+run['id']+'/control',json={'action':'resume','version':control['version']})
        assert denied.status_code==409 and denied.json()['error']['code']=='RUN_TERMINAL'
    assert lookups==[True] and sent==[]


def test_unknown_reservation_closes_before_checkpoint_and_survives_second_crash(factory,monkeypatch):
    actor,providers,_,run,memory=prepared(factory,'adaptive')
    runner,node,_,call_id=running(actor,run)
    assert runner.store.one('SELECT * FROM adaptive_calls WHERE id=?',(call_id,))['state']=='reserved'
    assert not any(e['type']=='external_dispatch' for e in trace(actor,run))
    original=trace(actor,run)
    def crash(*args):raise SimulatedProcessDeath()
    monkeypatch.setattr(runner,'record',crash)
    with pytest.raises(SimulatedProcessDeath):runner.verify_restore()
    call=runner.store.one('SELECT * FROM adaptive_calls WHERE id=?',(call_id,))
    assert call['state']=='unknown' and call['payload']['dispatch_state']=='unknown'
    assert call['payload']['dispatched'] is None and call['payload']['remote_outcome_known'] is False
    closure=next(e for e in trace(actor,run) if e['type']=='external_call_closed')
    assert closure['payload']['payload_hash']==digest(call['payload'])
    assert trace(actor,run)[:len(original)]==original
    assert runner.store.all('SELECT * FROM adaptive_checkpoints WHERE run_id=?',(run['id'],))==[]
    for _ in range(2):
        restored=AdaptiveRun(actor.client.app.state.worker,run['id']);restored.verify_restore()
        assert restored.outputs['analyst']['status']=='unknown'
        assert len(restored.store.all('SELECT * FROM adaptive_calls WHERE run_id=?',(run['id'],)))==1
    done=resume_to_report(actor,run)
    assert done['result']['memory_used']==[{'id':memory['id'],'version':memory['version']}]
    assert done['result']['citation_ids_sent']==sorted(runner.st['packing']['included_citation_ids'])
    assert not any(e['type']=='external_dispatch' for e in trace(actor,run))
    assert ws.verify_ledger(runner.store,run['id'])['valid']
