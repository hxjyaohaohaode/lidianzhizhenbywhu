import json
import pytest
from server.security import COOKIE,password_hash,password_matches,RateLimiter
from server.store import digest
from server.app import ProcessLock
from server.config import Settings
from conftest import Actor,PASSWORD,editable

@pytest.mark.parametrize('path',['/datasets','/memories','/evidence','/conversations','/runs','/ops','/sync','/capabilities','/account/export'])
def test_anonymous_private_endpoints_denied(client,path):assert client.get('/api'+path,headers={'Cookie':''}).status_code==401
def test_password_salt_and_invalid_encoding():
    a=password_hash(PASSWORD);b=password_hash(PASSWORD)
    assert a!=b and PASSWORD not in a and password_matches(PASSWORD,a)
    assert not password_matches('incorrect',a)
    for invalid in ['','abc$def','wrong$00$bad','scrypt$nothex$bad']:assert not password_matches(PASSWORD,invalid)
def test_cookie_and_secret_boundaries(actor,client):
    assert actor.user['email']==actor.email and 'password_hash' not in actor.user
    row=client.app.state.store.one('SELECT * FROM auth_sessions WHERE user_id=?',(actor.user['id'],))
    assert row['token_hash']==digest(actor.token) and actor.token not in json.dumps(row)
    r=actor.get('/auth/me');assert r.status_code==200 and r.json()['csrf']==actor.csrf
    login=client.post('/api/auth/login',json={'email':actor.email,'password':PASSWORD});cookie=login.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=strict' in cookie
    assert 'unsafe-inline' not in r.headers['content-security-policy']
    assert r.headers['x-content-type-options']=='nosniff' and 'no-store' in r.headers['cache-control'] and r.headers['x-request-id']
def test_login_new_session_and_invalid_credentials(actor,client):
    wrong=client.post('/api/auth/login',json={'email':actor.email,'password':'bad'});assert wrong.status_code==401 and PASSWORD not in wrong.text
    ok=client.post('/api/auth/login',json={'email':actor.email.upper(),'password':PASSWORD});assert ok.status_code==200 and ok.cookies[COOKIE]!=actor.token
def test_csrf_origin_crosssite_and_forged_internal_headers(actor):
    for headers in [{'X-CSRF-Token':''},{'X-CSRF-Token':'bad'},{'Origin':'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}]:assert actor.post('/examples/dataset',headers=headers).status_code==403
    assert actor.post('/examples/dataset',headers={'Origin':'http://testserver'}).status_code==410
    assert actor.client.get('/api/datasets',headers={'Cookie':'','X-Platform-Access':'internal','X-Forwarded-For':'127.0.0.1'}).status_code==401
    assert actor.get('/datasets',headers={'Host':'attacker.example'}).status_code==400
def test_expired_logout_revoked(actor,client):
    assert actor.post('/auth/logout').status_code==200 and actor.get('/auth/me').status_code==401
    b=Actor(client)
    with client.app.state.store.transaction() as db:db.execute('UPDATE auth_sessions SET expires=0 WHERE user_id=?',(b.user['id'],))
    assert b.get('/datasets').status_code==401
def test_password_change_revokes_all_sessions(actor,client):
    login=client.post('/api/auth/login',json={'email':actor.email,'password':PASSWORD});token=login.cookies[COOKIE]
    assert actor.post('/auth/password',json={'current_password':PASSWORD,'new_password':'Replacement-password-123'}).status_code==200
    assert actor.get('/datasets').status_code==401
    assert client.get('/api/datasets',headers={'Cookie':f'{COOKIE}={token}'}).status_code==401
    assert client.post('/api/auth/login',json={'email':actor.email,'password':PASSWORD}).status_code==401
def test_validation_does_not_echo_password(client):
    secret='shortsecret';r=client.post('/api/auth/register',json={'email':'not-email','password':secret,'name':'ok'})
    assert r.status_code==422 and secret not in r.text
    assert client.post('/api/auth/login',json={'email':'user@example.com','password':'wrong','user_id':'admin'}).status_code==422
def test_rate_limiter_bounds_and_eviction():
    l=RateLimiter(2);assert l.allow('a',2) and l.allow('a',2) and not l.allow('a',2)
    assert l.allow('b',2) and l.allow('c',2) and len(l.keys)==2
def test_auth_route_rate_limit(client):assert [client.post('/api/auth/login',json={}).status_code for _ in range(31)][-1]==429
def test_body_limit_enforced_before_parser(actor):assert actor.post('/datasets',content=b'x'*2010000,headers={'Content-Type':'application/json'}).status_code==413
@pytest.mark.parametrize('resource',['datasets','evidence','memories','conversations','runs'])
def test_cross_user_objects_and_writes_isolated(actor,client,resource):
    a=actor;b=Actor(client);d=a.dataset();s=a.conversation();r=a.run(d,s).json()
    ev=a.post('/evidence',json={'title':'私有证据','text':'这是只有甲账户能读取的经营资料。'*5}).json();mem=a.post('/memories',json={'text':'甲的私有记忆'}).json()
    id={'datasets':d,'conversations':s,'runs':r,'evidence':ev,'memories':mem}[resource]['id'];assert b.get('/'+resource).json()['items']==[]
    if resource=='datasets':
        for suffix in ('','/analysis','/export'):assert b.get('/datasets/'+id+suffix).status_code==404
        assert b.put('/datasets/'+id,json=editable(d)).status_code==404 and b.delete('/datasets/'+id).status_code==404
    if resource=='runs':
        for suffix in ('','/trace','/events','/export'):assert b.get('/runs/'+id+suffix).status_code==404
        assert b.post('/runs/'+id+'/cancel').status_code==404
        assert b.post('/feedback',json={'run_id':id,'rating':'useful'}).status_code==404
    if resource=='conversations':
        assert b.get('/conversations/'+id+'/messages').status_code==404 and b.delete('/conversations/'+id).status_code==404
    if resource in ('evidence','memories'):assert b.delete('/'+resource+'/'+id).status_code==404
    own=b.dataset();own_s=b.conversation();assert b.run(d,own_s).status_code==404 and b.run(own,s).status_code==404
    export=b.get('/account/export').text;assert '甲的私有记忆' not in export and '只有甲账户' not in export
    assert all(x['user_id']==b.user['id'] for x in b.get('/sync').json()['items'])
def test_optimistic_conflict_does_not_overwrite(actor):
    row=actor.dataset();body=editable(row);body['name']='第二版';assert actor.put('/datasets/'+row['id'],json=body).json()['version']==2
    body['name']='陈旧修改';assert actor.put('/datasets/'+row['id'],json=body).status_code==409
    assert actor.get('/datasets/'+row['id']).json()['payload']['name']=='第二版'
    prefs={'name':'新名称','version':actor.user['version'],**actor.user['preferences']}
    assert actor.put('/preferences',json=prefs).status_code==200 and actor.put('/preferences',json=prefs).status_code==409
def test_backup_no_credentials(actor):
    actor.dataset();r=actor.get('/account/export')
    assert r.status_code==200 and 'attachment' in r.headers['content-disposition']
    assert PASSWORD not in r.text and actor.token not in r.text and 'password_hash' not in r.text
    assert len(r.json()['data']['datasets'])==1
def test_referenced_dataset_deletion_guard_and_account_cascade(actor,client):
    d=actor.dataset();s=actor.conversation();actor.execute(actor.run(d,s).json())
    assert actor.delete('/datasets/'+d['id'],params={'version':d['version']}).status_code==409
    assert actor.delete('/account',json={'email':actor.email,'password':'wrong'}).status_code==401
    assert actor.delete('/account',json={'email':actor.email,'password':PASSWORD}).status_code==200
    db=client.app.state.store
    for table in ('users','datasets','conversations','runs','run_events','messages','auth_sessions','audit'):assert db.one(f'SELECT count(*) AS n FROM {table}')['n']==0
    assert actor.get('/auth/me').status_code==401
def test_production_failclosed(tmp_path):
    with pytest.raises(RuntimeError):Settings(data_dir=tmp_path,production=True,origin='http://localhost').validate()
    with pytest.raises(RuntimeError):Settings(data_dir=tmp_path,production=True,origin='https://example.com',invite_code='short').validate()
    Settings(data_dir=tmp_path,production=True,origin='https://example.com',invite_code='A-secure-code-long-enough').validate()
def test_single_process_lock(tmp_path):
    a=ProcessLock(tmp_path/'lock');b=ProcessLock(tmp_path/'lock');a.acquire()
    try:
        with pytest.raises(RuntimeError):b.acquire()
    finally:a.release()
    b.acquire();b.release()


def test_unicode_invalid_invitation_returns_403(factory):
    client=factory(invite_code='private-registration-code')
    response=client.post('/api/auth/register',json={'email':'unicode@example.com','password':'valid-password-123','name':'test','invitation':'无效中文邀请码'})
    assert response.status_code==403

def test_nonascii_csrf_does_not_raise_500(actor):
    response=actor.post('/examples/dataset',headers={'X-CSRF-Token':b'\xe9'})
    assert response.status_code==403
