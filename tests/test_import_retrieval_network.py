import asyncio
import io
import json
import socket
import zipfile
import pytest
from pydantic import ValidationError
from openpyxl import Workbook
from server.imports import import_dataset,safe_zip,parse_document_isolated
from server.network import validate_url,public_addresses,fetch_public,NetworkRejected
from server.retrieval import retrieve
from server.store import digest
from server.providers import ProviderService,Provider,ModelOutput

@pytest.mark.parametrize('filename',['report.csv','REPORT.CSV'])
def test_csv_chinese_headers_missing_and_zero(filename):
    raw='季度,营业收入,营业成本,净利润,研发费用\n2025-Q1,100,80,-5,\n2025-Q2,120,90,0,0\n'.encode('utf-8-sig')
    d=import_dataset(filename,raw,'企业','wan');assert d.periods[0].net_profit==-5 and d.periods[0].rd_expense is None
    assert d.periods[1].net_profit==0 and d.periods[1].rd_expense==0 and d.amount_unit=='wan'
@pytest.mark.parametrize('raw',['period,revenue,cost\n2025-Q1,,8','period,revenue,cost\n2025-Q1,=1+2,8','period,revenue,cost\n2025-Q1,NaN,8','period,revenue,cost\n2025-Q1,Infinity,8','period,revenue,cost\n2025-Q1,100%,8','period,revenue,revenue\n2025-Q1,1,2','period,revenue,cost,unknown\n2025-Q1,1,2,3','period,revenue,cost\n2025-Q1,1,2,3','period,revenue,cost\n2025-Q1,1,2\n2025-Q1,1,2','period,revenue,cost\n2025-Q1,+10,2'])
def test_malformed_finance_imports_rejected(raw):
    with pytest.raises((ValueError,ValidationError)):import_dataset('bad.csv',raw.encode(),'企业','yuan')
def test_excel_legitimate_formula_and_multiple_sheets():
    def file(formula=False,multiple=False):
        w=Workbook();w.active.append(['period','revenue','cost']);w.active.append(['2025-Q1','=5+5' if formula else 10,8])
        if multiple:w.create_sheet('unexpected')
        b=io.BytesIO();w.save(b);return b.getvalue()
    assert import_dataset('a.xlsx',file(),'企业','yuan').periods[0].revenue==10
    for raw in (file(True),file(multiple=True)):
        with pytest.raises(ValueError):import_dataset('a.xlsx',raw,'企业','yuan')
def test_json_preserves_metadata_and_rejects_nonfinite(example):
    p=import_dataset('dataset.json',json.dumps(example).encode(),'ignored','wan');assert p.company==example['company'] and p.source_kind=='sample'
    with pytest.raises(ValueError):import_dataset('a.json',b'{"revenue":NaN}','企业','yuan')
def test_zip_slip_and_bomb_and_input_limit():
    for name,content in [('../escape.xml',b'x'),('xl/sharedStrings.xml',b'0'*6000000)]:
        b=io.BytesIO()
        with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED) as z:z.writestr(name,content)
        with pytest.raises(ValueError):safe_zip(b.getvalue())
    with pytest.raises(ValueError):import_dataset('huge.csv',b'x'*2000001,'企业','yuan')
    with pytest.raises(ValueError):import_dataset('evil.exe',b'abcd','企业','yuan')
def test_isolated_document_parser():
    text='锂电材料成本与现金流应联合核查。'*10;assert parse_document_isolated('research.md',text.encode())==text
    for name,raw in [('bad.pdf',b'not a PDF'),('program.exe',b'program'),('scan.txt',b'\xff\xfe\x00')]:
        with pytest.raises(ValueError):parse_document_isolated(name,raw)
def test_upload_and_finance_export_roundtrip(actor,example):
    example={**example,'source_kind':'user_provided'}  # Isolated synthetic upload fixture.
    r=actor.post('/import/dataset',files={'file':('finance.json',json.dumps(example).encode(),'application/json')},data={'company':'导入企业','amount_unit':'yuan'})
    assert r.status_code==201,r.text
    d=r.json();exp=actor.get('/datasets/'+d['id']+'/export');assert exp.status_code==200 and 'verification' not in exp.json()
    re=actor.post('/import/dataset',files={'file':('roundtrip.json',exp.content,'application/json')},data={'company':'导入企业'})
    assert re.status_code==201,re.text
    assert re.json()['payload']['periods']==d['payload']['periods']
    text='公司原材料成本上升，需要结合毛利率和经营现金流核查。'*10
    r=actor.post('/evidence/import',files={'file':('research.txt',text.encode(),'text/plain')});assert r.status_code==201 and r.json()['payload']['text']==text
def test_evidence_dedup_is_owner_scoped(actor,client):
    from conftest import Actor
    data={'title':'锂电资料','text':'营业成本上升会对毛利率形成压力，但不能据此推断未来经营失败。'*10}
    first=actor.post('/evidence',json=data).json();second=actor.post('/evidence',json=data).json();other=Actor(client).post('/evidence',json=data).json()
    assert first['id']==second['id'] and other['id']!=first['id'] and first['payload']['verification']=='unverified'
def test_chinese_lexical_retrieval_provenance_and_no_hotel_false_hit():
    def doc(id,title,text):return {'id':id,'content_hash':digest(text),'payload':{'title':title,'text':text,'source_kind':'user_provided'}}
    documents=[doc('finance','毛利分析','锂电企业的碳酸锂采购成本与库存资金占用共同影响经营现金流和毛利率。'*50),doc('hotel','酒店预订','提前预订酒店客房和机场接送服务。'*50)]
    result=retrieve(documents,'碳酸锂采购成本和库存现金流');assert result and all(x['document_id']=='finance' for x in result) and len(result)<=2
    for x in result:
        assert x['content_hash']==digest(x['excerpt']) and x['excerpt']==documents[0]['payload']['text'][x['start']:x['end']]
        assert x['stale'] is True and x['verification']=='unverified'
    assert retrieve(documents,'酒店') and retrieve(documents,'quantum_biology_unknown')==[] and retrieve(documents,'的')==[]
@pytest.mark.parametrize('url',['http://www.cninfo.com.cn/a','https://127.0.0.1/a','https://www.cninfo.com.cn.evil.example/a','https://user:pass@www.cninfo.com.cn/a','https://www.cninfo.com.cn:8443/a','https://www.cninfo.com.cn/a#part','https://www.cninfo.com.cn:bad/a','https://www.cninfo.com.cn/原始汉字','file:///etc/passwd','https://[::1]/a','https://2130706433/a','https://www.cninfo.com.cn@evil.example/a'])
def test_ssrf_url_rejection(url):
    with pytest.raises((NetworkRejected,ValueError)):validate_url(url,('www.cninfo.com.cn',))
def test_allowlist_encoded_https_valid():assert validate_url('https://www.cninfo.com.cn/a?q=%E4%B8%AD',('www.cninfo.com.cn',))==('www.cninfo.com.cn','/a?q=%E4%B8%AD')
@pytest.mark.parametrize('ip',['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.16.0.1','100.64.0.1','0.0.0.0','::1','fe80::1','fc00::1','::ffff:127.0.0.1'])
def test_private_or_mixed_dns_and_ipv6_rejected(monkeypatch,ip):
    monkeypatch.setattr(socket,'getaddrinfo',lambda *a,**k:[(2,1,6,'',('8.8.8.8',443)),(2,1,6,'',(ip,443))])
    with pytest.raises(NetworkRejected):public_addresses('www.cninfo.com.cn')
def test_dns_pinning_target_and_resource_cleanup(monkeypatch):
    import server.network as n
    seen=[]
    class Conn:
        def __init__(self,host,ip,timeout):seen.append((host,ip));self.status=200
        def request(self,*a,**k):seen.append(a)
        def getresponse(self):return self
        def getheader(self,k,d=''):return {'Content-Type':'text/plain','Content-Encoding':'identity'}.get(k,d)
        def read(self,n):return b'public source'
        def close(self):seen.append('closed')
    monkeypatch.setattr(n,'public_addresses',lambda h:['8.8.8.8']);monkeypatch.setattr(n,'PinnedHTTPS',Conn)
    raw,_=fetch_public('https://www.cninfo.com.cn/a',('www.cninfo.com.cn',));assert seen[0]==('www.cninfo.com.cn','8.8.8.8') and raw==b'public source' and seen[-1]=='closed'
@pytest.mark.parametrize('status,kind,encoding,size',[(302,'text/plain','identity',5),(403,'text/plain','identity',5),(200,'application/zip','identity',5),(200,'text/plain','gzip',5),(200,'text/plain','identity',101)])
def test_redirect_type_compression_and_response_limit(monkeypatch,status,kind,encoding,size):
    import server.network as n
    class Conn:
        def __init__(self,*a,**k):self.status=status
        def request(self,*a,**k):pass
        def getresponse(self):return self
        def getheader(self,k,d=''):return {'Content-Type':kind,'Content-Encoding':encoding}.get(k,d)
        def read(self,n):return b'x'*size
        def close(self):pass
    monkeypatch.setattr(n,'public_addresses',lambda h:['8.8.8.8']);monkeypatch.setattr(n,'PinnedHTTPS',Conn)
    with pytest.raises(NetworkRejected):fetch_public('https://www.cninfo.com.cn/a',('www.cninfo.com.cn',),max_bytes=100)
def test_fetch_error_does_not_insert_samples(actor,monkeypatch):
    import server.app as m
    def fail(*a):raise NetworkRejected('injected offline')
    monkeypatch.setattr(m,'fetch_public',fail)
    assert actor.post('/evidence/fetch',json={'url':'https://www.cninfo.com.cn/test','title':'测试'}).status_code==502
    assert actor.get('/evidence').json()['items']==[]
@pytest.mark.parametrize('payload',[{'claims':[{'text':'hello','unknown_tool':'execute'}]},{'claims':[{'text':'','metric_ids':[]}]},{'claims':[{'text':'x'*601}]},{'claims':[{'text':'ok','uncertainty':'guaranteed'}]},{'claims':[],'sql':'DROP TABLE users'}])
def test_strict_model_output_contract(payload):
    with pytest.raises(ValidationError):ModelOutput.model_validate(payload)
def test_configuration_status_not_connectivity(monkeypatch):
    monkeypatch.setenv('DEEPSEEK_API_KEY','your_placeholder');p=ProviderService()
    assert not next(x for x in p.status() if x['id']=='deepseek')['configured']
    assert all(x['connectivity']=='not_tested' for x in p.status()) and p.select('unknown-provider') is None
def test_circuit_breaker_no_silent_retry(monkeypatch):
    p=ProviderService();provider=Provider('test','test.example','/v1','fixture','fake-test-key');calls=[]
    def fail(*a):calls.append(1);raise RuntimeError('test failure')
    monkeypatch.setattr(p,'_request',fail)
    async def execute():
        for _ in range(4):
            with pytest.raises((ValueError,RuntimeError)):await p.complete(provider,'system','context')
    asyncio.run(execute());assert len(calls)==3 and p.open_until['test']>0

def test_provider_wire_request_usage_contract(monkeypatch):
    import server.providers as m
    captured={};output={'claims':[{'text':'现金回流需核查。','metric_ids':['cash_ratio'],'citation_ids':[],'uncertainty':'high'}],'missing':[]}
    body={'choices':[{'finish_reason':'stop','message':{'content':'```json\n'+json.dumps(output)+'\n```'}}],'usage':{'prompt_tokens':11,'completion_tokens':7,'total_tokens':18,'unknown':'ignored'}}
    class Conn:
        def __init__(self,*a):captured['connection']=a
        def request(self,method,path,raw,headers):captured.update(method=method,path=path,body=json.loads(raw),headers=headers)
        def getresponse(self):return self
        status=200
        def read(self,size):return json.dumps(body).encode()
        def close(self):captured['closed']=True
    monkeypatch.setattr(m,'PinnedHTTPS',Conn);monkeypatch.setattr(m,'public_addresses',lambda h:['8.8.8.8'])
    p=ProviderService();provider=Provider('test','api.test.example','/v1/chat/completions','test-model','injected-fixture-key');r=p._request(provider,'system boundary','{"input":"data"}')
    assert captured['headers']['Authorization']=='Bearer injected-fixture-key'
    assert captured['body']['stream'] is False and captured['body']['max_tokens']==1000 and captured['body']['messages'][0]['role']=='system'
    assert captured['closed'] and r['output']=={**output,'claims':[{**claim,'tool_reference_ids':[]} for claim in output['claims']]} and r['usage']=={'prompt_tokens':11,'completion_tokens':7,'total_tokens':18}
    assert asyncio.run(p.complete(provider,'system','{}'))['model']=='test-model'
@pytest.mark.parametrize('response',[b'x'*500001,b'not json',b'{"choices":[]}',b'{"choices":[{"message":{"content":[]}}]}'],ids=['oversized-wire','invalid-json','empty-choices','invalid-content'])
def test_malformed_provider_wire_rejected(monkeypatch,response):
    import server.providers as m
    class Conn:
        def __init__(self,*a):pass
        def request(self,*a):pass
        def getresponse(self):return self
        status=200
        def read(self,size):return response
        def close(self):pass
    monkeypatch.setattr(m,'PinnedHTTPS',Conn);monkeypatch.setattr(m,'public_addresses',lambda h:['8.8.8.8'])
    with pytest.raises((ValueError,IndexError,KeyError)):ProviderService()._request(Provider('test','test.example','/v1','model','injected'),'sys','{}')
def test_html_evidence_excludes_scripts(actor,monkeypatch):
    import server.app as m
    text='营业收入与毛利率分析需要核对原始季度数据。'*10;html=('<html><script>STEAL_SECRET()</script><p>'+text+'</p></html>').encode()
    monkeypatch.setattr(m,'fetch_public',lambda *args:(html,'text/html'))
    r=actor.post('/evidence/fetch',json={'title':'公开文档','url':'https://www.cninfo.com.cn/report'})
    assert r.status_code==201 and 'STEAL_SECRET' not in r.json()['payload']['text'] and r.json()['payload']['verification']=='fetched_not_fact_checked'
