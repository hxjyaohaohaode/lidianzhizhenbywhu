"""Versioned cleanup frees real bounded capacity while preserving governance."""
from conftest import Actor
from server import workspace_store as ws


def ok(r,code=200):
    assert r.status_code==code,r.text
    return r.json()


def candidate(actor):
    return ok(actor.post('/workspace/strategies',json={'name':'显式测试候选','depth':'balanced','note':'测试可清理本地策略实验'}),201)


def test_strategy_cleanup_requires_current_version_owner_and_no_evaluations(actor):
    c=candidate(actor)
    ok(actor.delete('/workspace/strategies/'+c['id']),428)
    ok(actor.delete('/workspace/strategies/'+c['id']+'?version=2'),409)
    other=Actor(actor.client)
    ok(other.delete('/workspace/strategies/'+c['id']+'?version=1'),404)
    e=ok(actor.post('/workspace/strategies/'+c['id']+'/evaluate'),201)
    ok(actor.delete('/workspace/strategies/'+c['id']+'?version=1'),409)
    ok(actor.delete('/workspace/strategy-evaluations/'+e['id']+'?version=1'))
    ok(actor.delete('/workspace/strategies/'+c['id']+'?version=1'))
    assert not ok(actor.get('/workspace/evolution'))['candidates']


def test_current_and_rollback_strategy_evidence_is_protected(actor):
    first=candidate(actor);second=candidate(actor)
    e=ok(actor.post('/workspace/strategies/'+second['id']+'/evaluate'),201)
    store=actor.client.app.state.store
    # Isolated fixture for already-activated governance; never exercise activation bypass in product.
    with store.transaction() as db:
        ws.save(store,db,actor.user['id'],'strategy_active',{'candidate_id':second['id'],'evaluation_id':e['id'],'spec':second['payload'],'history':[{'candidate_id':first['id'],'spec':first['payload']}]},key='active')
    for c in (first,second):ok(actor.delete('/workspace/strategies/'+c['id']+'?version=1'),409)
    ok(actor.delete('/workspace/strategy-evaluations/'+e['id']+'?version=1'),409)


def test_evolution_exposes_every_retained_evaluation_for_cleanup(actor):
    c=candidate(actor);store=actor.client.app.state.store
    with store.transaction() as db:
        for n in range(51):ws.save(store,db,actor.user['id'],'strategy_evaluation',{'candidate_id':c['id'],'test_fixture_index':n})
    assert len(ok(actor.get('/workspace/evolution'))['evaluations'])==51


def test_two_real_activations_and_rollback_retain_evaluation_evidence(actor,example):
    from test_evolution import three_cases, candidate as make_candidate
    three_cases(actor,example)
    # Both policies must keep the same current source assessments so the first
    # remains a legitimate rollback target. The second improves node economy.
    first=make_candidate(actor,require_gap_analysis=True)
    ea=ok(actor.post('/workspace/strategies/'+first['id']+'/evaluate'),201)
    active=ok(actor.post('/workspace/strategies/'+first['id']+'/activate',json={'evaluation_id':ea['id'],'expected_active_version':0}))
    second=make_candidate(actor,name='减少非必要缺口节点',require_gap_analysis=False)
    eb=ok(actor.post('/workspace/strategies/'+second['id']+'/evaluate'),201)
    active=ok(actor.post('/workspace/strategies/'+second['id']+'/activate',json={'evaluation_id':eb['id'],'expected_active_version':active['version']}))
    assert active['payload']['history'][-1]['evaluation_id']==ea['id']
    ok(actor.delete('/workspace/strategy-evaluations/'+ea['id']+'?version=1'),409)
    restored=ok(actor.post('/workspace/strategies/rollback',json={'expected_active_version':active['version']}))
    assert restored['payload']['evaluation_id']==ea['id']
    ok(actor.delete('/workspace/strategy-evaluations/'+ea['id']+'?version=1'),409)
    ok(actor.delete('/workspace/strategy-evaluations/'+eb['id']+'?version=1'))
