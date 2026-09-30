"""Archived report export regressions. Inputs here are isolated test fixtures."""
import copy
from server.report_export import report_payload, markdown_report, math_markdown
from server.analytics import extended_scenario, forecast_baselines


def test_export_preserves_archived_version_and_actual_math_and_reviews(example):
    scenario=extended_scenario(example,.12,.03,.05,.3)
    scenario.update(status='completed',approved_assumptions={'price_change':.12,'cost_change':.03,'volume_change':.05,'fixed_cost_share':.3,'note':'明确测试假设，非真实企业资料'})
    run={'id':'isolated-run','state':'degraded','snapshot':{'identity':{'name':'已归档身份'},'profile':{'objective':'已归档目标'},'studio':{'success_criteria':'核对情景与现金流'}},
         'result':{'title':'测试报告','query':'原始情景问题','model_version':'rules-historical-test','dataset_version':2,'dataset_hash':'archived-hash','analysis':{},'warnings':['缺少外部核验'],
         'adaptive':{'mathematical_outputs':{'sensitivity':scenario},'reflection':{'issues':[{'node':'forecast','state':'blocked','reason':'样本不足'}]}},
         'llm':{'state':'not_requested','review':{'claims':[{'id':'claim-test','text':'测试解释待核验','metric_ids':['cash_ratio'],'citation_ids':['evidence-test']}]}}}}
    frozen=copy.deepcopy(run)
    reviews=[{'payload':{'claim_id':'claim-test','verdict':'rejected','note':'缺少原始证据'}}]
    payload=report_payload(run,[],reviews,{'payload':{'verdict':'needs_revision'}})
    md=markdown_report(payload)
    for expected in ['rules\\-historical\\-test','明确测试假设','delta_gross_profit','已归档身份','原始情景问题','核对情景与现金流','缺少原始证据','needs_revision','样本不足']:
        assert expected in md
    assert run==frozen
    assert payload['adaptive']['mathematical_outputs']['sensitivity']==scenario
    assert payload['export_context']['human_reviews_at_export']==reviews


def test_export_keeps_missing_and_blocked_outputs_empty_not_zero():
    result={'title':'空报告','model_version':'old','adaptive':{'mathematical_outputs':{'forecast':{'status':'blocked','reason':'完整季度不足'}}},'llm':{'state':'not_requested','review':{'claims':[]}}}
    md=markdown_report(result)
    assert '完整季度不足' in md and '没有匹配证据' in md
    assert 'rules-3.0.0' not in md and '未来收入' not in md


def test_export_escapes_untrusted_markdown_and_html_and_protects_json_fence():
    result={'title':'<script>alert(1)</script>','query':'[click](javascript:bad)','findings':['<img src=x onerror=bad>'],
        'adaptive':{'reflection':{'note':'```\n<script>bad</script>\n```'}},'citations':[{'title':'<svg onload=bad>','excerpt':'[visit](https://untrusted.example)','url':'javascript:bad'}]}
    md=markdown_report(result)
    assert '# &lt;script&gt;' in md and '\\[click\\]' in md
    assert '<img src=x' not in md and '<svg onload' not in md
    # JSON text containing a triple backtick cannot terminate its four-backtick fence.
    assert '````json' in md


def test_forecast_export_retains_forecast_backtest_and_holdout(example):
    # Use actual available fixture quarters; append no made-up runtime records.
    data=copy.deepcopy(example)
    data['periods']=[{**data['periods'][0],'period':f'{2021+i//4}-Q{i%4+1}','revenue':float(100+i*3),'cost':float(70+i)} for i in range(12)]
    output=forecast_baselines(data,'revenue',2)
    md=math_markdown('forecast',output)
    for value in ['时间序列预测与回测','相同滚动起点回测','锁定方法保留检验',output['forecast'][0]['period'], 'baseline_prediction']:
        assert value in md


def test_report_http_export_includes_real_scenario_output(actor):
    d=actor.dataset()
    p=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'核对售价情景与成本敏感性',
        'execution':{'scenario':{'price_change':.12,'cost_change':.03,'volume_change':.05,'fixed_cost_share':.3,'note':'保存的明确情景依据'}}}).json()
    r=actor.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']}).json()
    actor.execute(r)
    j=actor.get('/runs/'+r['id']+'/export?format=json');md=actor.get('/runs/'+r['id']+'/export?format=md')
    assert j.status_code==200 and md.status_code==200
    assert j.json()['adaptive']['mathematical_outputs']['sensitivity']['approved_assumptions']['note']=='保存的明确情景依据'
    assert '保存的明确情景依据' in md.text and 'delta_gross_profit' in md.text
    assert j.json()['export_context']['run_id']==r['id']
    other=type(actor)(actor.client)
    assert other.get('/runs/'+r['id']+'/export?format=md').status_code==404


def test_signed_search_origin_survives_display_edit_plan_and_readable_export(actor, client):
    """Real local receipt/save/edit/retrieve/plan/export chain, no provider network."""
    d=actor.dataset();company=d['payload']['company']
    original='https://www.sse.com.cn/original-search-summary'
    display='https://www.sse.com.cn/corrected-display'
    captured='2026-01-01T00:00:00Z'
    class Search:
        def status(self):return {'configured':True}
        def search(self,q):return {'items':[{'title':'隔离测试搜索摘要','source_url':original,'text':'毛利率现金流营业收入成本，仅供隔离测试的资料，不代表企业真实经营。'*5,'retrieved_at':captured,'verification':'search_snippet_unverified'}],'rejected':0,'credits_reported':None}
    client.app.state.research=Search()
    response=actor.post('/research/search',json={'query':'毛利率现金流','consent':True});assert response.status_code==200,response.text
    item=response.json()['items'][0]
    saved=actor.post('/evidence',json={**{k:item[k] for k in ('title','source_url','text','retrieved_at','search_receipt')},'company':company});assert saved.status_code==201,saved.text
    row=saved.json()
    edited=actor.put('/evidence/'+row['id']+'/metadata',json={'version':row['version'],'title':'展示标题修订','source_url':display,'published_at':'2025-12-31'});assert edited.status_code==200,edited.text
    preview=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'核对毛利率现金流营业收入成本','execution':{}});assert preview.status_code==201,preview.text
    p=preview.json();citation=p['payload']['snapshot']['citations'][0];packed=p['payload']['context']['evidence'][0]
    assert citation['original_source_url']==original and citation['url']==display
    assert packed['source_kind']=='search_snippet' and packed['verification']=='search_snippet_unverified'
    assert packed['source_url']==display and packed['original_source_url']==original and packed['retrieved_at']==captured
    assert packed['fetched_at'] is None
    run=actor.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']});assert run.status_code==202,run.text
    actor.execute(run.json())
    md=actor.get('/runs/'+run.json()['id']+'/export?format=md');assert md.status_code==200,md.text
    assert '搜索摘要（非全文）' in md.text and '原始采集来源地址' in md.text
    from server.report_export import text
    assert text(original) in md.text and text(display) in md.text and text(captured) in md.text
    assert 'search\\_snippet\\_unverified' in md.text
