"""Real limiter clock/window and Guard protocol; synthetic data, no browser/provider."""
import asyncio
import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from server.app import Guard
from server.config import Settings
from server.security import RateLimiter


def test_original_window_boundary_and_refusals_do_not_extend_it():
    clock=[10.125];limiter=RateLimiter(clock=lambda:clock[0])
    assert limiter.check('client',2)==(True,0)
    clock[0]=10.625;assert limiter.check('client',2)==(True,0)
    clock[0]=69.124;assert limiter.check('client',2)==(False,2)
    clock[0]=69.125;assert limiter.check('client',2)==(False,1)
    clock[0]=70.124;assert limiter.check('client',2)==(False,1)
    assert list(limiter.keys['client'])==[10.125,10.625]
    clock[0]=70.125;assert limiter.check('client',2)==(True,0)
    assert list(limiter.keys['client'])==[10.625,70.125]
    assert limiter.check('client',2)==(False,1)
    clock[0]=70.625;assert limiter.allow('client',2)


def test_custom_window_and_changed_limit_wait_for_enough_expired_admissions():
    clock=[0.0];limiter=RateLimiter(clock=lambda:clock[0])
    for at in (0,1,2):
        clock[0]=at;assert limiter.allow('client',3,10)
    clock[0]=9.5;assert limiter.check('client',2,10)==(False,2)
    clock[0]=10;assert limiter.check('client',2,10)==(False,1)
    clock[0]=11;assert limiter.check('client',2,10)==(True,0)


def test_parallel_admission_keeps_original_600_budget_and_consistent_wait():
    limiter=RateLimiter(clock=lambda:15.25)
    with ThreadPoolExecutor(max_workers=12) as pool:
        decisions=list(pool.map(lambda _:limiter.check('client:api',600),range(660)))
    assert sum(d.allowed for d in decisions)==600
    assert all(d.retry_after==(0 if d.allowed else 60) for d in decisions)
    assert len(limiter.keys['client:api'])==600
    assert limiter.allow('client:login',30)
    assert limiter.allow('other:api',600)


def test_eviction_still_moves_recent_key_to_end():
    limiter=RateLimiter(2,clock=lambda:0)
    assert limiter.allow('a',1) and limiter.allow('b',1)
    assert limiter.check('a',1)==(False,60)
    assert limiter.allow('c',1)
    assert list(limiter.keys)==['a','c']


def guard_harness(tmp_path):
    clock=[100.25];accepted=[];body_reads=[]
    async def downstream(scope,receive,send):
        accepted.append((scope['method'],scope['path']))
        await send({'type':'http.response.start','status':200,'headers':[]})
        await send({'type':'http.response.body','body':b'{"ok":true}'})
    guard=Guard(downstream,Settings(data_dir=tmp_path,origin='http://testserver'))
    guard.limiter=RateLimiter(clock=lambda:clock[0])
    async def request(method='GET',path='/api/datasets',ip='local'):
        output=[]
        async def receive():
            body_reads.append((method,path))
            return {'type':'http.request','body':b'{}','more_body':False}
        async def send(message):output.append(message)
        scope={'type':'http','method':method,'path':path,'client':(ip,123),
               'headers':[(b'host',b'testserver'),(b'content-length',b'2')]}
        await guard(scope,receive,send)
        head=output[0];headers={k.decode():v.decode() for k,v in head['headers']}
        return head['status'],headers,json.loads(b''.join(x.get('body',b'') for x in output[1:]))
    return clock,accepted,body_reads,request


@pytest.mark.parametrize('path,limit',[('/api/datasets',600),('/api/auth/login',30)])
def test_real_guard_protocol_exact_limits_rounding_and_boundary(tmp_path,path,limit):
    clock,accepted,body_reads,request=guard_harness(tmp_path)
    async def exercise():
        for _ in range(limit):assert (await request(path=path))[0]==200
        for at,expected in ((100.25,60),(159.249,2),(159.25,1),(160.249,1)):
            clock[0]=at;status,headers,body=await request(path=path)
            assert status==429 and headers['retry-after']==str(expected)
            assert body['error']=={'code':'RATE_LIMITED','retry_after_seconds':expected,
                'message':f'请求过于频繁，本次请求已被暂时拒绝。请等待 {expected} 秒后再手动重试；期间其他请求可能占用可用名额。'}
            assert headers['x-request-id']==body['request_id']
            assert headers['cache-control']=='no-store' and headers['x-frame-options']=='DENY'
            assert headers['x-content-type-options']=='nosniff' and headers['referrer-policy']=='no-referrer'
            assert "default-src 'none'" in headers['content-security-policy']
            assert len(accepted)==limit
        clock[0]=160.25;status,headers,body=await request(path=path)
        assert status==200 and 'retry-after' not in headers and body=={'ok':True}
        assert len(accepted)==limit+1 and body_reads==[]
    asyncio.run(exercise())


def test_real_guard_separates_auth_client_and_non_api_without_rate_exemptions(tmp_path):
    _,accepted,_,request=guard_harness(tmp_path)
    async def exercise():
        for _ in range(600):assert (await request())[0]==200
        assert (await request())[0]==429
        for _ in range(30):assert (await request(path='/api/auth/me'))[0]==200
        assert (await request(path='/api/auth/me'))[0]==429
        assert (await request(ip='other'))[0]==200
        assert (await request(path='/assets/app.js'))[0]==200
        assert (await request())[0]==429
        assert len(accepted)==632
    asyncio.run(exercise())


@pytest.mark.parametrize('method',['POST','PUT','PATCH','DELETE'])
def test_refused_mutation_never_reads_body_dispatches_or_replays(tmp_path,method):
    clock,accepted,body_reads,request=guard_harness(tmp_path)
    async def exercise():
        for _ in range(600):assert (await request())[0]==200
        assert (await request(method=method))[0]==429
        assert len(accepted)==600 and not body_reads
        clock[0]=160.25
        # Advancing the clock and an explicit read never dispatch the refused write.
        assert (await request())[0]==200
        assert len(accepted)==601 and all(m=='GET' for m,_ in accepted) and not body_reads
        # Only a separate explicit write is admitted, once.
        assert (await request(method=method))[0]==200
        assert accepted[-1]==(method,'/api/datasets') and len(accepted)==602
        assert body_reads==[(method,'/api/datasets')]
    asyncio.run(exercise())


def test_full_app_rejected_write_leaves_business_store_unchanged(actor,example):
    node=actor.client.app.middleware_stack
    while not isinstance(node,Guard):node=node.app
    clock=[100.25];node.limiter=RateLimiter(clock=lambda:clock[0])
    for _ in range(600):assert actor.get('/datasets').status_code==200
    before=actor.client.app.state.store.one('SELECT count(*) AS n FROM audit')['n']
    refused=actor.post('/datasets',json={**example,'source_kind':'user_provided'})
    assert refused.status_code==429
    assert refused.headers['retry-after']=='60'
    assert refused.json()['error']['retry_after_seconds']==60
    assert actor.client.app.state.store.one('SELECT count(*) AS n FROM datasets')['n']==0
    assert actor.client.app.state.store.one('SELECT count(*) AS n FROM audit')['n']==before
    clock[0]=160.25
    assert actor.get('/datasets').json()['items']==[]
    assert actor.client.app.state.store.one('SELECT count(*) AS n FROM audit')['n']==before
