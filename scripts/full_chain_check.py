"""Real loopback HTTP acceptance + hard process-restart recovery, no browser bridge.

Creates an isolated temporary database; never accepts a production URL. Optional
provider failure integration uses explicitly injected test-only provider classes,
not real supplier credentials. Native browser Cookie/CSP behavior is a separate gate.
"""
from __future__ import annotations
import concurrent.futures,contextlib,copy,hashlib,json,os,shutil,socket,sqlite3,subprocess,sys,tempfile,time,uuid
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence'

class WindowsSafeTemporaryDirectory(tempfile.TemporaryDirectory):
    def cleanup(self):
        # A terminated Uvicorn process can release its SQLite handle slightly
        # after wait() returns on Windows. Keep cleanup bounded and observable.
        for attempt in range(10):
            try:
                return super().cleanup()
            except PermissionError:
                if attempt==9:raise
                time.sleep(.2)


def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

class ProductServer:
    def __init__(self,dir,**extra):
        self.dir=Path(dir);self.port=port();self.base=f'http://127.0.0.1:{self.port}';self.extra=extra;self.process=None
    def start(self):
        env=os.environ.copy()
        for k in list(env):
            if k.endswith('_API_KEY') or k in ('APP_ENV','REGISTRATION_CODE'):env.pop(k,None)
        env.update(DATA_DIR=str(self.dir),APP_ORIGIN=self.base,PYTHONPATH=str(ROOT),**self.extra)
        self.log=open(self.dir.parent/(self.dir.name+'-server.log'),'a')
        self.process=subprocess.Popen([sys.executable,'-m','uvicorn','server.app:app','--host','127.0.0.1','--port',str(self.port),'--log-level','warning'],cwd=ROOT,env=env,stdout=self.log,stderr=subprocess.STDOUT)
        for _ in range(100):
            try:
                with httpx.Client(trust_env=False,timeout=1) as c:
                    if c.get(self.base+'/').status_code==200:return
            except httpx.HTTPError:pass
            if self.process.poll() is not None:raise RuntimeError('server exited: '+str(self.process.returncode))
            time.sleep(.1)
        raise TimeoutError('server startup')
    def stop(self,hard=False):
        if self.process and self.process.poll() is None:
            self.process.kill() if hard else self.process.terminate()
            try:self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:self.process.kill();self.process.wait()
        if hasattr(self,'log'):self.log.close()


def require(r,code=200):
    assert r.status_code==code,(r.status_code,r.request.url,r.text[:400]);return r.json() if 'application/json' in r.headers.get('content-type','') else r

def register(client):
    r=client.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@acceptance.test','password':'Real-HTTP-acceptance-password','name':'全链路验收（合成账户）'})
    data=require(r,201);client.headers.update({'X-CSRF-Token':data['csrf']});return data

def plan(client,dataset,**kw):
    return require(client.post('/api/workspace/plans',json={'dataset_id':dataset['id'],'query':'核验现金回流与毛利变化边界','execution':{},**kw}),201)

def approve(client,p):
    return require(client.post('/api/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint'],'external_consent':False}),202)

def wait_run(client,id):
    for _ in range(150):
        row=require(client.get('/api/runs/'+id))
        if row['state'] not in ('queued','running'):return row
        time.sleep(.06)
    raise TimeoutError('run not terminal')


def main():
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
    OUT.mkdir(exist_ok=True);checks=[];timings={};start=time.time()
    def record(name):checks.append(name);print('PASS',name,flush=True)
    evidence={'transport':'real loopback TCP/HTTP; actual Uvicorn process + SQLite; NOT native browser E2E','real_external_supplier_calls':0,'test_data':'explicitly synthetic; temporary isolated database; never bundled'}
    try:
      with WindowsSafeTemporaryDirectory(prefix='lidian-e2e-') as temp:
        srv=ProductServer(Path(temp)/'product');srv.start()
        try:
          with httpx.Client(base_url=srv.base,trust_env=False,timeout=10) as c,httpx.Client(base_url=srv.base,trust_env=False,timeout=10) as other:
            for path in ['/','/assets/dist/app.js','/assets/adaptive.css','/api/openapi.json','/api/docs','/images/logo.png','/loading-video.mp4']:
                r=c.get(path);assert r.status_code==200,(path,r.status_code)
                assert 'Content-Security-Policy' in r.headers and r.headers.get('X-Content-Type-Options')=='nosniff'
            for path,file in [('/images/logo.png','logo.png'),('/loading-video.mp4','loading-video.mp4')]:
                raw=c.get(path).content;assert hashlib.sha256(raw).digest()==hashlib.sha256((ROOT/'web/brand'/file).read_bytes()).digest()
            partial=c.get('/loading-video.mp4',headers={'Range':'bytes=0-99'});assert partial.status_code==206 and len(partial.content)==100
            record('原始PNG/MP4实际HTTP散列一致、视频Range分段与安全响应头')
            a=register(c);b=register(other)
            me=require(c.get('/api/auth/me'));assert me['user']['id']==a['user']['id']
            for cookie in c.cookies.jar:assert cookie.has_nonstandard_attr('HttpOnly') and cookie.get_nonstandard_attr('SameSite').lower()=='strict'
            assert require(c.get('/api/datasets'))['items']==[]
            assert require(c.get('/api/runs'))['items']==[]
            record('真实Cookie登录与全新工作区零业务数据（非浏览器SameSite验收）')
            assert c.post('/api/memories',json={'text':'缺少CSRF的写入'},headers={'X-CSRF-Token':''}).status_code==403
            assert c.post('/api/memories',json={'text':'跨源写入应被拒绝'},headers={'Origin':'https://foreign.example'}).status_code==403
            assert c.get('/api/account/export',headers={'Cookie':'','x-platform-access':'internal','x-forwarded-for':'127.0.0.1'}).status_code==401
            record('跨源写入、缺失CSRF与伪造内部身份的真实HTTP拒绝链')
            csv='季度,营业收入,营业成本,经营现金流,净利润,总资产,总负债,期末净资产,期初净资产,库存金额,研发费用\n'
            for i in range(12):csv+=f'{2022+i//4}-Q{i%4+1},{100000+i*1500},{70000+i*750},{12000+i*300},9000,500000,200000,300000,290000,20000,3000\n'
            stage=require(c.post('/api/workspace/imports/file',data={'company':'HTTP验收合成企业','name':'合成验收数据','basis':'standalone_quarter','amount_unit':'yuan'},files={'file':('acceptance.csv',csv.encode('utf-8-sig'),'text/csv')}),201)
            assert require(c.get('/api/datasets'))['items']==[]
            commit=require(c.post('/api/workspace/imports/'+stage['id']+'/commit',json={'version':stage['version'],'fingerprint':stage['payload']['fingerprint']}),201)
            d=commit.get('dataset',commit)
            assert d.get('id'),commit
            assert other.get('/api/datasets/'+d['id']).status_code==404
            record('multipart实际解析→暂存预览→明确事务提交→企业跨账户隔离')
            e=require(c.post('/api/evidence',json={'company':d['payload']['company'],'title':'全链路合成验收资料','text':'此为验收用合成资料，并非真实财务信息。毛利变化与现金回流需要原始报表核验。'*15}),201)
            evidence_review=next(row for row in require(c.get('/api/workspace/evidence'))['items'] if row['id']==e['id'])
            require(c.put('/api/workspace/evidence/'+e['id']+'/review',json={'version':evidence_review['review_version'],'company':d['payload']['company'],'status':'accepted','stance':'contradicts','note':'合成资料用于验证引用链，不能认作真实财报'}))
            m=require(c.post('/api/memories',json={'text':'优先列出反证与不足，不填充缺失值','approved':True,'company':d['payload']['company']}),201)
            assert require(c.get('/api/workspace/retrieval',params={'q':'毛利现金回流','company':d['payload']['company']}))['items']
            record('证据范围、反向标签、批准记忆与真实全文检索联动')
            p=plan(c,d,query='收入预测与现金回流的反向证据核查',execution={'depth':'deep','forecast':True,'scenario':{'price_change':-.05,'cost_change':.03,'volume_change':.1,'fixed_cost_share':.3,'note':'明确合成验收压力测试假设'}})
            run=approve(c,p);run=wait_run(c,run['id']);assert run['result'],run
            rt=require(c.get('/api/workspace/runs/'+run['id']+'/runtime'))
            assert rt['usage']['attempts']==0 and len(rt['checkpoints'])>=10
            mathematical=run['result']['adaptive']['mathematical_outputs'];assert mathematical['forecast']['status']=='completed' and mathematical['sensitivity']['status']=='completed'
            assert mathematical['counterevidence']['groups']['contradicts']
            record('问题→计划指纹→明确批准→动态DAG→预测/情景/反向证据→冻结报告')
            audit=require(c.get('/api/workspace/runs/'+run['id']+'/audit'));assert audit['ledger']['valid'] and audit['report_hash_valid'] and audit['snapshot_hash_valid']
            assert all(x['event_anchor_valid'] and x['integrity_valid'] for x in audit['artifacts'])
            exports=require(c.get('/api/workspace/export'));assert exports['adaptive']['adaptive_checkpoints'] and exports['adaptive']['adaptive_graphs']
            assert c.get('/api/runs/'+run['id']+'/export',params={'format':'md'}).status_code==200
            assert other.get('/api/workspace/runs/'+run['id']+'/runtime').status_code==404
            record('报告字段血缘、节点产物、事件锚点、完整工作区导出和跨账户隔离')
            # Explicitly synthetic peer; frozen common-quarter comparison is approved
            # as extra input, never silently added to ordinary single-company plans.
            peer_data=copy.deepcopy(d['payload']);peer_data.pop('verification',None);peer_data.pop('input_amount_unit',None)
            peer_data['company']='同季度对照合成企业';peer_data['name']='HTTP 对照独立合成样本'
            peer=require(c.post('/api/datasets',json=peer_data),201)
            comparison=require(c.post('/api/workspace/comparisons',json={
                'name':'HTTP 冻结企业对照','identity_id':'',
                'datasets':[{'id':x['id'],'version':x['version'],'hash':x['content_hash']} for x in (d,peer)],
                'comparison':'year_over_year','comparability_note':'仅用独立合成数据验证共同季度和来源链，不作行业排名'}),201)
            ref={'id':comparison['id'],'version':comparison['version'],'hash':comparison['comparison_hash']}
            comparison_plan=plan(c,d,query='核对'+comparison['payload']['period']+'企业对照的毛利率及可比性边界',comparison_artifact=ref)
            comparison_run=wait_run(c,approve(c,comparison_plan)['id']);assert comparison_run['result'],comparison_run
            frozen_comparison=copy.deepcopy(comparison_run['result']['comparison_artifact'])
            assert comparison_run['snapshot']['comparison_artifact']['hash']==ref['hash']
            assert comparison_run['result']['comparison_provenance']['hash']==ref['hash']
            assert ref['hash'] in c.get('/api/runs/'+comparison_run['id']+'/export',params={'format':'md'}).text
            assert other.get('/api/workspace/comparisons/'+ref['id']+'?identity_id=').status_code==404
            comparison_action=require(c.post('/api/workspace/actions',json={
                'title':'核查对照口径','acceptance':'确认共同季度与两家企业来源的实际可比性',
                'dataset_id':d['id'],'source_ref':{'kind':'report','run_id':comparison_run['id']}}),201)
            peer_update=copy.deepcopy(peer_data);peer_update['version']=peer['version'];peer_update['periods'][-1]['revenue']+=1
            require(c.put('/api/datasets/'+peer['id'],json=peer_update))
            assert c.post('/api/workspace/plans',json={'dataset_id':d['id'],'query':'核对'+comparison['payload']['period']+'企业对照',
                'execution':{},'comparison_artifact':ref}).status_code==409
            old_comparison_run=require(c.get('/api/runs/'+comparison_run['id']))
            assert old_comparison_run['result']['comparison_artifact']==frozen_comparison
            action_rows=require(c.get('/api/workspace/actions'))['items']
            impacted=next(x for x in action_rows if x['id']==comparison_action['id'])
            assert impacted['payload']==comparison_action['payload']
            assert any(r['code'].startswith('comparison_') for r in impacted['source_impact']['reasons'])
            require(c.delete('/api/workspace/comparisons/'+ref['id'],params={'identity_id':'','version':ref['version']}))
            assert require(c.get('/api/runs/'+comparison_run['id']))['result']['comparison_artifact']==frozen_comparison
            record('双企业共同季度对照→版本冻结→明确批准Agent→报告引用→另一企业修订/清理→行动适用性变化且历史不改写')
            with c.stream('GET','/api/runs/'+run['id']+'/events') as response:
                assert response.status_code==200 and response.headers['content-type'].startswith('text/event-stream')
                text='\n'.join(response.iter_lines())
            ids=[int(l.split(':',1)[1]) for l in text.splitlines() if l.startswith('id:')]
            assert ids==sorted(set(ids)) and ids and 'event: end' in text
            mid=ids[len(ids)//2]
            with c.stream('GET','/api/runs/'+run['id']+'/events',headers={'Last-Event-ID':str(mid)}) as response:tail='\n'.join(response.iter_lines())
            resumed=[int(l.split(':',1)[1]) for l in tail.splitlines() if l.startswith('id:')];assert resumed==[i for i in ids if i>mid]
            assert c.get('/api/runs/'+run['id']+'/events',headers={'Last-Event-ID':'bad'}).status_code==422
            record('真实HTTP流式SSE、单调事件ID、Last-Event-ID精确续读与非法游标拒绝')
            # Explicitly pause while queued, hard-kill, restart, then resume from the durable state.
            paused=None
            for attempt in range(8):
                target=approve(c,plan(c,d,query='检查经营报表，验证中断边界'))
                response=c.post('/api/workspace/runs/'+target['id']+'/control',json={'version':1,'action':'pause'})
                if response.status_code==200:
                    row=wait_run(c,target['id']);control=require(c.get('/api/workspace/runs/'+target['id']+'/runtime'))
                    if control['state']=='paused':paused=(row,control);break
            assert paused,'Could not acquire a pause boundary; this check must not be reported as passed'
            before=paused[1];srv.stop(hard=True);srv.start()
            after=require(c.get('/api/workspace/runs/'+paused[0]['id']+'/runtime'));assert after['state']=='paused'
            require(c.post('/api/workspace/runs/'+paused[0]['id']+'/control',json={'version':after['control']['version'],'action':'resume'}))
            resumed_run=wait_run(c,paused[0]['id']);assert resumed_run['result']
            checkpoints=require(c.get('/api/workspace/runs/'+resumed_run['id']+'/runtime'))['checkpoints'];assert len(checkpoints)==len({x['node_id'] for x in checkpoints})
            assert require(c.get('/api/workspace/runs/'+resumed_run['id']+'/audit'))['ledger']['valid']
            record('安全暂停→真实SIGKILL进程退出→重启持久状态→显式继续→无重复节点产物')
            # Three distinct numeric inputs; strategy improvement uses human labels, not generated scores.
            runs=[]
            for i in range(3):
                data=copy.deepcopy(d['payload']);data.pop('verification',None);data.pop('input_amount_unit',None);data['name']='策略回放合成数据'+str(i);data['periods'][-1]['revenue']+=i*10000
                ds=require(c.post('/api/datasets',json=data),201);rr=wait_run(c,approve(c,plan(c,ds,execution={'local_recovery':False}))['id']);assert rr['result']
                require(c.post('/api/workspace/runs/'+rr['id']+'/assessment',json={'verdict':'needs_revision','note':'人工验收要求明确增加反向证据对照步骤','expected_capabilities':['quant','counterevidence'],'consent_replay':True}));runs.append(rr)
            old_plan=plan(c,d)
            proposed=require(c.post('/api/workspace/evolution/propose'),201);evaluation=proposed['evaluation'];assert evaluation['payload']['eligible'],evaluation
            active=require(c.post('/api/workspace/strategies/'+proposed['candidate']['id']+'/activate',json={'evaluation_id':evaluation['id'],'expected_active_version':0}))
            assert c.post('/api/workspace/plans/'+old_plan['id']+'/execute',json={'version':old_plan['version'],'fingerprint':old_plan['payload']['fingerprint']}).status_code==409
            assert any(n['id']=='counterevidence' for n in plan(c,d)['payload']['nodes'])
            require(c.post('/api/workspace/strategies/rollback',json={'expected_active_version':active['version']}))
            assert not any(n['id']=='counterevidence' for n in plan(c,d)['payload']['nodes'])
            assert require(c.get('/api/runs/'+runs[0]['id']))['result']==runs[0]['result']
            record('真实报告验收→自动提出策略→逐例回放与保留组→明确激活→旧计划失效→回滚；历史结果不变')
            # Cross-workspace source lifecycle over real HTTP, not only direct TestClient calls.
            experiment=require(c.post('/api/workspace/experiments',json={'dataset_id':d['id'],'dataset_version':d['version'],'dataset_hash':d['content_hash'],
                'name':'真实HTTP链路隔离情景','kind':'scenario','price_change':.05,'fixed_cost_share':.2,'assumptions':'仅用于隔离验收的明确情景假设'}),201)
            selected=plan(c,d,experiment={'id':experiment['id'],'version':experiment['version'],'hash':experiment['experiment_hash']},execution={})
            linked_run=wait_run(c,approve(c,selected)['id']);assert linked_run['result']['adaptive']['mathematical_outputs']['sensitivity']['experiment']['id']==experiment['id']
            body={'request_id':'http-lifecycle-action','dataset_id':d['id'],'run_id':linked_run['id'],'source_ref':{'kind':'report','run_id':linked_run['id']},
                'title':'真实HTTP报告跟进行动','acceptance':'保存原始依据并记录人工核验说明'}
            action=require(c.post('/api/workspace/actions',json=body),201)
            assert require(c.post('/api/workspace/actions',json=body),201)['id']==action['id']
            watch=require(c.post('/api/services/watches',json={'request_id':'http-lifecycle-watch','title':'行动关联指标跟踪','dataset_id':d['id'],
                'metric':'gross_margin','operator':'lt','threshold':.99,'stale_after_days':1460,'source_ref':{'kind':'action','action_id':action['id'],'action_version':action['version'],'action_hash':action['object_hash']}}),201)
            tracking=require(c.get('/api/services/tracking'));assert any(a['payload']['rule_id']==watch['id'] for a in tracking['alerts'])
            spec={k:watch['payload'][k] for k in ('title','identity_id','dataset_id','metric','operator','threshold','active','stale_after_days','expires_at')}
            unchanged=require(c.put('/api/services/watches/'+watch['id'],json={**spec,'version':watch['version']}));assert unchanged['version']==watch['version']
            assert len(require(c.get('/api/services/tracking'))['alerts'])==len(tracking['alerts'])
            action=require(c.put('/api/workspace/actions/'+action['id']+'/status',json={'version':action['version'],'status':'in_progress'}))
            action=require(c.put('/api/workspace/actions/'+action['id']+'/status',json={'version':action['version'],'status':'done','note':'已核对隔离测试凭证并明确其局限','evidence_ids':[e['id']]}))
            assert action['payload']['history'][-1]['evidence_snapshots'][0]['content_hash']==e['content_hash']
            feedback=require(c.get('/api/workspace/runs/'+linked_run['id']+'/assessment'))['review_context'];assert feedback['related_actions'][0]['status']=='done'
            require(c.post('/api/workspace/runs/'+linked_run['id']+'/assessment',json={'verdict':'useful','note':'已参考关联行动的实际验收记录','expected_capabilities':['quant','sensitivity'],'consent_replay':True,'review_context_hash':feedback['hash']}))
            original_report=linked_run['result'];original_action=copy.deepcopy(action['payload'])
            revised=copy.deepcopy(d['payload']);revised.pop('verification',None);revised.pop('input_amount_unit',None);revised.update(version=d['version'],notes='真实HTTP跨工作区修订核验')
            require(c.put('/api/datasets/'+d['id'],json=revised))
            stale={**body,'request_id':'http-historical-action'}
            assert c.post('/api/workspace/actions',json=stale).status_code==409
            stale['source_ref']={**stale['source_ref'],'allow_historical':True}
            historical=require(c.post('/api/workspace/actions',json=stale),201);assert historical['payload']['provenance']['dataset_version']==1
            current_action=next(x for x in require(c.get('/api/workspace/actions'))['items'] if x['id']==action['id'])
            assert current_action['payload']==original_action and current_action['source_impact']['state']=='changed'
            assert require(c.get('/api/runs/'+linked_run['id']))['result']==original_report
            require(c.delete('/api/workspace/archive/import_stage/'+stage['id'],params={'version':2}))
            revision=require(c.get('/api/workspace/datasets/'+d['id']+'/revisions'))['items'][0]
            assert revision['import_receipt']['payload']['import_context']['source_file_sha256']
            require(c.delete('/api/evidence/'+e['id'],params={'version':e['version']}))
            after=next(x for x in require(c.get('/api/workspace/actions'))['items'] if x['id']==action['id'])
            assert after['payload']==original_action and after['acceptance_impact']['state']=='changed'
            assert require(c.get('/api/account/export'))['data']['dataset_import_receipts']
            record('真实HTTP来源→保存实验→批准Agent→报告→行动→指标跟踪→证据验收→人工反馈；修订/清理后历史冻结与当前失效分离')
            # Short read-load probe, not an SLA or capacity claim.
            def get_one(i):
                t=time.perf_counter();res=c.get(['/api/datasets','/api/workspace/evolution','/api/ops','/api/workspace/runs/'+run['id']+'/runtime'][i%4]);assert res.status_code==200;return (time.perf_counter()-t)*1000
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:latencies=list(pool.map(get_one,range(64)))
            ys=sorted(latencies);timings={'read_requests':len(ys),'concurrency':4,'p50_ms':round(ys[len(ys)//2],2),'p95_ms':round(ys[int(len(ys)*.95)-1],2),'max_ms':round(max(ys),2)}
            record('实际本机四并发64次跨工作区读取全部成功；单独保留延迟样本')
            expected_backup=require(c.get('/api/account/export'))['data']
            dbpath=Path(temp)/'product'/'lidian.sqlite3'
            target=Path(temp)/'backup.sqlite';proc=subprocess.run([sys.executable,'scripts/backup.py','--source',str(dbpath),'--output',str(target)],cwd=ROOT,env={**os.environ,'DATA_DIR':str(srv.dir)},capture_output=True,text=True)
            # backup CLI contract is checked below, not inferred from a file name.
            if proc.returncode!=0:raise AssertionError(proc.stdout+proc.stderr)
            receipt=json.loads(proc.stdout)
            assert receipt['integrity']=='ok' and receipt['foreign_key_check']=='ok'
            assert receipt['sha256']==hashlib.sha256(target.read_bytes()).hexdigest()
            with contextlib.closing(sqlite3.connect(target)) as db:
                assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
                assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
            record('运行中的SQLite一致性备份、副本结构及外键检查、回执散列核对')
            # Follow the documented independent-directory recovery procedure.
            # Starting a second HTTP service against this copy proves more than
            # checking that a backup file exists or opens in sqlite3.
            restored_dir=Path(temp)/'restored';restored_dir.mkdir()
            shutil.copyfile(target,restored_dir/'lidian.sqlite3')
            restored=ProductServer(restored_dir)
            try:
                restored.start()
                with httpx.Client(base_url=restored.base,trust_env=False,timeout=10) as recovered, httpx.Client(base_url=restored.base,trust_env=False,timeout=10) as outsider:
                    for client,account in ((recovered,a),(outsider,b)):
                        login=require(client.post('/api/auth/login',json={'email':account['user']['email'],'password':'Real-HTTP-acceptance-password'}))
                        client.headers.update({'X-CSRF-Token':login['csrf']})
                    actual=require(recovered.get('/api/account/export'))['data']
                    for table in ('datasets','dataset_revisions','dataset_import_receipts','runs','workspace_objects','agent_artifacts','event_integrity'):
                        assert actual[table]==expected_backup[table],table
                    assert outsider.get('/api/runs/'+linked_run['id']).status_code==404
                    assert outsider.get('/api/datasets/'+d['id']).status_code==404
                    recovered_audit=require(recovered.get('/api/workspace/runs/'+linked_run['id']+'/audit'))
                    assert recovered_audit['ledger']['valid'] and recovered_audit['report_hash_valid']
                    recovered_data=require(recovered.get('/api/datasets/'+d['id']))
                    new_revision=require(recovered.post('/api/workspace/datasets/'+d['id']+'/restore',json={'version':recovered_data['version'],'target_revision':1}))
                    assert new_revision['version']==recovered_data['version']+1 and new_revision['payload']==d['payload']
                    assert require(recovered.get('/api/runs/'+linked_run['id']))['result']==original_report
                    assert require(c.get('/api/datasets/'+d['id']))['version']==recovered_data['version']
                record('备份→全新DATA_DIR实际Uvicorn重启→重新登录→完整来源/报告核对→跨账户拒绝→历史恢复新修订且原库/报告不变')
            finally:restored.stop()
        finally:srv.stop()
      evidence.update({'passed':True,'checks':checks,'load_probe':timings,'elapsed_seconds':round(time.time()-start,2)})
    except Exception as exc:
      evidence.update({'passed':False,'checks':checks,'error':repr(exc),'load_probe':timings,'elapsed_seconds':round(time.time()-start,2)})
      raise
    finally:(OUT/'full-chain-http.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':main()
