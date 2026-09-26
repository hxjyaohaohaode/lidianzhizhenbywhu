from __future__ import annotations
import asyncio
import json
import sqlite3
import threading
import time
from contextlib import closing
from types import SimpleNamespace
import pytest
from conftest import Actor,editable
from server.store import Store,encode,digest
from server.workflows import STEPS
from server.models import calculate

class FakeProvider:
    """Explicit fault injection; passing these tests does NOT prove real vendor access."""
    def __init__(self,output=None,fail=False,delay=0):self.calls=[];self.output=output;self.fail=fail;self.delay=delay
    def select(self,id=''):return SimpleNamespace(id='injected-test',model='fixture-model')
    def status(self):return [{'id':'injected-test','model':'fixture-model','configured':True,'connectivity':'test_double'}]
    async def complete(self,p,system,context):
        self.calls.append(json.loads(context))
        if self.delay:await asyncio.sleep(self.delay)
        if self.fail:raise RuntimeError('injected failure')
        output=self.output or {'claims':[{'text':'现金回流需要结合销售收入核查。','metric_ids':['cash_ratio'],'citation_ids':[],'uncertainty':'high'}],'missing':[]}
        return {'output':output,'model':p.model,'provider':p.id,'usage':{'prompt_tokens':123,'completion_tokens':45,'total_tokens':168}}
class EmptyProvider:
    def select(self,id=''):return None
    def status(self):return []

def test_full_workflow_seven_steps_and_export(actor):
    d=actor.dataset();s=actor.conversation();run=actor.execute(actor.run(d,s).json());assert run['state']=='succeeded',run
    result=run['result'];assert result['dataset_version']==1 and result['dataset_hash']==d['content_hash']
    assert result['llm']['state']=='not_requested' and result['llm']['calls']==[]
    assert result['memory_used']==[] and result['quality']['source_kind']=='sample'
    events=actor.get('/runs/'+run['id']+'/trace').json()['items'];assert events[0]['type']=='queued'
    assert {e['payload']['node'] for e in events if e['type']=='step_completed'}=={s['id'] for s in STEPS}
    assert events[-1]['type']=='succeeded' and all(e['payload']['duration_ms']>=0 for e in events if e['type']=='step_completed')
    messages=actor.get('/conversations/'+s['id']+'/messages').json()['items'];assert [m['role'] for m in messages]==['user','assistant']
    for fmt in ['json','md']:
        ex=actor.get(f'/runs/{run["id"]}/export?format={fmt}');assert ex.status_code==200 and 'attachment' in ex.headers['content-disposition'] and d['content_hash'] in ex.text
    assert len(actor.get('/runs/'+run['id']+'/export').json()['execution_events'])==len(events)
def test_idempotency_and_changed_payload_conflict(actor):
    d=actor.dataset();s=actor.conversation();key='stable_request_key';a=actor.run(d,s,key=key);b=actor.run(d,s,key=key)
    assert a.status_code==202 and b.status_code==202 and a.json()['id']==b.json()['id']
    assert actor.run(d,s,key=key,query='different').status_code==409 and actor.run(d,s,key='short').status_code==422
    assert len(actor.get('/runs').json()['items'])==1 and len(actor.get('/conversations/'+s['id']+'/messages').json()['items'])==1
def test_queue_bound_and_cancel_frees_capacity(actor):
    d=actor.dataset();s=actor.conversation();runs=[actor.run(d,s).json() for _ in range(6)]
    assert actor.run(d,s).status_code==429
    assert actor.post('/runs/'+runs[0]['id']+'/cancel').json()['state']=='cancelled'
    assert actor.run(d,s).status_code==202
    r=actor.execute(runs[0]);assert r['state']=='cancelled' and r['result'] is None
    assert actor.post('/runs/'+runs[0]['id']+'/cancel').json()['state']=='cancelled'
def test_immutable_snapshot_and_scenario(actor):
    d=actor.dataset();s=actor.conversation();r=actor.run(d,s).json();body=editable(d);body['periods'][-1]['revenue']*=1.5
    assert actor.put('/datasets/'+d['id'],json=body).status_code==200
    run=actor.execute(r);assert run['snapshot']['dataset_version']==1 and run['result']['analysis']['series'][-1]['revenue']==d['payload']['periods'][-1]['revenue']
    sc=actor.post('/scenarios',json={'dataset_id':d['id'],'run_id':run['id'],'price_change':0,'cost_change':0,'volume_change':0})
    assert sc.status_code==200 and sc.json()['dataset_version']==1 and sc.json()['revenue']==d['payload']['periods'][-1]['revenue']
    other=actor.dataset();assert actor.post('/scenarios',json={'dataset_id':other['id'],'run_id':r['id'],'price_change':0,'cost_change':0,'volume_change':0}).status_code==422
def test_company_binding(actor):
    d=actor.dataset();s=actor.conversation();assert actor.run(d,s).status_code==202
    other=actor.dataset();b=editable(other);b['company']='另一家企业';actor.put('/datasets/'+other['id'],json=b)
    assert actor.run(other,s).status_code==409
@pytest.mark.parametrize('field,value',[('approved',False),('expires_at','2020-01-01'),('company','不匹配企业'),('role','investor')])
def test_unapproved_expired_or_scoped_memories_excluded(actor,field,value):
    d=actor.dataset();s=actor.conversation();r=actor.post('/memories',json={'text':'不应使用','approved':True,field:value});assert r.status_code==201
    assert actor.run(d,s).json()['snapshot']['memory']==[]
def test_memory_selection_snapshot_then_deletion(actor):
    m=actor.post('/memories',json={'text':'优先核对现金回流','kind':'preference','approved':True}).json();d=actor.dataset();s=actor.conversation();r=actor.run(d,s).json()
    assert [x['id'] for x in r['snapshot']['memory']]==[m['id']]
    assert actor.delete('/memories/'+m['id']).status_code==200
    assert actor.execute(r)['result']['memory_selected']==[{'id':m['id'],'version':1}]
    assert actor.run(d,s).json()['snapshot']['memory']==[] and actor.run(d,s,include_memory=False).json()['snapshot']['memory']==[]
def test_history_only_same_session(actor):
    d=actor.dataset();s=actor.conversation();actor.execute(actor.run(d,s,query='第一次核对现金流').json());history=actor.run(d,s).json()['snapshot']['history']
    assert len(history)==2 and history[0]['text']=='第一次核对现金流'
    assert actor.run(d,actor.conversation()).json()['snapshot']['history']==[]
def test_unconfigured_model_is_degraded_not_fake(factory):
    a=Actor(factory(providers=EmptyProvider()));r=a.execute(a.run(use_llm=True,provider='absent').json())
    assert r['state']=='degraded' and r['result']['llm']['state']=='unavailable'
    assert r['result']['llm']['review']['claims']==[] and r['result']['llm']['calls']==[]
def test_two_specialists_and_context_boundaries(factory):
    p=FakeProvider();a=Actor(factory(providers=p));a.post('/memories',json={'text':'偏好现金流研究','approved':True});r=a.execute(a.run(use_llm=True).json())
    assert len(p.calls)==2 and r['result']['llm']['state']=='completed' and all(len(encode(x))<=18000 for x in p.calls)
    assert len(r['result']['llm']['calls'])==2 and len(r['result']['memory_used'])==1
    assert all(c['verification']=='requires_human_review' for c in r['result']['llm']['review']['claims'])
    assert all('password' not in encode(x) and 'api_key' not in encode(x) for x in p.calls)
def test_without_consent_no_external_calls(factory):
    p=FakeProvider();a=Actor(factory(providers=p));r=a.execute(a.run(use_llm=False).json());assert p.calls==[] and r['result']['llm']['state']=='not_requested'
@pytest.mark.parametrize('bad',[{'text':'毛利率99%','metric_ids':['gross_margin'],'citation_ids':[]},{'text':'推测结果','metric_ids':['invented_metric'],'citation_ids':[]},{'text':'推测结果','metric_ids':[],'citation_ids':['other-user-secret']},{'text':'无依据陈述','metric_ids':[],'citation_ids':[]},{'text':'见https://evil.example','metric_ids':['cash_ratio'],'citation_ids':[]}])
def test_fabricated_reference_numbers_and_links_rejected(factory,bad):
    p=FakeProvider(output={'claims':[{**bad,'uncertainty':'high'}],'missing':[]});a=Actor(factory(providers=p));r=a.execute(a.run(use_llm=True).json())
    assert r['result']['llm']['review']['claims']==[] and r['result']['llm']['review']['rejected_claims']==2
def test_provider_failure_and_task_timeout_terminal(factory):
    p=FakeProvider(fail=True);a=Actor(factory(providers=p));r=a.execute(a.run(use_llm=True).json())
    assert r['state']=='degraded' and r['result']['llm']['state']=='failed' and len(p.calls)==2
    p2=FakeProvider(delay=1);a2=Actor(factory(providers=p2,run_timeout=.05));r2=a2.execute(a2.run(use_llm=True).json());assert r2['state']=='failed' and r2['result'] is None
def test_oversized_required_context_prevents_dispatch(factory):
    p=FakeProvider();a=Actor(factory(providers=p,max_context_chars=1024));r=a.execute(a.run(use_llm=True,query='非常长的核查问题'*200).json())
    assert r['result']['llm']['state']=='failed' and p.calls==[] and r['result']['memory_used']==[]
def test_cancel_running_no_late_result(factory):
    class BlockedProvider(FakeProvider):
        def __init__(self):super().__init__();self.started=threading.Event();self.release=threading.Event()
        async def complete(self,p,system,context):
            self.started.set()
            await asyncio.to_thread(self.release.wait,10)
            return await super().complete(p,system,context)
    p=BlockedProvider();c=factory(providers=p,worker=False);a=Actor(c)
    # Build the explicitly authorized fixture before starting the worker;
    # otherwise a fast worker can complete the queued row before the fixture update.
    r=a.run(use_llm=True).json();assert r['state']=='queued'
    worker=c.app.state.worker
    try:
        c.portal.call(worker.start)
        assert p.started.wait(10),'provider was never entered'
        assert a.get('/runs/'+r['id']).json()['state']=='running'
        assert a.post('/runs/'+r['id']+'/cancel').json()['state']=='cancelled'
        p.release.set()
        final=a.get('/runs/'+r['id']).json();assert final['state']=='cancelled' and final['result'] is None
    finally:
        p.release.set()
        c.portal.call(worker.stop)
def test_restart_interrupts_unfinished_without_paid_retry(actor,client):
    r=actor.run().json()
    with client.app.state.store.transaction() as db:db.execute("UPDATE runs SET state='running' WHERE id=?",(r['id'],))
    w=client.app.state.worker;client.portal.call(w.start)
    try:
        run=actor.get('/runs/'+r['id']).json();assert run['state']=='interrupted' and run['result'] is None
    finally:client.portal.call(w.stop)
def test_sse_resume_cursor(actor):
    r=actor.execute(actor.run().json());path='/runs/'+r['id'];events=actor.get(path+'/trace').json()['items'];pivot=events[3]['seq']
    response=actor.get(path+'/events',headers={'Last-Event-ID':str(pivot)})
    assert response.status_code==200 and response.headers['content-type'].startswith('text/event-stream')
    ids=[int(line[4:]) for line in response.text.splitlines() if line.startswith('id: ')]
    assert ids==[e['seq'] for e in events if e['seq']>pivot] and 'event: end' in response.text
    assert actor.get(path+'/events',headers={'Last-Event-ID':'x'}).status_code==422
def test_evidence_snapshot_survives_deletion(actor):
    doc=actor.post('/evidence',json={'title':'毛利率说明','text':'毛利率下降与碳酸锂采购成本、营业成本变化有关，经营现金流需要审阅财报。'*10}).json();r=actor.run(query='毛利率和碳酸锂采购成本').json()
    assert r['snapshot']['citations'];actor.delete('/evidence/'+doc['id']);run=actor.execute(r)
    assert run['result']['citations']==r['snapshot']['citations'] and actor.get('/retrieval?q=碳酸锂采购成本').json()['items']==[]
def test_duplicate_worker_claim_only_executes_once(actor,client):
    r=actor.run().json()
    async def double():await asyncio.gather(client.app.state.worker.execute(r['id']),client.app.state.worker.execute(r['id']))
    client.portal.call(double);events=actor.get('/runs/'+r['id']+'/trace').json()['items']
    assert sum(e['type']=='running' for e in events)==1 and sum(e['type']=='succeeded' for e in events)==1
def test_rollback_backup_and_reload(actor,client,tmp_path):
    row=actor.dataset();store=client.app.state.store
    with pytest.raises(RuntimeError):
        with store.transaction() as db:db.execute('DELETE FROM datasets WHERE id=?',(row['id'],));raise RuntimeError('rollback')
    assert actor.get('/datasets/'+row['id']).status_code==200
    path=tmp_path/'backup.sqlite3';store.backup(path);copy=Store(path)
    try:
        assert copy.owned('datasets',actor.user['id'],row['id'])['content_hash']==row['content_hash']
        assert copy.one('PRAGMA integrity_check')['integrity_check']=='ok'
    finally:copy.close()
def test_sync_pagination_lossless(actor):
    for _ in range(5):actor.dataset()
    cursor=0;ids=[]
    while True:
        page=actor.get(f'/sync?after={cursor}&limit=2').json();ids.extend(e['seq'] for e in page['items']);cursor=page['cursor']
        if not page['has_more']:break
    assert len(ids)==5 and len(set(ids))==5 and actor.get(f'/sync?after={cursor}').json()['cursor']==cursor
def test_common_period_comparison_and_refusal(actor):
    a=actor.dataset();b=actor.dataset();p=editable(b);p['company']='乙企业';p['periods']=p['periods'][:-1];actor.put('/datasets/'+b['id'],json=p)
    r=actor.post('/compare',json={'dataset_ids':[a['id'],b['id']]});assert r.status_code==200 and r.json()['period']=='2026-Q2'
    assert all(x['analysis']['current_period']=='2026-Q2' and x['source_kind']=='sample' for x in r.json()['items'])
    p=editable(actor.get('/datasets/'+b['id']).json());p['periods']=[{'period':'2020-Q1','revenue':1.,'cost':1.}];actor.put('/datasets/'+b['id'],json=p)
    assert actor.post('/compare',json={'dataset_ids':[a['id'],b['id']]}).status_code==422
def test_index_owner_delete_and_migration_backfill(actor,client,tmp_path):
    from server.retrieval import retrieve_indexed
    db=client.app.state.store;ev=actor.post('/evidence',json={'title':'经营毛利率','text':'碳酸锂成本变化需要结合毛利率分析。'*200}).json();hits=actor.get('/retrieval?q=碳酸锂成本毛利率').json()['items']
    assert hits and all(x['document_id']==ev['id'] for x in hits)
    assert actor.get('/retrieval?q=%22%20OR%20owner%20NOT%20anything').status_code==200
    with db.transaction() as c:c.execute('DELETE FROM evidence_chunks');c.execute('DELETE FROM schema_version WHERE version=2')
    backup=tmp_path/'migrate.sqlite3';db.backup(backup);reloaded=Store(backup)
    try:
        assert retrieve_indexed(reloaded,actor.user['id'],'碳酸锂成本毛利率')
        assert reloaded.one('SELECT MAX(version) AS n FROM schema_version')['n']==3
    finally:reloaded.close()
    actor.delete('/evidence/'+ev['id']);assert db.one('SELECT count(*) AS n FROM evidence_fts')['n']==0 and db.one('SELECT count(*) AS n FROM evidence_chunks')['n']==0
def test_future_schema_refused_without_mutation(tmp_path):
    p=tmp_path/'future.sqlite3'
    with closing(sqlite3.connect(p)) as c:c.execute('CREATE TABLE schema_version(version INTEGER PRIMARY KEY)');c.execute('INSERT INTO schema_version VALUES(999)');c.commit()
    with pytest.raises(RuntimeError):Store(p)
    with closing(sqlite3.connect(p)) as c:assert c.execute('SELECT name FROM sqlite_master WHERE type="table"').fetchall()==[('schema_version',)]
@pytest.mark.parametrize('mode',['operational','margin','industry','investment','deep_dive'])
def test_five_modes_identical_numbers_distinct_presentation(actor,mode):
    d=actor.dataset();r=actor.execute(actor.run(d,mode=mode).json());assert r['result']['mode']==mode
    assert r['result']['analysis']['gmps']['score']==calculate(d['payload'])['gmps']['score']
    if mode=='investment':assert any('偏好' in f for f in r['result']['findings'])
    if mode=='industry':assert any('实时行情' in f for f in r['result']['findings'])
    if mode=='margin':assert any('贡献' in f for f in r['result']['findings'])
def test_worker_concurrency_and_shutdown(factory):
    p=FakeProvider(delay=.6);c=factory(providers=p,worker=True);a=Actor(c);d=a.dataset();s=a.conversation();ids=[a.run(d,s,use_llm=True).json()['id'] for _ in range(4)];time.sleep(.12)
    states=[a.get('/runs/'+id).json()['state'] for id in ids];assert states.count('running')<=2 and len(c.app.state.worker.active)<=2
    c.portal.call(c.app.state.worker.stop);assert all(a.get('/runs/'+id).json()['state']!='running' for id in ids)
def test_task_submission_bounded_indexed_retrieval(actor,monkeypatch):
    actor.post('/evidence',json={'title':'采购与现金流','text':'碳酸锂采购成本和经营现金流需要用锂电企业季度财报核对。'*20});store=actor.client.app.state.store;original=store.items
    def bounded(table,user,limit=200):
        assert table!='evidence','Submission must not load every full evidence document';return original(table,user,limit)
    monkeypatch.setattr(store,'items',bounded);r=actor.run(query='分析碳酸锂采购成本和现金流');assert r.status_code==202 and r.json()['snapshot']['citations']
