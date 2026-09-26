"""Independent analytical and adversarial properties. All observations below are synthetic test inputs."""
import copy,math,random
from datetime import date
import pytest
from pydantic import ValidationError
from server.analytics import (quarter_index,quarter_label,closed_quarter,period_end,from_cumulative,
    dataset_diff,quality_report,extended_scenario,forecast_baselines,lineage)
from server.contracts import CompanyProfile,PlanDraft,ActionTransition,ExperimentRequest,ImportPreview,EvidenceReview,PlanConsent
from server.schemas import Dataset
from server.models import normalize,calculate


def series(n=12):
    return {'name':'synthetic acceptance data','company':'验收合成企业','source_kind':'user_provided','amount_unit':'yuan',
      'source_url':'https://example.com/only-for-tests','periods':[{'period':quarter_label(2022*4+i),
      'revenue':100000.0+1200*i,'cost':70000.0+600*i,'cash_flow':12000.0+100*i,'net_profit':9000.0,
      'assets':500000.0,'liabilities':200000.0,'equity_end':300000.0,'equity_begin':290000.0,'inventory':20000.0,'rd_expense':3000.0}
      for i in range(n)]}

@pytest.mark.parametrize('year,quarter',[(y,q) for y in [2000,2022,2024,2099] for q in range(1,5)])
def test_quarter_round_trip(year,quarter):
    s=f'{year}-Q{quarter}';assert quarter_label(quarter_index(s))==s
    assert period_end(s).month==quarter*3


def test_closed_quarter_boundary():
    assert not closed_quarter('2025-Q1',date(2025,3,31))
    assert closed_quarter('2025-Q1',date(2025,4,1))
    assert not closed_quarter('2025-Q4',date(2025,12,31))
    assert closed_quarter('2025-Q4',date(2026,1,1))


def test_cumulative_only_flows_differenced_stocks_preserved():
    d=series(4);d['periods'][0].update(revenue=100,cost=60,cash_flow=10,sales_volume=5,equity_end=300)
    d['periods'][1].update(revenue=230,cost=120,cash_flow=8,sales_volume=11,equity_end=500)
    out=from_cumulative(d);second=out['periods'][1]
    assert second['revenue']==130 and second['cost']==60 and second['cash_flow']==-2 and second['sales_volume']==6
    assert second['assets']==500000 and second['equity_end']==500 and second['equity_begin']==300
    assert d['periods'][1]['revenue']==230


def test_cumulative_missing_previous_or_optional_refuses_invention():
    d=series(3);d['periods'][0]['cash_flow']=None
    assert from_cumulative(d)['periods'][1]['cash_flow'] is None
    del d['periods'][0]
    with pytest.raises(ValueError,match='缺少'):from_cumulative(d)


def test_cumulative_negative_mandatory_flow_rejected_after_difference():
    d=series(2);d['periods'][1]['revenue']=1
    with pytest.raises(ValidationError):Dataset.model_validate(from_cumulative(d))


def test_year_boundary_cumulative_reset():
    d=series(5);d['periods'][4]['revenue']=500
    assert from_cumulative(d)['periods'][4]['revenue']==500


def test_zero_and_missing_quality_never_corrected_silently():
    d=series();last=d['periods'][-1];last.update(revenue=0,cash_flow=-50,equity_end=1)
    last.pop('rd_expense');report=quality_report(d)
    assert {'ZERO_REVENUE','NEGATIVE_GROSS_PROFIT','NEGATIVE_CASH_FLOW','BALANCE_MISMATCH','MISSING_FIELDS'}<={f['code'] for f in report['findings']}
    assert last['revenue']==0 and last['cash_flow']==-50
    assert calculate(d)['metrics']['gross_margin'] is None


def test_diff_records_deleted_and_inserted_values():
    a=series(2);b=copy.deepcopy(a);b['periods'].pop(0);b['periods'][0]['revenue']+=1;b['name']='changed'
    diff={r['path']:r for r in dataset_diff(a,b)}
    assert diff['periods/2022-Q1/revenue']['after'] is None
    assert diff['periods/2022-Q2/revenue']['after']-diff['periods/2022-Q2/revenue']['before']==1
    assert diff['name']['after']=='changed'

@pytest.mark.parametrize('fixed',[0.,.25,1.])
def test_scenario_identity_fixed_cost_and_break_even(fixed):
    d=series();r=extended_scenario(d,0,0,0,fixed);p=d['periods'][-1]
    assert r['result']['revenue']==p['revenue']
    assert r['result']['cost']==pytest.approx(p['cost']) and r['delta_gross_profit']==0
    b=r['break_even_volume_multiplier'];scenario=extended_scenario(d,0,0,b-1,fixed)
    assert scenario['result']['gross_profit']==pytest.approx(0,abs=1e-6)
    changed=extended_scenario(d,.1,.2,.3,fixed)
    assert changed['result']['fixed_cost']==p['cost']*fixed
    assert changed['result']['variable_cost']==pytest.approx(p['cost']*(1-fixed)*1.2*1.3)


def test_scenario_negative_contribution_no_false_break_even():
    r=extended_scenario(series(),-.8,1,0,.1)
    assert r['break_even_volume_multiplier'] is None and r['result']['gross_profit']<0
    assert len(r['grid'])==25 and len(r['sensitivity'])==3


def test_scenario_finite_and_scale_metamorphic():
    rng=random.Random(563)
    for _ in range(60):
        args=[rng.uniform(-.8,1) for _ in range(3)]+[rng.random()];d=series(6);r=extended_scenario(d,*args)
        scale=copy.deepcopy(d)
        for p in scale['periods']:p['revenue']*=100;p['cost']*=100
        s=extended_scenario(scale,*args)
        assert s['result']['gross_profit']==pytest.approx(r['result']['gross_profit']*100)
        assert s['result']['gross_margin']==pytest.approx(r['result']['gross_margin'])
        assert math.isfinite(r['result']['gross_profit'])


def test_baseline_rolling_predictions_do_not_read_the_target():
    d=series(12);r=forecast_baselines(d,'revenue',3,date(2026,1,1))
    changed=copy.deepcopy(d);changed['periods'][7]['revenue']*=3
    b=forecast_baselines(changed,'revenue',3,date(2026,1,1))
    for model,altered in zip(r['backtests'],b['backtests']):
        for fold in model['folds']:assert quarter_index(fold['train_end'])<quarter_index(fold['target'])
        assert model['folds'][:3]==altered['folds'][:3]
        # Target actual changes, but prediction for that target must NOT change.
        assert model['folds'][3]['prediction']==altered['folds'][3]['prediction']
        assert model['folds'][3]['actual']!=altered['folds'][3]['actual']
    assert r['forecast'][1]['lower'] is None and r['forecast'][2]['lower'] is None
    assert r['forecast'][0]['lower'] is not None
    assert {len(x['folds']) for x in r['backtests']}=={8}


def test_forecast_open_quarter_not_in_training():
    d=series(12);r=forecast_baselines(d,'revenue',1,date(2024,10,15))
    assert r['train_end']=='2024-Q3' and r['excluded_periods']==['2024-Q4']
    d['periods'][-1]['revenue']=1e12
    assert forecast_baselines(d,'revenue',1,date(2024,10,15))['forecast']==r['forecast']

@pytest.mark.parametrize('kind',['short','gap','missing','zero-margin'])
def test_forecast_refuses_invalid_history(kind):
    d=series()
    if kind=='short':d['periods']=d['periods'][:5]
    if kind=='gap':d['periods'].pop(5)
    if kind=='missing':d['periods'][5]['cash_flow']=None
    if kind=='zero-margin':d['periods'][5]['revenue']=0
    with pytest.raises(ValueError):forecast_baselines(d,'gross_margin' if kind=='zero-margin' else 'cash_flow',2)


def test_forecast_zero_denominator_and_simple_tie():
    d=series(8)
    for p in d['periods']:p['cash_flow']=0
    r=forecast_baselines(d,'cash_flow',4)
    assert r['selected']=='last' and all(b['wape'] is None for b in r['backtests'])
    assert all(f['lower'] is None for f in r['forecast'])
    assert all(f['value']==0 for f in r['forecast'])


def test_lineage_end_asset_denominator_and_period_inputs():
    d=series();a=calculate(d);links=lineage(d,a)
    for item in links:
        assert all(x['path'].startswith('periods/'+a['current_period']) for x in item['inputs'])
        assert item['value']==a['metrics'][item['id']]
    assert '期末资产' in next(x for x in links if x['id']=='asset_turnover')['formula']

@pytest.mark.parametrize('model,values',[
    (CompanyProfile,{'company':'test','margin_floor':float('nan')}),
    (CompanyProfile,{'company':'test','cash_floor':float('inf')}),
    (CompanyProfile,{'company':'test','leverage_ceiling':-1}),
    (PlanDraft,{'dataset_id':'test','query':'test query','max_calls':4}),
    (PlanDraft,{'dataset_id':'test','query':'test query','max_calls':0,'use_llm':True}),
    (ActionTransition,{'version':1,'status':'done','note':'ok'}),
    (ActionTransition,{'version':1,'status':'blocked'}),
    (EvidenceReview,{'status':'accepted','note':''}),
    (EvidenceReview,{'status':'rejected','note':' '}),
    (PlanConsent,{'version':0,'fingerprint':'a'*64}),
    (PlanConsent,{'version':1,'fingerprint':'garbage'}),
    (ExperimentRequest,{'dataset_id':'x','name':'x','kind':'forecast','horizon':5,'assumptions':'enough chars'}),
    (ExperimentRequest,{'dataset_id':'x','name':'x','kind':'scenario','fixed_cost_share':1.1,'assumptions':'enough chars'}),
])
def test_contract_negative_values(model,values):
    with pytest.raises(ValidationError):model.model_validate(values)
