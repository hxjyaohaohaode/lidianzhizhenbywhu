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


BASE='http://synthetic.test'
RUN='accepted-synthetic-run'


def rate_limit_row(*,seconds=7,part='reviews',received=100):
    return {'method':'GET','url':BASE+'/api/workspace/runs/'+RUN+'/'+part,
        'path':'/api/workspace/runs/'+RUN+'/'+part,'status':429,'retry_after':str(seconds),
        'received_monotonic':received,'body':{'request_id':'actual-request-id','error':{
            'code':'RATE_LIMITED','retry_after_seconds':seconds,
            'message':f'请求过于频繁，本次请求已被暂时拒绝。请等待 {seconds} 秒后再手动重试；期间其他请求可能占用可用名额。'}}}


def response_for(row):
    return SimpleNamespace(status=row['status'],url=row['url'],request=SimpleNamespace(method=row['method']),
        headers={'retry-after':row.get('retry_after')},json=lambda:deepcopy(row['body']))


@pytest.mark.parametrize('part',['reviews','audit','runtime'])
@pytest.mark.parametrize('seconds',[1,7,60])
def test_recovery_contract_accepts_only_actual_window_bound_current_run_read(part,seconds):
    assert journey.expect_read_rate_limit(rate_limit_row(part=part,seconds=seconds),BASE,RUN)==seconds


@pytest.mark.parametrize('damage',[
    'post','put','delete','head','unrelated','other_run','other_origin','query','fragment',
    'wrong_status','missing_header','zero','negative','fraction','date','space','leading_zero','too_long',
    'missing_body','non_object_body','missing_error','non_object_error','wrong_code','string_seconds',
    'boolean_seconds','different_seconds','missing_seconds','wrong_message','missing_message','nonfinite_clock',
])
def test_recovery_contract_rejects_malformed_unrelated_and_write_responses(damage):
    row=rate_limit_row();error=row['body']['error']
    if damage in ('post','put','delete','head'):row['method']=damage.upper()
    elif damage=='unrelated':row['url']=BASE+'/api/sync'
    elif damage=='other_run':row['url']=row['url'].replace(RUN,'other-run')
    elif damage=='other_origin':row['url']=row['url'].replace(BASE,'https://unrelated.test')
    elif damage=='query':row['url']+='?extra=1'
    elif damage=='fragment':row['url']+='#extra'
    elif damage=='wrong_status':row['status']=409
    elif damage=='missing_header':row.pop('retry_after')
    elif damage in ('zero','negative','fraction','date','space','leading_zero','too_long'):
        row['retry_after']={'zero':'0','negative':'-1','fraction':'1.5','date':'Mon, 05 Oct 2026 23:00:00 GMT',
            'space':' 7','leading_zero':'07','too_long':'61'}[damage]
    elif damage=='missing_body':row.pop('body')
    elif damage=='non_object_body':row['body']=[]
    elif damage=='missing_error':row['body'].pop('error')
    elif damage=='non_object_error':row['body']['error']=[]
    elif damage=='wrong_code':error['code']='REPORT_INTEGRITY_FAILED'
    elif damage=='string_seconds':error['retry_after_seconds']='7'
    elif damage=='boolean_seconds':error['retry_after_seconds']=True
    elif damage=='different_seconds':error['retry_after_seconds']=8
    elif damage=='missing_seconds':error.pop('retry_after_seconds')
    elif damage=='wrong_message':error['message']='报告已损坏，请创建新报告'
    elif damage=='missing_message':error.pop('message')
    elif damage=='nonfinite_clock':row['received_monotonic']=float('nan')
    with pytest.raises(AssertionError):journey.expect_read_rate_limit(row,BASE,RUN)


def test_response_observer_preserves_rejections_and_malformed_body_without_relabeling(monkeypatch):
    monkeypatch.setattr(journey.time,'monotonic',lambda:123.5)
    p=SimpleNamespace(observations={});failures=[]
    success=rate_limit_row();success['status']=200
    journey.record_rate_limit(p,response_for(success),failures)
    assert not failures and not p.observations
    rejected=rate_limit_row();rejected['method']='POST'
    journey.record_rate_limit(p,response_for(rejected),failures)
    assert failures[0]['body']==rejected['body'] and failures[0]['status']==429
    assert failures[0]['received_monotonic']==123.5
    malformed=response_for(rate_limit_row())
    def invalid_json():raise ValueError('synthetic invalid JSON')
    malformed.json=invalid_json
    journey.record_rate_limit(p,malformed,failures)
    assert failures[1]['body_parse_error']=='ValueError' and 'body' not in failures[1]
    assert p.observations['report_read_rate_limits']==failures


def recovery_fixture(monkeypatch,*,initial=None,outcomes=None,damage=None,reading_elapsed=0,now=100):
    """Inert protocol/geometry doubles; no browser, server or business writes."""
    from scripts.product_readout_oracles import _TEXT_GEOMETRY
    initial=[rate_limit_row()] if initial is None else deepcopy(initial)
    outcomes=list(outcomes if outcomes is not None else [[]])
    clock={'now':now};monkeypatch.setattr(journey.time,'monotonic',lambda:clock['now'])
    state={'phase':'failed' if initial or damage=='no_response' else 'success','clicks':0,
        'message':rate_limit_row()['body']['error']['message'],'waiting':None,'late':None}
    candidates=[r for r in initial if journey.is_current_run_read(r,BASE,RUN) and isinstance(r.get('body'),dict)]
    if candidates:state['message']=candidates[0]['body'].get('error',{}).get('message','')
    failures=initial;mutations=[{'method':'POST','path':'/api/workspace/plans/synthetic/execute'}]
    reads=[];waits=[];timeouts=[];steps=[];wheels=[]

    class Empty:
        def count(self):return 0

    class Node:
        def __init__(self,name):self.name=name
        @property
        def first(self):return self
        def filter(self,**kwargs):
            assert self.name=='heading' and kwargs['has_text'].pattern=='^读取未完成$'
            return self
        def or_(self,other):assert (self.name,other.name)==('readout','heading');return Node('either')
        def count(self):
            if self.name=='forbidden':return int(damage=='corrupt_card')
            return int(self.is_visible())
        def is_visible(self):
            if self.name=='either':return True
            if self.name=='readout':return state['phase']=='success'
            return state['phase']=='failed' and not (damage=='missing_button' and self.name=='retry')
        def is_enabled(self):return damage!='disabled_button'
        def wait_for(self,*,state='visible',timeout=journey.FORM_MS):
            timeouts.append(timeout);assert timeout==10_000
            if not self.is_visible():raise TimeoutError(self.name+' not visible')
        def inner_text(self):
            text={'heading':'读取未完成','subtitle':'没有使用缓存或模拟数据替代失败的结果。',
                'message':state['message'],'retry':'重新读取'}.get(self.name,'')
            if damage=='different_notice' and self.name=='message':return '其他错误'
            if damage=='different_subtitle' and self.name=='subtitle':return '已显示缓存结果'
            if damage=='different_button' and self.name=='retry':return '重新执行'
            return text
        def text_content(self):return self.inner_text()
        def locator(self,selector):
            assert selector=='svg,pre,details:not([open]),[hidden]'
            return self if damage=='hidden_notice' and self.name=='message' else Empty()
        def scroll_into_view_if_needed(self):pass
        def evaluate(self,script,text):
            assert script==_TEXT_GEOMETRY and text==self.inner_text()
            reads.append((self.name,text))
            visible=damage!='clipped_notice' or self.name!='message'
            return {'found':True,'left':10,'right':400,'top':10,'bottom':30,
                'clip':{'left':0,'right':500,'top':0,'bottom':500},
                'root':{'left':0,'right':500,'top':0,'bottom':100},'visible':visible}
        def click(self):
            assert self.name=='retry' and state['waiting'] is not None
            state['clicks']+=1
            if damage=='mutation_on_click':mutations.append({'method':'POST','path':'/api/workspace/plans'})
            if damage=='new_run_on_click':page.url=BASE+'/#agents:run-another-run'
            batch=outcomes.pop(0)
            if batch:
                state['phase']='failed';state['message']=batch[0]['body']['error']['message']
                for row in batch:
                    response=response_for(row)
                    journey.record_rate_limit(p,response,failures)
                    state['waiting']['seen']|=state['waiting']['predicate'](response)
            else:
                state['phase']='success'
                response=response_for({**rate_limit_row(),'status':200})
                state['waiting']['seen']|=state['waiting']['predicate'](response)

    class ResponseContext:
        def __init__(self,predicate,timeout):self.state={'predicate':predicate,'seen':False};timeouts.append(timeout)
        def __enter__(self):state['waiting']=self.state;return self
        def __exit__(self,*args):
            state['waiting']=None
            if args[0] is None and not self.state['seen']:raise TimeoutError('No current-run GET response')

    nodes={name:Node(name) for name in ('heading','subtitle','message','retry','readout','forbidden')}
    selectors={'#run-tab-summary [data-report-readout]':'readout','#main > .page-heading h1':'heading',
        '#main > .page-heading p':'subtitle','#main > .notice.danger > span':'message',
        '#main > button[data-action="refresh"]':'retry','#run-tab-summary, [data-report-unverified]':'forbidden'}
    def wait(ms):
        assert ms>0;waits.append(ms);clock['now']+=ms/1000
        if damage=='navigation_while_waiting':page.url=BASE+'/#reports'
        if damage=='mutation_while_waiting':mutations.append({'method':'DELETE','path':'/api/workspace/plans/x'})
        if state['late']:
            row=state.pop('late');state['late']=None
            journey.record_rate_limit(p,response_for(row),failures)
    page=SimpleNamespace(url=BASE+'/#agents:run-'+RUN,locator=lambda selector:nodes[selectors[selector]],
        wait_for_timeout=wait,expect_response=lambda predicate,timeout:ResponseContext(predicate,timeout),
        mouse=SimpleNamespace(move=lambda x,y:None,wheel=lambda x,y:wheels.append((x,y))),evaluate=lambda script:None)
    def step(label,action):
        steps.append(label);clock['now']+=reading_elapsed
        return action()
    def visible(selector):node=page.locator(selector);node.wait_for();return node
    p=SimpleNamespace(page=page,base_url=BASE,visible=visible,step=step,observations={'report_read_rate_limits':deepcopy(failures)},
        get=lambda *a,**kw:pytest.fail('Recovery must never use/replay a helper GET'))
    return p,failures,mutations,SimpleNamespace(state=state,clock=clock,reads=reads,waits=waits,timeouts=timeouts,
        steps=steps,wheels=wheels)


def test_visible_recovery_reads_complete_failure_waits_actual_boundary_and_clicks_once(monkeypatch):
    p,failures,mutations,record=recovery_fixture(monkeypatch,reading_elapsed=.25)
    original=deepcopy(failures);writes=deepcopy(mutations)
    journey.read_created_report(p,RUN,21,failures,mutations)
    assert [name for name,text in record.reads]==['heading','subtitle','message','retry']
    assert record.reads[2][1]==original[0]['body']['error']['message']
    assert record.waits==[4750] and record.state['clicks']==1
    assert record.clock['now']==107 and mutations==writes and failures==original
    assert all(value==10_000 for value in record.timeouts)
    attempt,=p.observations['report_read_recoveries']
    assert attempt['failures']==original and attempt['recovery_exercised']
    assert attempt['run_id']==RUN and attempt['report_number']==21 and attempt['outcome']=='readout_restored'
    assert len(p.observations['visible_text_ranges'])==4


def test_elapsed_response_boundary_requires_no_extra_delay(monkeypatch):
    p,failures,mutations,record=recovery_fixture(monkeypatch,now=108)
    journey.read_created_report(p,RUN,21,failures,mutations)
    assert record.waits==[] and record.state['clicks']==1


def test_no_429_never_claims_or_performs_recovery(monkeypatch):
    p,failures,mutations,record=recovery_fixture(monkeypatch,initial=[])
    journey.read_created_report(p,RUN,21,failures,mutations)
    assert not record.waits and not record.state['clicks'] and not record.reads
    assert 'report_read_recoveries' not in p.observations


def test_repeat_rejection_needs_new_observed_same_run_boundary_before_next_click(monkeypatch):
    again=rate_limit_row(seconds=3)
    p,failures,mutations,record=recovery_fixture(monkeypatch,outcomes=[[again],[]])
    journey.read_created_report(p,RUN,21,failures,mutations)
    assert record.waits==[7000,3000] and record.state['clicks']==2
    first,second=p.observations['report_read_recoveries']
    assert first['outcome']=='another_read_rejected' and not first['recovery_exercised']
    assert second['outcome']=='readout_restored' and second['recovery_exercised']
    assert second['failures'][0]['received_monotonic']==107
    assert [row['status'] for row in failures]==[429,429]


def test_parallel_current_run_rejections_use_latest_actual_boundary(monkeypatch):
    initial=[rate_limit_row(seconds=3,part='audit'),rate_limit_row(seconds=7,part='reviews',received=101)]
    p,failures,mutations,record=recovery_fixture(monkeypatch,initial=initial)
    journey.read_created_report(p,RUN,21,failures,mutations)
    assert record.waits==[8000] and record.state['clicks']==1
    assert len(p.observations['report_read_recoveries'][0]['failures'])==2


def test_late_parallel_rejection_is_retained_and_its_new_boundary_observed(monkeypatch):
    p,failures,mutations,record=recovery_fixture(monkeypatch)
    record.state['late']=rate_limit_row(seconds=2,part='audit')
    journey.read_created_report(p,RUN,21,failures,mutations)
    assert record.waits==[7000,2000] and record.state['clicks']==1
    assert len(p.observations['report_read_recoveries'][0]['failures'])==2
    assert failures[-1]['received_monotonic']==107


def test_background_sync_rejection_is_retained_but_cannot_set_read_recovery_boundary(monkeypatch):
    unrelated=rate_limit_row(seconds=60);unrelated['url']=BASE+'/api/sync';unrelated['path']='/api/sync'
    p,failures,mutations,record=recovery_fixture(monkeypatch)
    record.state['late']=unrelated
    journey.read_created_report(p,RUN,21,failures,mutations)
    assert record.waits==[7000] and record.state['clicks']==1 and len(failures)==2
    assert len(p.observations['report_read_recoveries'][0]['failures'])==1


@pytest.mark.parametrize('kind',['unrelated','other_run','write','malformed','missing'])
def test_no_valid_current_read_rejection_never_waits_or_clicks(kind,monkeypatch):
    row=rate_limit_row()
    if kind=='unrelated':row['url']=BASE+'/api/sync'
    elif kind=='other_run':row['url']=row['url'].replace(RUN,'other-run')
    elif kind=='write':row['method']='POST'
    elif kind=='malformed':row['retry_after']='0'
    p,failures,mutations,record=recovery_fixture(monkeypatch,initial=[] if kind=='missing' else [row],damage='no_response')
    with pytest.raises(AssertionError):journey.read_created_report(p,RUN,21,failures,mutations)
    assert not record.waits and not record.state['clicks']
    assert not p.observations.get('report_read_recoveries')


@pytest.mark.parametrize('damage',['different_notice','different_subtitle','different_button','missing_button',
    'disabled_button','corrupt_card','hidden_notice','clipped_notice'])
def test_visible_failure_must_be_complete_readable_and_offer_existing_enabled_reread(damage,monkeypatch):
    p,failures,mutations,record=recovery_fixture(monkeypatch,damage=damage)
    with pytest.raises((AssertionError,TimeoutError)):journey.read_created_report(p,RUN,21,failures,mutations)
    assert not record.waits and not record.state['clicks']
    assert not any(row['recovery_exercised'] for row in p.observations.get('report_read_recoveries',[]))


@pytest.mark.parametrize('damage',['navigation_while_waiting','mutation_while_waiting','mutation_on_click','new_run_on_click'])
def test_recovery_rejects_context_change_or_any_new_mutation(damage,monkeypatch):
    p,failures,mutations,record=recovery_fixture(monkeypatch,damage=damage)
    with pytest.raises(AssertionError):journey.read_created_report(p,RUN,21,failures,mutations)
    assert record.state['clicks']==int(damage.endswith('on_click'))
    assert not p.observations['report_read_recoveries'][0]['recovery_exercised']


def test_rejected_read_cannot_count_as_success_when_readout_is_visible(monkeypatch):
    p,failures,mutations,record=recovery_fixture(monkeypatch)
    record.state['phase']='success'
    with pytest.raises(AssertionError,match='must not be treated as a successful report'):
        journey.read_created_report(p,RUN,21,failures,mutations)
    assert not record.state['clicks'] and not record.waits


def test_unrelated_response_after_click_does_not_authorize_second_click(monkeypatch):
    unrelated=rate_limit_row();unrelated['url']=BASE+'/api/sync'
    p,failures,mutations,record=recovery_fixture(monkeypatch,outcomes=[[unrelated]])
    with pytest.raises(TimeoutError,match='No current-run GET response'):
        journey.read_created_report(p,RUN,21,failures,mutations)
    assert record.state['clicks']==1 and record.waits==[7000]
    assert not p.observations['report_read_recoveries'][0]['recovery_exercised']


@pytest.mark.parametrize('execution_status',[202,429])
def test_creation_observer_precedes_execute_race_and_never_replays_mutations(execution_status,monkeypatch):
    calls=[];listeners={};recovery_calls=[];gets=[]
    class Control:
        def __init__(self,selector):self.selector=selector
        def click(self):pass
        def fill(self,value):assert value==journey.query(21)
        def is_checked(self):return False
        def locator(self,selector):return Control(selector)
        def count(self):assert self.selector=='[name="external_consent"]';return 0
        def get_attribute(self,name):assert name=='data-id';return 'plan-id'
        def inner_text(self):return '本计划不会调用外部模型'
    def on(name,callback):assert name=='response';listeners[name]=callback
    def remove(name,callback):assert listeners.pop(name) is callback
    page=SimpleNamespace(on=on,remove_listener=remove)
    plan={'id':'plan-id','payload':{'max_calls':0}}
    run={'id':RUN};dataset={'id':'dataset-id'};mutations=[]
    def capture(p,method,path,operation):
        assert method=='POST'
        calls.append(path);operation()
        if path=='/api/workspace/plans':return 201,deepcopy(plan)
        assert path=='/api/workspace/plans/plan-id/execute' and 'response' in listeners
        # The render's rejected GET may arrive before execute capture returns.
        row=rate_limit_row()
        if execution_status==429:row.update(method='POST',url=BASE+path,path=path)
        listeners['response'](response_for(row))
        return execution_status,{'id':RUN} if execution_status==202 else row['body']
    def recovered(p,run_id,number,failures,actual_mutations):
        assert (run_id,number,actual_mutations)==(RUN,21,mutations)
        assert len(failures)==1 and failures[0]['status']==429 and failures[0]['method']=='GET'
        recovery_calls.append(run_id)
    def get(path):
        gets.append(path)
        return {'/api/runs/'+RUN:run,'/api/workspace/plans/plan-id':plan,
            '/api/workspace/runs/'+RUN+'/audit':{'report_integrity':{'valid':True}}}[path]
    p=SimpleNamespace(page=page,observations={},visible=Control,get=get,step=lambda label,action:action(),
        screenshot=lambda name:None,submit_form=lambda page,selector:None)
    monkeypatch.setattr(journey,'_capture_response',capture)
    monkeypatch.setattr(journey,'read_created_report',recovered)
    monkeypatch.setattr(journey,'expect_saved',lambda r,pl,d,n:None)
    if execution_status==202:
        assert journey.create_report(p,dataset,21,mutations)=={'run':run,'plan':plan}
        assert recovery_calls==[RUN] and len(gets)==3
    else:
        with pytest.raises(AssertionError):journey.create_report(p,dataset,21,mutations)
        assert not recovery_calls and not gets
    assert calls==['/api/workspace/plans','/api/workspace/plans/plan-id/execute']
    assert not listeners and p.observations['report_read_rate_limits'][0]['status']==429
