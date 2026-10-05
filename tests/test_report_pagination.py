"""Bounded scoped report retrieval; capacity copies are declared storage fixtures."""
from conftest import Actor
from server.store import encode
from test_workspace_scope import ok
import pytest


def seed(actor,count=201):
    dataset=actor.dataset();run=actor.execute(ok(actor.run(dataset=dataset),202))
    assert run['state'] in ('succeeded','degraded')
    store=actor.client.app.state.store
    cols=[r['name'] for r in store.all('PRAGMA table_info(runs)')]
    original=store.one('SELECT * FROM runs WHERE id=?',(run['id'],))
    with store.transaction() as db:
        for i in range(count-1):
            row=dict(original);row['id']='000-report-capacity-'+str(i).zfill(4);row['idempotency_key']=row['id']
            db.execute('INSERT INTO runs('+','.join(cols)+') VALUES('+','.join('?' for _ in cols)+')',
                tuple(encode(row[c]) if isinstance(row[c],(dict,list)) else row[c] for c in cols))
    return dataset,run


def test_can_find_original_beyond_first_200_without_writes_or_recomputing(actor):
    dataset,run=seed(actor);store=actor.client.app.state.store;before=store.db.total_changes
    params={'identity_id':'','dataset_id':dataset['id'],'limit':200}
    first=ok(actor.get('/workspace/reports',params=params))
    last=ok(actor.get('/workspace/reports',params={**params,'offset':200}))
    assert len(first['items'])==200 and first['has_more'] and first['total']==201
    assert [r['id'] for r in last['items']]==[run['id']] and last['total']==201 and not last['has_more']
    assert last['offset']==200 and last['limit']==200
    pages=[ok(actor.get('/workspace/reports',params={**params,'limit':20,'offset':offset})) for offset in range(0,201,20)]
    ids=[r['id'] for page in pages for r in page['items']]
    assert len(ids)==len(set(ids))==201 and ids[-1]==run['id']
    assert ok(actor.get('/workspace/reports',params={**params,'offset':1000}))['items']==[]
    assert ok(actor.get('/runs/'+run['id']))==run and store.db.total_changes==before


def test_pages_keep_owner_dataset_and_identity_scope(actor):
    d=actor.dataset();other=actor.dataset()
    ident=ok(actor.post('/services/identities',json={'name':'分页研究身份','dataset_ids':[d['id']]}),201)
    ids=[]
    for dataset,identity in [(d,ident['id']),(d,''),(other,'')]:
        p=ok(actor.post('/workspace/plans',json={'dataset_id':dataset['id'],'identity_id':identity,'query':'核对经营财务原始依据'}),201)
        r=ok(actor.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']}),202)
        ids.append(actor.execute(r)['id'])
    result=ok(actor.get('/workspace/reports',params={'identity_id':ident['id'],'dataset_id':d['id'],'limit':1}))
    assert result['total']==1 and [r['id'] for r in result['items']]==ids[:1] and not result['has_more']
    assert ok(actor.get('/workspace/reports',params={'identity_id':'','dataset_id':d['id'],'limit':1}))['total']==1
    assert actor.get('/workspace/reports',params={'identity_id':ident['id'],'dataset_id':other['id'],'offset':1}).status_code==403
    stranger=Actor(actor.client)
    assert ok(stranger.get('/workspace/reports',params={'offset':100,'limit':20}))['total']==0
    assert stranger.get('/workspace/reports',params={'dataset_id':d['id']}).status_code==404


@pytest.mark.parametrize('params',[{'offset':-1},{'offset':1001},{'offset':'1.5'},{'offset':'abc'},{'limit':0},{'limit':201},{'limit':'1.5'},{'limit':'abc'}])
def test_invalid_bounds_reject_without_unbounded_reads(actor,params):
    assert actor.get('/workspace/reports',params=params).status_code==422
