"""Adaptive engine contract, recovery, and adversarial regressions.

Provider doubles below deliberately do not make external network/model requests.
Every run is created through the real preview/approval API.
"""
import asyncio
import copy
import json
from datetime import datetime, timedelta, timezone
import pytest
from pydantic import ValidationError
from conftest import Actor, editable
from server.providers import Provider, ProviderService
from server.autonomy import validate_graph, node
from server.autonomy_contracts import ExecutionOptions, PlannerProposal
from server.adaptive_runtime import AdaptiveRun, check_claims
from server.store import digest, encode, now

class ResearchProviders(ProviderService):
    def __init__(self, handler=None, proposal=None):
        super().__init__();self.providers={k:Provider(k,'model.test.example','/chat',k+'-test','fixture-key') for k in ['alpha','beta']}
        self.handler=handler;self.proposal=proposal;self.calls=[];self.active=0;self.peak=0
    async def complete(self,p,system,context):
        obj=json.loads(context);self.calls.append({'provider':p.id,'system':system,'context':obj});self.active+=1;self.peak=max(self.active,self.peak)
        try:
            await asyncio.sleep(.005)
            if self.handler:return await self.handler(p,system,obj,len(self.calls))
            return {'output':{'claims':[{'text':('经营现金流需结合账期核验' if '反证' in system else '毛利率变化仍需核对原始报表'),'metric_ids':['gross_margin']}],'missing':[]},'usage':{'total_tokens':15},'provider':p.id,'model':p.model}
        finally:self.active-=1
    async def propose(self,p,context):
        self.calls.append({'provider':p.id,'planner':True,'context':json.loads(context)})
        if isinstance(self.proposal,Exception):raise self.proposal
        return {'output':self.proposal or {'focus':['quality','counterevidence'],'specialists':['analyst','challenger'],'rationale':'补充反向证据并保留审阅'},'usage':{'total_tokens':10}}

def preview(actor,dataset=None,**kwargs):
    dataset=dataset or actor.dataset()
    payload={'dataset_id':dataset['id'],'query':'核验企业经营变化及现金情况','mode':'operational','execution':{},**kwargs}
    r=actor.post('/workspace/plans',json=payload)
    assert r.status_code==201,r.text
    return r.json()

def dispatch(actor,plan,consent=True):
    r=actor.post('/workspace/plans/'+plan['id']+'/execute',json={'version':plan['version'],'fingerprint':plan['payload']['fingerprint'],'external_consent':consent})
    assert r.status_code==202,r.text
    return r.json()

def runtime(actor,run):
    r=actor.get('/workspace/runs/'+run['id']+'/runtime');assert r.status_code==200,r.text;return r.json()

def short_dataset(actor):
    # This adverse fixture stays below the six-complete-quarter threshold after
    # UTC quarter boundaries; it must not depend on the wall-clock date.
    row=actor.dataset();body=editable(row);body['periods']=body['periods'][:5]
    response=actor.put('/datasets/'+row['id'],json=body)
    assert response.status_code==200,response.text
    return response.json()


def completed(actor,**kwargs):
    return actor.execute(dispatch(actor,preview(actor,**kwargs)))

@pytest.mark.parametrize('execution',[
 {'role_providers':{'analyst':'https://private/'}},{'role_providers':{'unknown':'alpha'}},
 {'fallback_providers':['alpha','alpha']},{'max_revisions':3},{'parallelism':0},
 {'total_context_chars':1999},{'depth':'unlimited'},{'run_shell':'rm -rf /'},
 {'scenario':{'price_change':float('inf'),'note':'明确假设说明'}},
])
def test_reject_unbounded_or_unknown_options(execution):
    with pytest.raises(ValidationError):ExecutionOptions.model_validate(execution)

@pytest.mark.parametrize('query,execution,capability',[
 ('检查经营数据与现金回流',{},'quant'),('进行收入预测并核查误差',{},'forecast'),
 ('梳理反向证据和替代解释',{},'counterevidence'),('检查经营数据与现金回流',{'depth':'deep'},'gaps'),
 ('研究成本假设的影响边界',{'scenario':{'price_change':.1,'cost_change':.05,'volume_change':.1,'fixed_cost_share':.3,'note':'为压力测试明确设定的假设'}},'sensitivity'),
])
def test_goal_compiles_different_registered_graph(actor,query,execution,capability):
    p=preview(actor,query=query,execution=execution)['payload'];g=p['adaptive']
    assert capability in [n['capability'] for n in g['nodes']]
    assert g['envelope']['max_calls']==0 and not g['envelope']['can_write_business_data']
    layers=validate_graph(g['nodes']);positions={v:i for i,layer in enumerate(layers) for v in layer}
    for n in g['nodes']:
        assert all(positions[d]<positions[n['id']] for d in n['depends_on'])
    assert g['nodes'][-1]['id']=='report'

@pytest.mark.parametrize('nodes',[[node('quality'),node('quality')],[node('quant',['missing'])],[node('quality',['quant']),node('quant',['quality'])],[{**node('quality'),'capability':'shell'}]])
def test_graph_rejects_duplicates_missing_cycles_unknown(nodes):
    with pytest.raises(ValueError):validate_graph(nodes)

def test_local_replanning_outputs_real_checkpoints_and_ledger(actor):
    d=actor.dataset();b=editable(d);b['periods'][-1]['rd_expense']=None
    update=actor.put('/datasets/'+d['id'],json=b);assert update.status_code==200
    r=completed(actor,dataset=update.json());rt=runtime(actor,r)
    assert r['result'] and r['state'] in ('succeeded','degraded')
    assert rt['graph']['version']>1
    assert any(n['capability']=='gaps' for n in rt['graph']['payload']['nodes'])
    assert rt['usage']['attempts']==0
    assert all(c['artifact_id'] for c in rt['checkpoints'])
    assert len({c['node_id'] for c in rt['checkpoints']})==len(rt['checkpoints'])
    audit=actor.get('/workspace/runs/'+r['id']+'/audit').json()
    assert audit['ledger']['valid'] and audit['report_hash_valid']
    assert all(a['event_anchor_valid'] and a['integrity_valid'] for a in audit['artifacts'])
    assert r['result']['adaptive']['reflection']['automatic_code_changes']==0

def test_optional_predictor_blocks_short_series_but_preserves_report(actor):
    r=completed(actor,dataset=short_dataset(actor),query='预测营业收入并说明样本限制')
    assert r['state']=='degraded' and r['result']['analysis']['metrics']
    assert r['result']['adaptive']['mathematical_outputs']['forecast']['status']=='blocked'
    assert r['result']['llm']['state']=='not_requested'

def test_pause_queued_resume_idempotency_and_terminal_guard(actor):
    r=dispatch(actor,preview(actor));rt=runtime(actor,r)
    path='/workspace/runs/'+r['id']+'/control'
    paused=actor.post(path,json={'version':rt['control']['version'],'action':'pause'})
    assert paused.status_code==200
    assert runtime(actor,r)['state']=='paused'
    assert actor.post(path,json={'version':1,'action':'resume'}).status_code==409
    assert actor.post(path,json={'version':paused.json()['version'],'action':'resume'}).status_code==200
    done=actor.execute(r);count=len(runtime(actor,r)['checkpoints'])
    actor.execute(r)
    assert len(runtime(actor,r)['checkpoints'])==count and done['result']
    assert actor.post(path,json={'version':runtime(actor,r)['control']['version'],'action':'resume'}).status_code==409

def test_paused_run_can_cancel(actor):
    r=dispatch(actor,preview(actor));actor.post('/workspace/runs/'+r['id']+'/control',json={'version':1,'action':'pause'})
    reply=actor.post('/runs/'+r['id']+'/cancel',json={});assert reply.status_code==200,reply.text
    assert actor.get('/runs/'+r['id']).json()['state']=='cancelled'
    actor.execute(r);assert runtime(actor,r)['checkpoints']==[]

def test_control_cross_account_and_legacy_rejected(client,actor):
    other=Actor(client);r=dispatch(actor,preview(actor))
    assert other.get('/workspace/runs/'+r['id']+'/runtime').status_code==404
    assert other.post('/workspace/runs/'+r['id']+'/control',json={'version':1,'action':'pause'}).status_code==404
    legacy=actor.run().json();assert actor.get('/workspace/runs/'+legacy['id']+'/runtime').status_code==409

@pytest.mark.parametrize('max_calls',[1,2,4,8])
def test_external_attempts_respect_cumulative_bound(factory,max_calls):
    ps=ResearchProviders();a=Actor(factory(ps));r=completed(a,use_llm=True,provider='alpha',max_calls=max_calls)
    assert r['result'],r
    rt=runtime(a,r);assert 0<len(ps.calls)==rt['usage']['attempts']<=max_calls
    assert rt['usage']['characters']==sum(c['characters'] for c in rt['calls'])
    assert rt['usage']['tokens_complete']
    assert all(c['payload']['request_hash'] for c in rt['calls'])

def test_model_planner_is_bounded_and_does_not_receive_raw_memories(factory):
    ps=ResearchProviders();a=Actor(factory(ps));a.post('/memories',json={'text':'私人研究偏好，优先核验现金口径','kind':'preference','approved':True})
    r=completed(a,use_llm=True,provider='alpha',max_calls=5,execution={'model_planning':True})
    assert r['result'],r
    planner=next(c for c in ps.calls if c.get('planner'))
    assert 'approved_memory' not in planner['context'] and 'evidence' not in planner['context']
    rt=runtime(a,r);call=next(c for c in rt['calls'] if c['node_id']=='planner')
    assert call['payload']['memory_ids']==[] and call['payload']['citation_ids']==[]
    assert rt['graph']['payload']['model_proposal']['rationale']
    assert 'counterevidence' in {n['id'] for n in rt['graph']['payload']['nodes']}

@pytest.mark.parametrize('proposal',[{'focus':['shell'],'specialists':[],'rationale':'执行shell'}, {'focus':[],'specialists':[],'rationale':'合理但有越权工具','tools':['http://localhost']},ValueError('bad json')])
def test_planner_injection_or_failure_keeps_safe_local_graph(factory,proposal):
    ps=ResearchProviders(proposal=proposal);a=Actor(factory(ps));r=completed(a,use_llm=True,provider='alpha',max_calls=4,execution={'model_planning':True})
    assert r['result'] and r['state']=='degraded'
    assert r['result']['analysis']['metrics'] and not runtime(a,r)['graph']['payload'].get('model_proposal')
    assert any(e['type']=='graph_replanned' for e in a.get('/runs/'+r['id']+'/trace').json()['items'])

@pytest.mark.parametrize('limit',[0,1,2])
def test_adaptive_revision_is_bounded_and_independently_rechecked(factory,limit):
    async def invalid(p,system,obj,index):return {'output':{'claims':[{'text':'不符合引用范围的解释','metric_ids':['invented_metric']}],'missing':[]},'usage':{}}
    ps=ResearchProviders(invalid);a=Actor(factory(ps));r=completed(a,use_llm=True,provider='alpha',max_calls=8,execution={'max_revisions':limit})
    assert r['result'],r
    rt=runtime(a,r);revisions=[n for n in rt['graph']['payload']['nodes'] if n['capability']=='revision']
    assert len(revisions)==limit and len(ps.calls)==2+limit
    assert r['result']['llm']['review']['claims']==[] and r['result']['llm']['review']['rejected_claims']
    assert all(any(c['node_id']=='review_'+str(i+1) for c in rt['checkpoints']) for i in range(limit))

def test_revision_can_fix_structure_without_mutating_prior_artifact(factory):
    async def replies(p,system,obj,index):
        metric='gross_margin' if 'structural_rejections' in obj else 'invented_metric'
        return {'output':{'claims':[{'text':'毛利率仍须核对原始报表','metric_ids':[metric]}],'missing':[]},'usage':{}}
    ps=ResearchProviders(replies);a=Actor(factory(ps));r=completed(a,use_llm=True,provider='alpha',max_calls=4)
    assert r['result'],r
    assert r['result']['llm']['review']['claims'] and r['result']['llm']['review']['rejected_claims']==0
    arts=a.get('/workspace/runs/'+r['id']+'/audit').json()['artifacts']
    assert next(c for c in arts if c['node']=='review')['payload']['rejected_claims']>0
    assert all(c['integrity_valid'] and c['event_anchor_valid'] for c in arts)

def test_separate_role_models_and_no_unapproved_fallback(factory):
    ps=ResearchProviders();a=Actor(factory(ps));r=completed(a,use_llm=True,provider='alpha',max_calls=2,execution={'role_providers':{'challenger':'beta'}})
    rt=runtime(a,r);assert {(c['node_id'],c['provider']) for c in rt['calls']}=={('analyst','alpha'),('challenger','beta')}

@pytest.mark.parametrize('error,expected_fallback',[('MODEL_HTTP_429',True),('MODEL_HTTP_500',False),('MODEL_CIRCUIT_OPEN',False),('TIMEOUT',False)])
def test_only_explicit_acknowledged_throttle_can_use_opted_in_fallback(factory,error,expected_fallback):
    async def fn(p,system,obj,index):
        if p.id=='alpha':
            if error=='TIMEOUT':raise TimeoutError()
            raise ValueError(error)
        return {'output':{'claims':[],'missing':[]},'usage':{}}
    ps=ResearchProviders(fn);a=Actor(factory(ps));r=completed(a,use_llm=True,provider='alpha',max_calls=4,execution={'fallback_providers':['beta']})
    assert r['result'],r
    assert any(c['provider']=='beta' for c in ps.calls)==expected_fallback
    assert runtime(a,r)['usage']['attempts']<=4

def test_exhausted_character_budget_never_dispatches(factory):
    ps=ResearchProviders();a=Actor(factory(ps));r=completed(a,use_llm=True,provider='alpha',max_calls=2,query='核验数据'+('需核对原报表。'*210),execution={'total_context_chars':2000})
    assert r['result'] and not ps.calls
    assert r['result']['llm']['state']=='failed' and runtime(a,r)['usage']['attempts']==0

def test_provider_binding_changed_before_dispatch_is_blocked(factory):
    ps=ResearchProviders();a=Actor(factory(ps));p=preview(a,use_llm=True,provider='alpha',max_calls=4,execution={'role_providers':{'challenger':'beta'}})
    ps.providers['beta'].model='changed-model'
    r=a.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint'],'external_consent':True})
    assert r.status_code==409 and not ps.calls

def test_data_revocation_between_approval_and_dispatch_blocks_external(factory):
    ps=ResearchProviders();a=Actor(factory(ps));d=a.dataset();r=dispatch(a,preview(a,d,use_llm=True,provider='alpha',max_calls=2))
    b=editable(d);b['notes']='新版本已改变模型授权范围';assert a.put('/datasets/'+d['id'],json=b).status_code==200
    done=a.execute(r);assert done['result'] and not ps.calls
    assert done['result']['dataset_version']==d['version']

def test_pause_during_inflight_model_reuses_paid_checkpoint_on_resume(factory):
    holder={};ps=ResearchProviders()
    async def fn(p,system,obj,index):
        if index==1:
            store=holder['actor'].client.app.state.store
            with store.transaction() as db:db.execute("UPDATE adaptive_controls SET status='pause_requested',version=version+1 WHERE run_id=?",(holder['run']['id'],))
        return {'output':{'claims':[],'missing':[]},'usage':{'total_tokens':17}}
    ps.handler=fn;a=Actor(factory(ps));holder['actor']=a;holder['run']=dispatch(a,preview(a,use_llm=True,provider='alpha',max_calls=2))
    first=a.execute(holder['run']);assert first['state']=='interrupted'
    rt=runtime(a,first);assert rt['state']=='paused' and len(ps.calls)==1
    assert a.post('/workspace/runs/'+first['id']+'/control',json={'version':rt['control']['version'],'action':'resume'}).status_code==200
    last=a.execute(first);assert last['result'] and len(ps.calls)==2
    assert 'analyst' in last['result']['adaptive']['reflection']['restored_nodes']

def test_unknown_inflight_checkpoint_after_crash_is_not_rebilled(factory):
    ps=ResearchProviders();a=Actor(factory(ps));r=dispatch(a,preview(a,use_llm=True,provider='alpha',max_calls=1));store=a.client.app.state.store;w=a.client.app.state.worker
    with store.transaction() as db:db.execute("UPDATE runs SET state='running' WHERE id=?",(r['id'],))
    async def prime():
        runner=AdaptiveRun(w,r['id'])
        for cap in ['quality','quant','evidence']:
            n=next(n for n in runner.graph['nodes'] if n['id']==cap);await runner.execute_node(n)
        # Simulate a persisted send whose remote result was lost at process death.
        n=next(n for n in runner.graph['nodes'] if n['id']=='analyst');b=runner.graph['provider_bindings']['analyst']
        with store.transaction() as db:db.execute('INSERT INTO adaptive_checkpoints VALUES(?,?,?,?,?,NULL,?,NULL)',(r['id'],'analyst','analyst','running',digest({'snapshot':digest(runner.s),'node':n}),now()))
        call,err=runner.reserve_call(n,b,'{"test":"fixture dispatch"}',{'memory_ids':[],'citation_ids':[]});assert call and not err
        with store.transaction() as db:db.execute("UPDATE runs SET state='interrupted' WHERE id=?",(r['id'],))
    a.client.portal.call(prime)
    rt=runtime(a,r);assert a.post('/workspace/runs/'+r['id']+'/control',json={'version':rt['control']['version'],'action':'resume'}).status_code==200
    final=a.execute(r);assert final['result'],final
    assert not ps.calls and runtime(a,r)['calls'][0]['state']=='unknown'
    assert final['state']=='degraded'

def test_tampered_checkpoint_fails_closed(factory):
    ps=ResearchProviders();a=Actor(factory(ps));holder={}
    async def fn(*args):
        with a.client.app.state.store.transaction() as db:db.execute("UPDATE adaptive_controls SET status='pause_requested' WHERE run_id=?",(holder['r']['id'],))
        return {'output':{'claims':[],'missing':[]},'usage':{}}
    ps.handler=fn;holder['r']=dispatch(a,preview(a,use_llm=True,provider='alpha',max_calls=2));r=a.execute(holder['r']);assert r['state']=='interrupted'
    with a.client.app.state.store.transaction() as db:db.execute("UPDATE agent_artifacts SET payload='{}' WHERE run_id=? AND node='quant'",(r['id'],))
    rt=runtime(a,r);a.post('/workspace/runs/'+r['id']+'/control',json={'version':rt['control']['version'],'action':'resume'})
    result=a.execute(r);assert result['state']=='failed' and not result['result'] and len(ps.calls)==1

@pytest.mark.parametrize('text,metric,citation',[('利润率100%','gross_margin',''),('利润率１００％','gross_margin',''),('<img src=x>','gross_margin',''),('财务健康','missing',''),('公开资料显示','', 'unknown')])
def test_reference_and_format_gate(text,metric,citation):
    out=check_claims([{'text':text,'metric_ids':[metric] if metric else [],'citation_ids':[citation] if citation else []}],{'gross_margin':.2},[])
    assert out['rejected_claims']==1 and not out['claims']

@pytest.mark.parametrize('order',[ 'parallel','evidence_first','analysis_first'])
def test_model_can_choose_real_specialist_dependencies_inside_consent(factory,order):
    ps=ResearchProviders(proposal={'focus':['evidence'],'specialists':['analyst','researcher','challenger'],'rationale':'按照资料与量化结果配置分工','execution_order':order})
    a=Actor(factory(ps));d=a.dataset()
    e=a.post('/evidence',json={'global_scope':True,'title':'明确合成的资料','text':'合成验收资料；企业经营变化及现金情况需要原始证据核验，不能当作真实财报。'*12}).json()
    r=completed(a,dataset=d,use_llm=True,provider='alpha',max_calls=5,execution={'model_planning':True})
    assert r['result'],r
    rt=runtime(a,r);nodes={n['id']:n for n in rt['graph']['payload']['nodes']};assert 'researcher' in nodes
    if order=='evidence_first':assert 'researcher' in nodes['analyst']['depends_on']
    if order=='analysis_first':assert 'analyst' in nodes['researcher']['depends_on']
    if order=='parallel':assert ps.peak>=2
    assert rt['usage']['attempts']==4
    for c in rt['calls']:assert c['payload']['request_hash']


def test_model_suggested_forecast_uses_same_snapshot_without_new_permission(factory):
    ps=ResearchProviders(proposal={'focus':['forecast'],'specialists':['analyst'],'rationale':'核验历史序列能否建立预测基线'})
    a=Actor(factory(ps));r=completed(a,dataset=short_dataset(a),use_llm=True,provider='alpha',max_calls=4,execution={'model_planning':True})
    assert r['result'],r
    rt=runtime(a,r);g=rt['graph']['payload'];assert 'forecast' in {n['id'] for n in g['nodes']}
    assert 'forecast' in next(n for n in g['nodes'] if n['id']=='analyst')['depends_on']
    assert all(c['context'].get('approved_tool_results',{}).get('forecast',{}).get('status')=='blocked' for c in ps.calls if not c.get('planner'))
    assert r['result']['adaptive']['mathematical_outputs']['forecast']['status']=='blocked'


def test_local_recovery_optout_does_not_append_model_requested_tools(factory):
    ps=ResearchProviders();a=Actor(factory(ps));r=completed(a,use_llm=True,provider='alpha',max_calls=4,execution={'model_planning':True,'local_recovery':False})
    assert r['result'],r
    assert 'counterevidence' not in {n['id'] for n in runtime(a,r)['graph']['payload']['nodes']}


def test_resume_respects_configured_queue_not_hardcoded_default(factory):
    a=Actor(factory(max_queued_per_user=1));r=dispatch(a,preview(a))
    rt=runtime(a,r);a.post('/workspace/runs/'+r['id']+'/control',json={'version':rt['control']['version'],'action':'pause'})
    dispatch(a,preview(a));rt=runtime(a,r)
    assert a.post('/workspace/runs/'+r['id']+'/control',json={'version':rt['control']['version'],'action':'resume'}).status_code==429


def test_nonfinite_metric_cannot_be_used_as_model_evidence():
    for v in [float('nan'),float('inf'),True,None]:
        assert not check_claims([{'text':'毛利率需要核对','metric_ids':['gross_margin']}],{'gross_margin':v},[])['claims']


def test_explicit_balanced_depth_is_not_replaced_by_policy(actor):
    from server.autonomy import compile_graph
    payload=preview(actor,execution={'depth':'balanced','local_recovery':False})['payload']
    graph=compile_graph(payload,policy={'depth':'deep','require_counterevidence':False,'require_gap_analysis':False})
    assert graph['depth']=='balanced'
    assert not {'gaps','counterevidence'} & {n['id'] for n in graph['nodes']}
    payload['request']['execution']['depth']=None
    assert compile_graph(payload,policy={'depth':'deep'})['depth']=='deep'


def test_finished_checkpoint_cannot_be_overwritten_or_reexecuted(actor):
    row=dispatch(actor,preview(actor));store=actor.client.app.state.store
    with store.transaction() as db:db.execute("UPDATE runs SET state='running' WHERE id=?",(row['id'],))
    async def check():
        runner=AdaptiveRun(actor.client.app.state.worker,row['id'])
        n=next(n for n in runner.graph['nodes'] if n['id']=='quality')
        await runner.execute_node(n)
        before=store.one('SELECT * FROM adaptive_checkpoints WHERE run_id=? AND node_id=?',(row['id'],'quality'))
        with pytest.raises(RuntimeError,match='CHECKPOINT_IMMUTABLE'):runner.record(n,{'status':'completed','forged':True},'succeeded')
        with pytest.raises(RuntimeError,match='CHECKPOINT_IMMUTABLE'):await runner.execute_node(n)
        assert store.one('SELECT * FROM adaptive_checkpoints WHERE run_id=? AND node_id=?',(row['id'],'quality'))==before
        assert len(store.all('SELECT * FROM agent_artifacts WHERE run_id=?',(row['id'],)))==1
    actor.client.portal.call(check)


@pytest.mark.parametrize('tamper',['event_chain','graph','envelope','snapshot','dispatch_ledger'])
def test_recovery_fails_closed_on_tampered_approval_and_anchors(factory,tamper):
    ps=ResearchProviders();a=Actor(factory(ps));holder={}
    async def pause(*args):
        with a.client.app.state.store.transaction() as db:db.execute("UPDATE adaptive_controls SET status='pause_requested' WHERE run_id=?",(holder['row']['id'],))
        return {'output':{'claims':[],'missing':[]},'usage':{}}
    ps.handler=pause;holder['row']=dispatch(a,preview(a,use_llm=True,provider='alpha',max_calls=2))
    row=a.execute(holder['row']);assert row['state']=='interrupted' and len(ps.calls)==1
    store=a.client.app.state.store
    with store.transaction() as db:
        if tamper=='event_chain':
            db.execute("UPDATE run_events SET created_at='2000-01-01T00:00:00+00:00' WHERE run_id=? AND type='step_started'",(row['id'],))
        elif tamper in ('graph','envelope'):
            graph=store.one('SELECT payload FROM adaptive_graphs WHERE run_id=?',(row['id'],))['payload']
            if tamper=='graph':graph['nodes'][0]['reason']='unanchored change'
            else:graph['envelope']['max_calls']=8
            db.execute('UPDATE adaptive_graphs SET payload=? WHERE run_id=?',(encode(graph),row['id']))
        elif tamper=='snapshot':
            snapshot=row['snapshot'];snapshot['studio']['context']['question']='未经批准的新问题'
            db.execute('UPDATE runs SET snapshot=? WHERE id=?',(encode(snapshot),row['id']))
        else:
            db.execute('UPDATE adaptive_calls SET characters=characters+1 WHERE run_id=?',(row['id'],))
    rt=runtime(a,row);assert a.post('/workspace/runs/'+row['id']+'/control',json={'version':rt['control']['version'],'action':'resume'}).status_code==200
    result=a.execute(row)
    assert result['state']=='failed' and result['result'] is None and len(ps.calls)==1


def test_crash_before_dispatch_rechecks_consent_then_executes_once(factory):
    ps=ResearchProviders();a=Actor(factory(ps));row=dispatch(a,preview(a,use_llm=True,provider='alpha',max_calls=1))
    store=a.client.app.state.store
    with store.transaction() as db:db.execute("UPDATE runs SET state='running' WHERE id=?",(row['id'],))
    runner=AdaptiveRun(a.client.app.state.worker,row['id']);n=next(n for n in runner.graph['nodes'] if n['id']=='analyst')
    with store.transaction() as db:
        db.execute('INSERT INTO adaptive_checkpoints VALUES(?,?,?,?,?,NULL,?,NULL)',(row['id'],'analyst','analyst','running',digest({'snapshot':digest(runner.s),'node':n}),now()))
        db.execute("UPDATE runs SET state='interrupted' WHERE id=?",(row['id'],))
    rt=runtime(a,row);a.post('/workspace/runs/'+row['id']+'/control',json={'version':rt['control']['version'],'action':'resume'})
    final=a.execute(row)
    assert final['result'] and len(ps.calls)==1
    assert not any(c['state']=='unknown' for c in runtime(a,row)['calls'])


def test_duplicate_model_dispatch_reservation_is_refused(factory):
    ps=ResearchProviders();a=Actor(factory(ps));row=dispatch(a,preview(a,use_llm=True,provider='alpha',max_calls=3))
    store=a.client.app.state.store
    with store.transaction() as db:db.execute("UPDATE runs SET state='running' WHERE id=?",(row['id'],))
    runner=AdaptiveRun(a.client.app.state.worker,row['id']);n=next(n for n in runner.graph['nodes'] if n['id']=='analyst');b=runner.graph['provider_bindings']['analyst']
    first,error=runner.reserve_call(n,b,'{}',{'memory_ids':[],'citation_ids':[]})
    second,error=runner.reserve_call(n,b,'{}',{'memory_ids':[],'citation_ids':[]})
    assert first and second is None and error=='NODE_ALREADY_DISPATCHED'
    assert runtime(a,row)['usage']['attempts']==1 and not ps.calls


def test_orphaned_dispatch_reservation_is_not_reissued(factory):
    ps=ResearchProviders();a=Actor(factory(ps));row=dispatch(a,preview(a,use_llm=True,provider='alpha',max_calls=1));store=a.client.app.state.store
    with store.transaction() as db:db.execute("UPDATE runs SET state='running' WHERE id=?",(row['id'],))
    runner=AdaptiveRun(a.client.app.state.worker,row['id']);n=next(n for n in runner.graph['nodes'] if n['id']=='analyst')
    call,error=runner.reserve_call(n,runner.graph['provider_bindings']['analyst'],'{}',{'memory_ids':[],'citation_ids':[]})
    assert call and error is None
    with store.transaction() as db:db.execute("UPDATE runs SET state='interrupted' WHERE id=?",(row['id'],))
    rt=runtime(a,row);a.post('/workspace/runs/'+row['id']+'/control',json={'version':rt['control']['version'],'action':'resume'})
    final=a.execute(row)
    assert final['result'] and final['state']=='degraded' and not ps.calls
    assert runtime(a,row)['calls'][0]['state']=='unknown'


def test_tampered_plan_content_does_not_match_unchanged_fingerprint(factory):
    ps=ResearchProviders();a=Actor(factory(ps));plan=preview(a,use_llm=True,provider='alpha')
    payload=copy.deepcopy(plan['payload']);payload['context']['question']='different unapproved question'
    with a.client.app.state.store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(payload),plan['id']))
    response=a.post('/workspace/plans/'+plan['id']+'/execute',json={'version':plan['version'],'fingerprint':plan['payload']['fingerprint'],'external_consent':True})
    assert response.status_code==409 and response.json()['error']['code']=='PLAN_INTEGRITY' and not ps.calls


def test_acknowledged_throttle_with_bounded_code_can_use_approved_fallback(factory):
    async def limited(p,*args):
        if p.id=='alpha':raise ValueError('MODEL_HTTP_429_1113')
        return {'output':{'claims':[],'missing':[]},'usage':{}}
    ps=ResearchProviders(limited);a=Actor(factory(ps));row=completed(a,use_llm=True,provider='alpha',max_calls=4,execution={'fallback_providers':['beta']})
    assert row['result'] and any(call['provider']=='beta' for call in ps.calls)
    assert runtime(a,row)['usage']['attempts']<=4


@pytest.mark.parametrize('mutation',['remove','disable','alias'])
def test_mandatory_capabilities_cannot_be_removed_or_disabled(actor,mutation):
    nodes=copy.deepcopy(preview(actor)['payload']['nodes'])
    target=next(n for n in nodes if n['id']=='quality')
    if mutation=='remove':nodes.remove(target)
    elif mutation=='disable':target['enabled']=False
    else:target['capability']='gaps'
    with pytest.raises(ValueError):validate_graph(nodes,require_mandatory=True)
