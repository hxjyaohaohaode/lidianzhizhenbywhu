"""Malformed current reviews cannot poison replay governance or scoped cleanup."""
from copy import deepcopy

import pytest

from conftest import Actor
from server import workspace_store as ws
from server.store import digest, encode, now, uid
from test_business_provenance import action, ok
from test_claim_review_read_model import setup_review, corrupt
from test_deleted_child_lifecycle import delete_conversations
from test_evolution import assessment, candidate
from test_strategy_source_lifecycle import activate, assert_revoked
from test_adaptive import preview
from test_workspace_api import plan, execute


def assess_reviewed(actor, run):
    context = ok(actor.get('/workspace/runs/'+run['id']+'/assessment'))['review_context']
    return assessment(actor, run, review_context_hash=context['hash'])


def raw(store, table, id):
    row = store.db.execute('SELECT * FROM '+table+' WHERE id=?', (id,)).fetchone()
    return dict(row) if row else None


def assessment_body(saved, **updates):
    return {**{k:saved['payload'][k] for k in ('verdict','note','expected_capabilities','consent_replay')},
            'version':saved['version'], **updates}


@pytest.mark.parametrize('bad', ['{raw-review', None, [], {'verdict':'broken'}])
def test_unavailable_review_context_is_scoped_and_cannot_authorize_new_replay(factory, bad):
    actor, data, report, review = setup_review(factory); store = actor.client.app.state.store
    saved = assess_reviewed(actor, report)
    neighbor = execute(actor, plan(actor, data)); assess_reviewed(actor, neighbor)
    foreign = Actor(actor.client)
    healthy_neighbor = ok(actor.get('/workspace/runs/'+neighbor['id']+'/assessment'))
    strategy = candidate(actor)
    old_evaluation = ok(actor.post('/workspace/strategies/'+strategy['id']+'/evaluate', json={}), 201)
    corrupt(actor, review, bad, raw=isinstance(bad,str))
    before = {id:raw(store,'workspace_objects',id) for id in (saved['id'],review['id'],old_evaluation['id'])}
    frozen = raw(store,'runs',report['id']); changes = store.db.total_changes
    current = ok(actor.get('/workspace/runs/'+report['id']+'/assessment'))
    assert current['item']['payload'] == saved['payload']
    assert current['item']['feedback_context']['state'] == 'changed'
    assert current['item']['feedback_context']['available'] is False
    assert current['review_context']['items'] == [] and current['review_context']['available'] is False
    assert current['review_context']['unavailable'][0]['id'] == review['id']
    assert '无法核验' in current['item']['feedback_context']['message']
    assert ok(actor.get('/workspace/runs/'+neighbor['id']+'/assessment')) == healthy_neighbor
    overview = ok(actor.get('/workspace/evolution'))
    assert overview['observations']['consented_cases'] == 1
    assert ok(foreign.get('/workspace/evolution'))['observations']['consented_cases'] == 0
    assert foreign.get('/workspace/runs/'+report['id']+'/assessment').status_code == 404
    for hash in (saved['payload']['feedback_context_hash'], current['review_context']['hash']):
        response = actor.post('/workspace/runs/'+report['id']+'/assessment', json=assessment_body(saved, review_context_hash=hash))
        assert ok(response,409)['error']['code'] == 'REVIEW_CONTEXT_UNAVAILABLE'
    assert store.db.total_changes == changes and raw(store,'runs',report['id']) == frozen
    assert all(raw(store,'workspace_objects',id) == row for id,row in before.items())
    evaluation = ok(actor.post('/workspace/strategies/'+strategy['id']+'/evaluate', json={}),201)
    assert {b['run_id'] for b in evaluation['payload']['case_bindings']} == {neighbor['id']}
    assert not evaluation['payload']['eligible']
    assert raw(store,'workspace_objects',old_evaluation['id']) == before[old_evaluation['id']]


def test_explicit_withdrawal_survives_bad_json_without_replacing_assessed_bindings(factory):
    actor, data, report, review = setup_review(factory); store = actor.client.app.state.store
    saved = assess_reviewed(actor, report)
    corrupt(actor, review, '{bad-withdrawal', raw=True)
    original_review = raw(store,'workspace_objects',review['id']); original_run = raw(store,'runs',report['id'])
    before = store.db.total_changes
    stale = actor.post('/workspace/runs/'+report['id']+'/assessment', json=assessment_body(saved,version=0,consent_replay=False))
    assert ok(stale,409)['error']['code'] == 'VERSION_CONFLICT' and store.db.total_changes == before
    foreign = Actor(actor.client)
    assert foreign.post('/workspace/runs/'+report['id']+'/assessment', json=assessment_body(saved,consent_replay=False)).status_code == 404
    withdrawn = ok(actor.post('/workspace/runs/'+report['id']+'/assessment', json=assessment_body(saved,consent_replay=False)))
    assert withdrawn['version'] == saved['version']+1 and withdrawn['payload']['consent_replay'] is False
    expected = {**saved['payload'], 'consent_replay':False}
    assert withdrawn['payload'] == expected
    assert raw(store,'workspace_objects',review['id']) == original_review
    assert raw(store,'runs',report['id']) == original_run
    assert ok(actor.get('/workspace/evolution'))['observations']['consented_cases'] == 0


def test_nonconsenting_first_feedback_is_saveable_and_explicitly_unavailable(factory):
    actor, data, report, review = setup_review(factory); store = actor.client.app.state.store
    corrupt(actor, review, '{bad-first-feedback', raw=True)
    current = ok(actor.get('/workspace/runs/'+report['id']+'/assessment'))
    assert current['item'] is None and current['review_context']['available'] is False
    saved = assessment(actor,report,consent_replay=False)
    assert saved['payload']['feedback_context_unavailable'][0]['id'] == review['id']
    assert saved['payload']['claim_reviews'] == []
    current = ok(actor.get('/workspace/runs/'+report['id']+'/assessment'))
    assert current['item']['feedback_context']['available'] is False
    assert current['item']['feedback_context']['state'] == 'changed'
    response = actor.post('/workspace/runs/'+report['id']+'/assessment', json=assessment_body(saved,consent_replay=True,review_context_hash=current['review_context']['hash']))
    assert ok(response,409)['error']['code'] == 'REVIEW_CONTEXT_UNAVAILABLE'


def test_healthy_feedback_hash_and_review_order_remain_byte_compatible(factory):
    actor, data, report, review = setup_review(factory); store = actor.client.app.state.store
    context = ok(actor.get('/workspace/runs/'+report['id']+'/assessment'))['review_context']
    bindings = [{'kind':'claim_review','id':review['id'],'version':review['version'],'hash':digest(review['payload'])}]
    assert context == {'hash':digest(bindings),'bindings':bindings,'items':[review],'related_actions':[],'disputed':0}


@pytest.mark.parametrize('batch',[False,True])
@pytest.mark.parametrize('target',['affected','neighbor'])
@pytest.mark.parametrize('bad',['{bound-corruption',None,[],{},42])
def test_bad_review_does_not_block_scoped_versioned_conversation_cleanup(factory,batch,target,bad):
    actor, data, report, review = setup_review(factory); store = actor.client.app.state.store
    saved = assess_reviewed(actor,report); neighbor = execute(actor,plan(actor,data)); neighbor_assessment=assess_reviewed(actor,neighbor)
    independent = ok(action(actor,data,source_ref={'kind':'report','run_id':report['id']}),201)
    strategy = candidate(actor); evaluation=ok(actor.post('/workspace/strategies/'+strategy['id']+'/evaluate',json={}),201)
    foreign = Actor(actor.client)
    # Malformed unbound history and foreign bindings must not be guessed into the deletion.
    with store.transaction() as db:
        for owner,key in [(actor.user['id'],'missing-report:orphan'),(foreign.user['id'],report['id']+':foreign')]:
            db.execute('INSERT INTO workspace_objects VALUES(?,?,?,?,?,?,?,?)',(uid(),owner,'claim_review',key,'{unbound-corruption',1,now(),now()))
    corrupt(actor,review,bad,raw=isinstance(bad,str))
    selected = report if target=='affected' else neighbor
    kept = neighbor if target=='affected' else report
    session = store.owned('conversations',actor.user['id'],selected['session_id'])
    frozen = {kind:[dict(r) for r in store.db.execute('SELECT * FROM workspace_objects WHERE kind=? ORDER BY id',(kind,))]
              for kind in ('plan','action','strategy','strategy_evaluation')}
    unrelated = [dict(r) for r in store.db.execute("SELECT * FROM workspace_objects WHERE payload='{unbound-corruption' ORDER BY id")]
    kept_row = raw(store,'runs',kept['id']); original_audit=store.all('SELECT * FROM audit ORDER BY seq')
    before=store.db.total_changes
    assert delete_conversations(actor,[{**session,'version':session['version']+1}],batch).status_code == 409
    assert delete_conversations(foreign,[session],batch).status_code == 404
    assert store.db.total_changes == before
    ok(delete_conversations(actor,[session],batch))
    assert raw(store,'runs',selected['id']) is None and raw(store,'runs',kept['id']) == kept_row
    assert raw(store,'workspace_objects',review['id']) is None if target=='affected' else raw(store,'workspace_objects',review['id']) is not None
    assert all(rows == [dict(r) for r in store.db.execute('SELECT * FROM workspace_objects WHERE kind=? ORDER BY id',(kind,))] for kind,rows in frozen.items())
    assert unrelated == [dict(r) for r in store.db.execute("SELECT * FROM workspace_objects WHERE payload='{unbound-corruption' ORDER BY id")]
    assert store.all('SELECT * FROM audit WHERE seq<=? ORDER BY seq',(original_audit[-1]['seq'],)) == original_audit
    assert store.all('PRAGMA foreign_key_check') == []


@pytest.mark.parametrize('batch',[False,True])
@pytest.mark.parametrize('target',['key','payload'])
def test_conflicting_explicit_review_bindings_are_not_guessed_into_cleanup(factory,batch,target):
    actor,data,report,review=setup_review(factory);store=actor.client.app.state.store
    neighbor=execute(actor,plan(actor,data))
    corrupt(actor,review,{**review['payload'],'run_id':neighbor['id']})
    original=raw(store,'workspace_objects',review['id'])
    selected=report if target=='key' else neighbor
    session=store.owned('conversations',actor.user['id'],selected['session_id'])
    ok(delete_conversations(actor,[session],batch))
    assert raw(store,'runs',selected['id']) is None
    assert raw(store,'workspace_objects',review['id']) == original


def test_bad_review_of_active_case_revokes_future_policy_without_rewriting_old_evaluation(actor,example):
    runs, evaluation, active = activate(actor,example); old_plan=preview(actor); store=actor.client.app.state.store
    # An occupied current-review slot becomes unreadable after original consent.
    with store.transaction() as db:
        db.execute('INSERT INTO workspace_objects VALUES(?,?,?,?,?,?,?,?)',
            (uid(),actor.user['id'],'claim_review',runs[0]['id']+':unreadable','{bad-active-case',1,now(),now()))
    original = {row['id']:raw(store,'runs',row['id']) for row in runs}
    overview = ok(actor.get('/workspace/evolution'))
    assert overview['observations']['consented_cases'] == 2
    assert overview['active']['payload']['spec'] is None
    assert_revoked(actor,active,old_plan,evaluation)
    assert all(raw(store,'runs',id)==row for id,row in original.items())


@pytest.mark.parametrize('bad',['{capacity-broken',None,[],{},42])
def test_first_reviews_on_healthy_reports_do_not_decode_or_ignore_a_bad_occupied_slot(factory,bad):
    actor,data,report,review=setup_review(factory);store=actor.client.app.state.store
    first=execute(actor,plan(actor,data,use_llm=True),True)
    second=execute(actor,plan(actor,data,use_llm=True),True)
    foreign=Actor(actor.client)
    corrupt(actor,review,bad,raw=isinstance(bad,str))
    bad_row=raw(store,'workspace_objects',review['id'])
    frozen={row['id']:raw(store,'runs',row['id']) for row in (report,first,second)}
    for target in (first,second):
        body={'claim_id':target['result']['llm']['review']['claims'][0]['id'],
              'verdict':'accepted','note':'隔离合成健康报告的首次人工审阅'}
        before=store.db.total_changes
        assert foreign.post('/workspace/runs/'+target['id']+'/reviews',json=body).status_code == 404
        response=actor.post('/workspace/runs/'+target['id']+'/reviews',json={**body,'version':1})
        assert ok(response,409)['error']['code'] == 'VERSION_CONFLICT'
        assert store.db.total_changes == before
        created=ok(actor.post('/workspace/runs/'+target['id']+'/reviews',json=body))
        assert created['version'] == 1 and created['payload']['run_id'] == target['id']
        assert created['payload']['verdict'] == 'accepted'
    assert raw(store,'workspace_objects',review['id']) == bad_row
    assert all(raw(store,'runs',id)==row for id,row in frozen.items())


def test_known_unavailable_slot_still_counts_toward_the_unchanged_claim_review_limit(factory):
    actor,data,report,review=setup_review(factory);store=actor.client.app.state.store
    target=execute(actor,plan(actor,data,use_llm=True),True)
    corrupt(actor,review,'{capacity-broken',raw=True)
    # Bounded storage fixtures exercise the live quota without fabricating 999
    # provider claims. Their owner-matched parent and occupied keys are explicit.
    with store.transaction() as db:
        for index in range(999):
            db.execute('INSERT INTO workspace_objects VALUES(?,?,?,?,?,?,?,?)',
                (uid(),actor.user['id'],'claim_review',report['id']+':capacity-'+str(index),
                 encode({'run_id':report['id']}),1,now(),now()))
    before=store.db.total_changes;bad_row=raw(store,'workspace_objects',review['id'])
    response=actor.post('/workspace/runs/'+target['id']+'/reviews',json={
        'claim_id':target['result']['llm']['review']['claims'][0]['id'],
        'verdict':'accepted','note':'已达到原有容量，不能忽略占位坏记录'})
    assert ok(response,409)['error']['code'] == 'RESOURCE_LIMIT'
    assert store.db.total_changes == before and raw(store,'workspace_objects',review['id']) == bad_row
