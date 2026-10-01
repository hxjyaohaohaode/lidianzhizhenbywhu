"""Consent remains live after approval; provider doubles never access the network."""
import pytest
from conftest import Actor
from test_adaptive import ResearchProviders, preview, dispatch
from server import workspace_store as ws
from server.service_contracts import PrivateConnection


def prepare(factory, engine, mutation=None):
    providers=ResearchProviders()
    actor=Actor(factory(providers))
    dataset=actor.dataset()
    response=actor.post('/services/identities',json={
        'name':'核验身份','dataset_ids':[dataset['id']],
        'allow_external':True,'max_calls':3,'perspective':'investor'})
    assert response.status_code==201,response.text
    identity=response.json()
    vault=providers.vault
    spec=PrivateConnection(name='isolated fixture',base_url='https://models.test.example/v1',
        model='fixture',api_key='TEST-ONLY-KEY-INITIAL',password=actor.password)
    connection=vault.save(actor.user['id'],spec)
    def revoke():
        store=actor.client.app.state.store
        if mutation=='remove_identity':
            with store.transaction() as db:
                db.execute('DELETE FROM workspace_objects WHERE user_id=? AND id=?',(actor.user['id'],identity['id']))
        elif mutation=='lower_permission':
            with store.transaction() as db:
                ws.save(store,db,actor.user['id'],'identity',{**identity['payload'],'allow_external':False},
                    key=identity['natural_key'],expected=identity['version'])
        elif mutation=='rotate_key':
            vault.save(actor.user['id'],spec.model_copy(update={'version':1,'api_key':'TEST-ONLY-KEY-ROTATED'}),connection['id'])
        elif mutation=='remove_connection':
            vault.delete(actor.user['id'],connection['id'],connection['version'])
    plan=preview(actor,dataset,identity_id=identity['id'],use_llm=True,
        provider=connection['id'],max_calls=3,
        execution={'parallelism':1} if engine=='adaptive' else None)
    return actor,providers,dispatch(actor,plan),revoke


@pytest.mark.parametrize('engine',['legacy','adaptive'])
def test_private_connection_works_through_both_authorized_engines(factory,engine):
    actor,providers,run,_=prepare(factory,engine)
    result=actor.execute(run)
    assert result['result'],result
    assert len(providers.calls)>=1
    assert all(c['provider'].startswith('u_') for c in providers.calls)
    assert providers.calls[0]['context']['service_identity']['perspective']=='investor'


@pytest.mark.parametrize('engine',['legacy','adaptive'])
@pytest.mark.parametrize('mutation',['remove_identity','lower_permission','rotate_key','remove_connection'])
def test_revoked_queued_consent_never_dispatches_first_external_call(factory,engine,mutation):
    actor,providers,run,revoke=prepare(factory,engine,mutation)
    revoke()
    result=actor.execute(run)
    assert result['result'],result  # retain deterministic report rather than inventing AI output
    assert providers.calls==[]


@pytest.mark.parametrize('engine',['legacy','adaptive'])
@pytest.mark.parametrize('mutation',['remove_identity','lower_permission','rotate_key','remove_connection'])
def test_revocation_after_first_expert_blocks_later_external_calls(factory,engine,mutation):
    actor,providers,run,revoke=prepare(factory,engine,mutation)
    async def handler(p,system,context,count):
        if count==1:revoke()
        return {'output':{'claims':[{'text':'仍需核查原始输入','metric_ids':['gross_margin']}],'missing':[]},
                'provider':p.id,'model':p.model,'usage':{'total_tokens':8}}
    providers.handler=handler
    result=actor.execute(run)
    assert result['result'],result
    assert len(providers.calls)==1


@pytest.mark.parametrize('engine',['legacy','adaptive'])
@pytest.mark.parametrize('failure',['missing','malformed','mismatched','unreadable'])
def test_unusable_restored_key_retains_local_report_without_dispatch(factory,engine,failure,monkeypatch):
    from cryptography.fernet import Fernet
    from server.store import encode
    actor,providers,run,_=prepare(factory,engine)
    vault=providers.vault;vault._fernet=None
    if failure=='missing':vault.path.unlink()
    elif failure=='malformed':vault.path.write_bytes(b'test-only-invalid-key')
    elif failure=='mismatched':vault.path.write_bytes(Fernet.generate_key())
    else:
        def unreadable():raise PermissionError('TEST_PRIVATE_PATH_MUST_NOT_LEAK')
        monkeypatch.setattr(vault,'_read_key',unreadable)
    result=actor.execute(run)
    assert result['state']=='degraded' and result['result'],result
    assert result['result']['analysis']['metrics']['gross_margin'] is not None
    assert providers.calls==[] and result['result']['llm']['calls']==[]
    store=actor.client.app.state.store
    events=store.all('SELECT * FROM run_events WHERE run_id=?',(run['id'],))
    assert not any(e['type']=='external_dispatch' for e in events)
    assert store.all('SELECT * FROM adaptive_calls WHERE run_id=?',(run['id'],))==[]
    assert 'TEST_PRIVATE_PATH_MUST_NOT_LEAK' not in encode(result)+encode(events)
    assert 'TEST-ONLY-KEY-INITIAL' not in encode(result)+encode(events)
    if engine=='legacy':
        assert result['result']['llm']['unavailable_reason']=='CREDENTIALS_UNAVAILABLE'
        assert any('配对' in warning for warning in result['result']['warnings'])
        assert any(e['type']=='provider_unavailable' and e['payload']['dispatched'] is False for e in events)
    if failure=='missing':assert not vault.path.exists()


@pytest.mark.parametrize('engine',['legacy','adaptive'])
@pytest.mark.parametrize('mutation',['remove_identity','lower_permission','rotate_key','remove_connection'])
def test_real_transport_rechecks_consent_after_dns(factory,monkeypatch,engine,mutation):
    """Real ProviderService, isolated DNS/socket doubles, actual account revocation."""
    from server.providers import ProviderService
    actor,providers,run,revoke=prepare(factory,engine,mutation)
    monkeypatch.setattr(providers,'complete',lambda *args:ProviderService.complete(providers,*args))
    sent=[];lookups=[]
    def dns(_):
        lookups.append(True)
        if len(lookups)==1:revoke()
        return ['93.184.216.34']
    class Conn:
        def __init__(self,*args):pass
        def request(self,*args):sent.append(True);raise AssertionError('revoked request reached HTTP')
        def close(self):pass
    monkeypatch.setattr('server.providers.public_addresses',dns)
    monkeypatch.setattr('server.providers.PinnedHTTPS',Conn)
    result=actor.execute(run)
    assert result['result'] and result['state']=='degraded'
    assert sent==[] and len(lookups)==1
    assert providers.failures=={} and providers.open_until=={}
    if engine=='adaptive':
        calls=actor.get('/workspace/runs/'+run['id']+'/runtime').json()['calls']
        assert calls[0]['payload']['dispatched'] is False
        assert calls[0]['payload']['error_class']=='MODEL_AUTHORIZATION_CHANGED'
        assert result['result']['citation_ids_sent']==[] and result['result']['memory_used']==[]


@pytest.mark.parametrize('ending',['cancel','shutdown'])
def test_cancelled_real_dns_worker_never_sends_or_restores_unknown_call(factory,monkeypatch,ending):
    import asyncio
    import threading
    from server.providers import ProviderService
    from test_transport_lifecycle import slots_available
    actor,providers,run,_=prepare(factory,'adaptive')
    monkeypatch.setattr(providers,'complete',lambda *args:ProviderService.complete(providers,*args))
    entered=threading.Event();release=threading.Event();lookups=[];sent=[]
    def dns(_):lookups.append(True);entered.set();assert release.wait(5);return ['93.184.216.34']
    monkeypatch.setattr('server.providers.public_addresses',dns)
    class Conn:
        def __init__(self,*args):pass
        def request(self,*args):sent.append(True);raise AssertionError('cancelled request reached HTTP')
        def close(self):pass
    monkeypatch.setattr('server.providers.PinnedHTTPS',Conn)
    worker=actor.client.app.state.worker
    async def drained():
        async with asyncio.timeout(3):
            while not slots_available(providers,8):await asyncio.sleep(.001)
    try:
        actor.client.portal.call(worker.start)
        assert entered.wait(5)
        if ending=='cancel':assert actor.post('/runs/'+run['id']+'/cancel').json()['state']=='cancelled'
        else:actor.client.portal.call(worker.stop)
    finally:release.set()
    actor.client.portal.call(drained)
    actor.client.portal.call(worker.stop)
    result=actor.get('/runs/'+run['id']).json()
    assert result['result'] is None and sent==[] and lookups==[True]
    calls=actor.get('/workspace/runs/'+run['id']+'/runtime').json()['calls']
    assert calls and all(call['state']=='unknown' for call in calls)
    if ending=='shutdown':
        rt=actor.get('/workspace/runs/'+run['id']+'/runtime').json()
        response=actor.post('/workspace/runs/'+run['id']+'/control',json={'version':rt['control']['version'],'action':'resume'})
        assert response.status_code==200,response.text
        # Prevent other previously unstarted model nodes from dispatching, while
        # proving the reserved unknown node is reused rather than paid again.
        providers.vault.delete(actor.user['id'],run['payload']['provider'],1)
        restored=actor.execute(actor.get('/runs/'+run['id']).json())
        assert restored['state']=='degraded' and restored['result']
        assert sent==[] and lookups==[True]
        events=actor.get('/runs/'+run['id']+'/trace').json()['items']
        assert any(e['type']=='unknown_call_not_repeated' for e in events)


def test_concurrent_accounts_do_not_share_dispatch_guards(factory,monkeypatch):
    import asyncio
    import json
    import threading
    from server.providers import Provider,ProviderService
    from conftest import editable
    from test_transport_lifecycle import response
    providers=ProviderService();shared=Provider('alpha','provider.example','/chat','fixture','FIXTURE')
    providers.providers={'alpha':shared}
    client=factory(providers);first=Actor(client);second=Actor(client)
    data1=first.dataset();data2=second.dataset()
    runs=[dispatch(a,preview(a,d,use_llm=True,provider='alpha',max_calls=2,
          query=q,execution={'parallelism':1,'max_revisions':0}))
          for a,d,q in [(first,data1,'核查甲账户现金变化'),(second,data2,'核查乙账户现金变化')]]
    entered=threading.Event();release=threading.Event();lookups=[];sent=[]
    def dns(_):
        lookups.append(True)
        if len(lookups)>=2:entered.set()
        assert release.wait(5);return ['93.184.216.34']
    class Conn:
        status=200
        def __init__(self,*args):pass
        def request(self,method,path,body,headers):
            self.deadline.before_send()
            sent.append(json.loads(json.loads(body)['messages'][1]['content'])['question'])
        def getresponse(self):return self
        def read(self,*args):return response()
        def close(self):pass
    monkeypatch.setattr('server.providers.public_addresses',dns)
    monkeypatch.setattr('server.providers.PinnedHTTPS',Conn)
    worker=client.app.state.worker
    async def finished():
        async with asyncio.timeout(5):
            while worker.active:await asyncio.sleep(.001)
    try:
        client.portal.call(worker.start);assert entered.wait(5)
        body=editable(data1);body['periods'][-1]['revenue']+=1
        assert first.put('/datasets/'+data1['id'],json=body).status_code==200
        release.set();client.portal.call(finished)
    finally:
        release.set();client.portal.call(worker.stop)
    a=first.get('/runs/'+runs[0]['id']).json();b=second.get('/runs/'+runs[1]['id']).json()
    assert a['state']=='degraded' and b['state']=='succeeded'
    assert sent and all(q=='核查乙账户现金变化' for q in sent)
    assert shared.dispatch_guard is None and providers.open_until=={}
    assert first.get('/runs/'+runs[1]['id']).status_code==404
