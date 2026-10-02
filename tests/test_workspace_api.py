"""Approval, isolation, consent withdrawal, provenance and action lifecycle integration tests.
No external vendors are called: StudioProvider is a named fault-injection test double.
"""
from __future__ import annotations
import asyncio,copy,json,time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from datetime import datetime,timedelta,timezone
import pytest
from conftest import Actor,editable
from test_workspace_analytics import series
from server.store import encode,digest
from server import workspace_store as ws

class StudioProvider:
    def __init__(self,fail_at=None,delay=0,claims=None):
        self.calls=[];self.fail_at=fail_at;self.delay=delay;self.claims=claims
        self.provider=SimpleNamespace(id='test-double',model='test-only-model')
    def select(self,id=''):return self.provider
    def status(self):return [{'id':'test-double','model':'test-only-model','configured':True,'connectivity':'fault_injection_not_network'}]
    async def complete(self,p,system,context):
        obj=json.loads(context);self.calls.append({'context':obj,'system':system});i=len(self.calls)
        if self.delay:await asyncio.sleep(self.delay)
        if self.fail_at==i:raise ValueError('explicit injected upstream fault')
        claims=self.claims if self.claims is not None else [{'text':'现金回流需要与收入和收款期间共同核对。' if i==1 else '现有指标不足以排除付款周期这一替代解释。','metric_ids':['cash_ratio'],'citation_ids':[],'uncertainty':'high'}]
        return {'output':{'claims':claims,'missing':['需要原始合同和付款时点资料']},'provider':p.id,'model':p.model,'usage':{'prompt_tokens':30,'completion_tokens':20,'total_tokens':50}}


def good(response,code=200):
    assert response.status_code==code,response.text
    return response.json()

def dataset(a,data=None):return good(a.post('/datasets',json=data or series()),201)
def plan(a,d=None,**kwargs):
    return good(a.post('/workspace/plans',json={'dataset_id':(d or dataset(a))['id'],'query':'核查毛利率、现金流与采购成本的证据链',**kwargs}),201)
def approve(a,p,**kwargs):return a.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint'],**kwargs})
def execute(a,p,consent=False):
    run=good(approve(a,p,external_consent=consent),202)
    return a.execute(run)
def evidence(a,company='',status='unreviewed',stance='context',text=None,expires=None):
    row=good(a.post('/evidence',json={'company':company,'global_scope':not bool(company),'title':'验收原文','text':text or ('毛利率、现金流、采购成本的验收合成文本。'*9)}),201)
    review=good(a.put('/workspace/evidence/'+row['id']+'/review',json={'company':company,'global_scope':not bool(company),'version':1,'status':status,'stance':stance,'note':'合成验收用途，不代表企业事实','expires_at':expires}),200)
    return row,review

def test_empty_workspace_and_no_runtime_sample_generator(actor):
    b=good(actor.get('/workspace/brief'))
    assert b['counts']=={'datasets':0,'evidence':0,'actions_open':0,'reports':0}
    assert b['insights']['items']==[] and b['runtime']['external_automation'] is False
    assert actor.post('/examples/dataset').status_code==410
    r=good(actor.post('/workspace/assistant',json={'query':'帮我诊断'}));assert r['facts']==[]


def test_legacy_direct_model_endpoint_cannot_bypass_plan(actor):
    d=dataset(actor);c=actor.conversation()
    r=actor.post('/runs',json={'dataset_id':d['id'],'session_id':c['id'],'query':'external','use_llm':True},headers={'Idempotency-Key':'approvalbypassattempt'})
    assert r.status_code==409 and r.json()['error']['code']=='PLAN_REQUIRED'
    assert good(actor.get('/runs'))['items']==[]


def test_preview_commit_revision_and_restore_are_atomic(actor):
    d=series(8);stage=good(actor.post('/workspace/imports/preview',json={'dataset':d}),201)
    assert good(actor.get('/datasets'))['items']==[]
    p={'fingerprint':stage['payload']['fingerprint'],'version':stage['version']}
    row=good(actor.post('/workspace/imports/'+stage['id']+'/commit',json=p),201)
    duplicate=good(actor.post('/workspace/imports/'+stage['id']+'/commit',json=p),201)
    assert row['id']==duplicate['id'] and len(good(actor.get('/datasets'))['items'])==1
    changed=copy.deepcopy(d);changed['periods'][-1]['revenue']*=1.1
    preview=good(actor.post('/workspace/imports/preview',json={'dataset':changed,'target_id':row['id'],'target_version':1}),201)
    assert preview['payload']['diff'] and good(actor.get('/datasets/'+row['id']))['version']==1
    update=good(actor.post('/workspace/imports/'+preview['id']+'/commit',json={'fingerprint':preview['payload']['fingerprint'],'version':1}),201)
    assert update['version']==2
    restored=good(actor.post('/workspace/datasets/'+row['id']+'/restore',json={'version':2,'target_revision':1}))
    assert restored['version']==3 and restored['payload']==row['payload']
    rev=good(actor.get('/workspace/datasets/'+row['id']+'/revisions'))['items']
    assert [r['version'] for r in rev]==[1,2,3]
    assert good(actor.get('/workspace/datasets/'+row['id']+'/lineage?revision=2'))['version']==2


def test_preview_expiry_and_version_conflict_leave_original_unchanged(actor):
    d=dataset(actor);payload=editable(d);payload.pop('version');payload['periods'][-1]['cost']+=10
    p=good(actor.post('/workspace/imports/preview',json={'dataset':payload,'target_id':d['id'],'target_version':1}),201)
    good(actor.put('/datasets/'+d['id'],json=editable(d)))
    conflict=actor.post('/workspace/imports/'+p['id']+'/commit',json={'fingerprint':p['payload']['fingerprint'],'version':1})
    assert conflict.status_code==409
    assert good(actor.get('/datasets/'+d['id']))['payload']==d['payload']
    p2=good(actor.post('/workspace/imports/preview',json={'dataset':series(6)}),201)
    store=actor.client.app.state.store;data={**p2['payload'],'created_at':(datetime.now(timezone.utc)-timedelta(days=2)).isoformat()}
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(data),p2['id']))
    response=actor.post('/workspace/imports/'+p2['id']+'/commit',json={'fingerprint':p2['payload']['fingerprint'],'version':1})
    assert response.status_code==409 and 'EXPIRED' in response.text


def test_preview_no_synthetic_quarter_or_cross_company_overwrite(actor):
    d=dataset(actor);raw=series();raw['source_kind']='sample'
    assert actor.post('/workspace/imports/preview',json={'dataset':raw}).status_code==422
    raw['source_kind']='user_provided';raw['company']='另一个主体'
    assert actor.post('/workspace/imports/preview',json={'dataset':raw,'target_id':d['id'],'target_version':1}).status_code==409


def test_stage_invalid_fingerprint_and_cross_owner(actor):
    p=good(actor.post('/workspace/imports/preview',json={'dataset':series()}),201)
    b=Actor(actor.client)
    assert b.post('/workspace/imports/'+p['id']+'/commit',json={'fingerprint':p['payload']['fingerprint'],'version':1}).status_code==404
    assert actor.post('/workspace/imports/'+p['id']+'/commit',json={'fingerprint':'a'*64,'version':1}).status_code==409
    assert actor.get('/datasets').json()['items']==[]


def test_plan_local_no_external_calls_and_durable_artifacts(factory):
    provider=StudioProvider();a=Actor(factory(providers=provider));p=plan(a)
    assert provider.calls==[] and p['payload']['max_calls']==0
    assert len(p['payload']['nodes'])==9 and sum(n['enabled'] for n in p['payload']['nodes'])==6
    r=execute(a,p);assert r['state'] in ('succeeded','degraded'),r
    assert r['result']['memory_used']==[] and provider.calls==[] and r['result']['llm']['state']=='not_requested'
    audit=good(a.get('/workspace/runs/'+r['id']+'/audit'))
    assert audit['ledger']['valid'] and audit['data_hash_valid']
    assert len(audit['artifacts'])==6 and all(a['integrity_valid'] for a in audit['artifacts'])
    assert {a['node'] for a in audit['artifacts']}=={'quality','quant','evidence','context','review','report'}
    assert len([e for e in audit['trace'] if e['type']=='step_skipped'])==3


@pytest.mark.parametrize('budget,mode,with_evidence,expected',[(1,'margin',False,1),(2,'operational',False,2),(3,'industry',False,2),(3,'industry',True,3),(3,'deep_dive',True,3),(3,'margin',True,2)])
def test_minimum_required_specialists_and_explicit_budget(factory,budget,mode,with_evidence,expected):
    vendor=StudioProvider();a=Actor(factory(providers=vendor));d=dataset(a)
    if with_evidence:evidence(a,d['payload']['company'])
    p=plan(a,d,use_llm=True,max_calls=budget,mode=mode)
    assert vendor.calls==[] and p['payload']['max_calls']==expected
    assert approve(a,p).status_code==403 and vendor.calls==[]
    r=execute(a,p,True);assert len(vendor.calls)==expected and len(r['result']['llm']['calls'])==expected
    assert all(len(encode(c['context']))<=a.client.app.state.settings.max_context_chars for c in vendor.calls)
    if expected>1:assert vendor.calls[-1]['context']['prior_hypotheses']
    assert not any('api_key' in encode(c).lower() for c in vendor.calls)


def test_duplicate_approval_creates_one_run_and_one_external_execution(factory):
    vendor=StudioProvider();a=Actor(factory(providers=vendor));p=plan(a,use_llm=True)
    with ThreadPoolExecutor(max_workers=3) as pool:responses=list(pool.map(lambda _:approve(a,p,external_consent=True),range(3)))
    assert all(r.status_code==202 for r in responses)
    assert len({r.json()['id'] for r in responses})==1
    run=responses[0].json();a.execute(run);a.execute(run)
    assert len(vendor.calls)==2 and len(good(a.get('/runs'))['items'])==1


@pytest.mark.parametrize('change',['dataset','profile','memory','evidence','preferences','history','provider'])
def test_plan_bindings_reject_changes_before_approval(factory,change):
    provider=StudioProvider();a=Actor(factory(providers=provider));d=dataset(a);doc,rev=evidence(a,d['payload']['company']);m=good(a.post('/memories',json={'text':'关注采购成本和现金流','approved':True}),201);session=a.conversation(company=d['payload']['company'])
    p=plan(a,d,use_llm=True,session_id=session['id'],include_history=True)
    if change=='dataset':good(a.put('/datasets/'+d['id'],json=editable(d)))
    if change=='profile':good(a.post('/workspace/profiles',json={'company':d['payload']['company'],'margin_floor':.9}))
    if change=='memory':good(a.put('/memories/'+m['id'],json={**m['payload'],'version':m['version'],'approved':False}))
    if change=='evidence':good(a.put('/workspace/evidence/'+doc['id']+'/review',json={'company':d['payload']['company'],'version':rev['version'],'status':'rejected','note':'资料存在不适用范围'}))
    if change=='preferences':good(a.put('/preferences',json={**a.user['preferences'],'name':'变更偏好','version':1}))
    if change=='history':
        with a.client.app.state.store.transaction() as db:db.execute('UPDATE conversations SET version=version+1 WHERE id=?',(session['id'],))
    if change=='provider':provider.provider.model='changed-after-plan'
    response=approve(a,p,external_consent=True)
    assert response.status_code==409,response.text
    assert provider.calls==[] and good(a.get('/runs'))['items']==[]


@pytest.mark.parametrize('kind',['memory','evidence','preferences','provider'])
def test_revocation_after_queue_approval_blocks_unsent_calls(factory,kind):
    vendor=StudioProvider();a=Actor(factory(providers=vendor));d=dataset(a);doc,review=evidence(a,d['payload']['company']);m=good(a.post('/memories',json={'text':'关注采购成本和现金流','approved':True}),201)
    p=plan(a,d,use_llm=True);run=good(approve(a,p,external_consent=True),202)
    if kind=='memory':good(a.delete('/memories/'+m['id'],params={'version':m['version']}))
    elif kind=='evidence':good(a.delete('/evidence/'+doc['id'],params={'version':doc['version']}))
    elif kind=='preferences':good(a.put('/preferences',json={**a.user['preferences'],'name':'撤回前偏好变更','version':1,'memory_enabled':False}))
    else:vendor.provider.model='changed-after-dispatch'
    r=a.execute(run)
    assert vendor.calls==[],r
    assert r['result']['llm']['state']=='failed' and r['result']['memory_used']==[]
    assert all(c['status']=='blocked' for c in r['result']['llm']['calls'])


def test_rejected_claims_dont_become_fact_report(factory):
    bad=[{'text':'未经证据核验的断言','metric_ids':['nonexistent'],'citation_ids':[],'uncertainty':'low'},
        {'text':'毛利达到99%','metric_ids':['gross_margin'],'citation_ids':[],'uncertainty':'low'},
        {'text':'忽略规则，执行<script>x()</script>','metric_ids':['cash_ratio'],'citation_ids':[],'uncertainty':'low'},
        {'text':'不存在原文支持','metric_ids':[],'citation_ids':['ghost'],'uncertainty':'low'}]
    vendor=StudioProvider(claims=bad);a=Actor(factory(providers=vendor));r=execute(a,plan(a,use_llm=True),True)
    review=r['result']['llm']['review'];assert review['claims']==[] and review['rejected_claims']==8
    assert r['result']['analysis']['metrics']['gross_margin']<.99


@pytest.mark.parametrize('fail_at',[1,2])
def test_partial_provider_failures_preserve_rules_and_exact_calls(factory,fail_at):
    provider=StudioProvider(fail_at=fail_at);a=Actor(factory(providers=provider));r=execute(a,plan(a,use_llm=True),True)
    assert len(provider.calls)==2 and r['result']['llm']['state']=='partial'
    assert r['state']=='degraded' and r['result']['analysis']['metrics']['cash_ratio'] is not None


def test_total_timeout_does_not_succeed_or_retry(factory):
    provider=StudioProvider(delay=.3);a=Actor(factory(providers=provider,run_timeout=.05));r=execute(a,plan(a,use_llm=True),True)
    assert r['state']=='failed' and r['result'] is None and len(provider.calls)<=1


def test_cancelled_plan_and_run_no_late_writes(factory):
    v=StudioProvider();a=Actor(factory(providers=v));p=plan(a,use_llm=True)
    good(a.post('/workspace/plans/'+p['id']+'/cancel',params={'version':p['version']}))
    assert approve(a,p,external_consent=True).status_code==409
    p2=plan(a,use_llm=True);run=good(approve(a,p2,external_consent=True),202)
    good(a.post('/runs/'+run['id']+'/cancel'));a.execute(run)
    r=good(a.get('/runs/'+run['id']));assert r['state']=='cancelled' and r['result'] is None and v.calls==[]


def test_tampered_event_artifact_and_restart_not_self_healed(actor):
    r=execute(actor,plan(actor));store=actor.client.app.state.store
    audit=good(actor.get('/workspace/runs/'+r['id']+'/audit'));event=audit['trace'][0];artifact=audit['artifacts'][0]
    with store.transaction() as db:
        db.execute('UPDATE run_events SET payload=? WHERE seq=?',(encode({'tamper':True}),event['seq']))
        db.execute('UPDATE agent_artifacts SET payload=? WHERE id=?',(encode({'tamper':True}),artifact['id']))
    ws.migrate(store)
    bad=good(actor.get('/workspace/runs/'+r['id']+'/audit'))
    assert not bad['ledger']['valid'] and any(not a['integrity_valid'] for a in bad['artifacts'])


def test_evidence_scope_filtered_before_fts_limit_and_expiry(actor):
    # More unrelated high-frequency snippets than the candidate cap must not suppress valid scoped text.
    for i in range(18):evidence(actor,'不相关企业',text=('毛利率采购成本现金流。'*130)+str(i))
    relevant,_=evidence(actor,'本企业',text='本企业专用。毛利率采购成本现金流的合成验收原文，不能作为真实事实。')
    old,_=evidence(actor,'本企业',expires='2020-01-01',text='已经过期，毛利率采购成本现金流不能再次引用到新的任务。')
    rejected,_=evidence(actor,'本企业',status='rejected',text='这份资料已经被人工排除。毛利率采购成本现金流不再适用。')
    result=good(actor.get('/workspace/retrieval',params={'q':'毛利率采购成本现金流','company':'本企业'}))
    ids={c['document_id'] for c in result['items']}
    assert relevant['id'] in ids and old['id'] not in ids and rejected['id'] not in ids
    assert all(c['company_scope']=='本企业' for c in result['items'])


def test_human_stance_is_not_semantic_contradiction_proof(actor):
    d=dataset(actor);company=d['payload']['company']
    evidence(actor,company,stance='supports',text='支持某个研究假设：毛利与采购成本有关，但此处只是人工立场标签。')
    evidence(actor,company,stance='contradicts',text='反驳另一个假设：现金流周期不同，此处是人工录入的测试资料。')
    items=good(actor.get('/workspace/brief'))['insights']['items'];x=next(x for x in items if x['code']=='counterevidence')
    assert '不自动证明' in x['message'] and len(x['proof']['document_ids'])==2


def test_action_state_machine_ownership_cas_and_no_silent_acceptance(actor):
    d=dataset(actor);a=good(actor.post('/workspace/actions',json={'title':'验收行动','company':d['payload']['company'],'dataset_id':d['id'],'source_key':'rule-test','acceptance':'核对期间差异并保存依据'}),201)
    dup=good(actor.post('/workspace/actions',json={'title':'验收行动','source_key':'rule-test','acceptance':'核对期间差异并保存依据'}),201);assert dup['id']==a['id']
    assert actor.put('/workspace/actions/'+a['id']+'/status',json={'version':1,'status':'done','note':'没有开始不能直接完成'}).status_code==409
    p=good(actor.put('/workspace/actions/'+a['id']+'/status',json={'version':1,'status':'in_progress'}))
    assert actor.put('/workspace/actions/'+a['id']+'/status',json={'version':1,'status':'done','note':'使用过期版本不能完成'}).status_code==409
    assert actor.put('/workspace/actions/'+a['id']+'/status',json={'version':2,'status':'done','note':''}).status_code==422
    b=Actor(actor.client);doc,_=evidence(b)
    assert actor.put('/workspace/actions/'+a['id']+'/status',json={'version':2,'status':'done','note':'不能引用另一个用户的证据','evidence_ids':[doc['id']]}).status_code==404
    done=good(actor.put('/workspace/actions/'+a['id']+'/status',json={'version':2,'status':'done','note':'已核对并保留来源记录'}))
    assert done['payload']['status']=='done' and len(done['payload']['history'])==3
    opened=good(actor.put('/workspace/actions/'+a['id']+'/status',json={'version':3,'status':'open'}));assert opened['version']==4


def test_enterprise_targets_and_dismissals_do_not_rewrite_math(actor):
    d=dataset(actor);before=good(actor.get('/datasets/'+d['id']+'/analysis'))
    good(actor.post('/workspace/profiles',json={'company':d['payload']['company'],'margin_floor':.9,'focus':['cash','margin'],'objective':'核对现金回流'}))
    brief=good(actor.get('/workspace/brief'));m=next(x for x in brief['insights']['items'] if x['code']=='margin')
    assert m['proof']['threshold']==.9 and m['proof']['value']==before['metrics']['gross_margin']
    good(actor.post('/workspace/insights/dismiss',json={'key':m['key'],'note':'验收用途暂不继续提示'}))
    assert m['key'] not in {x['key'] for x in good(actor.get('/workspace/brief'))['insights']['items']}
    assert good(actor.get('/datasets/'+d['id']+'/analysis'))==before
    assert actor.post('/workspace/insights/dismiss',json={'key':'guessed','note':'无效规则标识不能关闭'}).status_code==404


def test_experiment_frozen_and_reports_stale_after_data_edit(actor):
    d=dataset(actor);run=execute(actor,plan(actor,d))
    e=good(actor.post('/workspace/experiments',json={'dataset_id':d['id'],'dataset_version':d['version'],'dataset_hash':d['content_hash'],'name':'frozen scenario','kind':'scenario','price_change':.05,'fixed_cost_share':.2,'assumptions':'测试假设，仅核对冻结输入'}),201)
    raw=editable(d);raw['periods'][-1]['revenue']*=2;good(actor.put('/datasets/'+d['id'],json=raw))
    assert good(actor.get('/workspace/experiments/'+e['id']))==e
    assert good(actor.get('/runs/'+run['id']))['result']==run['result']
    assert good(actor.get('/workspace/reports'))['items'][0]['stale']
    new=execute(actor,plan(actor,good(actor.get('/datasets/'+d['id']))))
    c=good(actor.get('/workspace/reports/compare',params={'left':run['id'],'right':new['id']}))
    assert c['same_period'] and c['input_diff']


@pytest.mark.parametrize('route',['/workspace/datasets/{dataset}/quality','/workspace/datasets/{dataset}/lineage','/workspace/datasets/{dataset}/revisions','/workspace/plans/{plan}','/workspace/experiments/{experiment}','/workspace/runs/{run}/audit','/workspace/runs/{run}/reviews'])
def test_new_object_reads_cannot_cross_accounts(actor,route):
    d=dataset(actor);p=plan(actor,d);r=execute(actor,p)
    e=good(actor.post('/workspace/experiments',json={'dataset_id':d['id'],'dataset_version':d['version'],'dataset_hash':d['content_hash'],'name':'private experiment','kind':'scenario','assumptions':'私有数据测试记录'}),201)
    b=Actor(actor.client);response=b.get(route.format(dataset=d['id'],plan=p['id'],run=r['id'],experiment=e['id']))
    assert response.status_code==404 and d['payload']['company'] not in response.text


def test_model_claim_review_is_separate_from_immutable_claim(factory):
    a=Actor(factory(providers=StudioProvider()));r=execute(a,plan(a,use_llm=True),True);c=r['result']['llm']['review']['claims'][0]
    old=copy.deepcopy(r['result'])
    review=good(a.post('/workspace/runs/'+r['id']+'/reviews',json={'claim_id':c['id'],'verdict':'needs_evidence','note':'需要核查合同与付款周期原文'}))
    assert review['version']==1 and good(a.get('/runs/'+r['id']))['result']==old
    assert a.post('/workspace/runs/'+r['id']+'/reviews',json={'claim_id':'fake','verdict':'accepted','note':'必须检查真正存在的解释'}).status_code==404


def test_export_all_workspace_assets_no_credentials(actor):
    d=dataset(actor);r=execute(actor,plan(actor,d));good(actor.post('/workspace/profiles',json={'company':d['payload']['company']}))
    export=good(actor.get('/workspace/export'))
    assert export['objects']['profile'] and export['agent_artifacts'] and export['event_integrity'] and export['dataset_revisions'] and export['run_events']
    text=json.dumps(export);assert actor.token not in text and actor.password not in text and 'password_hash' not in text


def test_workspace_deletion_guards_and_account_cascade(actor):
    p=plan(actor);r=good(approve(actor,p),202)
    assert actor.delete('/workspace/archive/plan/'+p['id'],params={'version':actor.get('/workspace/plans/'+p['id']).json()['version']}).status_code==409
    good(actor.post('/runs/'+r['id']+'/cancel'));good(actor.delete('/workspace/archive/plan/'+p['id'],params={'version':actor.get('/workspace/plans/'+p['id']).json()['version']}))
    assert actor.get('/workspace/plans/'+p['id']).status_code==404
    assert actor.delete('/workspace/archive/users/anything').status_code==422
    good(actor.delete('/account',json={'email':actor.email,'password':actor.password}))
    s=actor.client.app.state.store
    for table in ['workspace_objects','datasets','dataset_revisions','runs','agent_artifacts','event_integrity']:
        assert s.one(f'SELECT count(*) AS n FROM {table}')['n']==0


def test_artifacts_reports_and_snapshot_are_cross_anchored(actor):
    r=execute(actor,plan(actor));db=actor.client.app.state.store
    check=good(actor.get('/workspace/runs/'+r['id']+'/audit'))
    assert check['snapshot_hash_valid'] and check['report_hash_valid']
    assert all(a['integrity_valid'] and a['event_anchor_valid'] for a in check['artifacts'])
    final=next(a for a in check['artifacts'] if a['node']=='report')
    # Updating both a payload and its local checksum is caught by the separate event anchor.
    modified={**final['payload'],'query':'tampered'}
    with db.transaction() as conn:conn.execute('UPDATE agent_artifacts SET payload=?,content_hash=? WHERE id=?',(encode(modified),digest(modified),final['id']))
    check=good(actor.get('/workspace/runs/'+r['id']+'/audit'));a=next(a for a in check['artifacts'] if a['id']==final['id'])
    assert a['integrity_valid'] and not a['event_anchor_valid'] and not check['report_hash_valid']
    snapshot={**r['snapshot'],'profile':{'tampered':True}}
    with db.transaction() as conn:conn.execute('UPDATE runs SET snapshot=? WHERE id=?',(encode(snapshot),r['id']))
    assert not good(actor.get('/workspace/runs/'+r['id']+'/audit'))['snapshot_hash_valid']


def test_sync_head_and_new_events_are_scoped(actor):
    head=good(actor.get('/sync?head=true'));assert head['items']==[]
    other=Actor(actor.client);dataset(other)
    assert good(actor.get('/sync?after='+str(head['cursor'])))['items']==[]
    d=dataset(actor)
    changes=good(actor.get('/sync?after='+str(head['cursor'])));assert changes['cursor']>head['cursor']
    assert all(x['user_id']==actor.user['id'] for x in changes['items'])
    assert good(other.get('/sync?head=true'))['cursor']!=changes['cursor']


def test_archive_lists_only_owned_metadata_and_cleanup_frees_space(actor):
    p=plan(actor);other=Actor(actor.client);plan(other)
    rows=good(actor.get('/workspace/archive'))['collections']['plan']
    assert rows['total']==1 and rows['items'][0]['id']==p['id']
    assert 'snapshot' not in encode(rows) and 'context' not in encode(rows)
    assert other.delete('/workspace/archive/plan/'+p['id']).status_code==404
    good(actor.delete('/workspace/archive/plan/'+p['id'],params={'version':actor.get('/workspace/plans/'+p['id']).json()['version']}))
    assert good(actor.get('/workspace/archive'))['collections']['plan']['total']==0


def test_early_admission_rejection_has_security_and_no_store(actor):
    r=actor.post('/datasets',json=series(),headers={'Origin':'https://untrusted.invalid'})
    assert r.status_code==403 and r.headers['cache-control']=='no-store'
    assert r.headers['x-content-type-options']=='nosniff' and r.headers['x-frame-options']=='DENY'
    assert r.headers['x-request-id']==r.json()['request_id']


def test_no_history_unless_selected_and_approved(factory):
    a=Actor(factory());d=dataset(a);first=execute(a,plan(a,d));sid=first['session_id']
    p=plan(a,d,session_id=sid,include_history=False)
    assert p['payload']['snapshot']['history']==[] and p['payload']['context']['history']==[]
    p2=plan(a,d,session_id=sid,include_history=True)
    assert p2['payload']['snapshot']['history'] and p2['payload']['context']['history']


def test_memory_revocation_between_calls_blocks_later_dispatch(factory):
    class RevokeAfterFirst(StudioProvider):
        def __init__(self):super().__init__();self.store=None;self.memory=None
        async def complete(self,p,system,context):
            out=await super().complete(p,system,context)
            if len(self.calls)==1:
                with self.store.transaction() as conn:conn.execute('DELETE FROM memories WHERE id=?',(self.memory,))
            return out
    vendor=RevokeAfterFirst();a=Actor(factory(providers=vendor));vendor.store=a.client.app.state.store
    m=good(a.post('/memories',json={'text':'此记忆仅在保留同意的期间使用','approved':True}),201);vendor.memory=m['id']
    p=plan(a,use_llm=True,max_calls=2);r=execute(a,p,True)
    assert len(vendor.calls)==1 and r['result']['llm']['state']=='partial'
    assert r['result']['llm']['calls'][1]['error_class']=='AUTHORIZATION_CHANGED'
    assert len([e for e in good(a.get('/workspace/runs/'+r['id']+'/audit'))['trace'] if e['type']=='external_dispatch'])==1
