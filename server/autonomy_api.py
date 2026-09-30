"""User-owned control and evaluation API. All mutations inherit auth/CSRF checks."""
from fastapi import APIRouter, Depends, Request, Query
from .security import require_user
from .autonomy import CAPABILITIES, runtime_view, control_run
from .autonomy_contracts import RunControl, RunAssessment, StrategySpec, ActivateStrategy, RollbackStrategy
from . import evolution, workspace_store as ws

router=APIRouter(prefix='/api/workspace', tags=['Adaptive research'])

@router.get('/orchestration/catalog')
def catalog(request:Request, user=Depends(require_user)):
    from .connections import scoped_providers
    return {'capabilities':[{'id':id,'name':v[0],'purpose':v[1],'engine':v[2]} for id,v in CAPABILITIES.items()],
            'limits':{'max_nodes':24,'max_external_calls':8,'max_revisions':2,'external_search':False,'code_execution':False,'business_write':False},
            'providers':scoped_providers(request.app.state.providers,user['id']).status()}

@router.get('/runs/{id}/runtime')
def runtime(id:str,request:Request,user=Depends(require_user)):
    return runtime_view(request.app.state.store,user['id'],id)

@router.post('/runs/{id}/control')
def control(id:str,body:RunControl,request:Request,user=Depends(require_user)):
    return control_run(request.app.state.store,user,id,body,request.app.state.settings.max_queued_per_user)

@router.get('/runs/{id}/assessment')
def get_assessment(id:str,request:Request,user=Depends(require_user)):
    from .security import fail
    if not request.app.state.store.owned('runs',user['id'],id):fail('NOT_FOUND','运行不存在或无访问权限',404)
    store=request.app.state.store;row=ws.keyed(store,user['id'],'assessment',id)
    return {'item':evolution.assessment_context(store,user['id'],row) if row else None,
            'review_context':evolution.review_context(store,user['id'],id)}

@router.post('/runs/{id}/assessment')
def assess(id:str,body:RunAssessment,request:Request,user=Depends(require_user)):
    return evolution.assessment(request.app.state.store,user,id,body)

@router.get('/evolution')
def evolution_view(request:Request,user=Depends(require_user)):
    return evolution.overview(request.app.state.store,user['id'])

@router.post('/strategies',status_code=201)
def new_strategy(body:StrategySpec,request:Request,user=Depends(require_user)):
    store=request.app.state.store
    with store.transaction() as db:return ws.save(store,db,user['id'],'strategy',body.model_dump())

@router.post('/strategies/{id}/evaluate',status_code=201)
def evaluate_strategy(id:str,request:Request,user=Depends(require_user)):
    return evolution.evaluate(request.app.state.store,user,id)

@router.post('/strategies/{id}/activate')
def activate_strategy(id:str,body:ActivateStrategy,request:Request,user=Depends(require_user)):
    return evolution.activate(request.app.state.store,user,id,body)

@router.post('/strategies/rollback')
def rollback_strategy(body:RollbackStrategy,request:Request,user=Depends(require_user)):
    return evolution.rollback(request.app.state.store,user,body)

@router.post('/evolution/propose',status_code=201)
def propose_strategy(request:Request,user=Depends(require_user)):
    return evolution.propose_from_assessments(request.app.state.store,user)


@router.delete('/strategies/{id}')
def delete_strategy(id:str,request:Request,version:int|None=Query(None,ge=1),user=Depends(require_user)):
    return evolution.delete_record(request.app.state.store,user,'strategy',id,version)


@router.delete('/strategy-evaluations/{id}')
def delete_evaluation(id:str,request:Request,version:int|None=Query(None,ge=1),user=Depends(require_user)):
    return evolution.delete_record(request.app.state.store,user,'strategy_evaluation',id,version)
