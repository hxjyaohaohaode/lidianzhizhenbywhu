import json
from conftest import Actor
from server.research import PublicResearch
class ResearchFixture:
    def __init__(self,fail=False):self.calls=0;self.fail=fail
    def status(self):return {'configured':True,'provider':'fixture','connectivity':'test_double'}
    def search(self,q):
        self.calls+=1
        if self.fail:raise RuntimeError('injected')
        return {'items':[],'rejected':2,'provider':'fixture','credits_reported':1,'query':q,'warning':'fixture results, not live evidence'}

def test_public_search_consent_and_configuration(actor,client):
    client.app.state.research.key=''
    assert actor.post('/research/search',json={'query':'碳酸锂材料价格','consent':False}).status_code==422
    assert actor.post('/research/search',json={'query':'碳酸锂材料价格','consent':True}).status_code==503
    assert actor.get('/evidence').json()['items']==[]
def test_search_quota_audit_and_no_automatic_evidence(actor,client):
    fake=ResearchFixture();client.app.state.research=fake
    for _ in range(10):assert actor.post('/research/search',json={'query':'锂电企业营业成本','consent':True}).status_code==200
    assert actor.post('/research/search',json={'query':'锂电企业营业成本','consent':True}).status_code==429
    assert fake.calls==10 and actor.get('/evidence').json()['items']==[]
    events=actor.get('/sync?limit=100').json()['items'];assert len(events)==20 and all(e['resource']=='research' for e in events)
    assert '锂电企业营业成本' not in json.dumps(events,ensure_ascii=False)
def test_search_failure_no_fake_fallback(actor,client):
    fake=ResearchFixture(fail=True);client.app.state.research=fake;r=actor.post('/research/search',json={'query':'锂电企业毛利率','consent':True})
    assert r.status_code==502 and fake.calls==1 and actor.get('/evidence').json()['items']==[]
def test_search_wire_filter_and_source_label(monkeypatch):
    import server.research as m
    monkeypatch.setenv('TAVILY_API_KEY','injected-test-fixture');seen={};raw={'results':[{'title':'锂电材料毛利率','url':'https://www.cninfo.com.cn/report','content':'碳酸锂材料成本影响锂电企业毛利率及现金流，需要核查财报口径。'*5},{'title':'酒店住宿','url':'https://www.cninfo.com.cn/hotel','content':'酒店预订与机场接送，海滨度假住宿信息。'*5},{'title':'锂电材料毛利率','url':'https://evil.example/report','content':'碳酸锂材料成本影响锂电企业毛利率。'*5}],'usage':{'credits':1}}
    class Conn:
        def __init__(self,*a):seen['connection']=a
        def request(self,method,path,data,headers):seen['body']=json.loads(data);seen['headers']=headers
        def getresponse(self):return self
        status=200
        def read(self,size):return json.dumps(raw).encode()
        def close(self):seen['closed']=True
    monkeypatch.setattr(m,'public_addresses',lambda h:['8.8.8.8']);monkeypatch.setattr(m,'PinnedHTTPS',Conn)
    r=PublicResearch(('www.cninfo.com.cn',)).search('碳酸锂材料成本和毛利率')
    assert len(r['items'])==1 and r['rejected']==2 and r['items'][0]['verification']=='search_snippet_unverified'
    assert r['credits_reported']==1 and seen['closed'] and seen['body']['max_results']==5 and seen['body']['include_answer'] is False
    assert seen['body']['include_domains']==['www.cninfo.com.cn']
def test_batch_deletion_ownership_atomicity_and_cascade(actor,client):
    a=actor;b=Actor(client);s=a.conversation();foreign=b.conversation();d=a.dataset();r=a.run(d,s).json()
    assert a.post('/conversations/delete-batch',json={'ids':[s['id'],foreign['id']]}).status_code==404
    assert a.get('/conversations/'+s['id']+'/messages').status_code==200 and a.get('/runs/'+r['id']).status_code==200
    assert a.post('/conversations/delete-batch',json={'ids':[s['id']]}).json()['deleted']==1
    assert a.get('/runs/'+r['id']).status_code==404 and b.get('/conversations/'+foreign['id']+'/messages').status_code==200
def test_local_current_api_reference(client):
    r=client.get('/api/docs');assert r.status_code==200 and '/assets/dist/docs.js' in r.text
    assert 'http' not in r.text.lower().replace('httponly','')
    schema=client.get('/api/openapi.json').json();assert '/api/research/search' in schema['paths'] and schema['info']['version']=='4.0.0'
    assert client.get('/assets/dist/docs.js').status_code==200
