"""Portable export completeness and credential-check/commit race regressions."""
import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import pytest
from fastapi import HTTPException, Response
from conftest import Actor, PASSWORD
from server.security import issue_session, password_hash, RateLimiter
from server.store import digest
from server import workspace_store as ws


def test_export_includes_workbench_and_execution_records_without_secrets(actor):
    dataset=actor.dataset()
    run=actor.execute(actor.run(dataset).json())
    identity=actor.post('/services/identities',json={'name':'导出中的研究身份'}).json()
    thread=actor.post('/services/threads',json={'identity_id':identity['id'],'dataset_id':dataset['id']}).json()
    sent=actor.post('/services/threads/'+thread['id']+'/messages',json={
        'text':'毛利率如何核对？','version':thread['version'],'request_id':'export-message-01'})
    assert sent.status_code==201,sent.text
    store=actor.client.app.state.store
    with store.transaction() as db:
        ws.save(store,db,actor.user['id'],'action',{'title':'保留真实跟进行动'})
    result=actor.get('/account/export')
    assert result.status_code==200,result.text
    export=result.json();data=export['data']
    assert export['format']=='lidian-user-export-v4'
    assert {r['kind'] for r in data['workspace_objects']} >= {'identity','assistant_thread','action'}
    assert len(data['copilot_messages'])==1
    assert len(data['dataset_revisions'])==1
    assert data['run_events'] and data['event_integrity']
    assert {r['run_id'] for r in data['run_events']}=={run['id']}
    for name,rows in data.items():
        assert export['manifest'][name]=={'count':len(rows),'sha256':digest(rows)}
    for secret in ('password_hash','token_hash','"cipher"',actor.token,actor.csrf,PASSWORD):
        assert secret not in result.text


def test_export_extension_tables_are_owner_scoped(actor):
    other=Actor(actor.client)
    store=actor.client.app.state.store
    with store.transaction() as db:
        ws.save(store,db,actor.user['id'],'action',{'title':'account-a-only'})
    actor.execute(actor.run().json())
    exported=other.get('/account/export').json()
    assert 'account-a-only' not in json.dumps(exported)
    for name in ('workspace_objects','dataset_revisions','run_events','event_integrity','agent_artifacts','adaptive_calls'):
        assert exported['data'][name]==[]


def test_login_cannot_mint_session_from_stale_password_check(actor):
    store=actor.client.app.state.store
    stale=store.one('SELECT * FROM users WHERE id=?',(actor.user['id'],))
    with store.transaction() as db:
        db.execute('UPDATE users SET password_hash=? WHERE id=?',(password_hash('changed-password-12345'),actor.user['id']))
    request=SimpleNamespace(app=actor.client.app,headers={})
    before=store.one('SELECT count(*) AS n FROM auth_sessions')['n']
    with pytest.raises(HTTPException) as error:
        issue_session(request,Response(),stale)
    assert error.value.detail['code']=='CREDENTIALS_CHANGED'
    assert store.one('SELECT count(*) AS n FROM auth_sessions')['n']==before


@pytest.mark.parametrize('endpoint', ['/auth/password','/account'])
def test_password_recheck_at_mutation_prevents_stale_authorization(actor,monkeypatch,endpoint):
    import server.app as module
    store=actor.client.app.state.store
    original=module.password_matches
    replacement=password_hash('concurrently-changed-password-123')
    def race(password,stored):
        valid=original(password,stored)
        with store.transaction() as db:
            db.execute('UPDATE users SET password_hash=? WHERE id=?',(replacement,actor.user['id']))
        return valid
    monkeypatch.setattr(module,'password_matches',race)
    if endpoint=='/account':
        result=actor.delete(endpoint,json={'email':actor.email,'password':PASSWORD})
    else:
        result=actor.post(endpoint,json={'current_password':PASSWORD,'new_password':'replacement-password-456'})
    assert result.status_code==409,result.text
    assert store.one('SELECT password_hash FROM users WHERE id=?',(actor.user['id'],))['password_hash']==replacement


def test_rate_limit_is_atomic_across_request_threads():
    limiter=RateLimiter()
    with ThreadPoolExecutor(max_workers=16) as pool:
        allowed=list(pool.map(lambda _:limiter.allow('same-account',7),range(100)))
    assert sum(allowed)==7


@pytest.mark.parametrize('endpoint',['/auth/password','/account'])
def test_sensitive_mutation_rechecks_exact_session_after_password_hashing(actor,monkeypatch,endpoint):
    import server.app as module
    store=actor.client.app.state.store
    original=module.password_matches
    old_hash=store.one('SELECT password_hash FROM users WHERE id=?',(actor.user['id'],))['password_hash']
    def revoke_while_verifying(password,stored):
        valid=original(password,stored)
        with store.transaction() as db:
            db.execute('DELETE FROM auth_sessions WHERE token_hash=?',(digest(actor.token),))
        return valid
    monkeypatch.setattr(module,'password_matches',revoke_while_verifying)
    if endpoint=='/account':
        result=actor.delete(endpoint,json={'email':actor.email,'password':PASSWORD})
    else:
        result=actor.post(endpoint,json={'current_password':PASSWORD,'new_password':'replacement-password-456'})
    assert result.status_code==401,result.text
    assert store.one('SELECT password_hash FROM users WHERE id=?',(actor.user['id'],))['password_hash']==old_hash


def test_workspace_export_preserves_legacy_envelope_with_v4_manifest(actor):
    actor.dataset()
    exported=actor.get('/workspace/export')
    assert exported.status_code==200,exported.text
    payload=exported.json()
    assert payload['format']=='lidian-workspace-export' and payload['export_version']==4
    assert payload['dataset_revisions']==payload['data']['dataset_revisions']
    assert payload['assistant_messages']==payload['data']['copilot_messages']
    assert payload['objects']['identity']==[]
    assert payload['manifest']['datasets']['sha256']==digest(payload['data']['datasets'])
