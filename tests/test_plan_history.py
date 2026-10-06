"""Plan history is a scoped read, including drafts beyond the old first 100."""
from copy import deepcopy
import pytest
from conftest import Actor
from server.store import encode
from test_workspace_scope import ok


def seed(actor, count=107):
    dataset=actor.dataset()
    plan=ok(actor.post('/workspace/plans',json={'dataset_id':dataset['id'],'query':'2024-Q4毛利率是多少'}),201)
    store=actor.client.app.state.store
    with store.transaction() as db:
        for index in range(count-1):
            payload=deepcopy(plan['payload']);payload['request']['query']=f'历史草稿 {index:03d}'
            id=f'plan-history-{index:04d}'
            db.execute('INSERT INTO workspace_objects VALUES(?,?,?,?,?,?,?,?)',
                (id,actor.user['id'],'plan',id,encode(payload),1,plan['created_at'],plan['updated_at']))
    return dataset,plan


def test_all_drafts_retrievable_without_execution_or_mutation(actor):
    dataset,original=seed(actor)
    store=actor.client.app.state.store;before=store.db.total_changes
    query='?identity_id=&dataset_id='+dataset['id']
    first=ok(actor.get('/workspace/plans'+query))
    assert len(first['items'])==100 and first['total']==107 and first['has_more']
    pages=[ok(actor.get('/workspace/plans'+query+f'&offset={offset}&limit=6')) for offset in range(0,108,6)]
    ids=[r['id'] for page in pages for r in page['items']]
    assert len(ids)==len(set(ids))==107 and original['id'] in ids
    assert all(page['total']==107 and page['limit']==6 for page in pages)
    assert all(page['has_more'] for page in pages[:-1]) and not pages[-1]['has_more']
    assert pages[-1]['offset']==102 and len(pages[-1]['items'])==5
    empty=ok(actor.get('/workspace/plans'+query+'&offset=1000'))
    assert empty['items']==[] and empty['total']==107 and not empty['has_more']
    assert store.db.total_changes==before
    assert ok(actor.get('/workspace/plans/'+original['id']))==original
    assert ok(actor.get('/runs'))['items']==[]


def test_pagination_preserves_owner_identity_and_dataset_scope(actor):
    d=actor.dataset();other=actor.dataset()
    identity=ok(actor.post('/services/identities',json={'name':'历史页范围','dataset_ids':[d['id']]}),201)
    ids=[]
    for dataset,service in [(d,identity['id']),(d,''),(other,'')]:
        p=ok(actor.post('/workspace/plans',json={'dataset_id':dataset['id'],'identity_id':service,'query':'核对经营资料的原始依据'}),201)
        ids.append(p['id'])
    query='?identity_id='+identity['id']+'&dataset_id='+d['id']+'&offset=0&limit=1'
    result=ok(actor.get('/workspace/plans'+query));assert result['total']==1 and result['items'][0]['id']==ids[0]
    assert not result['has_more']
    result=ok(actor.get('/workspace/plans?identity_id=&dataset_id='+d['id']+'&limit=1'))
    assert result['total']==1 and result['items'][0]['id']==ids[1]
    assert actor.get('/workspace/plans?identity_id='+identity['id']+'&dataset_id='+other['id']+'&offset=1').status_code==403
    stranger=Actor(actor.client)
    assert ok(stranger.get('/workspace/plans?offset=100&limit=6'))['items']==[]
    assert stranger.get('/workspace/plans'+query).status_code==404
    assert stranger.get('/workspace/plans/'+ids[0]).status_code==404


@pytest.mark.parametrize('query',['offset=-1','offset=1001','offset=1.5','offset=abc','limit=0','limit=101','limit=1.5','limit=abc'])
def test_bad_page_bounds_fail_closed(actor,query):
    assert actor.get('/workspace/plans?'+query).status_code==422
