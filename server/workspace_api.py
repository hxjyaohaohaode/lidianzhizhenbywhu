"""Workspace API: explicit preview/commit, plan consent, evidence review and execution follow-through."""
from __future__ import annotations
import asyncio
import json
from datetime import date,datetime,timezone
from fastapi import APIRouter,Request,Depends,UploadFile,File,Form,Query
from fastapi.responses import Response
from .security import require_user,fail
from .schemas import Dataset
from .contracts import (CompanyProfile,PlanDraft,PlanConsent,EvidenceReview,ActionCreate,ActionTransition,
    ExperimentRequest,ImportPreview,RevisionRestore,ClaimReview,TaskTemplate,AssistantRequest,StageCommit,DismissInsight)
from .store import encode,digest,uid,now
from .models import normalize,calculate
from .analytics import quality_report,from_cumulative,dataset_diff,extended_scenario,forecast_baselines,lineage
from .imports import import_dataset
from .intelligence import build_insights,evidence_catalog,assistant_answer,profile_for,scoped_retrieve
from .studio import AGENTS,build_plan,dispatch_plan
from . import workspace_store as ws

router=APIRouter(prefix='/api/workspace',tags=['Workspace'])


def dbof(request):return request.app.state.store


def owned(store,user,table,id):
    row=store.owned(table,user['id'],id)
    if not row:fail('NOT_FOUND','资源不存在或无访问权限',404)
    return row


@router.get('/brief')
def brief(request:Request,user=Depends(require_user)):
    store=dbof(request);datasets=store.items('datasets',user['id']);cards=[]
    for row in datasets:
        data=row['payload'];analysis=calculate(data)
        cards.append({'id':row['id'],'company':data['company'],'name':data['name'],'version':row['version'],
            'source_kind':data['source_kind'],'updated_at':row['updated_at'],'period':analysis['current_period'],
            'metrics':analysis['metrics'],'revenue':data['periods'][-1]['revenue'],
            'quality':quality_report(data),'profile':profile_for(store,user['id'],data['company'])})
    runs=store.all('SELECT id,dataset_id,state,created_at,updated_at,error,json_object(\'query\',json_extract(payload,\'$.query\')) AS payload FROM runs WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 10',(user['id'],))
    actions=ws.objects(store,user['id'],'action',1000)
    return {'datasets':cards,'insights':build_insights(store,user['id'],datasets),'runs':runs,
        'counts':{'datasets':len(datasets),'evidence':store.one('SELECT count(*) AS n FROM evidence WHERE user_id=?',(user['id'],))['n'],
            'actions_open':sum(a['payload']['status'] not in ('done','dismissed') for a in actions),
            'reports':store.one('SELECT count(*) AS n FROM runs WHERE user_id=? AND result IS NOT NULL',(user['id'],))['n']},
        'runtime':{'external_automation':False,'storage':'local_transactional','time':now()}}


@router.get('/agents')
def agents(request:Request,user=Depends(require_user)):
    return {'items':AGENTS,'providers':request.app.state.providers.status(),
        'policy':{'external_requires_plan':True,'default_external_calls':0,'max_calls':3,
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
def plans(request:Request,user=Depends(require_user)):
    rows=ws.objects(dbof(request),user['id'],'plan',1000)
    # Do not resend all historical snapshots to list the last 100 plans.
    return {'items':[{k:v for k,v in row.items() if k!='payload'} | {'payload':{k:row['payload'][k] for k in ('status','request','max_calls','blockers','run_id','created_at')}} for row in rows[:100]],
        'total':len(rows),'has_more':len(rows)>100}


@router.get('/plans/{id}')
def plan_get(id:str,request:Request,user=Depends(require_user)):
    return ws.get(dbof(request),user['id'],'plan',id)


@router.post('/plans/{id}/execute',status_code=202)
def plan_execute(id:str,body:PlanConsent,request:Request,user=Depends(require_user)):
    return dispatch_plan(dbof(request),user,id,body,request.app.state.settings,request.app.state.providers)


@router.post('/plans/{id}/cancel')
def plan_cancel(id:str,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        row=ws.get(store,user['id'],'plan',id);p=row['payload']
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
def template_delete(id:str,request:Request,user=Depends(require_user)):
    store=dbof(request);ws.get(store,user['id'],'template',id)
    with store.transaction() as db:
        db.execute('DELETE FROM workspace_objects WHERE id=? AND user_id=?',(id,user['id']));store.audit(db,user['id'],'template',id,'deleted')
    return {'ok':True}


@router.get('/datasets/{id}/quality')
def dataset_quality(id:str,request:Request,user=Depends(require_user)):
    store=dbof(request);row=owned(store,user,'datasets',id)
    return {**quality_report(row['payload']),'dataset_id':id,'version':row['version']}


@router.get('/datasets/{id}/revisions')
def revisions(id:str,request:Request,user=Depends(require_user)):
    store=dbof(request);owned(store,user,'datasets',id)
    rows=store.all('SELECT * FROM dataset_revisions WHERE dataset_id=? AND user_id=? ORDER BY version',(id,user['id']))
    result=[]
    for i,r in enumerate(rows):
        result.append({k:v for k,v in r.items() if k!='payload'} | {'diff':dataset_diff(rows[i-1]['payload'],r['payload']) if i else [],'initial':i==0})
    return {'items':result}


@router.get('/datasets/{id}/lineage')
def dataset_lineage(id:str,request:Request,revision:int=Query(0,ge=0),user=Depends(require_user)):
    store=dbof(request);row=owned(store,user,'datasets',id)
    if revision:
        old=store.one('SELECT * FROM dataset_revisions WHERE dataset_id=? AND user_id=? AND version=?',(id,user['id'],revision))
        if not old:fail('NOT_FOUND','历史修订不存在',404)
        row=old
    return {'dataset_id':id,'version':row['version'],'hash':row['content_hash'],
        'items':lineage(row['payload'],calculate(row['payload']))}


@router.post('/datasets/{id}/restore')
def restore_revision(id:str,body:RevisionRestore,request:Request,user=Depends(require_user)):
    store=dbof(request);owned(store,user,'datasets',id)
    old=store.one('SELECT * FROM dataset_revisions WHERE dataset_id=? AND user_id=? AND version=?',(id,user['id'],body.target_revision))
    if not old:fail('NOT_FOUND','历史修订不存在',404)
    row=store.update('datasets',user['id'],id,body.version,old['payload'])
    if not row:fail('VERSION_CONFLICT','当前版本已变，请刷新',409)
    return row


def stage(store,user,body):
    raw=body.dataset.model_dump(mode='json')
    if raw['source_kind']=='sample':fail('SAMPLE_DISABLED','工作区不接收合成演示业务数据',422)
    if body.basis=='year_to_date':raw=from_cumulative(raw)
    data=normalize(Dataset.model_validate(raw));old=None
    if body.target_id:
        old=owned(store,user,'datasets',body.target_id)
        if old['version']!=body.target_version:fail('VERSION_CONFLICT','目标数据已更新',409)
        if old['payload']['company']!=data['company']:fail('COMPANY_MISMATCH','不能在修订中更换企业身份，请创建新数据集',409)
    p={'status':'preview','dataset':data,'basis':body.basis,'target_id':body.target_id,
        'target_version':body.target_version,'quality':quality_report(data),
        'diff':dataset_diff(old['payload'],data) if old else [],'created_at':now()}
    p['fingerprint']=digest(p)
    with store.transaction() as db:return ws.save(store,db,user['id'],'import_stage',p)


@router.post('/imports/preview',status_code=201)
def import_preview(body:ImportPreview,request:Request,user=Depends(require_user)):
    return stage(dbof(request),user,body)


@router.post('/imports/file',status_code=201)
async def import_file(request:Request,file:UploadFile=File(...),company:str=Form(...,min_length=1,max_length=200),
    amount_unit:str=Form('yuan'),basis:str=Form('standalone_quarter'),user=Depends(require_user)):
    raw=await file.read(2_000_001)
    parsed=await asyncio.to_thread(import_dataset,file.filename or '',raw,company,amount_unit)
    return stage(dbof(request),user,ImportPreview(dataset=parsed,basis=basis))


@router.post('/imports/{id}/commit',status_code=201)
def import_commit(id:str,body:StageCommit,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        row=ws.get(store,user['id'],'import_stage',id);p=row['payload']
        if body.fingerprint!=p['fingerprint']:fail('PREVIEW_MISMATCH','内容校验指纹不匹配',409)
        if p['status']=='committed':return owned(store,user,'datasets',p['committed_id'])
        if body.version!=row['version']:fail('VERSION_CONFLICT','预览版本不一致',409)
        if (datetime.now(timezone.utc)-datetime.fromisoformat(p['created_at'])).total_seconds()>86400:fail('PREVIEW_EXPIRED','预览超过24小时，请重新导入',409)
        data=p['dataset'];at=now();key=p['target_id'] or uid()
        if p['target_id']:
            old=owned(store,user,'datasets',key)
            if old['version']!=p['target_version']:fail('VERSION_CONFLICT','预览期间原数据已更新，请重新预览',409)
            db.execute('UPDATE datasets SET payload=?,version=version+1,content_hash=?,updated_at=? WHERE id=? AND user_id=?',(encode(data),digest(data),at,key,user['id']))
        else:
            count=store.one('SELECT count(*) AS n FROM datasets WHERE user_id=?',(user['id'],))['n']
            if count>=200:fail('RESOURCE_LIMIT','数据集数量已达上限',409)
            db.execute('INSERT INTO datasets VALUES(?,?,?,?,?,?,?)',(key,user['id'],encode(data),1,digest(data),at,at))
        store.audit(db,user['id'],'datasets',key,'import_committed',{'stage_id':id})
        ws.save(store,db,user['id'],'import_stage',{**p,'status':'committed','committed_id':key},key=row['natural_key'],expected=row['version'])
    return owned(store,user,'datasets',key)


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
    return {'items':ws.objects(dbof(request),user['id'],'action',1000)}


@router.post('/actions',status_code=201)
def action_add(body:ActionCreate,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        if body.dataset_id:
            d=owned(store,user,'datasets',body.dataset_id)
            if body.company and body.company!=d['payload']['company']:fail('COMPANY_MISMATCH','行动与数据企业不一致',409)
        if body.run_id:
            r=owned(store,user,'runs',body.run_id)
            if body.dataset_id and r['dataset_id']!=body.dataset_id:fail('DATASET_MISMATCH','行动与运行的数据不一致',409)
        key='insight:'+body.source_key if body.source_key else uid()
        existing=ws.keyed(store,user['id'],'action',key)
        if existing:return existing
        payload={**body.model_dump(mode='json'),'status':'open','history':[{'at':now(),'status':'open','note':'用户创建','evidence_ids':[]}]}
        return ws.save(store,db,user['id'],'action',payload,key=key)


@router.put('/actions/{id}/status')
def action_transition(id:str,body:ActionTransition,request:Request,user=Depends(require_user)):
    store=dbof(request)
    allowed={'open':{'in_progress','blocked','dismissed'},'in_progress':{'blocked','done','dismissed'},
        'blocked':{'in_progress','dismissed'},'done':{'open'},'dismissed':{'open'}}
    with store.transaction() as db:
        row=ws.get(store,user['id'],'action',id);p=row['payload']
        if body.status not in allowed[p['status']]:fail('STATE_TRANSITION','该状态不能直接转换到目标状态',409)
        for eid in body.evidence_ids:owned(store,user,'evidence',eid)
        if len(p['history'])>=100:fail('ACTION_HISTORY_LIMIT','行动状态记录达到上限，请另建跟进行动',409)
        history=p['history']+[{'at':now(),'status':body.status,'note':body.note,'evidence_ids':body.evidence_ids}]
        return ws.save(store,db,user['id'],'action',{**p,'status':body.status,'history':history},key=row['natural_key'],expected=body.version)


@router.post('/insights/dismiss')
def insight_dismiss(body:DismissInsight,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        current=ws.keyed(store,user['id'],'dismissal',body.key)
        if current:return current
        # Only current owned rule instances can be dismissed, never a globally guessed object.
        if body.key not in {x['key'] for x in build_insights(store,user['id'])['items']}:
            fail('NOT_FOUND','建议已失效或不属于当前工作区',404)
        return ws.save(store,db,user['id'],'dismissal',body.model_dump(),key=body.key)


@router.post('/experiments',status_code=201)
def experiment_add(body:ExperimentRequest,request:Request,user=Depends(require_user)):
    store=dbof(request);d=owned(store,user,'datasets',body.dataset_id)
    result=extended_scenario(d['payload'],body.price_change,body.cost_change,body.volume_change,body.fixed_cost_share) if body.kind=='scenario' else forecast_baselines(d['payload'],body.metric,body.horizon)
    p={'request':body.model_dump(),'dataset_id':d['id'],'company':d['payload']['company'],'dataset_version':d['version'],
        'dataset_hash':d['content_hash'],'snapshot':d['payload'],'result':result,'created_at':now()}
    with store.transaction() as db:return ws.save(store,db,user['id'],'experiment',p)


@router.get('/experiments')
def experiments(request:Request,user=Depends(require_user)):
    rows=ws.objects(dbof(request),user['id'],'experiment')
    return {'items':[{**r,'payload':{k:v for k,v in r['payload'].items() if k not in ('snapshot','result')}} for r in rows]}


@router.get('/experiments/{id}')
def experiment_get(id:str,request:Request,user=Depends(require_user)):
    return ws.get(dbof(request),user['id'],'experiment',id)


@router.get('/reports')
def reports(request:Request,user=Depends(require_user)):
    store=dbof(request)
    rows=store.all('''SELECT r.id,r.dataset_id,r.state,r.created_at,
        json_extract(r.result,'$.title') AS title,json_extract(r.result,'$.query') AS query,
        json_extract(r.result,'$.dataset_version') AS dataset_version,
        json_extract(r.result,'$.llm.state') AS llm_state,
        d.version AS current_version FROM runs r JOIN datasets d ON d.id=r.dataset_id
        WHERE r.user_id=? AND r.result IS NOT NULL ORDER BY r.created_at DESC,r.id LIMIT 200''',(user['id'],))
    return {'items':[{**r,'stale':r['dataset_version']!=r['current_version']} for r in rows]}


@router.get('/runs/{id}/audit')
def run_audit(id:str,request:Request,user=Depends(require_user)):
    store=dbof(request);run=owned(store,user,'runs',id)
    artifacts=store.all('SELECT * FROM agent_artifacts WHERE run_id=? ORDER BY created_at,id',(id,))
    trace=store.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq',(id,))
    anchors={e['payload'].get('artifact_id'):e['payload'].get('output_hash') for e in trace if e['type']=='step_completed'}
    for artifact in artifacts:
        artifact['integrity_valid']=artifact['content_hash']==digest(artifact['payload'])
        artifact['event_anchor_valid']=anchors.get(artifact['id'])==artifact['content_hash']
    final=next((a for a in artifacts if a['node']=='report'),None)
    report_valid=(digest(run['result'])==final['content_hash']) if final and run['result'] else None
    snapshot_valid=(digest(run['snapshot'])==run['result'].get('snapshot_hash')) if run['result'] else None
    return {'ledger':ws.verify_ledger(store,id),'artifacts':artifacts,'trace':trace,
        'snapshot_hash':digest(run['snapshot']),'snapshot_hash_valid':snapshot_valid,'report_hash_valid':report_valid,
        'data_hash_valid':digest(run['snapshot']['dataset'])==run['snapshot']['dataset_hash']}



@router.get('/runs/{id}/reviews')
def claim_reviews(id:str,request:Request,user=Depends(require_user)):
    store=dbof(request);owned(store,user,'runs',id)
    return {'items':[r for r in ws.objects(store,user['id'],'claim_review',1000) if r['payload']['run_id']==id]}


@router.post('/runs/{id}/reviews')
def review_claim(id:str,body:ClaimReview,request:Request,user=Depends(require_user)):
    store=dbof(request)
    with store.transaction() as db:
        r=owned(store,user,'runs',id)
        if not r['result']:fail('NOT_READY','运行尚未产生报告',409)
        claims=r['result']['llm']['review']['claims']
        if body.claim_id not in {c.get('id',digest(c)[:24]) for c in claims}:fail('NOT_FOUND','对应解释不存在',404)
        return ws.save(store,db,user['id'],'claim_review',{'run_id':id,**body.model_dump(exclude={'version'})},key=id+':'+body.claim_id,expected=body.version)


@router.get('/reports/compare')
def report_compare(request:Request,left:str=Query(...,max_length=80),right:str=Query(...,max_length=80),user=Depends(require_user)):
    store=dbof(request);a=owned(store,user,'runs',left);b=owned(store,user,'runs',right)
    if not a['result'] or not b['result']:fail('NOT_READY','两次运行均需生成报告',409)
    if a['snapshot']['dataset']['company']!=b['snapshot']['dataset']['company']:
        fail('COMPANY_MISMATCH','报告修订对比只支持同一企业；跨企业请使用企业对照',422)
    am=a['result']['analysis'];bm=b['result']['analysis']
    keys=set(am['metrics'])&set(bm['metrics']);deltas=[]
    for k in sorted(keys):
        av,bv=am['metrics'][k],bm['metrics'][k]
        if k=='period':continue
        deltas.append({'metric':k,'before':av,'after':bv,'delta':bv-av if isinstance(av,(int,float)) and isinstance(bv,(int,float)) else None})
    return {'left':left,'right':right,'same_period':am['current_period']==bm['current_period'],
        'same_rule_version':am['model_version']==bm['model_version'],'left_period':am['current_period'],'right_period':bm['current_period'],
        'changes':deltas,'input_diff':dataset_diff(a['snapshot']['dataset'],b['snapshot']['dataset']),
        'warning':'跨季度变化包含期间差异；不能把修订差异或相关变化当成干预效果'}


@router.post('/assistant')
def assistant(body:AssistantRequest,request:Request,user=Depends(require_user)):
    return assistant_answer(dbof(request),user['id'],body.query,body.dataset_id)


@router.get('/export')
def export_workspace(request:Request,user=Depends(require_user)):
    store=dbof(request);kinds=sorted(ws.KINDS)
    payload={'format':'lidian-workspace-export','created_at':now(),
        'objects':{kind:ws.objects(store,user['id'],kind,10000) for kind in kinds},
        'data':{t:store.items(t,user['id'],10000) for t in ('datasets','conversations','memories','evidence','runs','messages','feedback')},
        'run_events':store.all('SELECT e.* FROM run_events e JOIN runs r ON r.id=e.run_id WHERE r.user_id=? ORDER BY e.seq',(user['id'],)),
        'agent_artifacts':store.all('SELECT a.* FROM agent_artifacts a JOIN runs r ON r.id=a.run_id WHERE r.user_id=? ORDER BY a.created_at',(user['id'],)),
        'event_integrity':store.all('SELECT e.* FROM event_integrity e JOIN runs r ON r.id=e.run_id WHERE r.user_id=? ORDER BY e.event_seq',(user['id'],)),
        'adaptive':{t:store.all(f'SELECT a.* FROM {t} a JOIN runs r ON r.id=a.run_id WHERE r.user_id=?',(user['id'],)) for t in ('adaptive_graphs','adaptive_controls','adaptive_checkpoints','adaptive_calls')},
        'dataset_revisions':store.all('SELECT * FROM dataset_revisions WHERE user_id=? ORDER BY dataset_id,version',(user['id'],)),
        'notice':'包含个人业务数据、批准记忆及历史快照；不包含密码、会话凭据和模型密钥。不是可直接覆盖数据库的格式。'}
    return Response(encode(payload),media_type='application/json',headers={'Content-Disposition':'attachment; filename="lidian-workspace.json"'})


@router.delete('/archive/{kind}/{id}')
def archive_delete(kind:str,id:str,request:Request,user=Depends(require_user)):
    if kind not in {'plan','experiment','action','import_stage','dismissal'}:
        fail('KIND_FORBIDDEN','此类记录不可通过该接口删除',422)
    store=dbof(request)
    with store.transaction() as db:
        row=ws.get(store,user['id'],kind,id)
        if kind=='plan' and row['payload']['status']=='dispatched':
            run=store.owned('runs',user['id'],row['payload']['run_id'])
            if run and run['state'] in ('running','queued'):fail('RUN_ACTIVE','先取消或等待对应任务',409)
        db.execute('DELETE FROM workspace_objects WHERE id=? AND user_id=?',(id,user['id']))
        store.audit(db,user['id'],kind,id,'deleted')
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
