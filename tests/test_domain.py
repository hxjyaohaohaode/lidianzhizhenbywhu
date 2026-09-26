"""Independent arithmetic oracles and metamorphic tests, not comparisons to a copied implementation."""
import copy
import json
import random
import pytest
from pydantic import ValidationError
from server.schemas import Dataset,Period,Evidence,CompareRequest
from server.models import normalize,calculate,metric,scenario,select_baseline,AMOUNT_FIELDS

@pytest.mark.parametrize('field',['revenue','cost','assets','net_profit','cash_flow','industry_volatility'])
@pytest.mark.parametrize('value',[True,'100',float('nan'),float('inf'),-float('inf')])
def test_non_numeric_or_nonfinite_rejected(field,value):
    with pytest.raises(ValidationError):Period.model_validate({'period':'2025-Q1','revenue':100.,'cost':80.,field:value})
@pytest.mark.parametrize('quarter',['2025-Q0','2025-Q5','2025-01','1999-Q1','2100-Q1','2099-Q4'])
def test_invalid_or_future_quarter_rejected(quarter):
    with pytest.raises(ValidationError):Period(period=quarter,revenue=1.,cost=1.)
@pytest.mark.parametrize('field',['revenue','cost','assets','liabilities','inventory','sales_volume','production_volume','lithium_price'])
def test_negative_nonnegative_field(field):
    with pytest.raises(ValidationError):Period.model_validate({'period':'2025-Q1','revenue':1.,'cost':1.,field:-1.})
def test_zero_assets_positive_debt_invalid():
    with pytest.raises(ValidationError):Period(period='2025-Q1',revenue=0.,cost=0.,assets=0.,liabilities=1.)
def test_duplicate_period_and_unknown_keys(example):
    example['periods'].append(copy.deepcopy(example['periods'][0]))
    with pytest.raises(ValidationError):Dataset.model_validate(example)
    with pytest.raises(ValidationError):Period(period='2025-Q1',revenue=10.,cost=2.,invented=100.)
def test_sort_pure_calculation_and_independent_arithmetic(example):
    example['periods'].reverse();d=normalize(Dataset.model_validate(example));before=copy.deepcopy(d)
    a=calculate(d);assert d==before and calculate(d)==a
    assert a['current_period']=='2026-Q3' and a['baseline_period']=='2025-Q3'
    assert a['metrics']['gross_margin']==pytest.approx((20400000-16626000)/20400000)
    assert a['gmps']['probability'] is None and a['gmps']['coverage']==pytest.approx(1)
    assert sum(x['weight'] for x in a['gmps']['dimensions'])==pytest.approx(1)
    assert a['gmps']['score']==pytest.approx(round(sum(x['weight']*x['score'] for x in a['gmps']['dimensions']),2))
@pytest.mark.parametrize('unit,factor',[('yuan',1),('wan',10000),('yi',100000000)])
def test_unit_normalization_preserves_scores_and_price(example,unit,factor):
    baseline=calculate(normalize(Dataset.model_validate(example)));price=example['periods'][-1]['lithium_price'];example['amount_unit']=unit
    for p in example['periods']:
        for k in AMOUNT_FIELDS:
            if p.get(k) is not None:p[k]/=factor
    normalized=normalize(Dataset.model_validate(example));out=calculate(normalized)
    assert normalized['periods'][-1]['lithium_price']==price
    assert out['gmps']['score']==pytest.approx(baseline['gmps']['score'])
    assert out['dqi']['score']==pytest.approx(baseline['dqi']['score'])
def test_missing_never_imputed_zero_revenue():
    a=calculate(normalize(Dataset(name='空缺',company='空缺',periods=[Period(period='2025-Q1',revenue=0.,cost=0.)])))
    assert a['gmps']['score'] is None and a['dqi']['score'] is None
    assert a['metrics']['gross_margin'] is None and a['metrics']['rd_ratio'] is None
    assert all(x['value'] is None for x in a['gmps']['dimensions'])
    assert 'NaN' not in json.dumps(a,allow_nan=False)
def test_exact_previous_and_annual_baseline():
    p=[{'period':'2025-Q2'},{'period':'2025-Q4'},{'period':'2026-Q1'}]
    assert select_baseline(p,'previous')['period']=='2025-Q4'
    assert select_baseline(p,'year_over_year') is None
    assert select_baseline([{'period':'2025-Q2'},{'period':'2025-Q4'}],'previous') is None
def test_negative_equity_no_made_up_roe(example):
    example['periods'][-1].update(equity_begin=-5.,equity_end=-10.);a=calculate(normalize(Dataset.model_validate(example)))
    assert a['metrics']['roe'] is None and a['dqi']['dimensions'][0]['metric']=='net_margin'
@pytest.mark.parametrize('seed',range(12))
def test_cost_pressure_monotonic_for_cost_driven_components(example,seed):
    rng=random.Random(seed);original=normalize(Dataset.model_validate(example));changed=copy.deepcopy(original)
    changed['periods'][-1]['cost']*=1+rng.uniform(.01,1.5);before=calculate(original);after=calculate(changed)
    for id in ('margin','gap','unit_cost'):
        get=lambda a:next(d['score'] for d in a['gmps']['dimensions'] if d['id']==id)
        assert get(after)>=get(before)
    assert 0<=after['gmps']['score']<=100 and 0<=after['dqi']['score']<=100
def test_scenario_identity_and_expected_effects(example):
    d=normalize(Dataset.model_validate(example));s=scenario(d,0,0,0)
    assert s['gross_margin']==pytest.approx(calculate(d)['metrics']['gross_margin'])
    assert scenario(d,.1,0,0)['gross_margin']>s['gross_margin']
    assert scenario(d,0,.1,0)['gross_margin']<s['gross_margin']
    assert scenario(d,0,0,.5)['gross_margin']==pytest.approx(s['gross_margin'])
    assert s['assumptions']['all_costs_variable'] is True
def test_evidence_future_and_duplicate_comparison_invalid():
    with pytest.raises(ValidationError):Evidence(title='来源',text='正文内容'*10,published_at='2099-01-01')
    with pytest.raises(ValidationError):CompareRequest(dataset_ids=['same','same'])
def test_normalization_overflow_refused(example):
    example['amount_unit']='yi';example['periods'][0]['revenue']=1e15
    with pytest.raises(ValueError):normalize(Dataset.model_validate(example))
