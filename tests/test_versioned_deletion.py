"""Destructive actions must bind the revision the user actually reviewed."""
import pytest
from conftest import Actor, editable
from server import workspace_store as ws


@pytest.mark.parametrize('resource',['datasets','memories','evidence','conversations'])
def test_owned_deletion_requires_viewed_version(actor,resource):
    if resource=='datasets':row=actor.dataset()
    elif resource=='conversations':row=actor.conversation()
    elif resource=='memories':row=actor.post('/memories',json={'text':'需要保留的实际研究备注'}).json()
    else:row=actor.post('/evidence',json={'title':'证据资料','text':'需要核对的外部资料，不能在旧确认下删除。'*4}).json()
    url='/'+resource+'/'+row['id']
    assert actor.delete(url).status_code==428
    assert actor.delete(url,params={'version':row['version']+1}).status_code==409
    assert actor.delete(url,params={'version':row['version']}).status_code==200


def test_stale_dataset_delete_keeps_new_revision(actor):
    row=actor.dataset();body=editable(row);body['name']='另一窗口已更正的数据'
    assert actor.put('/datasets/'+row['id'],json=body).status_code==200
    denied=actor.delete('/datasets/'+row['id'],params={'version':row['version']})
    assert denied.status_code==409
    assert actor.get('/datasets/'+row['id']).json()['payload']['name']==body['name']


def test_stale_conversation_delete_does_not_cancel_new_task(actor):
    conversation=actor.conversation();run=actor.run(session=conversation).json()
    result=actor.delete('/conversations/'+conversation['id'],params={'version':conversation['version']})
    assert result.status_code==409
    assert actor.get('/runs/'+run['id']).json()['state']=='queued'


def test_batch_delete_checks_all_versions_before_any_side_effect(actor):
    a,b=actor.conversation(),actor.conversation()
    run=actor.run(session=b).json()
    result=actor.post('/conversations/delete-batch',json={'ids':[a['id'],b['id']],
        'versions':{a['id']:a['version'],b['id']:b['version']}})
    assert result.status_code==409
    assert len(actor.get('/conversations').json()['items'])==2
    assert actor.get('/runs/'+run['id']).json()['state']=='queued'


@pytest.mark.parametrize('kind',['action','template','plan'])
def test_workspace_mutation_is_version_bound(actor,kind):
    store=actor.client.app.state.store
    with store.transaction() as db:
        row=ws.save(store,db,actor.user['id'],kind,{'status':'draft','title':'初始记录'})
        changed=ws.save(store,db,actor.user['id'],kind,{'status':'draft','title':'新修订'},key=row['natural_key'],expected=row['version'])
    if kind=='template':call=lambda version:actor.delete('/workspace/templates/'+row['id'],params={'version':version})
    elif kind=='plan':call=lambda version:actor.post('/workspace/plans/'+row['id']+'/cancel',params={'version':version})
    else:call=lambda version:actor.delete('/workspace/archive/action/'+row['id'],params={'version':version})
    assert call(row['version']).status_code==409
    assert ws.get(store,actor.user['id'],kind,row['id'])['payload']['title']=='新修订'
    assert call(changed['version']).status_code==200


def test_paused_run_keeps_approval_plan_until_explicit_cancel(actor):
    from test_adaptive import preview,dispatch,runtime
    plan=preview(actor);run=dispatch(actor,plan)
    control=runtime(actor,run)['control']
    result=actor.post('/workspace/runs/'+run['id']+'/control',json={'action':'pause','version':control['version']})
    assert result.status_code==200,result.text
    current=actor.get('/workspace/plans/'+plan['id']).json()
    target='/workspace/archive/plan/'+plan['id']
    assert actor.delete(target,params={'version':current['version']}).status_code==409
    assert actor.post('/runs/'+run['id']+'/cancel').status_code==200
    assert actor.delete(target,params={'version':current['version']}).status_code==200
