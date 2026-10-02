"""Synthetic owner-scoped source → approval → lifecycle chains; no provider calls."""
from copy import deepcopy
from datetime import date
import pytest
from conftest import Actor, editable
from server.store import digest, encode
from server import workspace_store as ws
from server.copilot import evaluate_watches
from test_services import identity, thread, message, proposal, confirm, watch
from test_workspace_api import plan, execute, StudioProvider


def ok(response,code=200):
    assert response.status_code==code,response.text
    return response.json()


def action(actor,d=None,**values):
    return actor.post('/workspace/actions',json={'title':'核对来源并跟进业务事项',
        'acceptance':'核对原始凭据并记录人工验收结论','dataset_id':d['id'] if d else '',**values})


def revise(actor,d):
    body=editable(d);body['periods'][-1]['revenue']+=11
    return ok(actor.put('/datasets/'+d['id'],json=body))


def actions(actor):return ok(actor.get('/workspace/actions'))['items']


def test_current_dataset_origin_is_server_resolved_immutable_and_read_only(actor):
    d=actor.dataset();a=ok(action(actor,d,source_ref={'kind':'dataset','dataset_version':1,'dataset_hash':d['content_hash']}),201)
    p=a['payload']['provenance']
    assert (p['dataset_id'],p['dataset_version'],p['dataset_hash'])==(d['id'],1,d['content_hash'])
    assert a['source_impact']['state']=='current'
    revised=revise(actor,d)
    result=actions(actor)[0]
    assert result['payload']==a['payload'] and result['version']==1
    assert result['source_impact']['state']=='changed'
    assert result['source_impact']['baseline']['version']==1 and result['source_impact']['current']['version']==2
    assert action(actor,revised,source_ref={'kind':'dataset','dataset_version':1}).status_code==409
    assert action(actor,revised,provenance=p).status_code==422
    assert action(actor,revised,source_ref={'kind':'dataset','dataset_hash':'0'*64}).status_code==409
    ok(actor.delete('/datasets/'+d['id']+'?version=2'))
    after=actions(actor)[0]
    assert after['source_impact']['state']=='unavailable' and after['payload']==a['payload']


def test_report_source_requires_same_identity_and_explicit_historical_basis(actor):
    d=actor.dataset();i=identity(actor,d);j=identity(actor,d,name='另一服务视角')
    report=execute(actor,plan(actor,d,identity_id=i['id']))
    src={'kind':'report','run_id':report['id']}
    assert action(actor,d,source_ref=src).status_code==403
    assert action(actor,d,identity_id=j['id'],source_ref=src).status_code==403
    a=ok(action(actor,d,identity_id=i['id'],source_ref=src),201)
    assert a['payload']['provenance']['report_hash']==digest(report['result'])
    revised=revise(actor,d)
    assert action(actor,revised,identity_id=i['id'],source_ref=src).status_code==409
    historical=ok(action(actor,revised,identity_id=i['id'],source_ref={**src,'allow_historical':True}),201)
    assert historical['payload']['provenance']['dataset_version']==1
    assert historical['source_impact']['state']=='changed'
    foreign=Actor(actor.client)
    assert action(foreign,None,identity_id=i['id'],source_ref={**src,'allow_historical':True}).status_code==404


def test_claim_source_rejection_changes_overlay_not_historical_action(factory):
    actor=Actor(factory(providers=StudioProvider()));d=actor.dataset()
    report=execute(actor,plan(actor,d,use_llm=True),True)
    claim=report['result']['llm']['review']['claims'][0]
    src={'kind':'report','run_id':report['id'],'claim_id':claim['id']}
    other_claim=report['result']['llm']['review']['claims'][1]
    ok(actor.post('/workspace/runs/'+report['id']+'/reviews',json={'claim_id':other_claim['id'],'verdict':'rejected','note':'这条其他解释缺乏充分资料依据'}))
    a=ok(action(actor,d,source_ref=src),201)
    assert a['source_impact']['state']=='current'  # Unrelated claim review is not this claim's verdict.
    ok(actor.post('/workspace/runs/'+report['id']+'/reviews',json={'claim_id':claim['id'],'verdict':'rejected','note':'原解释缺少可支持该推断的证据'}))
    after=actions(actor)[0]
    assert after['payload']==a['payload']
    assert 'claim_rejected' in {r['code'] for r in after['source_impact']['reasons']}
    assert action(actor,d,source_ref=src).status_code==409
    assert action(actor,d,source_ref={**src,'claim_id':'unowned-claim'}).status_code==404


def test_copilot_action_retains_message_thread_proposal_and_source_fingerprint(actor):
    d=actor.dataset();i=identity(actor,d);t=thread(actor,d,i)
    msg=ok(message(actor,t),201)['message']
    p=ok(proposal(actor,t,'action',source_message_id=msg['id'],acceptance='核对原始资料并提交书面结果'),201)
    result=ok(confirm(actor,p));a=actions(actor)[0];origin=a['payload']['provenance']
    assert origin['proposal_id']==p['id'] and origin['thread_id']==t['id'] and origin['source_message_id']==msg['id']
    assert origin['message_hash']==digest(msg['payload']) and origin['dataset_hash']==d['content_hash']
    assert result['payload']['result']['action_id']==a['id']
    assert len(actions(actor))==1 and ok(confirm(actor,p))['id']==result['id']
    ok(actor.delete('/services/threads/'+t['id']+'?version=2'))
    after=actions(actor)[0]
    assert after['payload']==a['payload'] and after['source_impact']['state']=='unavailable'


def test_old_copilot_message_cannot_be_relabelled_with_new_dataset_or_identity(actor):
    d=actor.dataset();i=identity(actor,d);t=thread(actor,d,i);msg=ok(message(actor,t),201)['message']
    revise(actor,d)
    assert proposal(actor,t,'watch',source_message_id=msg['id']).status_code==409
    # A fresh source reflects the current input; unrelated old questions stay historical.
    newer=ok(message(actor,t,key='newer-message-02',version=2),201)['message']
    p=ok(proposal(actor,t,'watch',source_message_id=newer['id'],request_id='fresh-proposal-02'),201)
    ok(actor.put('/services/identities/'+i['id'],json={**i['payload'],'version':1,'objective':'已改成另一个审阅重点'}))
    assert confirm(actor,p).status_code==409
    assert proposal(actor,t,'watch',source_message_id=newer['id'],request_id='changed-lens-03').status_code==409
    assert ws.objects(actor.client.app.state.store,actor.user['id'],'watch')==[]


def test_copilot_proposal_rechecks_evidence_review_before_confirmation(actor):
    d=actor.dataset();doc=ok(actor.post('/evidence',json={'title':'现金流毛利率核查资料','text':'现金流毛利率来源资料与采购成本核对。'*40,'company':d['payload']['company']}),201)
    t=thread(actor,d);msg=ok(message(actor,t),201)['message']
    assert msg['payload']['response']['citations']
    p=ok(proposal(actor,t,'action',source_message_id=msg['id'],acceptance='保留原始凭据并核对关键差异'),201)
    review=next(e for e in ok(actor.get('/workspace/evidence'))['items'] if e['id']==doc['id'])
    ok(actor.put('/workspace/evidence/'+doc['id']+'/review',json={'version':review['review_version'],'company':d['payload']['company'],'status':'rejected','note':'此资料不适合用于当前企业推断'}))
    assert confirm(actor,p).status_code==409 and not actions(actor)
    assert ok(actor.get('/services/proposals/'+p['id']))['source_impact']['state']=='changed'


def test_watch_historical_origin_and_current_evaluation_remain_separate(actor):
    d=actor.dataset();report=execute(actor,plan(actor,d))
    revised=revise(actor,d);src={'kind':'report','run_id':report['id']}
    base={'title':'按历史研判设置的毛利率下限','dataset_id':d['id'],'metric':'gross_margin','operator':'lt','threshold':0.99,'stale_after_days':1460}
    assert actor.post('/services/watches',json={**base,'source_ref':src}).status_code==409
    w=ok(actor.post('/services/watches',json={**base,'source_ref':{**src,'allow_historical':True}}),201)
    assert w['payload']['provenance']['dataset_version']==1 and w['source_impact']['state']=='changed'
    result=evaluate_watches(actor.client.app.state.store,actor.user['id'],today=date(2026,10,1))['evaluations'][0]
    assert result['dataset_version']==2 and result['dataset_hash']==revised['content_hash'] and result['threshold']==0.99
    alerts=ws.objects(actor.client.app.state.store,actor.user['id'],'alert')
    assert alerts[0]['payload']['provenance']['rule_origin']==w['payload']['provenance']
    update={**base,'version':1,'threshold':0.5}
    changed=ok(actor.put('/services/watches/'+w['id'],json=update))
    assert changed['payload']['provenance']==w['payload']['provenance']
    assert changed['payload']['changes'][0]['fields']['threshold']=={'before':0.99,'after':0.5}
    assert actor.put('/services/watches/'+w['id'],json={**update,'version':2,'dataset_id':actor.dataset()['id']}).status_code==409
    assert alerts[0]['payload']['threshold']==0.99


def test_alert_action_retains_threshold_and_rejects_cross_identity(actor):
    d=actor.dataset();i=identity(actor,d);w=watch(actor,d,identity_id=i['id'])
    evaluate_watches(actor.client.app.state.store,actor.user['id'],today=date(2026,10,1))
    alert=ws.objects(actor.client.app.state.store,actor.user['id'],'alert')[0];src={'kind':'alert','alert_id':alert['id']}
    assert action(actor,d,source_ref=src).status_code==403
    a=ok(action(actor,d,identity_id=i['id'],source_ref=src),201)
    p=a['payload']['provenance']
    assert p['rule_id']==w['id'] and p['rule_version']==1 and p['alert_snapshot']['threshold']==0.99
    ok(actor.post('/services/alerts/'+alert['id']+'/acknowledge',json={'version':1,'note':'已核对提醒原始值和规则'}))
    assert actions(actor)[0]['source_impact']['state']=='current'
    ok(actor.delete('/services/alerts/'+alert['id']+'?version=2'))
    after=actions(actor)[0]
    assert after['source_impact']['state']=='unavailable' and after['payload']==a['payload']


def test_completion_freezes_scoped_evidence_content_and_review_history(actor):
    d=actor.dataset();a=ok(action(actor,d),201)
    doc=ok(actor.post('/evidence',json={'title':'保留的验收原始凭据','text':'此为隔离测试验收凭据。'*100,'company':d['payload']['company'],'source_url':'https://example.com/original'}),201)
    e=next(e for e in ok(actor.get('/workspace/evidence'))['items'] if e['id']==doc['id'])
    ref={k:e[k] for k in ('id','version','content_hash','review_version')}
    ok(actor.put('/workspace/actions/'+a['id']+'/status',json={'version':1,'status':'in_progress'}))
    accepted=ok(actor.put('/workspace/actions/'+a['id']+'/status',json={'version':2,'status':'done','note':'逐项核对凭据后完成人工验收','evidence_refs':[ref]}))
    snapshot=accepted['payload']['history'][-1]['evidence_snapshots'][0]
    assert snapshot['text']==doc['payload']['text'] and snapshot['review']==e['review'] and snapshot['review_hash']==digest(e['review'])
    assert snapshot['content_hash']==doc['content_hash'] and snapshot['version']==1
    ok(actor.put('/workspace/evidence/'+doc['id']+'/review',json={'version':e['review_version'],'company':d['payload']['company'],'status':'rejected','note':'后续核查发现该依据不适用'}))
    changed=actions(actor)[0]
    assert changed['acceptance_impact']['state']=='changed' and changed['payload']==accepted['payload']
    ok(actor.delete('/evidence/'+doc['id']+'?version=1'))
    deleted=actions(actor)[0]
    assert deleted['payload']['status']=='done' and deleted['payload']==accepted['payload']
    assert deleted['acceptance_impact']['reasons'][0]['code']=='evidence_removed'


def test_completion_rejects_stale_evidence_selection_and_foreign_evidence(actor):
    d=actor.dataset();a=ok(action(actor,d),201)
    doc=ok(actor.post('/evidence',json={'title':'版本核对凭据','text':'此为隔离测试版本核对凭据。'*20,'company':d['payload']['company']}),201)
    e=next(e for e in ok(actor.get('/workspace/evidence'))['items'] if e['id']==doc['id'])
    ref={k:e[k] for k in ('id','version','content_hash','review_version')}
    ok(actor.put('/workspace/evidence/'+doc['id']+'/review',json={'version':e['review_version'],'company':d['payload']['company'],'status':'accepted','note':'重新人工核对该来源的适用口径'}))
    assert actor.put('/workspace/actions/'+a['id']+'/status',json={'version':1,'status':'in_progress','evidence_refs':[ref]}).status_code==409
    assert actor.put('/workspace/actions/'+a['id']+'/status',json={'version':1,'status':'in_progress','evidence_refs':[ref,ref]}).status_code==422
    other=Actor(actor.client);foreign=ok(other.post('/evidence',json={'title':'其他账户私密凭据','text':'绝不能跨账户关联的测试凭据。'*20,'company':d['payload']['company']}),201)
    assert actor.put('/workspace/actions/'+a['id']+'/status',json={'version':1,'status':'in_progress','evidence_ids':[foreign['id']],'evidence_refs':[other.evidence_ref(foreign)]}).status_code==404
    assert actions(actor)[0]['version']==1


def test_legacy_action_unknown_provenance_is_not_filled_on_get(actor):
    d=actor.dataset();a=ok(action(actor,d),201);p=deepcopy(a['payload']);p.pop('provenance');p.pop('origin')
    p['history']=[{'at':'2020-01-01','status':'done','note':'旧验收历史','evidence_ids':['deleted-old-evidence']}];p['status']='done'
    store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(p),a['id']))
    before=store.one('SELECT payload,version,updated_at FROM workspace_objects WHERE id=?',(a['id'],))
    out=actions(actor)[0]
    assert out['source_impact']['state']=='unknown' and out['acceptance_impact']['state']=='unknown'
    assert store.one('SELECT payload,version,updated_at FROM workspace_objects WHERE id=?',(a['id'],))==before
    assert out['payload']==p


def test_explicit_insight_source_is_scoped_and_cannot_be_guessed(actor):
    d=actor.dataset();i=identity(actor,d)
    insights=ok(actor.get('/workspace/brief?identity_id='+i['id']))['insights']['items'];source=insights[0]
    ref={'kind':'insight','source_key':source['key']}
    a=ok(action(actor,d,identity_id=i['id'],source_ref=ref),201)
    assert a['payload']['provenance']['insight_snapshot']['proof']==source['proof']
    assert action(actor,d,source_ref=ref).status_code==409
    assert action(actor,d,identity_id=i['id'],source_ref={'kind':'insight','source_key':'invented-source'}).status_code==409


@pytest.mark.parametrize('change',['delete','narrow','dataset_delete'])
def test_orphan_history_is_owner_only_read_only_and_keeps_scope_closed(actor,change):
    d=actor.dataset();other_d=actor.dataset();i=identity(actor,d);t=thread(actor,d,i)
    ok(message(actor,t),201)
    a=ok(action(actor,d,identity_id=i['id']),201);w=watch(actor,d,identity_id=i['id'])
    store=actor.client.app.state.store
    evaluate_watches(store,actor.user['id'],today=date(2026,10,1))
    alert=ws.objects(store,actor.user['id'],'alert')[0]
    assert ok(actor.get('/services/history'))['items']==[]
    if change=='delete':ok(actor.delete('/services/identities/'+i['id']+'?version=1'))
    elif change=='narrow':ok(actor.put('/services/identities/'+i['id'],json={**i['payload'],'version':1,'dataset_ids':[other_d['id']]}))
    else:ok(actor.delete('/datasets/'+d['id']+'?version=1'))
    before=store.all('SELECT * FROM workspace_objects WHERE user_id=? ORDER BY id',(actor.user['id'],))
    receipts=store.all('SELECT * FROM tracking_receipts WHERE user_id=?',(actor.user['id'],))
    history=ok(actor.get('/services/history'))
    assert {r['id'] for r in history['items']}=={a['id'],w['id'],t['id'],alert['id']}
    assert all(r['read_only'] and r['archived_mode'] and r['source_impact']['state']=='unavailable' for r in history['items'])
    assert history['read_only'] and history['external_calls']==0
    assert all(r['payload'] and r['history_reason'] for r in history['items'])
    first=ok(actor.get('/services/history?limit=2'));second=ok(actor.get('/services/history?limit=2&offset=2'))
    assert first['has_more'] and first['next_offset']==2 and not second['has_more']
    assert {r['id'] for r in first['items']}.isdisjoint({r['id'] for r in second['items']})
    read=ok(actor.get('/services/threads/'+t['id']))
    assert read['archived_mode'] and read['read_only'] and read['messages']
    assert message(actor,t,key='no-restored-access',version=2).status_code in (403,404,409)
    denied=actor.put('/workspace/actions/'+a['id']+'/status',json={'version':1,'status':'in_progress'})
    assert denied.status_code==409 and denied.json()['error']['code']=='ACTION_CONTEXT_ARCHIVED'
    edit={k:a['payload'][k] for k in ('title','priority','owner','due_at','acceptance','description')}
    denied=actor.put('/workspace/actions/'+a['id'],json={**edit,'version':1,'owner':'不能自动重分配的负责人','note':'孤立历史记录不允许直接修改'})
    assert denied.status_code==409 and denied.json()['error']['code']=='ACTION_CONTEXT_ARCHIVED'
    assert store.all('SELECT * FROM workspace_objects WHERE user_id=? ORDER BY id',(actor.user['id'],))==before
    assert store.all('SELECT * FROM tracking_receipts WHERE user_id=?',(actor.user['id'],))==receipts
    foreign=Actor(actor.client)
    assert ok(foreign.get('/services/history'))['items']==[]
    assert foreign.get('/services/threads/'+t['id']).status_code==404


@pytest.mark.parametrize('dependency',['memory_withdrawn','memory_removed','objective_changed'])
def test_report_context_change_requires_explicit_historical_choice_without_rewrite(actor,dependency):
    d=actor.dataset()
    memory=ok(actor.post('/memories',json={'text':'测试批准的审阅目标偏好','company':d['payload']['company'],'approved':True}),201)
    report=execute(actor,plan(actor,d));assert report['snapshot']['memory']
    src={'kind':'report','run_id':report['id']};a=ok(action(actor,d,source_ref=src),201)
    if dependency=='memory_withdrawn':ok(actor.put('/memories/'+memory['id'],json={**memory['payload'],'version':1,'approved':False}))
    elif dependency=='memory_removed':ok(actor.delete('/memories/'+memory['id']+'?version=1'))
    else:ok(actor.post('/workspace/profiles',json={'company':d['payload']['company'],'objective':'后续明确修改了经营核查目标'}))
    store=actor.client.app.state.store
    objects=store.all('SELECT * FROM workspace_objects WHERE user_id=? ORDER BY id',(actor.user['id'],))
    audit=store.all('SELECT * FROM audit WHERE user_id=? ORDER BY seq',(actor.user['id'],))
    after=actions(actor)[0]
    assert after['source_impact']['state']=='changed' and dependency in {r['code'] for r in after['source_impact']['reasons']}
    assert after['payload']==a['payload'] and after['version']==a['version']
    assert store.all('SELECT * FROM workspace_objects WHERE user_id=? ORDER BY id',(actor.user['id'],))==objects
    assert store.all('SELECT * FROM audit WHERE user_id=? ORDER BY seq',(actor.user['id'],))==audit
    unchanged=ok(actor.get('/runs/'+report['id']))
    assert unchanged['snapshot']==report['snapshot'] and unchanged['result']==report['result']
    assert action(actor,d,source_ref=src).status_code==409
    historical=ok(action(actor,d,source_ref={**src,'allow_historical':True}),201)
    assert historical['source_impact']['state']=='changed'
    assert historical['payload']['provenance']['report_hash']==digest(report['result'])


def action_ref(row):
    return {'kind':'action','action_id':row['id'],'action_version':row['version'],'action_hash':digest(row['payload'])}


def watch_body(row,**changes):
    keys=('title','identity_id','dataset_id','metric','operator','threshold','active','stale_after_days','expires_at')
    return {**{k:row['payload'][k] for k in keys},'version':row['version'],**changes}


def test_action_to_watch_keeps_original_basis_but_evaluates_current_input(actor):
    d=actor.dataset();report=execute(actor,plan(actor,d))
    a=ok(action(actor,d,source_ref={'kind':'report','run_id':report['id']}),201)
    spec={'title':'跟进行动的毛利率阈值','dataset_id':d['id'],'metric':'gross_margin','operator':'lt','threshold':0.99,
        'stale_after_days':1460,'source_ref':action_ref(a)}
    w=ok(actor.post('/services/watches',json=spec),201);origin=w['payload']['provenance']
    assert origin['kind']=='action' and origin['action_id']==a['id'] and origin['action_version']==1
    assert origin['action_hash']==digest(a['payload']) and origin['action_title']==a['payload']['title']
    assert origin['action_acceptance']==a['payload']['acceptance'] and origin['run_id']==report['id']
    assert origin['report_hash']==digest(report['result']) and origin['dataset_version']==1
    assert 'origin' not in origin and 'history' not in origin and 'payload' not in origin
    revised=revise(actor,d)
    assert actor.post('/services/watches',json=spec).status_code==409
    historical=ok(actor.post('/services/watches',json={**spec,'source_ref':{**spec['source_ref'],'allow_historical':True}}),201)
    assert historical['payload']['provenance']['dataset_hash']==d['content_hash']
    evaluated=evaluate_watches(actor.client.app.state.store,actor.user['id'],today=date(2026,10,1))['evaluations']
    assert len(evaluated)==2 and all(e['dataset_hash']==revised['content_hash'] and e['threshold']==0.99 for e in evaluated)
    tracking=ok(actor.get('/services/tracking'))
    saved=next(r for r in tracking['rules'] if r['id']==w['id'])
    assert saved['payload']==w['payload'] and saved['source_impact']['state']=='changed'
    # Shared report dependencies remain active after flattening the action origin.
    ok(actor.post('/workspace/profiles',json={'company':d['payload']['company'],'objective':'改变了上游报告的经营研判目标'}))
    saved=next(r for r in ok(actor.get('/services/tracking'))['rules'] if r['id']==w['id'])
    assert 'objective_changed' in {r['code'] for r in saved['source_impact']['reasons']}


def test_action_source_change_and_delete_preserve_watch_threshold_and_snapshot(actor):
    d=actor.dataset();a=ok(action(actor,d),201)
    w=watch(actor,d,source_ref=action_ref(a))
    edit={k:a['payload'][k] for k in ('title','priority','owner','due_at','acceptance','description')}
    updated=ok(actor.put('/workspace/actions/'+a['id'],json={**edit,'version':1,'title':'用户明确修改了来源行动','note':'核对后调整行动的研究重点'}))
    saved=next(r for r in ok(actor.get('/services/tracking'))['rules'] if r['id']==w['id'])
    assert 'action_changed' in {r['code'] for r in saved['source_impact']['reasons']}
    assert saved['payload']==w['payload'] and saved['payload']['threshold']==0.99
    ok(actor.delete('/workspace/archive/action/'+a['id']+'?version='+str(updated['version'])))
    after=next(r for r in ok(actor.get('/services/tracking'))['rules'] if r['id']==w['id'])
    assert after['source_impact']['state']=='unavailable' and after['payload']==w['payload']
    assert after['payload']['provenance']['action_title']==a['payload']['title']


def test_action_source_owner_identity_archived_and_legacy_rules(actor):
    d=actor.dataset();i=identity(actor,d);a=ok(action(actor,d,identity_id=i['id']),201)
    body={'title':'按行动建立跟踪','dataset_id':d['id'],'metric':'gross_margin','operator':'lt','threshold':0.9,
        'source_ref':action_ref(a)}
    assert actor.post('/services/watches',json=body).status_code==403
    foreign=Actor(actor.client);foreign_d=foreign.dataset()
    assert foreign.post('/services/watches',json={**body,'dataset_id':foreign_d['id']}).status_code==404
    store=actor.client.app.state.store;old=deepcopy(a['payload']);old.pop('provenance');old.pop('origin')
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(old),a['id']))
    body['identity_id']=i['id']
    body['source_ref']['action_hash']=digest(old)
    assert actor.post('/services/watches',json=body).status_code==409
    body['source_ref']['allow_historical']=True
    legacy=ok(actor.post('/services/watches',json=body),201)
    assert legacy['source_impact']['state']=='unknown'
    assert legacy['payload']['provenance']['dataset_version'] is None and legacy['payload']['provenance']['dataset_hash'] is None
    assert ws.get(store,actor.user['id'],'action',a['id'])['payload']==old
    ok(actor.delete('/services/identities/'+i['id']+'?version=1'))
    assert actor.post('/services/watches',json=body).status_code==404


def test_watch_noop_label_and_pause_do_not_repeat_alert_or_change_basis(actor):
    d=actor.dataset();w=watch(actor,d);store=actor.client.app.state.store
    first=evaluate_watches(store,actor.user['id'],today=date(2026,10,1))['evaluations'][0]
    alert_id=first['alert_id'];a=ok(action(actor,d,source_ref={'kind':'alert','alert_id':alert_id}),201)
    before=store.all('SELECT * FROM audit WHERE user_id=? ORDER BY seq',(actor.user['id'],))
    same=ok(actor.put('/services/watches/'+w['id'],json=watch_body(w)))
    assert same['version']==1 and same['payload']==w['payload'] and same['updated_at']==w['updated_at']
    assert store.all('SELECT * FROM audit WHERE user_id=? ORDER BY seq',(actor.user['id'],))==before
    renamed=ok(actor.put('/services/watches/'+w['id'],json=watch_body(w,title='仅修改规则显示名称')))
    assert renamed['version']==2 and renamed['payload']['evaluation_revision']==1
    assert evaluate_watches(store,actor.user['id'],today=date(2026,10,1))['evaluations'][0]['alert_id']==alert_id
    assert actions(actor)[0]['source_impact']['state']=='current'
    paused=ok(actor.put('/services/watches/'+w['id'],json=watch_body(renamed,active=False)))
    assert evaluate_watches(store,actor.user['id'],today=date(2026,10,1))['evaluations']==[]
    resumed=ok(actor.put('/services/watches/'+w['id'],json=watch_body(paused,active=True)))
    assert resumed['payload']['evaluation_revision']==1
    assert evaluate_watches(store,actor.user['id'],today=date(2026,10,1))['evaluations'][0]['alert_id']==alert_id
    assert len(ws.objects(store,actor.user['id'],'alert'))==1
    changed=ok(actor.put('/services/watches/'+w['id'],json=watch_body(resumed,threshold=0.98)))
    assert changed['payload']['evaluation_revision']==2
    next_alert=evaluate_watches(store,actor.user['id'],today=date(2026,10,1))['evaluations'][0]
    assert next_alert['alert_id']!=alert_id and next_alert['evaluation_revision']==2 and next_alert['rule_version']==changed['version']
    assert 'rule_changed' in {r['code'] for r in actions(actor)[0]['source_impact']['reasons']}
    assert len(ws.objects(store,actor.user['id'],'alert'))==2
    assert actions(actor)[0]['payload']==a['payload']


def test_legacy_watch_evaluation_revision_falls_back_without_rewriting_history(actor):
    d=actor.dataset();w=watch(actor,d);store=actor.client.app.state.store;p=deepcopy(w['payload']);p.pop('evaluation_revision')
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=?,version=4 WHERE id=?',(encode(p),w['id']))
    legacy=ws.get(store,actor.user['id'],'watch',w['id'])
    first=evaluate_watches(store,actor.user['id'],today=date(2026,10,1))['evaluations'][0]
    assert first['evaluation_revision']==4
    same=ok(actor.put('/services/watches/'+w['id'],json=watch_body(legacy)))
    assert same['version']==4 and 'evaluation_revision' not in same['payload']
    changed=ok(actor.put('/services/watches/'+w['id'],json=watch_body(same,title='旧规则仅更改标题')))
    assert changed['payload']['evaluation_revision']==4
    again=evaluate_watches(store,actor.user['id'],today=date(2026,10,1))['evaluations'][0]
    assert again['alert_id']==first['alert_id'] and again['rule_version']==5


@pytest.mark.parametrize('kind',['action','watch'])
def test_creation_request_id_replays_after_source_change_without_new_writes(actor,kind):
    d=actor.dataset();report=execute(actor,plan(actor,d));source={'kind':'report','run_id':report['id']}
    payload={'title':'按原审批来源创建后续工作','dataset_id':d['id'],'source_ref':source,'request_id':'stable-creation-request-01'}
    if kind=='action':payload['acceptance']='核对源数据和书面说明并记录验收'
    else:payload.update(metric='gross_margin',operator='lt',threshold=0.99)
    path='/workspace/actions' if kind=='action' else '/services/watches'
    first=ok(actor.post(path,json=payload),201)
    revise(actor,d);store=actor.client.app.state.store
    before=store.all('SELECT * FROM workspace_objects WHERE user_id=? ORDER BY id',(actor.user['id'],))
    audits=store.all('SELECT * FROM audit WHERE user_id=? ORDER BY seq',(actor.user['id'],))
    retry=ok(actor.post(path,json=payload),201)
    assert retry['id']==first['id'] and retry['version']==first['version'] and retry['payload']==first['payload']
    assert retry['source_impact']['state']=='changed'
    assert store.all('SELECT * FROM workspace_objects WHERE user_id=? ORDER BY id',(actor.user['id'],))==before
    assert store.all('SELECT * FROM audit WHERE user_id=? ORDER BY seq',(actor.user['id'],))==audits
    mismatch=actor.post(path,json={**payload,'title':'不同内容不能复用同一提交标识'})
    assert mismatch.status_code==409 and mismatch.json()['error']['code']=='IDEMPOTENCY_CONFLICT'
    assert actor.post(path,json={**payload,'request_id':'a-different-new-request'}).status_code==409
    fresh=ok(actor.post(path,json={**payload,'request_id':'a-different-new-request','source_ref':{**source,'allow_historical':True}}),201)
    assert fresh['id']!=first['id']
    assert len(ws.objects(store,actor.user['id'],kind))==2
    if kind=='watch':assert actor.put('/services/watches/'+first['id'],json={**watch_body(first),'request_id':'only-valid-on-create'}).status_code==422


@pytest.mark.parametrize('kind',['action','watch'])
def test_parallel_creation_token_commits_once_and_owner_scopes_retry(actor,kind):
    from concurrent.futures import ThreadPoolExecutor
    d=actor.dataset();body={'title':'并发提交只保存一条记录','dataset_id':d['id'],'request_id':'parallel-creation-token-01'}
    if kind=='action':body['acceptance']='核对并保留原始验收凭据'
    else:body.update(metric='gross_margin',operator='lt',threshold=0.9)
    path='/workspace/actions' if kind=='action' else '/services/watches'
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:actor.post(path,json=body),range(2)))
    ids=[ok(r,201)['id'] for r in results]
    assert ids[0]==ids[1] and len(ws.objects(actor.client.app.state.store,actor.user['id'],kind))==1
    other=Actor(actor.client);other_d=other.dataset()
    own=ok(other.post(path,json={**body,'dataset_id':other_d['id']}),201)
    assert own['id']!=ids[0]


@pytest.mark.parametrize('change',['dataset_id','company','run_id','title','acceptance','source_ref'])
def test_insight_dedup_rejects_explicit_conflicts_instead_of_returning_wrong_action(actor,change):
    d=actor.dataset();other=actor.dataset();insight=ok(actor.get('/workspace/brief?dataset_id='+d['id']))['insights']['items'][0]
    body={'title':'相同建议的具体跟进行动','acceptance':'核对并保留相同建议的验收依据','dataset_id':d['id'],
        'company':d['payload']['company'],'source_key':insight['key'],'source_ref':{'kind':'insight','source_key':insight['key']}}
    first=ok(actor.post('/workspace/actions',json=body),201)
    patch={'dataset_id':other['id'],'company':'与原始来源冲突的企业','run_id':'unrelated-run','title':'不同的行动标题',
        'acceptance':'不同的验收标准不能静默去重','source_ref':{'kind':'insight','source_key':insight['key'],'dataset_version':99}}[change]
    rejected=actor.post('/workspace/actions',json={**body,change:patch})
    assert rejected.status_code==409
    assert actions(actor)[0]['payload']==first['payload'] and len(actions(actor))==1
    # The original compatibility contract permits unspecified scope to be inferred.
    legacy_retry=ok(actor.post('/workspace/actions',json={k:body[k] for k in ('title','acceptance','source_key')}),201)
    assert legacy_retry['id']==first['id']


@pytest.mark.parametrize('historical',[False,True])
def test_action_source_requires_exact_viewed_revision_even_with_historical_ack(actor,historical):
    d=actor.dataset();a=ok(action(actor,d),201)
    assert a['object_hash']==digest(a['payload'])
    spec={'title':'对已查看行动设置跟踪','dataset_id':d['id'],'metric':'gross_margin','operator':'lt','threshold':0.99,
        'source_ref':{**action_ref(a),'allow_historical':historical}}
    incomplete={**spec,'source_ref':{'kind':'action','action_id':a['id']}}
    assert actor.post('/services/watches',json=incomplete).status_code==422
    edit={k:a['payload'][k] for k in ('title','priority','owner','due_at','acceptance','description')}
    updated=ok(actor.put('/workspace/actions/'+a['id'],json={**edit,'version':1,'acceptance':'新增的验收要求必须重新核对','note':'更新行动验收的具体要求'}))
    stale=actor.post('/services/watches',json=spec)
    assert stale.status_code==409 and stale.json()['error']['code']=='SOURCE_CHANGED'
    assert not ws.objects(actor.client.app.state.store,actor.user['id'],'watch')
    current=ok(actor.post('/services/watches',json={**spec,'source_ref':action_ref(updated)}),201)
    assert current['payload']['provenance']['action_version']==2


def test_legacy_insight_retry_cannot_introduce_forged_source_version(actor):
    d=actor.dataset();insight=ok(actor.get('/workspace/brief'))['insights']['items'][0]
    base={'title':'旧提交方式创建的建议行动','acceptance':'保持原始来源并核对验收结果','dataset_id':d['id'],'source_key':insight['key']}
    first=ok(actor.post('/workspace/actions',json=base),201)
    ref={'kind':'insight','source_key':insight['key'],'dataset_version':1,'dataset_hash':d['content_hash']}
    assert ok(actor.post('/workspace/actions',json={**base,'source_ref':ref}),201)['id']==first['id']
    assert actor.post('/workspace/actions',json={**base,'source_ref':{**ref,'dataset_version':99}}).status_code==409
    assert actor.post('/workspace/actions',json={**base,'source_ref':{**ref,'dataset_hash':'0'*64}}).status_code==409


def test_stale_insight_day_change_is_stable_but_goal_change_is_material(actor):
    from unittest.mock import patch
    from server.business_provenance import with_source_impact
    d=actor.dataset();company=d['payload']['company']
    with patch('server.intelligence.utc_today',return_value=date(2027,7,1)):
        insight=next(i for i in ok(actor.get('/workspace/brief'))['insights']['items'] if i['code']=='stale')
        a=ok(action(actor,d,source_key=insight['key'],source_ref={'kind':'insight','source_key':insight['key']}),201)
        w=watch(actor,d,source_ref=action_ref(a))
    frozen=a['payload']['provenance'];store=actor.client.app.state.store
    with patch('server.intelligence.utc_today',return_value=date(2027,7,2)):
        current=next(i for i in ok(actor.get('/workspace/brief'))['insights']['items'] if i['code']=='stale')
        assert current['key']==insight['key'] and current['proof']['age_days']!=insight['proof']['age_days']
        assert actions(actor)[0]['source_impact']['state']=='current'
        assert with_source_impact(store,actor.user['id'],ws.get(store,actor.user['id'],'watch',w['id']))['source_impact']['state']=='current'
        assert actions(actor)[0]['payload']['provenance']==frozen
        ok(actor.post('/workspace/profiles',json={'company':company,'objective':'明确变更数据更新优先目标','stale_after_days':60}))
        assert 'insight_changed' in {r['code'] for r in actions(actor)[0]['source_impact']['reasons']}
        assert 'insight_changed' in {r['code'] for r in with_source_impact(store,actor.user['id'],ws.get(store,actor.user['id'],'watch',w['id']))['source_impact']['reasons']}


def test_action_watch_retains_completion_evidence_dependency_after_later_rejection(actor):
    from server.business_provenance import with_source_impact
    d=actor.dataset();a=ok(action(actor,d),201)
    doc=ok(actor.post('/evidence',json={'title':'行动完成依据用于后续跟踪','text':'隔离测试完成后续跟踪依据。'*30,'company':d['payload']['company']}),201)
    ok(actor.put('/workspace/actions/'+a['id']+'/status',json={'version':1,'status':'in_progress'}))
    completed=ok(actor.put('/workspace/actions/'+a['id']+'/status',json={'version':2,'status':'done','note':'逐项核对并保留此原始完成凭据','evidence_ids':[doc['id']],'evidence_refs':[actor.evidence_ref(doc)]}))
    w=watch(actor,d,source_ref=action_ref(completed));p=w['payload']['provenance']
    proof=p['action_acceptance_evidence'][0]
    assert proof['id']==doc['id'] and proof['content_hash']==doc['content_hash'] and proof['review_version']==1
    assert 'history' not in p and 'text' not in proof
    ok(actor.put('/workspace/evidence/'+doc['id']+'/review',json={'version':1,'company':d['payload']['company'],'status':'rejected','note':'后来发现原验收资料不能支持该结论'}))
    store=actor.client.app.state.store;before=ws.get(store,actor.user['id'],'watch',w['id'])
    current=with_source_impact(store,actor.user['id'],before)
    assert current['source_impact']['state']=='changed'
    assert any(r['dependency']=='action_acceptance' and r['code']=='evidence_ineligible' for r in current['source_impact']['reasons'])
    assert current['payload']==w['payload'] and current['payload']['threshold']==0.99
    assert actions(actor)[0]['payload']['status']=='done' and actions(actor)[0]['payload']==completed['payload']
    assert ws.get(store,actor.user['id'],'watch',w['id'])==before
