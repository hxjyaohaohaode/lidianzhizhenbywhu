"""2026-09-30: scoped source capture; synthetic/local stubs only, no live provider calls."""
from conftest import Actor
from server import workspace_store as ws

TEXT='仅供隔离测试的合成证据：毛利率及现金流需要核对采购成本和企业经营。'*5

def test_upload_metadata_and_scope_are_atomic(actor,monkeypatch):
    monkeypatch.setattr('server.app.parse_document_isolated',lambda *args:TEXT)
    r=actor.post('/evidence/import',data={'title':'用户指定标题','company':'甲企业','published_at':'2025-01-01','source_url':'https://www.sse.com.cn/source'},files={'file':('original.txt',b'synthetic','text/plain')})
    assert r.status_code==201,r.text
    row=r.json();assert row['payload']['title']=='用户指定标题'
    assert row['payload']['published_at']=='2025-01-01'
    catalog=actor.get('/workspace/evidence').json()['items'];assert catalog[0]['review']['company']=='甲企业'
    assert catalog[0]['review_version']==1 and catalog[0]['eligible']
    assert actor.get('/workspace/retrieval',params={'q':'毛利率现金流','company':'乙企业'}).json()['items']==[]
    assert actor.get('/workspace/retrieval',params={'q':'毛利率现金流','company':'甲企业'}).json()['items']

def test_omitted_scope_excluded_and_global_requires_explicit_choice(actor):
    row=actor.post('/evidence',json={'title':'未指定','text':TEXT}).json()
    assert not actor.get('/workspace/evidence').json()['items'][0]['eligible']
    assert not actor.get('/retrieval',params={'q':'毛利率现金流'}).json()['items']
    review={'version':1,'status':'unreviewed'}
    assert actor.put('/workspace/evidence/'+row['id']+'/review',json=review).status_code==422
    r=actor.put('/workspace/evidence/'+row['id']+'/review',json={**review,'global_scope':True})
    assert r.status_code==200,r.text
    assert actor.get('/workspace/retrieval',params={'q':'毛利率现金流','company':'乙企业'}).json()['items']

def test_rollback_does_not_leave_globally_visible_evidence(actor,monkeypatch):
    def fail(*args,**kwargs):raise ValueError('test transaction failure')
    monkeypatch.setattr(ws,'save',fail)
    assert actor.post('/evidence',json={'title':'事务失败','text':TEXT,'company':'甲企业'}).status_code==422
    assert actor.get('/evidence').json()['items']==[]

def test_duplicate_cannot_expand_scope_or_relabel_source(actor):
    first=actor.post('/evidence',json={'title':'原始标题','text':TEXT,'company':'甲企业'}).json()
    dup=actor.post('/evidence',json={'title':'扩大范围','text':TEXT,'global_scope':True}).json()
    assert dup['id']==first['id'] and dup['deduplicated']
    assert dup['payload']['title']=='原始标题'
    assert actor.get('/workspace/evidence').json()['items'][0]['review']['company']=='甲企业'

def test_fetch_and_metadata_edit_preserve_origin(actor,client,monkeypatch):
    monkeypatch.setattr('server.app.fetch_public',lambda *args:(TEXT.encode(),'text/plain'))
    r=actor.post('/evidence/fetch',json={'title':'获取资料','url':'https://www.sse.com.cn/original','company':'甲企业'})
    assert r.status_code==201,r.text
    row=r.json();body={'title':'修正标题','source_url':'https://www.sse.com.cn/corrected','published_at':'2025-02-01','version':row['version']}
    path='/evidence/'+row['id']+'/metadata'
    assert Actor(client).put(path,json=body).status_code==404
    edited=actor.put(path,json=body);assert edited.status_code==200,edited.text
    p=edited.json()['payload'];assert p['original_source_url']=='https://www.sse.com.cn/original'
    assert p['verification']=='fetched_not_fact_checked' and p['text']==TEXT
    assert actor.put(path,json=body).status_code==409
    assert actor.put(path,json={**body,'version':2,'verification':'verified'}).status_code==422

def test_search_receipt_bound_to_result_and_owner(actor,client):
    class Search:
        def status(self):return {'configured':True}
        def search(self,q):return {'items':[{'title':'搜索摘要','source_url':'https://www.sse.com.cn/item','text':TEXT,'retrieved_at':'2026-01-01T00:00:00Z','verification':'search_snippet_unverified'}],'rejected':0,'credits_reported':None}
    client.app.state.research=Search()
    result=actor.post('/research/search',json={'query':'毛利率','consent':True});assert result.status_code==200,result.text
    item=result.json()['items'][0]
    body={k:item[k] for k in ('title','source_url','text','retrieved_at','search_receipt')};body['company']='甲企业'
    assert actor.post('/evidence',json={**body,'search_receipt':'伪造签名'}).status_code==422
    assert actor.post('/evidence',json={**body,'text':TEXT+'篡改'}).status_code==422
    assert Actor(client).post('/evidence',json=body).status_code==422
    saved=actor.post('/evidence',json=body);assert saved.status_code==201,saved.text
    assert saved.json()['payload']['verification']=='search_snippet_unverified'
    assert saved.json()['payload']['retrieved_at']==item['retrieved_at']
    assert actor.post('/evidence',json={'title':'伪造','text':TEXT,'source_kind':'public_document','verification':'verified'}).status_code==422

def test_legacy_unreviewed_rows_are_not_implicitly_global(actor,client):
    client.app.state.store.create('evidence',actor.user['id'],{'title':'旧记录','text':TEXT,'source_kind':'user_provided','verification':'unverified'})
    assert not actor.get('/workspace/evidence').json()['items'][0]['eligible']
    assert actor.get('/retrieval',params={'q':'毛利率现金流'}).json()['items']==[]

def test_metadata_change_invalidates_approved_input_snapshot(actor):
    from test_workspace_api import plan,approve
    d=actor.dataset()
    row=actor.post('/evidence',json={'title':'毛利率资料','text':TEXT,'company':d['payload']['company']}).json()
    p=plan(actor,d)
    changed=actor.put('/evidence/'+row['id']+'/metadata',json={'title':'修订来源','version':1})
    assert changed.status_code==200,changed.text
    assert approve(actor,p).status_code==409
