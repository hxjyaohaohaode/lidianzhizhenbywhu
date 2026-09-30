import copy
import pytest
from conftest import Actor
from test_adaptive import completed, preview, dispatch
from server.store import encode, digest
from server.evolution import input_signature


def assessment(a,run,**kw):
    data={'verdict':'needs_revision','note':'需要明确增加反向证据核查并给出依据','expected_capabilities':['quality','quant','counterevidence'],'consent_replay':True,**kw}
    res=a.post('/workspace/runs/'+run['id']+'/assessment',json=data);assert res.status_code==200,res.text;return res.json()


def candidate(a,**kw):
    res=a.post('/workspace/strategies',json={'name':'反证覆盖策略','depth':'balanced','require_counterevidence':True,'note':'提升人工标注的反证能力覆盖，不修改公式或历史输出',**kw});assert res.status_code==201,res.text;return res.json()


def three_cases(a,example):
    runs=[]
    source=a.post('/evidence',json={'title':'合成验收证据','text':'核验企业经营变化及现金情况；合成验收数据仅供测试，核查支持资料和反向资料。'*15})
    assert source.status_code==201,source.text
    for i in range(3):
        d=copy.deepcopy(example);d['name']='验收合成输入'+str(i);d['periods'][-1]['revenue']+=i*1e6
        res=a.post('/datasets',json=d);assert res.status_code==201,res.text
        r=completed(a,dataset=res.json());assessment(a,r);runs.append(r)
    return runs


def test_cannot_self_score_empty_cases_or_missing_rubric(actor):
    r=completed(actor)
    assert actor.post('/workspace/runs/'+r['id']+'/assessment',json={'verdict':'useful','note':'有价值的验收依据','consent_replay':True}).status_code==422
    c=candidate(actor);e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()
    assert not e['payload']['eligible'] and e['payload']['unique_inputs']==0
    assert actor.post('/workspace/strategies/'+c['id']+'/activate',json={'evaluation_id':e['id'],'expected_active_version':0}).status_code==409
    assert actor.post('/workspace/evolution/propose',json={}).status_code==409


def test_local_replay_activation_and_rollback_actual_future_plans(actor,example):
    runs=three_cases(actor,example);old_plan=preview(actor);c=candidate(actor)
    e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={});assert e.status_code==201,e.text
    e=e.json();p=e['payload'];assert p['eligible'],p
    assert p['unique_inputs']==3 and len(p['improvements'])==3 and not p['regressions']
    assert {v['partition'] for v in p['cases']}=={'development','holdout'}
    assert all(v['baseline']['math_hash']==v['candidate']['math_hash'] for v in p['cases'])
    active=actor.post('/workspace/strategies/'+c['id']+'/activate',json={'evaluation_id':e['id'],'expected_active_version':0});assert active.status_code==200,active.text
    assert actor.post('/workspace/plans/'+old_plan['id']+'/execute',json={'version':old_plan['version'],'fingerprint':old_plan['payload']['fingerprint'],'external_consent':False}).status_code==409
    new_plan=preview(actor)['payload'];assert new_plan['adaptive']['active_strategy_version']==1
    assert any(n['id']=='counterevidence' for n in new_plan['nodes'])
    for r in runs:assert actor.get('/runs/'+r['id']).json()['result']==r['result']
    assert actor.post('/workspace/strategies/rollback',json={'expected_active_version':0}).status_code==422
    rollback=actor.post('/workspace/strategies/rollback',json={'expected_active_version':active.json()['version']});assert rollback.status_code==200
    assert preview(actor)['payload']['adaptive']['strategy_basis']=='built_in_rules'
    assert actor.post('/workspace/strategies/rollback',json={'expected_active_version':rollback.json()['version']}).status_code==409


def test_revoke_case_blocks_stale_candidate_activation(actor,example):
    runs=three_cases(actor,example);c=candidate(actor);e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()
    saved=actor.get('/workspace/runs/'+runs[0]['id']+'/assessment').json()['item']
    assessment(actor,runs[0],version=saved['version'],consent_replay=False)
    res=actor.post('/workspace/strategies/'+c['id']+'/activate',json={'evaluation_id':e['id'],'expected_active_version':0})
    assert res.status_code==409,res.text
    newer=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json();assert not newer['payload']['eligible'] and newer['payload']['unique_inputs']==2


def test_duplicate_runs_or_renamed_financial_inputs_do_not_inflate_holdout(actor,example):
    for i in range(3):
        d=copy.deepcopy(example);d['name']='不同文件名'+str(i);d['company']='不同标签'+str(i)
        r=completed(actor,dataset=actor.post('/datasets',json=d).json());assessment(actor,r)
    c=candidate(actor);e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()
    assert e['payload']['raw_consented_runs']==3 and e['payload']['unique_inputs']==1 and not e['payload']['eligible']


def test_candidate_regression_cannot_activate(actor,example):
    three_cases(actor,example);c=candidate(actor,require_counterevidence=False,depth='concise')
    e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()
    assert not e['payload']['eligible'] and not e['payload']['improvements']


def test_human_assessment_version_and_permissions(client,actor):
    r=completed(actor);b=Actor(client);first=assessment(actor,r)
    assert actor.post('/workspace/runs/'+r['id']+'/assessment',json={'version':0,'verdict':'useful','note':'与并发版本冲突的反馈'}).status_code==409
    assert b.get('/workspace/runs/'+r['id']+'/assessment').status_code==404
    assert b.post('/workspace/runs/'+r['id']+'/assessment',json={'verdict':'useful','note':'越权写入应当被拒绝'}).status_code==404
    c=candidate(actor);assert b.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).status_code==404
    assert b.get('/workspace/evolution').json()['candidates']==[]


def test_automatic_candidate_uses_observed_human_gaps_and_requires_activation(actor,example):
    three_cases(actor,example)
    res=actor.post('/workspace/evolution/propose',json={});assert res.status_code==201,res.text
    data=res.json();assert data['candidate']['payload']['require_counterevidence']
    assert data['sources'] and data['evaluation']['payload']['eligible']
    assert data['automatic_activation'] is False and data['external_calls']==0
    assert actor.get('/workspace/evolution').json()['active'] is None


def test_unsatisfied_forecast_rubric_is_not_counted_as_implemented_success(actor):
    r=completed(actor,query='做收入预测并说明适用边界');assessment(actor,r,expected_capabilities=['forecast'])
    c=candidate(actor);res=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={});assert res.status_code==201,res.text
    case=res.json()['payload']['cases'][0]
    assert case['candidate']['missing']==['forecast'] and case['candidate']['recall']==0
    assert actor.post('/workspace/evolution/propose',json={}).status_code==409


def test_deleted_run_removes_replay_eligibility(actor,example):
    runs=three_cases(actor,example)
    session=next(row for row in actor.get('/conversations').json()['items'] if row['id']==runs[0]['session_id'])
    assert actor.delete('/conversations/'+session['id']+'?version='+str(session['version'])).status_code==200
    assert actor.get('/workspace/evolution').json()['observations']['consented_cases']==2


def test_replay_does_not_change_explicit_research_depth_to_improve_its_score(actor):
    from server.evolution import replay
    r=completed(actor,execution={'depth':'concise','local_recovery':False})
    # Candidate deep defaults must not override an explicit concise request, just as production.
    out=replay(r,['gaps'],{'depth':'deep','require_counterevidence':False,'require_gap_analysis':False})
    assert out['missing']==['gaps'] and 'gaps' not in out['capabilities']


def test_new_consented_case_invalidates_evaluation_cohort_before_activation(actor,example):
    three_cases(actor,example);c=candidate(actor);e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()
    d=copy.deepcopy(example);d['periods'][-1]['revenue']+=777777
    r=completed(actor,dataset=actor.post('/datasets',json=d).json());assessment(actor,r,expected_capabilities=['forecast'])
    result=actor.post('/workspace/strategies/'+c['id']+'/activate',json={'evaluation_id':e['id'],'expected_active_version':0})
    assert result.status_code==409 and result.json()['error']['code']=='EVALUATION_STALE'


@pytest.mark.parametrize('state',['running','queued','interrupted','cancelled','failed'])
def test_only_completed_reports_can_enter_human_replay(actor,state):
    row=completed(actor);store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE runs SET state=? WHERE id=?',(state,row['id']))
    response=actor.post('/workspace/runs/'+row['id']+'/assessment',json={'verdict':'useful','note':'尚未完成的记录不可参与回放','expected_capabilities':['quant'],'consent_replay':True})
    assert response.status_code==409 and response.json()['error']['code']=='NO_REPORT'


def test_consent_case_becoming_nonterminal_invalidates_activation(actor,example):
    runs=three_cases(actor,example);c=candidate(actor);e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()
    with actor.client.app.state.store.transaction() as db:db.execute("UPDATE runs SET state='interrupted' WHERE id=?",(runs[0]['id'],))
    response=actor.post('/workspace/strategies/'+c['id']+'/activate',json={'evaluation_id':e['id'],'expected_active_version':0})
    assert response.status_code==409 and response.json()['error']['code']=='EVALUATION_STALE'


def test_declared_empty_evidence_capability_is_not_replay_success(actor):
    row=completed(actor);assessment(actor,row,expected_capabilities=['evidence','counterevidence'])
    c=candidate(actor);e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()['payload']
    replay=e['cases'][0]['candidate']
    assert set(replay['missing'])=={'evidence','counterevidence'} and replay['recall']==0
    assert replay['computations']['counterevidence']['status']=='missing'
    assert replay['computations']['counterevidence']['output_hash']
    assert not e['eligible'] and not e['improvements']


def test_replay_executes_same_local_operations_and_preserves_assumptions(actor):
    from server.evolution import replay
    row=completed(actor,execution={'depth':'balanced','scenario':{'price_change':.1,'cost_change':.05,'volume_change':-.1,'fixed_cost_share':.2,'note':'明确用于合成测试的压力假设'}})
    out=replay(row,['quant','sensitivity'],{'depth':'deep','require_counterevidence':False,'require_gap_analysis':False})
    assert out['covered']==['quant','sensitivity'] and 'gaps' not in out['planned_capabilities']
    assert out['computations']['quant']['output_hash']==digest(row['result']['analysis'])
    assert out['computations']['sensitivity']['output_hash']==digest(row['result']['adaptive']['mathematical_outputs']['sensitivity'])
    assert out['external_calls']==0


@pytest.mark.parametrize('field,value',[('baseline_hash','wrong'),('replay_version','old-evaluator'),('model_version','wrong')])
def test_stale_baseline_or_replay_engine_blocks_activation(actor,example,field,value):
    three_cases(actor,example);c=candidate(actor);e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()
    payload=e['payload'];payload[field]=value
    with actor.client.app.state.store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(payload),e['id']))
    response=actor.post('/workspace/strategies/'+c['id']+'/activate',json={'evaluation_id':e['id'],'expected_active_version':0})
    assert response.status_code==409 and response.json()['error']['code']=='EVALUATION_STALE'


def test_duplicate_human_rubric_rejected(actor):
    row=completed(actor)
    response=actor.post('/workspace/runs/'+row['id']+'/assessment',json={'verdict':'useful','note':'重复能力不应扩充验收评分','expected_capabilities':['quant','quant'],'consent_replay':True})
    assert response.status_code==422


def test_forged_eligibility_bit_cannot_bypass_current_case_gate(actor):
    c=candidate(actor);e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()
    payload=e['payload'];payload['eligible']=True;payload['blockers']=[]
    with actor.client.app.state.store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(payload),e['id']))
    response=actor.post('/workspace/strategies/'+c['id']+'/activate',json={'evaluation_id':e['id'],'expected_active_version':0})
    assert response.status_code==409 and response.json()['error']['code']=='EVALUATION_BLOCKED'
    assert actor.get('/workspace/evolution').json()['active'] is None


def test_activation_reexecutes_and_compares_actual_replay_artifacts(actor,example):
    three_cases(actor,example);c=candidate(actor);e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()
    payload=e['payload'];payload['cases'][0]['candidate']['computation_hash']='forged'
    with actor.client.app.state.store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(payload),e['id']))
    response=actor.post('/workspace/strategies/'+c['id']+'/activate',json={'evaluation_id':e['id'],'expected_active_version':0})
    assert response.status_code==409 and response.json()['error']['code']=='EVALUATION_STALE'


def test_replay_gates_preserve_archived_mathematical_results(actor,example):
    runs=three_cases(actor,example);store=actor.client.app.state.store;run=runs[0]
    result=copy.deepcopy(run['result']);result['analysis']['metrics']['gross_margin']=.987
    with store.transaction() as db:db.execute('UPDATE runs SET result=? WHERE id=?',(encode(result),run['id']))
    saved=actor.get('/workspace/runs/'+run['id']+'/assessment').json()['item']
    assessment(actor,actor.get('/runs/'+run['id']).json(),version=saved['version'])
    c=candidate(actor);e=actor.post('/workspace/strategies/'+c['id']+'/evaluate',json={}).json()['payload']
    assert run['id'] in e['regressions'] and not e['eligible']


def test_automatic_proposal_never_learns_from_holdout_requirements(actor,example):
    runs=three_cases(actor,example);ordered=sorted(runs,key=input_signature)
    for run in ordered[:-1]:
        saved=actor.get('/workspace/runs/'+run['id']+'/assessment').json()['item']
        assessment(actor,run,version=saved['version'],expected_capabilities=['quality','quant'])
    response=actor.post('/workspace/evolution/propose',json={})
    assert response.status_code==409 and response.json()['error']['code']=='NO_SUPPORTED_IMPROVEMENT'
    assert actor.get('/workspace/evolution').json()['candidates']==[]
