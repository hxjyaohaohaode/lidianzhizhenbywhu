"""Synthetic local action journeys; no external suppliers or business data."""
import copy
import pytest
from conftest import Actor
from server.store import encode


def ok(response, code=200):
    assert response.status_code == code, response.text
    return response.json()


def create(actor, **values):
    return ok(actor.post('/workspace/actions', json={
        'title': '核对验收资料', 'owner': '初始负责人', 'due_at': '2026-10-01',
        'acceptance': '核对原始凭据并保留结果', **values}), 201)


def edit_body(row, **values):
    p=row['payload']
    return {'version': row['version'], **{k:p[k] for k in
        ('title','owner','due_at','priority','acceptance','description')},
        'note':'负责人调整并重新确认期限', **values}


def test_reassign_reschedule_keeps_origin_and_status_history(actor):
    first=create(actor)
    active=ok(actor.put('/workspace/actions/'+first['id']+'/status',json={'version':1,'status':'in_progress','note':'启动原始凭据核对'}))
    revised=ok(actor.put('/workspace/actions/'+first['id'],json=edit_body(active,owner='新负责人',due_at='2026-10-08',title='复核验收资料',priority='high',acceptance='复核差异并提交书面结论',description='新补充的工作说明')))
    assert revised['version']==3
    p=revised['payload']
    assert p['status']=='in_progress' and p['history']==active['payload']['history']
    assert p['origin']==first['payload']['origin']
    assert p['changes'][0]['fields']['owner']=={'before':'初始负责人','after':'新负责人'}
    assert p['changes'][0]['actor_id']==actor.user['id']
    cleared=ok(actor.put('/workspace/actions/'+first['id'],json=edit_body(revised,due_at=None,owner='')))
    assert cleared['payload']['changes'][0]==p['changes'][0]
    assert cleared['payload']['due_at'] is None
    completed=ok(actor.put('/workspace/actions/'+first['id']+'/status',json={'version':4,'status':'done','note':'核对完成并通过人工验收'}))
    assert completed['payload']['changes']==cleared['payload']['changes']
    assert actor.put('/workspace/actions/'+first['id'],json=edit_body(completed,title='修改已验收事项')).status_code==409
    reopened=ok(actor.put('/workspace/actions/'+first['id']+'/status',json={'version':5,'status':'open','note':'新要求需重新打开核对'}))
    ok(actor.put('/workspace/actions/'+first['id'],json=edit_body(reopened,title='重新打开后的资料核对')))


def test_action_stale_ownership_and_noop_do_not_change_history(actor):
    row=create(actor); route='/workspace/actions/'+row['id']
    other=Actor(actor.client)
    assert other.put(route,json=edit_body(row,owner='不被授权的账户')).status_code==404
    assert actor.put(route,json=edit_body(row)).status_code==409
    ok(actor.put(route,json=edit_body(row,owner='新的负责人')))
    assert actor.put(route,json=edit_body(row,due_at='2026-11-01')).status_code==409
    assert actor.put(route+'/status',json={'version':1,'status':'in_progress'}).status_code==409
    latest=ok(actor.get('/workspace/actions'))['items'][0]
    assert latest['version']==2 and len(latest['payload']['changes'])==1


@pytest.mark.parametrize('patch',[
    {'identity_id':'other'}, {'dataset_id':'other'}, {'source_key':'changed'},
    {'status':'done'}, {'history':[]}, {'changes':[]}, {'origin':{}},
    {'note':'     '}, {'acceptance':'     '}, {'due_at':'not-a-date'},
    {'priority':'urgent'}, {'version':0}, {'owner':'x'*101}, {'title':''},
])
def test_action_edit_rejects_invalid_or_immutable_fields(actor,patch):
    row=create(actor)
    assert actor.put('/workspace/actions/'+row['id'],json=edit_body(row,**patch)).status_code==422
    assert ok(actor.get('/workspace/actions'))['items'][0]['version']==1


def test_bounded_history_never_truncates_old_records(actor):
    row=create(actor); store=actor.client.app.state.store;p=copy.deepcopy(row['payload'])
    p['changes']=[{'note':'历史修改','fields':{'owner':{'before':'一','after':'二'}}} for _ in range(100)]
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(p),row['id']))
    assert actor.put('/workspace/actions/'+row['id'],json=edit_body(row,owner='达到上限不覆盖')).status_code==409
    latest=ok(actor.get('/workspace/actions'))['items'][0]
    assert latest['payload']==p and latest['version']==1


def test_manual_actions_are_identity_scoped_and_deduped_per_identity(actor):
    d=actor.dataset(); other_d=actor.dataset()
    i=ok(actor.post('/services/identities',json={'name':'验收身份一','dataset_ids':[d['id']]}),201)
    j=ok(actor.post('/services/identities',json={'name':'验收身份二','dataset_ids':[d['id']]}),201)
    row=create(actor,identity_id=i['id'],dataset_id=d['id'],source_key='same-source')
    assert row['payload']['identity_id']==i['id'] and row['payload']['company']==d['payload']['company']
    assert create(actor,identity_id=i['id'],dataset_id=d['id'],source_key='same-source')['id']==row['id']
    assert create(actor,identity_id=j['id'],dataset_id=d['id'],source_key='same-source')['id']!=row['id']
    assert actor.post('/workspace/actions',json={'title':'越界行动','acceptance':'检查不在身份范围的数据','identity_id':i['id'],'dataset_id':other_d['id']}).status_code==403
    other=Actor(actor.client)
    assert other.post('/workspace/actions',json={'title':'越权行动','acceptance':'不允许引用其他账号身份','identity_id':i['id']}).status_code==404
    modified=ok(actor.put('/workspace/actions/'+row['id'],json=edit_body(row,owner='改派负责人')))
    assert modified['payload']['identity_id']==i['id'] and modified['payload']['dataset_id']==d['id']


def test_legacy_copilot_action_can_be_edited_without_rewriting_history(actor):
    row=create(actor);store=actor.client.app.state.store;p=copy.deepcopy(row['payload'])
    p.pop('origin');p.pop('changes');p['history']=[{'at':row['created_at'],'from':None,'to':'open','note':'旧版助手确认创建','evidence_ids':[]}]
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(p),row['id']))
    revised=ok(actor.put('/workspace/actions/'+row['id'],json=edit_body(row,owner='重新指定负责人')))
    assert revised['payload']['history']==p['history']
    assert revised['payload']['origin']['owner']==p['owner']


def test_action_evidence_selection_rechecks_scope_and_eligibility(actor):
    row=create(actor,company='测试企业');route='/workspace/actions/'+row['id']+'/status'
    evidence=ok(actor.post('/evidence',json={'title':'合成原始验收资料','text':'用于测试行动关联的原始证据。'*15,'company':'其他企业'}),201)
    body={'version':1,'status':'in_progress','note':'启动关联证据核对','evidence_ids':[evidence['id']],'evidence_refs':[actor.evidence_ref(evidence)]}
    assert actor.put(route,json=body).status_code==409
    catalog=ok(actor.get('/workspace/evidence'))['items'];doc=next(e for e in catalog if e['id']==evidence['id'])
    ok(actor.put('/workspace/evidence/'+evidence['id']+'/review',json={'version':doc['review_version'],'company':'测试企业','status':'accepted','note':'人工核对原文及企业适用范围'}))
    body['evidence_refs']=[actor.evidence_ref(evidence)]
    revised=ok(actor.put(route,json=body))
    assert revised['payload']['history'][-1]['evidence_ids']==[evidence['id']]
    foreign=Actor(actor.client)
    assert foreign.put(route,json={**body,'version':2,'status':'blocked'}).status_code==404


def test_action_creation_rejects_blank_acceptance(actor):
    assert actor.post('/workspace/actions',json={'title':'空验收标准不应保存','acceptance':'     '}).status_code==422


@pytest.mark.parametrize('review',[
    {'status':'rejected','note':'排除不适用于此次验收的来源'},
    {'status':'accepted','note':'原文已审阅但有效期已过期','expires_at':'2020-01-01'},
])
def test_action_rejects_evidence_that_became_unavailable(actor,review):
    row=create(actor,company='测试企业')
    doc=ok(actor.post('/evidence',json={'title':'合成验收证据','text':'用于测试证据资格的原始内容。'*15,'company':'测试企业'}),201)
    selected=next(e for e in ok(actor.get('/workspace/evidence'))['items'] if e['id']==doc['id'])
    assert selected['eligible']
    ok(actor.put('/workspace/evidence/'+doc['id']+'/review',json={'version':selected['review_version'],'company':'测试企业',**review}))
    assert actor.put('/workspace/actions/'+row['id']+'/status',json={'version':1,'status':'in_progress','note':'使用已失效的旧选择应被拒绝','evidence_ids':[doc['id']],'evidence_refs':[{k:selected[k] for k in ('id','version','content_hash','review_version')}]}).status_code==409
    assert ok(actor.get('/workspace/actions'))['items'][0]['version']==1


def test_competing_edits_only_one_commits(actor):
    from concurrent.futures import ThreadPoolExecutor
    row=create(actor)
    def change(owner):
        return actor.put('/workspace/actions/'+row['id'],json=edit_body(row,owner=owner)).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(change,['并发负责人甲','并发负责人乙']))
    assert sorted(results)==[200,409]
    latest=ok(actor.get('/workspace/actions'))['items'][0]
    assert latest['version']==2 and len(latest['payload']['changes'])==1
