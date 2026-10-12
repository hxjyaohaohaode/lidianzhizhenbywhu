"""Optional server AI; isolated fixtures only, no external supplier requests."""
import json
import pytest
from conftest import Actor
from server.connections import scoped_providers, provider_binding
from server.providers import ProviderService
from test_services import connection, ok

@pytest.fixture
def server_env(monkeypatch):
    for key, value in {'ENABLED':'true','BASE_URL':'https://api.deepseek.com/v1','MODEL':'deepseek-test-model','API_KEY':'ISOLATED_TEST_SECRET'}.items():
        monkeypatch.setenv('SERVER_AI_'+key,value)

@pytest.mark.parametrize('flag',['','false','1','yes'])
def test_disabled_never_registers_or_autocalls(server_env,monkeypatch,flag):
    monkeypatch.setenv('SERVER_AI_ENABLED',flag)
    assert ProviderService().status()==[]

@pytest.mark.parametrize('key',['BASE_URL','MODEL','API_KEY'])
def test_incomplete_configuration_keeps_local_startup(factory,server_env,monkeypatch,key):
    monkeypatch.delenv('SERVER_AI_'+key)
    actor=Actor(factory())
    assert actor.get('/health').status_code==200
    assert actor.get('/services/connections').json()['items']==[]

@pytest.mark.parametrize('base',['http://models.test.example/v1','https://localhost/v1','https://127.0.0.1/v1','https://user:password@models.test.example/v1','https://api.deepseek.com/v1?key=SECRET','https://models.test.example:444/v1','https://models.internal/v1'])
def test_unsafe_endpoint_never_registers(server_env,monkeypatch,base):
    monkeypatch.setenv('SERVER_AI_BASE_URL',base)
    assert ProviderService().providers=={}

@pytest.mark.parametrize('key,value',[('API_KEY','bad\nsecret'),('MODEL','bad\nmodel')])
def test_invalid_configuration_never_echoes(server_env,monkeypatch,key,value,capsys):
    monkeypatch.setenv('SERVER_AI_'+key,value)
    assert ProviderService().providers=={}
    assert capsys.readouterr()==('','')


def test_explicit_shared_selection_preserves_private_default_and_secrets(factory,server_env):
    actor=Actor(factory());service=actor.client.app.state.providers
    scoped=scoped_providers(service,actor.user['id'])
    assert scoped.select() is None
    assert scoped.select('server_ai').model=='deepseek-test-model'
    response=actor.get('/services/connections')
    assert response.json()['items'][0]['scope']=='server_configuration'
    assert 'ISOLATED_TEST_SECRET' not in response.text
    assert response.json()['items'][0]['host']=='api.deepseek.com'
    assert response.json()['items'][0]['path']=='/v1/chat/completions'
    assert 'ISOLATED_TEST_SECRET' not in repr(scoped.select('server_ai'))
    private=ok(connection(actor),201)
    assert scoped.select().id==private['id']
    other=Actor(actor.client)
    assert scoped_providers(service,other.user['id']).select(private['id']) is None
    assert scoped_providers(service,other.user['id']).select() is None


def test_restart_invalidates_old_approved_binding_without_dispatch(factory,server_env):
    actor=Actor(factory());dataset=actor.dataset();service=actor.client.app.state.providers
    response=actor.post('/workspace/plans',json={'dataset_id':dataset['id'],'query':'核对经营指标与现金流','use_llm':True,'provider':'server_ai','max_calls':1})
    plan=ok(response,201)
    assert not plan['payload']['blockers']
    assert 'https://api.deepseek.com/v1/chat/completions' in plan['payload']['consent_scope'][0]
    old=plan['payload']['bindings']['provider']
    replacement=ProviderService().select('server_ai')
    assert provider_binding(replacement)!=old
    service.providers['server_ai']=replacement
    response=actor.post('/workspace/plans/'+plan['id']+'/execute',json={'version':plan['version'],'fingerprint':plan['payload']['fingerprint'],'external_consent':True})
    assert response.status_code==409,response.text
    assert ok(actor.get('/runs'))['items']==[]


def test_server_plan_still_requires_external_consent(factory,server_env):
    actor=Actor(factory());dataset=actor.dataset()
    plan=ok(actor.post('/workspace/plans',json={'dataset_id':dataset['id'],'query':'核对经营指标与现金流','use_llm':True,'provider':'server_ai','max_calls':1}),201)
    response=actor.post('/workspace/plans/'+plan['id']+'/execute',json={'version':plan['version'],'fingerprint':plan['payload']['fingerprint'],'external_consent':False})
    assert response.status_code==403,response.text
    assert response.json()['error']['code']=='EXTERNAL_CONSENT'
    assert ok(actor.get('/runs'))['items']==[]


def test_shared_never_becomes_unscoped_default(server_env):
    service=ProviderService()
    assert service.select() is None
    assert service.select('server_ai') is not None


def test_site_budget_shared_across_accounts_and_failures_do_not_refund(server_env,monkeypatch):
    import asyncio
    service=ProviderService(); provider=service.select('server_ai')
    service._server_calls_reserved=99
    def fail_request(*args):raise ValueError('ISOLATED_TRANSPORT_FAILURE')
    monkeypatch.setattr(service,'_request',fail_request)
    async def exercise():
        with pytest.raises(ValueError,match='ISOLATED_TRANSPORT_FAILURE'):
            await service._complete(provider,'test','test')
        assert service._server_calls_reserved==100
        with pytest.raises(ValueError,match='MODEL_SITE_BUDGET_EXHAUSTED'):
            await service._complete(provider,'test','test')
    asyncio.run(exercise())


@pytest.mark.parametrize('escaped',[False,True])
def test_supplier_cannot_echo_credential_into_success_output(server_env,monkeypatch,escaped):
    from test_provider_hardening import transport, answer
    service=ProviderService();provider=service.select('server_ai')
    body=answer();text=json.dumps({'claims':[],'missing':[provider.key]})
    if escaped:text=text.replace('I','\\u0049')
    body['choices'][0]['message']['content']=text
    transport(monkeypatch,body)
    with pytest.raises(ValueError,match='MODEL_CREDENTIAL_ECHO') as error:
        service._request(provider,'test','test')
    assert provider.key not in str(error.value)


@pytest.mark.parametrize('url',[
    'https://api.openai.com/v1','https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    'https://dashscope-us.aliyuncs.com/compatible-mode/v1','https://api.deepseek.com.evil.example/v1',
    'https://api.deepseek.com/alternate','https://open.bigmodel.cn/other',
    'https://models.test.example/v1',
])
def test_server_ai_rejects_unreviewed_or_overseas_routes(server_env,monkeypatch,url):
    monkeypatch.setenv('SERVER_AI_BASE_URL',url)
    assert ProviderService().status()==[]


@pytest.mark.parametrize('url,model',[
    ('https://api.deepseek.com','deepseek-test'),('https://api.deepseek.com/v1','deepseek-test'),
    ('https://dashscope.aliyuncs.com/compatible-mode/v1','qwen-test'),
    ('https://api.xiaomimimo.com/v1','mimo-test'),
])
def test_server_ai_accepts_reviewed_routes_without_network(server_env,monkeypatch,url,model):
    monkeypatch.setenv('SERVER_AI_MODEL',model)
    monkeypatch.setenv('SERVER_AI_BASE_URL',url)
    assert ProviderService().select('server_ai') is not None


@pytest.mark.parametrize('secret',['with"quote','with\\backslash'])
def test_decoded_secret_guard_checks_values_without_reserializing(secret):
    from server.providers import _contains_secret
    assert _contains_secret({'claims':[{'text':'prefix '+secret+' suffix'}]},secret)
    assert not _contains_secret({'claims':[{'text':'clean'}]},secret)


@pytest.mark.parametrize('url,model',[
    ('https://dashscope.aliyuncs.com/compatible-mode/v1','claude-test'),
    ('https://dashscope.aliyuncs.com/compatible-mode/v1','gpt-test'),
    ('https://api.deepseek.com','qwen-test'),
    ('https://open.bigmodel.cn/api/paas/v4','llama-test'),
    ('https://api.xiaomimimo.com/v1','gemini-test'),
])
def test_shared_model_must_match_domestic_provider_family(server_env,monkeypatch,url,model):
    monkeypatch.setenv('SERVER_AI_BASE_URL',url);monkeypatch.setenv('SERVER_AI_MODEL',model)
    assert ProviderService().status()==[]


@pytest.mark.parametrize('url,model,field,value,cap',[
    ('https://api.deepseek.com','deepseek-flash','thinking',{'type':'disabled'},'max_tokens'),
    ('https://dashscope.aliyuncs.com/compatible-mode/v1','qwen3.8-flash','enable_thinking',False,'max_completion_tokens'),
    ('https://api.xiaomimimo.com/v1','mimo-v2.6-flash','thinking',{'type':'disabled'},'max_completion_tokens'),
])
def test_server_low_cost_transport_parameters(server_env,monkeypatch,url,model,field,value,cap):
    from test_provider_hardening import transport, answer
    monkeypatch.setenv('SERVER_AI_BASE_URL',url);monkeypatch.setenv('SERVER_AI_MODEL',model)
    service=ProviderService();calls,_=transport(monkeypatch,answer())
    service._request(service.select('server_ai'),'test','test')
    payload=calls[0][2]
    assert payload[field]==value and payload[cap]==1000 and payload['stream'] is False
    assert ('max_tokens' in payload) != ('max_completion_tokens' in payload)


def test_glm_not_enabled_as_low_cost_shared_provider(server_env,monkeypatch):
    monkeypatch.setenv('SERVER_AI_BASE_URL','https://open.bigmodel.cn/api/paas/v4')
    monkeypatch.setenv('SERVER_AI_MODEL','glm-5.3')
    assert ProviderService().status()==[]
