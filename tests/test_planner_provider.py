"""Provider-contract fault injection. Does not contact or validate a real supplier."""
import asyncio
import json
import time
import pytest
from server.providers import Provider,ProviderService
from server.autonomy_contracts import PlannerProposal


def test_planner_uses_strict_schema_and_never_instructs_command_execution(monkeypatch):
    service=ProviderService();p=Provider('test','example.com','/approved','model','test-fixture')
    def response(provider,system,context,output_schema):
        assert provider is p and output_schema is PlannerProposal
        assert '不能新增工具' in system and context=='{}'
        return {'output':PlannerProposal(rationale='明确本地工具和反证分工').model_dump(),'usage':{}}
    monkeypatch.setattr(service,'_request',response)
    assert asyncio.run(service.propose(p,'{}'))['output']['execution_order']=='parallel'


def test_planner_circuit_stops_further_network_attempts_after_known_failures(monkeypatch):
    service=ProviderService();p=Provider('test','example.com','/approved','model','test-fixture');calls=[]
    def fail(*args):calls.append(1);raise ValueError('MODEL_HTTP_500')
    monkeypatch.setattr(service,'_request',fail)
    for _ in range(3):
        with pytest.raises(ValueError,match='MODEL_HTTP_500'):asyncio.run(service.propose(p,'{}'))
    with pytest.raises(ValueError,match='MODEL_CIRCUIT_OPEN'):asyncio.run(service.propose(p,'{}'))
    assert len(calls)==3


def test_real_provider_request_parser_rejects_proposed_shell_even_with_valid_transport(monkeypatch):
    import server.providers as module
    service=ProviderService();p=Provider('test','example.com','/approved','model','test-fixture');closed=[]
    class Conn:
        status=200
        def __init__(self,*args):pass
        def request(self,*args):assert args[0]=='POST' and args[1]=='/approved'
        def getresponse(self):return self
        def read(self,*args):return json.dumps({'choices':[{'message':{'content':json.dumps({'focus':['shell'],'rationale':'untrusted proposal'})}}]}).encode()
        def close(self):closed.append(True)
    monkeypatch.setattr(module,'PinnedHTTPS',Conn);monkeypatch.setattr(module,'public_addresses',lambda _:['93.184.216.34'])
    with pytest.raises(ValueError):service._request(p,'bounded','{}',PlannerProposal)
    assert closed==[True]
