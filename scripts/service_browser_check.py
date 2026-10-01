"""Dual-mode Chromium acceptance against an isolated local workspace.

--native uses genuine browser navigation, cookies, CSP and EventSource.
Default mode is explicitly a DOM + fixed HTTPX bridge, not native acceptance.
No browser policy or application security header is weakened for either mode.
"""
from __future__ import annotations
import argparse
import base64
import json
import os
import re
import time
import uuid
from collections import deque
from urllib.parse import urlsplit
from pathlib import Path
import httpx
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'evidence'


class FixtureRequestBudget:
    """Admission pacing for synthetic setup, never a retry of business requests.

    The application retains its original 600 non-auth API requests / minute.
    Reserve headroom before a bounded 200-record fixture plus its UI assertions.
    """
    def __init__(self, clock=time.monotonic):
        self.clock=clock;self.requests=deque()

    def record(self, url):
        path=urlsplit(url).path
        if path.startswith('/api/') and not path.startswith('/api/auth/'):
            self.requests.append(self.clock())

    def reserve(self, count, wait=time.sleep):
        if not 1 <= count <= 600:raise ValueError('Invalid fixture request reservation')
        start=self.clock();deadline=start+65
        while True:
            now=self.clock()
            while self.requests and self.requests[0]<=now-60:self.requests.popleft()
            if len(self.requests)+count<=600:return round(now-start,3)
            delay=max(.05,self.requests[0]+60.05-now)
            if now+delay>deadline:raise RuntimeError('Fixture request window did not settle within 65 seconds')
            wait(delay)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--native',action='store_true');args=parser.parse_args();native=args.native
    checks=[];errors=[];responses=[];screens=[];completed=False;api_budget=FixtureRequestBudget();fixture_budget_wait=0
    def record(label):checks.append(label);print('PASS',label,flush=True)
    with httpx.Client(base_url='http://127.0.0.1:8000',trust_env=False,timeout=30,event_hooks={'request':[lambda request:api_budget.record(str(request.url))]}) as client,sync_playwright() as p:
        launch={'headless':True};executable=os.getenv('CHROMIUM_PATH')
        if executable:launch['executable_path']=executable
        elif not native:launch['executable_path']='/usr/bin/chromium'
        b=p.chromium.launch(**launch)
        page=b.new_page(viewport={'width':1520,'height':1080},device_scale_factor=1)
        page.set_default_timeout(10000)
        if native:page.on('request',lambda request:api_budget.record(request.url))
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
        def call(payload):
            path=payload['path']
            if not path.startswith('/api/') or '://' in path or '..' in path:raise ValueError('Only same local API requests')
            kw={'headers':payload.get('headers',{})}
            if 'form' in payload:
                kw['data']={v['name']:v['text'] for v in payload['form'] if 'text' in v}
                kw['files']={v['name']:(v['filename'],base64.b64decode(v['data']),v['mime']) for v in payload['form'] if 'data' in v}
            else:kw['content']=payload.get('body')
            r=client.request(payload.get('method','GET'),path,**kw);responses.append({'method':payload.get('method','GET'),'path':path,'status':r.status_code})
            if r.status_code>=400 and r.status_code!=401:print('HTTP ERROR',r.status_code,path,r.text[:300],flush=True)
            return {'status':r.status_code,'body':r.text,'headers':dict(r.headers)}
        if native:
            page.on('response',lambda r:responses.append({'method':r.request.method,'path':r.url.split('127.0.0.1:8000')[-1],'status':r.status}) if '/api/' in r.url else None)
            landing=page.goto('http://127.0.0.1:8000',wait_until='domcontentloaded')
            assert landing and landing.status==200
        else:
            page.expose_function('__localApi',call)
            html=re.sub(r'<script[^>]*>.*?</script>','',(ROOT/'web/index.html').read_text(),flags=re.S);html=re.sub(r'<link[^>]*>','',html)
            page.set_content(html)
            page.add_style_tag(content='\n'.join((ROOT/'web'/f).read_text() for f in ['styles.css','adaptive.css','workbench.css']))
            page.evaluate('''() => { window.fetch=async(path,init={})=>{const input={path:String(path),method:init.method||'GET',headers:init.headers||{}};
            if(init.body instanceof FormData){input.form=[];for(const [name,value] of init.body.entries()){if(value instanceof File){const bytes=new Uint8Array(await value.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);input.form.push({name,filename:value.name,mime:value.type,data:btoa(binary)})}else input.form.push({name,text:String(value)})}}
            else input.body=init.body;const r=await window.__localApi(input);return new Response(r.body,{status:r.status,headers:r.headers})};}''')
            # Keep real ES module scopes through an import map, rather than flattening modules.
            imports={}
            for f in sorted((ROOT/'web/dist').glob('*.js')):
                source=re.sub(r"(['\"])\./([\w-]+)\.js\1",lambda m:m[1]+'lidian:'+m[2]+m[1],f.read_text())
                imports['lidian:'+f.stem]='data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
            page.add_script_tag(type='importmap',content=json.dumps({'imports':imports}))
            brand={'/assets/brand/logo.png':'data:image/png;base64,'+base64.b64encode((ROOT/'web/brand/logo.png').read_bytes()).decode(),'/assets/brand/loading-video.mp4':'data:video/mp4;base64,'+base64.b64encode((ROOT/'web/brand/loading-video.mp4').read_bytes()).decode()}
            page.evaluate("assets=>new MutationObserver(()=>document.querySelectorAll('img,video').forEach(el=>{const src=el.getAttribute('src');if(assets[src])el.src=assets[src]})).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']})",brand)
            page.add_script_tag(type='module',content="import 'lidian:app';")
        def submit(selector):
            page.locator(selector+' button[type="submit"]').click()
            page.wait_for_timeout(500)
            err=page.locator(selector+' .form-error')
            for i in range(err.count()):
                if err.nth(i).inner_text().strip():raise AssertionError(err.nth(i).inner_text())
        def go(route):
            page.evaluate('(r)=>location.hash=r',route)
            page.locator('#main[data-page="'+route.split(':')[0]+'"] h1').wait_for(timeout=12000)
            assert page.locator('#main h1').inner_text()!='读取未完成',page.locator('#main').inner_text()
        def snap(name,full_page=True):
            page.wait_for_timeout(250)
            page.screenshot(path=str(OUT/name),full_page=full_page);screens.append(name)
        def overflow():return page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
        def wait_box(selector, min_x=-1, max_x=None):
            # Poll geometry through Playwright's native locator, outside page eval.
            # wait_for_function compiles a string in page context and is correctly
            # rejected by this application's CSP (no unsafe-eval). Keep that CSP.
            deadline=time.monotonic()+5
            last=None
            while time.monotonic()<deadline:
                last=page.locator(selector).bounding_box()
                if last and last['x']>=min_x and (max_x is None or last['x']<max_x):
                    return last
                page.wait_for_timeout(50)
            raise AssertionError(f'{selector} did not enter expected viewport bounds: {last}')
        try:
            page.locator('#auth-form').wait_for(timeout=12000)
            if page.locator('[data-intro-skip]').count():page.locator('[data-intro-skip]').click()
            page.locator('[data-action="auth-toggle"]').click()
            page.locator('#auth-form [name="email"]').fill('service-dom-'+uuid.uuid4().hex+'@test.example')
            password='Synthetic-ui-acceptance-password-2026'
            page.locator('#auth-form [name="password"]').fill(password)
            page.locator('#auth-form [name="name"]').fill('验收专用用户')
            submit('#auth-form');page.locator('#main[data-page="brief"]').wait_for()
            if native:
                for cookie in page.context.cookies():client.cookies.set(cookie['name'],cookie['value'])
                session=next(c for c in page.context.cookies() if c['name']=='lidian_session')
                assert session['httpOnly'] and session['sameSite']=='Strict'
                assert "'unsafe-eval'" not in landing.headers.get('content-security-policy','')
                assert "script-src 'self'" in landing.headers.get('content-security-policy','')
                record('原生浏览器会话 HttpOnly/SameSite 与禁止 unsafe-eval 的实际 CSP')
            assert client.get('/api/datasets').json()['items']==[]
            record('注册后零业务数据，真实冷启动与登录');snap('ui-current-empty.png')
            initial=page.locator('#sidebar').bounding_box()['width']
            page.locator('[data-action="menu"]').click();page.wait_for_timeout(250)
            assert page.locator('#sidebar').bounding_box()['width']<initial-100
            assert page.locator('[data-action="menu"]').get_attribute('aria-expanded')=='false'
            record('桌面侧栏真实折叠，中央可用宽度增加，ARIA状态同步')
            page.locator('[data-action="menu"]').click();page.wait_for_timeout(250)
            page.locator('[data-action="show-assistant"]').click();page.wait_for_timeout(250)
            rail=page.locator('#assistant-rail');assert rail.is_visible()
            start=rail.bounding_box()['width'];page.locator('#assistant-resize').focus();page.keyboard.press('ArrowLeft');page.wait_for_timeout(250)
            assert rail.bounding_box()['width']>start
            page.locator('[data-action="close-assistant"]').click();assert not rail.is_visible()
            record('助手独立展开/收起与键盘调宽，不占用隐藏空间')
            go('services');page.locator('[data-x-action="identity-new"]').click()
            f='form[data-service-form="identity"]';page.locator(f+' [name="name"]').fill('经营负责人（合成验收）');page.locator(f+' [name="objective"]').fill('核对现金流与毛利差异，明确反向证据');page.locator(f+' [name="max_calls"]').fill('0')
            submit(f);page.locator('.identity-card').wait_for();page.locator('[data-x-action="identity-use"]').first.click();page.wait_for_timeout(400)
            assert page.locator('#active-identity').input_value()
            identity_id=page.locator('#active-identity').input_value();record('服务身份创建、选择、顶部上下文同步')
            go('brief');page.locator('#main [data-action="import-dialog"]').click()
            page.locator('#import-file-form [name="company"]').fill('验收合成企业（非真实财报）')
            csv='季度,营业收入,营业成本,经营现金流,净利润,总资产,总负债,期末净资产,期初净资产,库存金额,研发费用\n'
            for i in range(12):csv+=f'{2022+i//4}-Q{i%4+1},{100000+i*1200},{70000+i*600},{12000+i*100},9000,500000,200000,300000,290000,20000,3000\n'
            page.locator('#import-file-form [name="amount_unit"]').select_option('yuan')
            page.locator('#import-file-form [name="file"]').set_input_files({'name':'synthetic-service-test.csv','mimeType':'text/csv','buffer':csv.encode('utf-8-sig')})
            submit('#import-file-form');page.locator('[data-action="commit-stage"]').wait_for();assert client.get('/api/datasets').json()['items']==[]
            page.locator('[data-action="commit-stage"]').click();page.locator('#modal').wait_for(state='hidden');page.locator('#dataset-editor[data-version="1"]').wait_for();record('上传真实CSV：暂存不写正式库，确认后入库')
            # Revise an existing dataset through the visible file workflow. No
            # direct API write substitutes for preview, target choice or commit.
            original=client.get('/api/datasets').json()['items'][0]
            go('data');page.locator('#main [data-action="import-dialog"]').click()
            page.locator('#import-file-form [name="target_id"]').select_option(original['id'])
            page.locator('#import-file-form [name="merge_mode"]').select_option('merge')
            page.locator('#import-file-form [name="amount_unit"]').select_option('yuan')
            revision=csv.splitlines()[0]+'\n2024-Q4,120000,76600,13100,9000,500000,200000,300000,290000,20000,3000\n'
            page.locator('#import-file-form [name="file"]').set_input_files({'name':'synthetic-quarter-revision.csv','mimeType':'text/csv','buffer':revision.encode('utf-8-sig')})
            submit('#import-file-form');page.locator('[data-action="commit-stage"]').wait_for()
            before=client.get('/api/datasets').json()['items'];assert len(before)==1 and before[0]['version']==original['version']
            assert '合并到已有数据集' in page.locator('#modal').inner_text()
            page.locator('[data-action="commit-stage"]').click();page.locator('#modal').wait_for(state='hidden')
            page.locator('#dataset-editor[data-id="'+original['id']+'"][data-version="'+str(original['version']+1)+'"]').wait_for()
            revised=client.get('/api/datasets').json()['items'];assert len(revised)==1 and revised[0]['id']==original['id'] and revised[0]['version']==original['version']+1
            assert len(revised[0]['payload']['periods'])==12 and revised[0]['payload']['periods'][-1]['revenue']==120000
            record('文件修订显式选择合并，预览不写入，确认保留数据ID和历史季度')
            page.locator('[data-action="data-revisions"]').click();page.locator('#modal').wait_for(state='visible')
            history=page.locator('#modal .dialog-body > details')
            assert history.count()==2
            assert page.locator('#modal [data-action="restore-revision"]').count()==2
            history.first.locator('summary').first.click()
            assert history.first.locator('[data-action="restore-revision"]').is_visible()
            assert '完整性异常' not in page.locator('#modal').inner_text()
            assert all(x['integrity_valid'] for x in client.get('/api/workspace/datasets/'+original['id']+'/revisions').json()['items'])
            snap('ui-current-revisions.png')
            page.locator('#modal [data-action="close-modal"]').click();page.locator('#modal').wait_for(state='hidden')
            assert client.get('/api/datasets/'+original['id']).json()['version']==revised[0]['version']
            record('修订记录可读并显示通过校验的历史恢复入口；查看和关闭不改数据版本')
            go('copilot');page.locator('#assistant-query').fill('核查毛利现金流的来源与数据质量，查看已保存证据')
            submit('#assistant-form');page.locator('.chat-turn').wait_for();assert page.locator('.fact-tile').count()>=2
            assert '数据质量' in page.locator('#assistant-answer').inner_text();assert page.locator('.tool-receipts').count()==1
            record('持久会话调用财务、血缘、质量及证据工具，有真实返回与输入修订')
            page.locator('[data-x-action="chat-trace"]').first.click()
            page.locator('.trace-container .assistant-fact').first.wait_for()
            assert page.locator('.trace-container .trace-list li').count()>0
            record('同一研究会话可追踪实际公式、季度输入及证据范围')
            previous=page.locator('#role-switch').element_handle()
            page.locator('#role-switch').select_option('advisor')
            previous.wait_for_element_state('hidden')
            assert page.locator('#role-switch').input_value()=='advisor'
            assert client.get('/api/auth/me').json()['user']['preferences']['role']=='advisor'
            page.locator('.chat-turn').first.wait_for()
            previous=page.locator('#role-switch').element_handle()
            page.locator('#role-switch').select_option('enterprise')
            previous.wait_for_element_state('hidden')
            assert page.locator('#role-switch').input_value()=='enterprise'
            assert client.get('/api/auth/me').json()['user']['preferences']['role']=='enterprise'
            page.locator('.chat-turn').first.wait_for()
            record('同一账户切换研究视角并持久化；已有会话仍可读取')
            page.locator('#assistant-query').fill('继续展开刚才的现金流依据');submit('#assistant-form')
            assert page.locator('.chat-turn').count()==2;record('连续追问保留会话，不是覆盖单条固定回复')
            page.locator('#assistant-query').fill('市场占有率是多少');submit('#assistant-form')
            page.locator('.chat-turn').nth(2).wait_for()
            assert page.locator('.chat-turn').count()==3
            assert page.locator('.chat-turn').last.locator('.fact-tile').count()==0
            assert '未匹配可计算' in page.locator('.chat-turn').last.inner_text()
            record('未知研究问题明确能力边界，不用毛利或现金模板替代答案')
            page.locator('#assistant-query').fill('2024-Q2经营现金流是多少');submit('#assistant-form')
            page.locator('.chat-turn').nth(3).wait_for()
            assert page.locator('.chat-turn').count()==4
            latest=page.locator('.chat-turn').last
            assert '2024-Q2' in latest.inner_text() and '12,900.00元' in latest.inner_text()
            record('指定历史季度显示当期现金流金额与真实来源，不误用最新季度或比率')
            snap('ui-current-copilot.png')
            page.locator('[data-x-action="chat-propose"][data-kind="research"]').last.click()
            f='form[data-service-form="proposal"]';page.locator(f+' summary').filter(has_text='模型参与与数学工具').click();page.locator(f+' [name="forecast"]').check()
            assert page.locator(f+' [name="max_calls"]').input_value()=='0'
            assert page.locator(f).evaluate('(form)=>form.checkValidity()')
            submit(f);page.locator('form[data-service-form="confirm-proposal"]').wait_for()
            record('零外部调用预算身份仍能预览本地Agent与预测任务，表单无隐藏非法约束')
            assert client.get('/api/runs').json()['items']==[]
            record('助手提案显示实际Agent依赖和上下文，确认前没有运行或模型调用')
            snap('ui-current-approval.png')
            submit('form[data-service-form="confirm-proposal"]');page.locator('.chat-run-result').wait_for(timeout=25000)
            assert '未调用模型' in page.locator('#assistant-answer').inner_text();record('助手批准→真实Agent运行→数学工具与报告回到原会话')
            run_id=client.get('/api/runs').json()['items'][0]['id'];run_row=client.get('/api/runs/'+run_id).json()
            assert run_row['result']['analysis']['current_period']=='2024-Q2'
            assert run_row['result']['adaptive']['mathematical_outputs']['forecast']['train_end']=='2024-Q2'
            record('助手历史问题进入批准计划后，数学输入仍截至同一目标季度')
            go('agents:run-'+run_id)
            math=page.locator('#main [data-math-kind="forecast"]');math.wait_for()
            assert math.locator('svg.chart').is_visible()
            assert '相同滚动起点回测' in math.inner_text() and '点估计' in math.inner_text()
            assert page.locator('#main a[href$="export?format=json"]').is_visible()
            assert not overflow();snap('ui-current-agent-math.png')
            record('Agent报告直接展示真实预测曲线、逐季数值、回测和缺失误差带，不要求阅读JSON')
            if native:
                for format in ('json','md'):
                    with page.expect_download() as downloaded:
                        page.locator('#main a[href$="export?format='+format+'"]').first.click()
                    content=Path(downloaded.value.path()).read_text(encoding='utf-8')
                    if format=='json':
                        exported=json.loads(content)
                        assert exported['export_context']['run_id']==run_id
                        assert exported['adaptive']['mathematical_outputs']['forecast']['forecast']
                    else:
                        assert '时间序列预测与回测' in content and 'locked_holdout' in content
                record('浏览器原生下载Markdown与完整JSON，实际数学结果与归档上下文均保留')
            go('copilot');page.locator('.chat-turn').first.wait_for()
            if native:
                stream=page.evaluate("""id => new Promise((resolve,reject)=>{
                    const entries=[];let opened=false;
                    const source=new EventSource('/api/runs/'+encodeURIComponent(id)+'/events',{withCredentials:true});
                    const timer=setTimeout(()=>{source.close();reject(new Error('Native SSE did not finish'));},10000);
                    source.onopen=()=>{opened=true;};
                    source.addEventListener('trace',event=>entries.push(JSON.parse(event.data).seq));
                    source.addEventListener('end',()=>{clearTimeout(timer);source.close();resolve({opened,entries});});
                    source.onerror=()=>{clearTimeout(timer);source.close();reject(new Error('Native SSE failed'));};
                })""",run_id)
                expected=[e['seq'] for e in client.get('/api/runs/'+run_id+'/trace').json()['items']]
                assert stream['opened'] and stream['entries']==expected and expected
                record('原生 EventSource 带浏览器会话读取真实任务全部事件并正常结束')
                rejected=page.evaluate("""async()=>{const response=await fetch('/api/services/threads',{
                    method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({title:'native rejected CSRF test'})});
                    return {status:response.status,body:await response.json()};}""")
                assert rejected['status']==403 and rejected['body']['error']['code']=='CSRF_REJECTED'
                record('原生同源写请求缺少CSRF时被拒绝，不影响现有登录会话')
            page.locator('[data-x-action="chat-propose"][data-kind="action"]').last.click()
            f='form[data-service-form="proposal"]';page.locator(f+' [name="acceptance"]').fill('核对原始财务表，记录输入口径和复核证据');submit(f);submit('form[data-service-form="confirm-proposal"]')
            assert client.get('/api/workspace/actions').json()['items'];record('助手行动提案→明确验收标准→确认入库')
            action=client.get('/api/workspace/actions').json()['items'][0]
            go('actions');page.locator('[data-action="action-detail"][data-id="'+action['id']+'"]').click()
            page.locator('[data-action="action-edit"]').click()
            edit='#action-edit-form';page.locator(edit+' [name="owner"]').fill('验收复核负责人')
            page.locator(edit+' [name="due_at"]').fill('2026-12-31')
            page.locator(edit+' [name="priority"]').select_option('high')
            page.locator(edit+' [name="note"]').fill('调整验收分工和期限，保留原始来源')
            submit(edit)
            updated=next(x for x in client.get('/api/workspace/actions').json()['items'] if x['id']==action['id'])
            assert updated['version']==action['version']+1 and updated['payload']['identity_id']==identity_id
            assert updated['payload']['owner']=='验收复核负责人' and updated['payload']['due_at']=='2026-12-31'
            assert updated['payload']['changes'] and updated['payload']['history']==action['payload']['history']
            record('行动原位调整负责人、期限和优先级，保留身份、来源与完整状态/修改历史')
            go('copilot');page.locator('.chat-turn').first.wait_for()
            page.locator('[data-x-action="chat-propose"][data-kind="memory"]').last.click();submit(f);submit('form[data-service-form="confirm-proposal"]')
            m=client.get('/api/memories').json()['items'][0];assert m['payload']['identity_id']==identity_id and m['payload']['approved'];record('助手记忆确认与身份作用域持久化')
            page.locator('#active-identity').select_option('');page.wait_for_timeout(700)
            assert page.locator('.chat-turn').count()==0;record('切换服务身份不混入前身份的研究会话')
            page.locator('#active-identity').select_option(identity_id);page.wait_for_timeout(700)
            assert page.locator('.chat-turn').count()==4;record('切回身份恢复原会话与独立任务结果')
            print('STEP tracking',flush=True);go('tracking');page.locator('[data-x-action="watch-new"]').click();f='form[data-service-form="watch"]'
            page.locator(f+' [name="title"]').fill('毛利低于40%（验收）');page.locator(f+' [name="threshold"]').fill('0.4');page.locator(f+' [name="stale_after_days"]').fill('1460');submit(f)
            print('STEP rule submitted',flush=True);page.locator('.alert-card').wait_for();page.locator('[data-x-action="alert-ack"]').click();f='form[data-service-form="alert-ack"]';page.locator(f+' [name="note"]').fill('已核对合成输入，仅用于流程验收');submit(f)
            page.locator('[data-x-action="alert-archive"]').click();page.wait_for_timeout(500);assert page.locator('.alert-card').count()==0
            go('brief');go('tracking');assert page.locator('.alert-card').count()==0;record('跟踪规则真实触发、核对归档、相同输入不重复提醒')
            # Reuse a saved mathematical result through the actual review/approval
            # UI, rather than copying parameters into a second unrelated experiment.
            go('lab');page.locator('#experiment-form [name="name"]').fill('保存假设闭环（合成验收）')
            page.locator('#experiment-form [name="price_change"]').fill('5')
            page.locator('#experiment-form [name="fixed_cost_share"]').fill('30')
            page.locator('#experiment-form [name="assumptions"]').fill('明确假设售价上调且固定成本份额不变，仅作流程验收')
            submit('#experiment-form')
            saved_experiment=client.get('/api/workspace/experiments').json()['items'][0]
            saved_id=saved_experiment['id']
            page.locator('[data-route="agents:experiment-'+saved_id+'"]').click()
            page.locator('#plan-form').wait_for()
            assert page.locator('#plan-experiment').input_value()==saved_id
            assert page.locator('#plan-form [name="scenario_note"]').is_disabled()
            assert '明确假设售价上调' in page.locator('#selected-experiment-details').inner_text()
            submit('#plan-form');page.locator('#execute-plan-form').wait_for()
            page.get_by_text('实验来源与结果指纹',exact=True).click()
            assert saved_experiment['experiment_hash'] in page.locator('#main').inner_text()
            submit('#execute-plan-form')
            page.locator('[data-math-kind="sensitivity"]').wait_for(timeout=25000)
            selected_run_id=page.url.split('agents:run-')[-1]
            selected_run=client.get('/api/runs/'+selected_run_id).json()
            full_experiment=client.get('/api/workspace/experiments/'+saved_id).json()
            tool=selected_run['result']['adaptive']['mathematical_outputs']['sensitivity']
            assert tool['result']==full_experiment['payload']['result']['result']
            assert selected_run['result']['experiment']['hash']==saved_experiment['experiment_hash']
            page.locator('[data-math-kind="sensitivity"]').get_by_text('实验来源与结果指纹',exact=True).click()
            assert saved_experiment['experiment_hash'] in page.locator('[data-math-kind="sensitivity"]').inner_text()
            assert not overflow();snap('ui-current-saved-experiment.png')
            record('保存情景→原参数锁定转交Agent→预览批准→同一数学结果和实验指纹归档')
            page.locator('[data-action="action-from-report"]').click()
            page.locator('#action-form [name="acceptance"]').fill('核对本报告明确假设、原始财务输入和实际数学结果')
            submit('#action-form');page.locator('#modal').wait_for(state='hidden')
            linked_action=next(x for x in client.get('/api/workspace/actions').json()['items'] if x['payload'].get('run_id')==selected_run_id)
            assert linked_action['payload']['provenance']['run_id']==selected_run_id
            assert linked_action['payload']['provenance']['dataset_version']==selected_run['snapshot']['dataset_version']
            page.locator('[data-x-action="watch-from-report"]').click();f='form[data-service-form="watch"]'
            page.locator(f+' [name="title"]').fill('报告来源跟踪（合成验收）')
            page.locator(f+' [name="threshold"]').fill('-1')
            page.locator(f+' [name="stale_after_days"]').fill('1460');submit(f)
            linked_watch=next(w for w in client.get('/api/services/tracking?identity_id='+identity_id).json()['rules'] if w['payload']['title']=='报告来源跟踪（合成验收）')
            assert linked_watch['payload']['provenance']['run_id']==selected_run_id
            record('报告分别转为行动与跟踪规则，保存原报告和财务修订来源')
            # A newer input revision never silently re-labels the old report as
            # current. Choosing it as a new action basis requires explicit consent.
            go('data');page.locator('#dataset-editor [name="notes"]').fill('合成验收追加数据说明；历史报告和实验不得重写')
            submit('#dataset-editor');page.locator('[data-action="commit-stage"]').click()
            page.locator('#modal').wait_for(state='hidden')
            assert client.get('/api/datasets').json()['items'][0]['version']>selected_run['snapshot']['dataset_version']
            go('agents:run-'+selected_run_id)
            assert client.get('/api/runs/'+selected_run_id).json()['result']==selected_run['result']
            page.locator('[data-action="action-from-report"]').click()
            page.locator('#action-form [name="acceptance"]').fill('明确基于旧报告复核历史假设与差异，另行检查新修订')
            page.locator('#action-form button[type="submit"]').click()
            page.locator('#action-form .form-error').filter(has_text='历史').wait_for()
            assert page.locator('#action-form [name="allow_historical"]').is_visible()
            page.locator('#action-form [name="allow_historical"]').check();submit('#action-form')
            page.locator('#modal').wait_for(state='hidden')
            historical=client.get('/api/workspace/actions').json()['items'][0]
            assert historical['payload']['provenance']['dataset_version']==selected_run['snapshot']['dataset_version']
            assert historical['source_impact']['state']=='changed'
            record('数据修订后旧报告保持不变，创建新行动须明确历史依据并显示来源变化')
            # A second explicit synthetic CSV enters through the real import UI.
            go('data');page.locator('#main [data-action="import-dialog"]').click()
            page.locator('#import-file-form [name="target_id"]').select_option('')
            page.locator('#import-file-form [name="company"]').fill('对照合成企业（非真实财报）')
            page.locator('#import-file-form [name="amount_unit"]').select_option('yuan')
            page.locator('#import-file-form [name="file"]').set_input_files({'name':'synthetic-comparison-peer.csv','mimeType':'text/csv','buffer':csv.encode('utf-8-sig')})
            submit('#import-file-form');page.locator('[data-action="commit-stage"]').wait_for()
            page.locator('[data-action="commit-stage"]').click();page.locator('#modal').wait_for(state='hidden')
            peer=next(d for d in client.get('/api/datasets').json()['items'] if d['id']!=original['id'])
            go('compare');page.locator('#compare-form [name="dataset_ids"]').nth(0).check()
            page.locator('#compare-form [name="dataset_ids"]').nth(1).check();submit('#compare-form')
            page.locator('#comparison-save-form').wait_for()
            page.locator('#comparison-save-form [name="name"]').fill('已核对企业对照（合成验收）')
            page.locator('#comparison-save-form [name="comparability_note"]').fill('两份合成单季人民币数据仅验证来源链，不代表行业样本或排名')
            submit('#comparison-save-form');page.locator('#comparison-transfer-form').wait_for()
            comparison_id=page.url.split('compare:')[-1]
            comparison_row=client.get('/api/workspace/comparisons/'+comparison_id,params={'identity_id':identity_id}).json()
            assert len(comparison_row['payload']['members'])==2
            assert not overflow();snap('ui-current-saved-comparison.png')
            page.locator('#comparison-transfer-form [name="primary_dataset_id"]').select_option(original['id'])
            submit('#comparison-transfer-form');page.locator('#plan-comparison').wait_for()
            assert page.locator('#plan-comparison').input_value()==comparison_id
            assert peer['payload']['company'] in page.locator('#selected-comparison-details').inner_text()
            submit('#plan-form');page.locator('#execute-plan-form').wait_for()
            assert peer['payload']['company'] in page.locator('#main').inner_text()
            submit('#execute-plan-form');page.locator('[data-comparison-stage="report"]').wait_for(timeout=25000)
            comparison_run_id=page.url.split('agents:run-')[-1]
            comparison_run=client.get('/api/runs/'+comparison_run_id).json()
            assert comparison_run['result']['comparison_provenance']['hash']==comparison_row['comparison_hash']
            assert peer['payload']['company'] in page.locator('[data-comparison-stage="report"]').inner_text()
            assert not overflow();snap('ui-current-comparison-report.png')
            record('共同季度对照经界面保存，明确主企业与额外企业输入，批准后报告保留原比较指纹和数值')
            # Save a new experiment against the current primary revision; the older
            # experiment above intentionally remains tied to its original inputs.
            go('lab')
            # A plan's primary enterprise does not change the global workspace
            # selection. Explicitly choose the original before creating this chat.
            if page.locator('#active-dataset').input_value()!=original['id']:
                previous=page.locator('#experiment-form').element_handle()
                page.locator('#active-dataset').select_option(original['id'])
                previous.wait_for_element_state('hidden')
            page.locator('#experiment-form').wait_for()
            assert page.locator('#experiment-form [name="dataset_id"]').input_value()==original['id']
            page.locator('#experiment-form [name="name"]').fill('助手复用实验（合成验收）')
            page.locator('#experiment-form [name="price_change"]').fill('3')
            page.locator('#experiment-form [name="assumptions"]').fill('明确保存假设后由助手引用，仅为隔离流程验收')
            submit('#experiment-form')
            chat_experiment=client.get('/api/workspace/experiments').json()['items'][0]
            assert chat_experiment['payload']['dataset_id']==original['id']
            go('copilot');page.locator('[data-x-action="chat-new"]').first.click()
            for index,question in enumerate([comparison_row['payload']['period']+'毛利率同比核查','继续展开刚才的原因','继续展开','那环比呢']):
                page.locator('#assistant-query').fill(question);submit('#assistant-form')
                page.locator('.chat-turn').nth(index).wait_for()
                assert comparison_row['payload']['period'] in page.locator('.chat-turn').last.inner_text()
            assert '毛利率' in page.locator('.chat-turn').last.locator('.fact-tile').first.inner_text()
            # Explicitly switch back to the comparison's saved year-over-year basis.
            page.locator('#assistant-query').fill('那同比呢');submit('#assistant-form');page.locator('.chat-turn').nth(4).wait_for()
            page.locator('[data-x-action="chat-propose"][data-kind="research"]').last.click()
            f='form[data-service-form="proposal"]';page.locator('#copilot-experiment').select_option(chat_experiment['id'])
            page.locator('#copilot-comparison').select_option(comparison_id)
            assert '明确保存假设' in page.locator('#copilot-experiment-details').inner_text()
            assert peer['payload']['company'] in page.locator('#copilot-comparison-details').inner_text()
            assert page.locator(f).evaluate('(form)=>form.checkValidity()')
            submit(f);page.locator('form[data-service-form="confirm-proposal"]').wait_for()
            assert comparison_row['payload']['period'] in page.locator('#modal').inner_text()
            assert peer['payload']['company'] in page.locator('#modal').inner_text()
            assert '明确保存假设' in page.locator('#modal').inner_text()
            submit('form[data-service-form="confirm-proposal"]')
            page.locator('.chat-math-results [data-math-kind="comparison"]').wait_for(timeout=25000)
            assert page.locator('.chat-math-results [data-math-kind="sensitivity"]').is_visible()
            assert peer['payload']['company'] in page.locator('.chat-math-results').inner_text()
            chat_run=client.get('/api/runs/'+client.get('/api/runs').json()['items'][0]['id']).json()
            assert chat_run['dataset_id']==original['id']
            chat_proposal_id=page.locator('.proposal-card').last.get_attribute('data-proposal')
            assert chat_run['result']['experiment']['hash']==chat_experiment['experiment_hash']
            assert chat_run['result']['comparison_provenance']['hash']==comparison_row['comparison_hash']
            assert chat_run['result']['analysis']['current_period']==comparison_row['payload']['period']
            assert not overflow();snap('ui-current-copilot-saved-inputs.png')
            record('连续短追问保持季度和指标→助手显式选实验/全体对照→批准→同会话真实数学与对照结果')
            go('data');page.locator('#active-dataset').select_option(peer['id'])
            page.locator('#dataset-editor').wait_for()
            page.locator('#dataset-editor [name="notes"]').fill('仅同行修订说明：历史对照仍须冻结')
            submit('#dataset-editor');page.locator('[data-action="commit-stage"]').click();page.locator('#modal').wait_for(state='hidden')
            go('compare:'+comparison_id)
            assert page.locator('#comparison-transfer-form').count()==0 or page.locator('#comparison-transfer-form button[type="submit"]').is_disabled()
            assert client.get('/api/runs/'+comparison_run_id).json()['result']==comparison_run['result']
            record('同行单独修订后已保存对照不再当成当前Agent输入，原报告比较结果不被重写')
            page.locator('#active-dataset').select_option(original['id']);go('copilot')
            current_proposal=page.locator('[data-proposal="'+chat_proposal_id+'"]')
            current_proposal.wait_for()
            current_proposal.get_by_text('财务输入已修订',exact=False).wait_for()
            assert '财务输入已修订' in current_proposal.inner_text()
            assert client.get('/api/runs/'+chat_run['id']).json()['result']==chat_run['result']
            record('同行修订在原助手会话显示来源适用性变化，冻结数学与报告不重算')
            # Delete only the comparison created by this isolated browser account.
            # Cancel leaves it intact; permanent cleanup preserves historical runs
            # while both live proposal selectors stop offering the removed record.
            go('compare:'+comparison_id)
            page.locator('[data-action="delete-comparison"][data-id="'+comparison_id+'"]').click()
            cleanup='#comparison-delete-form';page.locator(cleanup).wait_for()
            assert comparison_row['payload']['name'] in page.locator('#modal').inner_text()
            assert comparison_id in page.locator('#modal').inner_text()
            assert comparison_row['payload']['period'] in page.locator('#modal').inner_text()
            assert not page.locator(cleanup).evaluate('(form)=>form.checkValidity()')
            assert not overflow();snap('ui-current-comparison-cleanup.png',full_page=False)
            page.locator('#modal [data-action="close-modal"]').first.click()
            assert client.get('/api/workspace/comparisons/'+comparison_id,params={'identity_id':identity_id}).status_code==200
            page.locator('[data-action="delete-comparison"][data-id="'+comparison_id+'"]').click()
            page.locator(cleanup+' [name="confirm_delete"]').check();submit(cleanup)
            page.locator('#modal').wait_for(state='hidden')
            page.locator('#compare-form').wait_for()
            assert page.locator('#main [data-route="compare:'+comparison_id+'"]').count()==0
            assert client.get('/api/workspace/comparisons/'+comparison_id,params={'identity_id':identity_id}).status_code==404
            assert client.get('/api/runs/'+comparison_run_id).json()['result']==comparison_run['result']
            go('agents');page.locator('#plan-form').wait_for()
            assert page.locator('#plan-comparison option[value="'+comparison_id+'"]').count()==0
            go('copilot');current_proposal=page.locator('[data-proposal="'+chat_proposal_id+'"]')
            current_proposal.get_by_text('原始企业比较已删除或不可访问',exact=False).wait_for()
            assert client.get('/api/runs/'+chat_run['id']).json()['result']==chat_run['result']
            page.locator('[data-x-action="chat-propose"][data-kind="research"]').last.click()
            page.locator('#copilot-comparison').wait_for()
            assert page.locator('#copilot-comparison option[value="'+comparison_id+'"]').count()==0
            page.locator('#modal [data-action="close-modal"]').first.click()
            record('对照清理明确对象和影响→取消保留→确认删除→列表与双计划选择器移除→同会话来源失效且原报告保留')
            go('services');page.locator('[data-x-action="connection-new"]').click();f='form[data-service-form="connection"]'
            for name,val in {'name':'验收测试连接（未联网）','base_url':'https://models.test.example/v1','model':'fixture-model','api_key':'TEST-ONLY-UI-SECRET','password':password}.items():page.locator(f+' [name="'+name+'"]').fill(val)
            submit(f);page.locator('[data-x-action="connection-edit"]').wait_for();assert 'TEST-ONLY-UI-SECRET' not in page.locator('body').inner_text();record('私有连接界面保存与重新鉴权，密钥不回显')
            page.locator('[data-x-action="connection-edit"]').click();assert page.locator(f+' [name="api_key"]').input_value()=='';page.locator('[data-action="close-modal"]').click()
            record('编辑连接不把既有凭据发回浏览器')
            snap('ui-current-services.png')
            go('agents');page.locator('#plan-form').wait_for();record('原协同研判、数学与策略工作区继续可访问')
            # A draft survives opening the rail and local queries without replacing the main form.
            page.locator('#plan-form [name="query"]').fill('尚未保存的真实研究目标（交互验收）')
            page.locator('[data-action="show-assistant"]').click();page.wait_for_timeout(250)
            assert page.locator('#plan-form [name="query"]').input_value()=='尚未保存的真实研究目标（交互验收）'
            page.locator('[data-action="close-assistant"]').click();record('调节侧栏不重建主表单，不丢失未保存研究问题')
            page.locator('#plan-form [name="query"]').fill('');page.evaluate("window.dispatchEvent(new Event('online'))")
            # Confirm dialog callback accepts explicit route-change discard in this test.
            go('brief')
            page.set_viewport_size({'width':390,'height':844})
            allroutes=['brief','copilot','agents','lab','evolution','data','evidence','compare','reports','tracking','actions','memory','services','ops','settings']
            for route in allroutes:
                go(route);page.wait_for_timeout(80);assert not overflow(),route+' horizontal overflow'
            record('15个工作区390px真实渲染，无文档级水平溢出')
            go('copilot');snap('ui-current-mobile.png')
            page.locator('[data-action="menu"]').click();wait_box('#sidebar');assert page.locator('#sidebar').bounding_box()['x']>=-1
            assert page.locator('#drawer-backdrop').is_visible();page.keyboard.press('Escape');page.wait_for_timeout(250)
            assert not page.locator('#drawer-backdrop').is_visible();record('移动抽屉真正打开、遮罩、Escape关闭与焦点恢复')
            go('brief');page.locator('[data-action="show-assistant"]').click();wait_box('#assistant-rail',max_x=390);assert page.locator('#assistant-rail').bounding_box()['x']>=-1
            page.locator('[data-action="close-assistant"]').click();record('移动助手抽屉可单独收起')
            # Current layout acceptance includes constrained desktop, breakpoint,
            # narrow handset and landscape. These are real browser geometry checks,
            # not assertions inferred from CSS or historical screenshots.
            for width,height in [(1440,1000),(1280,900),(1241,900),(1240,900),(1024,768),(901,768)]:
                page.set_viewport_size({'width':width,'height':height});go('brief')
                page.locator('[data-action="show-assistant"]').click();page.wait_for_timeout(250)
                rail=page.locator('#assistant-rail');rail.wait_for(state='visible')
                assert rail.evaluate('(el)=>getComputedStyle(el).visibility')=='visible'
                assert not rail.evaluate('(el)=>el.inert')
                assert page.locator('[data-action="show-assistant"]').get_attribute('aria-expanded')=='true'
                assert not overflow(),f'{width} desktop assistant overflow'
                main_width=page.locator('#main').bounding_box()['width'];assert main_width>=300
                rail_width=rail.bounding_box()['width'];nav_width=page.locator('#sidebar').bounding_box()['width']
                if width==1024:assert page.locator('#sidebar').bounding_box()['width']<=73
                page.locator('[data-action="close-assistant"]').click()
                rail.wait_for(state='hidden');page.wait_for_timeout(250)
                assert rail.evaluate('(el)=>el.inert')
                assert page.locator('[data-action="show-assistant"]').get_attribute('aria-expanded')=='false'
                # Closing can restore the user's expanded navigation at <=1100px.
                # Its measured growth legitimately consumes part of the freed rail.
                nav_growth=page.locator('#sidebar').bounding_box()['width']-nav_width
                main_growth=page.locator('#main').bounding_box()['width']-main_width
                assert main_growth>0 and main_growth>=rail_width-nav_growth-2
                page.locator('[data-action="menu"]').click();page.wait_for_timeout(250)
                assert not overflow(),f'{width} desktop navigation overflow'
            record('1440/1280/1241/1240/1024/901px桌面助手真实可见、关闭释放空间与导航几何检查')
            for width,height in [(900,900),(320,720),(750,500)]:
                page.set_viewport_size({'width':width,'height':height})
                for route in (allroutes if width==320 else ['brief','copilot','agents','settings']):
                    go(route);page.wait_for_timeout(80)
                    assert not overflow(),f'{width}x{height} {route} overflow'
                    assert page.locator('#sidebar').evaluate('(el)=>el.inert')
                go('brief');page.locator('[data-action="menu"]').click();wait_box('#sidebar')
                assert not page.locator('#sidebar').evaluate('(el)=>el.inert')
                assert page.locator('.main-shell').evaluate('(el)=>el.inert')
                page.keyboard.press('Escape');page.wait_for_timeout(250)
                assert page.locator('#sidebar').evaluate('(el)=>el.inert')
                assert page.locator('[data-action="menu"]').evaluate('(el)=>el===document.activeElement')
            record('900px断点、320px全部工作区、750x500横屏及抽屉inert/焦点恢复')
            page.set_viewport_size({'width':1280,'height':900})
            page.emulate_media(reduced_motion='reduce')
            go('settings');page.locator('#preferences-form [name="theme"]').select_option('dark');submit('#preferences-form')
            assert page.locator('html').get_attribute('data-theme')=='dark'
            go('copilot');assert not overflow();snap('ui-current-dark.png')
            record('深色主题与减少动效模式真实渲染，不复用历史截图')
            # Capacity fixture setup uses authenticated HTTP on this temporary
            # account; the owner cleanup and confirmation below are native UI.
            fixture_budget_wait=api_budget.reserve(300,wait=lambda seconds:page.wait_for_timeout(seconds*1000))
            page.set_viewport_size({'width':1520,'height':1080})
            client.headers['X-CSRF-Token']=client.get('/api/auth/me').json()['csrf']
            setup=client.post('/api/services/identities',json={'name':'清理容量专用合成身份','dataset_ids':[original['id'],peer['id']]})
            assert setup.status_code==201,setup.text
            orphan_identity=setup.json()
            current_members=[client.get('/api/datasets/'+d['id']).json() for d in (original,peer)]
            capacity_payload={'name':'失效范围容量合成对照','identity_id':orphan_identity['id'],
                'datasets':[{'id':d['id'],'version':d['version'],'hash':d['content_hash']} for d in current_members],
                'comparison':'year_over_year','comparability_note':'隔离容量边界验收，仅使用合成输入，不用于业务判断'}
            orphan_rows=[]
            for index in range(200):
                created=client.post('/api/workspace/comparisons',json={**capacity_payload,'name':capacity_payload['name']+' '+str(index)})
                assert created.status_code==201,created.text
                orphan_rows.append(created.json())
            assert client.delete('/api/services/identities/'+orphan_identity['id'],params={'version':orphan_identity['version']}).status_code==200
            replacement_payload={**capacity_payload,'identity_id':identity_id,'name':'清理失效范围后恢复容量（合成验收）'}
            full=client.post('/api/workspace/comparisons',json=replacement_payload)
            assert full.status_code==409 and full.json()['error']['code']=='RESOURCE_LIMIT'
            go('services')
            archived=next(row for row in client.get('/api/services/history').json()['items'] if row['kind']=='comparison')
            page.locator('[data-x-action="history-detail"][data-id="'+archived['id']+'"]').click()
            page.locator('#inspector [data-action="delete-comparison"][data-id="'+archived['id']+'"]').click()
            page.locator(cleanup).wait_for()
            assert archived['id'] in page.locator('#modal').inner_text()
            assert page.locator(cleanup).get_attribute('data-identity-id')==orphan_identity['id']
            assert page.locator('#active-identity').input_value()==identity_id
            assert not overflow();snap('ui-current-history-comparison-cleanup.png',full_page=False)
            page.locator(cleanup+' [name="confirm_delete"]').check();submit(cleanup)
            page.locator('#modal').wait_for(state='hidden')
            assert client.get('/api/workspace/comparisons/'+archived['id'],params={'identity_id':orphan_identity['id']}).status_code==404
            recovered=client.post('/api/workspace/comparisons',json=replacement_payload)
            assert recovered.status_code==201,recovered.text
            assert orphan_identity['id'] not in [row['id'] for row in client.get('/api/services/identities').json()['items']]
            assert page.locator('#active-identity').input_value()==identity_id
            record('200份失效身份对照占满容量→账户历史逐项确认清理→容量恢复，原身份与研究执行权不恢复')
            # The isolated database is destroyed after the browser exits. Do not
            # create another 200-request DELETE burst merely to tidy test fixtures.
            assert not errors,errors
            assert not [r for r in responses if r['status']>=500],responses
            record('全部上述流程零捕获JavaScript异常、零HTTP5xx')
            completed=True
        except Exception as exc:
            snap('ui-current-failure.png');print('FAIL',type(exc).__name__,str(exc),flush=True)
            raise
        finally:
            status_counts={str(status):sum(row['status']==status for row in responses) for status in sorted({row['status'] for row in responses})}
            http={'requests':len(responses),'status_counts':status_counts,'server_errors':[row for row in responses if row['status']>=500]}
            (OUT/('native-service-browser.json' if native else 'service-browser-check.json')).write_text(json.dumps({'transport':'native Chromium + loopback HTTP' if native else 'Chromium DOM + fixed local HTTPX bridge','native_network_e2e':native and completed,'mode':'native' if native else 'bridge','all_checks_passed':completed,'checks':checks,'count':len(checks),'js_errors':errors,'http':http,'screenshots':screens,'policy_modified':False,'fixture_budget_wait_seconds':fixture_budget_wait,'data':'isolated synthetic test account and input'},ensure_ascii=False,indent=2),encoding='utf-8')
            b.close()
if __name__=='__main__':main()
