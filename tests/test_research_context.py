"""Isolated mathematical disclosure/claim fixtures; zero live supplier requests."""
import copy
from datetime import date
from unittest.mock import patch
from conftest import Actor
from test_adaptive import ResearchProviders, completed
from server.analytics import extended_scenario
from server.autonomy import execute_local_capability
from server.adaptive_runtime import check_claims
from server.research_context import project_tools, disclosed_references, omit_tool_details
from server.store import digest
from server.report_export import markdown_report


def scenario(example):
    return {**extended_scenario(example, .1, .05, .1, .3), 'status': 'completed',
            'approved_assumptions': {'price_change': .1, 'cost_change': .05, 'volume_change': .1,
                                    'fixed_cost_share': .3, 'note': '隔离测试中明确批准的假设'}}


def test_scenario_adapter_carries_actual_outcome_formula_and_boundaries(example):
    out=scenario(example); projected=project_tools({'sensitivity':out})['sensitivity']
    for field in ['result','delta_gross_profit','break_even_volume_multiplier','limitations','formula','approved_assumptions']:
        assert projected[field]==out[field]
    refs=projected['references']; key='sensitivity:result:gross_margin'
    assert refs[key]['value']==out['result']['gross_margin']
    assert refs[key]['output_hash']==digest(out) and refs[key]['unit']=='ratio'
    assert 'grid' not in projected and len(refs)<=6
    assert out==scenario(example), 'adapter must not mutate an archived artifact'


def test_omitted_or_blocked_details_never_authorize_references(example):
    tools=project_tools({'sensitivity':scenario(example)})
    omitted=omit_tool_details(tools)
    assert omitted['sensitivity']['output_hash']==tools['sensitivity']['output_hash']
    assert disclosed_references(omitted)=={}
    blocked=project_tools({'forecast':{'status':'blocked','reason':'缺少完整季度','forecast':[{'value':42,'period':'2027-Q1'}]}})
    assert disclosed_references(blocked)=={}


def test_null_numbers_cannot_become_math_references(example):
    out=scenario(example);out['break_even_volume_multiplier']=None
    assert 'sensitivity:break_even_volume_multiplier' not in disclosed_references(project_tools({'sensitivity':out}))


def test_claims_require_exact_originating_expert_disclosure(example):
    refs=disclosed_references(project_tools({'sensitivity':scenario(example)}))
    key='sensitivity:result:gross_profit'
    claims=[{'agent':'analyst','text':'明确假设下的毛利结果需要结合成本口径核查','tool_reference_ids':[key]}]
    result=check_claims(claims,{},[],disclosures={'analyst':{'tool_references':refs}})
    assert result['claims'][0]['tool_references']==[refs[key]]
    assert result['claim_contract_version']=='grounded-claims-v2'
    assert not check_claims(claims,{},[],disclosures={'researcher':{'tool_references':refs}})['claims']
    assert not check_claims(claims,{},[])['claims']
    assert not check_claims([{**claims[0],'tool_reference_ids':['sensitivity:unknown']}],{},[],disclosures={'analyst':{'tool_references':refs}})['claims']
    cited={'agent':'challenger','text':'资料尚需核验','citation_ids':['other-agent-only']}
    assert not check_claims([cited],{},['other-agent-only'],disclosures={'analyst':{'citation_ids':['other-agent-only']}})['claims']


def test_real_approval_execution_resolves_math_claims_and_exports(factory):
    async def handler(p,system,obj,count):
        tool=obj['approved_tool_results']['sensitivity']
        assert tool['result'] and tool['limitations'] and tool['approved_assumptions']['note']
        return {'output':{'claims':[{'text':'在所选情景假设下需审阅毛利变化','tool_reference_ids':['sensitivity:delta_gross_profit']}],'missing':[]}}
    provider=ResearchProviders(handler=handler); actor=Actor(factory(provider))
    run=completed(actor,use_llm=True,provider='alpha',max_calls=1,execution={'max_revisions':0,'scenario':{
        'price_change':.1,'cost_change':.05,'volume_change':.1,'fixed_cost_share':.3,'note':'隔离测试中的明确压力假设'}})
    result=run['result'];claim=result['llm']['review']['claims'][0]
    output=result['adaptive']['mathematical_outputs']['sensitivity']
    assert claim['tool_references'][0]['value']==output['delta_gross_profit']
    assert claim['tool_references'][0]['output_hash']==digest(output)
    call=result['llm']['calls'][0]
    assert call['tool_references'][claim['tool_reference_ids'][0]]==claim['tool_references'][0]
    assert 'sensitivity:delta_gross_profit' in markdown_report(result)
    audit=actor.get('/workspace/runs/'+run['id']+'/audit').json()
    assert audit['ledger']['valid'] and audit['report_hash_valid']
    assert len(provider.calls)==1


def test_quantitative_replay_uses_frozen_date_without_changing_formulas(example):
    data=copy.deepcopy(example);data['periods'][-1]['period']='2026-Q3'
    class Rollover(date):
        @classmethod
        def today(cls):return cls(2026,10,1)
    args=('quant',{'dataset':data},{},{},{})
    before=execute_local_capability(*args,today=date(2026,9,30))
    with patch('server.models.date',Rollover):
        after=execute_local_capability(*args,today=date(2026,9,30))
        current=execute_local_capability(*args,today=date(2026,10,1))
    assert before==after
    assert before['metrics']==current['metrics'] and before['warnings']!=current['warnings']


def test_gap_planner_includes_actual_rule_and_equity_failures(actor):
    from conftest import editable
    d=actor.dataset();body=editable(d)
    for row in body['periods']:
        for key in ('equity_begin','equity_end','lithium_price','industry_volatility','manufacturing_cost'):
            row[key]=None
    d=actor.put('/datasets/'+d['id'],json=body).json()
    run=completed(actor,dataset=d)
    assert run['result']['quality']['field_coverage']['missing']==[]
    gaps=run['result']['adaptive']['mathematical_outputs']['gaps']
    assert gaps['status']=='needs_input'
    assert {'equity_begin','equity_end','gmps:lithium','gmps:manufacturing','gmps:volatility'}<={x['field'] for x in gaps['items']}
    assert all(x['auto_imputed'] is False for x in gaps['items'])
    from server.evolution import replay
    assert 'gaps' in replay(run,['gaps'],None)['covered']


def test_forecast_reference_catalog_is_bounded_to_actual_points():
    tools=project_tools({'forecast':{'status':'completed','metric':'gross_margin','forecast':[
        {'period':'2027-Q'+str(i+1),'value':.1+i/100,'lower':None,'upper':None} for i in range(4)],
        'limitations':['隔离测试限制']}})
    refs=disclosed_references(tools)
    assert len(refs)==4
    assert refs['forecast:forecast:0:value']['unit']=='ratio'
    assert all('lower' not in key and 'upper' not in key for key in refs)


def test_per_call_budget_omission_drops_reference_authority(factory):
    from server.adaptive_runtime import AdaptiveRun
    from server.config import Settings
    from types import SimpleNamespace
    import asyncio
    fake=AdaptiveRun.__new__(AdaptiveRun)
    fake.st={'context':{'question':'隔离测试问题','metrics':{},'evidence':[],'approved_memory':[]}}
    fake.graph={'provider_bindings':{'analyst':{'id':'alpha'}},'fallback_bindings':[]}
    fake.worker=SimpleNamespace(settings=SimpleNamespace(max_context_chars=600))
    fake.outputs={'sensitivity':{'status':'completed','result':{'gross_profit':12},'period':'2026-Q1',
                  'limitations':['明确限制'*300]}}
    captured={}
    def reserve(n,b,prompt,disclosure):
        import json
        captured.update(context=json.loads(prompt),disclosure=disclosure)
        return None,'LOCAL_TEST_NO_DISPATCH'
    fake.reserve_call=reserve
    asyncio.run(fake.model({'id':'analyst','capability':'analyst','depends_on':[]}))
    assert captured['disclosure']['tool_references']=={}
    assert captured['context']['approved_tool_results']['sensitivity']['output_hash']==digest(fake.outputs['sensitivity'])
    assert 'omitted_detail' in captured['context']['approved_tool_results']['sensitivity']


def test_replay_after_quarter_rollover_matches_archived_analysis(actor):
    from conftest import editable
    from server.evolution import replay
    d=actor.dataset();body=editable(d)
    body['periods']=[p for p in body['periods'] if p['period']<='2026-Q3']
    body['periods'][-1]['period']='2026-Q3'
    d=actor.put('/datasets/'+d['id'],json=body).json()
    class Before(date):
        @classmethod
        def today(cls):return cls(2026,9,30)
    class After(date):
        @classmethod
        def today(cls):return cls(2026,10,1)
    with patch('server.studio.date',Before):run=completed(actor,dataset=d)
    with patch('server.models.date',After),patch('server.analytics.date',After):
        replayed=replay(run,['quality','quant'],None)
    assert replayed['math_hash']==digest(run['result']['analysis'])
    assert replayed['as_of']=='2026-09-30'
