"""Raw ASGI admission tests; no outbound socket is involved in rejected paths."""
import asyncio
from types import SimpleNamespace
import pytest
from server.app import Guard

@pytest.mark.parametrize('path,headers',[
    ('/assets/\\\\outside.example\\share',[(b'host',b'testserver')]),
    ('//outside.example/share',[(b'host',b'testserver')]),
    ('/assets/C:/secrets',[(b'host',b'testserver')]),
    ('/assets/x\x00.txt',[(b'host',b'testserver')]),
    ('/api/health',[(b'host',b'testserver/evil')]),
    ('/api/health',[(b'host',b'testserver@evil')]),
    ('/api/health',[(b'host',b'testserver'),(b'host',b'other')]),
    ('/api/health',[(b'host',b'testserver\r\nx-header:x')]),
])
def test_rejected_before_app_and_filesystem(path,headers):
    called=[];messages=[]
    async def application(*args):called.append(True)
    async def receive():return {'type':'http.request','body':b''}
    async def send(message):messages.append(message)
    guard=Guard(application,SimpleNamespace(production=False))
    asyncio.run(guard({'type':'http','headers':headers,'path':path,'method':'GET','client':('127.0.0.1',1)},receive,send))
    assert not called and messages[0]['status']==400
    assert (b'x-content-type-options',b'nosniff') in messages[0]['headers']


def test_trustedhost_rejection_retains_admission_security_headers(actor):
    r=actor.client.get('/api/health',headers={'Host':'untrusted.example'})
    assert r.status_code==400 and r.headers['X-Content-Type-Options']=='nosniff'
