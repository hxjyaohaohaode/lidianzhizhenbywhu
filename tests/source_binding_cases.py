"""Real API/worker fixtures; all injected faults affect disposable SQLite only."""
import sys, json, copy, tempfile, asyncio, inspect
from pathlib import Path
from types import SimpleNamespace
from fastapi.testclient import TestClient
from server.app import make_app
from server.config import Settings
from server.store import encode, digest
from conftest import Actor

class Providers:
    def __init__(self,boundary=False):
        if boundary:
            from server.providers import Provider
            self.provider=Provider('audit-stub','synthetic.invalid','/never-networked','local-only','SYNTHETIC-NOT-A-CREDENTIAL')
        else:self.provider=SimpleNamespace(id='audit-stub',model='local-only',host='synthetic.invalid',path='/never-networked')
        self.calls=[];self.on_call=None;self.before_send=None;self.complete_entries=0
    def select(self,id=''):return self.provider if id in ('','audit-stub') else None
    def status(self):return [{'id':'audit-stub','model':'local-only','configured':True}]
    async def complete(self,p,system,context):
        self.complete_entries+=1
        if self.before_send:self.before_send(self.complete_entries)
        if getattr(p,'dispatch_guard',None) and not p.dispatch_guard():
            error=ValueError('MODEL_AUTHORIZATION_CHANGED');error.dispatched=False
            raise error
        if getattr(p,'dispatch_started',None):p.dispatch_started()
        self.calls.append({'context':json.loads(context),'system':system})
        if self.on_call:
            effect=self.on_call(len(self.calls))
            if inspect.isawaitable(effect):await effect
        return {'output':{'claims':[],'missing':[]},'usage':{'total_tokens':0}}

def ok(r,status=200):
    assert r.status_code==status,r.text
    return r.json()

def case(change,stage,adaptive):
    vendor=Providers(boundary=stage=='at_first_send')
    with tempfile.TemporaryDirectory(prefix='dispatch-audit-') as temp:
      settings=Settings(data_dir=Path(temp),origin='http://testserver',production=False,invite_code='')
      with TestClient(make_app(settings,providers=vendor,worker_enabled=False),raise_server_exceptions=False) as client:
        a=Actor(client);store=client.app.state.store;d=a.dataset()
        doc=ok(a.post('/evidence',json={'title':'隔离测试原文','text':'毛利率现金流营业收入成本需要原文核查。'*8,'company':'' if change=='review_global' else d['payload']['company'],'global_scope':change=='review_global'}),201)
        review=store.one("SELECT * FROM workspace_objects WHERE kind='evidence_review' AND natural_key=?",(doc['id'],))
        m=ok(a.post('/memories',json={'text':'隔离测试批准记忆','approved':True,'company':d['payload']['company']}),201)
        profile=ok(a.post('/workspace/profiles',json={'company':d['payload']['company'],'objective':'隔离测试原始目标'}))
        extra={};identity=None;experiment=None;comparison=None;peer=None
        if change.startswith('identity_'):
            identity=ok(a.post('/services/identities',json={'name':'隔离测试身份','perspective':'investor' if change in ('identity_healthy','identity_preferences') else 'operator','dataset_ids':[d['id']],'allow_external':True,'max_calls':2}),201)
            extra['identity_id']=identity['id']
        if change=='experiment_payload':
            from test_saved_experiments import save,reference
            experiment=save(a,d);extra['experiment']=reference(experiment)
        if change.startswith('comparison_'):
            from test_saved_comparisons import saved,reference
            from conftest import editable
            peerbody=editable(d);peerbody.pop('version');peerbody['company']='同行隔离企业'
            peer=ok(a.post('/datasets',json=peerbody),201)
            comparison=saved(a,(d,peer));extra['comparison_artifact']=reference(comparison)
        session=a.conversation(company=d['payload']['company'])
        def tamper():
            if change.startswith('api_'):
                if change=='api_dataset':
                    from conftest import editable
                    altered=editable(d);altered['periods'][-1]['cost']+=9999
                    ok(a.put('/datasets/'+d['id'],json=altered))
                elif change=='api_review':ok(a.put('/workspace/evidence/'+doc['id']+'/review',json={**review['payload'],'version':review['version'],'company':'另一家隔离企业'}))
                elif change=='api_memory':ok(a.put('/memories/'+m['id'],json={**m['payload'],'version':m['version'],'company':'另一家隔离企业'}))
                elif change=='api_profile':ok(a.post('/workspace/profiles',json={**profile['payload'],'version':profile['version'],'objective':'改变后的目标'}))
                elif change=='api_preferences':ok(a.put('/preferences',json={**a.user['preferences'],'version':a.user['version'],'name':'测试偏好更新','memory_enabled':False}))
                else:raise ValueError(change)
                return
            with store.transaction() as db:
                if change in ('review_unset','review_global','review_note','review_stance','review_expiry'):
                    patch={'review_unset':{'company':'','global_scope':False},'review_global':{'global_scope':False},
                        'review_note':{'note':'补充了尚未获准外发的人工说明'},'review_stance':{'stance':'contradicts'},
                        'review_expiry':{'expires_at':'2000-01-01'}}[change]
                    db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode({**review['payload'],**patch}),review['id']))
                elif change in ('memory_identity','memory_role','memory_text','memory_expiry','memory_approval'):
                    patch={'memory_identity':{'identity_id':'another-synthetic-identity'},'memory_role':{'role':'investor'},
                        'memory_text':{'text':'已修改的记忆正文'},'memory_expiry':{'expires_at':'2000-01-01'},'memory_approval':{'approved':False}}[change]
                    db.execute('UPDATE memories SET payload=? WHERE id=?',(encode({**m['payload'],**patch}),m['id']))
                elif change=='evidence_metadata':
                    db.execute('UPDATE evidence SET payload=? WHERE id=?',(encode({**doc['payload'],'title':'来源标题已修改'}),doc['id']))
                elif change=='review_scope':
                    payload={**review['payload'],'company':'另一家隔离企业','global_scope':False}
                    db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(payload),review['id']))
                elif change=='review_rejected':
                    db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode({**review['payload'],'status':'rejected'}),review['id']))
                elif change=='dataset_payload':
                    payload=copy.deepcopy(d['payload']);payload['periods'][-1]['cost']+=9999
                    db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(payload),d['id']))
                elif change=='evidence_text':
                    db.execute('UPDATE evidence SET payload=? WHERE id=?',(encode({**doc['payload'],'text':'已替换的原文不再对应存储哈希。'}),doc['id']))
                elif change=='evidence_chunk':
                    db.execute('UPDATE evidence_chunks SET excerpt=? WHERE document_id=?',('不存在于原始文档的内容。毛利率现金流营业收入成本。',doc['id']))
                elif change=='memory_scope':
                    db.execute('UPDATE memories SET payload=? WHERE id=?',(encode({**m['payload'],'company':'另一家隔离企业'}),m['id']))
                elif change=='profile_payload':
                    db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode({**profile['payload'],'objective':'改变后的目标'}),profile['id']))
                elif change in ('preferences_payload','identity_preferences'):
                    db.execute('UPDATE users SET preferences=? WHERE id=?',(encode({**a.user['preferences'],'memory_enabled':False}),a.user['id']))
                elif change=='history_version':
                    db.execute('UPDATE conversations SET version=version+1 WHERE id=?',(session['id'],))
                elif change=='identity_permission':
                    db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode({**identity['payload'],'allow_external':False}),identity['id']))
                elif change=='identity_payload':
                    db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode({**identity['payload'],'objective':'改变后的身份目标'}),identity['id']))
                elif change=='experiment_payload':
                    altered=copy.deepcopy(experiment['payload']);altered['request']['assumptions']='改变后的实验假设'
                    db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(altered),experiment['id']))
                elif change=='comparison_payload':
                    db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode({**comparison['payload'],'comparability_note':'改变后的可比性说明'}),comparison['id']))
                elif change=='comparison_peer_payload':
                    altered=copy.deepcopy(peer['payload']);altered['periods'][-1]['cost']+=9999
                    db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(altered),peer['id']))
                elif change=='plan_context':
                    altered=copy.deepcopy(plan['payload']);altered['context']['question']='改变后的未批准问题'
                    db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(altered),plan['id']))
                elif change=='run_context':
                    altered=copy.deepcopy(run['snapshot']);altered['studio']['context']['question']='改变后的未批准问题'
                    db.execute('UPDATE runs SET snapshot=? WHERE id=?',(encode(altered),run['id']))
                elif change in ('unchanged','identity_healthy'):pass
                else:raise ValueError(change)
        if stage=='before_preview':tamper()
        body={'dataset_id':d['id'],'query':'核查毛利率现金流营业收入成本','mode':'operational','use_llm':True,'provider':'audit-stub','max_calls':2,'session_id':'' if identity else session['id'],'include_history':True,**extra}
        if adaptive:body['execution']={'max_revisions':0,'parallelism':1}
        resp=a.post('/workspace/plans',json=body)
        result={'change':change,'stage':stage,'engine':'adaptive' if adaptive else 'studio','preview_status':resp.status_code}
        if resp.status_code!=201:result.update(error=resp.json(),stub_calls=len(vendor.calls));return result
        plan=resp.json();result['requested_adaptive']=adaptive;result['engine']='adaptive' if plan['payload'].get('adaptive') else 'studio'
        result['frozen_dataset_hash_matches']=digest(plan['payload']['snapshot']['dataset'])==plan['payload']['snapshot']['dataset_hash']
        result['citations']=len(plan['payload']['snapshot']['citations'])
        result['frozen_excerpt_matches_raw']=all(c['excerpt']==doc['payload']['text'][c['start']:c['end']] for c in plan['payload']['snapshot']['citations'])
        if stage=='before_approval':tamper()
        resp=a.post('/workspace/plans/'+plan['id']+'/execute',json={'version':plan['version'],'fingerprint':plan['payload']['fingerprint'],'external_consent':True})
        result['approval_status']=resp.status_code
        if resp.status_code!=202:result.update(error=resp.json(),stub_calls=len(vendor.calls));return result
        run=resp.json();frozen=copy.deepcopy(run['snapshot'])
        if stage=='after_approval':tamper()
        if stage=='after_first_call':
            vendor.on_call=(lambda n:asyncio.to_thread(tamper) if n==1 else None) if change.startswith('api_') else (lambda n:tamper() if n==1 else None)
        if stage=='at_first_send':vendor.before_send=lambda n:tamper() if n==1 else None
        if stage=='resume_after_first':
            def pause(n):
                if n==1:
                    with store.transaction() as db:db.execute("UPDATE adaptive_controls SET status='pause_requested' WHERE run_id=?",(run['id'],))
            vendor.on_call=pause
        completed=a.execute(run)
        if stage=='resume_after_first':
            assert adaptive and completed['state']=='interrupted' and len(vendor.calls)==1,completed
            result['calls_before_resume']=len(vendor.calls)
            tamper();vendor.on_call=None
            rt=ok(a.get('/workspace/runs/'+run['id']+'/runtime'))
            resp=a.post('/workspace/runs/'+run['id']+'/control',json={'version':rt['control']['version'],'action':'resume'})
            result['resume_status']=resp.status_code
            assert resp.status_code==200,resp.text
            completed=a.execute(run)
            result['reused_checkpoint_count']=len(store.all("SELECT * FROM run_events WHERE run_id=? AND type='checkpoint_reused'",(run['id'],)))
        result.update(stub_calls=len(vendor.calls),provider_entries=vendor.complete_entries,state=completed['state'],snapshot_unchanged=completed['snapshot']==frozen,
            sent_citation_counts=[len(c['context'].get('evidence',[])) for c in vendor.calls],
            sent_memory_counts=[len(c['context'].get('approved_memory',[])) for c in vendor.calls],
            dispatch_events=len(store.all("SELECT * FROM run_events WHERE run_id=? AND type='external_dispatch'",(run['id'],))),
            blocked_events=[e['payload'] for e in store.all("SELECT * FROM run_events WHERE run_id=? AND type='external_dispatch_blocked'",(run['id'],))])
        if completed.get('result'):
            result['call_outcomes']=completed['result'].get('llm',{})
            from server.report_integrity import inspect_report_integrity
            result['report_integrity']=inspect_report_integrity(store,completed)['report_integrity']
        return result
