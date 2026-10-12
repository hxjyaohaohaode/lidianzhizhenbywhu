"""Independent ownership/session adverse cases; no live supplier calls."""
from conftest import Actor
from server.security import COOKIE
from server.store import digest
from test_services import connection,ok
from test_adaptive import preview


def test_other_owner_connection_cannot_reach_decryption_or_dispatch(actor,monkeypatch):
    own=ok(connection(actor),201);other=Actor(actor.client)
    def forbidden(*args):raise AssertionError('foreign connection decryption attempted')
    monkeypatch.setattr(actor.client.app.state.providers.vault,'_key',forbidden)
    p=preview(other,use_llm=True,provider=own['id'],max_calls=1)
    assert p['payload']['blockers'] and not p['payload'].get('provider_binding')
    response=other.post('/workspace/plans/'+p['id']+'/execute',json={
        'version':p['version'],'fingerprint':p['payload']['fingerprint'],'external_consent':True})
    assert response.status_code==409 and response.json()['error']['code']=='PLAN_BLOCKED'
    assert other.get('/runs').json()['items']==[]


def test_same_account_sessions_do_not_share_csrf(actor):
    response=actor.client.post('/api/auth/login',json={'email':actor.email,'password':actor.password})
    assert response.status_code==200;second=response.json();token=response.cookies[COOKIE]
    assert token!=actor.token and second['csrf']!=actor.csrf
    assert actor.post('/memories',json={'text':'合成会话边界'},headers={'X-CSRF-Token':second['csrf']}).status_code==403
    assert actor.client.post('/api/memories',json={'text':'合成会话边界'},headers={
        'Cookie':f'{COOKIE}={token}','X-CSRF-Token':actor.csrf}).status_code==403
    assert actor.post('/memories',json={'text':'第一会话授权'}).status_code==201
    assert actor.client.post('/api/memories',json={'text':'第二会话授权'},headers={
        'Cookie':f'{COOKIE}={token}','X-CSRF-Token':second['csrf']}).status_code==201


def test_session_limit_revokes_oldest_without_affecting_other_account(actor):
    other=Actor(actor.client);latest=None
    for _ in range(10):
        latest=actor.client.post('/api/auth/login',json={'email':actor.email,'password':actor.password})
        assert latest.status_code==200
    assert actor.get('/auth/me').status_code==401 and other.get('/auth/me').status_code==200
    store=actor.client.app.state.store
    assert store.one('SELECT count(*) n FROM auth_sessions WHERE user_id=?',(actor.user['id'],))['n']==10
    assert store.one('SELECT count(*) n FROM session_details WHERE user_id=?',(actor.user['id'],))['n']==10
    assert store.one('SELECT * FROM auth_sessions WHERE token_hash=?',(digest(actor.token),)) is None
    response=actor.client.get('/api/services/security',headers={'Cookie':f'{COOKIE}={latest.cookies[COOKIE]}'})
    assert response.status_code==200,response.text
    assert len(response.json()['sessions'])==10 and sum(r['current'] for r in response.json()['sessions'])==1
