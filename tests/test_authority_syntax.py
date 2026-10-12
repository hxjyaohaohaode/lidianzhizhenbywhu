"""Reject malformed authority before downstream URL construction or routing."""
import asyncio
import httpx
import pytest
from server.app import Guard
from server.config import Settings


def authority_status(host):
    messages=[]
    async def app(scope,receive,send):
        await send({'type':'http.response.start','status':204,'headers':[]})
        await send({'type':'http.response.body','body':b''})
    async def receive():return {'type':'http.request','body':b'','more_body':False}
    async def send(message):messages.append(message)
    scope={'type':'http','method':'GET','path':'/','headers':[(b'host',host)],'scheme':'http','server':('testserver',80),'client':('127.0.0.1',1),'query_string':b''}
    asyncio.run(Guard(app,Settings())(scope,receive,send))
    return messages[0]['status']


@pytest.mark.parametrize('host',[b'example.com:abc',b'example.com:65536',b'example.com:-1',b'example.com:',b'example.com:80:90',b'example.com?x',b'example.com#x',b'[::1]:bad',b'[::1]:',b'[::1',b':80',b'\xff.test'])
def test_bad_authority_fails_closed(host):assert authority_status(host)==400


@pytest.mark.parametrize('host',[b'example.com',b'example.com:443',b'127.0.0.1:8000',b'[::1]',b'[::1]:8000',b'localhost'])
def test_valid_authority_syntax_remains_accepted(host):assert authority_status(host)==204


def test_bad_ports_rejected_by_real_http(tmp_path):
    from scripts.full_chain_check import ProductServer
    server=ProductServer(tmp_path/'data');server.start()
    try:
        with httpx.Client(base_url=server.base,trust_env=False,timeout=10) as client:
            for host in ['127.0.0.1:bad','127.0.0.1:65536','127.0.0.1:']:
                response=client.get('/api/health',headers={'Host':host})
                assert response.status_code==400 and response.json()['error']['code']=='INVALID_AUTHORITY'
            assert client.get('/api/health').status_code==200
    finally:server.stop()
