"""Workspace API: explicit preview/commit, plan consent, evidence review and execution follow-through."""
from __future__ import annotations
from .schemas import MAX_SAFE_INTEGER
import asyncio
import json
import hashlib
import math
import re
from datetime import date,datetime,timezone
from typing import Literal
from .connections import scoped_providers
from fastapi import APIRouter,Request,Depends,UploadFile,File,Form,Query
from fastapi.responses import Response
from .security import require_user,fail,check_version
from .schemas import Dataset
from .contracts import (CompanyProfile,PlanDraft,PlanConsent,EvidenceReview,ActionCreate,ActionEdit,ActionTransition,
    ExperimentRequest,SavedComparisonRequest,ImportPreview,RevisionRestore,ClaimReview,TaskTemplate,AssistantRequest,StageCommit,DismissInsight)
from .store import encode,digest,uid,now
from .models import normalize,calculate
from .analytics import quality_report,from_cumulative,dataset_diff,extended_scenario,forecast_baselines,lineage
from .imports import import_dataset,MalformedWorkbook
from .intelligence import build_insights,evidence_catalog,assistant_answer,profile_for,scoped_retrieve
from .studio import AGENTS,build_plan,dispatch_plan
from . import workspace_store as ws
from .identities import workspace_scope, scope_sql
from .business_provenance import resolve_source, with_source_impact, evidence_snapshots

router=APIRouter(prefix='/api/workspace',tags=['Workspace'])


def dbof(request):return request.app.state.store


def owned(store,user,table,id):
    row=store.owned(table,user['id'],id)
    if not row:fail('NOT_FOUND','资源不存在或无访问权限',404)
    return row


@router.get('/brief')
def brief(request:Request,identity_id:str|None=Query(None,max_length=80),dataset_id:str=Query('',max_length=80),user=Depends(require_user)):
    store=dbof(request);datasets,scope=workspace_scope(store,user['id'],identity_id,dataset_id);cards=[]
    for row in datasets:
        data=row['payload'];analysis=calculate(data)
        cards.append({'id':row['id'],'company':data['company'],'name':data['name'],'version':row['version'],
            'source_kind':data['source_kind'],'updated_at':row['updated_at'],'period':analysis['current_period'],
            'metrics':analysis['metrics'],'revenue':data['periods'][-1]['revenue'],
            'quality':quality_report(data),'profile':profile_for(store,user['id'],data['company'])})
    filters,args=scope_sql(scope,'dataset_id',"json_extract(snapshot,'$.identity.id')")
    runs=store.all("SELECT id,dataset_id,state,created_at,updated_at,error,json_object('query',json_extract(payload,'$.query')) AS payload FROM runs WHERE user_id=?"+filters+" ORDER BY created_at DESC,id DESC LIMIT 10",(user['id'],*args))
    actions=ws.objects(store,user['id'],'action',1000)
    companies={row['payload']['company'] for row in datasets}
    if scope['mode']=='identity':actions=[a for a in actions if a['payload'].get('identity_id','')==identity_id]
    if scope['mode']=='identity' or dataset_id:
        actions=[a for a in actions if a['payload'].get('dataset_id') in scope['dataset_ids'] or (not a['payload'].get('dataset_id') and (a['payload'].get('company') in companies or (not dataset_id and not a['payload'].get('company'))))]
    docs=evidence_catalog(store,user['id'])
    if scope['mode']=='identity' or dataset_id:docs=[d for d in docs if d['eligible'] and (not d['review'].get('company') or d['review']['company'] in companies)]
    return {'datasets':cards,'scope':scope,'insights':build_insights(store,user['id'],datasets,identity_id=identity_id or ''),'runs':runs,
        'counts':{'datasets':len(datasets),'evidence':len(docs),
            'actions_open':sum(a['payload']['status'] not in ('done','dismissed') for a in actions),
            'reports':store.one('SELECT count(*) AS n FROM runs WHERE user_id=? AND result IS NOT NULL'+filters,(user['id'],*args))['n']},
        'runtime':{'external_automation':False,'storage':'local_transactional','time':now()}}


@router.get('/agents')
def agents(request:Request,user=Depends(require_user)):
    return {'items':AGENTS,'providers':scoped_providers(request.app.state.providers,user['id']).status(),
        'policy':{'external_requires_plan':True,'default_external_calls':0,'max_calls':8,
            'llm_write_tools':[],'automatic_paid_retry':False,'automatic_provider_fallback':False,
            'context_character_limit':request.app.state.settings.max_context_chars}}


@router.get('/profiles')
def profiles(request:Request,user=Depends(require_user)):
    return {'items':ws.objects(dbof(request),user['id'],'profile')}


@router.post('/profiles')
def save_profile(body:CompanyProfile,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        return ws.save(store,db,user['id'],'profile',body.model_dump(mode='json',exclude={'version'}),key=body.company,expected=body.version)


@router.post('/plans',status_code=201)
def plan_create(body:PlanDraft,request:Request,user=Depends(require_user)):
    return build_plan(dbof(request),user,body,request.app.state.settings,request.app.state.providers)


@router.get('/plans')
def plans(request:Request,identity_id:str|None=Query(None,max_length=80),dataset_id:str=Query('',max_length=80),
          offset:int=Query(0,ge=0,le=1000),limit:int=Query(100,ge=1,le=100),user=Depends(require_user)):
    store=dbof(request);_,scope=workspace_scope(store,user['id'],identity_id,dataset_id)
    filters,args=scope_sql(scope,"json_extract(payload,'$.request.dataset_id')","json_extract(payload,'$.request.identity_id')")
    rows=store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='plan'"+filters+" ORDER BY updated_at DESC,id LIMIT ? OFFSET ?",(user['id'],*args,limit,offset))
    total=store.one("SELECT count(*) AS n FROM workspace_objects WHERE user_id=? AND kind='plan'"+filters,(user['id'],*args))['n']
    return {'items':[{k:v for k,v in row.items() if k!='payload'} | {'payload':{k:row['payload'][k] for k in ('status','request','max_calls','blockers','run_id','created_at')}} for row in rows],
        'total':total,'has_more':offset+len(rows)<total,'offset':offset,'limit':limit,'scope':scope}


@router.get('/plans/{id}')
def plan_get(id:str,request:Request,user=Depends(require_user)):
    return ws.get(dbof(request),user['id'],'plan',id)


@router.post('/plans/{id}/execute',status_code=202)
def plan_execute(id:str,body:PlanConsent,request:Request,user=Depends(require_user)):
    return dispatch_plan(dbof(request),user,id,body,request.app.state.settings,request.app.state.providers)


@router.post('/plans/{id}/cancel')
def plan_cancel(id:str,request:Request,version:int|None=Query(None,ge=1,le=MAX_SAFE_INTEGER),user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        row=ws.get(store,user['id'],'plan',id);p=row['payload']
        check_version(row,version)
        if p['status']=='dispatched':fail('PLAN_DISPATCHED','计划已经派发，请取消其运行任务',409)
        if p['status']=='cancelled':return row
        return ws.save(store,db,user['id'],'plan',{**p,'status':'cancelled'},key=row['natural_key'],expected=row['version'])


@router.get('/templates')
def templates(request:Request,user=Depends(require_user)):
    return {'items':ws.objects(dbof(request),user['id'],'template')}


@router.post('/templates',status_code=201)
def template_add(body:TaskTemplate,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:return ws.save(store,db,user['id'],'template',body.model_dump(mode='json'))


@router.delete('/templates/{id}')
def template_delete(id:str,request:Request,version:int|None=Query(None,ge=1,le=MAX_SAFE_INTEGER),user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        check_version(ws.get(store,user['id'],'template',id),version)
        db.execute('DELETE FROM workspace_objects WHERE id=? AND user_id=?',(id,user['id']));store.audit(db,user['id'],'template',id,'deleted')
    return {'ok':True}


@router.get('/datasets/{id}/quality')
def dataset_quality(id:str,request:Request,user=Depends(require_user)):
    store=dbof(request);row=owned(store,user,'datasets',id)
    return {**quality_report(row['payload']),'dataset_id':id,'version':row['version']}


@router.get('/datasets/{id}/revisions')
def revisions(id:str,request:Request,user=Depends(require_user)):
    store=dbof(request);owned(store,user,'datasets',id)
    # Metadata remains inspectable even if one historical payload is corrupt.
    # Never calculate a diff from bad input or make it available for restore.
    rows=store.all('SELECT dataset_id,user_id,version,content_hash,created_at,payload AS revision_payload FROM dataset_revisions WHERE dataset_id=? AND user_id=? ORDER BY version',(id,user['id']))
    from fastapi import HTTPException
    result=[];previous=None
    for i,raw in enumerate(rows):
        r={k:v for k,v in raw.items() if k!='revision_payload'};valid=True
        try:
            r['payload']=json.loads(raw['revision_payload'])
            store.validate_dataset_revision(r)
        except (ValueError,TypeError,HTTPException):valid=False
        diff_available=valid and (i==0 or previous is not None)
        receipt=store.one('SELECT payload AS receipt_payload,content_hash,created_at FROM dataset_import_receipts WHERE dataset_id=? AND user_id=? AND version=?',(id,user['id'],r['version']))
        if receipt:
            try:
                p=json.loads(receipt.pop('receipt_payload'))
                receipt_valid=(isinstance(p,dict) and digest(p)==receipt['content_hash']
                    and type(p.get('schema_version')) is int and p['schema_version']==1
                    and p.get('dataset_id')==id and type(p.get('dataset_version')) is int
                    and p['dataset_version']==r['version'] and p.get('dataset_hash')==r['content_hash'])
                if receipt_valid and p.get('source_kind')=='file':
                    context=p.get('import_context')
                    receipt_valid=(isinstance(context,dict)
                        and all(isinstance(context.get(k),list) and all(isinstance(v,str) for v in context[k]) for k in ('added','replaced','retained'))
                        and isinstance(context.get('filename'),str)
                        and context.get('input_amount_unit') in ('yuan','wan','yi')
                        and context.get('input_basis') in ('standalone_quarter','year_to_date'))
                elif receipt_valid:receipt_valid=p.get('source_kind')=='structured_preview'
            except (ValueError,TypeError):receipt_valid=False
            receipt['integrity_valid']=receipt_valid
            if receipt_valid:receipt['payload']=p
        result.append({k:v for k,v in r.items() if k!='payload'} | {
            'integrity_valid':valid,'diff_available':diff_available,
            'diff':dataset_diff(previous,r['payload']) if diff_available and i else [],'initial':i==0,
            'snapshot':r['payload'] if valid else None,'import_receipt':receipt})
        previous=r['payload'] if valid else None
    return {'items':result}


@router.get('/datasets/{id}/lineage')
def dataset_lineage(id:str,request:Request,revision:int=Query(0,ge=0,le=MAX_SAFE_INTEGER),user=Depends(require_user)):
    store=dbof(request);row=owned(store,user,'datasets',id)
    if revision:
        row=store.dataset_revision(user['id'],id,revision)
    return {'dataset_id':id,'version':row['version'],'hash':row['content_hash'],
        'items':lineage(row['payload'],calculate(row['payload']))}


@router.post('/datasets/{id}/restore')
def restore_revision(id:str,body:RevisionRestore,request:Request,user=Depends(require_user)):
    return dbof(request).restore_dataset_revision(user['id'],id,body.version,body.target_revision)


def stage(store,user,body,*,merge_mode='replace',import_context=None):
    raw=body.dataset.model_dump(mode='json')
    if raw['source_kind']=='sample':fail('SAMPLE_DISABLED','工作区不接收合成演示业务数据',422)
    if body.basis=='year_to_date':raw=from_cumulative(raw)
    data=normalize(Dataset.model_validate(raw));old=None
    if body.target_id:
        old=owned(store,user,'datasets',body.target_id)
        if old['version']!=body.target_version:fail('VERSION_CONFLICT','目标数据已更新',409)
        store.validate_dataset_identity(old,data)
    if import_context is not None:
        before={p['period'] for p in old['payload']['periods']} if old else set()
        incoming={p['period'] for p in data['periods']}
        if old:
            # Reimport revises financial rows, not the established dataset's identity/source metadata.
            data={**old['payload'], 'periods':data['periods']}
            if merge_mode=='merge':
                combined={p['period']:p for p in old['payload']['periods']}
                combined.update({p['period']:p for p in data['periods']})
                data['periods']=sorted(combined.values(),key=lambda p:p['period'])
            Dataset.model_validate({k:v for k,v in data.items() if k in Dataset.model_fields})
        import_context={**import_context,'mode':merge_mode if old else 'new',
            'added':sorted(incoming-before),'replaced':sorted(incoming & before),
            'retained':sorted(before-incoming) if merge_mode=='merge' else [],
            'removed':sorted(before-incoming) if merge_mode=='replace' else []}
    p={'status':'preview','dataset':data,'basis':body.basis,'target_id':body.target_id,
        'target_version':body.target_version,'quality':quality_report(data),
        'diff':dataset_diff(old['payload'],data) if old else [],'created_at':now()}
    if import_context is not None:p['import_context']=import_context
    p['fingerprint']=digest(p)
    with store.transaction() as db:return ws.save(store,db,user['id'],'import_stage',p)


@router.post('/imports/preview',status_code=201)
def import_preview(body:ImportPreview,request:Request,user=Depends(require_user)):
    return stage(dbof(request),user,body)


@router.post('/imports/file',status_code=201)
async def import_file(request:Request,file:UploadFile=File(...),company:str=Form(...,min_length=1,max_length=200),
    amount_unit:Literal['yuan','wan','yi']=Form('yuan'),
    basis:Literal['standalone_quarter','year_to_date']=Form('standalone_quarter'),
    target_id:str=Form('',max_length=80),target_version:int=Form(0,ge=0),
    merge_mode:Literal['replace','merge']=Form('replace'),user=Depends(require_user)):
    if bool(target_id)!=bool(target_version):fail('INVALID_TARGET','修订必须同时指定数据集和当前版本',422)
    if not target_id and merge_mode=='merge':fail('INVALID_TARGET','合并季度必须选择已有数据集',422)
    report=[]
    raw=await file.read(2_000_001)
    try:parsed=await asyncio.to_thread(import_dataset,file.filename or '',raw,company,amount_unit,report)
    except MalformedWorkbook as exc:fail('IMPORT_REJECTED',str(exc),422)
    return stage(dbof(request),user,ImportPreview(dataset=parsed,basis=basis,target_id=target_id,target_version=target_version),
        merge_mode=merge_mode,import_context={'filename':file.filename or '', 'normalizations':report,
            'input_amount_unit':parsed.amount_unit,'input_basis':basis,'source_file_sha256':hashlib.sha256(raw).hexdigest(),'source_file_bytes':len(raw)})


@router.post('/imports/{id}/commit',status_code=201)
def import_commit(id:str,body:StageCommit,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        row=ws.get(store,user['id'],'import_stage',id);p=row['payload']
        _verify_import_stage(store,user['id'],row)
        if body.fingerprint!=p['fingerprint']:fail('PREVIEW_MISMATCH','内容校验指纹不匹配',409)
        if p['status']=='committed':return owned(store,user,'datasets',p['committed_id'])
        if body.version!=row['version']:fail('VERSION_CONFLICT','预览版本不一致',409)
        if (datetime.now(timezone.utc)-datetime.fromisoformat(p['created_at'])).total_seconds()>86400:fail('PREVIEW_EXPIRED','预览超过24小时，请重新导入',409)
        data=p['dataset'];at=now();key=p['target_id'] or uid()
        if p['target_id']:
            old=owned(store,user,'datasets',key)
            if old['version']!=p['target_version']:fail('VERSION_CONFLICT','预览期间原数据已更新，请重新预览',409)
            store.validate_dataset_identity(old,data)
            db.execute('UPDATE datasets SET payload=?,version=version+1,content_hash=?,updated_at=? WHERE id=? AND user_id=?',(encode(data),digest(data),at,key,user['id']))
        else:
            count=store.one('SELECT count(*) AS n FROM datasets WHERE user_id=?',(user['id'],))['n']
            if count>=200:fail('RESOURCE_LIMIT','数据集数量已达上限',409)
            db.execute('INSERT INTO datasets VALUES(?,?,?,?,?,?,?)',(key,user['id'],encode(data),1,digest(data),at,at))
        saved=owned(store,user,'datasets',key)
        receipt={'schema_version':1,'stage_id':id,'preview_fingerprint':p['fingerprint'],
            'dataset_id':key,'dataset_version':saved['version'],'dataset_hash':saved['content_hash'],
            'basis':p['basis'],'source_kind':'file' if p.get('import_context') else 'structured_preview',
            'import_context':p.get('import_context'),'prior_version':p['target_version'] or None,
            'confirmed_at':at,'scope':'导入处理回执与输出修订；未保存原文件，不提供单元格级原件定位'}
        db.execute('INSERT INTO dataset_import_receipts VALUES(?,?,?,?,?,?)',
            (key,user['id'],saved['version'],encode(receipt),digest(receipt),at))
        store.audit(db,user['id'],'datasets',key,'import_committed',{'stage_id':id,'revision':saved['version'],'receipt_hash':digest(receipt)})
        ws.save(store,db,user['id'],'import_stage',{**p,'status':'committed','committed_id':key},key=row['natural_key'],expected=row['version'])
    return owned(store,user,'datasets',key)


def _verify_import_stage(store,user_id,row):
    """Recheck approved bytes before writing or acknowledging a previous write."""
    p=row['payload']
    valid=isinstance(p,dict) and isinstance(p.get('status'),str) and p['status'] in {'preview','committed'}
    try:
        if valid:
            original={k:v for k,v in p.items() if k not in {'fingerprint','committed_id'}}
            original['status']='preview'
            valid=(p.get('fingerprint')==digest(original)
                and (p['status']=='committed' or 'committed_id' not in p))
    except (TypeError,ValueError):valid=False
    if not valid:fail('PREVIEW_INTEGRITY','保存前预览内容的完整性校验失败；未写入数据，请返回重新选择文件或重新预览',409)
    receipts=store.all("SELECT * FROM dataset_import_receipts WHERE user_id=? AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.stage_id') END=?",(user_id,row['id']))
    if p['status']=='preview':
        if receipts:fail('PREVIEW_INTEGRITY','此预览已有保存回执但状态不一致；未重复写入，请核对当前数据和修订记录',409)
        return
    # Status and committed_id are completion metadata, outside the original
    # fingerprint. Their authority comes from the owner-scoped commit receipt.
    valid=False
    try:
        if len(receipts)==1:
            r=receipts[0];receipt=r['payload']
            valid=(isinstance(receipt,dict) and r['content_hash']==digest(receipt)
                and receipt.get('schema_version')==1
                and receipt.get('preview_fingerprint')==p['fingerprint']
                and receipt.get('dataset_id')==r['dataset_id']==p.get('committed_id')
                and receipt.get('dataset_version')==r['version']==p['target_version']+1
                and receipt.get('dataset_hash')==digest(p['dataset'])
                and receipt.get('basis')==p['basis']
                and receipt.get('import_context')==p.get('import_context')
                and receipt.get('source_kind')==('file' if p.get('import_context') else 'structured_preview')
                and receipt.get('prior_version')==(p['target_version'] or None)
                and receipt.get('confirmed_at')==r['created_at'])
    except (KeyError,TypeError,ValueError):valid=False
    if not valid:fail('PREVIEW_INTEGRITY','原预览的保存回执无法校验；未重复写入，请核对当前数据和修订记录',409)


@router.get('/evidence')
def evidence_items(request:Request,user=Depends(require_user)):
    return {'items':evidence_catalog(dbof(request),user['id'])}


@router.put('/evidence/{id}/review')
def evidence_review(id:str,body:EvidenceReview,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        owned(store,user,'evidence',id)
        return ws.save(store,db,user['id'],'evidence_review',body.model_dump(mode='json',exclude={'version'}),key=id,expected=body.version)


@router.get('/retrieval')
def retrieval(request:Request,q:str=Query(...,min_length=1,max_length=2000),company:str=Query('',max_length=200),user=Depends(require_user)):
    return {'items':scoped_retrieve(dbof(request),user['id'],q,company),'strategy':'企业/审核/有效期过滤后FTS检索与词项重排'}


@router.get('/actions')
def actions(request:Request,user=Depends(require_user)):
    store=dbof(request)
    return {'items':[with_source_impact(store,user['id'],r) for r in ws.objects(store,user['id'],'action',1000)]}


def action_context_writable(store,user_id,payload):
    dataset_id=payload.get('dataset_id','');identity_id=payload.get('identity_id','')
    identity=store.one("SELECT payload FROM workspace_objects WHERE user_id=? AND kind='identity' AND id=?",(user_id,identity_id)) if identity_id else None
    unavailable=(dataset_id and not store.owned('datasets',user_id,dataset_id)) or (identity_id and not identity)
    narrowed=identity and dataset_id and identity['payload']['dataset_ids'] and dataset_id not in identity['payload']['dataset_ids']
    if unavailable or narrowed:
        fail('ACTION_CONTEXT_ARCHIVED','原企业或服务身份范围已不可用；仅可查阅历史，恢复原有效范围后才能修改，不会自动重新分配',409)


def check_action_retry(existing,body):
    """A legacy insight key may infer omitted scope, never ignore a contradiction."""
    payload=existing['payload'];frozen=payload.get('origin') or payload
    original=payload.get('creation_request') or frozen
    requested=body.model_dump(mode='json',exclude={'request_id'})
    for field in body.model_fields_set-{'request_id'}:
        value=requested[field]
        if field=='source_ref' and value is not None and not original.get('source_ref'):
            p=payload.get('provenance') or {}
            if (value.get('kind')=='insight' and p.get('source_key')==value.get('source_key')
                and (value.get('dataset_version') is None or value['dataset_version']==p.get('dataset_version'))
                and (not value.get('dataset_hash') or value['dataset_hash']==p.get('dataset_hash'))):
                continue
            fail('SOURCE_MISMATCH','重复行动的来源引用与原始记录不一致',409)
        expected=frozen.get(field) if field in {'dataset_id','company','run_id','identity_id','source_key'} else original.get(field)
        if value!=expected:
            fail('SOURCE_MISMATCH' if field in {'dataset_id','company','run_id','identity_id','source_key','source_ref'} else 'IDEMPOTENCY_CONFLICT',
                '同一行动提交不能对应不同内容或来源；请核对原记录后另建行动',409)


@router.post('/actions',status_code=201)
def action_add(body:ActionCreate,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        creation=body.model_dump(mode='json',exclude={'request_id'});request_hash=digest(creation)
        replay=store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='action' AND json_extract(payload,'$.creation_request_id')=?",(user['id'],body.request_id)) if body.request_id else None
        if replay:
            if replay['payload'].get('creation_request_hash')!=request_hash:
                fail('IDEMPOTENCY_CONFLICT','同一提交标识不能对应不同的行动内容或来源',409)
            return with_source_impact(store,user['id'],replay)
        payload=body.model_dump(mode='json',exclude={'source_ref','request_id'})
        source_key=body.source_key or (body.source_ref.source_key if body.source_ref and body.source_ref.kind=='insight' else '')
        if body.source_ref and body.source_key and (body.source_ref.kind!='insight' or body.source_ref.source_key!=body.source_key):
            fail('SOURCE_MISMATCH','行动来源键与来源引用不一致',409)
        key=('insight:'+(digest({'source_key':source_key,'identity_id':body.identity_id}) if body.identity_id else source_key)) if source_key else 'request:'+body.request_id if body.request_id else uid()
        existing=ws.keyed(store,user['id'],'action',key)
        if existing:
            check_action_retry(existing,body)
            return with_source_impact(store,user['id'],existing)
        provenance=resolve_source(store,user['id'],body.identity_id,body.dataset_id,body.source_ref,
            run_id=body.run_id,source_key=source_key)
        if body.company and provenance['company'] and body.company!=provenance['company']:
            fail('COMPANY_MISMATCH','行动与来源企业不一致',409)
        payload.update(dataset_id=provenance['dataset_id'],company=provenance['company'] or body.company,
            run_id=provenance.get('run_id',''),source_key=provenance.get('source_key',body.source_key),provenance=provenance)
        payload={**payload,'origin':dict(payload),'origin_kind':'created','changes':[],'status':'open',
            'creation_request_id':body.request_id,'creation_request_hash':request_hash,'creation_request':creation,
            'history':[{'at':now(),'status':'open','note':'用户创建','evidence_ids':[],'evidence_snapshots':[]}]}
        return with_source_impact(store,user['id'],ws.save(store,db,user['id'],'action',payload,key=key))


@router.put('/actions/{id}')
def action_edit(id:str,body:ActionEdit,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        row=ws.get(store,user['id'],'action',id);p=row['payload']
        check_version(row,body.version)
        action_context_writable(store,user['id'],p)
        if p['status']=='done':fail('ACTION_ACCEPTED','已验收行动请先重新打开，再修改内容',409)
        values=body.model_dump(mode='json',exclude={'version','note'})
        changes={k:{'before':p.get(k),'after':v} for k,v in values.items() if p.get(k)!=v}
        if not changes:fail('ACTION_UNCHANGED','没有内容变化，未新增历史记录',409)
        prior=p.get('changes',[])
        if len(prior)>=100:fail('ACTION_CHANGE_LIMIT','行动修改记录达到上限，请另建跟进行动；已有记录保留',409)
        origin=p.get('origin') or {k:v for k,v in p.items() if k not in {'history','changes','status'}}
        record={'at':now(),'actor_id':user['id'],'version':row['version']+1,'note':body.note,'fields':changes}
        return with_source_impact(store,user['id'],ws.save(store,db,user['id'],'action',{**p,**values,'origin':origin,'origin_kind':p.get('origin_kind','before_first_edit'),'changes':prior+[record]},key=row['natural_key'],expected=body.version))


@router.put('/actions/{id}/status')
def action_transition(id:str,body:ActionTransition,request:Request,user=Depends(require_user)):
    store=dbof(request)
    allowed={'open':{'in_progress','blocked','dismissed'},'in_progress':{'blocked','done','dismissed'},
        'blocked':{'in_progress','dismissed'},'done':{'open'},'dismissed':{'open'}}
    with store.transaction() as db:
        row=ws.get(store,user['id'],'action',id);p=row['payload']
        check_version(row,body.version)
        action_context_writable(store,user['id'],p)
        if body.status not in allowed[p['status']]:fail('STATE_TRANSITION','该状态不能直接转换到目标状态',409)
        snapshots=evidence_snapshots(store,user['id'],p.get('company',''),body.evidence_ids,body.evidence_refs)
        if len(p['history'])>=100:fail('ACTION_HISTORY_LIMIT','行动状态记录达到上限，请另建跟进行动',409)
        history=p['history']+[{'at':now(),'status':body.status,'note':body.note,'evidence_ids':[e['id'] for e in snapshots],
            'evidence_snapshots':snapshots,'actor_id':user['id'],'action_version':row['version']+1}]
        return with_source_impact(store,user['id'],ws.save(store,db,user['id'],'action',{**p,'status':body.status,'history':history},key=row['natural_key'],expected=body.version))


@router.post('/insights/dismiss')
def insight_dismiss(body:DismissInsight,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        datasets,_=workspace_scope(store,user['id'],body.identity_id)
        current=ws.keyed(store,user['id'],'dismissal',body.key)
        if current:return current
        # Only current owned rule instances can be dismissed, never a globally guessed object.
        source=next((x for x in build_insights(store,user['id'],datasets,identity_id=body.identity_id)['items'] if x['key']==body.key),None)
        if not source:fail('NOT_FOUND','建议已失效或不属于当前工作区',404)
        return ws.save(store,db,user['id'],'dismissal',{**body.model_dump(),'source':source},key=body.key)


@router.post('/experiments',status_code=201)
def experiment_add(body:ExperimentRequest,request:Request,user=Depends(require_user)):
    from .saved_experiments import create_payload, public_record, verify_creation_receipt
    store=dbof(request)
    with store.transaction() as db:
        key='experiment_request:'+body.request_id if body.request_id else None
        creation=body.model_dump(mode='json',exclude={'request_id'});request_hash=digest(creation)
        prior=ws.keyed(store,user['id'],'experiment',key) if key else None
        if prior:verify_creation_receipt(prior)
        removed=store.one("SELECT metadata FROM audit WHERE user_id=? AND resource='experiment' AND action='deleted' AND json_extract(metadata,'$.creation_request_id')=? ORDER BY seq DESC LIMIT 1",(user['id'],body.request_id)) if key and not prior else None
        receipt=prior['payload'] if prior else removed['metadata'] if removed else None
        if receipt:
            if receipt.get('creation_request_hash')!=request_hash or (prior and prior['payload']['request']!=creation):
                fail('IDEMPOTENCY_CONFLICT','同一提交标识不能对应不同实验内容或数据版本，请核对原记录',409)
            if removed:
                fail('EXPERIMENT_REMOVED','这次提交曾保存的实验已被清理，不会重新创建；请核对历史后明确新建实验',409)
            # Recover the original owned outcome without recalculation, another
            # audit event, or current input/capacity checks. Assets stay shared
            # by dataset scope, not made private to a service identity.
            return public_record(prior)
        d=owned(store,user,'datasets',body.dataset_id)
        return public_record(ws.save(store,db,user['id'],'experiment',create_payload(d,body),key=key))


@router.get('/experiments')
def experiments(request:Request,identity_id:str|None=Query(None,max_length=80),dataset_id:str=Query('',max_length=80),user=Depends(require_user)):
    from .saved_experiments import public_record
    store=dbof(request);_,scope=workspace_scope(store,user['id'],identity_id,dataset_id)
    filters,args=scope_sql(scope,"json_extract(payload,'$.dataset_id')")
    rows=store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='experiment'"+filters+" ORDER BY updated_at DESC,id LIMIT 201",(user['id'],*args))
    return {'items':[public_record(r,summary=True) for r in rows[:200]],'has_more':len(rows)>200,'scope':scope,'sharing':'数学实验按企业数据范围共享，不伪装为独立身份私有资产'}


@router.get('/experiments/{id}')
def experiment_get(id:str,request:Request,user=Depends(require_user)):
    from .saved_experiments import public_record
    return public_record(ws.get(dbof(request),user['id'],'experiment',id))


@router.post('/comparisons',status_code=201)
def comparison_add(body:SavedComparisonRequest,request:Request,user=Depends(require_user)):
    from .saved_comparisons import create_payload, public_record
    store=dbof(request);request_hash=digest(body.model_dump(mode='json'))
    with store.transaction() as db:
        key='comparison_request:'+body.request_id if body.request_id else None
        prior=ws.keyed(store,user['id'],'comparison',key) if key else None
        if prior:
            if prior['payload'].get('creation_request_hash')!=request_hash:
                fail('IDEMPOTENCY_CONFLICT','保存请求标识已用于不同的比较内容，请核对记录后重新提交',409)
            # The outcome of an earlier save is returned even if inputs changed;
            # live impact is separate and no new calculation or mutation occurs.
            return public_record(store,user['id'],prior)
        row=ws.save(store,db,user['id'],'comparison',create_payload(store,user['id'],body),key=key)
        return public_record(store,user['id'],row)


@router.get('/comparisons')
def comparison_list(request:Request,identity_id:str=Query('',max_length=80),dataset_id:str=Query('',max_length=80),user=Depends(require_user)):
    from .saved_comparisons import public_record
    from .identities import resolve_identity
    store=dbof(request);resolve_identity(store,user['id'],identity_id)
    rows=store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='comparison' AND json_extract(payload,'$.identity_id')=? ORDER BY updated_at DESC,id",(user['id'],identity_id))
    if dataset_id:rows=[r for r in rows if dataset_id in {m['id'] for m in r['payload']['members']}]
    return {'items':[public_record(store,user['id'],r,summary=True) for r in rows[:200]],'has_more':len(rows)>200,
            'scope':{'identity_id':identity_id,'dataset_id':dataset_id},'sharing':'比较绑定创建时服务身份；历史成员变化单独显示，不改写已保存结果'}


def owned_comparison(store,user_id,id,identity_id):
    row=ws.get(store,user_id,'comparison',id)
    if row['payload']['identity_id']!=identity_id:fail('IDENTITY_SCOPE','比较属于另一服务身份，请在原身份查看',403)
    return row


@router.get('/comparisons/{id}')
def comparison_get(id:str,request:Request,identity_id:str=Query('',max_length=80),user=Depends(require_user)):
    from .saved_comparisons import public_record
    store=dbof(request)
    return public_record(store,user['id'],owned_comparison(store,user['id'],id,identity_id))


@router.delete('/comparisons/{id}')
def comparison_delete(id:str,request:Request,identity_id:str=Query('',max_length=80),version:int|None=Query(None,ge=1,le=MAX_SAFE_INTEGER),user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        row=owned_comparison(store,user['id'],id,identity_id);check_version(row,version)
        db.execute('DELETE FROM workspace_objects WHERE user_id=? AND id=?',(user['id'],id))
        store.audit(db,user['id'],'comparison',id,'deleted',{'version':row['version']})
    return {'deleted':True,'notice':'原比较已删除；已批准计划和历史报告中的冻结输入仍保留，新的外发将停止'}


@router.get('/reports')
def reports(request:Request,identity_id:str|None=Query(None,max_length=80),dataset_id:str=Query('',max_length=80),user=Depends(require_user)):
    store=dbof(request);_,scope=workspace_scope(store,user['id'],identity_id,dataset_id)
    filters,args=scope_sql(scope,'r.dataset_id',"json_extract(r.snapshot,'$.identity.id')")
    rows=store.all("""SELECT r.id,r.dataset_id,r.state,r.created_at,
        json_extract(r.result,'$.title') AS title,json_extract(r.result,'$.query') AS query,
        json_extract(r.result,'$.analysis.current_period') AS current_period,
        json_extract(r.result,'$.dataset_version') AS dataset_version,
        json_extract(r.result,'$.llm.state') AS llm_state,
        COALESCE(json_extract(r.snapshot,'$.identity.id'),'') AS identity_id,
        d.version AS current_version FROM runs r JOIN datasets d ON d.id=r.dataset_id
        WHERE r.user_id=? AND r.result IS NOT NULL"""+filters+" ORDER BY r.created_at DESC,r.id LIMIT 201",(user['id'],*args))
    from .business_provenance import report_impact
    return {'items':[{**r,'stale':r['dataset_version']!=r['current_version'],'source_impact':report_impact(store,user['id'],owned(store,user,'runs',r['id']))} for r in rows[:200]],'has_more':len(rows)>200,'scope':scope}


@router.get('/runs/{id}/audit')
def run_audit(id:str,request:Request,user=Depends(require_user)):
    store=dbof(request);run=owned(store,user,'runs',id)
    from .business_provenance import report_impact
    from .report_integrity import inspect_report_integrity
    audit=inspect_report_integrity(store,run)
    return {**audit,'source_impact':report_impact(store,user['id'],run,integrity=audit['report_integrity'])
        if run['result'] or run['state'] in {'succeeded','degraded'} else None}



@router.get('/runs/{id}/reviews')
def claim_reviews(id:str,request:Request,user=Depends(require_user)):
    store=dbof(request);run=owned(store,user,'runs',id)
    # A corrupt payload must not erase the versioned record from this read model.
    # Scope by the owned live report first, then consider both saved bindings.
    # Alias raw JSON so Store.unpack cannot abort on one malformed row.
    prefix=id+':'
    rows=store.all("""SELECT id,user_id,kind,natural_key,payload AS review_payload,
        version,created_at,updated_at FROM workspace_objects
        WHERE user_id=? AND kind='claim_review' AND (substr(natural_key,1,?)=?
        OR CASE WHEN json_valid(payload) THEN json_extract(payload,'$.run_id') END=?)
        ORDER BY updated_at DESC,id""",(user['id'],len(prefix),prefix,id))
    result=run.get('result');llm=result.get('llm') if isinstance(result,dict) else None
    review=llm.get('review') if isinstance(llm,dict) else None
    claims=review.get('claims') if isinstance(review,dict) else None
    claim_ids={c.get('id',digest(c)[:24]) for c in (claims if isinstance(claims,list) else [])
        if isinstance(c,dict) and isinstance(c.get('id',''),str)}
    items=[];unavailable=[];read_only=[]
    for row in rows:
        parsed=True
        try:payload=json.loads(row['review_payload'])
        except (TypeError,ValueError):payload=None;parsed=False
        key=row['natural_key']
        key_claim=key[len(prefix):] if isinstance(key,str) and key.startswith(prefix) else None
        # Missing content may be associated by an exact saved key. Conflicting
        # payload identifiers are ambiguous, never a verified prior verdict.
        target_claim=key_claim if isinstance(key_claim,str) and 1<=len(key_claim)<=100 and key_claim in claim_ids else None
        associated=target_claim is not None and (not isinstance(payload,dict) or
            (('run_id' not in payload or payload['run_id']==id) and
             ('claim_id' not in payload or payload['claim_id']==key_claim)))
        version_ok=type(row['version']) is int and 1<=row['version']<=MAX_SAFE_INTEGER
        recoverable_version=version_ok and row['version']<MAX_SAFE_INTEGER
        valid=False
        if associated and isinstance(payload,dict) and payload.get('run_id')==id and payload.get('claim_id')==key_claim:
            try:
                ClaimReview.model_validate({k:v for k,v in payload.items() if k!='run_id'},strict=True)
                valid=version_ok
            except (TypeError,ValueError):pass
        if valid:
            items.append({('payload' if k=='review_payload' else k):(payload if k=='review_payload' else v) for k,v in row.items()})
            if not recoverable_version:
                read_only.append({'id':row['id'],'version':row['version'],'claim_id':key_claim,
                    'reason_code':'version_limit','reason':'审阅版本计数已达上限；已有结论与依据仍可查看，当前记录只读，不能再次提交复核'})
            continue
        reason=('保存的审阅内容不是有效 JSON，当前版本接口无法安全重新审阅；请核对可信备份' if not parsed else
            '保存的审阅与本报告解释的关联不明确；暂不能重新审阅，请核对可信记录' if not associated else
            '保存的审阅版本无效或已达版本上限；暂不能重新审阅，请核对可信记录' if not recoverable_version else
            '已有审阅记录无法核验；原结论与依据不可用，可明确提交新的人工复核')
        unavailable.append({'id':row['id'],'version':row['version'],
            'claim_id':key_claim if associated else None,'target_claim_id':target_claim,
            'candidate_claim_ids':[payload['claim_id']] if not associated and isinstance(payload,dict)
                and payload.get('run_id')==id and isinstance(payload.get('claim_id'),str) and payload['claim_id'] in claim_ids else [],
            'reason_code':'malformed_json' if not parsed else 'ambiguous_association' if not associated else 'invalid_version' if not recoverable_version else 'invalid_payload',
            'association':'natural_key' if associated else 'unverified',
            'reason':reason,'can_rereview':parsed and associated and recoverable_version})
    # Preserve the healthy response contract, including the absence of extras.
    return {'items':items,**({'unavailable':unavailable} if unavailable else {}),
        **({'read_only':read_only} if read_only else {})}


@router.post('/runs/{id}/reviews')
def review_claim(id:str,body:ClaimReview,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        r=owned(store,user,'runs',id)
        if not r['result']:fail('NOT_READY','运行尚未产生报告',409)
        claims=r['result']['llm']['review']['claims']
        if body.claim_id not in {c.get('id',digest(c)[:24]) for c in claims}:fail('NOT_FOUND','对应解释不存在',404)
        key=id+':'+body.claim_id
        # Check the exact owned slot under the same transaction as the write.
        # A stale submission remains a version conflict, even at the counter cap.
        current=store.one("SELECT version FROM workspace_objects WHERE user_id=? AND kind='claim_review' AND natural_key=?",(user['id'],key))
        if current:
            if body.version!=current['version']:fail('VERSION_CONFLICT','记录已改变；请刷新，未覆盖他人的修改',409)
            if type(current['version']) is not int or current['version']<1:
                fail('INVALID_VERSION','保存的审阅版本无效；请核对可信记录，未修复或覆盖现有审阅',409)
            if current['version']>=MAX_SAFE_INTEGER:
                fail('VERSION_LIMIT','审阅版本计数已达上限；已有结论与依据仍可查看，当前记录只读，不能再次提交复核',409)
        return ws.save(store,db,user['id'],'claim_review',{'run_id':id,**body.model_dump(exclude={'version'})},key=key,expected=body.version)


def _finite_metric(value):
    if isinstance(value,bool) or not isinstance(value,(int,float)):return False
    try:return math.isfinite(value)
    except (OverflowError,ValueError):return False


def _comparison_analysis(run,label):
    """Validate saved values only; never recalculate a historical report.

    Pre-anchor legacy reports cannot prove their whole output hash, so evidence
    checks alone cannot establish that their comparison fields remain usable.
    """
    result=run.get('result');analysis=result.get('analysis') if isinstance(result,dict) else None
    metrics=analysis.get('metrics') if isinstance(analysis,dict) else None
    period=analysis.get('current_period') if isinstance(analysis,dict) else None
    rule=analysis.get('model_version') if isinstance(analysis,dict) else None
    valid=(isinstance(metrics,dict) and any(key!='period' for key in metrics)
        and isinstance(period,str) and re.fullmatch(r'[0-9]{4}-Q[1-4]',period)
        and isinstance(rule,str) and bool(rule.strip())
        and ('period' not in metrics or metrics['period']==period)
        and all(value is None or _finite_metric(value) for key,value in metrics.items() if key!='period'))
    if not valid:fail('REPORT_INTEGRITY',label+'保存的指标结构或数值无效；未计算差异，请核对原报告及可信备份',409)
    return analysis


@router.get('/reports/compare')
def report_compare(request:Request,left:str=Query(...,max_length=80),right:str=Query(...,max_length=80),user=Depends(require_user)):
    store=dbof(request);a=owned(store,user,'runs',left);b=owned(store,user,'runs',right)
    from .report_integrity import inspect_report_integrity
    if any(not r['result'] and r['state'] not in {'succeeded','degraded'} for r in (a,b)):
        fail('NOT_READY','两次运行均需生成报告',409)
    verification={};partial=[];analyses={}
    for side,label,run in (('left','基准报告',a),('right','对照报告',b)):
        analyses[side]=_comparison_analysis(run,label)
        audit=inspect_report_integrity(store,run)
        if not audit['report_integrity']['valid']:
            fail('REPORT_INTEGRITY',label+'的冻结产物、事件或输入快照校验失败；未计算差异，请核对原报告及可信备份',409)
        verification[side]={'format':audit['report_integrity']['format'],'whole_output_hash_verified':audit['report_hash_valid']}
        if audit['report_hash_valid'] is None:partial.append(label)
    if a['snapshot']['dataset']['company']!=b['snapshot']['dataset']['company']:
        fail('COMPANY_MISMATCH','报告修订对比只支持同一企业；跨企业请使用企业对照',422)
    am=analyses['left'];bm=analyses['right']
    keys=set(am['metrics'])&set(bm['metrics']);deltas=[]
    for k in sorted(keys):
        av,bv=am['metrics'][k],bm['metrics'][k]
        if k=='period':continue
        delta=bv-av if av is not None and bv is not None else None
        if delta is not None and not _finite_metric(delta):
            fail('REPORT_INTEGRITY','保存值的差异超出有限数值范围；未发布比较结果，请核对原报告',409)
        deltas.append({'metric':k,'before':av,'after':bv,'delta':delta})
    same_period=am['current_period']==bm['current_period']
    notice=('、'.join(partial)+'为旧版记录，未保存完整输出的独立散列；此处仅比较其保存值并核对已有输入和事件记录。' if partial else '')
    return {'left':left,'right':right,'same_period':same_period,'verification':verification,
        'same_rule_version':am['model_version']==bm['model_version'],'left_period':am['current_period'],'right_period':bm['current_period'],
        'changes':deltas,'input_diff':dataset_diff(a['snapshot']['dataset'],b['snapshot']['dataset']),
        'warning':notice+('同季度比较反映输入修订或研究口径差异，不代表跨期经营增长，也不能解释为干预效果' if same_period
            else '跨季度变化包含期间差异；不能把修订差异或相关变化当成干预效果')}


@router.post('/assistant')
def assistant(body:AssistantRequest,request:Request,user=Depends(require_user)):
    return assistant_answer(dbof(request),user,body.query,body.dataset_id)


@router.get('/export')
def export_workspace(request:Request,user=Depends(require_user)):
    from .exports import export_account
    payload=export_account(dbof(request),user['id'])
    data=payload['data']
    # Retain the original workspace envelope for existing export readers while
    # sourcing every section from the same owner-scoped database snapshot.
    payload.update(format='lidian-workspace-export', export_version=4,
        objects={kind:[r for r in data['workspace_objects'] if r['kind']==kind] for kind in sorted(ws.KINDS)},
        run_events=data['run_events'],agent_artifacts=data['agent_artifacts'],
        event_integrity=data['event_integrity'],
        adaptive={t:data[t] for t in ('adaptive_graphs','adaptive_controls','adaptive_checkpoints','adaptive_calls')},
        assistant_messages=data['copilot_messages'],model_connections=data['connections'],
        tracking_receipts=data['tracking_receipts'],dataset_revisions=data['dataset_revisions'],dataset_import_receipts=data['dataset_import_receipts'],
        notice=payload['scope']+'。'+payload['restore'])
    return Response(encode(payload),media_type='application/json',headers={'Content-Disposition':'attachment; filename="lidian-workspace.json"'})


@router.delete('/archive/{kind}/{id}')
def archive_delete(kind:str,id:str,request:Request,version:int|None=Query(None,ge=1,le=MAX_SAFE_INTEGER),user=Depends(require_user)):
    if kind not in {'plan','experiment','action','import_stage','dismissal'}:
        fail('KIND_FORBIDDEN','此类记录不可通过该接口删除',422)
    store=dbof(request)
    with store.transaction() as db:
        row=ws.get(store,user['id'],kind,id)
        check_version(row,version)
        if kind=='plan' and row['payload']['status']=='dispatched':
            run=store.owned('runs',user['id'],row['payload']['run_id'])
            if run and run['state'] in ('running','queued','interrupted'):
                fail('RUN_ACTIVE','任务仍在执行或可继续；请先明确取消或完成，再清理批准计划',409)
        db.execute('DELETE FROM workspace_objects WHERE id=? AND user_id=?',(id,user['id']))
        # Retain only the retry binding, never deleted experiment snapshots.
        receipt={k:row['payload'].get(k) for k in ('creation_request_id','creation_request_hash')} if kind=='experiment' else None
        store.audit(db,user['id'],kind,id,'deleted',receipt)
    return {'ok':True,'notice':'仅删除选中工作区记录；独立历史运行快照不被改写。'}


@router.get('/archive')
def archive_list(request:Request,user=Depends(require_user)):
    store=dbof(request);result={}
    for kind in ('plan','experiment','action','import_stage','dismissal'):
        rows=ws.objects(store,user['id'],kind,1000)
        result[kind]={'total':len(rows),'has_more':len(rows)>100,'items':[
            {'id':r['id'],'version':r['version'],'created_at':r['created_at'],
             'label':r['payload'].get('name') or r['payload'].get('title') or r['payload'].get('request',{}).get('query') or r['payload'].get('dataset',{}).get('name') or r['id'],
             'status':r['payload'].get('status','saved')} for r in rows[:100]]}
    return {'collections':result,'notice':'删除仅影响选中记录，不改写独立保存的历史运行、实验或导出的文件。'}
