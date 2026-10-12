"""Finite input does not imply finite derived financial ratios.

Synthetic values only. Reject before writes; do not round, clamp or silently
repair either ordinary inputs or historical records.
"""
from copy import deepcopy
import json
import httpx
import pytest
from server.models import calculate, normalize
from server.schemas import Dataset
from server.store import encode
from conftest import editable


def extreme(example,field):
    value=deepcopy(example);value['source_kind']='user_provided';value['amount_unit']='yuan'
    for p in value['periods']:
        for key,number in p.items():
            if isinstance(number,(int,float)) and not isinstance(number,bool):p[key]=1e15 if key!='industry_volatility' else .1
        p[field]=5e-324
        if field=='equity_begin':p['equity_end']=5e-324
    return value


@pytest.mark.parametrize('field',['revenue','assets','inventory','production_volume','equity_begin','cash_flow','net_profit'])
def test_nonrepresentable_ratio_rejected_without_write(actor,example,field):
    data=extreme(example,field)
    if field in ('cash_flow','net_profit'):
        for p in data['periods']:p['revenue']=1e15
    response=actor.post('/datasets',json=data)
    assert response.status_code==422,response.text
    assert actor.get('/datasets').json()['items']==[]


@pytest.mark.parametrize('labels',[['2025-Q1','2025-Q2','2025-Q3'],['2024-Q1','2025-Q1','2025-Q2']])
def test_historical_cutoffs_are_validated_before_save(actor,example,labels):
    value=deepcopy(example);value['source_kind']='user_provided';value['amount_unit']='yuan';value['periods']=value['periods'][:3]
    for p,label,revenue in zip(value['periods'],labels,[5e-324,1e15,1e15]):
        p.update(period=label,revenue=revenue,cost=0,cash_flow=0,net_profit=0,rd_expense=0)
    response=actor.post('/datasets',json=value)
    assert response.status_code==422,response.text
    assert actor.get('/datasets').json()['items']==[]


def test_representable_tiny_amounts_are_not_arbitrarily_rejected(example):
    value=deepcopy(example);value['source_kind']='user_provided';value['amount_unit']='yuan'
    for p in value['periods']:
        for key in ('net_profit','inventory','manufacturing_cost','rd_expense','equity_begin','equity_end'):p[key]=None
        p.update(revenue=1e-300,cost=8e-301,assets=2e-300,liabilities=1e-300,cash_flow=1e-301)
    data=normalize(Dataset.model_validate(value));result=calculate(data)
    assert data['periods'][0]['revenue']==1e-300
    assert result['metrics']['gross_margin']==pytest.approx(.2)
    assert result['metrics']['leverage']==.5 and result['gmps']['probability'] is None
    assert data['verification']=='unverified_user_input';encode(result)


def test_rejected_update_is_atomic(actor,example):
    row=actor.dataset();bad=extreme(example,'assets');bad['version']=row['version']
    response=actor.put('/datasets/'+row['id'],json=bad)
    assert response.status_code==422,response.text
    assert actor.get('/datasets/'+row['id']).json()==row


def test_legacy_extreme_record_stays_exportable_without_silent_repair(actor,example):
    row=actor.dataset();payload=extreme(example,'assets');payload['verification']='unverified_user_input';payload['input_amount_unit']='yuan'
    store=actor.client.app.state.store
    from server.store import digest
    with store.transaction() as db:
        db.execute('UPDATE datasets SET payload=?,content_hash=? WHERE id=?',(encode(payload),digest(payload),row['id']))
    original=actor.get('/datasets/'+row['id']).json()
    assert actor.get('/datasets/'+row['id']+'/analysis').status_code==422
    exported=actor.get('/account/export');assert exported.status_code==200
    assert actor.get('/datasets/'+row['id']).json()==original
    repair=editable(row);response=actor.put('/datasets/'+row['id'],json=repair)
    assert response.status_code==200,response.text
    assert response.json()['version']==row['version']+1
    assert actor.get('/datasets/'+row['id']+'/analysis').status_code==200


def test_positive_equity_average_cannot_underflow_to_zero(actor,example):
    value=deepcopy(example);value['source_kind']='user_provided';value['amount_unit']='yuan'
    for p in value['periods']:p.update(equity_begin=5e-324,equity_end=0,net_profit=0)
    assert actor.post('/datasets',json=value).status_code==422


def test_extreme_numbers_rejected_over_real_http(tmp_path,example):
    from scripts.full_chain_check import ProductServer,register
    server=ProductServer(tmp_path/'data');server.start()
    try:
        with httpx.Client(base_url=server.base,trust_env=False,timeout=10) as client:
            register(client)
            bad=extreme(example,'assets')
            assert client.post('/api/datasets',json=bad).status_code==422
            good=deepcopy(example);good['source_kind']='user_provided'
            response=client.post('/api/datasets',json=good);assert response.status_code==201,response.text
            row=response.json();bad['version']=row['version']
            assert client.put('/api/datasets/'+row['id'],json=bad).status_code==422
            response=client.post('/api/import/dataset',data={'company':'合成边界测试'},files={'file':('bad.json',json.dumps(bad),'application/json')})
            assert response.status_code==422,response.text
            saved=client.get('/api/datasets').json()['items'];assert len(saved)==1 and saved[0]['id']==row['id']
            assert client.get('/api/health').status_code==200
    finally:server.stop()
