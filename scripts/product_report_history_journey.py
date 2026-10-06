"""Native 21-report retrieval across the visible20-row boundary; no API writes.

The 201-row storage boundary is independently checked by API tests. This journey
creates every report through ordinary form and approval controls; no DB seeding,
changed page size, hidden activation, business retry or expanded timeout.
"""
from copy import deepcopy
import math
import re
import time
from urllib.parse import urlsplit
try:
    from .product_first_use_audit import FORM_MS, require_native_contract
    from .product_integrity_outcomes import _capture_response
    from .product_readout_oracles import observe_text_by_normal_scroll
except ImportError:
    from product_first_use_audit import FORM_MS, require_native_contract
    from product_integrity_outcomes import _capture_response
    from product_readout_oracles import observe_text_by_normal_scroll

COUNT=21
PERIOD='2024-Q4'
PASSWORD='Synthetic-only-audit-password-2026'


def query(number):return PERIOD+'毛利率是多少（历史找回第 '+str(number)+' 份）'


def expect_saved(run,plan,dataset,number):
    assert run['state'] in ('succeeded','degraded')
    assert run['user_id']==dataset['user_id'] and run['dataset_id']==dataset['id']
    assert run['result']['query']==run['payload']['query']==query(number)
    assert plan['payload']['request']['query']==query(number)
    assert plan['payload']['status']=='dispatched' and plan['payload']['run_id']==run['id']
    assert plan['payload']['max_calls']==0 and not plan['payload']['request']['use_llm']
    assert run['snapshot']['studio']['plan_id']==plan['id']
    assert run['result']['dataset_version']==run['snapshot']['dataset_version']==1
    assert run['result']['dataset_hash']==dataset['content_hash']
    result=run['result'];facts=result['readout']['facts']
    assert len(facts)==1 and facts[0]['id']=='gross_margin' and facts[0]['period']==PERIOD
    assert facts[0]['unit']=='ratio' and facts[0]['status']=='available'
    assert math.isclose(facts[0]['value'],.2,abs_tol=1e-12,rel_tol=0)
    assert [(x['path'],x['value'],x['unit']) for x in facts[0]['inputs']]==[
        ('periods/'+PERIOD+'/revenue',100000,'CNY'),('periods/'+PERIOD+'/cost',80000,'CNY')]
    assert result['llm']['state']=='not_requested' and result['llm']['calls']==[]


def expect_history(rows,originals,offset,limit):
    assert rows['total']==COUNT and rows['offset']==offset and rows['limit']==limit
    expected=list(reversed(originals))[offset:offset+limit]
    assert [r['id'] for r in rows['items']]==[r['run']['id'] for r in expected]
    assert rows['has_more'] is (offset+len(expected)<COUNT)
    for actual,source in zip(rows['items'],expected):
        assert actual['query']==source['run']['result']['query']
        assert actual['current_period']==PERIOD and actual['dataset_version']==1
        assert actual['source_impact']['state']=='current'


def expect_selection_rows(rows,number,run_id):
    assert len(rows)==5 and all(len(row)==2 for row in rows)
    values=dict(rows);assert len(values)==5
    assert values['研究问题']==query(number) and values['目标季度']==PERIOD
    assert values['数据修订']=='1' and values['报告标识']==run_id
    assert values['生成时间'] and values['生成时间']!='生成时间未记录'


def expect_margin_cells(cells):
    assert len(cells)==4 and cells[0]=='毛利率'
    assert all(re.fullmatch(r'20(?:\.0+)?%',value) for value in cells[1:3])
    assert re.fullmatch(r'0(?:\.0+)?\s*个百分点',cells[3])


def read_group(p,locator,required,label):
    assert locator.count()==1 and locator.is_visible()
    assert locator.locator('svg,pre,details:not([open]),[hidden]').count()==0
    rendered=locator.inner_text();assert all(t in rendered for t in required)
    text=locator.text_content().strip();assert text
    observe_text_by_normal_scroll(p,locator,text,label)


def read_selection_source(p,box,title,number,run_id):
    """Read actual headings and complete field/value rows inside their own clip.

    A range spanning the outer section includes the entire nested table box,
    not just its text, and does not check that table's inner scroll-container clip.
    Keep the full source oracle and associate every row with its card and columns.
    """
    assert box.count()==1 and box.is_visible()
    assert box.locator('svg,pre,details:not([open]),[hidden]').count()==0
    heading=box.locator(':scope > h3');assert heading.count()==1 and heading.inner_text().strip()==title
    table=box.locator('table');assert table.count()==1
    header=table.locator('thead tr');assert header.count()==1
    headers=header.locator('th').all()
    columns=[cell.inner_text().strip() for cell in headers]
    assert columns==['保存范围','原始内容'] and all(cell.get_attribute('scope')=='col' for cell in headers)
    row_locators=table.locator('tbody tr').all()
    rows=[[cell.inner_text().strip() for cell in row.locator('td').all()] for row in row_locators]
    expect_selection_rows(rows,number,run_id)
    label='核对所选第'+str(number)+'份报告来源、修订和完整标识：'+title
    read_group(p,heading,[title],label+'标题')
    read_group(p,header,columns,label+'表头')
    readings=[]
    for index,(row,cells) in enumerate(zip(row_locators,rows),1):
        row_label=label+'，保存范围 / 原始内容，第'+str(index)+'行：'+cells[0]
        read_group(p,row,cells,row_label)
        readings.append({'row':index,'field':cells[0],'value':cells[1],'reading_label':row_label})
    p.observations.setdefault('report_selection_sources',[]).append({
        'title':title,'report_id':run_id,'columns':columns,'heading_label':label+'标题',
        'header_label':label+'表头','rows':readings,'manual_pixel_review':'pending'})


def read_answer(p,number):
    section=p.visible('#run-tab-summary [data-report-readout]')
    read_group(p,section.locator(':scope > p.preserve-lines'),[query(number)],'阅读第'+str(number)+'份原问题')
    facts=section.locator('table').nth(0)
    read_group(p,facts.locator('tbody tr'),[PERIOD,'毛利率','20%','10 万元','8 万元'],'阅读原20%和人民币输入')
    source=section.locator('table').nth(1)
    selected=source.locator('tbody tr').filter(has=p.page.get_by_text('目标季度 / 数据修订',exact=True))
    read_group(p,selected,[PERIOD+' / 1'],'阅读原目标季度与数据修订')


def record_rate_limit(p,response,failures):
    """Retain actual rejections, including ones that cannot justify a reread."""
    if response.status!=429:return
    row={'method':response.request.method,'url':response.url,
         'path':urlsplit(response.url).path,'status':response.status,
         'retry_after':response.headers.get('retry-after'),
         'received_monotonic':time.monotonic()}
    failures.append(row)
    p.observations.setdefault('report_read_rate_limits',[]).append(row)
    try:row['body']=response.json()
    except Exception as exc:row['body_parse_error']=type(exc).__name__


def is_current_run_read(row,base_url,run_id):
    url,base=urlsplit(row['url']),urlsplit(base_url)
    return (row['method']=='GET' and (url.scheme,url.netloc)==(base.scheme,base.netloc)
        and not url.query and not url.fragment and url.path in {
            '/api/workspace/runs/'+run_id+'/'+part for part in ('audit','reviews','runtime')})


def expect_read_rate_limit(row,base_url,run_id):
    """Only a current-run GET and its complete server contract allow recovery."""
    assert row['status']==429 and is_current_run_read(row,base_url,run_id)
    header=row.get('retry_after')
    assert isinstance(header,str) and re.fullmatch(r'[1-9][0-9]*',header)
    seconds=int(header)
    assert 1<=seconds<=60, 'Retry-After must fit the unchanged 60-second window.'
    body=row.get('body');assert isinstance(body,dict)
    error=body.get('error');assert isinstance(error,dict) and error.get('code')=='RATE_LIMITED'
    assert type(error.get('retry_after_seconds')) is int and error['retry_after_seconds']==seconds
    assert error.get('message')==('请求过于频繁，本次请求已被暂时拒绝。请等待 '+str(seconds)
        +' 秒后再手动重试；期间其他请求可能占用可用名额。')
    assert isinstance(row['received_monotonic'],(int,float)) and math.isfinite(row['received_monotonic'])
    return seconds


def expect_current_run(p,run_id):
    current,base=urlsplit(p.page.url),urlsplit(p.base_url)
    assert (current.scheme,current.netloc)==(base.scheme,base.netloc) and current.fragment=='agents:run-'+run_id, 'Reread must stay on the accepted run.'


def read_created_report(p,run_id,number,failures,mutations):
    """Follow the existing visible reread only after a genuine same-run GET429.

    Each new rejection needs its own response-derived boundary and visible
    explanation. No helper GET, mutation replay, forced429 or timeout expansion.
    The caller's original 300-second process budget remains authoritative.
    """
    readout=p.page.locator('#run-tab-summary [data-report-readout]')
    heading=p.page.locator('#main > .page-heading h1').filter(has_text=re.compile(r'^读取未完成$'))
    original_mutations=deepcopy(mutations)
    consumed=0;attempt=None
    while True:
        readout.or_(heading).first.wait_for(state='visible',timeout=FORM_MS)
        expect_current_run(p,run_id)
        assert mutations==original_mutations, 'Read recovery must not produce any mutation.'
        fresh=failures[consumed:];consumed=len(failures)
        assert all(row['method']=='GET' for row in fresh), 'A write rejection cannot be recovered by replay.'
        matched=[row for row in fresh if is_current_run_read(row,p.base_url,run_id)]
        if readout.is_visible():
            assert not matched, 'A rejected current read must not be treated as a successful report.'
            assert readout.count()==1
            if attempt:attempt.update(outcome='readout_restored',recovery_exercised=True)
            return
        assert matched, 'The rendered failure has no fresh same-run GET429 recovery authority.'
        boundaries=[row['received_monotonic']+expect_read_rate_limit(row,p.base_url,run_id) for row in matched]
        message=p.visible('#main > .notice.danger > span')
        actual_message=message.inner_text().strip()
        assert actual_message in [row['body']['error']['message'] for row in matched]
        subtitle=p.visible('#main > .page-heading p')
        assert subtitle.inner_text().strip()=='没有使用缓存或模拟数据替代失败的结果。'
        retry=p.visible('#main > button[data-action="refresh"]')
        assert retry.inner_text().strip()=='重新读取' and retry.is_enabled()
        assert p.page.locator('#run-tab-summary, [data-report-unverified]').count()==0
        if attempt:attempt['outcome']='another_read_rejected'
        attempt={'report_number':number,'run_id':run_id,'failures':deepcopy(matched),
                 'rendered_message':actual_message,'retry_after_boundary_monotonic':max(boundaries),
                 'outcome':'read_failed','recovery_exercised':False,'manual_pixel_review':'pending'}
        p.observations.setdefault('report_read_recoveries',[]).append(attempt)
        for target,text,label in ((heading,'读取未完成','失败标题'),
                (subtitle,subtitle.inner_text().strip(),'失败说明'),(message,actual_message,'实际限流原因与等待说明'),
                (retry,'重新读取','现有手动重新读取按钮')):
            read_group(p,target,[text],'阅读第'+str(number)+'份报告'+label)

        def reread():
            nonlocal consumed
            # Time spent reading and taking evidence counts towards the boundary.
            attempt['wait_milliseconds']=[]
            while True:
                late=failures[consumed:];consumed=len(failures)
                assert all(row['method']=='GET' for row in late), 'A write rejection cannot be recovered by replay.'
                for row in late:
                    if is_current_run_read(row,p.base_url,run_id):
                        boundary=row['received_monotonic']+expect_read_rate_limit(row,p.base_url,run_id)
                        attempt['retry_after_boundary_monotonic']=max(attempt['retry_after_boundary_monotonic'],boundary)
                        attempt['failures'].append(deepcopy(row))
                remaining=max(0,attempt['retry_after_boundary_monotonic']-time.monotonic())
                if not remaining:break
                attempt['wait_milliseconds'].append(remaining*1000)
                p.page.wait_for_timeout(remaining*1000)
            expect_current_run(p,run_id)
            assert mutations==original_mutations
            assert heading.is_visible() and message.inner_text().strip()==actual_message
            assert retry.is_visible() and retry.is_enabled()
            with p.page.expect_response(lambda r:is_current_run_read(
                    {'method':r.request.method,'url':r.url},p.base_url,run_id),timeout=FORM_MS):
                retry.click()
            attempt['outcome']='reread_clicked'
        p.step('等待实际Retry-After边界后手动重新读取同一份已保存报告',reread)


def create_report(p,dataset,number,mutations):
    """Group only repeated native controls; raw trace/video preserve all actions."""
    def action():
        p.visible('#sidebar button[data-route="agents"]').click()
        form=p.visible('#plan-form');form.locator('[name="query"]').fill(query(number))
        assert not p.visible('#use-llm').is_checked()
        status,plan=_capture_response(p,'POST','/api/workspace/plans',lambda:p.submit_form(p.page,'#plan-form'))
        assert status==201 and plan['payload']['max_calls']==0
        approval=p.visible('#execute-plan-form')
        assert approval.get_attribute('data-id')==plan['id']
        assert approval.locator('[name="external_consent"]').count()==0
        assert '本计划不会调用外部模型' in approval.inner_text()
        p.screenshot('approval-'+str(number))
        failures=[]
        def rejected(response):record_rate_limit(p,response,failures)
        p.page.on('response',rejected)
        try:
            status,accepted=_capture_response(p,'POST','/api/workspace/plans/'+plan['id']+'/execute',lambda:p.submit_form(p.page,'#execute-plan-form'))
            assert status==202
            read_created_report(p,accepted['id'],number,failures,mutations)
        finally:p.page.remove_listener('response',rejected)
        run=p.get('/api/runs/'+accepted['id']);frozen=p.get('/api/workspace/plans/'+plan['id'])
        expect_saved(run,frozen,dataset,number)
        assert p.get('/api/workspace/runs/'+run['id']+'/audit')['report_integrity']['valid']
        return {'run':deepcopy(run),'plan':deepcopy(frozen)}
    return p.step('通过实际表单和零外部调用审批保存第'+str(number)+'份报告',action)


def next_page(p):
    nav=p.visible('#main').locator('nav[aria-label="报告历史分页"]').first
    p.step('从可见分页进入较早报告',lambda:nav.get_by_role('button',name='下一页',exact=True).click())
    p.page.get_by_text('21–21 / 21 份',exact=True).wait_for()


def report_history_journey(p,*,repository_root,data_dir,expected_web_tree,expected_server_tree):
    require_native_contract(p,repository_root=repository_root,data_dir=data_dir,expected_web_tree=expected_web_tree,expected_server_tree=expected_server_tree)
    mutations=[]
    def record(request):
        if request.method not in ('GET','HEAD','OPTIONS'):
            path=urlsplit(request.url).path
            if path.startswith('/api/'):
                mutations.append({'method':request.method,'path':path})
    p.page.on('request',record)
    try:
        p.bootstrap();owner=p.get('/api/auth/me')['user'];dataset=p.get('/api/datasets/'+p.dataset_id)
        assert p.get('/api/runs')['items']==[]
        originals=[create_report(p,dataset,number,mutations) for number in range(1,COUNT+1)]
        assert len({r['run']['id'] for r in originals})==len({r['plan']['id'] for r in originals})==COUNT
        read_answer(p,COUNT)
        p.navigate('reports');p.page.get_by_text('1–20 / 21 份',exact=True).wait_for()
        assert p.page.locator('#main .title-button').count()==20
        assert p.page.locator('#main [data-route="agents:run-'+originals[0]['run']['id']+'"]').count()==0
        scope='?identity_id=&dataset_id='+dataset['id']
        expect_history(p.get('/api/workspace/reports'+scope+'&offset=0&limit=20'),originals,0,20)
        next_page(p)
        oldest=p.visible('#main [data-route="agents:run-'+originals[0]['run']['id']+'"]')
        read_group(p,oldest.locator('span'),[query(1)],'阅读第二页最初保存的问题')
        assert p.page.locator('#main .title-button').count()==1
        expect_history(p.get('/api/workspace/reports'+scope+'&offset=20&limit=20'),originals,20,20)
        p.step('打开最初报告查看冻结原值',lambda:oldest.click());read_answer(p,1)
        p.step('浏览器Back回到原第二页',lambda:p.page.go_back(wait_until='domcontentloaded'))
        p.page.get_by_text('21–21 / 21 份',exact=True).wait_for()
        p.step('刷新仍保持报告第二页',lambda:p.page.reload(wait_until='domcontentloaded'))
        p.page.get_by_text('21–21 / 21 份',exact=True).wait_for()
        p.click('#main [data-action="report-compare-dialog"]',after='#report-compare-form',label='在只有一份报告的末页打开跨页对比')
        form=p.visible('#report-compare-form')
        assert form.locator('[name="left"] option').count()==COUNT
        p.step('明确选择最早与最新两份保存报告',lambda:(form.locator('[name="left"]').select_option(originals[0]['run']['id']),form.locator('[name="right"]').select_option(originals[-1]['run']['id'])))
        boxes=form.locator('#report-selection-details > .two-columns > section');assert boxes.count()==2
        for box,title,number in zip(boxes.all(),('基准报告','对照报告'),(1,COUNT)):
            read_selection_source(p,box,title,number,originals[number-1]['run']['id'])
        status,comparison=_capture_response(p,'GET','/api/workspace/reports/compare',lambda:p.submit('#report-compare-form',after='#report-comparison table'))
        assert status==200 and comparison['left']==originals[0]['run']['id'] and comparison['right']==originals[-1]['run']['id']
        assert comparison['same_period'] and comparison['left_period']==comparison['right_period']==PERIOD
        margin=next(x for x in comparison['changes'] if x['metric']=='gross_margin')
        assert margin['before']==margin['after']==.2 and margin['delta']==0
        delta=p.visible('#report-comparison').locator('tbody tr').filter(has=p.page.get_by_text('毛利率',exact=True))
        expect_margin_cells([cell.inner_text().strip() for cell in delta.locator('td').all()])
        read_group(p,delta,['毛利率','20%','0 个百分点'],'阅读同季度两份真实保存结果的零百分点差异')
        p.click('#modal [data-action="close-modal"]',label='关闭比较保留原报告列表')
        p.click('#sidebar [data-action="logout"]',after='#auth-form')
        if p.page.locator('#auth-form [name="name"]').count():p.click('[data-action="auth-toggle"]',after='#auth-form')
        p.fill('#auth-form [name="email"]',owner['email']);p.fill('#auth-form [name="password"]',PASSWORD,'重新登录同一合成账户')
        p.submit('#auth-form',after='#main');p.navigate('reports');p.page.get_by_text('1–20 / 21 份',exact=True).wait_for();next_page(p)
        oldest=p.visible('#main [data-route="agents:run-'+originals[0]['run']['id']+'"]')
        read_group(p,oldest.locator('span'),[query(1)],'重新登录后仍找回最初原报告')
        for original in originals:
            assert p.get('/api/runs/'+original['run']['id'])==original['run']
            assert p.get('/api/workspace/plans/'+original['plan']['id'])==original['plan']
        assert p.get('/api/datasets/'+dataset['id'])==dataset
        assert sum(x['method']=='POST' and x['path']=='/api/workspace/plans' for x in mutations)==COUNT
        assert sum(x['method']=='POST' and x['path'].endswith('/execute') for x in mutations)==COUNT
        p.observations['report_history']={'original_ids':[x['run']['id'] for x in originals],'all21_complete_objects_unchanged':True,'actual_report_creations':COUNT,'native_boundary':'20 visible rows to21 actual reports; 201 API storage boundary separate','oldest_opened':True,'back_and_reload_keep_page':True,'cross_page_comparison':'same quarter,20%versus20%,0percentage points','same_owner_relogin':True,
            'rate_limit_recovery_exercised':any(row['recovery_exercised'] for row in p.observations.get('report_read_recoveries',[]))}
        p.no_external()
    finally:p.page.remove_listener('request',record)
