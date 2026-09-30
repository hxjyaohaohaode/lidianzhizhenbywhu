"""Synthetic fixtures only: repeat reporting, normalization and revision boundary checks."""
import io
import pytest
from openpyxl import Workbook
from conftest import Actor, editable
from server.imports import import_dataset


def good(response, code=201):
    assert response.status_code == code, response.text
    return response.json()


def create(actor):
    return good(actor.post('/datasets',json={'name':'原有经营台账','company':'测试制造企业',
        'notes':'吨，原始口径备注','source_url':'https://example.com/report',
        'periods':[{'period':'2025-Q1','revenue':100,'cost':80,'net_profit':8},
                   {'period':'2025-Q2','revenue':110,'cost':88,'net_profit':9}]}))


def preview(actor,row,body='2025-Q2,150,90\n2025-Q3,200,120',**fields):
    args={'company':row['payload']['company'],'target_id':row['id'],
          'target_version':str(row['version']),'merge_mode':'merge',**fields}
    return actor.post('/workspace/imports/file',data=args,files={
        'file':('最新报表.csv',('报告期,营业收入,营业成本\n'+body).encode(),'text/csv')})


def commit(actor,stage):
    return actor.post('/workspace/imports/'+stage['id']+'/commit',json={
        'version':stage['version'],'fingerprint':stage['payload']['fingerprint']})


def test_file_revision_retains_identity_links_history_and_missing_values(actor):
    row=create(actor)
    action=good(actor.post('/workspace/actions',json={'title':'核对季度现金流','acceptance':'核对原始现金流报表与季度口径','dataset_id':row['id'],'company':row['payload']['company']}))
    watch=good(actor.post('/services/watches',json={'title':'收入监测','dataset_id':row['id'],'metric':'revenue','operator':'gt','threshold':180.0}))
    stage=good(preview(actor,row))
    context=stage['payload']['import_context']
    assert context['added']==['2025-Q3'] and context['replaced']==['2025-Q2'] and context['retained']==['2025-Q1']
    assert good(actor.get('/datasets/'+row['id']),200)['version']==1
    revised=good(commit(actor,stage))
    assert revised['id']==row['id'] and revised['version']==2
    assert revised['payload']['name']==row['payload']['name']
    assert revised['payload']['notes']==row['payload']['notes']
    assert revised['payload']['source_url']==row['payload']['source_url']
    assert revised['payload']['periods'][0]==row['payload']['periods'][0]
    assert revised['payload']['periods'][1]['net_profit'] is None
    assert len(good(actor.get('/datasets'),200)['items'])==1
    assert good(actor.get('/workspace/actions'),200)['items'][0]['payload']['dataset_id']==action['payload']['dataset_id']
    tracking=good(actor.get('/services/tracking'),200)
    assert tracking['rules'][0]['id']==watch['id'] and tracking['rules'][0]['payload']['dataset_id']==row['id']
    assert [r['version'] for r in good(actor.get('/workspace/datasets/'+row['id']+'/revisions'),200)['items']]==[1,2]
    assert good(commit(actor,stage))['version']==2


def test_replace_shows_removal_and_stale_preview_does_not_overwrite(actor):
    row=create(actor);stage=good(preview(actor,row,'2025-Q2,120,90',merge_mode='replace'))
    assert stage['payload']['import_context']['removed']==['2025-Q1']
    good(actor.put('/datasets/'+row['id'],json=editable(row)),200)
    assert commit(actor,stage).status_code==409
    assert preview(actor,row).status_code==409
    assert len(good(actor.get('/datasets/'+row['id']),200)['payload']['periods'])==2
    row=good(actor.get('/datasets/'+row['id']),200)
    result=good(commit(actor,good(preview(actor,row,'2025-Q2,120,90',merge_mode='replace'))))
    assert [p['period'] for p in result['payload']['periods']]==['2025-Q2']


def test_revision_ownership_company_and_mode_are_explicit(actor,client):
    row=create(actor);other=Actor(client)
    assert preview(other,row).status_code==404
    assert preview(actor,row,company='其他企业').status_code==409
    for fields in ({'target_version':'0'},{'target_id':''},{'merge_mode':'guess'},{'basis':'guess'},{'amount_unit':'usd'}):
        assert preview(actor,row,**fields).status_code==422
    assert len(good(actor.get('/datasets'),200)['items'])==1


def test_cumulative_incoming_is_differenced_before_merge_and_unit_scaled_once(actor):
    row=create(actor)
    stage=good(preview(actor,row,'2025-Q1,1,0.8\n2025-Q2,3,2',basis='year_to_date',amount_unit='wan'))
    values=stage['payload']['dataset']['periods']
    assert values[0]['revenue']==10000 and values[1]['revenue']==20000
    assert values[1]['cost']==12000
    assert preview(actor,row,'2025-Q3,4,3',basis='year_to_date').status_code==422


def test_xlsx_accounting_normalization_visible_and_missing_not_zero(actor):
    book=Workbook();book.active.append(['报告期','营业收入','营业成本','净利润','经营活动产生的现金流量净额','资产总计','行业波动率'])
    book.active.append(['2025-Q1','1,234.50','800','(20.50)',None,2000,'12.5%'])
    data=io.BytesIO();book.save(data)
    response=actor.post('/workspace/imports/file',data={'company':'测试制造企业','amount_unit':'wan'},files={'file':('财务.xlsx',data.getvalue())})
    p=good(response)['payload'];period=p['dataset']['periods'][0]
    assert period['revenue']==12345000 and period['net_profit']==-205000 and period['cash_flow'] is None
    assert period['industry_volatility']==.125
    rules=' '.join(n['rule'] for n in p['import_context']['normalizations'])
    assert all(s in rules for s in ('千分位','括号转负数','百分比转比值','表头映射'))
    assert good(actor.get('/datasets'),200)['items']==[]


@pytest.mark.parametrize('value',['1,23','1.234,56','(20)-','--','—','1万元','1e3','=2*4','NaN','+20','100%'])
def test_ambiguous_or_unsafe_amounts_report_row_and_field(value):
    import csv
    stream=io.StringIO();writer=csv.writer(stream);writer.writerow(['period','revenue','cost']);writer.writerow(['2025-Q1',value,8])
    with pytest.raises(ValueError,match='第2行 revenue'):
        import_dataset('bad.csv',stream.getvalue().encode(),'测试企业')


def test_alias_collisions_and_missing_columns_rejected():
    with pytest.raises(ValueError,match='表头重复'):
        import_dataset('bad.csv','季度,报告期,营业收入,营业成本\n2025-Q1,2025-Q1,1,1'.encode(),'测试企业')
    with pytest.raises(ValueError,match='缺少必填列'):
        import_dataset('bad.csv','季度,营业收入\n2025-Q1,1'.encode(),'测试企业')


def test_merge_revalidates_forty_quarter_limit_without_mutating_original(actor):
    periods=[{'period':f'{2010+i//4}-Q{i%4+1}','revenue':100,'cost':80} for i in range(40)]
    row=good(actor.post('/datasets',json={'name':'长历史','company':'测试制造企业','periods':periods}))
    response=preview(actor,row,'2020-Q1,100,80')
    assert response.status_code==422
    saved=good(actor.get('/datasets/'+row['id']),200)
    assert saved['version']==1 and len(saved['payload']['periods'])==40


def test_new_file_import_rejects_merge_without_target(actor):
    response=actor.post('/workspace/imports/file',data={'company':'测试企业','merge_mode':'merge'},
        files={'file':('data.csv',b'period,revenue,cost\n2025-Q1,100,80')})
    assert response.status_code==422
    assert good(actor.get('/datasets'),200)['items']==[]
