"""Legacy Studio lifecycle and real transport boundaries; no live supplier calls."""
import asyncio
import copy
import threading
import pytest
from conftest import Actor
from server.providers import Provider, ProviderService
from server.network import PinnedHTTPS
from server import workspace_store as ws
from server.store import digest
from test_workspace_api import approve, evidence, good, plan
from test_transport_lifecycle import Socket, response, slots_available


def prepared(factory, engine='legacy', **settings):
    providers=ProviderService(timeout=2)
    providers.providers={'fixture':Provider('fixture','provider.example','/chat','fixture','NOT-A-REAL-KEY')}
    actor=Actor(factory(providers,**settings));dataset=actor.dataset()
    memory=good(actor.post('/memories',json={'text':'优先核对现金回流','approved':True}),201)
    evidence(actor,company=dataset['payload']['company'])
    preview=plan(actor,dataset,use_llm=True,provider='fixture',max_calls=1,
        **({'execution':{'max_revisions':0,'local_recovery':False,'parallelism':1}} if engine=='adaptive' else {}))
    assert ('adaptive' in preview['payload'])==(engine=='adaptive')
    assert preview['payload']['packing']['included_memory_ids']
    assert preview['payload']['packing']['included_citation_ids']
    run=good(approve(actor,preview,external_consent=True),202)
    return actor,providers,preview,run,memory


def revoke(actor):
    with actor.client.app.state.store.transaction() as db:
        db.execute('UPDATE users SET version=version+1 WHERE id=?',(actor.user['id'],))


def trace(actor,run):
    return good(actor.get('/runs/'+run['id']+'/trace'))['items']


@pytest.mark.parametrize('engine',['legacy','adaptive'])
@pytest.mark.parametrize('phase',['dns_revoke','tls_revoke','dns_error','tls_error','body_revoke','response_error','http_error','success'])
def test_real_studio_transport_reports_actual_disclosure(factory,monkeypatch,phase,engine):
    actor,providers,preview,run,memory=prepared(factory,engine)
    frozen=copy.deepcopy(run['snapshot']);raw_socket=Socket();sent=[];tls_calls=[]
    store=actor.client.app.state.store
    def dns(_):
        if phase=='dns_revoke':revoke(actor)
        if phase=='dns_error':raise OSError('private DNS failure text must not escape')
        return ['93.184.216.34']
    class TLS(Socket):
        def do_handshake(self):
            tls_calls.append(True)
            if phase=='tls_revoke':revoke(actor)
            if phase=='tls_error':raise OSError('private TLS failure text must not escape')
        def sendall(self,data):
            # Reservation and dispatch audit both commit before any HTTP bytes.
            events=store.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq',(run['id'],))
            reserved=next(e for e in events if e['type']=='external_call_reserved')
            dispatched=next(e for e in events if e['type']=='external_dispatch')
            assert reserved['seq']<dispatched['seq']
            assert reserved['payload'].get('dispatched') is not True
            super().sendall(data);sent.append(data)
            if phase=='body_revoke':revoke(actor)
    tls=TLS()
    class Context:
        def wrap_socket(self,*args,**kwargs):return tls
    class Response:
        status=429 if phase=='http_error' else 200
        def read(self,*args):
            if phase=='response_error':raise OSError('private response failure text must not escape')
            return response()
    monkeypatch.setattr('server.providers.public_addresses',dns)
    monkeypatch.setattr('server.network.socket.create_connection',lambda *args:raw_socket)
    monkeypatch.setattr('server.network.ssl.create_default_context',lambda:Context())
    monkeypatch.setattr(PinnedHTTPS,'getresponse',lambda self:Response())
    done=actor.execute(run);report=done['result'];call=report['llm']['calls'][0]
    events=trace(actor,run);audit=good(actor.get('/workspace/runs/'+run['id']+'/audit'))
    assert done['snapshot']==frozen and audit['ledger']['valid'] and audit['report_hash_valid']
    call_id=next(e['payload']['call_id'] for e in events if e['type']=='external_call_reserved')
    if engine=='legacy':
        assert call['call_id']==call_id
        outcome=next(e['payload'] for e in events if e['type']=='external_call_result')
    else:
        ledger=store.one('SELECT * FROM adaptive_calls WHERE id=?',(call_id,))
        closure=next(e['payload'] for e in events if e['type']=='external_call_closed')
        assert closure['payload_hash']==digest(ledger['payload'])
        outcome={**ledger['payload'],'status':ledger['state']}
        assert ledger['payload']['dispatch_protocol']==2
    for key in ('dispatched','dispatch_state','remote_outcome_known','status'):
        assert outcome[key]==call[key]
    if phase in {'dns_revoke','tls_revoke','dns_error','tls_error'}:
        assert sent==[] and call['dispatched'] is False and call['dispatch_state']=='not_sent'
        assert call['remote_outcome_known'] is True
        assert report['memory_used']==[] and report['citation_ids_sent']==[]
        assert not any(e['type']=='external_dispatch' for e in events)
        if phase.endswith('revoke'):
            assert call['error_class']=='MODEL_AUTHORIZATION_CHANGED'
            assert providers.failures=={} and providers.open_until=={}
    else:
        assert sent and call['dispatched'] is True
        assert report['memory_used']==[{'id':memory['id'],'version':memory['version']}]
        assert report['citation_ids_sent']==preview['payload']['packing']['included_citation_ids']
        dispatch=next(e['payload'] for e in events if e['type']=='external_dispatch')
        assert dispatch['boundary']=='first_http_send' and dispatch['dispatch_state']=='unknown'
        if phase in {'body_revoke','response_error'}:
            assert call['status']=='unknown' and call['dispatch_state']=='unknown'
            assert call['remote_outcome_known'] is False
            if phase=='body_revoke':assert call['error_class']=='MODEL_AUTHORIZATION_CHANGED'
        else:
            assert call['dispatch_state']=='sent' and call['remote_outcome_known'] is True
            assert call['status']==('completed' if phase=='success' else 'failed')
    assert 'private' not in str(report) and providers.providers['fixture'].dispatch_guard is None
    assert providers.providers['fixture'].dispatch_started is None
    assert done['state']==('succeeded' if phase=='success' else 'degraded')


@pytest.mark.parametrize('engine',['legacy','adaptive'])
def test_interrupted_run_can_be_cancelled_then_selected_plan_archived(factory,engine):
    actor=Actor(factory());dataset=actor.dataset();session=actor.conversation()
    other=actor.execute(good(actor.run(dataset,session),202))
    preview=plan(actor,dataset,session_id=session['id'],**({'execution':{}} if engine=='adaptive' else {}))
    run=good(approve(actor,preview),202);store=actor.client.app.state.store;worker=actor.client.app.state.worker
    with store.transaction() as db:
        db.execute("UPDATE runs SET state='running' WHERE id=?",(run['id'],))
    actor.client.portal.call(worker.start);actor.client.portal.call(worker.stop)
    interrupted=good(actor.get('/runs/'+run['id']))
    assert interrupted['state']=='interrupted'
    assert ('可显式继续' if engine=='adaptive' else '不支持断点继续') in interrupted['error']
    history=store.all('SELECT * FROM messages WHERE session_id=? ORDER BY id',(session['id'],))
    original_events=trace(actor,run);original_snapshot=interrupted['snapshot']
    archived=good(actor.get('/workspace/plans/'+preview['id']))
    endpoint='/workspace/archive/plan/'+preview['id']
    assert actor.delete(endpoint,params={'version':archived['version']}).status_code==409
    stranger=Actor(actor.client)
    assert stranger.post('/runs/'+run['id']+'/cancel').status_code==404
    assert stranger.delete(endpoint,params={'version':archived['version']}).status_code==404
    assert good(actor.get('/runs/'+run['id']))['state']=='interrupted'
    cancelled=good(actor.post('/runs/'+run['id']+'/cancel'))
    assert cancelled['state']=='cancelled' and cancelled['snapshot']==original_snapshot
    assert good(actor.post('/runs/'+run['id']+'/cancel'))==cancelled
    assert trace(actor,run)[:-1]==original_events
    assert actor.delete(endpoint,params={'version':archived['version']-1}).status_code==409
    assert actor.delete(endpoint).status_code==428
    good(actor.delete(endpoint,params={'version':archived['version']}))
    assert actor.get('/workspace/plans/'+preview['id']).status_code==404
    assert store.owned('conversations',actor.user['id'],session['id'])
    assert good(actor.get('/runs/'+other['id']))==other
    assert store.all('SELECT * FROM messages WHERE session_id=? ORDER BY id',(session['id'],))==history
    assert ws.verify_ledger(store,run['id'])['valid']


@pytest.mark.parametrize('engine',['legacy','adaptive'])
@pytest.mark.parametrize('boundary',['dns','body'])
@pytest.mark.parametrize('ending',['cancel','shutdown'])
def test_interrupted_or_cancelled_transport_is_never_reissued(factory,monkeypatch,boundary,ending,engine):
    actor,providers,preview,run,memory=prepared(factory,engine)
    entered=threading.Event();release=threading.Event();sent=[];lookups=[];sock=Socket()
    def dns(_):
        lookups.append(True)
        if boundary=='dns':entered.set();assert release.wait(5)
        return ['93.184.216.34']
    class Conn:
        status=200
        def __init__(self,*args):pass
        def request(self,*args):
            self.deadline.register(sock);self.deadline.before_send();sent.append(True)
        def getresponse(self):return self
        def read(self,*args):
            entered.set();assert sock.closed.wait(5);assert release.wait(5);return response()
        def close(self):sock.close()
    monkeypatch.setattr('server.providers.public_addresses',dns)
    monkeypatch.setattr('server.providers.PinnedHTTPS',Conn)
    worker=actor.client.app.state.worker;store=actor.client.app.state.store
    async def finished():
        async with asyncio.timeout(5):
            while worker.active or not slots_available(providers):await asyncio.sleep(.001)
    try:
        actor.client.portal.call(worker.start);assert entered.wait(5)
        if ending=='cancel':assert good(actor.post('/runs/'+run['id']+'/cancel'))['state']=='cancelled'
        else:actor.client.portal.call(worker.stop)
    finally:
        release.set();actor.client.portal.call(finished);actor.client.portal.call(worker.stop)
    stopped=good(actor.get('/runs/'+run['id']))
    assert stopped['state']==('cancelled' if ending=='cancel' else 'interrupted')
    assert stopped['result'] is None
    if engine=='legacy':
        outcome=next(e['payload'] for e in trace(actor,run) if e['type']=='external_call_result')
    else:
        call=store.one('SELECT * FROM adaptive_calls WHERE run_id=?',(run['id'],));outcome=call['payload']
        closed=next(e['payload'] for e in trace(actor,run) if e['type']=='external_call_closed')
        assert closed['payload_hash']==digest(outcome)
    assert outcome['dispatch_state']==('not_sent' if boundary=='dns' else 'unknown')
    assert outcome['dispatched'] is (boundary=='body')
    assert sent==([] if boundary=='dns' else [True]) and lookups==[True]
    if engine=='legacy':
        resumed=actor.post('/workspace/runs/'+run['id']+'/control',json={'action':'resume','version':1})
        assert resumed.status_code==409 and resumed.json()['error']['code']=='LEGACY_RUN'
        # Fail closed even if an external restore manually requeues the legacy row.
        with store.transaction() as db:db.execute("UPDATE runs SET state='queued' WHERE id=?",(run['id'],))
        restored=actor.execute(stopped)
        assert restored['state']=='failed' and lookups==[True]
    else:
        control=good(actor.get('/workspace/runs/'+run['id']+'/runtime'))['control']
        resumed=actor.post('/workspace/runs/'+run['id']+'/control',json={'action':'resume','version':control['version']})
        if ending=='cancel':
            assert resumed.status_code==409 and resumed.json()['error']['code']=='RUN_TERMINAL'
        else:
            assert resumed.status_code==200,resumed.text
            original=trace(actor,run)
            restored=actor.execute(stopped)
            assert restored['state']=='degraded' and restored['result']
            assert trace(actor,run)[:len(original)]==original
            assert store.one('SELECT * FROM adaptive_calls WHERE id=?',(call['id'],))==call
            assert restored['result']['memory_used']==([] if boundary=='dns' else [{'id':memory['id'],'version':memory['version']}])
            assert restored['result']['citation_ids_sent']==([] if boundary=='dns' else sorted(preview['payload']['packing']['included_citation_ids']))
    assert len([e for e in trace(actor,run) if e['type']=='external_call_reserved'])==1
    assert ws.verify_ledger(store,run['id'])['valid'] and lookups==[True]
