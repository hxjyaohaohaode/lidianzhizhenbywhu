"""Actual account-owned fixtures verify service-lens lists before aggregation."""
from conftest import Actor
from server.store import encode


def ok(r, code=200):
    assert r.status_code == code, r.text
    return r.json()


def test_workspace_scope_counts_and_lists_are_consistent(actor):
    d=actor.dataset();other=actor.dataset()
    i=ok(actor.post('/services/identities',json={'name':'审阅范围','dataset_ids':[d['id']]}),201)
    for ds,identity in [(d,i['id']),(d,''),(other,'')]:
        p=ok(actor.post('/workspace/plans',json={'dataset_id':ds['id'],'identity_id':identity,'query':'核对真实经营资料与数据来源'}),201)
        r=ok(actor.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']}),202)
        actor.execute(r)
    query='?identity_id='+i['id']
    brief=ok(actor.get('/workspace/brief'+query))
    assert brief['counts']['datasets']==1 and brief['counts']['reports']==1
    assert len(brief['runs'])==1
    assert [x['id'] for x in brief['datasets']]==[d['id']]
    plans=ok(actor.get('/workspace/plans'+query))
    assert plans['total']==1 and plans['items'][0]['payload']['request']['identity_id']==i['id']
    assert len(ok(actor.get('/workspace/reports'+query))['items'])==1
    assert len(ok(actor.get('/workspace/reports?identity_id='))['items'])==2
    assert len(ok(actor.get('/workspace/reports'))['items'])==3
    ok(actor.get('/workspace/brief'+query+'&dataset_id='+other['id']),403)
    stranger=Actor(actor.client)
    ok(stranger.get('/workspace/brief'+query),404)
    ok(stranger.get('/workspace/reports?dataset_id='+d['id']),404)


def test_sample_admission_is_rejected_across_public_dataset_routes(actor,example):
    ok(actor.post('/datasets',json=example),422)
    d=actor.dataset()
    ok(actor.put('/datasets/'+d['id'],json={**example,'version':d['version']}),422)
    import json
    ok(actor.post('/import/dataset',data={'company':example['company']},files={'file':('input.json',json.dumps(example),'application/json')}),422)
    assert ok(actor.get('/datasets/'+d['id']))['version']==1


def test_scoped_experiments_are_shared_by_allowed_dataset(actor):
    d=actor.dataset();other=actor.dataset()
    i=ok(actor.post('/services/identities',json={'name':'企业范围','dataset_ids':[d['id']]}),201)
    for ds in (d,other):
        ok(actor.post('/workspace/experiments',json={'dataset_id':ds['id'],'name':'用户指定情景','kind':'scenario','assumptions':'测试中的显式零变化假设'}),201)
    rows=ok(actor.get('/workspace/experiments?identity_id='+i['id']))
    assert len(rows['items'])==1 and rows['items'][0]['payload']['dataset_id']==d['id']
    assert len(ok(actor.get('/workspace/experiments'))['items'])==2


def test_brief_does_not_count_unscoped_or_rejected_evidence_as_available(actor):
    d=actor.dataset()
    ok(actor.post('/evidence',json={'title':'范围待确认','text':'财务数据原始说明需要先确认企业作用域。'*5}),201)
    e=ok(actor.post('/evidence',json={'title':'企业资料','company':d['payload']['company'],'text':'另一份关于毛利与现金回流的企业资料。'*5}),201)
    scoped=ok(actor.get('/workspace/brief?identity_id=&dataset_id='+d['id']))
    assert scoped['counts']['evidence']==1
    review=next(x for x in ok(actor.get('/workspace/evidence'))['items'] if x['id']==e['id'])
    ok(actor.put('/workspace/evidence/'+e['id']+'/review',json={**review['review'],'status':'rejected','note':'经审阅不适用本次研究范围','version':review['review_version']}))
    assert ok(actor.get('/workspace/brief?identity_id=&dataset_id='+d['id']))['counts']['evidence']==0
