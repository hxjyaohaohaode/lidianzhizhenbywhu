"""Exact approved values and references; provider is a named in-memory stub."""
import json
from types import SimpleNamespace
import pytest
from conftest import Actor

class ScopedMetricCapture:
    def __init__(self):
        self.provider=SimpleNamespace(id='metric-scope-stub',model='synthetic-model',host='synthetic.invalid',path='/never-networked')
        self.calls=[]
    def select(self,id=''):return self.provider if id in ('',self.provider.id) else None
    def status(self):return [{'id':self.provider.id,'configured':True}]
    async def complete(self,provider,system,context):
        self.calls.append(json.loads(context))
        return {'output':{'claims':[
            {'text':'所问净利润仍须核对其原始输入','metric_ids':['net_profit']},
            {'text':'未请求的杠杆不应冒充本题依据','metric_ids':['leverage']}], 'missing':[]},'usage':{'total_tokens':0}}
    async def propose(self,provider,context):
        return {'output':{'focus':['quality'],'specialists':['analyst'],'rationale':'限定原问题指标的合成探针'},'usage':{'total_tokens':0}}

@pytest.mark.parametrize('adaptive',[False,True])
def test_requested_amount_is_sent_from_approved_period_and_only_its_reference_is_accepted(factory,adaptive):
    vendor=ScopedMetricCapture();a=Actor(factory(providers=vendor));dataset=a.dataset();period=dataset['payload']['periods'][1]
    body={'dataset_id':dataset['id'],'query':period['period']+'净利润','use_llm':True,'provider':vendor.provider.id,'max_calls':1}
    if adaptive:body['execution']={'max_revisions':0,'parallelism':1}
    response=a.post('/workspace/plans',json=body);assert response.status_code==201,response.text;plan=response.json()
    # This expectation intentionally failed on the frozen original implementation.
    assert plan['payload']['context']['metrics'].get('net_profit')==period['net_profit']
    assert set(plan['payload']['context']['metrics'])=={'net_profit'}
    result=a.post('/workspace/plans/'+plan['id']+'/execute',json={'version':plan['version'],'fingerprint':plan['payload']['fingerprint'],'external_consent':True})
    assert result.status_code==202,result.text
    run=a.execute(result.json());assert vendor.calls
    for sent in vendor.calls:
        assert sent['metrics']=={'net_profit':period['net_profit']}
        detail=sent['metric_scope']['facts'][0]
        assert detail['id']=='net_profit' and detail['value']==period['net_profit'] and detail['unit']=='CNY'
        assert detail['period']==period['period']
        assert sent['metric_scope']['dataset_version']==dataset['version'] and sent['metric_scope']['dataset_hash']==dataset['content_hash']
    review=run['result']['llm']['review'];assert any(c['metric_ids']==['net_profit'] for c in review['claims'])
    assert all(c['metric_ids']!=['leverage'] for c in review['claims'])
    assert review['rejected_claims']>=1


@pytest.mark.parametrize('key,query,unit',[
    ('revenue','营业收入','CNY'),('cost','营业成本','CNY'),('net_profit','净利润','CNY'),
    ('cash_flow','经营现金流','CNY'),('assets','总资产','CNY'),('liabilities','总负债','CNY'),
    ('gross_margin','毛利率','ratio'),('inventory_turnover','存货周转率','times')])
def test_metric_preview_selects_exact_existing_value_period_unit_and_origin(actor,key,query,unit):
    from server.models import calculate
    from server.model_metrics import metric_receipt
    d=actor.dataset();period=d['payload']['periods'][1]['period']
    r=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':period+query})
    assert r.status_code==201,r.text
    p=r.json()['payload'];context=p['context']
    assert set(context['metrics'])==set(p['snapshot']['research_scope']['topics'])
    data={**d['payload'],'periods':d['payload']['periods'][:2]};a=calculate(data)
    expected=data['periods'][-1].get(key) if unit=='CNY' else a['metrics'][key]
    assert context['metrics'][key]==expected
    facts=context['metric_scope']['facts'];assert len(facts)==len(context['metrics'])
    fact=next(f for f in facts if f['id']==key)
    assert (fact['id'],fact['unit'],fact['period'])==(key,unit,period)
    assert metric_receipt(context)[key]=={'value':expected,'unit':unit,'period':period,'dataset_version':d['version'],'dataset_hash':d['content_hash']}


def test_missing_requested_amount_is_explicit_and_never_becomes_a_numeric_reference(actor):
    from conftest import editable
    from server.model_metrics import metric_receipt
    d=actor.dataset();body=editable(d);body['periods'][-1]['net_profit']=None
    d=actor.put('/datasets/'+d['id'],json=body).json()
    p=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'最新季度净利润'}).json()['payload']
    assert p['context']['metrics']=={'net_profit':None}
    assert p['context']['metric_scope']['facts'][0]['status']=='missing'
    assert metric_receipt(p['context'])=={}


@pytest.mark.parametrize('damage',['value','unit','period','dataset_version','dataset_hash','absent','different_agent','globally_valid_other','boolean','extra_field','missing_version','wrong_version'])
def test_metric_claim_requires_exact_numeric_value_and_per_call_origin(damage):
    from copy import deepcopy
    from server.adaptive_runtime import check_claims
    expected={'net_profit':{'value':1.0,'unit':'CNY','period':'2025-Q4','dataset_version':1,'dataset_hash':'a'*64}}
    actual=deepcopy(expected);claim={'text':'净利润须核对','metric_ids':['net_profit'],'agent':'analyst'}
    disclosure={'metric_binding_version':1,'metric_bindings':actual}
    disclosures={'analyst':disclosure}
    if damage=='value':actual['net_profit']['value']=2.0
    elif damage=='unit':actual['net_profit']['unit']='ratio'
    elif damage=='period':actual['net_profit']['period']='2026-Q1'
    elif damage=='dataset_version':actual['net_profit']['dataset_version']=2
    elif damage=='dataset_hash':actual['net_profit']['dataset_hash']='b'*64
    elif damage=='absent':disclosure.pop('metric_bindings')
    elif damage=='different_agent':disclosures={'researcher':disclosure}
    elif damage=='globally_valid_other':claim['metric_ids']=['leverage'];actual['leverage']={'value':.5}
    elif damage=='boolean':actual['net_profit']['value']=True
    elif damage=='extra_field':actual['net_profit']['unapproved']='extra'
    elif damage=='missing_version':disclosure.pop('metric_binding_version')
    elif damage=='wrong_version':disclosure['metric_binding_version']=True
    out=check_claims([claim],{'net_profit':1.0,'leverage':.5},[],disclosures=disclosures,expected_metric_bindings=expected)
    assert out['claims']==[] and out['rejected_claims']==1


def test_old_approved_context_is_not_enriched_or_relabelled_with_current_values():
    from server.model_metrics import metric_receipt
    from server.adaptive_runtime import check_claims
    context={'metrics':{'gross_margin':.2}}
    expected=metric_receipt(context)
    assert expected=={'gross_margin':{'value':.2}}
    # Older genuinely frozen context may be reviewed within its original
    # disclosed IDs; it cannot gain a new amount merely available globally.
    claims=[{'text':'净利润缺少原披露','agent':'analyst','metric_ids':['net_profit']}]
    assert not check_claims(claims,{'gross_margin':.2,'net_profit':123},[],disclosures={'analyst':{}},
        expected_metric_bindings=expected,require_metric_bindings=False)['claims']


@pytest.mark.parametrize('damage',['null_scope','boolean_schema','missing_schema','bad_hash','boolean_dataset_version',
    'duplicate_fact','boolean_value','unknown_metric','mismatched_value','missing_value'])
def test_malformed_modern_metric_projection_never_falls_back_to_global_or_legacy_ids(damage):
    from server.model_metrics import metric_receipt
    context={'metrics':{'net_profit':1.0},'metric_scope':{'schema_version':1,'dataset_version':1,'dataset_hash':'a'*64,
        'facts':[{'id':'net_profit','value':1.0,'unit':'CNY','period':'2025-Q4','status':'available'}]}}
    scope=context['metric_scope'];fact=scope['facts'][0]
    if damage=='null_scope':context['metric_scope']=None
    elif damage=='boolean_schema':scope['schema_version']=True
    elif damage=='missing_schema':scope.pop('schema_version')
    elif damage=='bad_hash':scope['dataset_hash']='not-a-snapshot-hash'
    elif damage=='boolean_dataset_version':scope['dataset_version']=True
    elif damage=='duplicate_fact':scope['facts'].append(dict(fact))
    elif damage=='boolean_value':fact['value']=True
    elif damage=='unknown_metric':fact['id']='unapproved';context['metrics']={'unapproved':1.0}
    elif damage=='mismatched_value':fact['value']=2.0
    elif damage=='missing_value':fact.pop('value')
    assert metric_receipt(context)=={}
