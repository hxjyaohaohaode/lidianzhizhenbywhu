"""Public network lifetime tests: synthetic barriers/sockets, never live DNS or providers."""
import asyncio
import importlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import pytest
from server.network import PublicRequests, PinnedHTTPS, NetworkRejected, public_request_deadline
from server.schemas import SearchRequest


def available(pool):
    if not pool._slots.acquire(blocking=False):return False
    pool._slots.release();return True


async def until(predicate):
    async with asyncio.timeout(3):
        while not predicate():await asyncio.sleep(.001)


def compress_api_wait(monkeypatch):
    original=asyncio.wait_for
    async def bounded(awaitable,timeout):return await original(awaitable,timeout=.04 if timeout in (12,15) else timeout)
    monkeypatch.setattr(asyncio,'wait_for',bounded)


def wire(monkeypatch,kind,dns,*,failure=False):
    module=importlib.import_module('server.research' if kind=='search' else 'server.network');calls=[]
    class Conn:
        status=200
        def __init__(self,*args):pass
        def request(self,*args,**kwargs):
            self.deadline.before_send();calls.append(args[0])
            if failure:raise ValueError('synthetic upstream error must not be echoed')
        def getresponse(self):return self
        def getheader(self,name,default=''):return {'Content-Type':'text/plain','Content-Encoding':'identity'}.get(name,default)
        def read(self,*args):return b'{"results":[],"usage":{"credits":1}}' if kind=='search' else b'Synthetic evidence document. '*10
        def close(self):pass
    monkeypatch.setattr(module,'public_addresses',dns);monkeypatch.setattr(module,'PinnedHTTPS',Conn)
    return calls


def submit(actor,kind):
    actor.client.app.state.research.key='SYNTHETIC-NOT-A-REAL-KEY'
    if kind=='search':return actor.post('/research/search',json={'query':'synthetic revenue','consent':True})
    return actor.post('/evidence/fetch',json={'url':'https://www.cninfo.com.cn/synthetic','title':'Synthetic'})


def audit(actor):return actor.client.app.state.store.all("SELECT * FROM audit WHERE resource='research' ORDER BY seq")


@pytest.mark.parametrize('kind',['search','fetch'])
def test_api_timeout_stops_late_dns_send_and_holds_shared_admission(actor,monkeypatch,kind):
    entered=threading.Event();release=threading.Event();exited=threading.Event()
    def dns(_):
        entered.set()
        try:assert release.wait(3);return ['93.184.216.34']
        finally:exited.set()
    calls=wire(monkeypatch,kind,dns);pool=actor.client.app.state.public_requests=PublicRequests(1)
    compress_api_wait(monkeypatch)
    try:
        response=submit(actor,kind)
        assert entered.is_set() and response.status_code==502
        assert calls==[] and not available(pool)
        assert submit(actor,'fetch' if kind=='search' else 'search').status_code==502
        assert calls==[] and not available(pool)
    finally:release.set()
    actor.client.portal.call(until,lambda:available(pool))
    assert exited.is_set() and calls==[]
    if kind=='search':
        events=audit(actor)
        assert [e['action'] for e in events]==['reserved','failed']
        assert events[-1]['metadata']['dispatch_state']=='not_sent'
        assert events[-1]['metadata']['remote_outcome_known'] is True


@pytest.mark.parametrize('kind',['search','fetch'])
def test_success_keeps_api_transport_ceilings_and_functionality(actor,monkeypatch,kind):
    calls=wire(monkeypatch,kind,lambda _:['93.184.216.34']);pool=actor.client.app.state.public_requests;original=pool.run;ceilings=[]
    async def inspect(*args,**kwargs):
        ceilings.append((kwargs['transport_timeout'],kwargs['api_timeout']));return await original(*args,**kwargs)
    monkeypatch.setattr(pool,'run',inspect);response=submit(actor,kind)
    assert response.status_code==(200 if kind=='search' else 201),response.text
    assert ceilings==([(12,15)] if kind=='search' else [(8,12)]) and calls==(['POST'] if kind=='search' else ['GET'])
    if kind=='search':
        events=audit(actor)
        assert [e['action'] for e in events]==['reserved','dispatched','completed']
        assert events[1]['metadata']['remote_outcome_known'] is False and events[-1]['metadata']['dispatch_state']=='sent'
        assert 'synthetic revenue' not in json.dumps(events)
    else:assert response.json()['payload']['verification']=='fetched_not_fact_checked'


def test_attempted_search_failure_is_unknown_and_not_retried(actor,monkeypatch):
    calls=wire(monkeypatch,'search',lambda _:['93.184.216.34'],failure=True);response=submit(actor,'search')
    assert response.status_code==502 and calls==['POST'] and '未知' in response.json()['error']['message']
    assert 'synthetic upstream' not in response.text
    events=audit(actor)
    assert [e['action'] for e in events]==['reserved','dispatched','failed']
    assert events[-1]['metadata']['dispatch_state']=='unknown' and events[-1]['metadata']['remote_outcome_known'] is False
    assert actor.get('/evidence').json()['items']==[]


@pytest.mark.parametrize('already_sent',[False,True])
def test_cancelled_search_propagates_and_audits_exact_boundary(actor,monkeypatch,already_sent):
    entered=threading.Event();release=threading.Event();calls=[]
    def search(query):
        if already_sent:public_request_deadline(12).before_send();calls.append(True)
        entered.set();assert release.wait(3)
        public_request_deadline(12).before_send();calls.append(True)
    actor.client.app.state.research=SimpleNamespace(status=lambda:{'configured':True},search=search)
    endpoint=next(r.endpoint for r in actor.client.app.routes if getattr(r,'path','')=='/api/research/search')
    pool=actor.client.app.state.public_requests=PublicRequests(1)
    async def run():
        task=asyncio.create_task(endpoint(SearchRequest(query='synthetic query',consent=True),SimpleNamespace(app=actor.client.app),actor.user))
        try:
            await until(entered.is_set);task.cancel()
            with pytest.raises(asyncio.CancelledError):await task
            assert not available(pool)
        finally:release.set()
        await until(lambda:available(pool))
    actor.client.portal.call(run)
    assert calls==([True] if already_sent else [])
    events=audit(actor)
    assert events[-1]['action']=='cancelled' and events[-1]['metadata']['dispatched'] is already_sent
    assert events[-1]['metadata']['dispatch_state']==('unknown' if already_sent else 'not_sent')


@pytest.mark.parametrize('kind',['search','fetch'])
def test_cancelled_dns_worker_cannot_send_or_release_capacity_early(monkeypatch,kind):
    entered=threading.Event();release=threading.Event();pool=PublicRequests(1)
    def dns(_):entered.set();assert release.wait(3);return ['93.184.216.34']
    calls=wire(monkeypatch,kind,dns)
    if kind=='search':
        from server.research import PublicResearch
        search=PublicResearch(('www.cninfo.com.cn',));search.key='SYNTHETIC';function,args=search.search,('synthetic query',)
    else:
        from server.network import fetch_public
        function,args=fetch_public,('https://www.cninfo.com.cn/synthetic',('www.cninfo.com.cn',))
    async def run():
        task=asyncio.create_task(pool.run(function,*args,transport_timeout=2,api_timeout=3))
        try:
            await until(entered.is_set);task.cancel()
            with pytest.raises(asyncio.CancelledError) as raised:await task
            assert raised.value.dispatched is False and not available(pool)
            with pytest.raises(NetworkRejected,match='PUBLIC_TRANSPORT_BUSY'):await pool.run(lambda:None,transport_timeout=2,api_timeout=3)
        finally:release.set()
        await until(lambda:available(pool));assert calls==[]
    asyncio.run(run())


class Socket:
    def __init__(self):self.closed=threading.Event();self.sent=[];self.shutdowns=0
    def settimeout(self,value):assert value>0
    def close(self):self.closed.set()
    def shutdown(self,how):self.shutdowns+=1;self.closed.set()
    def sendall(self,data):
        if self.closed.is_set():raise OSError('synthetic closed socket')
        self.sent.append(data)


@pytest.mark.parametrize('phase',['tls','headers','body'])
@pytest.mark.parametrize('finish',['cancel','timeout'])
def test_socket_phases_interrupted_and_transport_total_bounded(monkeypatch,phase,finish):
    entered=threading.Event();raw=Socket();tls=Socket();pool=PublicRequests(1);starts=[]
    def block():entered.set();assert tls.closed.wait(3);raise OSError('synthetic stopped socket')
    tls.do_handshake=block if phase=='tls' else lambda:None
    class Context:
        def wrap_socket(self,sock,**kwargs):
            assert sock is raw and kwargs['server_hostname']=='www.cninfo.com.cn';return tls
    class Response:
        status=200
        def getheader(self,name,default=''):return {'Content-Type':'text/plain','Content-Encoding':'identity'}.get(name,default)
        def read(self,*args):return block()
    monkeypatch.setattr('server.network.public_addresses',lambda _:['93.184.216.34'])
    monkeypatch.setattr('server.network.socket.create_connection',lambda *args:raw)
    monkeypatch.setattr('server.network.ssl.create_default_context',lambda:Context())
    monkeypatch.setattr(PinnedHTTPS,'getresponse',lambda self:block() if phase=='headers' else Response())
    from server.network import fetch_public
    async def run():
        task=asyncio.create_task(pool.run(fetch_public,'https://www.cninfo.com.cn/a',('www.cninfo.com.cn',),transport_timeout=.06 if finish=='timeout' else 2,api_timeout=3,on_send=lambda:starts.append(True)))
        try:
            await until(entered.is_set)
            if finish=='cancel':task.cancel()
            with pytest.raises(asyncio.CancelledError if finish=='cancel' else TimeoutError) as raised:await task
            assert raised.value.dispatched is (phase!='tls') and tls.closed.is_set() and tls.shutdowns==1
        finally:tls.close()
        await until(lambda:available(pool));assert starts==([] if phase=='tls' else [True])
    asyncio.run(run())


def test_never_started_cancelled_waiter_holds_slot_until_wrapper_exits():
    occupied=threading.Event();release=threading.Event();calls=[];pool=PublicRequests(1)
    def block():occupied.set();assert release.wait(3)
    async def run():
        asyncio.get_running_loop().set_default_executor(ThreadPoolExecutor(max_workers=1))
        blocker=asyncio.create_task(asyncio.to_thread(block));await until(occupied.is_set)
        task=asyncio.create_task(pool.run(lambda:calls.append(True),transport_timeout=2,api_timeout=3))
        try:
            await until(lambda:not available(pool));task.cancel()
            with pytest.raises(asyncio.CancelledError):await task
            assert not available(pool)
        finally:release.set()
        await blocker;await until(lambda:available(pool));assert calls==[]
        assert await pool.run(lambda:'fresh',transport_timeout=2,api_timeout=3)=='fresh'
    asyncio.run(run())


def test_executor_scheduling_failure_releases_slot_once(monkeypatch):
    pool=PublicRequests(1);calls=[]
    async def unavailable(*args):raise RuntimeError('synthetic executor unavailable')
    async def run():
        with monkeypatch.context() as patch:
            patch.setattr(asyncio,'to_thread',unavailable)
            with pytest.raises(RuntimeError,match='executor unavailable'):await pool.run(lambda:calls.append(True),transport_timeout=2,api_timeout=3)
        assert available(pool) and calls==[]
        assert await pool.run(lambda:'fresh',transport_timeout=2,api_timeout=3)=='fresh'
    asyncio.run(run())


def test_task_creation_failure_releases_slot_without_starting_or_leaking_coroutine(monkeypatch):
    pool=PublicRequests(1);calls=[]
    def unavailable(*args):raise RuntimeError('synthetic task scheduling unavailable')
    async def run():
        with monkeypatch.context() as patch:
            patch.setattr(asyncio,'create_task',unavailable)
            with pytest.raises(RuntimeError,match='task scheduling unavailable'):
                await pool.run(lambda:calls.append(True),transport_timeout=2,api_timeout=3)
        assert available(pool) and calls==[]
        assert await pool.run(lambda:'fresh',transport_timeout=2,api_timeout=3)=='fresh'
    asyncio.run(run())


def test_default_shared_capacity_is_exactly_eight():
    pool=PublicRequests();held=[]
    try:
        for _ in range(8):assert pool._slots.acquire(blocking=False);held.append(True)
        assert not pool._slots.acquire(blocking=False)
    finally:
        for _ in held:pool._slots.release()
