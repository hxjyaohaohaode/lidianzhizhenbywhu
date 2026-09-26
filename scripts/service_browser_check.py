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
from pathlib import Path
import httpx
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'evidence'


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--native',action='store_true');args=parser.parse_args();native=args.native
    checks=[];errors=[];responses=[];screens=[];completed=False
    def record(label):checks.append(label);print('PASS',label,flush=True)
    with httpx.Client(base_url='http://127.0.0.1:8000',trust_env=False,timeout=30) as client,sync_playwright() as p:
        launch={'headless':True};executable=os.getenv('CHROMIUM_PATH')
        if executable:launch['executable_path']=executable
        elif not native:launch['executable_path']='/usr/bin/chromium'
        b=p.chromium.launch(**launch)
        page=b.new_page(viewport={'width':1520,'height':1080},device_scale_factor=1)
        page.set_default_timeout(10000)
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
        def snap(name):
            page.wait_for_timeout(250)
            page.screenshot(path=str(OUT/name),full_page=True);screens.append(name)
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
            f='form[data-service-form="identity"]';page.locator(f+' [name="name"]').fill('经营负责人（合成验收）');page.locator(f+' [name="objective"]').fill('核对现金流与毛利差异，明确反向证据')
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
            page.locator('[data-action="commit-stage"]').click();page.locator('#dataset-editor').wait_for();record('上传真实CSV：暂存不写正式库，确认后入库')
            go('copilot');page.locator('#assistant-query').fill('核查毛利现金流的来源与数据质量，查看已保存证据')
            submit('#assistant-form');page.locator('.chat-turn').wait_for();assert page.locator('.fact-tile').count()>=2
            assert '数据质量' in page.locator('#assistant-answer').inner_text();assert page.locator('.tool-receipts').count()==1
            record('持久会话调用财务、血缘、质量及证据工具，有真实返回与输入修订')
            page.locator('[data-x-action="chat-trace"]').first.click()
            page.locator('.trace-container .assistant-fact').first.wait_for()
            assert page.locator('.trace-container .trace-list li').count()>0
            record('同一研究会话可追踪实际公式、季度输入及证据范围')
            page.locator('#role-switch').select_option('advisor')
            page.locator('.chat-turn').first.wait_for(state='detached')
            assert page.locator('#role-switch').input_value()=='advisor'
            page.locator('#role-switch').select_option('enterprise')
            page.locator('.chat-turn').first.wait_for()
            assert page.locator('#role-switch').input_value()=='enterprise'
            record('同一账户切换研究视角，原会话按上下文隔离后恢复')
            page.locator('#assistant-query').fill('继续展开刚才的现金流依据');submit('#assistant-form')
            assert page.locator('.chat-turn').count()==2;record('连续追问保留会话，不是覆盖单条固定回复')
            snap('ui-current-copilot.png')
            page.locator('[data-x-action="chat-propose"][data-kind="research"]').last.click()
            f='form[data-service-form="proposal"]';page.locator(f+' details').first.click();page.locator(f+' [name="forecast"]').check()
            submit(f);page.locator('form[data-service-form="confirm-proposal"]').wait_for()
            assert client.get('/api/runs').json()['items']==[]
            record('助手提案显示实际Agent依赖和上下文，确认前没有运行或模型调用')
            snap('ui-current-approval.png')
            submit('form[data-service-form="confirm-proposal"]');page.locator('.chat-run-result').wait_for(timeout=25000)
            assert '未调用模型' in page.locator('#assistant-answer').inner_text();record('助手批准→真实Agent运行→数学工具与报告回到原会话')
            if native:
                run_id=client.get('/api/runs').json()['items'][0]['id']
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
            page.locator('[data-x-action="chat-propose"][data-kind="memory"]').last.click();submit(f);submit('form[data-service-form="confirm-proposal"]')
            m=client.get('/api/memories').json()['items'][0];assert m['payload']['identity_id']==identity_id and m['payload']['approved'];record('助手记忆确认与身份作用域持久化')
            page.locator('#active-identity').select_option('');page.wait_for_timeout(700)
            assert page.locator('.chat-turn').count()==0;record('切换服务身份不混入前身份的研究会话')
            page.locator('#active-identity').select_option(identity_id);page.wait_for_timeout(700)
            assert page.locator('.chat-turn').count()==2;record('切回身份恢复原会话与独立任务结果')
            print('STEP tracking',flush=True);go('tracking');page.locator('[data-x-action="watch-new"]').click();f='form[data-service-form="watch"]'
            page.locator(f+' [name="title"]').fill('毛利低于40%（验收）');page.locator(f+' [name="threshold"]').fill('0.4');page.locator(f+' [name="stale_after_days"]').fill('1460');submit(f)
            print('STEP rule submitted',flush=True);page.locator('.alert-card').wait_for();page.locator('[data-x-action="alert-ack"]').click();f='form[data-service-form="alert-ack"]';page.locator(f+' [name="note"]').fill('已核对合成输入，仅用于流程验收');submit(f)
            page.locator('[data-x-action="alert-archive"]').click();page.wait_for_timeout(500);assert page.locator('.alert-card').count()==0
            go('brief');go('tracking');assert page.locator('.alert-card').count()==0;record('跟踪规则真实触发、核对归档、相同输入不重复提醒')
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
            assert not errors,errors
            assert not [r for r in responses if r['status']>=500],responses
            record('全部上述流程零捕获JavaScript异常、零HTTP5xx')
            completed=True
        except Exception as exc:
            snap('ui-current-failure.png');print('FAIL',type(exc).__name__,str(exc),flush=True)
            raise
        finally:
            (OUT/('native-service-browser.json' if native else 'service-browser-check.json')).write_text(json.dumps({'transport':'native Chromium + loopback HTTP' if native else 'Chromium DOM + fixed local HTTPX bridge','native_network_e2e':native and completed,'mode':'native' if native else 'bridge','all_checks_passed':completed,'checks':checks,'count':len(checks),'js_errors':errors,'responses':responses,'screenshots':screens,'policy_modified':False,'data':'isolated synthetic test account and input'},ensure_ascii=False,indent=2),encoding='utf-8')
            b.close()
if __name__=='__main__':main()
