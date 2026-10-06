"""MiMo and generic provider protocol fixtures, never live supplier calls."""
import json
import pytest
from server.providers import Provider, ProviderService


def transport(monkeypatch,body,status=200):
    import server.providers as module
    calls=[];closed=[]
    class Conn:
        def __init__(self,*args):self.status=status
        def request(self,method,path,data,headers):calls.append((method,path,json.loads(data),headers))
        def getresponse(self):return self
        def read(self,*args):return json.dumps(body).encode() if not isinstance(body,bytes) else body
        def close(self):closed.append(True)
    monkeypatch.setattr(module,'PinnedHTTPS',Conn)
    monkeypatch.setattr(module,'public_addresses',lambda host:['93.184.216.34'])
    return calls,closed


def answer(**patch):
    return {'choices':[{'finish_reason':'stop','message':{'content':'{"claims":[],"missing":["缺少证据"]}'},**patch}],
            'usage':{'prompt_tokens':3,'completion_tokens':8,'total_tokens':11}}


def test_mimo_uses_bounded_non_thinking_contract_without_new_auth_header(monkeypatch):
    monkeypatch.setenv('MIMO_API_KEY','FIXTURE-NOT-A-REAL-KEY');monkeypatch.setenv('MIMO_MODEL','fixture-mimo')
    service=ProviderService();p=service.select('mimo');calls,closed=transport(monkeypatch,answer())
    result=service._request(p,'bounded','{}')
    assert result['provider']=='mimo' and result['model']=='fixture-mimo'
    method,path,payload,headers=calls[0]
    assert path=='/v1/chat/completions' and p.host=='api.xiaomimimo.com'
    assert payload['thinking']=={'type':'disabled'} and payload['max_completion_tokens']==1000
    assert 'max_tokens' not in payload and payload['stream'] is False
    assert headers['Authorization']=='Bearer FIXTURE-NOT-A-REAL-KEY'
    assert 'FIXTURE-NOT-A-REAL-KEY' not in repr(p)
    assert closed==[True]
    assert next(s for s in service.status() if s['id']=='mimo')['connectivity']=='not_tested'
    assert set(service.providers)=={'deepseek','qwen','glm','mimo'}


@pytest.mark.parametrize('finish',['length','tool_calls','content_filter','repetition_truncation',None,'invented'])
def test_incomplete_or_nonfinal_output_is_never_a_success(monkeypatch,finish):
    calls,closed=transport(monkeypatch,answer(finish_reason=finish))
    with pytest.raises(ValueError,match='MODEL_FINISH_'):
        ProviderService()._request(Provider('test','provider.example','/v1/chat/completions','fixture','FIXTURE'),'safe','{}')
    assert len(calls)==1 and closed==[True]


@pytest.mark.parametrize('extra',[{'tool_calls':[{'name':'delete_all'}]},{'function_call':{'name':'shell'}},{'refusal':'blocked'}])
def test_provider_tool_or_refusal_payload_cannot_masquerade_as_answer(monkeypatch,extra):
    body=answer();body['choices'][0]['message'].update(extra);transport(monkeypatch,body)
    with pytest.raises(ValueError,match='MODEL_UNSUPPORTED_RESPONSE'):
        ProviderService()._request(Provider('test','provider.example','/chat','fixture','FIXTURE'),'safe','{}')


def test_upstream_error_body_and_arbitrary_codes_never_echo_credentials(monkeypatch):
    secret='FIXTURESECRETTHATLOOKSLIKEACODE'
    transport(monkeypatch,{'error':{'code':secret,'message':'api key '+secret}},status=429)
    with pytest.raises(ValueError) as exc:
        ProviderService()._request(Provider('test','provider.example','/chat','fixture',secret),'safe','{}')
    assert str(exc.value)=='MODEL_HTTP_429' and secret not in str(exc.value)


def test_known_glm_billing_code_survives_without_message_or_retry(monkeypatch):
    calls,_=transport(monkeypatch,{'error':{'code':1113,'message':'secret echoed here'}},status=429)
    with pytest.raises(ValueError,match='MODEL_HTTP_429_1113'):
        ProviderService()._request(Provider('glm','open.bigmodel.cn','/api/paas/v4/chat/completions','fixture','FIXTURE'),'safe','{}')
    assert len(calls)==1


def test_ambiguous_duplicate_json_keys_are_rejected(monkeypatch):
    body=answer();body['choices'][0]['message']['content']='{"claims":[],"claims":[],"missing":[]}'
    transport(monkeypatch,body)
    with pytest.raises(ValueError,match='MODEL_DUPLICATE_JSON_KEY'):
        ProviderService()._request(Provider('test','provider.example','/chat','fixture','FIXTURE'),'safe','{}')
