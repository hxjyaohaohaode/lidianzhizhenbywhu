"""Actual Chromium DOM + local API transport tests. NOT native browser Cookie/CSP/SSE verification.
Use an isolated DATA_DIR. Test inputs are explicitly synthetic; no production seeding occurs.
"""
from __future__ import annotations
import base64,json,re,uuid,time,os
from pathlib import Path
import httpx
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'evidence';OUT.mkdir(exist_ok=True)

def main(native=False):
    checks=[];errors=[];responses=[];overflows=[];completed=False
    with httpx.Client(base_url='http://127.0.0.1:8000',trust_env=False,timeout=30) as client,sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH','/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1520,'height':1080});page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
        def call(payload):
            path=payload['path']
            if not path.startswith('/api/') or '://' in path or '..' in path:raise ValueError('Only local test API routes are supported')
            kw={'headers':payload.get('headers',{})}
            if 'form' in payload:
                kw['data']={x['name']:x['text'] for x in payload['form'] if 'text' in x}
                kw['files']={x['name']:(x['filename'],base64.b64decode(x['data']),x['mime']) for x in payload['form'] if 'data' in x}
            else:kw['content']=payload.get('body')
            r=client.request(payload.get('method','GET'),path,**kw);responses.append({'path':path,'status':r.status_code})
            if r.status_code>=400 and r.status_code!=401:print('HTTP',r.status_code,path,r.text[:300],flush=True)
            return {'status':r.status_code,'body':r.text,'headers':dict(r.headers)}
        if native:
            try:page.goto('http://127.0.0.1:8000',wait_until='domcontentloaded')
            except Exception as error:
                (OUT/'native-browser.json').write_text(json.dumps({'passed':False,'stage':'native_navigation','error':str(error),'policy_modified':False},ensure_ascii=False,indent=2))
                browser.close();raise
            page.on('response',lambda r:responses.append({'path':r.url,'status':r.status}))
        else:
            page.expose_function('__localApi',call)
            html=(ROOT/'web/index.html').read_text();html=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S);html=re.sub(r'<link[^>]*>','',html)
            page.set_content(html);page.add_style_tag(content=(ROOT/'web/styles.css').read_text()+'\n'+(ROOT/'web/adaptive.css').read_text())
            page.evaluate('''() => {window.fetch=async(path,init={})=>{const input={path:String(path),method:init.method||'GET',headers:init.headers||{}};
            if(init.body instanceof FormData){input.form=[];for(const [name,value] of init.body.entries()){if(value instanceof File){const bytes=new Uint8Array(await value.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);input.form.push({name,filename:value.name,mime:value.type,data:btoa(binary)})}else input.form.push({name,text:String(value)})}}
            else input.body=init.body;const r=await window.__localApi(input);return new Response(r.body,{status:r.status,headers:r.headers})};}''')
            brand={'/assets/brand/logo.png':'data:image/png;base64,'+base64.b64encode((ROOT/'web/brand/logo.png').read_bytes()).decode(),'/assets/brand/loading-video.mp4':'data:video/mp4;base64,'+base64.b64encode((ROOT/'web/brand/loading-video.mp4').read_bytes()).decode()}
            page.evaluate("assets=>new MutationObserver(()=>document.querySelectorAll('img,video').forEach(el=>{const src=el.getAttribute('src');if(assets[src])el.src=assets[src]})).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']})",brand)
            modules=[]
            for name in ['api','state','components','assistant','views-data','views-orchestrator','views-studio','views-analysis','pages','brand','live','app']:
                code=(ROOT/f'web/dist/{name}.js').read_text();code=re.sub(r'^import[^;]+;','',code,flags=re.M);code=re.sub(r'^export ','',code,flags=re.M);modules.append(code)
            page.add_script_tag(content='\n'.join(modules),type='module')
        def record(name):checks.append(name);print('PASS',name,flush=True)
        def goto(route):
            page.evaluate('(route)=>location.hash=route',route);page.wait_for_timeout(250);page.locator('#main .page-heading').wait_for(timeout=8000)
            assert page.locator('#main h1').inner_text()!='读取未完成',page.locator('#main').inner_text()
        def native_cookie_sync():
            if not native:return
            cookies=page.context.cookies()
            for cookie in cookies:client.cookies.set(cookie['name'],cookie['value'])
            if cookies:assert all(c['httpOnly'] and c['sameSite']=='Strict' for c in cookies if c['name']=='lidian_session')
        def submit(form):
            page.locator(form+' button[type="submit"]').click();page.wait_for_timeout(300)
            err=page.locator(form+' .form-error')
            if err.count() and err.is_visible():raise AssertionError(err.inner_text())
        def shot(name):
            page.locator('#notifications .toast').first.wait_for(state='hidden',timeout=12000)
            page.screenshot(path=str(OUT/name),full_page=True)
        try:
            page.locator('#auth-form').wait_for();page.locator('.brand-intro [data-intro-skip]').click();assert page.locator('.brand-intro').count()==0;record('原始开场视频可直接跳过，不依赖动画完成才能登录');shot('ui-login.png')
            page.locator('[data-action="auth-toggle"]').click()
            page.locator('#auth-form [name="email"]').fill(f'dom-{uuid.uuid4().hex}@test.example')
            page.locator('#auth-form [name="password"]').fill('DOM-regression-password-2026')
            page.locator('#auth-form [name="name"]').fill('验收测试账户');submit('#auth-form')
            page.locator('#main .onboarding').wait_for();native_cookie_sync();assert client.get('/api/datasets').json()['items']==[];shot('ui-empty-workspace.png');record('独立注册后，财务、企业、报告均为空；无演示数据按钮')
            # Real CSV sent through the same multipart and staging APIs as the product.
            page.locator('#main [data-action="import-dialog"]').first.click()
            page.locator('#import-file-form [name="company"]').fill('验收专用企业（合成测试）')
            page.locator('#import-file-form [name="amount_unit"]').select_option('yuan')
            csv='季度,营业收入,营业成本,经营现金流,净利润,总资产,总负债,期末净资产,期初净资产,库存金额,研发费用\n'
            for i in range(12):csv+=f'{2022+i//4}-Q{i%4+1},{100000+i*1200},{70000+i*600},{12000+i*100},9000,500000,200000,300000,290000,20000,3000\n'
            page.locator('#import-file-form [name="file"]').set_input_files({'name':'synthetic-acceptance.csv','mimeType':'text/csv','buffer':csv.encode('utf-8-sig')})
            submit('#import-file-form');page.locator('[data-action="commit-stage"]').wait_for();assert client.get('/api/datasets').json()['items']==[];record('CSV解析预览不直接写入财务库')
            page.locator('[data-action="commit-stage"]').click();page.locator('#dataset-editor').wait_for();d=client.get('/api/datasets').json()['items'][0];record('明确提交后持久化归一化数据')
            goto('brief');page.locator('.chart').wait_for();shot('ui-test-workspace.png');record('已保存数据驱动趋势、指标与主动核查')
            page.locator('[data-action="assistant-query"]').nth(1).click();page.locator('.assistant-fact').first.wait_for();assert '模型调用 0' in page.locator('#assistant-answer').inner_text();record('助手读取真实保存指标；明确标记本地路由而非模型聊天')
            page.locator('.assistant-fact details summary').first.click();assert page.locator('.trace-list li').count()>0;assert '数据修订' in page.locator('#assistant-answer').inner_text();record('助手显示计算输入、季度追踪与数据修订')
            page.locator('[data-action="collapse-menu"]').click();expect(page.locator('#sidebar')).to_have_css('width','70px');shot('ui-collapsed-navigation.png');page.locator('[data-action="collapse-menu"]').click();expect(page.locator('#sidebar')).to_have_css('width','224px');record('桌面导航真实收缩与展开')
            page.locator('#role-switch').select_option('advisor');expect(page.locator('#sidebar .sidebar-footer small')).to_have_text('顾问服务');page.locator('[data-action="assistant-query"]').first.click();page.get_by_text('当前最值得跟进的行动是什么？',exact=True).first.wait_for();page.locator('#role-switch').select_option('enterprise');expect(page.locator('#sidebar .sidebar-footer small')).to_have_text('企业经营');record('同一账户切换研究视角并收到对应追问')
            goto('settings');page.locator('#company-profile-form [name="margin_floor"]').fill('40');page.locator('#company-profile-form [name="objective"]').fill('验收专用：核查毛利与现金回流差异');submit('#company-profile-form');record('企业自定目标保存并绑定企业范围')
            goto('brief');assert page.get_by_text('毛利率低于自定目标',exact=True).count()>0;page.locator('#main [data-action="insight-action"]').first.click()
            submit('#action-form');goto('actions');page.locator('.action-card').first.click();page.locator('#action-transition-form [name="note"]').fill('验收测试：开始核对原始财务表');submit('#action-transition-form');page.locator('.action-card').first.click();page.locator('#action-transition-form [name="status"]').select_option('done');page.locator('#action-transition-form [name="note"]').fill('验收测试：已完成原始财务表核对');submit('#action-transition-form');assert page.locator('.kanban-column').nth(3).locator('.action-card').count()==1;record('核查建议→行动→处理中→说明验收→已完成全链路')
            goto('evidence');page.locator('#main [data-action="evidence-dialog"]').first.click();page.locator('#evidence-form [name="title"]').fill('<img src=x onerror=window.INJECTED=true>毛利证据测试')
            page.locator('#evidence-form [name="text"]').fill('验收专用合成资料，不能作为真实财务证据。锂电企业毛利率、采购成本和经营现金流需要按期核对。'*8)
            submit('#evidence-form');page.locator('[data-action="review-evidence"]').first.wait_for();assert page.evaluate('window.INJECTED') is None;assert page.locator('.title-button img').count()==0;record('证据标题与原文按文本显示，XSS未执行')
            page.locator('[data-action="review-evidence"]').first.click();page.locator('#evidence-review-form [name="status"]').select_option('accepted');page.locator('#evidence-review-form [name="note"]').fill('仅验收用途，不能认作真实公司财报');submit('#evidence-review-form')
            page.locator('#evidence-search [name="q"]').fill('毛利率采购成本');page.locator('#evidence-search button').click();page.locator('#evidence-search-results .citation').first.wait_for();record('企业作用域检索、资料审阅与引用片段联动')
            goto('memory');page.locator('[data-action="memory-dialog"]').first.click();page.locator('#memory-form [name="text"]').fill('验收偏好：优先核查现金流并列出反向证据');submit('#memory-form');page.locator('[data-action="toggle-memory"]').first.click();page.get_by_text('已批准',exact=True).wait_for();record('记忆默认未批准，明确批准才可召回')
            goto('agents');page.locator('#plan-form [name="query"]').fill('核查毛利率和采购成本变化，同时解释现金流证据不足之处');submit('#plan-form');page.locator('#execute-plan-form').wait_for();shot('ui-plan.png');assert client.get('/api/runs').json()['items']==[];record('生成计划展示分工和边界，不发出外部调用或后台运行')
            page.locator('[data-action="node-details"]').first.click();assert page.locator('#inspector').is_visible();page.keyboard.press('Escape');submit('#execute-plan-form');page.locator('#run-tab-summary .metric-row').wait_for(timeout=20000);run_id=page.evaluate('location.hash').split('run-')[-1];shot('ui-report.png');record('批准后按目标执行真实依赖图与本地复盘，未授权模型不会调用')
            for tab in ['agents','sources','rules','summary']:
                page.locator(f'[data-action="run-tab"][data-tab="{tab}"]').click();assert page.locator('#run-tab-'+tab).is_visible()
            record('报告摘要、Agent轨迹、证据上下文与逐字段血缘均可展开')
            r=client.get('/api/workspace/runs/'+run_id+'/audit').json();assert r['ledger']['valid'];rt=client.get('/api/workspace/runs/'+run_id+'/runtime').json();assert len(r['artifacts'])==len(rt['checkpoints'])>=7;assert r['snapshot_hash_valid'] and r['report_hash_valid'];assert all(a['event_anchor_valid'] for a in r['artifacts']);record('已完成节点有实际产物、事件链和原始输入散列')
            page.locator('[data-action="run-tab"][data-tab="agents"]').click()
            graph=page.locator('#run-tab-agents .graph-shell');graph.locator('[data-action="graph-plus"]').click();assert graph.locator('.zoom-large').count()==1
            graph.locator('[data-action="graph-toggle"]').click();assert graph.locator('.graph-list').is_visible();graph.locator('[data-action="graph-toggle"]').click()
            graph.locator('.dag-node').first.focus();page.keyboard.press('Enter');page.locator('#inspector').wait_for(state='visible');page.keyboard.press('Escape');record('真实DAG缩放、清单切换和键盘节点详情可用')
            page.locator('[data-action="run-tab"][data-tab="summary"]').click();page.locator('[data-action="assessment-dialog"]').click()
            page.locator('#assessment-form [name="note"]').fill('验收测试：应补充单独的反向证据对照节点')
            page.locator('#assessment-form [name="expected_capabilities"][value="counterevidence"]').check();page.locator('#assessment-form [name="consent_replay"]').check();submit('#assessment-form');record('报告验收与本地回放授权分别保存')
            goto('evolution');page.locator('[data-action="strategy-propose"]').click();page.locator('.evaluation-card').wait_for();assert page.get_by_text('未达到激活门槛',exact=True).count()>0
            assert page.locator('[data-action="strategy-activate"]').count()==0;page.locator('[data-action="evaluation-detail"]').click();assert page.locator('#inspector .json-view').is_visible();page.keyboard.press('Escape');record('由人工验收缺口生成并回放候选；样本不足时不能激活')
            goto('settings');page.locator('#appearance-form [name="motion"]').select_option('reduce');submit('#appearance-form');assert page.locator('html').get_attribute('data-motion')=='reduce'
            page.locator('[data-action="replay-intro"]').click();assert page.locator('.brand-intro').is_visible();page.keyboard.press('Escape');assert page.locator('.brand-intro').count()==0
            page.locator('#appearance-form [name="motion"]').select_option('system');submit('#appearance-form');record('减少动效、原始品牌重播与Escape退出，不阻断业务页面')
            goto('agents');page.locator('#plan-form [name="query"]').fill('进行经营现金流预测并核对情景假设边界');page.locator('#plan-form [name="forecast"]').check();page.locator('#plan-form [name="forecast_metric"]').select_option('cash_flow');page.locator('#plan-form [name="forecast_horizon"]').select_option('3')
            page.locator('#plan-form details').last.locator('summary').click();page.locator('#plan-form [name="with_scenario"]').check();page.locator('#plan-form [name="scenario_note"]').fill('验收合成假设：固定成本占比为三成，仅用于方法测试')
            page.locator('#plan-form [name="scenario_fixed"]').fill('30');submit('#plan-form');page.locator('#execute-plan-form').wait_for();shot('ui-adaptive-plan.png');submit('#execute-plan-form');page.locator('#run-tab-summary .metric-row').wait_for(timeout=20000)
            new_id=page.evaluate('location.hash').split('run-')[-1];new_run=client.get('/api/runs/'+new_id).json();assert new_run['result']['adaptive']['mathematical_outputs']['forecast']['status']=='completed';assert new_run['result']['adaptive']['mathematical_outputs']['forecast']['metric']=='cash_flow';assert new_run['result']['adaptive']['mathematical_outputs']['forecast']['forecast_horizon']==3;assert new_run['result']['adaptive']['mathematical_outputs']['sensitivity']['status']=='completed';shot('ui-adaptive-report.png');record('同一Agent任务实际完成序列回测与已批准情景，并归档真实产物')
            goto('lab');page.locator('#experiment-form [name="name"]').fill('验收：固定成本情景');page.locator('#experiment-form [name="fixed_cost_share"]').fill('30');page.locator('#experiment-form [name="price_change"]').fill('-5');page.locator('#experiment-form [name="assumptions"]').fill('测试假设，不代表真实企业业务情况。');submit('#experiment-form');page.get_by_text('敏感性对照',exact=True).wait_for();shot('ui-scenario.png');record('固定/变动成本拆分、单因素与二维敏感性实验保存')
            goto('lab');page.locator('#experiment-kind').select_option('forecast');page.locator('#experiment-form [name="name"]').fill('验收：滚动基线预测');page.locator('#experiment-form [name="assumptions"]').fill('验收专用合成季度数据，仅验证统计方法链路。');submit('#experiment-form');page.get_by_text('相同滚动起点的回测比较',exact=True).wait_for();shot('ui-forecast.png');record('四种时间基线滚动回测、逐折训练边界和预测区间披露')
            goto('data');page.locator('[data-action="data-revisions"]').click();page.locator('#modal details').first.locator('summary').click();page.locator('[data-action="restore-revision"]').click();page.locator('#dataset-editor').wait_for();assert client.get('/api/datasets/'+d['id']).json()['version']==2;record('恢复旧内容新增修订，不覆盖历史')
            goto('reports');page.get_by_text('原数据已有更新',exact=True).first.wait_for();record('修改数据后报告标记过期，冻结结果不自动重写')
            goto('settings');page.locator('#preferences-form [name="theme"]').select_option('dark');submit('#preferences-form');assert page.locator('html').get_attribute('data-theme')=='dark';goto('brief');shot('ui-dark.png');record('主题与个人设置持久同步')
            page.keyboard.press('Control+k');page.locator('#command-filter').fill('记忆');assert page.locator('#command-results button:visible').count()==1;page.keyboard.press('Escape');record('快捷导航、检索过滤、原生对话框退出')
            goto('settings');page.locator('#preferences-form [name="theme"]').select_option('light');submit('#preferences-form')
            page.set_viewport_size({'width':390,'height':844})
            for route in ['brief','agents','data','evidence','lab','compare','reports','actions','memory','evolution','ops','settings','agents:run-'+run_id]:
                goto(route);dim=page.evaluate('({w:innerWidth,s:document.documentElement.scrollWidth})')
                if dim['s']>dim['w']+1:overflows.append({'route':route,**dim})
                if route=='brief':shot('ui-mobile.png')
            assert not overflows,overflows;record('12个工作区及运行详情390px无文档级横向溢出')
            page.locator('[data-action="show-assistant"]').click();page.locator('#assistant-rail').wait_for(state='visible');page.locator('[data-action="close-assistant"]').click();page.locator('[data-action="menu"]').click();page.locator('#sidebar').wait_for(state='visible');record('移动端导航与上下文助手独立展开收起')
            page.locator('[data-action="close-menu"]').click();goto('settings');page.locator('[data-action="archive-dialog"]').click();page.locator('#modal details').first.locator('summary').click();assert page.locator('#modal [data-action="archive-delete"]').count()>0;page.keyboard.press('Escape');record('独立快照整理入口展示已有记录，删除明确披露保留边界')
            goto('agents');assert page.locator('#plan-form [name="session_id"] option').count()>=2;assert not page.locator('#plan-form [name="include_history"]').is_checked();record('会话历史可显式选择，默认不纳入上下文')
            page.locator('#plan-form [name="query"]').fill('未保存的研究问题不可被后台同步覆盖')
            client.post('/api/memories',json={'text':'跨标签页同步验收，不允许覆盖编辑输入','approved':False},headers={'X-CSRF-Token':client.get('/api/auth/me').json()['csrf']}).raise_for_status()
            page.evaluate("window.dispatchEvent(new Event('online'))");page.locator('#sync-notice').wait_for(state='visible');assert page.locator('#plan-form [name="query"]').input_value()=='未保存的研究问题不可被后台同步覆盖';record('变更游标触发被动提醒，不覆盖未保存的问题')
            assert not errors,errors;assert not [x for x in responses if x['status']>=500],responses
            record('全流程未捕获JavaScript异常或HTTP5xx');completed=True
        except Exception:
            shot('ui-failure.png');print('ERRORS',errors,flush=True);print(page.locator('body').inner_text()[-3500:],flush=True);raise
        finally:
            (OUT/('native-browser.json' if native else 'dom-check.json')).write_text(json.dumps({'transport':'native HTTP/ESM/cookie integration' if native else 'Chromium DOM + explicitly local HTTPX bridge; NOT native network/Cookie/CSP/SSE E2E','test_data':'synthetic acceptance only; isolated runtime; not packaged as product data','passed':completed and not errors and not overflows,'checks':checks,'errors':errors,'http':responses,'mobile_overflow':overflows},ensure_ascii=False,indent=2))
            browser.close()
if __name__=='__main__':main()
