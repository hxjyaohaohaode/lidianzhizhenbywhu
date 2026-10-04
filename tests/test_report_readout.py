"""The original question and confirmed input source must reach a usable report."""
import copy
import hashlib
import pytest
from conftest import Actor
from server.store import digest, encode

QUESTION='2024-Q1毛利率和经营现金流是多少'

def imported(actor, *, filename='confirmed.csv', cost='8', cash='', target=None):
    content=('季度,营业收入,营业成本,经营现金流\n2024-Q1,10,'+cost+','+cash+'\n2024-Q2,12,10,\n').encode('utf-8')
    fields={'company':'报告闭环合成企业','amount_unit':'wan','basis':'standalone_quarter'}
    if target:fields.update(target_id=target['id'],target_version=str(target['version']),merge_mode='replace')
    response=actor.post('/workspace/imports/file',data=fields,files={'file':(filename,content,'text/csv')})
    assert response.status_code==201,response.text
    stage=response.json()
    saved=actor.post('/workspace/imports/'+stage['id']+'/commit',json={'version':stage['version'],'fingerprint':stage['payload']['fingerprint']})
    assert saved.status_code==201,saved.text
    return saved.json(),hashlib.sha256(content).hexdigest()

def report(actor,dataset,*,adaptive=True):
    body={'dataset_id':dataset['id'],'query':QUESTION,'use_llm':False}
    if adaptive:body['execution']={}
    p=actor.post('/workspace/plans',json=body);assert p.status_code==201,p.text
    p=p.json();r=actor.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']})
    assert r.status_code==202,r.text
    return actor.execute(r.json()),p

@pytest.mark.parametrize('adaptive',[False,True])
def test_direct_answer_missing_amount_and_confirmed_source_survive_both_report_engines(actor,adaptive):
    d,file_hash=imported(actor)
    r,p=report(actor,d,adaptive=adaptive)
    view=r['result'].get('readout')
    assert view, 'The report lost the original question-level answer.'
    facts={f['id']:f for f in view['facts']}
    assert facts['gross_margin']['value']==pytest.approx(.2)
    assert facts['cash_flow']['value'] is None and facts['cash_flow']['status']=='missing'
    assert facts['cash_flow']['unit']=='CNY' and facts['cash_flow']['period']=='2024-Q1'
    assert '经营现金流' in ' '.join(r['result']['findings'])
    source=view['input_source'];assert source['status']=='recorded'
    assert source['file']['sha256']==file_hash and source['file']['name']=='confirmed.csv'
    assert source['input_amount_unit']=='wan' and source['input_basis']=='standalone_quarter'
    assert source['dataset_version']==1 and source['dataset_hash']==d['content_hash']
    assert any(a['period']=='2024-Q1' and 'cash_flow' in a['fields'] for a in view['next_steps'])
    assert any(a['period']=='2023-Q1' and a['conditional'] for a in view['next_steps'])
    assert actor.get('/workspace/runs/'+r['id']+'/audit').json()['report_integrity']['valid']
    md=actor.get('/runs/'+r['id']+'/export?format=md').text
    front=md.split('## 技术附录',1)[0]
    for expected in ['本次问题的回答','经营现金流','未提供','confirmed','万元','单季度',file_hash,'下一步','2023']:
        assert expected in front,expected
    assert '```json' not in front and 'cash_flow' in md.split('## 技术附录',1)[1]
    assert actor.get('/runs/'+r['id']+'/export?format=json').json()['readout']==view


def test_new_import_does_not_replace_old_report_source_or_missing_answer(actor):
    d,original_hash=imported(actor,filename='original.csv')
    r,_=report(actor,d);original=copy.deepcopy(r['result'])
    changed,_=imported(actor,filename='later.csv',cost='7',cash='2',target=d)
    assert changed['version']==2
    current=actor.get('/runs/'+r['id']).json()
    assert current['result']==original
    exported=actor.get('/runs/'+r['id']+'/export?format=json').json()
    assert exported['readout']['input_source']['file']['sha256']==original_hash
    assert exported['readout']['input_source']['file']['name']=='original.csv'
    assert next(f for f in exported['readout']['facts'] if f['id']=='cash_flow')['value'] is None
    assert 'later.csv' not in actor.get('/runs/'+r['id']+'/export?format=md').text
    other=Actor(actor.client)
    assert other.get('/runs/'+r['id']+'/export?format=md').status_code==404


def test_latest_file_cannot_be_attributed_to_retained_historical_quarter(actor):
    d,_=imported(actor)
    content=b'period,revenue,cost\n2024-Q2,13,10\n'
    p=actor.post('/workspace/imports/file',data={'company':d['payload']['company'],'amount_unit':'wan','basis':'standalone_quarter','target_id':d['id'],'target_version':'1','merge_mode':'merge'},files={'file':('only-q2.csv',content,'text/csv')})
    assert p.status_code==201,p.text
    p=p.json();d=actor.post('/workspace/imports/'+p['id']+'/commit',json={'version':p['version'],'fingerprint':p['payload']['fingerprint']}).json()
    r,_=report(actor,d)
    assert r['result']['readout']['input_source']['status']=='quarter_not_bound'
    assert r['result']['readout']['input_source']['input_amount_unit'] is None
    assert 'file' not in r['result']['readout']['input_source']
    assert 'only-q2.csv' not in actor.get('/runs/'+r['id']+'/export?format=md').text
    assert r['result']['readout']['facts'][0]['period']=='2024-Q1'

@pytest.mark.parametrize('damage',['wrong_hash','invalid_quarter_list','malformed_json','other_owner','missing_context','unknown_kind'])
def test_invalid_or_foreign_receipt_is_not_promoted_to_source(actor,damage):
    d,_=imported(actor);store=actor.client.app.state.store
    row=store.one('SELECT * FROM dataset_import_receipts WHERE dataset_id=?',(d['id'],))
    with store.transaction() as db:
        if damage=='wrong_hash':db.execute('UPDATE dataset_import_receipts SET content_hash=? WHERE dataset_id=?',('0'*64,d['id']))
        elif damage=='invalid_quarter_list':
            payload=row['payload'];payload['import_context']['added']=None
            db.execute('UPDATE dataset_import_receipts SET payload=?,content_hash=? WHERE dataset_id=?',(encode(payload),digest(payload),d['id']))
        elif damage in ('missing_context','unknown_kind'):
            payload=row['payload']
            if damage=='missing_context':payload['import_context']=None
            else:payload['source_kind']='unrecognized'
            db.execute('UPDATE dataset_import_receipts SET payload=?,content_hash=? WHERE dataset_id=?',(encode(payload),digest(payload),d['id']))
        elif damage=='malformed_json':db.execute('UPDATE dataset_import_receipts SET payload=? WHERE dataset_id=?',('{bad',d['id']))
    if damage=='other_owner':
        other=Actor(actor.client)
        with store.transaction() as db:db.execute('UPDATE dataset_import_receipts SET user_id=? WHERE dataset_id=?',(other.user['id'],d['id']))
    r,_=report(actor,d)
    source=r['result']['readout']['input_source']
    assert source['status'] in ('invalid','not_recorded') and 'file' not in source
    assert next(f for f in r['result']['readout']['facts'] if f['id']=='gross_margin')['value']==pytest.approx(.2)


def test_zero_amount_is_available_and_source_details_stay_local_to_saved_report(actor):
    d,_=imported(actor,cash='0')
    r,p=report(actor,d)
    f=next(f for f in r['result']['readout']['facts'] if f['id']=='cash_flow')
    assert f['value']==0 and f['status']=='available' and not f['reason']
    assert not any(s['fields']==['cash_flow'] for s in r['result']['readout']['next_steps'])
    assert 'confirmed.csv' not in encode(p['payload']['context'])
    assert p['payload']['snapshot']['input_source']==r['result']['readout']['input_source']


def test_actual_pre_readout_export_stays_legacy_without_current_source_backfill():
    import json
    from pathlib import Path
    from server.report_export import markdown_report
    path=Path(__file__).parent/'fixtures/legacy-first-use-report-00310c1d.json'
    raw=path.read_bytes()
    assert hashlib.sha256(raw).hexdigest()=='1b0f8c115365758868eff97a967f06739c41ea2147e71d74029791774545ef10'
    old=json.loads(raw);before=copy.deepcopy(old)
    assert 'readout' not in old
    markdown=markdown_report(old)
    assert old==before and '当时未记录' in markdown
    assert 'confirmed.csv' not in markdown and 'later.csv' not in markdown
    assert old['analysis']['metrics']['gross_margin']==pytest.approx(.2)
    assert old['analysis']['metrics']['cash_ratio'] is None


def test_import_quality_keeps_each_quarter_missing_even_without_structural_warnings(actor):
    d,_=imported(actor)
    quality=actor.get('/workspace/datasets/'+d['id']+'/quality').json()
    assert quality['warning_count']==0
    missing=[f for f in quality['findings'] if f['code']=='MISSING_FIELDS']
    assert {f['period'] for f in missing}=={'2024-Q1','2024-Q2'}
    assert all('cash_flow' in f['fields'] for f in missing)
    assert quality['field_coverage']['period']=='2024-Q2'
    assert quality['source_state']=='user_declared_not_verified'


def test_readout_copies_supported_frozen_amount_ratio_and_turnover_values_without_recalculation(example,monkeypatch):
    from server import analytics
    from server.report_readout import build_readout
    from server.metric_facts import AMOUNT_METRICS,RATIO_METRICS
    analysis=analytics.calculate(example)
    links=analytics.lineage(example,analysis)
    snapshot={'dataset':example,'research_scope':{'topics':list(analytics.METRIC_LABELS)},'preferences':{'amount_unit':'wan'},'citations':[]}
    before=copy.deepcopy((snapshot,analysis,links))
    monkeypatch.setattr(analytics,'calculate',lambda *args,**kwargs:pytest.fail('Presentation must never rerun the calculator'))
    view=build_readout(snapshot,analysis,links)
    current=next(p for p in analysis['series'] if p['period']==analysis['current_period'])
    for fact in view['facts']:
        key=fact['id'];expected=current.get(key) if key in AMOUNT_METRICS else analysis['metrics'].get(key)
        assert fact['value']==expected
        assert fact['unit']==('CNY' if key in AMOUNT_METRICS else 'ratio_points' if key=='margin_change' else 'ratio' if key in RATIO_METRICS else 'times')
    assert len(view['facts'])==len(analytics.METRIC_LABELS)
    assert (snapshot,analysis,links)==before

@pytest.mark.parametrize('unit,expected',[('yuan','0.01 元'),('wan','0.000001 万元'),('yi','0.0000000001 亿元')])
def test_readable_money_retains_cent_precision_across_display_units(unit,expected):
    from server.report_readout import display_number
    assert display_number(.01,'CNY',unit)==expected
    assert display_number(None,'CNY',unit)=='未提供'
    assert display_number(0,'CNY',unit)=='0 '+expected.rsplit(' ',1)[1]
