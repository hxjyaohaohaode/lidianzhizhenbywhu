"""Follow up an existing PR finding using only isolated API/worker fixtures."""
from copy import deepcopy
import pytest
from test_saved_comparisons import inputs, saved, run
from test_business_provenance import action, action_ref, ok, revise
from test_report_source_integrity import watch_request
from server.store import encode,digest
from conftest import Actor

@pytest.mark.parametrize('change',['name','metric','member','hash','missing_hash','payload_none','receipt_empty','receipt_none','receipt_text',
    'id_missing','version_boolean','source_hash_missing','rehashed_missing_identity','rehashed_bad_members'])
@pytest.mark.parametrize('target',['action','watch'])
def test_corrupted_saved_comparison_receipt_cannot_be_inherited_with_history_consent(actor,target,change):
    datasets=inputs(actor);comparison=saved(actor,datasets);report=run(actor,datasets,comparison)
    parent=ok(action(actor,datasets[0],source_ref={'kind':'report','run_id':report['id']}),201)
    broken=deepcopy(parent['payload']);reference=broken['provenance']['comparison_reference']
    if change=='name':reference['payload']['name']='Changed without original projection hash'
    elif change=='metric':reference['payload']['result']['items'][0]['analysis']['metrics']['gross_margin']=.999
    elif change=='member':reference['payload']['members'][0]['company']='Unapproved company'
    elif change=='hash':reference['projection_hash']='0'*64
    elif change=='missing_hash':reference.pop('projection_hash')
    elif change=='payload_none':reference['payload']=None
    elif change=='receipt_empty':broken['provenance']['comparison_reference']={}
    elif change=='receipt_none':broken['provenance']['comparison_reference']=None
    elif change=='receipt_text':broken['provenance']['comparison_reference']='malformed'
    elif change=='id_missing':reference.pop('id')
    elif change=='version_boolean':reference['version']=True
    elif change=='source_hash_missing':reference.pop('hash')
    else:
        if change=='rehashed_missing_identity':reference['payload'].pop('identity_id')
        else:reference['payload']['members']=[{'id':[],'company':{},'version':True,'hash':'bad'}]
        reference['projection_hash']=digest(reference['payload'])
    store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(broken),parent['id']))
    current=next(x for x in ok(actor.get('/workspace/actions'))['items'] if x['id']==parent['id'])
    assert current['source_impact']['state']=='unavailable'
    assert 'comparison_receipt_changed' in {r['code'] for r in current['source_impact']['reasons']}
    source={**action_ref(current),'allow_historical':True};before=store.db.total_changes
    response=action(actor,datasets[0],source_ref=source) if target=='action' else watch_request(actor,datasets[0],source)
    assert response.status_code==409,(target,response.status_code,response.text)
    assert response.json()['error']['code']=='SOURCE_INTEGRITY'
    assert store.db.total_changes==before
    assert store.owned('runs',actor.user['id'],report['id'])==report


def test_intact_receipt_with_changed_peer_still_allows_explicit_historical_use(actor):
    datasets=inputs(actor);comparison=saved(actor,datasets);report=run(actor,datasets,comparison)
    parent=ok(action(actor,datasets[0],source_ref={'kind':'report','run_id':report['id']}),201)
    revise(actor,datasets[1])
    current=next(x for x in ok(actor.get('/workspace/actions'))['items'] if x['id']==parent['id'])
    assert current['source_impact']['state']=='changed'
    assert action(actor,datasets[0],source_ref=action_ref(current)).status_code==409
    child=ok(action(actor,datasets[0],source_ref={**action_ref(current),'allow_historical':True}),201)
    assert child['source_impact']['state']=='changed'


def test_intact_archived_receipt_survives_original_comparison_cleanup_with_explicit_history(actor):
    datasets=inputs(actor);comparison=saved(actor,datasets);report=run(actor,datasets,comparison)
    parent=ok(action(actor,datasets[0],source_ref={'kind':'report','run_id':report['id']}),201)
    original=deepcopy(parent['payload']['provenance']['comparison_reference'])
    ok(actor.delete('/workspace/comparisons/'+comparison['id']+'?version=1'))
    current=next(x for x in ok(actor.get('/workspace/actions'))['items'] if x['id']==parent['id'])
    assert current['source_impact']['state']=='unavailable'
    assert 'comparison_receipt_changed' not in {r['code'] for r in current['source_impact']['reasons']}
    assert action(actor,datasets[0],source_ref=action_ref(current)).status_code==409
    child=ok(action(actor,datasets[0],source_ref={**action_ref(current),'allow_historical':True}),201)
    assert child['payload']['provenance']['comparison_reference']==original
    assert child['source_impact']['state']=='unavailable'


@pytest.mark.parametrize('target',['action','watch'])
def test_corrupt_receipt_recovery_starts_from_intact_report_and_never_repairs_the_original_action(actor,target):
    datasets=inputs(actor);comparison=saved(actor,datasets);report=run(actor,datasets,comparison)
    parent=ok(action(actor,datasets[0],source_ref={'kind':'report','run_id':report['id']}),201)
    broken=deepcopy(parent['payload']);broken['provenance']['comparison_reference']['projection_hash']='0'*64
    store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(broken),parent['id']))
    current=next(x for x in ok(actor.get('/workspace/actions'))['items'] if x['id']==parent['id'])
    stale_ref={**action_ref(parent),'allow_historical':True}
    stale=action(actor,datasets[0],source_ref=stale_ref) if target=='action' else watch_request(actor,datasets[0],stale_ref)
    assert stale.status_code==409 and stale.json()['error']['code']=='SOURCE_CHANGED'
    foreign=Actor(actor.client);ref={**action_ref(current),'allow_historical':True}
    denied=action(foreign,datasets[0],source_ref=ref) if target=='action' else watch_request(foreign,datasets[0],ref)
    assert denied.status_code==404
    fresh=ok(action(actor,datasets[0],source_ref={'kind':'report','run_id':report['id']}),201)
    assert fresh['source_impact']['state']=='current'
    assert fresh['payload']['provenance']['comparison_reference']==parent['payload']['provenance']['comparison_reference']
    ok(watch_request(actor,datasets[0],action_ref(fresh)),201)
    old=store.one('SELECT * FROM workspace_objects WHERE id=?',(parent['id'],))
    assert old['version']==parent['version'] and old['payload']==broken
    assert store.owned('runs',actor.user['id'],report['id'])==report
