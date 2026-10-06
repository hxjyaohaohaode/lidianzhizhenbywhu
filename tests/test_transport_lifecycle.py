"""Deterministic transport boundary tests; no DNS, socket, or supplier calls."""
import asyncio
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from server.network import PinnedHTTPS, RequestDeadline
from server.providers import Provider, ProviderService


def provider():
    return Provider('fixture','provider.example','/chat','fixture','NOT-A-REAL-KEY')


def response():
    return json.dumps({'choices':[{'finish_reason':'stop','message':{'content':'{"claims":[],"missing":[]}'}}]}).encode()


async def until(predicate):
    async with asyncio.timeout(3):
        while not predicate():await asyncio.sleep(.001)


def slots_available(service, count=1):
    acquired=[]
    try:
        for _ in range(count):
            if not service._slots.acquire(blocking=False):return False
            acquired.append(True)
        return True
    finally:
        for _ in acquired:service._slots.release()


@pytest.mark.parametrize('finish',['cancel','timeout'])
def test_dns_outlives_waiter_but_cannot_send_and_retains_capacity(monkeypatch,finish):
    entered=threading.Event();release=threading.Event();calls=[]
    def dns(_):entered.set();assert release.wait(3);return ['93.184.216.34']
    class Conn:
        status=200
        def __init__(self,*args):pass
        def request(self,*args):calls.append(True)
        def getresponse(self):return self
        def read(self,*args):return response()
        def close(self):pass
    monkeypatch.setattr('server.providers.public_addresses',dns)
    monkeypatch.setattr('server.providers.PinnedHTTPS',Conn)
    service=ProviderService(timeout=.06 if finish=='timeout' else 2,max_inflight=1)
    async def run():
        task=asyncio.create_task(service.complete(provider(),'safe','{}'))
        try:
            await until(entered.is_set)
            if finish=='cancel':task.cancel()
            with pytest.raises(asyncio.CancelledError if finish=='cancel' else TimeoutError):await task
            assert not slots_available(service)
            with pytest.raises(ValueError,match='MODEL_TRANSPORT_BUSY'):await service.complete(provider(),'safe','{}')
            assert calls==[]
        finally:release.set()
        await until(lambda:slots_available(service))
        assert calls==[]
        # Capacity becomes reusable only after the actual old thread returns.
        assert (await service.complete(provider(),'safe','{}'))['output']['claims']==[]
        assert calls==[True]
    asyncio.run(run())


def test_cancellation_before_executor_starts_releases_only_when_wrapper_exits(monkeypatch):
    occupied=threading.Event();release=threading.Event();calls=[]
    service=ProviderService(max_inflight=1)
    monkeypatch.setattr(service,'_request',lambda *args:calls.append(True))
    def block():occupied.set();assert release.wait(3)
    async def run():
        asyncio.get_running_loop().set_default_executor(ThreadPoolExecutor(max_workers=1))
        blocker=asyncio.create_task(asyncio.to_thread(block));await until(occupied.is_set)
        task=asyncio.create_task(service.complete(provider(),'safe','{}'))
        await until(lambda:not slots_available(service))
        task.cancel()
        try:
            with pytest.raises(asyncio.CancelledError):await task
            assert not slots_available(service)
        finally:release.set()
        await blocker;await until(lambda:slots_available(service));assert calls==[]
    asyncio.run(run())


class Socket:
    def __init__(self):self.closed=threading.Event();self.shutdowns=0;self.sent=[]
    def settimeout(self,value):assert value>0
    def shutdown(self,how):self.shutdowns+=1;self.closed.set()
    def close(self):self.closed.set()
    def sendall(self,data):
        if self.closed.is_set():raise OSError('closed fixture socket')
        self.sent.append(data)


@pytest.mark.parametrize('finish',['cancel','timeout'])
def test_waiter_exit_interrupts_stalled_body_and_does_not_release_early(monkeypatch,finish):
    sock=Socket();entered=threading.Event();release=threading.Event();sent=[]
    class Conn:
        status=200
        def __init__(self,*args):pass
        def request(self,*args):self.deadline.register(sock);self.deadline.before_send();sent.append(True)
        def getresponse(self):return self
        def read(self,*args):
            entered.set();assert sock.closed.wait(3)
            # Deliberately delay cleanup to prove admission is not waiter-scoped.
            assert release.wait(3);return response()
        def close(self):sock.close()
    monkeypatch.setattr('server.providers.public_addresses',lambda _:['93.184.216.34'])
    monkeypatch.setattr('server.providers.PinnedHTTPS',Conn)
    service=ProviderService(timeout=.06 if finish=='timeout' else 2,max_inflight=1)
    async def run():
        task=asyncio.create_task(service.complete(provider(),'safe','{}'))
        try:
            await until(entered.is_set)
            if finish=='cancel':task.cancel()
            with pytest.raises(asyncio.CancelledError if finish=='cancel' else TimeoutError):await task
            assert sock.closed.is_set() and sock.shutdowns==1 and sent==[True]
            assert not slots_available(service)
        finally:release.set()
        await until(lambda:slots_available(service))
    asyncio.run(run())


def test_cancelled_connect_cannot_proceed_to_tls_or_http(monkeypatch):
    entered=threading.Event();release=threading.Event();sock=Socket();tls=[]
    def connect(*args):entered.set();assert release.wait(3);return sock
    class Context:
        def wrap_socket(self,*args,**kwargs):tls.append(True);return sock
    monkeypatch.setattr('server.network.socket.create_connection',connect)
    monkeypatch.setattr('server.network.ssl.create_default_context',lambda:Context())
    conn=PinnedHTTPS('provider.example','93.184.216.34',1);conn.deadline=RequestDeadline(1)
    async def run():
        task=asyncio.create_task(asyncio.to_thread(conn.connect))
        try:
            await until(entered.is_set);conn.deadline.stop()
        finally:release.set()
        with pytest.raises(TimeoutError):await task
        assert sock.closed.is_set() and tls==[] and sock.sent==[]
    asyncio.run(run())


@pytest.mark.parametrize('boundary',['tls','headers','body'])
def test_cancel_interrupts_each_registered_socket_phase(monkeypatch,boundary):
    sock=Socket();entered=threading.Event()
    class TLS(Socket):
        def do_handshake(self):
            if boundary=='tls':entered.set();assert self.closed.wait(3);raise OSError('stopped handshake')
    tls=TLS()
    class Context:
        def wrap_socket(self,*args,**kwargs):assert kwargs['do_handshake_on_connect'] is False;return tls
    monkeypatch.setattr('server.network.socket.create_connection',lambda *args:sock)
    monkeypatch.setattr('server.network.ssl.create_default_context',lambda:Context())
    conn=PinnedHTTPS('provider.example','93.184.216.34',1);conn.deadline=RequestDeadline(1)
    def work():
        conn.connect()
        if boundary!='tls':
            conn.send(b'headers' if boundary=='headers' else b'body')
            entered.set();assert tls.closed.wait(3)
    async def run():
        task=asyncio.create_task(asyncio.to_thread(work));await until(entered.is_set)
        conn.deadline.stop()
        if boundary=='tls':
            with pytest.raises(OSError):await task
        else:await task
        assert tls.closed.is_set() and tls.shutdowns==1
    asyncio.run(run())


def test_authorization_is_rechecked_after_dns_and_before_any_http(monkeypatch):
    p=provider();approved=[True];p.dispatch_guard=lambda:approved[0];sent=[]
    def dns(_):approved[0]=False;return ['93.184.216.34']
    class Conn:
        def __init__(self,*args):pass
        def request(self,*args):sent.append(True)
        def close(self):pass
    monkeypatch.setattr('server.providers.public_addresses',dns)
    monkeypatch.setattr('server.providers.PinnedHTTPS',Conn)
    with pytest.raises(ValueError,match='MODEL_AUTHORIZATION_CHANGED'):
        asyncio.run(ProviderService().complete(p,'safe','{}'))
    assert sent==[]


@pytest.mark.parametrize('already_sent',[False,True])
def test_authorization_recheck_after_tls_or_between_body_segments(monkeypatch,already_sent):
    sock=Socket();approved=[True]
    class TLS(Socket):
        def do_handshake(self):approved[0]=False
    tls=TLS()
    class Context:
        def wrap_socket(self,*args,**kwargs):return tls
    monkeypatch.setattr('server.network.socket.create_connection',lambda *args:sock)
    monkeypatch.setattr('server.network.ssl.create_default_context',lambda:Context())
    conn=PinnedHTTPS('provider.example','93.184.216.34',1)
    conn.deadline=RequestDeadline(1,lambda:approved[0]);conn.deadline.sent=already_sent
    try:
        with pytest.raises(ConnectionAbortedError if already_sent else ValueError,match='MODEL_AUTHORIZATION_CHANGED'):
            conn.send(b'private request')
        assert tls.sent==[]
    finally:conn.deadline.stop();conn.close()


def test_capacity_is_shared_across_providers_and_cancelled_dns_workers(monkeypatch):
    entered=[];release=threading.Event();sent=[]
    service=ProviderService(timeout=2,max_inflight=2)
    def dns(host):entered.append(host);assert release.wait(3);return ['93.184.216.34']
    monkeypatch.setattr('server.providers.public_addresses',dns)
    monkeypatch.setattr('server.providers.PinnedHTTPS',lambda *args:sent.append(True))
    async def run():
        tasks=[asyncio.create_task(service.complete(Provider(str(i),'p'+str(i)+'.example','/chat','m','fixture'),'safe','{}')) for i in range(2)]
        try:
            await until(lambda:len(entered)==2)
            for task in tasks:task.cancel()
            await asyncio.gather(*tasks,return_exceptions=True)
            with pytest.raises(ValueError,match='MODEL_TRANSPORT_BUSY'):await service.complete(provider(),'safe','{}')
            assert len(entered)==2
        finally:release.set()
        await until(lambda:slots_available(service,2));assert sent==[]
    asyncio.run(run())


@pytest.mark.parametrize('already_sent',[False,True])
@pytest.mark.parametrize('failure',[ValueError,RuntimeError])
def test_guard_exceptions_never_expose_details_or_assert_known_postsend_outcome(already_sent,failure):
    def guard():raise failure('private database and credential details')
    deadline=RequestDeadline(1,guard);deadline.sent=already_sent
    with pytest.raises(ConnectionAbortedError if already_sent else ValueError) as raised:
        deadline.before_send()
    assert str(raised.value)=='MODEL_AUTHORIZATION_CHANGED'


def test_repeated_local_authorization_failure_does_not_open_shared_provider_circuit(monkeypatch):
    service=ProviderService();p=provider()
    def fail(*args):raise ValueError('MODEL_AUTHORIZATION_CHANGED')
    monkeypatch.setattr(service,'_request',fail)
    async def run():
        for _ in range(5):
            with pytest.raises(ValueError,match='MODEL_AUTHORIZATION_CHANGED'):await service.complete(p,'safe','{}')
        assert service.failures=={} and service.open_until=={}
    asyncio.run(run())


def test_executor_rejection_before_worker_start_does_not_leak_admission(monkeypatch):
    service=ProviderService(max_inflight=1);requests=[]
    monkeypatch.setattr(service,'_request',lambda *args:requests.append(True))
    async def unavailable(*args):raise RuntimeError('fixture executor unavailable')
    monkeypatch.setattr(asyncio,'to_thread',unavailable)
    async def run():
        with pytest.raises(RuntimeError,match='executor unavailable'):await service.complete(provider(),'safe','{}')
        assert slots_available(service) and requests==[]
    asyncio.run(run())
