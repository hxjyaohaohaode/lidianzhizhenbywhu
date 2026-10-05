"""Recorded total balances only: bounded routing and offline authenticated journeys.

Aliases use pure scope tests. Each API journey signs in once, reads actual saved
revisions, and forbids suppliers and application network/listener attempts.
"""
from copy import deepcopy
import hashlib
from pathlib import Path

import pytest

from conftest import Actor, editable, dataset_ref
from in_process_oracle import offline_test_client
from server.app import make_app
from server.config import Settings
from server.question_scope import plan_scope, resolve_followup, resolve_question
from test_adaptive import dispatch, preview
from test_copilot_message_trace import trace
from test_services import confirm, message, ok, proposal, thread


@pytest.mark.parametrize('query,topics', [
    ('总资产是多少',['assets']),('资产总额',['assets']),('资产总计',['assets']),
    ('TOTAL ASSETS',['assets']),('总资产余额',['assets']),('期末总资产',['assets']),
    ('总负债是多少',['liabilities']),('负债总额',['liabilities']),('负债合计',['liabilities']),
    ('负债总计',['liabilities']),('total liabilities',['liabilities']),('期末总负债',['liabilities']),
    ('总资产和总负债',['assets','liabilities']),('总负债和总资产',['assets','liabilities']),
    ('total assets and total liabilities',['assets','liabilities']),
    ('总资产、总负债和资产负债率',['leverage','assets','liabilities']),
    ('总资产周转率',['asset_turnover']),('总资产周转',['asset_turnover']),
    ('总资产负债率',['leverage']),('净资产收益率',['roe']),('asset turnover',['asset_turnover']),
    ('总资产周转率和总资产',['asset_turnover','assets']),
    ('总资产和总资产周转率',['asset_turnover','assets']),
    ('总资产负债率和总资产',['leverage','assets']),
    ('资产负债率是多少百分比和总负债',['leverage','liabilities']),
    ('total assets and leverage',['leverage','assets']),
    ('total assets and net profit',['net_profit','assets']),
    ('总资产与去年同季比较',['assets']),('总资产和相关资料',['assets']),
    ('总资产和净利润',['net_profit','assets']),
    ('总资产和营业收入同比增幅分别是多少',['revenue_growth','revenue','assets']),
    ('营业收入同比增幅和总资产',['revenue_growth','revenue','assets']),
    ('总资产和营业收入环比增长率分别是多少',['revenue_growth','revenue','assets']),
    ('根据资产负债表核查总资产与总负债',['assets','liabilities']),
])
def test_explicit_totals_and_full_ratio_phrases_keep_distinct_semantics(example,query,topics):
    before=deepcopy(example);scope=resolve_question('2025-Q4 '+query,example,[])
    assert scope['can_calculate'] and scope['topics']==topics
    assert scope['period']=='2025-Q4' and example==before


@pytest.mark.parametrize('query', [
    '资产','负债','资产金额','负债余额','债务','借款','有息负债','流动负债','非流动负债',
    '总资产和有息负债','总负债和非流动负债','净资产与总负债','总资产净额','总负债的净额',
    '平均总资产','总资产平均值','期初总资产','总负债期初余额','年初总资产','流动总资产',
    '期初总负债','有息总负债','固定资产和总资产','总资产中的流动资产','总资产和应收账款',
    '总负债和应付账款','总资产和商誉','total assets and EBITDA','net total assets',
    'average total liabilities','opening total assets','total current assets','total non-current liabilities',
    'total assets at the beginning','total liabilities average','total assets net amount',
    'average of total assets','总资产（平均）','总负债（期初）','total assets (average)',
    '总资产减总负债','总资产和总负债的差额','total assets minus total liabilities','total assets_report',
    'opening balance of total assets','average balance of total assets','net amount of total liabilities',
    '总负债按净额列示','总资产按期初余额','总资产+总负债','总资产乘以2','2 times total assets',
    '总资产和营业利润是多少','总资产和EBIT是多少','总资产及未知指标XYZ','total assets and an unknown metric',
    '总资产和总负债以及营业利润','总资产与净利润及EBIT',
    'total assets divided by total liabilities','total assets less total liabilities','总资产扣除总负债',
    '总资产同比增幅和营业收入同比增幅','总资产和总负债的变化率',
    '总资产变化率是多少','总负债变化率是多少','总资产同比增幅是多少','总资产变动百分比是多少','总资产变动率是多少',
    'total assets and current liabilities','total liabilities and debt','total liabilities and loans',
    '总资产增长率','总负债同比增长率','总资产同比增加百分之多少','总负债同比百分比',
    'total assets growth rate','total liabilities percentage change','总资产百分之多少','总负债是多少百分比',
    'total assets as a percentage','percentage of total liabilities','total liabilities %',
    '总资产同比增长多少%','total assets increase by 5%','总负债增长了10%',
    '总资产/总负债','总资产与总负债之比','研发费用与总资产之比','总资产和库存金额',
    '总负债和研发费用金额','总资产与现金余额','总资产与营业成本率','总资产与operating margin',
    '总负债比例','总资产比率','total liabilities ratio','总资产负债率是多少元',
    '总资产周转率是多少元','总资产多少钱美元','total assets in USD','总负债欧元',
    '预测总资产','总负债forecast','预测资产','forecast liabilities','总资产和收入预测',
])
def test_unsaved_subtypes_operations_and_units_never_use_total_amounts(example,query):
    scope=resolve_question('2025-Q4 '+query,example,[])
    assert scope['status']=='unsupported_topic' and not scope['can_calculate']
    assert scope['topics']==[]
    if '预测' in query or 'forecast' in query:assert plan_scope('2025-Q4 '+query,example)['status']=='blocked'


@pytest.mark.parametrize('query,status', [('2025-Q4不要看总资产','needs_clarification'),
    ('2025-Q4 total assets excluding total liabilities','needs_clarification'),
    ('2025-Q4总资产和2025-Q3总负债','needs_clarification'),
    ('2025年总资产','needs_clarification'),('2001-Q1总负债','period_unavailable')])
def test_balance_scope_does_not_silently_replace_period_or_negation(example,query,status):
    scope=resolve_question(query,example,[])
    assert scope['status']==status and scope['topics']==[]


@pytest.fixture
def balance_actor(tmp_path):
    with offline_test_client(lambda providers:make_app(Settings(data_dir=tmp_path,origin='http://testserver'),
            providers=providers,worker_enabled=False)) as (client,providers,network):
        yield Actor(client)
        assert providers.calls==network==[]


def imported(actor):
    csv=('季度,营业收入,营业成本,总资产,总负债\n'
         '2023-Q4,10,8,100,10\n2024-Q1,12,9,120,20\n2024-Q2,14,10,140,0\n'
         '2024-Q3,16,11,160,\n2024-Q4,25,20,250.000001,50\n2025-Q1,40,30,,60\n').encode()
    staged=ok(actor.post('/workspace/imports/file',data={'company':'原字段问答合成测试企业',
        'amount_unit':'wan','basis':'standalone_quarter'},files={'file':('recorded-balances.csv',csv,'text/csv')}),201)
    saved=ok(actor.post('/workspace/imports/'+staged['id']+'/commit',json={
        'version':staged['version'],'fingerprint':staged['payload']['fingerprint']}),201)
    return saved,hashlib.sha256(csv).hexdigest()


def both(actor,dataset,query):
    first=ok(actor.post('/workspace/assistant',json={'dataset_id':dataset['id'],'query':query}))
    second=ok(message(actor,thread(actor,dataset),text=query),201)['message']['payload']['response']
    assert first['external_calls']==second['external_calls']==0
    assert ok(actor.get('/datasets/'+dataset['id']))==dataset
    return first,second


def assert_amount(f,d,period,key,baseline,unit='wan'):
    rows={p['period']:p for p in d['payload']['periods']};value=rows[period][key];base=rows.get(baseline,{}).get(key)
    assert f['id']==key and f['value']==value and f['unit']=='CNY'
    assert f['period']==period and f['period_basis']=='quarter_end_stock'
    assert f['dataset_id']==d['id'] and f['dataset_version']==d['version'] and f['input_hash']==d['content_hash']
    assert f['source_url']==d['payload']['source_url'] and f['verification']=='unverified_user_input'
    assert f['inputs']==[{'path':f'periods/{period}/{key}','field':key,'value':value,'unit':'CNY'}]
    assert f['status']==('missing' if value is None else 'available')
    assert f['display_amount_unit']==unit and '期末存量' in f['formula'] and '不差分' in f['formula']
    c=f['comparison'];assert c['operation']=='difference' and c['period']==baseline and c['value']==base
    assert c['change_unit']=='CNY' and c['change']==(value-base if value is not None and base is not None else None)
    assert c['status']==('missing_baseline' if baseline not in rows else 'missing_input' if value is None or base is None else 'available')
    assert f['trend'][-1]['period']==period and f['trend'][-1]['value']==value
    assert f['trend'][-1]['display_value']==f['display_value']


def test_real_both_assistants_read_original_nonlatest_totals_ratio_zero_missing_and_baselines(balance_actor):
    a=balance_actor;d,_=imported(a)
    for query,period,baseline in [('2024-Q4总资产、总负债和资产负债率同比','2024-Q4','2023-Q4'),
            ('2024-Q4 total assets and total liabilities QoQ','2024-Q4','2024-Q3'),
            ('2024-Q2总负债','2024-Q2','2023-Q2'),('2024-Q3总负债','2024-Q3','2023-Q3'),
            ('总资产和总负债','2025-Q1','2024-Q1')]:
        for r in both(a,d,query):
            facts={f['id']:f for f in r['facts']}
            expected={'liabilities'} if query in ('2024-Q2总负债','2024-Q3总负债') else {'assets','liabilities'}
            if '资产负债率' in query:expected.add('leverage')
            assert set(facts)==expected
            for key in expected-{'leverage'}:assert_amount(facts[key],d,period,key,baseline)
            if 'leverage' in expected:
                assert facts['leverage']['value']==pytest.approx(500000/2500000.01)
                assert facts['leverage']['comparison']['change_unit']=='ratio_points'
    # Missing is not zero; the explicitly saved zero remains zero with a unit.
    for r in both(a,d,'2024-Q2总负债'):assert r['facts'][0]['display_value']=='0 万元'
    for r in both(a,d,'2024-Q3总负债'):assert r['facts'][0]['display_value']=='未提供'


def test_display_preferences_scale_only_presentation_and_preserve_cents(balance_actor):
    a=balance_actor;d,_=imported(a)
    for unit,expected in [('yuan','2,500,000.01 元'),('wan','250.000001 万元'),('yi','0.0250000001 亿元')]:
        a.user=ok(a.put('/preferences',json={**a.user['preferences'],'name':a.user['name'],
            'version':a.user['version'],'amount_unit':unit}))['user']
        for r in both(a,d,'2024-Q4总资产同比'):
            assert_amount(r['facts'][0],d,'2024-Q4','assets','2023-Q4',unit)
            assert r['facts'][0]['display_value']==expected


def test_real_followup_trace_proposal_report_and_export_keep_original_field_scope(balance_actor):
    a=balance_actor;d,file_hash=imported(a);t=thread(a,d)
    first=ok(message(a,t,text='2024-Q4总资产与总负债环比'),201)['message']
    changed=ok(message(a,t,text='那同比呢',version=2,key='balance-yoy'),201)['message']
    current=ok(message(a,t,text='继续看总负债',version=3,key='balance-liability'),201)['message']
    for m,keys in [(first,['assets','liabilities']),(changed,['assets','liabilities']),(current,['liabilities'])]:
        r=m['payload']['response'];scope=r['context']['question_scope']
        assert scope['period']=='2024-Q4' and scope['topics']==keys
        for f in r['facts']:assert_amount(f,d,'2024-Q4',f['id'],'2024-Q3' if m==first else '2023-Q4')
    traced=ok(trace(a,t,changed));assert traced['question_scope']['topics']==['assets','liabilities']
    for f in traced['facts']:assert_amount(f,d,'2024-Q4',f['id'],'2023-Q4')
    p=ok(proposal(a,t,text='那同比呢',source_message_id=changed['id']),201)
    plan=ok(a.get('/workspace/plans/'+p['payload']['plan_id']))
    assert plan['payload']['snapshot']['research_scope']['topics']==['assets','liabilities']
    assert plan['payload']['snapshot']['research_scope']['period']=='2024-Q4'
    assert plan['payload']['request']['comparison']=='year_over_year' and not plan['payload']['blockers']
    confirmed=ok(confirm(a,p));run=a.execute(ok(a.get('/runs/'+confirmed['payload']['result']['run_id'])))
    result=run['result'];readout=result['readout'];facts={f['id']:f for f in readout['facts']}
    assert set(facts)=={'assets','liabilities'}
    for key,value in [('assets',2500000.01),('liabilities',500000)]:
        assert facts[key]['value']==value and facts[key]['unit']=='CNY' and facts[key]['period']=='2024-Q4'
        assert facts[key]['inputs']==[{'path':f'periods/2024-Q4/{key}','field':key,'value':value,'unit':'CNY',
            'display_value':'250.000001 万元' if key=='assets' else '50 万元'}]
        assert facts[key]['period_basis']=='quarter_end_stock'
    source=readout['input_source'];assert source['dataset_hash']==d['content_hash'] and source['dataset_version']==d['version']
    assert source['file']=={'name':'recorded-balances.csv','sha256':file_hash,'bytes':source['file']['bytes']}
    assert ok(a.get('/workspace/runs/'+run['id']+'/audit'))['report_integrity']['valid']
    md=a.get('/runs/'+run['id']+'/export?format=md').text
    export=ok(a.get('/runs/'+run['id']+'/export?format=json'))
    assert export['readout']==readout
    from server.report_export import text as markdown_text
    for text in ['总资产','总负债','250.000001 万元','50 万元','2024-Q4','期末存量',file_hash]:assert markdown_text(text) in md
    # Update current input; original messages, report, source and exports freeze.
    before=deepcopy(ok(a.get('/services/threads/'+t['id']))['messages'])
    body=editable(d);body['periods'][-2]['assets']=9999999.;body['periods'][-2]['liabilities']=0.
    revised=ok(a.put('/datasets/'+d['id'],json=body));assert revised['version']==2
    assert ok(a.get('/services/threads/'+t['id']))['messages']==before
    assert ok(a.get('/runs/'+run['id']))['result']==result
    assert a.get('/runs/'+run['id']+'/export?format=md').text==md
    assert ok(a.get('/runs/'+run['id']+'/export?format=json'))==export
    current_trace=ok(trace(a,t,changed));assert current_trace['facts'][0]['value']==9999999.
    assert current_trace['facts'][0]['dataset_version']==2


def test_real_adverse_requests_forecast_and_watch_do_not_get_substituted(balance_actor):
    a=balance_actor;d,_=imported(a)
    for query in ['2024-Q4总资产和有息负债','2024-Q4总资产和应收账款','2024-Q4总负债美元',
            '2024-Q4总资产同比增长百分之多少','2024-Q4总负债是多少百分比','2024-Q4预测总资产',
            '2001-Q1总负债','2024-Q4不要看总资产','2024-Q4总资产变化率是多少','2024-Q4总资产同比增幅是多少',
            '2024-Q4总资产变动百分比是多少','2024-Q4 opening balance of total assets','2024-Q4总负债按净额列示']:
        for r in both(a,d,query):assert r['facts']==[]
    for r in both(a,d,'2024-Q4总资产和营业利润是多少'):assert r['facts']==[]
    for query in ['2024-Q4 total assets divided by total liabilities','2024-Q4 total assets less total liabilities','2024-Q4总资产扣除总负债']:
        for r in both(a,d,query):assert r['facts']==[]
    for query in ['2024-Q4总资产和营业收入同比增幅分别是多少','2024-Q4总资产和营业收入环比增长率分别是多少']:
        for r in both(a,d,query):
            assert [f['id'] for f in r['facts']]==['revenue_growth','revenue','assets']
            assert r['facts'][-1]['value']==2500000.01 and r['facts'][-1]['unit']=='CNY'
            assert r['facts'][0]['value']==pytest.approx(1.5 if '同比' in query else .5625)
    for query,execution in [('2024-Q4预测总资产',{}),('2024-Q4预测负债',{}),('2024-Q4总资产',{'forecast':True}),
            ('2024-Q4总资产变化率是多少',{})]:
        p=preview(a,dataset=d,query=query,execution=execution)
        assert p['payload']['blockers'] and p['payload']['snapshot']['research_scope']['status']=='blocked'
        response=a.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']})
        assert response.status_code==409 and response.json()['error']['code']=='PLAN_BLOCKED'
    t=thread(a,d)
    for metric in ('assets','liabilities'):
        assert proposal(a,t,kind='watch',text='跟踪该季度总资产与总负债',metric=metric).status_code==422
        assert a.post('/services/watches',json={'source_ref':dataset_ref(d),'title':'不得替换的资产跟踪',
            'dataset_id':d['id'],'metric':metric,'operator':'gt','threshold':1.0}).status_code==422
    assert a.client.app.state.store.all('SELECT * FROM runs')==[]


def test_legitimate_subcent_balances_never_display_as_zero_in_both_assistants_and_new_report(balance_actor):
    from server.metric_facts import balance_amount_text
    from server.report_export import text as markdown_text
    a=balance_actor;original,_=imported(a);body=editable(original)
    for p in body['periods']:p.update(assets=.004,liabilities=.001)
    body['periods'][0].update(assets=.003,liabilities=.0005)
    d=ok(a.put('/datasets/'+original['id'],json=body))
    for unit,expected in [('yuan',['0.004 元','0.001 元']),('wan',['0.0000004 万元','0.0000001 万元']),
            ('yi',['0.00000000004 亿元','0.00000000001 亿元'])]:
        a.user=ok(a.put('/preferences',json={**a.user['preferences'],'name':a.user['name'],
            'version':a.user['version'],'amount_unit':unit}))['user']
        for r in both(a,d,'2024-Q4总资产与总负债同比'):
            assert [f['value'] for f in r['facts']]==[.004,.001]
            assert [f['display_value'] for f in r['facts']]==expected
            assert [f['source_display_value'] for f in r['facts']]==['0.004 元','0.001 元']
            for f in r['facts']:
                assert_amount(f,d,'2024-Q4',f['id'],'2023-Q4',unit)
                assert not f['comparison']['display_change'].startswith('0 ')
    p=preview(a,dataset=d,query='2024-Q4总资产、总负债与资产负债率同比')
    for r in both(a,d,'2024-Q4总资产、总负债与资产负债率来源'):
        ratio=next(f for f in r['facts'] if f['id']=='leverage')
        assert ratio['input_display_values']=={'periods/2024-Q4/liabilities':'0.001 元','periods/2024-Q4/assets':'0.004 元'}
        if r['engine']=='local_tool_copilot':
            row=next(f for card in r['cards'] if card['kind']=='lineage' for f in card['data'] if f['id']=='leverage')
            assert row['input_display_values']==ratio['input_display_values']
    run=a.execute(dispatch(a,p));facts={f['id']:f for f in run['result']['readout']['facts']}
    assert facts['assets']['display_value']=='0.00000000004 亿元'
    assert facts['liabilities']['display_value']=='0.00000000001 亿元'
    assert facts['leverage']['value']==pytest.approx(.25)
    for f in facts.values():
        for item in f['inputs']:
            if item['field'] in ('assets','liabilities'):
                assert item['display_value']==balance_amount_text(item['value'],'yi')
    md=a.get('/runs/'+run['id']+'/export?format=md').text
    for expected in ['0.00000000004 亿元','0.00000000001 亿元']:
        assert markdown_text(expected) in md
    # Changing preferences never reformats the already exported report.
    a.user=ok(a.put('/preferences',json={**a.user['preferences'],'name':a.user['name'],
        'version':a.user['version'],'amount_unit':'yuan'}))['user']
    assert a.get('/runs/'+run['id']+'/export?format=md').text==md


@pytest.mark.parametrize('value',[0,.001,.004,5.004,2500000.01,1e-20,5e-324,1e15])
def test_new_balance_display_preserves_original_decimal_in_each_unit(value):
    from decimal import Decimal
    from server.metric_facts import balance_amount_text
    for unit,exponent in [('yuan',0),('wan',4),('yi',8)]:
        rendered=balance_amount_text(value,unit).split()[0].replace(',','')
        assert Decimal(rendered).scaleb(exponent)==Decimal(str(value))


def test_ytd_conversion_never_differences_recorded_stocks(balance_actor):
    a=balance_actor
    csv='季度,营业收入,营业成本,总资产,总负债\n2024-Q1,10,8,100,40\n2024-Q2,25,18,120,50\n'.encode()
    stage=ok(a.post('/workspace/imports/file',data={'company':'累计存量合成企业','amount_unit':'wan','basis':'year_to_date'},
        files={'file':('ytd-stock.csv',csv,'text/csv')}),201)
    d=ok(a.post('/workspace/imports/'+stage['id']+'/commit',json={'version':stage['version'],
        'fingerprint':stage['payload']['fingerprint']}),201)
    assert d['payload']['periods'][1]['revenue']==150000
    for r in both(a,d,'2024-Q2总资产和总负债环比'):
        assert [f['value'] for f in r['facts']]==[1200000,500000]
        for f in r['facts']:assert_amount(f,d,'2024-Q2',f['id'],'2024-Q1')
    # The original report engine also freezes these direct fields.
    p=ok(a.post('/workspace/plans',json={'dataset_id':d['id'],'query':'2024-Q2总资产与总负债环比','use_llm':False}),201)
    run=a.execute(dispatch(a,p));assert [f['value'] for f in run['result']['readout']['facts']]==[1200000,500000]
    assert run['result']['readout']['input_source']['input_basis']=='year_to_date'


def test_old_unsupported_scope_and_old_plan_topics_are_not_reinterpreted(example):
    from server.analytics import calculate, lineage
    from server.report_readout import build_readout
    old={'status':'unsupported_topic','can_calculate':False,'topics':[],
        'period':'2025-Q4','comparison':'year_over_year'}
    before=deepcopy(old)
    assert resolve_followup('那同比呢',example,[],old)['topics']==[] and old==before
    snapshot={'dataset':example,'query':'2025-Q4总负债是多少','research_scope':{'topics':[]},'citations':[]}
    analysis=calculate(example)
    assert build_readout(snapshot,analysis,lineage(example,analysis))['facts']==[]
    del snapshot['research_scope']
    assert build_readout(snapshot,analysis,lineage(example,analysis))['scope_recorded'] is False


def test_original_calculator_bytes_are_unchanged():
    assert hashlib.sha256((Path(__file__).parents[1]/'server/models.py').read_bytes()).hexdigest()==\
        'd4b98e8b0912dcbc18fa1f6f712b06afcef54d724435237f5095093107f15047'
