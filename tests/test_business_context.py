"""Cross-module context contracts; synthetic inputs exist only in isolated tests."""
import copy
from conftest import editable
from test_workspace_api import good, dataset, evidence
from server.store import encode


def test_company_key_is_immutable_across_edit_import_and_restore(actor):
    d=dataset(actor); raw=editable(d);raw['company']='另一个企业'
    r=actor.put('/datasets/'+d['id'],json=raw)
    assert r.status_code==409 and r.json()['error']['code']=='COMPANY_MISMATCH'
    raw.pop('version')
    assert actor.post('/workspace/imports/preview',json={'dataset':raw,'target_id':d['id'],'target_version':1}).status_code==409
    store=actor.client.app.state.store
    # Historical legacy rows with mismatched companies must not reassign live links.
    old=copy.deepcopy(d['payload']);old['company']='legacy other company'
    with store.transaction() as db:
        db.execute('UPDATE dataset_revisions SET payload=? WHERE dataset_id=? AND version=1',(encode(old),d['id']))
    assert actor.post('/workspace/datasets/'+d['id']+'/restore',json={'version':1,'target_revision':1}).status_code==409
    assert good(actor.get('/datasets/'+d['id']))==d
    assert len(good(actor.get('/workspace/datasets/'+d['id']+'/revisions'))['items'])==1


def test_insights_actions_and_dismissals_are_identity_and_objective_bound(actor):
    d=dataset(actor)
    p=good(actor.post('/workspace/profiles',json={'company':d['payload']['company'],'margin_floor':.9}))
    a=good(actor.post('/services/identities',json={'name':'经营负责人','dataset_ids':[d['id']]}),201)
    b=good(actor.post('/services/identities',json={'name':'研究负责人','dataset_ids':[d['id']]}),201)
    def margin(identity):
        return next(x for x in good(actor.get('/workspace/brief',params={'identity_id':identity}))['insights']['items'] if x['code']=='margin')
    ia,ib=margin(a['id']),margin(b['id'])
    assert ia['key']!=ib['key']
    action=good(actor.post('/workspace/actions',json={'identity_id':a['id'],'dataset_id':d['id'],'title':ia['title'],'source_key':ia['key'],'acceptance':'人工核对并附原始依据'}),201)
    assert margin(a['id'])['action_id']==action['id'] and margin(b['id'])['action_id'] is None
    assert actor.post('/workspace/insights/dismiss',json={'identity_id':b['id'],'key':ia['key'],'note':'不应跨身份关闭提示'}).status_code==404
    good(actor.post('/workspace/insights/dismiss',json={'identity_id':a['id'],'key':ia['key'],'note':'当前目标暂时不再提示'}))
    assert ia['key'] not in {x['key'] for x in good(actor.get('/workspace/brief',params={'identity_id':a['id']}))['insights']['items']}
    assert margin(b['id'])['key']==ib['key']
    good(actor.post('/workspace/profiles',json={**p['payload'],'margin_floor':.8,'version':p['version']}))
    current=margin(a['id'])
    assert current['key']!=ia['key'] and current['action_id'] is None
    assert current['dataset_version']==1 and current['proof']['threshold']==.8


def test_evidence_rule_reappears_when_review_basis_changes(actor):
    d=dataset(actor);a,ar=evidence(actor,d['payload']['company'],stance='supports');b,br=evidence(actor,d['payload']['company'],stance='contradicts',text='不同的反向证据资料仅供隔离测试。'*20)
    def rule():return next(x for x in good(actor.get('/workspace/brief'))['insights']['items'] if x['code']=='counterevidence')
    prior=rule()
    good(actor.post('/workspace/insights/dismiss',json={'key':prior['key'],'note':'已核对当前两份资料'}))
    good(actor.put('/workspace/evidence/'+b['id']+'/review',json={**br['payload'],'note':'修订适用边界需要重新核对','version':br['version']}))
    assert rule()['key']!=prior['key']


def test_import_receipt_survives_stage_cleanup_and_is_owned_export(actor):
    import hashlib
    from conftest import Actor
    raw='季度,营业收入,营业成本\n2025-Q1,100,80\n'.encode()
    stage=good(actor.post('/workspace/imports/file',files={'file':('source.csv',raw,'text/csv')},data={'company':'导入回执测试企业','amount_unit':'wan'}),201)
    d=good(actor.post('/workspace/imports/'+stage['id']+'/commit',json={'version':stage['version'],'fingerprint':stage['payload']['fingerprint']}),201)
    revisions=good(actor.get('/workspace/datasets/'+d['id']+'/revisions'))['items']
    receipt=revisions[0]['import_receipt'];p=receipt['payload']
    assert p['dataset_hash']==d['content_hash'] and p['dataset_version']==1
    assert p['import_context']['source_file_sha256']==hashlib.sha256(raw).hexdigest()
    assert p['import_context']['input_amount_unit']=='wan'
    committed=good(actor.get('/workspace/archive'))['collections']['import_stage']['items'][0]
    good(actor.delete('/workspace/archive/import_stage/'+stage['id'],params={'version':committed['version']}))
    assert good(actor.get('/workspace/datasets/'+d['id']+'/revisions'))['items'][0]['import_receipt']==receipt
    exported=good(actor.get('/account/export'))
    assert exported['data']['dataset_import_receipts'][0]['payload']==p
    other=Actor(actor.client)
    assert other.get('/workspace/datasets/'+d['id']+'/revisions').status_code==404
    assert good(other.get('/account/export'))['data']['dataset_import_receipts']==[]


def test_unrelated_focus_or_context_document_does_not_resurrect_dismissed_goal(actor):
    d=dataset(actor)
    profile=good(actor.post('/workspace/profiles',json={'company':d['payload']['company'],'margin_floor':.9,'focus':['margin']}))
    before=next(x for x in good(actor.get('/workspace/brief'))['insights']['items'] if x['code']=='margin')
    dismissed=good(actor.post('/workspace/insights/dismiss',json={'key':before['key'],'note':'已知当前门槛暂不再提示'}))
    assert dismissed['payload']['source']['proof']==before['proof']
    good(actor.post('/workspace/profiles',json={**profile['payload'],'focus':['cash'],'version':profile['version']}))
    evidence(actor,d['payload']['company'],text='无关背景资料仅用于测试。'*20)
    assert before['key'] not in {x['key'] for x in good(actor.get('/workspace/brief'))['insights']['items']}


def test_unscoped_excluded_document_does_not_reset_missing_evidence_dismissal(actor):
    d=dataset(actor)
    prior=next(i for i in good(actor.get('/workspace/brief'))['insights']['items'] if i['code']=='evidence')
    good(actor.post('/workspace/insights/dismiss',json={'key':prior['key'],'note':'等待明确适用企业的原始证据'}))
    good(actor.post('/evidence',json={'title':'未指定企业的收件箱材料','text':'未批准用于任何企业。'*20}),201)
    assert not any(i['code']=='evidence' for i in good(actor.get('/workspace/brief'))['insights']['items'])


def test_workspace_upgrade_is_idempotent_and_future_schema_rejects_writes(actor):
    import pytest
    from server import workspace_store as ws
    store=actor.client.app.state.store
    assert store.one('SELECT max(version) AS version FROM workspace_schema')['version']==2
    original=store.all('SELECT * FROM dataset_revisions')
    ws.migrate(store);ws.migrate(store)
    assert store.all('SELECT * FROM dataset_revisions')==original
    with store.transaction() as db:db.execute('INSERT INTO workspace_schema VALUES(99)')
    with pytest.raises(RuntimeError,match='拒绝降级写入'):ws.migrate(store)
    assert store.one('SELECT max(version) AS version FROM workspace_schema')['version']==99
