"""Real API outputs for the reader oracle, separate from pending native coverage."""
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import json
import pytest
from scripts import product_report_history_journey as journey
from scripts.product_first_use_audit import HarnessContractError
from in_process_oracle import offline_test_client
from server.app import make_app
from server.config import Settings
from conftest import Actor


def test_native_entry_rejects_local_before_browser_or_service(tmp_path,monkeypatch):
    monkeypatch.delenv('GITHUB_ACTIONS',raising=False)
    with pytest.raises(HarnessContractError,match='Local browser execution is restricted'):
        journey.report_history_journey(SimpleNamespace(),repository_root=tmp_path,data_dir=tmp_path,expected_web_tree='a'*40,expected_server_tree='b'*40)


def test_21_actual_plan_worker_results_pagination_and_frozen_comparison_contract(tmp_path):
    with offline_test_client(lambda providers:make_app(Settings(data_dir=tmp_path,origin='http://testserver'),providers=providers,worker_enabled=False)) as (client,providers,attempts):
        a=Actor(client)
        def ok(r,status=200):assert r.status_code==status,r.text;return r.json()
        data=json.loads((Path(__file__).parent/'fixtures/synthetic-financial.json').read_text())
        data['source_kind']='user_provided'
        template=deepcopy(data['periods'][0])
        data['periods']=[{**template,'period':f'{2022+i//4}-Q{i%4+1}'} for i in range(12)]
        for period in data['periods']:
            period.update(revenue=100000,cost=80000,net_profit=5000,cash_flow=10000)
        d=ok(a.post('/datasets',json=data),201);originals=[]
        for number in range(1,22):
            p=ok(a.post('/workspace/plans',json={'dataset_id':d['id'],'query':journey.query(number),'use_llm':False,'execution':{'depth':'balanced'}}),201)
            assert not p['payload']['blockers'],p['payload']['blockers']
            r=ok(a.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']}),202)
            run=a.execute(r);plan=ok(a.get('/workspace/plans/'+p['id']))
            journey.expect_saved(run,plan,d,number);originals.append({'run':deepcopy(run),'plan':deepcopy(plan)})
        first=ok(a.get('/workspace/reports',params={'identity_id':'','dataset_id':d['id'],'limit':20,'offset':0}))
        last=ok(a.get('/workspace/reports',params={'identity_id':'','dataset_id':d['id'],'limit':20,'offset':20}))
        journey.expect_history(first,originals,0,20);journey.expect_history(last,originals,20,20)
        comparison=ok(a.get('/workspace/reports/compare',params={'left':originals[0]['run']['id'],'right':originals[-1]['run']['id']}))
        margin=next(x for x in comparison['changes'] if x['metric']=='gross_margin')
        assert margin['before']==margin['after']==.2 and margin['delta']==0 and comparison['same_period']
        for original in originals:
            assert ok(a.get('/runs/'+original['run']['id']))==original['run']
            assert ok(a.get('/workspace/plans/'+original['plan']['id']))==original['plan']
        assert providers.calls==attempts==[]
        for damage in ('amount_instead','wrong_period','wrong_source','wrong_plan','external'):
            run=deepcopy(originals[0]['run']);plan=deepcopy(originals[0]['plan'])
            if damage=='amount_instead':run['result']['readout']['facts'][0]['id']='cost'
            elif damage=='wrong_period':run['result']['readout']['facts'][0]['period']='2024-Q3'
            elif damage=='wrong_source':run['result']['dataset_hash']='0'*64
            elif damage=='wrong_plan':plan['payload']['run_id']='another'
            else:run['result']['llm']['calls']=[{'synthetic':'must reject'}]
            with pytest.raises(AssertionError):journey.expect_saved(run,plan,d,1)
        for damage in ('missing','duplicate','wrong_question','wrong_period','false_more'):
            page=deepcopy(last)
            if damage=='missing':page['items']=[]
            elif damage=='duplicate':page['items']*=2
            elif damage=='wrong_question':page['items'][0]['query']='另一问题'
            elif damage=='wrong_period':page['items'][0]['current_period']='2024-Q3'
            else:page['has_more']=True
            with pytest.raises(AssertionError):journey.expect_history(page,originals,20,20)


def test_source_reader_cannot_take_revision_from_question_digits_or_short_id():
    rows=[['研究问题',journey.query(21)],['目标季度',journey.PERIOD],['数据修订','1'],['生成时间','2026/10/05 16:30:00'],['报告标识','complete-synthetic-report-id']]
    journey.expect_selection_rows(rows,21,'complete-synthetic-report-id')
    for field,value in [('数据修订','2'),('报告标识','complete'),('生成时间','生成时间未记录')]:
        changed=deepcopy(rows);next(row for row in changed if row[0]==field)[1]=value
        with pytest.raises(AssertionError):journey.expect_selection_rows(changed,21,'complete-synthetic-report-id')


@pytest.mark.parametrize('cells',[
    ['毛利率','20%','21%','0 个百分点'],['毛利率','','20%','0 个百分点'],
    ['毛利率','20%','','0 个百分点'],['毛利率','20%','20%','1 个百分点'],
    ['毛利率','20%','20%','0%'],['毛利率','20%','20%'],
])
def test_margin_reader_requires_both_individual_values_and_difference_unit(cells):
    journey.expect_margin_cells(['毛利率','20%','20%','0 个百分点'])
    with pytest.raises(AssertionError):journey.expect_margin_cells(cells)
