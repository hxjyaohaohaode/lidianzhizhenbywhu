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


def source_reader_fixture(*,title='对照报告',number=21,damage=None):
    """Mock the native reader contract, including a stricter inner table clip."""
    from scripts.product_readout_oracles import _TEXT_GEOMETRY
    run_id='fa6753fe9f3a48d8a28840a21d82d2fa'
    rows=[['研究问题',journey.query(number)],['目标季度',journey.PERIOD],['数据修订','1'],
          ['生成时间','2026/10/05 18:13:30'],['报告标识',run_id]]
    if damage=='wrong_revision':rows[2][1]='2'
    elif damage=='short_id':rows[4][1]=run_id[:8]
    elif damage=='missing_time':rows[3][1]='生成时间未记录'
    elif damage=='missing_row':rows.pop(3)
    elif damage=='duplicate_field':rows[3][0]='数据修订'
    elif damage=='extra_cell':rows[4].append('未关联列')
    evaluated,scrolled,wheels,steps=[],[],[],[]

    class Collection:
        def __init__(self,nodes):self.nodes=nodes
        def count(self):return len(self.nodes)
        def all(self):return self.nodes

    class Node:
        def __init__(self,name,parts,children=None):
            self.name,self.parts,self.children=name,parts,children or {}
        def count(self):return 1
        def is_visible(self):return True
        def inner_text(self):return '\n'.join(self.parts)
        def text_content(self):return ''.join(self.parts)
        def get_attribute(self,name):
            assert name=='scope'
            return 'row' if damage=='wrong_column_scope' else 'col'
        def locator(self,selector):
            if selector=='svg,pre,details:not([open]),[hidden]':
                return Collection([self] if damage=='hidden_child' else [])
            return self.children[selector]
        def scroll_into_view_if_needed(self):scrolled.append(self.name)
        def evaluate(self,script,text):
            assert self.name not in ('section','table'), 'Do not measure a range across nested table boxes.'
            assert script==_TEXT_GEOMETRY and text==self.text_content().strip()
            evaluated.append((self.name,text))
            clip={'left':799.28125,'right':1259,'top':209,'bottom':947}
            right=1270 if damage=='inner_clipped_id' and self.name=='row-5' else 1220
            return {'found':True,'left':814,'right':right,'top':730,'bottom':755,
                    'clip':clip,'root':{'left':799.28125,'right':1259,'top':720,'bottom':770},
                    'visible':right<=clip['right']+1}

    columns=['保存范围','原始内容' if damage!='wrong_columns' else '当前内容']
    header=Node('header',columns,{'th':Collection([Node('column-'+str(i),[v]) for i,v in enumerate(columns)])})
    row_nodes=[Node('row-'+str(i),cells,{'td':Collection([Node('cell',[v]) for v in cells])})
               for i,cells in enumerate(rows,1)]
    table=Node('table',[],{'thead tr':header,'tbody tr':Collection(row_nodes)})
    heading=Node('heading',['基准报告' if damage=='wrong_title' else title])
    box=Node('section',[],{':scope > h3':heading,'table':table})
    def step(label,action):steps.append(label);return action()
    def settle(script):
        assert script=='() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    p=SimpleNamespace(observations={},step=step,evaluated=evaluated,scrolled=scrolled,wheels=wheels,steps=steps,
        page=SimpleNamespace(mouse=SimpleNamespace(move=lambda x,y:None,wheel=lambda dx,dy:wheels.append((dx,dy))),evaluate=settle))
    return p,box,rows,run_id


@pytest.mark.parametrize('title,number',[('基准报告',1),('对照报告',21)])
def test_source_reader_geometrically_reads_every_full_field_with_card_and_column_binding(title,number):
    p,box,rows,run_id=source_reader_fixture(title=title,number=number)
    journey.read_selection_source(p,box,title,number,run_id)
    assert p.scrolled==['heading','header']+['row-'+str(i) for i in range(1,6)]
    assert p.evaluated==[('heading',title),('header','保存范围原始内容')]+[
        ('row-'+str(i),''.join(cells)) for i,cells in enumerate(rows,1)]
    assert not p.wheels
    ranges=p.observations['visible_text_ranges']
    assert len(ranges)==7 and all(r['manual_pixel_review']=='pending' for r in ranges)
    by_label={r['label']:r for r in ranges}
    source=p.observations['report_selection_sources'][0]
    assert source['title']==title and source['report_id']==run_id
    assert source['columns']==['保存范围','原始内容']
    assert by_label[source['heading_label']]['text']==title
    assert by_label[source['header_label']]['text']=='保存范围原始内容'
    assert [(r['field'],r['value']) for r in source['rows']]==[tuple(row) for row in rows]
    for index,row in enumerate(source['rows'],1):
        assert row['row']==index and title in row['reading_label']
        assert '保存范围 / 原始内容' in row['reading_label']
        assert by_label[row['reading_label']]['text']==row['field']+row['value']
        assert by_label[row['reading_label']]['geometry'][0]['clip']['right']==1259


@pytest.mark.parametrize('damage',['wrong_revision','short_id','missing_time','missing_row','duplicate_field',
    'extra_cell','wrong_title','wrong_columns','wrong_column_scope','hidden_child'])
def test_source_reader_rejects_missing_or_misbound_semantics_before_any_geometry_read(damage):
    p,box,rows,run_id=source_reader_fixture(damage=damage)
    with pytest.raises(AssertionError):journey.read_selection_source(p,box,'对照报告',21,run_id)
    assert not p.evaluated and not p.observations


def test_source_reader_does_not_pass_full_id_hidden_by_inner_table_clip():
    p,box,rows,run_id=source_reader_fixture(damage='inner_clipped_id')
    # The ID ends at1270, inside outer modal1300 but outside inner table clip1259.
    with pytest.raises(AssertionError,match='bounded normal scroll'):
        journey.read_selection_source(p,box,'对照报告',21,run_id)
    assert len(p.wheels)==12
    assert 'report_selection_sources' not in p.observations
    assert all(run_id not in r['text'] for r in p.observations['visible_text_ranges'])
    assert p.evaluated[-12:]==[('row-5','报告标识'+run_id)]*12


@pytest.mark.parametrize('cells',[
    ['毛利率','20%','21%','0 个百分点'],['毛利率','','20%','0 个百分点'],
    ['毛利率','20%','','0 个百分点'],['毛利率','20%','20%','1 个百分点'],
    ['毛利率','20%','20%','0%'],['毛利率','20%','20%'],
])
def test_margin_reader_requires_both_individual_values_and_difference_unit(cells):
    journey.expect_margin_cells(['毛利率','20%','20%','0 个百分点'])
    with pytest.raises(AssertionError):journey.expect_margin_cells(cells)
