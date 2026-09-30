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
