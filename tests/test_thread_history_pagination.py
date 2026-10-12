"""Synthetic in-process API evidence; not native browser/provider evidence."""
import pytest
from conftest import Actor
from server import workspace_store as ws


def seed(actor, count=200, identity_id='', dataset_id=''):
    store=actor.client.app.state.store
    with store.transaction() as db:
        return [ws.save(store,db,actor.user['id'],'assistant_thread',{'title':f'Synthetic {n:03d}','identity_id':identity_id,'dataset_id':dataset_id},key=f'pagination-{identity_id}-{dataset_id}-{n}') for n in range(count)]


def test_complete_200_thread_history_and_stable_ties(actor):
    rows=seed(actor)
    with actor.client.app.state.store.transaction() as db:
        db.execute("UPDATE workspace_objects SET updated_at='2026-10-08T00:00:00Z' WHERE user_id=?",(actor.user['id'],))
    a=actor.get('/services/threads').json()
    b=actor.get('/services/threads?offset=100&limit=100').json()
    assert a['offset']==0 and a['limit']==100 and a['has_more'] and a['next_offset']==100
    assert len(a['items'])==len(b['items'])==100
    assert not b['has_more'] and b['next_offset'] is None
    assert [r['id'] for r in a['items']+b['items']]==sorted(r['id'] for r in rows)
    empty=actor.get('/services/threads?offset=200').json()
    assert empty['items']==[] and not empty['has_more']
    assert len(actor.get('/services/threads?limit=200').json()['items'])==200
    assert actor.get('/services/threads?offset=9007199254740991').json()['items']==[]


@pytest.mark.parametrize('query',['offset=-1','offset=1.5','offset=9007199254740992','limit=0','limit=201','limit=1.5'])
def test_history_bounds(actor,query):
    assert actor.get('/services/threads?'+query).status_code==422


def test_scope_and_account_filters_are_preserved(actor):
    seed(actor,101)
    other=Actor(actor.client)
    seed(other,2)
    identity=actor.post('/services/identities',json={'name':'Synthetic lens'}).json()
    seed(actor,2,identity_id=identity['id'])
    assert len(actor.get('/services/threads?offset=100').json()['items'])==1
    assert len(other.get('/services/threads').json()['items'])==2
    assert len(actor.get('/services/threads?identity_id='+identity['id']).json()['items'])==2
    assert other.get('/services/threads?identity_id='+identity['id']).status_code==404
    assert actor.get('/services/threads?dataset_id=missing-dataset').json()['items']==[]
