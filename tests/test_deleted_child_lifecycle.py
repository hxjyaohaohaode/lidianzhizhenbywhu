"""2026-09-30: logical-child deletion and retained legacy history, isolated fixtures.

ResearchProviders is a local provider double. No live suppliers are called.
"""
import pytest

from conftest import Actor
from server import workspace_store as ws
from server.store import encode, now, uid
from test_adaptive import ResearchProviders, completed


TEXT='仅供隔离测试：核验企业经营变化及现金情况、毛利率和采购成本，不代表真实企业经营。'*5


def ok(response, status=200):
    assert response.status_code==status,response.text
    return response.json()


def capture(actor, suffix=''):
    return ok(actor.post('/evidence',json={'global_scope':True,'title':'隔离测试资料'+suffix,'text':TEXT+suffix}),201)


def rows(store, user, kind):
    return store.all('SELECT * FROM workspace_objects WHERE user_id=? AND kind=? ORDER BY id',(user,kind))


def reviewed_run(actor, dataset=None, **fields):
    run=completed(actor,dataset=dataset,use_llm=True,**fields)
    claim=run['result']['llm']['review']['claims'][0]
    review=ok(actor.post('/workspace/runs/'+run['id']+'/reviews',json={
        'claim_id':claim['id'],'verdict':'accepted','note':'隔离测试中人工核对解释依据'}))
    context=ok(actor.get('/workspace/runs/'+run['id']+'/assessment'))['review_context']['hash']
    assessment=ok(actor.post('/workspace/runs/'+run['id']+'/assessment',json={
        'verdict':'useful','note':'隔离测试中人工核对已完成报告','expected_capabilities':['quant'],
        'consent_replay':True,'review_context_hash':context}))
    return run,review,assessment


def delete_conversations(actor, sessions, batch):
    if batch:
        return actor.post('/conversations/delete-batch',json={
            'ids':[s['id'] for s in sessions],'versions':{s['id']:s['version'] for s in sessions}})
    assert len(sessions)==1
    return actor.delete('/conversations/'+sessions[0]['id'],params={'version':sessions[0]['version']})


def test_more_than_200_evidence_create_delete_cycles_keep_capacity(actor):
    store=actor.client.app.state.store
    for i in range(201):
        document=capture(actor,str(i))
        ok(actor.delete('/evidence/'+document['id'],params={'version':document['version']}))
    assert rows(store,actor.user['id'],'evidence_review')==[]
    assert store.one('SELECT count(*) AS n FROM evidence_chunks')['n']==0
    assert store.one('SELECT count(*) AS n FROM evidence_fts')['n']==0
    assert len(ok(actor.get('/workspace/evidence'))['items'])==0
    assert capture(actor,'after-capacity-regression')['version']==1
    assert store.one("SELECT count(*) AS n FROM audit WHERE user_id=? AND resource='evidence_review' AND action='deleted_with_parent'",(actor.user['id'],))['n']==201


def test_evidence_delete_rechecks_owner_version_and_preserves_history(actor):
    other=Actor(actor.client);document=capture(actor);store=actor.client.app.state.store
    review=rows(store,actor.user['id'],'evidence_review')[0]
    with store.transaction() as db:
        foreign=ws.save(store,db,other.user['id'],'evidence_review',{'note':'foreign isolated fixture'},key=document['id'])
    before=store.all('SELECT * FROM audit ORDER BY seq')
    path='/evidence/'+document['id']
    assert actor.delete(path).status_code==428
    assert actor.delete(path,params={'version':2}).status_code==409
    assert other.delete(path,params={'version':1}).status_code==404
    assert rows(store,actor.user['id'],'evidence_review')==[review]
    assert store.all('SELECT * FROM audit ORDER BY seq')==before
    ok(actor.delete(path,params={'version':1}))
    assert rows(store,actor.user['id'],'evidence_review')==[]
    assert rows(store,other.user['id'],'evidence_review')==[foreign]
    assert store.all('SELECT * FROM audit WHERE seq<=? ORDER BY seq',(before[-1]['seq'],))==before


def test_evidence_delete_rollback_restores_children_and_fts(actor,monkeypatch):
    document=capture(actor);store=actor.client.app.state.store
    review=rows(store,actor.user['id'],'evidence_review');before=store.all('SELECT * FROM audit ORDER BY seq')
    original=store.audit
    def fail_root_audit(db,user,resource,id,action,metadata=None):
        if resource=='evidence' and action=='deleted':raise RuntimeError('injected deletion failure')
        return original(db,user,resource,id,action,metadata)
    monkeypatch.setattr(store,'audit',fail_root_audit)
    assert actor.delete('/evidence/'+document['id'],params={'version':1}).status_code==500
    assert store.owned('evidence',actor.user['id'],document['id'])==document
    assert rows(store,actor.user['id'],'evidence_review')==review
    assert store.all('SELECT * FROM audit ORDER BY seq')==before
    assert ok(actor.get('/retrieval',params={'q':'毛利率现金情况'}))['items']


def test_evidence_delete_keeps_frozen_report_plan_and_action(actor):
    document=capture(actor);dataset=actor.dataset();run=completed(actor,dataset=dataset)
    assert run['snapshot']['citations']
    action=ok(actor.post('/workspace/actions',json={'dataset_id':dataset['id'],'title':'核对来源资料','acceptance':'核对原始资料后人工验收'}),201)
    action=ok(actor.put('/workspace/actions/'+action['id']+'/status',json={
        'version':action['version'],'status':'in_progress','note':'使用已选资料核验','evidence_ids':[document['id']],'evidence_refs':[actor.evidence_ref(document)]}))
    assert action['payload']['history'][-1]['evidence_snapshots']
    store=actor.client.app.state.store;plans=rows(store,actor.user['id'],'plan')
    ok(actor.delete('/evidence/'+document['id'],params={'version':1}))
    assert store.owned('runs',actor.user['id'],run['id'])==run
    assert rows(store,actor.user['id'],'plan')==plans
    assert ws.get(store,actor.user['id'],'action',action['id'])['payload']==action['payload']
    assert ok(actor.get('/runs/'+run['id']+'/export'))['citations']
    assert rows(store,actor.user['id'],'evidence_review')==[]


@pytest.mark.parametrize('batch',[False,True])
def test_conversation_deletion_cleans_only_live_owned_reviews(factory,batch):
    actor=Actor(factory(providers=ResearchProviders()));other=Actor(actor.client)
    dataset=actor.dataset();first,_,_=reviewed_run(actor,dataset)
    second,_,_=reviewed_run(actor,dataset,session_id=first['session_id'])
    kept,_,_=reviewed_run(actor,dataset)
    foreign,_,_=reviewed_run(other)
    target_runs=[first,second]
    if batch:
        extra,_,_=reviewed_run(actor,dataset);target_runs.append(extra)
    action=ok(actor.post('/workspace/actions',json={'dataset_id':dataset['id'],
        'source_ref':{'kind':'report','run_id':first['id']},'title':'保留独立行动','acceptance':'保留原始报告依据并人工核验'}),201)
    # The new action changes assessment context; explicitly re-consent before replay.
    assessment=ok(actor.get('/workspace/runs/'+first['id']+'/assessment'))
    ok(actor.post('/workspace/runs/'+first['id']+'/assessment',json={
        'version':assessment['item']['version'],'verdict':'useful','note':'重新核对关联行动后的报告',
        'expected_capabilities':['quant'],'consent_replay':True,'review_context_hash':assessment['review_context']['hash']}))
    strategy=ok(actor.post('/workspace/strategies',json={'name':'隔离测试策略','note':'用于核对历史回放保存边界'}),201)
    evaluation=ok(actor.post('/workspace/strategies/'+strategy['id']+'/evaluate',json={}),201)
    assert any(b['run_id']==first['id'] for b in evaluation['payload']['case_bindings'])
    store=actor.client.app.state.store;user=actor.user['id']
    plans=rows(store,user,'plan');before=store.all('SELECT * FROM audit ORDER BY seq')
    foreign_reviews={k:rows(store,other.user['id'],k) for k in ('claim_review','assessment')}
    sessions=[store.owned('conversations',user,id) for id in dict.fromkeys(r['session_id'] for r in target_runs)]
    ok(delete_conversations(actor,sessions,batch))
    assert all(store.owned('runs',user,r['id']) is None for r in target_runs)
    assert store.owned('runs',user,kept['id'])==kept
    assert store.owned('runs',other.user['id'],foreign['id'])==foreign
    for kind in ('claim_review','assessment'):
        assert len(rows(store,user,kind))==1
        assert rows(store,user,kind)[0]['payload']['run_id']==kept['id']
        assert rows(store,other.user['id'],kind)==foreign_reviews[kind]
    assert ws.get(store,user,'action',action['id'])['payload']==action['payload']
    assert ws.get(store,user,'strategy_evaluation',evaluation['id'])==evaluation
    assert rows(store,user,'plan')==plans
    assert store.all('SELECT * FROM audit WHERE seq<=? ORDER BY seq',(before[-1]['seq'],))==before
    assert ok(actor.get('/workspace/evolution'))['observations']['consented_cases']==1
    assert store.all('PRAGMA foreign_key_check')==[]


@pytest.mark.parametrize('batch',[False,True])
def test_conversation_delete_rejects_stale_foreign_and_missing_versions_without_cleanup(factory,batch):
    actor=Actor(factory(providers=ResearchProviders()));other=Actor(actor.client)
    run,_,_=reviewed_run(actor);store=actor.client.app.state.store;user=actor.user['id']
    session=store.owned('conversations',user,run['session_id'])
    before=store.all('SELECT * FROM workspace_objects ORDER BY id');audit=store.all('SELECT * FROM audit ORDER BY seq')
    stale={**session,'version':session['version']+1}
    assert delete_conversations(actor,[stale],batch).status_code==409
    assert delete_conversations(other,[session],batch).status_code==404
    missing=actor.post('/conversations/delete-batch',json={'ids':[session['id']]}) if batch else actor.delete('/conversations/'+session['id'])
    assert missing.status_code==428
    assert store.all('SELECT * FROM workspace_objects ORDER BY id')==before
    assert store.all('SELECT * FROM audit ORDER BY seq')==audit
    assert store.owned('runs',user,run['id'])==run


@pytest.mark.parametrize('batch',[False,True])
def test_conversation_cleanup_rolls_back_with_parent_failure(factory,monkeypatch,batch):
    actor=Actor(factory(providers=ResearchProviders()));store=actor.client.app.state.store;user=actor.user['id']
    target=[reviewed_run(actor)[0] for _ in range(2 if batch else 1)]
    sessions=[store.owned('conversations',user,r['session_id']) for r in target]
    before=store.all('SELECT * FROM workspace_objects ORDER BY id');audit=store.all('SELECT * FROM audit ORDER BY seq')
    original=store.audit
    def fail_last_root(db,user,resource,id,action,metadata=None):
        if resource=='conversations' and id==sessions[-1]['id']:raise RuntimeError('injected final root failure')
        return original(db,user,resource,id,action,metadata)
    monkeypatch.setattr(store,'audit',fail_last_root)
    assert delete_conversations(actor,sessions,batch).status_code==500
    assert store.all('SELECT * FROM workspace_objects ORDER BY id')==before
    assert store.all('SELECT * FROM audit ORDER BY seq')==audit
    for run in target:assert store.owned('runs',user,run['id'])==run


@pytest.mark.parametrize('invalid',['foreign','stale'])
def test_batch_checks_every_root_before_deleting_any_child(factory,invalid):
    actor=Actor(factory(providers=ResearchProviders()));other=Actor(actor.client)
    store=actor.client.app.state.store;first=reviewed_run(actor)[0]
    second=reviewed_run(other if invalid=='foreign' else actor)[0]
    sessions=[store.one('SELECT * FROM conversations WHERE id=?',(r['session_id'],)) for r in (first,second)]
    if invalid=='stale':sessions[-1]['version']+=1
    before=store.all('SELECT * FROM workspace_objects ORDER BY id');audit=store.all('SELECT * FROM audit ORDER BY seq')
    assert delete_conversations(actor,sessions,True).status_code==(404 if invalid=='foreign' else 409)
    assert store.all('SELECT * FROM workspace_objects ORDER BY id')==before
    assert store.all('SELECT * FROM audit ORDER BY seq')==audit
    assert store.owned('runs',actor.user['id'],first['id'])==first


@pytest.mark.parametrize('kind,limit',[('evidence_review',200),('assessment',200),('claim_review',1000)])
def test_legacy_orphans_remain_exportable_without_blocking_current_capacity(factory,kind,limit):
    actor=Actor(factory(providers=ResearchProviders()));store=actor.client.app.state.store;user=actor.user['id']
    run=completed(actor,use_llm=True) if kind!='evidence_review' else None
    # Legacy rows explicitly model the pre-fix API deletion bug. A future timestamp
    # makes them outrank current rows, proving parent filtering happens before LIMIT.
    with store.transaction() as db:
        for i in range(limit):
            parent='deleted-fixture-'+str(i)
            row=ws.save(store,db,user,kind,{'run_id':parent,'note':'原始孤立历史，必须仍可导出'},key=parent)
            db.execute('UPDATE workspace_objects SET updated_at=? WHERE id=?',('9999-01-01',row['id']))
    legacy=rows(store,user,kind);before=store.all('SELECT * FROM audit ORDER BY seq')
    assert ws.objects(store,user,kind)==[]
    if kind=='evidence_review':
        current=capture(actor,'current')
        visible=ok(actor.get('/workspace/evidence'))['items']
        assert visible[0]['id']==current['id'] and visible[0]['eligible'] and visible[0]['review_version']==1
    elif kind=='assessment':
        current=ok(actor.post('/workspace/runs/'+run['id']+'/assessment',json={
            'verdict':'useful','note':'孤立历史不能耗尽当前验收容量'}))
        assert [r['id'] for r in ok(actor.get('/workspace/evolution'))['assessments']]==[current['id']]
    else:
        current=ok(actor.post('/workspace/runs/'+run['id']+'/reviews',json={
            'claim_id':run['result']['llm']['review']['claims'][0]['id'],
            'verdict':'accepted','note':'孤立历史不能耗尽当前解释复核容量'}))
        assert [r['id'] for r in ok(actor.get('/workspace/runs/'+run['id']+'/reviews'))['items']]==[current['id']]
    assert len(ws.objects(store,user,kind,1))==1
    exported=ok(actor.get('/workspace/export'))['data']['workspace_objects']
    saved={r['id']:r for r in exported}
    assert all(saved[r['id']]==r for r in legacy)
    assert store.all('SELECT * FROM audit WHERE seq<=? ORDER BY seq',(before[-1]['seq'],))==before


@pytest.mark.parametrize('kind',[ 'evidence_review','assessment','claim_review'])
def test_current_child_filter_never_borrows_another_owners_parent(actor,kind):
    other=Actor(actor.client);store=actor.client.app.state.store
    parent=capture(other) if kind=='evidence_review' else other.run().json()
    with store.transaction() as db:
        child=ws.save(store,db,actor.user['id'],kind,{'run_id':parent['id']},key=parent['id'])
    assert ws.objects(store,actor.user['id'],kind)==[]
    assert rows(store,actor.user['id'],kind)==[child]


@pytest.mark.parametrize('kind,limit',[('evidence_review',200),('assessment',200),('claim_review',1000)])
def test_current_review_capacity_limit_is_not_increased(actor,kind,limit):
    store=actor.client.app.state.store;user=actor.user['id'];at=now()
    if kind!='evidence_review':
        run=actor.run().json()
    # Bounded database fixtures exercise the unchanged live-child quota without
    # hundreds of model executions. Every counted row has an owner-matched parent.
    with store.transaction() as db:
        for i in range(limit):
            if kind=='evidence_review':
                parent=uid()
                db.execute('INSERT INTO evidence VALUES(?,?,?,?,?,?,?)',(parent,user,encode({'text':str(i)}),1,uid(),at,at))
            elif kind=='assessment':
                parent=uid()
                db.execute('INSERT INTO runs(id,user_id,session_id,dataset_id,state,payload,snapshot,created_at,updated_at,idempotency_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                    (parent,user,run['session_id'],run['dataset_id'],'queued','{}','{}',at,at,uid(),uid()))
            else:parent=run['id']
            ws.save(store,db,user,kind,{'run_id':parent},key=parent if kind!='claim_review' else parent+':'+str(i))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as failure:
        with store.transaction() as db:ws.save(store,db,user,kind,{'run_id':parent},key='one-over-current-limit')
    assert failure.value.status_code==409
    assert failure.value.detail['code']=='RESOURCE_LIMIT'
    assert len(ws.objects(store,user,kind,limit+1))==limit
