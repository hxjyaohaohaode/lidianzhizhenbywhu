"""Local pure/in-process oracles; these do not claim native browser execution."""
from copy import deepcopy
import csv
import io
from types import SimpleNamespace
import pytest

from scripts import product_strategy_success as journey
from scripts.product_first_use_audit import HEADERS
from scripts.product_browser_audit import Probe


def test_new_native_chain_stops_locally_before_browser_request_or_registration(monkeypatch, tmp_path):
    monkeypatch.delenv('GITHUB_ACTIONS', raising=False)
    with pytest.raises(RuntimeError):
        journey.strategy_success_journey(SimpleNamespace(), repository_root=tmp_path, data_dir=tmp_path,
            expected_web_tree='a'*40, expected_server_tree='b'*40)


def test_three_csv_inputs_are_numeric_distinct_and_keep_missing_values_missing():
    template = (','.join(HEADERS) + '\n').encode('utf-8-sig')
    for i in range(3):
        rows = list(csv.DictReader(io.StringIO(journey.fixture_csv(template, i).decode('utf-8-sig'))))
        assert [r['季度'] for r in rows] == ['2024-Q1', '2024-Q2']
        assert all(r['营业收入'] == str(journey.REVENUES[i]) and r['营业成本'] == '80000' for r in rows)
        assert all(r[k] == '' for r in rows for k in HEADERS if k not in
                   ('季度', '营业收入', '营业成本', '净利润', '经营现金流'))
    for bad in (-1, 3, True, 1.0):
        with pytest.raises(AssertionError): journey.fixture_csv(template, bad)
    with pytest.raises(AssertionError): journey.fixture_csv(template + b'2024-Q1,1,2\n', 0)


@pytest.fixture(scope='module')
def real_cohort(tmp_path_factory):
    from in_process_oracle import offline_test_client
    from server.app import make_app
    from server.config import Settings
    from conftest import Actor
    temp = tmp_path_factory.mktemp('strategy-success-offline')
    def build_app(providers):
        return make_app(Settings(data_dir=temp, origin='http://testserver'), providers=providers, worker_enabled=False)
    with offline_test_client(build_app) as (client, providers, attempts):
        actor = Actor(client)
        def ok(response, code=200):
            assert response.status_code == code, response.text
            return response.json()
        document = ok(actor.post('/evidence', json={'title': journey.EVIDENCE_TITLE, 'text': journey.EVIDENCE_TEXT,
            'company': journey.COMPANY, 'global_scope': False}), 201)
        ok(actor.put('/workspace/evidence/'+document['id']+'/review', json={'version': 1, 'company': journey.COMPANY,
            'global_scope': False, 'status': 'accepted', 'stance': 'contradicts', 'note': journey.REVIEW_NOTE}))
        datasets, plans, runs = [], [], []
        def preview(dataset):
            return ok(actor.post('/workspace/plans', json={'dataset_id': dataset['id'], 'query': journey.QUESTION,
                'use_llm': False, 'execution': {'depth': None, 'local_recovery': False}}), 201)
        template = actor.get('/import/template').content
        for i in range(3):
            stage = ok(actor.post('/workspace/imports/file', data={'company': journey.COMPANY, 'amount_unit': 'yuan',
                'basis': 'standalone_quarter', 'target_id': '', 'target_version': '0', 'merge_mode': 'replace'},
                files={'file': (f'strategy-success-input-{i+1}.csv', journey.fixture_csv(template,i), 'text/csv')}),201)
            dataset = ok(actor.post('/workspace/imports/'+stage['id']+'/commit', json={'version': stage['version'],
                'fingerprint': stage['payload']['fingerprint']}),201)
            journey.expect_dataset(dataset,i)
            plan = preview(dataset)
            journey.expect_plan(plan,dataset,version=0,counterevidence=False)
            run = actor.execute(ok(actor.post('/workspace/plans/'+plan['id']+'/execute',json={'version':plan['version'],
                'fingerprint':plan['payload']['fingerprint'],'external_consent':False}),202))
            journey.expect_report(run,dataset,i)
            ok(actor.post('/workspace/runs/'+run['id']+'/assessment',json={'version':0,'verdict':'needs_revision',
                'note':journey.ASSESSMENT_NOTE,'expected_capabilities':journey.CAPABILITIES,'consent_replay':True}))
            datasets.append(dataset); plans.append(ok(actor.get('/workspace/plans/'+plan['id']))); runs.append(run)
        stale = preview(datasets[-1])
        proposal = ok(actor.post('/workspace/evolution/propose',json={}),201)
        assert proposal['automatic_activation'] is False and proposal['external_calls']==0
        yield SimpleNamespace(actor=actor,ok=ok,preview=preview,datasets=datasets,plans=plans,runs=runs,
            stale=stale,candidate=proposal['candidate'],evaluation=proposal['evaluation'])
        assert providers.calls==[] and attempts==[]


def test_real_three_csv_cohort_replays_activates_blocks_old_plan_then_rolls_back(real_cohort):
    c=real_cohort; a=c.actor; ok=c.ok
    assert len(journey.expect_evaluation(c.evaluation,c.candidate,c.runs))==3
    active=ok(a.post('/workspace/strategies/'+c.candidate['id']+'/activate',json={
        'evaluation_id':c.evaluation['id'],'expected_active_version':0}))
    assert active['version']==1
    denied=a.post('/workspace/plans/'+c.stale['id']+'/execute',json={'version':c.stale['version'],
        'fingerprint':c.stale['payload']['fingerprint'],'external_consent':False})
    assert denied.status_code==409 and denied.json()['error']['code']=='PLAN_STALE'
    assert ok(a.get('/workspace/plans/'+c.stale['id']))==c.stale
    journey.expect_plan(c.preview(c.datasets[-1]),c.datasets[-1],version=1,counterevidence=True)
    rolled=ok(a.post('/workspace/strategies/rollback',json={'expected_active_version':1}))
    assert rolled['version']==2 and rolled['payload']['spec'] is None
    journey.expect_plan(c.preview(c.datasets[-1]),c.datasets[-1],version=2,counterevidence=False)
    for i,run in enumerate(c.runs):
        current=ok(a.get('/runs/'+run['id']))
        assert current['result']==run['result'] and current['snapshot']==run['snapshot']
        assert ok(a.get('/workspace/plans/'+c.plans[i]['id']))==c.plans[i]
    assert len(ok(a.get('/runs'))['items'])==3


@pytest.mark.parametrize('damage',['ineligible','duplicate_inputs','missing_holdout','fake_improvement','regression',
    'wrong_candidate','wrong_source','missing_counterevidence','false_evidence_count','changed_math','provider_calls',
    'planned_only','extra_case','fake_reference','candidate_missing'])
def test_success_oracle_rejects_false_or_incomplete_gates(real_cohort,damage):
    c=real_cohort; e=deepcopy(c.evaluation); p=e['payload']; case=p['cases'][0]
    if damage=='ineligible':p['eligible']=False
    elif damage=='duplicate_inputs':p['unique_inputs']=1
    elif damage=='missing_holdout':
        for item in p['cases']:item['partition']='development'
    elif damage=='fake_improvement':p['improvements']=[]
    elif damage=='regression':p['regressions']=['regression']
    elif damage=='wrong_candidate':p['candidate_id']='another'
    elif damage=='wrong_source':case['source']['dataset_hash']='0'*64
    elif damage=='missing_counterevidence':case['candidate']['covered']=['quality','quant']
    elif damage=='false_evidence_count':case['candidate']['computations']['counterevidence']['group_counts']['contradicts']=0
    elif damage=='changed_math':case['candidate']['math_hash']='0'*64
    elif damage=='provider_calls':case['candidate']['external_calls']=1
    elif damage=='planned_only':case['candidate']['computations']['counterevidence']['status']='missing'
    elif damage=='extra_case':p['cases'].append(deepcopy(case))
    elif damage=='fake_reference':case['reference_math_hash']='0'*64
    elif damage=='candidate_missing':case['candidate']['missing']=['counterevidence']
    with pytest.raises(AssertionError):journey.expect_evaluation(e,c.candidate,c.runs)


class Dialog:
    type='confirm'
    def __init__(self,message):self.message=message;self.accepts=0;self.dismisses=0
    def accept(self):self.accepts+=1
    def dismiss(self):self.dismisses+=1


def fake_probe(tmp_path, *, active=False):
    p=Probe(SimpleNamespace(), 'http://127.0.0.1:8000',tmp_path,lambda *_:None)
    p.observations['native_created_strategy_success']={'synthetic':True,'created_through_visible_controls':True,
        'candidate_id':'candidate-1','evaluation_id':'evaluation-1'}
    state={'active':{'version':1,'payload':{'candidate_id':'candidate-1','evaluation_id':'evaluation-1'}} if active else None,
        'evaluations':[{'id':'evaluation-1','payload':{'candidate_id':'candidate-1','eligible':True,'active_version':0}}]}
    p.get=lambda _:state
    p.visible=lambda _:SimpleNamespace(is_enabled=lambda:True)
    return p,state


@pytest.mark.parametrize('operation',['activate','rollback'])
@pytest.mark.parametrize('accept',[True,False])
def test_bound_native_confirmation_accepts_or_cancels_exactly_once(tmp_path,operation,accept):
    p,_=fake_probe(tmp_path,active=operation=='rollback')
    message=('仅对未来计划激活该策略？既有报告保持不变，未执行旧计划需要重新生成。' if operation=='activate'
             else '回滚到上一策略？旧报告不变，未执行计划需要重新核对。')
    d=Dialog(message)
    p.with_strategy_decision(operation=operation,accept=accept,action=lambda:p.handle_expected_dialog(d))
    assert (d.accepts,d.dismisses)==(int(accept),int(not accept))
    assert p._expected_dialog is None
    with pytest.raises(ValueError,match='replayed'):
        p.with_strategy_decision(operation=operation,accept=accept,action=lambda:p.handle_expected_dialog(d))


@pytest.mark.parametrize('damage',['missing_fixture','not_synthetic','not_native','wrong_target','ineligible',
    'active_baseline','disabled','nested','wrong_message','two_dialogs','no_dialog','wrong_type'])
def test_strategy_confirmation_never_broadens_generic_dialog_permission(tmp_path,damage):
    p,state=fake_probe(tmp_path)
    if damage=='missing_fixture':p.observations.clear()
    elif damage=='not_synthetic':p.observations['native_created_strategy_success']['synthetic']=False
    elif damage=='not_native':p.observations['native_created_strategy_success']['created_through_visible_controls']=False
    elif damage=='wrong_target':state['evaluations'][0]['payload']['candidate_id']='other'
    elif damage=='ineligible':state['evaluations'][0]['payload']['eligible']=False
    elif damage=='active_baseline':state['active']={'version':1}
    elif damage=='disabled':p.visible=lambda _:SimpleNamespace(is_enabled=lambda:False)
    elif damage=='nested':p._expected_dialog={}
    d=Dialog('wrong' if damage=='wrong_message' else '仅对未来计划激活该策略？既有报告保持不变，未执行旧计划需要重新生成。')
    if damage=='wrong_type':d.type='alert'
    def action():
        if damage=='no_dialog':return
        p.handle_expected_dialog(d)
        if damage=='two_dialogs':p.handle_expected_dialog(d)
    with pytest.raises((ValueError,RuntimeError,AssertionError)):
        p.with_strategy_decision(operation='activate',accept=True,action=action)
    if damage not in ('two_dialogs',): assert d.accepts==d.dismisses==0
    with pytest.raises(ValueError):
        p.with_expected_dialog(dialog_type='confirm',message=d.message,action=lambda:None)


def readable_reverse():
    return {'baseline':'未计划\n未记录实际执行\n未满足',
        'candidate':'已计划\n已执行 · 完成\n满足已标注要求',
        'baseline_evidence':'支持资料：未记录\n反向资料：未记录\n背景资料：未记录',
        'candidate_evidence':'支持资料：0 条\n反向资料：1 条\n背景资料：0 条'}


def test_readable_native_columns_keep_baseline_and_candidate_separate():
    journey.expect_readable_reverse(**readable_reverse())


@pytest.mark.parametrize('damage',['swapped_capability','swapped_evidence','only_planned','false_completed',
    'missing_counterevidence','baseline_invented_counts'])
def test_readable_native_columns_reject_swapping_or_false_completion(damage):
    row=readable_reverse()
    if damage=='swapped_capability':row['baseline'],row['candidate']=row['candidate'],row['baseline']
    elif damage=='swapped_evidence':row['baseline_evidence'],row['candidate_evidence']=row['candidate_evidence'],row['baseline_evidence']
    elif damage=='only_planned':row['candidate']='已计划'
    elif damage=='false_completed':row['baseline']+='\n已执行 · 完成'
    elif damage=='missing_counterevidence':row['candidate_evidence']=row['candidate_evidence'].replace('反向资料：1','反向资料：0')
    elif damage=='baseline_invented_counts':row['baseline_evidence']=row['baseline_evidence'].replace('未记录','0 条')
    with pytest.raises(AssertionError):journey.expect_readable_reverse(**row)
