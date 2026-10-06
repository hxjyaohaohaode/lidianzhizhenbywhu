"""Actual report/action/watch/alert chains; malformed saved projections stay unusable."""
from copy import deepcopy
import pytest
from test_saved_comparisons import inputs,saved,run
from test_business_provenance import action,action_ref,ok
from test_report_source_integrity import watch_request
from server.store import encode,digest

@pytest.mark.parametrize('case',['missing_result','items_object','metric_boolean','duplicate_member','one_member'])
def test_rehashed_but_malformed_projection_is_not_current_or_inheritable(actor,case):
    ds=inputs(actor);comparison=saved(actor,ds);report=run(actor,ds,comparison)
    parent=ok(action(actor,ds[0],source_ref={'kind':'report','run_id':report['id']}),201)
    broken=deepcopy(parent['payload']);ref=broken['provenance']['comparison_reference'];p=ref['payload']
    if case=='missing_result':del p['result']
    elif case=='items_object':p['result']['items']={}
    elif case=='metric_boolean':p['result']['items'][0]['analysis']['metrics']['gross_margin']=True
    elif case=='duplicate_member':p['members'][1]=deepcopy(p['members'][0])
    else:p['members']=p['members'][:1]
    ref['projection_hash']=digest(p)
    store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(broken),parent['id']))
    before=store.db.total_changes
    response=actor.get('/workspace/actions');assert response.status_code==200,response.text
    current=next(x for x in response.json()['items'] if x['id']==parent['id'])
    assert current['source_impact']['state']=='unavailable',(case,current['source_impact'])
    for response in (action(actor,ds[0],source_ref={**action_ref(current),'allow_historical':True}),watch_request(actor,ds[0],{**action_ref(current),'allow_historical':True})):
        assert response.status_code==409,response.text
        assert response.json()['error']['code']=='SOURCE_INTEGRITY'
    assert store.db.total_changes==before
    assert store.owned('runs',actor.user['id'],report['id'])==report


from copy import deepcopy
from datetime import date
import pytest
from test_saved_comparisons import inputs,saved,run
from test_business_provenance import action,action_ref,ok,revise
from test_report_source_integrity import watch_request
from server.store import encode,digest
from server.copilot import evaluate_watches
from server import workspace_store as ws

@pytest.mark.parametrize('damage',['empty','none','items_object'])
def test_comparison_receipt_inside_frozen_alert_origin_cannot_launder_history(actor,damage):
    ds=inputs(actor);comparison=saved(actor,ds);report=run(actor,ds,comparison)
    parent=ok(action(actor,ds[0],source_ref={'kind':'report','run_id':report['id']}),201)
    watch=ok(watch_request(actor,ds[0],action_ref(parent)),201);store=actor.client.app.state.store
    evaluated=evaluate_watches(store,actor.user['id'],today=date(2026,10,1))
    selected=next(x for x in evaluated['evaluations'] if x['rule_id']==watch['id'])
    alert=ws.get(store,actor.user['id'],'alert',selected['alert_id']);broken=deepcopy(alert['payload'])
    origin=broken['provenance']['rule_origin']
    if damage=='empty':origin['comparison_reference']={}
    elif damage=='none':origin['comparison_reference']=None
    else:
        ref=origin['comparison_reference'];ref['payload']['result']['items']={};ref['projection_hash']=digest(ref['payload'])
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(broken),alert['id']))
    before=store.db.total_changes
    source={'kind':'alert','alert_id':alert['id'],'allow_historical':True}
    for response in (action(actor,ds[0],source_ref=source),watch_request(actor,ds[0],source)):
        assert response.status_code==409,(damage,response.status_code)
        assert response.json()['error']['code']=='SOURCE_INTEGRITY'
    assert store.db.total_changes==before
    assert ws.get(store,actor.user['id'],'alert',alert['id'])['payload']['value']==alert['payload']['value']
    assert store.owned('runs',actor.user['id'],report['id'])==report


from copy import deepcopy
import pytest
from conftest import editable
from test_saved_comparisons import inputs,saved,run
from test_business_provenance import action,action_ref,ok
from test_report_source_integrity import watch_request

@pytest.mark.parametrize('remove_comparison',[False,True])
def test_original_producer_null_metric_and_deleted_report_remain_historical(actor,remove_comparison):
    ds=list(inputs(actor));body=editable(ds[0]);body['periods'][-1]['net_profit']=None
    ds[0]=ok(actor.put('/datasets/'+ds[0]['id'],json=body))
    comparison=saved(actor,ds);report=run(actor,ds,comparison)
    parent=ok(action(actor,ds[0],source_ref={'kind':'report','run_id':report['id']}),201)
    ref=deepcopy(parent['payload']['provenance']['comparison_reference'])
    assert ref['payload']['result']['items'][0]['analysis']['metrics']['net_margin'] is None
    store=actor.client.app.state.store
    if remove_comparison:ok(actor.delete('/workspace/comparisons/'+comparison['id']+'?version='+str(comparison['version'])))
    session=store.owned('conversations',actor.user['id'],report['session_id'])
    ok(actor.delete('/conversations/'+session['id']+'?version='+str(session['version'])))
    listed=next(x for x in ok(actor.get('/workspace/actions'))['items'] if x['id']==parent['id'])
    assert listed['source_impact']['state']=='unavailable'
    assert 'comparison_receipt_changed' not in {r['code'] for r in listed['source_impact']['reasons']}
    assert action(actor,ds[0],source_ref=action_ref(listed)).status_code==409
    child=ok(action(actor,ds[0],source_ref={**action_ref(listed),'allow_historical':True}),201)
    watch=ok(watch_request(actor,ds[0],{**action_ref(listed),'allow_historical':True}),201)
    assert child['payload']['provenance']['comparison_reference']==ref
    assert watch['payload']['provenance']['comparison_reference']==ref
    assert store.one('SELECT * FROM workspace_objects WHERE id=?',(parent['id'],))['payload']==parent['payload']
