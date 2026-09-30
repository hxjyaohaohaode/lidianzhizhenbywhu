from __future__ import annotations
from .clock import utc_today
import asyncio
import hmac
import json
import os
import re
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from fastapi import FastAPI,Depends,Request,Response,UploadFile,File,Form,Query,HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse,FileResponse,StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import ValidationError
from . import __version__
from .config import Settings
from .schemas import Register,Login,Preferences,RoleSwitch,Dataset,DatasetUpdate,Conversation,RunRequest,Evidence,EvidenceCapture,EvidenceMetadata,FetchEvidence,Memory,MemoryUpdate,Feedback,PasswordChange,Scenario,CompareRequest,SearchRequest,BatchDelete
from .store import Store,encode,digest,uid,now
from .security import require_user,fail,password_hash,password_matches,public_user,issue_session,COOKIE,DUMMY_HASH,RateLimiter,check_version
from .models import normalize,calculate,scenario,MODEL_VERSION
from .imports import import_dataset,parse_document_isolated
from .retrieval import retrieve_indexed
from .network import fetch_public
from .providers import ProviderService
from .connections import ConnectionVault, scoped_providers
from .research import PublicResearch
from .workflows import Worker,TERMINAL,STEPS

ROOT=Path(__file__).resolve().parent.parent

class ProcessLock:
    def __init__(self,path):self.path=path;self.handle=None
    def acquire(self):
        self.path.parent.mkdir(parents=True,exist_ok=True);self.handle=open(self.path,'a+b')
        try:
            if os.name=='nt':
                import msvcrt
                self.handle.seek(0);self.handle.write(b'0');self.handle.flush();self.handle.seek(0);msvcrt.locking(self.handle.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except (OSError,BlockingIOError):
            self.handle.close();self.handle=None;raise RuntimeError('同一数据库只允许一个服务进程。请勿多worker或同时启动两个实例。') from None
    def release(self):
        if self.handle:self.handle.close();self.handle=None

class Guard:
    def __init__(self,app,settings):self.app=app;self.settings=settings;self.limiter=RateLimiter()
    async def __call__(self,scope,receive,send):
        if scope['type']!='http':return await self.app(scope,receive,send)
        header_items=[(k.lower(),v) for k,v in scope['headers']]
        headers=dict(header_items);path=scope['path'];request_id=uid();method=scope['method']
        async def reject(status,code,message):
            # Early admission errors receive the same privacy/security defaults.
            h={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
               'Referrer-Policy':'no-referrer','X-Request-ID':request_id,
               'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}
            if self.settings.production:h['Strict-Transport-Security']='max-age=31536000'
            return await JSONResponse({'error':{'code':code,'message':message},'request_id':request_id},status_code=status,headers=h)(scope,receive,send)
        # Reject ambiguous authorities and Windows UNC/drive paths before routing,
        # URL construction, filesystem resolution, or credential-bearing network I/O.
        hosts=[v for k,v in header_items if k==b'host']
        if len(hosts)!=1 or any(c<=32 or c==127 for c in hosts[0]) or any(c in hosts[0] for c in (b'/',b'\\',b'@')):
            return await reject(400,'INVALID_AUTHORITY','请求地址格式无效。')
        if not path.startswith('/') or path.startswith('//') or '\\' in path or any(ord(c)<32 or ord(c)==127 for c in path) or any(':' in part for part in path.split('/')):
            return await reject(400,'INVALID_PATH','请求路径格式无效。')
        # Never let the proxy, CSRF guard and application disagree about which
        # security-sensitive header or request framing is authoritative.
        for name in (b'content-length',b'transfer-encoding',b'origin',b'cookie',b'x-csrf-token',b'sec-fetch-site'):
            if sum(k==name for k,_ in header_items)>1:
                return await reject(400,'AMBIGUOUS_HEADERS','重复的安全或请求长度字段。')
        if b'content-length' in headers and b'transfer-encoding' in headers:
            return await reject(400,'AMBIGUOUS_FRAMING','请求长度与传输编码不能同时提供。')
        if path.startswith('/api/'):
            ip=(scope.get('client') or ('unknown',))[0];auth=path.startswith('/api/auth/');key=ip+(':login' if auth else ':api')
            if not self.limiter.allow(key,30 if auth else 600):return await reject(429,'RATE_LIMITED','请求过于频繁，请稍后重试。')
            if method not in ('GET','HEAD','OPTIONS'):
                origin=headers.get(b'origin',b'').decode(errors='replace')
                if origin and origin!=self.settings.origin:return await reject(403,'ORIGIN_REJECTED','请求来源不受信任。')
                if headers.get(b'sec-fetch-site')==b'cross-site':return await reject(403,'ORIGIN_REJECTED','禁止跨站写入。')
        if method in ('POST','PUT','PATCH','DELETE'):
            try:length=int(headers.get(b'content-length',b'0'))
            except ValueError:return await reject(400,'INVALID_LENGTH','请求长度无效。')
            if length<0 or length>self.settings.max_body_bytes+8192:return await reject(413,'BODY_TOO_LARGE','请求体超过2MB限制。')
            parts=[];size=0;deadline=time.monotonic()+20
            while True:
                try:msg=await asyncio.wait_for(receive(),timeout=max(.001,deadline-time.monotonic()))
                except TimeoutError:return await reject(408,'BODY_TIMEOUT','请求上传超时，请重试。')
                if msg['type']=='http.disconnect':return
                chunk=msg.get('body',b'');size+=len(chunk)
                if size>self.settings.max_body_bytes+8192:return await reject(413,'BODY_TOO_LARGE','请求体超过2MB限制。')
                parts.append(chunk)
                if not msg.get('more_body',False):break
            replayed=False;original_receive=receive
            async def replay():
                nonlocal replayed
                if not replayed:replayed=True;return {'type':'http.request','body':b''.join(parts),'more_body':False}
                return await original_receive()
            receive=replay
        async def secured(message):
            if message['type']=='http.response.start':
                h=list(message.get('headers',[]));h.extend([(b'x-request-id',request_id.encode()),(b'x-content-type-options',b'nosniff'),(b'referrer-policy',b'no-referrer'),(b'x-frame-options',b'DENY'),(b'permissions-policy',b'camera=(), microphone=(), geolocation=()'),(b'content-security-policy',b"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")])
                if path.startswith('/api/'):h.append((b'cache-control',b'no-store'))
                if self.settings.production:h.append((b'strict-transport-security',b'max-age=31536000'))
                message['headers']=h
            await send(message)
        scope.setdefault('state',{})['request_id']=request_id
        await self.app(scope,receive,secured)

class TextHTML(HTMLParser):
    def __init__(self):super().__init__();self.skip=0;self.parts=[]
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style','noscript'):self.skip+=1
    def handle_endtag(self,tag):
        if tag in ('script','style','noscript') and self.skip:self.skip-=1
        if tag in ('p','div','li','h1','h2','h3','tr','br'):self.parts.append('\n')
    def handle_data(self,data):
        if not self.skip:self.parts.append(data)

def make_app(settings=None,providers=None,worker_enabled=True):
    settings=settings or Settings()
    @asynccontextmanager
    async def lifespan(app):
        settings.validate();lock=ProcessLock(settings.data_dir/'server.lock');lock.acquire();store=None
        try:
            store=Store(settings.data_dir/'lidian.sqlite3');app.state.store=store
            app.state.providers=providers or ProviderService(settings.provider_timeout)
            if isinstance(app.state.providers,ProviderService):
                app.state.providers.vault=ConnectionVault(store,settings.data_dir)
            app.state.worker=Worker(store,app.state.providers,settings)
            app.state.hash_slots=asyncio.Semaphore(4);app.state.research=PublicResearch(settings.allowed_hosts)
            app.state.search_limiter=RateLimiter()
            async def local_tracking_loop():
                from .copilot import evaluate_watches
                while True:
                    await asyncio.sleep(60)
                    owners=store.all("SELECT DISTINCT user_id FROM workspace_objects WHERE kind='watch'")
                    for owner in owners:
                        try:await asyncio.to_thread(evaluate_watches,store,owner['user_id'])
                        except Exception as exc:
                            print(encode({'event':'tracking_check_failed','class':type(exc).__name__}),flush=True)
            tracking_task=None
            if worker_enabled:
                await app.state.worker.start()
                tracking_task=asyncio.create_task(local_tracking_loop())
            try:yield
            finally:
                if tracking_task:
                    tracking_task.cancel()
                    try:await tracking_task
                    except asyncio.CancelledError:pass
                if worker_enabled:await app.state.worker.stop()
        finally:
            if store:store.close()
            lock.release()
    app=FastAPI(title='锂电智诊 API',version=__version__,lifespan=lifespan,docs_url=None,openapi_url='/api/openapi.json',redoc_url=None)
    from .workspace_api import router
    app.include_router(router)
    from .autonomy_api import router as autonomy_router
    app.include_router(autonomy_router)
    from .service_api import router as service_router
    app.include_router(service_router)
    app.state.settings=settings
    host=urlsplit(settings.origin).hostname
    app.add_middleware(TrustedHostMiddleware,allowed_hosts=[host] if settings.production else list(set([host,'localhost','127.0.0.1','testserver'])))
    app.add_middleware(Guard,settings=settings)

    @app.exception_handler(HTTPException)
    async def http_error(request,exc):
        detail=exc.detail if isinstance(exc.detail,dict) else {'code':'HTTP_ERROR','message':str(exc.detail)}
        return JSONResponse({'error':detail,'request_id':getattr(request.state,'request_id','')},status_code=exc.status_code)
    @app.exception_handler(RequestValidationError)
    async def validation_error(request,exc):
        errors=[{'path':'.'.join(str(x) for x in e['loc']),'message':e['msg']} for e in exc.errors()[:30]]
        return JSONResponse({'error':{'code':'VALIDATION_ERROR','message':'输入格式不正确。','details':errors},'request_id':getattr(request.state,'request_id','')},status_code=422)
    @app.exception_handler(ValueError)
    async def invalid_value(request,exc):
        return JSONResponse({'error':{'code':'INVALID_VALUE','message':str(exc)[:300]},'request_id':getattr(request.state,'request_id','')},status_code=422)
    @app.exception_handler(Exception)
    async def unhandled(request,exc):
        print(encode({'event':'request_error','class':type(exc).__name__,'request_id':getattr(request.state,'request_id','')}),flush=True)
        return JSONResponse({'error':{'code':'INTERNAL_ERROR','message':'服务发生异常；请保存请求编号并重试。'},'request_id':getattr(request.state,'request_id','')},status_code=500)
    def store(request):return request.app.state.store
    def owned(db,table,user,id):
        item=db.owned(table,user['id'],id)
        if not item:fail('NOT_FOUND','资源不存在或无访问权限。',404)
        return item
    async def bounded_hash(fn,*args):
        async with app.state.hash_slots:return await asyncio.to_thread(fn,*args)

    @app.get('/api/docs',include_in_schema=False)
    def api_reference():return FileResponse(ROOT/'web/api-docs.html',headers={'Cache-Control':'no-cache'})
    @app.get('/api/health')
    def health(request: Request):
        store(request).one('SELECT 1 AS ok');return {'application':'lidian-workbench','status':'ready','version':__version__,'database':'ready','mode':'single_process','time':now()}
    @app.get('/api/capabilities')
    def capabilities(request: Request,user=Depends(require_user)):
        from .studio import AGENTS
        from .imports import pdf_status
        return {'pdf':pdf_status(),'studio_agents':AGENTS,'version':__version__,'models_version':MODEL_VERSION,'providers':scoped_providers(app.state.providers,user['id']).status(),'public_search':app.state.research.status(),'agent_plan':STEPS,'external_hosts':settings.allowed_hosts,'network':'opt_in','live_market_feed':'not_connected','model_calibration':'not_validated','deployed_as':'single_process_sqlite','limits':{'upload_bytes':2000000,'context_characters':settings.max_context_chars,'external_calls_per_run':8,'concurrent_runs':settings.concurrency},'data_rules':['产品不预置演示业务数据','来源不等于独立核验','未配置模型时不伪造AI回答']}
    @app.post('/api/auth/register',status_code=201)
    async def register(body: Register,request: Request,response: Response):
        if settings.invite_code and not hmac.compare_digest(body.invitation.encode(),settings.invite_code.encode()):fail('INVALID_INVITATION','邀请码无效。',403)
        db=store(request);id=uid();at=now();ph=await bounded_hash(password_hash,body.password)
        prefs={'role':body.role,'theme':'light','amount_unit':'wan','risk_appetite':'medium','horizon':'long','interests':[],'watchlist':[],'memory_enabled':True}
        try:
            with db.transaction() as conn:conn.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)',(id,body.email,ph,body.name,encode(prefs),1,at,at))
        except sqlite3.IntegrityError:fail('ACCOUNT_EXISTS','无法注册该邮箱。',409)
        return issue_session(request,response,db.one('SELECT * FROM users WHERE id=?',(id,)))
    @app.post('/api/auth/login')
    async def login(body: Login,request: Request,response: Response):
        db=store(request);user=db.one('SELECT * FROM users WHERE email=?',(body.email.lower(),))
        valid=await bounded_hash(password_matches,body.password,user['password_hash'] if user else DUMMY_HASH)
        if not user or not valid:fail('INVALID_CREDENTIALS','邮箱或密码错误。',401)
        return issue_session(request,response,user)
    @app.get('/api/auth/me')
    def me(request: Request,user=Depends(require_user)):return {'user':public_user(user),'csrf':request.state.csrf}
    @app.post('/api/auth/logout')
    def logout(request: Request,response: Response,user=Depends(require_user)):
        with store(request).transaction() as db:db.execute('DELETE FROM auth_sessions WHERE token_hash=?',(digest(request.cookies[COOKIE]),))
        response.delete_cookie(COOKIE,path='/');return {'ok':True}
    @app.post('/api/auth/password')
    async def change_password(body: PasswordChange,request: Request,response: Response,user=Depends(require_user)):
        if not await bounded_hash(password_matches,body.current_password,user['password_hash']):fail('INVALID_CREDENTIALS','当前密码错误。',401)
        ph=await bounded_hash(password_hash,body.new_password)
        with store(request).transaction() as db:
            require_user(request)
            changed=db.execute('UPDATE users SET password_hash=?,updated_at=? WHERE id=? AND password_hash=?',
                (ph,now(),user['id'],user['password_hash'])).rowcount
            if not changed:fail('CREDENTIALS_CHANGED','凭据已改变，请重新登录后再修改。',409)
            db.execute('DELETE FROM auth_sessions WHERE user_id=?',(user['id'],))
        response.delete_cookie(COOKIE,path='/');return {'ok':True,'relogin_required':True}
    @app.put('/api/preferences')
    def preferences(body: Preferences,request: Request,user=Depends(require_user)):
        db=store(request);data=body.model_dump(exclude={'version','name'})
        with db.transaction() as conn:
            count=conn.execute('UPDATE users SET preferences=?,name=?,version=version+1,updated_at=? WHERE id=? AND version=?',(encode(data),body.name,now(),user['id'],body.version)).rowcount
            if not count:fail('VERSION_CONFLICT','资料已在其他窗口更新，请刷新后重新修改。',409)
            db.audit(conn,user['id'],'preferences',user['id'],'updated',{'version':body.version+1})
        return {'user':public_user(db.one('SELECT * FROM users WHERE id=?',(user['id'],)))}

    @app.put('/api/preferences/role')
    def switch_role(body: RoleSwitch,request: Request,user=Depends(require_user)):
        db=store(request)
        with db.transaction() as conn:
            updated={**user['preferences'],'role':body.role}
            count=conn.execute('UPDATE users SET preferences=?,version=version+1,updated_at=? WHERE id=? AND version=?',
                               (encode(updated),now(),user['id'],body.version)).rowcount
            if not count:fail('VERSION_CONFLICT','工作视角已在其他窗口更新，请刷新后重试。',409)
            db.audit(conn,user['id'],'preferences',user['id'],'role_changed',{'role':body.role,'version':body.version+1})
        return {'user':public_user(db.one('SELECT * FROM users WHERE id=?',(user['id'],)))}

    @app.get('/api/datasets')
    def datasets(request: Request,user=Depends(require_user)):return {'items':store(request).items('datasets',user['id'])}
    @app.post('/api/datasets',status_code=201)
    def dataset_create(body: Dataset,request: Request,user=Depends(require_user)):
        if body.source_kind=='sample':fail('SAMPLE_DISABLED','工作区不接收合成演示业务数据',422)
        return store(request).create('datasets',user['id'],normalize(body))
    @app.get('/api/datasets/{id}')
    def dataset_get(id: str,request: Request,user=Depends(require_user)):return owned(store(request),'datasets',user,id)
    @app.put('/api/datasets/{id}')
    def dataset_update(id: str,body: DatasetUpdate,request: Request,user=Depends(require_user)):
        if body.source_kind=='sample':fail('SAMPLE_DISABLED','工作区不接收合成演示业务数据',422)
        db=store(request);owned(db,'datasets',user,id);payload=normalize(Dataset.model_validate(body.model_dump(exclude={'version'})))
        result=db.update('datasets',user['id'],id,body.version,payload)
        if not result:fail('VERSION_CONFLICT','数据已被更新；本次修改未覆盖新版本。',409)
        return result
    @app.delete('/api/datasets/{id}')
    def dataset_delete(id: str,request: Request,version: int|None=Query(None,ge=1),user=Depends(require_user)):
        db=store(request);owned(db,'datasets',user,id)
        try:db.delete('datasets',user['id'],id,version)
        except sqlite3.IntegrityError:fail('DATASET_IN_USE','数据集被诊断记录引用；请先删除相关会话。',409)
        return {'ok':True}
    @app.get('/api/datasets/{id}/analysis')
    def dataset_analysis(id: str,request: Request,comparison: str=Query('year_over_year',pattern='^(previous|year_over_year)$'),user=Depends(require_user)):
        return calculate(owned(store(request),'datasets',user,id)['payload'],comparison)
    @app.get('/api/datasets/{id}/export')
    def dataset_export(id: str,request: Request,user=Depends(require_user)):
        data=dict(owned(store(request),'datasets',user,id)['payload']);data.pop('verification',None);data.pop('input_amount_unit',None)
        return Response(encode(data),media_type='application/json',headers={'Content-Disposition':'attachment; filename="dataset.json"'})
    @app.post('/api/import/dataset',status_code=201)
    async def dataset_import(request: Request,file: UploadFile=File(...),company: str=Form(...,max_length=200),amount_unit: str=Form('yuan'),user=Depends(require_user)):
        data=await file.read(2000001)
        try:parsed=await asyncio.to_thread(import_dataset,file.filename or '',data,company,amount_unit)
        except (ValueError,ValidationError,UnicodeError,KeyError) as exc:fail('IMPORT_REJECTED',str(exc)[:500],422)
        if parsed.source_kind=='sample':fail('SAMPLE_DISABLED','工作区不接收合成演示业务数据',422)
        return store(request).create('datasets',user['id'],normalize(parsed))
    @app.post('/api/examples/dataset',status_code=410)
    def example(request: Request,user=Depends(require_user)):
        fail('EXAMPLES_REMOVED','演示数据已从产品移除，请导入自己的数据',410)
    @app.get('/api/import/template')
    def template(user=Depends(require_user)):return FileResponse(ROOT/'examples/template.csv',filename='financial-template.csv',media_type='text/csv')
    @app.post('/api/scenarios')
    def scenario_api(body: Scenario,request: Request,user=Depends(require_user)):
        db=store(request)
        if body.run_id:
            run=owned(db,'runs',user,body.run_id)
            if run['dataset_id']!=body.dataset_id:fail('SNAPSHOT_MISMATCH','任务和数据集不匹配。',422)
            data=run['snapshot']['dataset'];version=run['snapshot']['dataset_version']
        else:
            row=owned(db,'datasets',user,body.dataset_id);data=row['payload'];version=row['version']
        return {**scenario(data,body.price_change,body.cost_change,body.volume_change),'dataset_version':version,'input_hash':digest(data),'run_id':body.run_id}
    @app.post('/api/compare')
    def compare(body: CompareRequest,request: Request,user=Depends(require_user)):
        from .saved_comparisons import calculate_comparison
        data=[owned(store(request),'datasets',user,id) for id in body.dataset_ids]
        return calculate_comparison(data,body.comparison)

    @app.get('/api/conversations')
    def conversations(request: Request,user=Depends(require_user)):return {'items':store(request).items('conversations',user['id'])}
    @app.post('/api/conversations',status_code=201)
    def new_conversation(body: Conversation,request: Request,user=Depends(require_user)):return store(request).create('conversations',user['id'],body.model_dump())
    @app.get('/api/conversations/{id}/messages')
    def messages(id: str,request: Request,user=Depends(require_user)):
        db=store(request);owned(db,'conversations',user,id)
        return {'items':db.all('SELECT * FROM messages WHERE session_id=? AND user_id=? ORDER BY created_at LIMIT 500',(id,user['id']))}
    @app.delete('/api/conversations/{id}')
    async def delete_conversation(id: str,request: Request,version: int|None=Query(None,ge=1),user=Depends(require_user)):
        db=store(request)
        with db._lock:
            row=owned(db,'conversations',user,id);check_version(row,version)
            for run in db.all("SELECT id FROM runs WHERE session_id=? AND user_id=? AND state IN ('queued','running')",(id,user['id'])):
                app.state.worker.cancel(user['id'],run['id'])
            db.delete('conversations',user['id'],id,version)
        return {'ok':True}
    @app.post('/api/conversations/delete-batch')
    async def delete_batch(body: BatchDelete,request: Request,user=Depends(require_user)):
        db=store(request)
        with db.transaction() as conn:
            rows=[owned(db,'conversations',user,id) for id in body.ids]
            for row in rows:check_version(row,body.versions.get(row['id']))
            if set(body.versions)!=set(body.ids):fail('VERSION_CONFLICT','版本集合必须与所选会话一致。',409)
            for id in body.ids:
                for row in db.all("SELECT id FROM runs WHERE session_id=? AND state IN ('queued','running')",(id,)):
                    conn.execute("UPDATE runs SET state='cancelled',updated_at=? WHERE id=?",(now(),row['id']))
                    task=app.state.worker.active.get(row['id'])
                    if task:task.cancel()
                db._delete_current_reviews(conn,'conversations',user['id'],id)
                conn.execute('DELETE FROM conversations WHERE id=? AND user_id=?',(id,user['id']));db.audit(conn,user['id'],'conversations',id,'deleted_batch')
        return {'deleted':len(body.ids)}
    @app.post('/api/runs',status_code=202)
    def submit(body: RunRequest,request: Request,user=Depends(require_user)):
        if body.use_llm:
            fail('PLAN_REQUIRED','外部模型执行需要在协同工作台预览计划并明确授权',409)
        db=store(request);key=request.headers.get('idempotency-key','')
        if not re.fullmatch('[A-Za-z0-9_-]{8,100}',key):fail('IDEMPOTENCY_REQUIRED','请提供8至100位幂等键。',422)
        request_hash=digest(body.model_dump())
        with db.transaction() as conn:
            existing=db.one('SELECT * FROM runs WHERE user_id=? AND idempotency_key=?',(user['id'],key))
            if existing:
                if existing['request_hash']!=request_hash:fail('IDEMPOTENCY_CONFLICT','相同幂等键对应不同请求。',409)
                return existing
            session=owned(db,'conversations',user,body.session_id);dataset=owned(db,'datasets',user,body.dataset_id)
            if session['payload'].get('company') and session['payload']['company']!=dataset['payload']['company']:fail('COMPANY_MISMATCH','会话绑定企业与数据集不一致，请新建会话。',409)
            if not session['payload'].get('company'):conn.execute('UPDATE conversations SET payload=? WHERE id=?',(encode({**session['payload'],'company':dataset['payload']['company']}),body.session_id))
            if db.one('SELECT count(*) AS n FROM runs WHERE session_id=?',(body.session_id,))['n']>=200:fail('SESSION_FULL','会话已达200次诊断，请新建会话。',409)
            if db.one('SELECT count(*) AS n FROM runs WHERE user_id=?',(user['id'],))['n']>=1000:fail('RUN_QUOTA','已达1000次存储上限，请先导出并删除旧会话。',409)
            if db.one("SELECT count(*) AS n FROM runs WHERE user_id=? AND state IN ('queued','running')",(user['id'],))['n']>=settings.max_queued_per_user:fail('QUEUE_FULL','未完成任务过多，请先取消或等待现有任务。',429)
            citations=retrieve_indexed(db,user['id'],body.query+' '+dataset['payload']['company'],6,company=dataset['payload']['company']);memory=[]
            if body.include_memory and user['preferences'].get('memory_enabled',True):
                for m in db.items('memories',user['id']):
                    p=m['payload']
                    if not p['approved'] or (p.get('expires_at') and p['expires_at']<utc_today().isoformat()):continue
                    if p['role'] not in ('all',user['preferences'].get('role')):continue
                    if p['company'] and p['company']!=dataset['payload']['company']:continue
                    memory.append({'id':m['id'],'version':m['version'],'text':p['text'],'kind':p['kind']})
                    if len(memory)>=8:break
            history=db.all('SELECT role,payload FROM messages WHERE session_id=? AND user_id=? ORDER BY created_at DESC LIMIT 8',(body.session_id,user['id']))
            history=[{'role':h['role'],'text':h['payload']['text'][:600]} for h in reversed(history)]
            snapshot={'history':history,'dataset':dataset['payload'],'dataset_version':dataset['version'],'dataset_hash':dataset['content_hash'],'citations':citations,'memory':memory,'preferences':user['preferences']}
            id,at=uid(),now()
            conn.execute('INSERT INTO runs(id,user_id,session_id,dataset_id,state,payload,snapshot,created_at,updated_at,idempotency_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(id,user['id'],body.session_id,body.dataset_id,'queued',encode(body.model_dump()),encode(snapshot),at,at,key,request_hash))
            conn.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',(uid(),user['id'],body.session_id,id,'user',encode({'text':body.query}),at))
            conn.execute('UPDATE conversations SET updated_at=?,version=version+1 WHERE id=?',(at,body.session_id))
            db.event(conn,id,'queued',{'snapshot_hash':digest(snapshot),'dataset_version':dataset['version'],'mode':body.mode});db.audit(conn,user['id'],'runs',id,'queued')
        return db.owned('runs',user['id'],id)
    @app.get('/api/runs')
    def runs(request: Request,offset: int=Query(0,ge=0),limit: int=Query(200,ge=1,le=200),user=Depends(require_user)):
        items=store(request).all('SELECT * FROM runs WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',(user['id'],limit+1,offset))
        return {'items':[{k:v for k,v in r.items() if k not in ('snapshot','result')} for r in items[:limit]],'has_more':len(items)>limit,'next_offset':offset+min(len(items),limit)}
    @app.get('/api/runs/{id}')
    def get_run(id: str,request: Request,user=Depends(require_user)):return owned(store(request),'runs',user,id)
    @app.post('/api/runs/{id}/cancel')
    async def cancel(id: str,request: Request,user=Depends(require_user)):
        owned(store(request),'runs',user,id);app.state.worker.cancel(user['id'],id);return store(request).owned('runs',user['id'],id)
    @app.get('/api/runs/{id}/events')
    async def events(id: str,request: Request,after: int=Query(0,ge=0),user=Depends(require_user)):
        db=store(request);owned(db,'runs',user,id);raw=request.headers.get('last-event-id','')
        if raw:
            if not raw.isdigit():fail('INVALID_CURSOR','事件游标无效。',422)
            after=max(after,int(raw))
        async def generate():
            cursor=after;heartbeat=time.monotonic()
            while not await request.is_disconnected():
                session=db.one('SELECT expires FROM auth_sessions WHERE token_hash=? AND user_id=?',(digest(request.cookies[COOKIE]),user['id']))
                if not session or session['expires']<=time.time():yield 'event: auth_expired\ndata: {}\n\n';return
                for event in db.all('SELECT * FROM run_events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 200',(id,cursor)):
                    cursor=event['seq'];yield f"id: {cursor}\nevent: trace\ndata: {encode(event)}\n\n"
                current=db.owned('runs',user['id'],id)
                if not current:return
                if current['state'] in TERMINAL and not db.one('SELECT seq FROM run_events WHERE run_id=? AND seq>? LIMIT 1',(id,cursor)):
                    yield f'event: end\ndata: {encode({"state":current["state"]})}\n\n';return
                if time.monotonic()-heartbeat>15:yield ': heartbeat\n\n';heartbeat=time.monotonic()
                await asyncio.sleep(.3)
        return StreamingResponse(generate(),media_type='text/event-stream',headers={'Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'})
    @app.get('/api/runs/{id}/trace')
    def trace(id: str,request: Request,user=Depends(require_user)):
        db=store(request);owned(db,'runs',user,id);return {'items':db.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq',(id,))}
    @app.get('/api/runs/{id}/export')
    def export_report(id: str,request: Request,format: str=Query('json',pattern='^(json|md)$'),user=Depends(require_user)):
        from .report_export import report_payload, markdown_report
        db=store(request)
        # The archived report and export-time reviews are read consistently.
        with db.transaction():
            run=owned(db,'runs',user,id)
            if not run['result']:fail('NOT_READY','任务尚无可导出结果。',409)
            events=db.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq',(id,))
            reviews=db.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='claim_review' AND json_extract(payload,'$.run_id')=? ORDER BY created_at,id",(user['id'],id))
            assessment=db.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='assessment' AND natural_key=?",(user['id'],id))
            result=report_payload(run,events,reviews,assessment)
        if format=='json':content=encode(result);media='application/json'
        else:content=markdown_report(result);media='text/markdown'
        return Response(content,media_type=media,headers={'Content-Disposition':f'attachment; filename="diagnosis-{id[:8]}.{format}"'})

    @app.get('/api/evidence')
    def evidence_list(request: Request,user=Depends(require_user)):return {'items':store(request).items('evidence',user['id'])}
    # Process-bound receipts authenticate search origin; clients cannot mint provenance.
    evidence_receipt_key=os.urandom(32)
    def search_receipt(user,payload):
        fields={k:payload.get(k,'').strip() for k in ('title','source_url','text','retrieved_at')}
        return hmac.new(evidence_receipt_key,encode({'user':user['id'],**fields}).encode(),'sha256').hexdigest()
    def create_evidence(db,user,payload,company='',global_scope=False):
        from . import workspace_store as ws
        if company and global_scope:fail('INVALID_SCOPE','企业范围与通用范围不能同时选择。',422)
        h=digest(payload['text'])
        with db.transaction() as conn:
            old=db.one('SELECT * FROM evidence WHERE user_id=? AND content_hash=?',(user['id'],h))
            if old:return {**old,'deduplicated':True,'notice':'相同原文已存在；保留已有来源、元数据和企业范围。'}
            if conn.execute('SELECT count(*) FROM evidence WHERE user_id=?',(user['id'],)).fetchone()[0]>=200:fail('RESOURCE_LIMIT','资料已达200条上限，请先整理。',409)
            id,at=uid(),now()
            conn.execute('INSERT INTO evidence(id,user_id,payload,version,content_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(id,user['id'],encode(payload),1,h,at,at))
            db.index_evidence(conn,id,user['id'],payload['text'])
            db.audit(conn,user['id'],'evidence',id,'created',{'version':1})
            scoped=bool(company or global_scope)
            ws.save(db,conn,user['id'],'evidence_review',{'company':company,'global_scope':global_scope,'status':'unreviewed' if scoped else 'rejected','tags':[],'stance':'context','note':'' if scoped else '尚未选择适用企业或明确通用范围；暂不参与检索。','expires_at':None},key=id)
        return db.owned('evidence',user['id'],id)
    @app.post('/api/evidence',status_code=201)
    def evidence_add(body: EvidenceCapture,request: Request,user=Depends(require_user)):
        payload=body.model_dump(mode='json',exclude={'company','global_scope','search_receipt','retrieved_at'})
        if body.search_receipt:
            if not hmac.compare_digest(body.search_receipt,search_receipt(user,{**payload,'retrieved_at':body.retrieved_at})):fail('INVALID_SEARCH_RECEIPT','搜索结果来源凭据无效或服务已重启；未保存为搜索来源。',422)
            payload.update(source_kind='search_snippet',verification='search_snippet_unverified',retrieved_at=body.retrieved_at)
        else:
            if body.retrieved_at:fail('INVALID_SEARCH_RECEIPT','检索时间必须由服务端搜索结果提供。',422)
            payload.update(source_kind='user_provided',verification='unverified')
        return create_evidence(store(request),user,payload,body.company,body.global_scope)
    @app.post('/api/evidence/import',status_code=201)
    async def evidence_import(request: Request,file: UploadFile=File(...),title: str=Form(''),company: str=Form('',max_length=200),global_scope: bool=Form(False),source_url: str=Form(''),published_at: str=Form(''),user=Depends(require_user)):
        try:
            text=await asyncio.wait_for(asyncio.to_thread(parse_document_isolated,file.filename or '',await file.read(2000001)),14)
            parsed=Evidence(title=title.strip() or Path(file.filename or '文档').name[:200],text=text,source_url=source_url,published_at=published_at or None)
        except (ValueError,UnicodeError,TimeoutError) as exc:fail('DOCUMENT_REJECTED',str(exc)[:300] or '解析超时。',422)
        return create_evidence(store(request),user,{**parsed.model_dump(mode='json'),'original_filename':Path(file.filename or '').name[:200],'source_kind':'uploaded_document','verification':'unverified'},company.strip(),global_scope)
    @app.post('/api/evidence/fetch',status_code=201)
    async def evidence_fetch(body: FetchEvidence,request: Request,user=Depends(require_user)):
        if body.company and body.global_scope:fail('INVALID_SCOPE','企业范围与通用范围不能同时选择。',422)
        try:
            raw,kind=await asyncio.wait_for(asyncio.to_thread(fetch_public,body.url,settings.allowed_hosts),12)
            if kind=='application/pdf':text=await asyncio.wait_for(asyncio.to_thread(parse_document_isolated,'source.pdf',raw),14)
            elif kind=='text/html':
                parser=TextHTML();parser.feed(raw.decode('utf-8',errors='replace'));text='\n'.join(x.strip() for x in parser.parts if x.strip())
            else:text=raw.decode('utf-8',errors='strict')
            parsed=Evidence(title=body.title,text=text,source_url=body.url,published_at=body.published_at)
        except Exception as exc:fail('SOURCE_UNAVAILABLE',f'来源获取失败（{type(exc).__name__}）；未插入样例或伪造证据。',502)
        return create_evidence(store(request),user,{**parsed.model_dump(mode='json'),'original_source_url':body.url,'source_kind':'public_document','verification':'fetched_not_fact_checked','fetched_at':now()},body.company,body.global_scope)
    @app.put('/api/evidence/{id}/metadata')
    def evidence_metadata(id: str,body: EvidenceMetadata,request: Request,user=Depends(require_user)):
        db=store(request)
        with db.transaction() as conn:
            row=owned(db,'evidence',user,id);check_version(row,body.version)
            payload={**row['payload'],**body.model_dump(mode='json',exclude={'version'})}
            # Capture origin is immutable even when the user corrects display metadata.
            payload['original_source_url']=row['payload'].get('original_source_url',row['payload'].get('source_url',''))
            payload['metadata_edited_at']=now()
            conn.execute('UPDATE evidence SET payload=?,version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=?',(encode(payload),now(),id,user['id'],body.version))
            db.audit(conn,user['id'],'evidence',id,'updated',{'version':body.version+1,'fields':['title','source_url','published_at']})
            # Existing plan bindings include the review revision, not mutable display metadata.
            from . import workspace_store as ws
            review=ws.keyed(db,user['id'],'evidence_review',id)
            if review:ws.save(db,conn,user['id'],'evidence_review',review['payload'],key=id,expected=review['version'])
        return db.owned('evidence',user['id'],id)
    @app.delete('/api/evidence/{id}')
    def evidence_delete(id: str,request: Request,version: int|None=Query(None,ge=1),user=Depends(require_user)):
        db=store(request);owned(db,'evidence',user,id);db.delete('evidence',user['id'],id,version)
        return {'ok':True,'notice':'已从未来检索移除；历史报告引用快照保留。删除相关会话可一并删除历史快照。'}
    @app.get('/api/retrieval')
    def retrieval(request: Request,q: str=Query(...,min_length=1,max_length=2000),user=Depends(require_user)):
        return {'items':retrieve_indexed(store(request),user['id'],q),'strategy':'持久FTS5候选 + 中文词项重排 + 证据不足拒答','embedding':False}
    @app.post('/api/research/search')
    async def public_search(body: SearchRequest,request: Request,user=Depends(require_user)):
        if not app.state.research.status()['configured']:fail('SEARCH_UNCONFIGURED','服务端未配置TAVILY_API_KEY；未发出请求。',503)
        if not app.state.search_limiter.allow(user['id'],10,3600):fail('SEARCH_BUDGET','每账户每小时最多10次外部搜索。',429)
        db=store(request);id=uid()
        with db.transaction() as conn:db.audit(conn,user['id'],'research',id,'dispatched',{'query_hash':digest(body.query),'provider':'tavily','max_results':5,'consent':True})
        try:result=await asyncio.wait_for(asyncio.to_thread(app.state.research.search,body.query),15)
        except Exception as exc:
            with db.transaction() as conn:db.audit(conn,user['id'],'research',id,'failed',{'error_class':type(exc).__name__})
            fail('SEARCH_FAILED','外部搜索未完成；未插入证据、重试付费请求或使用样例。',502)
        with db.transaction() as conn:db.audit(conn,user['id'],'research',id,'completed',{'items':len(result['items']),'rejected':result['rejected'],'credits_reported':result['credits_reported']})
        for item in result['items']:item['search_receipt']=search_receipt(user,item)
        return result

    @app.get('/api/memories')
    def memories(request: Request,user=Depends(require_user)):return {'items':store(request).items('memories',user['id'])}
    @app.post('/api/memories',status_code=201)
    def memory_create(body: Memory,request: Request,user=Depends(require_user)):
        from .identities import resolve_identity
        resolve_identity(store(request),user['id'],body.identity_id)
        return store(request).create('memories',user['id'],body.model_dump(mode='json'))
    @app.put('/api/memories/{id}')
    def memory_update(id: str,body: MemoryUpdate,request: Request,user=Depends(require_user)):
        db=store(request)
        from .identities import resolve_identity
        resolve_identity(db,user['id'],body.identity_id)
        owned(db,'memories',user,id);row=db.update('memories',user['id'],id,body.version,body.model_dump(mode='json',exclude={'version'}))
        if not row:fail('VERSION_CONFLICT','记忆已在其他窗口更新。',409)
        return row
    @app.delete('/api/memories/{id}')
    def memory_delete(id: str,request: Request,version: int|None=Query(None,ge=1),user=Depends(require_user)):
        db=store(request);owned(db,'memories',user,id);db.delete('memories',user['id'],id,version)
        return {'ok':True,'notice':'后续任务不再召回。已提交任务审计快照需删除对应会话才能一并移除。'}
    @app.post('/api/feedback',status_code=201)
    def feedback(body: Feedback,request: Request,user=Depends(require_user)):
        db=store(request);owned(db,'runs',user,body.run_id);id=uid()
        with db.transaction() as conn:
            conn.execute('INSERT INTO feedback VALUES(?,?,?,?,?)',(id,user['id'],body.run_id,encode(body.model_dump()),now()));db.audit(conn,user['id'],'feedback',id,'created',{'run_id':body.run_id})
        return {'id':id,'notice':'反馈已记录；不会自动篡改模型权重或已完成结论。'}
    @app.get('/api/sync')
    def sync(request: Request,after: int=Query(0,ge=0),limit: int=Query(100,ge=1,le=500),head: bool=False,user=Depends(require_user)):
        if head:
            cursor=store(request).one('SELECT COALESCE(MAX(seq),0) AS cursor FROM audit WHERE user_id=?',(user['id'],))['cursor']
            return {'items':[],'cursor':cursor,'has_more':False}
        rows=store(request).all('SELECT * FROM audit WHERE user_id=? AND seq>? ORDER BY seq LIMIT ?',(user['id'],after,limit+1));items=rows[:limit]
        return {'items':items,'cursor':items[-1]['seq'] if items else after,'has_more':len(rows)>limit}
    @app.get('/api/account/export')
    def account_export(request: Request,user=Depends(require_user)):
        from .exports import export_account
        export=export_account(store(request),user['id'])
        return Response(encode(export),media_type='application/json',headers={'Content-Disposition':'attachment; filename="lidian-private-backup.json"'})
    @app.delete('/api/account')
    async def account_delete(body: Login,request: Request,response: Response,user=Depends(require_user)):
        if body.email.lower()!=user['email'] or not await bounded_hash(password_matches,body.password,user['password_hash']):fail('INVALID_CREDENTIALS','账户验证失败。',401)
        db=store(request)
        with db._lock:
            require_user(request)
            current=db.one('SELECT password_hash FROM users WHERE id=?',(user['id'],))
            if not current or current['password_hash']!=user['password_hash']:
                fail('CREDENTIALS_CHANGED','凭据已改变，请重新登录后再删除账户。',409)
            for row in db.all("SELECT id FROM runs WHERE user_id=? AND state IN ('running','queued')",(user['id'],)):
                app.state.worker.cancel(user['id'],row['id'])
            with db.transaction() as conn:
                conn.execute('DELETE FROM conversations WHERE user_id=?',(user['id'],));conn.execute('DELETE FROM users WHERE id=?',(user['id'],))
        response.delete_cookie(COOKIE,path='/');return {'ok':True}
    @app.get('/api/ops')
    def ops(request: Request,user=Depends(require_user)):
        db=store(request)
        return {'run_states':db.all('SELECT state,count(*) AS count FROM runs WHERE user_id=? GROUP BY state',(user['id'],)),'resources':{t:db.one(f'SELECT count(*) AS n FROM {t} WHERE user_id=?',(user['id'],))['n'] for t in ('datasets','conversations','memories','evidence')},'scope':'current_user_only','queue_capacity':settings.max_queued_per_user,'live_checks':'not_performed'}
    @app.get('/images/logo.png',include_in_schema=False)
    def original_logo():return FileResponse(ROOT/'web/brand/logo.png')
    @app.get('/loading-video.mp4',include_in_schema=False)
    def original_intro():return FileResponse(ROOT/'web/brand/loading-video.mp4')
    @app.get('/')
    def index():return FileResponse(ROOT/'web/index.html',headers={'Cache-Control':'no-cache'})
    app.mount('/assets',StaticFiles(directory=ROOT/'web'),name='assets')
    return app

app=make_app()
