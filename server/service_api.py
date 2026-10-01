"""Authenticated product-service APIs. All objects are owned by the current account."""
from __future__ import annotations
from .schemas import MAX_SAFE_INTEGER
import asyncio
import hmac
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request, Query, Response
from .security import require_user, fail, password_matches, COOKIE, check_version
from .store import digest, encode, now
from . import workspace_store as ws
from .service_contracts import (IdentitySpec, ThreadCreate, CopilotMessage, ProposalRequest,
    ProposalConfirm, WatchSpec, AlertAck, PrivateConnection, ConnectionRemove, SessionRevoke)
from .identities import resolve_identity, PERSPECTIVES
from .connections import scoped_providers
from .copilot import make_thread, read_thread, send_message, propose, confirm_proposal, evaluate_watches
from .business_provenance import resolve_source, with_source_impact

router=APIRouter(prefix='/api/services',tags=['Identity, Copilot and Security'])


def storeof(request):
    return request.app.state.store


async def reauthenticate(request,user,password):
    # Limits offline password guessing and bounds CPU work across all sensitive routes.
    limiter=request.app.state.search_limiter
    if not limiter.allow('reauth:'+user['id'],10,60):
        fail('RATE_LIMITED','敏感操作验证过于频繁，请稍后再试',429)
    async with request.app.state.hash_slots:
        valid=await asyncio.to_thread(password_matches,password,user['password_hash'])
    if not valid:
        fail('INVALID_CREDENTIALS','当前密码错误，未执行敏感操作',401)


def recheck_reauthentication(request,user):
    """Call under the mutation lock after the expensive password check completes."""
    current=require_user(request)  # Recheck this exact cookie/session, including revocation and CSRF.
    if current['id']!=user['id'] or not hmac.compare_digest(current['password_hash'],user['password_hash']):
        fail('CREDENTIALS_CHANGED','凭据或登录会话在验证期间已改变，请重新登录后操作',401)
    return current


def verify_datasets(store,user_id,ids):
    for id in ids:
        if not store.owned('datasets',user_id,id):
            fail('NOT_FOUND','身份范围包含不存在或无权访问的数据',404)


def versioned_row(store,user_id,kind,id,version):
    row=ws.get(store,user_id,kind,id)
    check_version(row,version)
    return row


@router.get('/identities')
def identities(request:Request,user=Depends(require_user)):
    return {'items':ws.objects(storeof(request),user['id'],'identity'),'perspectives':PERSPECTIVES,
        'boundary':'服务身份共享本账户数据访问权限，分别管理研究上下文。切换身份不会创建独立组织或扩大权限。'}


@router.post('/identities',status_code=201)
def create_identity(body:IdentitySpec,request:Request,user=Depends(require_user)):
    store=storeof(request)
    if body.version:
        fail('VERSION_CONFLICT','新身份版本必须为0',409)
    with store.transaction() as db:
        verify_datasets(store,user['id'],body.dataset_ids)
        if len(ws.objects(store,user['id'],'identity'))>=12:
            fail('RESOURCE_LIMIT','每个账户最多12个服务身份',409)
        return ws.save(store,db,user['id'],'identity',body.model_dump(mode='json',exclude={'version'}))


@router.put('/identities/{id}')
def update_identity(id:str,body:IdentitySpec,request:Request,user=Depends(require_user)):
    store=storeof(request)
    with store.transaction() as db:
        old=ws.get(store,user['id'],'identity',id);verify_datasets(store,user['id'],body.dataset_ids)
        return ws.save(store,db,user['id'],'identity',body.model_dump(mode='json',exclude={'version'}),key=old['natural_key'],expected=body.version)


@router.delete('/identities/{id}')
def delete_identity(id:str,request:Request,version:int|None=Query(None,ge=1,le=MAX_SAFE_INTEGER),user=Depends(require_user)):
    store=storeof(request)
    with store.transaction() as db:
        versioned_row(store,user['id'],'identity',id,version)
        db.execute('DELETE FROM workspace_objects WHERE id=? AND user_id=?',(id,user['id']))
        store.audit(db,user['id'],'identity',id,'deleted',{'historical_snapshots':'retained','pending_plans':'invalidated'})
    return {'ok':True,'notice':'该身份的新调用已停止。历史报告和独立会话快照保留，可分别清理。'}


@router.get('/threads')
def threads(request:Request,identity_id:str=Query('',max_length=80),dataset_id:str=Query('',max_length=80),user=Depends(require_user)):
    store=storeof(request);resolve_identity(store,user['id'],identity_id,dataset_id)
    rows=store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='assistant_thread' AND json_extract(payload,'$.identity_id')=? AND json_extract(payload,'$.dataset_id')=? ORDER BY updated_at DESC,id LIMIT 100",(user['id'],identity_id,dataset_id))
    return {'items':rows}


@router.post('/threads',status_code=201)
def create_thread(body:ThreadCreate,request:Request,user=Depends(require_user)):
    return make_thread(storeof(request),user,body)


@router.get('/threads/{id}')
def get_thread(id:str,request:Request,user=Depends(require_user)):
    return read_thread(storeof(request),user,id)


@router.delete('/threads/{id}')
def delete_thread(id:str,request:Request,version:int|None=Query(None,ge=1,le=MAX_SAFE_INTEGER),user=Depends(require_user)):
    store=storeof(request)
    with store.transaction() as db:
        versioned_row(store,user['id'],'assistant_thread',id,version)
        # Deleting chat history must not silently cancel or erase independently approved runs.
        db.execute("DELETE FROM workspace_objects WHERE user_id=? AND kind='assistant_proposal' AND json_extract(payload,'$.thread_id')=?",(user['id'],id))
        db.execute('DELETE FROM workspace_objects WHERE user_id=? AND id=?',(user['id'],id))
        store.audit(db,user['id'],'assistant_thread',id,'deleted',{'independent_runs':'retained'})
    return {'ok':True,'notice':'助手会话和提案副本已删除；已派发任务和报告是独立记录，需要另行清理。'}


@router.post('/threads/{id}/messages',status_code=201)
def add_message(id:str,body:CopilotMessage,request:Request,user=Depends(require_user)):
    return send_message(storeof(request),user,id,body)


@router.post('/threads/{id}/proposals',status_code=201)
def add_proposal(id:str,body:ProposalRequest,request:Request,user=Depends(require_user)):
    return propose(storeof(request),user,id,body,request.app.state.settings,request.app.state.providers)


@router.get('/proposals/{id}')
def get_proposal(id:str,request:Request,user=Depends(require_user)):
    store=storeof(request)
    return with_source_impact(store,user['id'],ws.get(store,user['id'],'assistant_proposal',id))


@router.post('/proposals/{id}/confirm')
def confirm(id:str,body:ProposalConfirm,request:Request,user=Depends(require_user)):
    return confirm_proposal(storeof(request),user,id,body,request.app.state.settings,request.app.state.providers)


@router.delete('/proposals/{id}')
def discard_proposal(id:str,request:Request,version:int|None=Query(None,ge=1,le=MAX_SAFE_INTEGER),user=Depends(require_user)):
    store=storeof(request)
    with store.transaction() as db:
        row=versioned_row(store,user['id'],'assistant_proposal',id,version)
        if row['payload']['status']=='executed':
            fail('PROPOSAL_EXECUTED','提案已经执行，不能用删除提案撤销独立结果',409)
        p={**row['payload'],'status':'discarded'}
        return ws.save(store,db,user['id'],'assistant_proposal',p,key=row['natural_key'],expected=row['version'])


@router.get('/tracking')
def tracking(request:Request,identity_id:str=Query('',max_length=80),user=Depends(require_user)):
    store=storeof(request);resolve_identity(store,user['id'],identity_id)
    result=evaluate_watches(store,user['id'])
    rules=[with_source_impact(store,user['id'],x) for x in ws.objects(store,user['id'],'watch') if x['payload'].get('identity_id','')==identity_id]
    alerts=[with_source_impact(store,user['id'],x) for x in ws.objects(store,user['id'],'alert') if x['payload'].get('identity_id','')==identity_id]
    ids={x['id'] for x in rules}
    return {**result,'evaluations':[x for x in result['evaluations'] if x['rule_id'] in ids], 'rules':rules,'alerts':alerts,
            'schedule':'服务运行时每60秒检查本地已保存数据；关闭服务后不监控，不调用付费模型'}


@router.get('/history')
def orphan_history(request:Request,offset:int=Query(0,ge=0,le=MAX_SAFE_INTEGER),limit:int=Query(100,ge=1,le=200),user=Depends(require_user)):
    """Account-owned archived context without evaluating rules or restoring access."""
    store=storeof(request)
    identities={r['id']:r for r in ws.objects(store,user['id'],'identity')}
    datasets={r['id']:r for r in store.items('datasets',user['id'])}
    rows=store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind IN ('assistant_thread','action','watch','alert','comparison') ORDER BY updated_at DESC,id",(user['id'],))
    items=[]
    for row in rows:
        p=row['payload'];identity_id=p.get('identity_id','');dataset_id=p.get('dataset_id','')
        if row['kind']=='comparison':
            from .saved_comparisons import public_record
            archived=public_record(store,user['id'],row)
            impact=archived['source_impact']
            if impact['state']!='unavailable':continue
            reason='；'.join(r['message'] for r in impact['reasons'])
            items.append({**archived,'title':p['name'],'company':'、'.join(m['company'] for m in p['members']),
                          'dataset_id':'','identity_id':identity_id,'status':'archived','active':False,
                          'read_only':True,'archived_mode':True,'unavailable_reason':reason,'history_reason':reason})
            continue
        identity=identities.get(identity_id);reason='';code=''
        if identity_id and not identity:
            reason='原服务身份已删除；仅供查阅历史，不恢复原权限';code='identity_unavailable'
        elif identity and identity['payload']['dataset_ids'] and dataset_id and dataset_id not in identity['payload']['dataset_ids']:
            reason='企业已移出原服务身份范围；仅供查阅历史';code='identity_scope_removed'
        elif dataset_id and dataset_id not in datasets:
            reason='原企业数据已删除；仅供查阅已保存的历史';code='dataset_removed'
        if not reason:continue
        impact=with_source_impact(store,user['id'],row)['source_impact']
        if code not in {r['code'] for r in impact['reasons']}:
            impact={**impact,'state':'unavailable','reasons':impact['reasons']+[{'code':code,'message':reason}]}
        provenance=p.get('provenance') or {}
        items.append({'id':row['id'],'kind':row['kind'],'version':row['version'],'payload':p,
            'created_at':row['created_at'],'updated_at':row['updated_at'],
            'title':p.get('title',''),'company':p.get('company',provenance.get('company','')),
            'dataset_id':dataset_id,'identity_id':identity_id,'status':p.get('status'),
            'active':p.get('active'),'source_impact':impact,'read_only':True,
            'archived_mode':True,'unavailable_reason':reason,'history_reason':reason})
    page=items[offset:offset+limit];has_more=offset+limit<len(items)
    return {'items':page,'has_more':has_more,'next_offset':offset+limit if has_more else None,
        'read_only':True,'scope':'account_owned_orphan_history','external_calls':0}


@router.post('/watches',status_code=201)
def create_watch(body:WatchSpec,request:Request,user=Depends(require_user)):
    store=storeof(request)
    if body.version:
        fail('VERSION_CONFLICT','新跟踪规则版本必须为0',409)
    with store.transaction() as db:
        creation=body.model_dump(mode='json',exclude={'version','request_id'});request_hash=digest(creation)
        key='request:'+body.request_id if body.request_id else None
        old=ws.keyed(store,user['id'],'watch',key) if key else None
        if old:
            if old['payload'].get('creation_request_hash')!=request_hash:
                fail('IDEMPOTENCY_CONFLICT','同一提交标识不能对应不同的跟踪内容或来源',409)
            return with_source_impact(store,user['id'],old)
        resolve_identity(store,user['id'],body.identity_id,body.dataset_id);verify_datasets(store,user['id'],[body.dataset_id])
        provenance=resolve_source(store,user['id'],body.identity_id,body.dataset_id,body.source_ref)
        payload={**body.model_dump(mode='json',exclude={'version','source_ref','request_id'}),'provenance':provenance,'changes':[],'evaluation_revision':1,
            'creation_request_id':body.request_id,'creation_request_hash':request_hash,'creation_request':creation}
        return with_source_impact(store,user['id'],ws.save(store,db,user['id'],'watch',payload,key=key))


@router.put('/watches/{id}')
def update_watch(id:str,body:WatchSpec,request:Request,user=Depends(require_user)):
    store=storeof(request)
    with store.transaction() as db:
        old=ws.get(store,user['id'],'watch',id)
        resolve_identity(store,user['id'],body.identity_id,body.dataset_id);verify_datasets(store,user['id'],[body.dataset_id])
        check_version(old,body.version)
        if body.source_ref is not None or body.dataset_id!=old['payload']['dataset_id'] or body.identity_id!=old['payload'].get('identity_id',''):
            fail('SOURCE_IMMUTABLE','跟踪规则的来源、企业和服务身份不可改写，请另建规则',409)
        values=body.model_dump(mode='json',exclude={'version','source_ref','request_id'})
        changes={k:{'before':old['payload'].get(k),'after':v} for k,v in values.items() if old['payload'].get(k)!=v}
        if not changes:return with_source_impact(store,user['id'],old)
        prior=old['payload'].get('changes',[])
        if changes and len(prior)>=100:fail('WATCH_HISTORY_LIMIT','规则变更记录达到上限，请另建规则',409)
        history=prior+[{'at':now(),'actor_id':user['id'],'version':old['version']+1,'fields':changes}] if changes else prior
        evaluation_fields={'metric','operator','threshold','stale_after_days','expires_at'}
        revision=old['payload'].get('evaluation_revision',old['version'])+int(bool(evaluation_fields.intersection(changes)))
        payload={**old['payload'],**values,'changes':history,'evaluation_revision':revision}
        return with_source_impact(store,user['id'],ws.save(store,db,user['id'],'watch',payload,key=old['natural_key'],expected=body.version))


@router.delete('/watches/{id}')
def delete_watch(id:str,request:Request,version:int|None=Query(None,ge=1,le=MAX_SAFE_INTEGER),user=Depends(require_user)):
    store=storeof(request)
    with store.transaction() as db:
        versioned_row(store,user['id'],'watch',id,version)
        db.execute('DELETE FROM workspace_objects WHERE id=? AND user_id=?',(id,user['id']))
        store.audit(db,user['id'],'watch',id,'deleted')
    return {'ok':True}


@router.post('/alerts/{id}/acknowledge')
def acknowledge_alert(id:str,body:AlertAck,request:Request,user=Depends(require_user)):
    store=storeof(request)
    with store.transaction() as db:
        row=ws.get(store,user['id'],'alert',id)
        return ws.save(store,db,user['id'],'alert',{**row['payload'],'acknowledged':True,'acknowledged_at':now(),'acknowledgement':body.note},key=row['natural_key'],expected=body.version)


@router.delete('/alerts/{id}')
def delete_alert(id:str,request:Request,version:int|None=Query(None,ge=1,le=MAX_SAFE_INTEGER),user=Depends(require_user)):
    store=storeof(request)
    with store.transaction() as db:
        row=versioned_row(store,user['id'],'alert',id,version)
        if not row['payload'].get('acknowledged'):
            fail('ACK_REQUIRED','先核对提醒，再清理历史',409)
        # A separate minimal receipt prevents regeneration while actually freeing
        # alert capacity. Receipts cascade when the parent watch is deleted.
        db.execute('DELETE FROM workspace_objects WHERE id=? AND user_id=?',(id,user['id']))
        store.audit(db,user['id'],'alert',id,'archived')
        return {'ok':True}


@router.get('/connections')
def connections(request:Request,user=Depends(require_user)):
    service=request.app.state.providers
    return {'items':scoped_providers(service,user['id']).status(),
        'storage':'private encrypted credentials; not present in exports',
        'vault_available':bool(getattr(service,'vault',None))}


@router.post('/connections',status_code=201)
async def create_connection(body:PrivateConnection,request:Request,user=Depends(require_user)):
    await reauthenticate(request,user,body.password)
    vault=getattr(request.app.state.providers,'vault',None)
    if not vault:
        fail('CONNECTION_CONFIGURATION_UNAVAILABLE','当前服务提供器不支持私有连接配置',503)
    with storeof(request)._lock:
        recheck_reauthentication(request,user)
        return vault.save(user['id'],body)


@router.put('/connections/{id}')
async def update_connection(id:str,body:PrivateConnection,request:Request,user=Depends(require_user)):
    await reauthenticate(request,user,body.password)
    vault=getattr(request.app.state.providers,'vault',None)
    if not vault:
        fail('CONNECTION_CONFIGURATION_UNAVAILABLE','当前提供器不支持配置',503)
    with storeof(request)._lock:
        recheck_reauthentication(request,user)
        return vault.save(user['id'],body,id)


@router.post('/connections/{id}/remove')
async def remove_connection(id:str,body:ConnectionRemove,request:Request,user=Depends(require_user)):
    await reauthenticate(request,user,body.password)
    vault=getattr(request.app.state.providers,'vault',None)
    if not vault:
        fail('CONNECTION_CONFIGURATION_UNAVAILABLE','当前提供器不支持配置',503)
    with storeof(request)._lock:
        recheck_reauthentication(request,user)
        vault.delete(user['id'],id,body.version)
    return {'ok':True,'notice':'连接已删除；未发送的后续调用将停止。已经发送的远程请求无法撤回。'}


@router.get('/security')
def security_status(request:Request,user=Depends(require_user)):
    store=storeof(request);settings=request.app.state.settings
    token_hash=digest(request.cookies.get(COOKIE,''))
    rows=store.all('SELECT s.token_hash,s.expires,d.id,d.agent,d.created_at FROM auth_sessions s LEFT JOIN session_details d ON d.token_hash=s.token_hash WHERE s.user_id=? AND s.expires>? ORDER BY s.expires DESC',(user['id'],time.time()))
    sessions=[{'id':r['id'] or digest(r['token_hash']+'session-id'),'current':r['token_hash']==token_hash,
        'agent':r['agent'] or '旧会话，未记录客户端','created_at':r['created_at'],
        'expires_at':datetime.fromtimestamp(r['expires'],timezone.utc).isoformat()} for r in rows]
    return {'sessions':sessions,'checks':[
        {'id':'identity','name':'账户与对象权限','status':'enabled','detail':'所有业务读写按当前账户验证；服务身份不是提权入口'},
        {'id':'csrf','name':'跨站写入保护','status':'enabled','detail':'服务端会话、CSRF、来源校验；模型没有写库或代码执行工具'},
        {'id':'tls','name':'公网部署模式','status':'enabled' if settings.production else 'local_only','detail':'当前生产HTTPS模式' if settings.production else '本地开发模式，不应直接对公网开放'},
        {'id':'providers','name':'模型真实连通','status':'not_verified','detail':'保存连接不会发出探测或付费请求；每次在计划中确认调用'},
        {'id':'dependencies','name':'联网依赖安全审计','status':'not_verified','detail':'本页不伪造安全扫描或无漏洞认证；以实际CI审计结果为准'}],
        'time':now()}


@router.post('/sessions/revoke')
async def revoke_session(body:SessionRevoke,request:Request,response:Response,user=Depends(require_user)):
    await reauthenticate(request,user,body.password)
    store=storeof(request);current=digest(request.cookies.get(COOKIE,''));removed=0;removed_current=False
    with store.transaction() as db:
        recheck_reauthentication(request,user)
        rows=store.all('SELECT s.token_hash,d.id FROM auth_sessions s LEFT JOIN session_details d ON d.token_hash=s.token_hash WHERE s.user_id=?',(user['id'],))
        for r in rows:
            public_id=r['id'] or digest(r['token_hash']+'session-id')
            should=(body.others and r['token_hash']!=current) or (not body.others and body.id==public_id)
            if should:
                removed+=db.execute('DELETE FROM auth_sessions WHERE token_hash=? AND user_id=?',(r['token_hash'],user['id'])).rowcount
                removed_current|=r['token_hash']==current
        if not body.others and not removed:
            fail('NOT_FOUND','会话已失效或无权管理',404)
        store.audit(db,user['id'],'session','selected','revoked',{'count':removed,'current':removed_current})
    if removed_current:
        response.delete_cookie(COOKIE,path='/')
    return {'ok':True,'removed':removed,'relogin_required':removed_current}
