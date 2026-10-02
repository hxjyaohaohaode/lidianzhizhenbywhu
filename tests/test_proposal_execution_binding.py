"""Proposal previews never authorize execution outside atomic confirmation."""
import concurrent.futures

import pytest

from conftest import Actor, editable
from test_services import ok, thread, proposal, confirm
from server import workspace_store as ws
from server.store import digest, encode
from server.security import fail


def preview_plan(actor, p):
    return ok(actor.get('/workspace/plans/'+p['payload']['plan_id']))


def execute(actor, plan):
    return actor.post('/workspace/plans/'+plan['id']+'/execute',json={
        'version':plan['version'],'fingerprint':plan['payload']['fingerprint'],'external_consent':True})


def test_preview_is_read_only_even_with_direct_plan_consent(actor):
    p=ok(proposal(actor,thread(actor,actor.dataset())),201);plan=preview_plan(actor,p)
    assert plan['payload']['status']=='proposal_preview'
    assert plan['payload']['proposal_id']==p['id']
    assert ok(execute(actor,plan),409)['error']['code']=='PROPOSAL_CONFIRMATION_REQUIRED'
    assert ok(actor.get('/runs'))['items']==[]
    other=Actor(actor.client)
    ok(execute(other,plan),404)
    ok(confirm(other,p),404)


@pytest.mark.parametrize('remove',['proposal','thread'])
@pytest.mark.parametrize('legacy',[False,True])
def test_removed_preview_cannot_execute_even_with_fresh_plan_version(actor,remove,legacy):
    t=thread(actor,actor.dataset());p=ok(proposal(actor,t),201);plan=preview_plan(actor,p)
    if legacy:
        # Older releases stored linked previews as ordinary draft plans.
        payload=plan['payload'];payload.pop('proposal_id');payload['status']='draft'
        payload['fingerprint']=digest({k:v for k,v in payload.items() if k!='fingerprint'})
        q=p['payload'];q['plan_fingerprint']=payload['fingerprint']
        q['fingerprint']=digest({k:v for k,v in q.items() if k!='fingerprint'})
        with actor.client.app.state.store.transaction() as db:
            for row,value in ((plan,payload),(p,q)):
                db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(value),row['id']))
        ok(execute(actor,plan),409)
    path='/services/proposals/'+p['id'] if remove=='proposal' else '/services/threads/'+t['id']
    ok(actor.delete(path+'?version=1'))
    current=preview_plan(actor,p)
    assert current['payload']['status']=='cancelled'
    ok(execute(actor,current),409)
    assert ok(actor.get('/runs'))['items']==[]


def test_failed_proposal_save_rolls_back_preview_and_its_audit(actor,monkeypatch):
    t=thread(actor,actor.dataset());store=actor.client.app.state.store;save=ws.save
    before=store.one('SELECT count(*) n FROM audit')['n']
    def reject(store,db,user,kind,payload,**kwargs):
        if kind=='assistant_proposal':fail('RESOURCE_LIMIT','injected proposal quota failure',409)
        return save(store,db,user,kind,payload,**kwargs)
    monkeypatch.setattr(ws,'save',reject)
    ok(proposal(actor,t),409)
    assert ws.objects(store,actor.user['id'],'plan')==[]
    assert ws.objects(store,actor.user['id'],'assistant_proposal')==[]
    assert store.one('SELECT count(*) n FROM audit')['n']==before


def test_failed_confirmation_save_rolls_back_run_and_can_be_retried(actor,monkeypatch):
    p=ok(proposal(actor,thread(actor,actor.dataset())),201);store=actor.client.app.state.store;save=ws.save
    before=store.one('SELECT count(*) n FROM conversations')['n']
    def reject(store,db,user,kind,payload,**kwargs):
        if kind=='assistant_proposal' and payload['status']=='executed':
            raise RuntimeError('simulated crash before proposal commit')
        return save(store,db,user,kind,payload,**kwargs)
    with monkeypatch.context() as m:
        m.setattr(ws,'save',reject)
        assert confirm(actor,p).status_code==500
    assert ok(actor.get('/runs'))['items']==[]
    assert store.one('SELECT count(*) n FROM conversations')['n']==before
    assert preview_plan(actor,p)['payload']['status']=='proposal_preview'
    assert ok(confirm(actor,p))['payload']['result']['run_id']
    assert len(ok(actor.get('/runs'))['items'])==1


def test_concurrent_confirmation_creates_one_run_and_survives_thread_deletion(actor):
    t=thread(actor,actor.dataset());p=ok(proposal(actor,t),201)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        replies=list(pool.map(lambda _:ok(confirm(actor,p)),range(4)))
    ids={r['payload']['result']['run_id'] for r in replies}
    assert len(ids)==1
    assert len(ok(actor.get('/runs'))['items'])==1
    run=ok(actor.get('/runs/'+ids.pop()))
    ok(actor.delete('/services/threads/'+t['id']+'?version=1'))
    completed=actor.execute(run)
    assert completed['state'] in ('succeeded','degraded') and completed['result']
    assert ok(execute(actor,preview_plan(actor,p)),202)['id']==run['id']


def test_confirmation_keeps_current_input_and_fingerprint_gates(actor):
    data=actor.dataset();p=ok(proposal(actor,thread(actor,data)),201)
    ok(confirm(actor,p,fingerprint='0'*64),409)
    changed=editable(data);changed['periods'][0]['revenue']+=1
    ok(actor.put('/datasets/'+data['id'],json=changed))
    ok(confirm(actor,p),409)
    assert ok(actor.get('/runs'))['items']==[]


def test_bound_adaptive_research_requires_consent_and_dispatches_only_once(factory):
    from test_adaptive import ResearchProviders
    providers=ResearchProviders();actor=Actor(factory(providers))
    t=thread(actor,actor.dataset())
    p=ok(proposal(actor,t,use_llm=True,provider='alpha',max_calls=1,execution={}),201)
    ok(execute(actor,preview_plan(actor,p)),409)
    assert ok(confirm(actor,p),403)['error']['code']=='EXTERNAL_CONSENT'
    assert providers.calls==[] and ok(actor.get('/runs'))['items']==[]
    run_id=ok(confirm(actor,p,external_consent=True))['payload']['result']['run_id']
    ok(actor.delete('/services/threads/'+t['id']+'?version=1'))
    run=actor.execute(ok(actor.get('/runs/'+run_id)))
    assert run['state'] in ('succeeded','degraded') and run['result']
    assert len(providers.calls)==1
    assert ok(execute(actor,preview_plan(actor,p)),202)['id']==run_id
    assert len(providers.calls)==1
