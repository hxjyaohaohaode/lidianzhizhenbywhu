import copy
import pytest
from test_workspace_api import plan, execute
from test_business_provenance import action, ok
from server.store import encode, digest
from server.business_provenance import report_impact
from server.report_integrity import inspect_report_integrity

@pytest.mark.parametrize('kind',['report','action','dataset'])
def test_live_payload_hash_mismatch_is_not_current_and_requires_new_choice(actor,kind):
    d=actor.dataset();store=actor.client.app.state.store
    report=execute(actor,plan(actor,d))
    original=ok(action(actor,d,source_ref={'kind':'report','run_id':report['id']}),201)
    altered=copy.deepcopy(d['payload']);altered['periods'][-1]['cost']+=99
    with store.transaction() as db:db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(altered),d['id']))
    assert inspect_report_integrity(store,store.owned('runs',actor.user['id'],report['id']))['report_integrity']['valid']
    source=({'kind':'report','run_id':report['id']} if kind=='report' else
            {'kind':'action','action_id':original['id'],'action_version':original['version'],'action_hash':digest(original['payload'])} if kind=='action' else
            {'kind':'dataset','dataset_version':d['version'],'dataset_hash':d['content_hash']})
    response=action(actor,d,source_ref=source)
    assert response.status_code==409, (kind,response.status_code,response.json().get('source_impact'),report_impact(store,actor.user['id'],report))


@pytest.mark.parametrize('kind',['report','action'])
def test_sound_frozen_history_can_be_explicitly_retained_when_live_input_is_bad(actor,kind):
    d=actor.dataset();store=actor.client.app.state.store;report=execute(actor,plan(actor,d))
    original=ok(action(actor,d,source_ref={'kind':'report','run_id':report['id']}),201)
    frozen=copy.deepcopy(report['result']);changed=copy.deepcopy(d['payload']);changed['periods'][-1]['cost']+=99
    with store.transaction() as db:db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(changed),d['id']))
    ref={'kind':'report','run_id':report['id']} if kind=='report' else {'kind':'action','action_id':original['id'],'action_version':original['version'],'action_hash':digest(original['payload'])}
    created=ok(action(actor,d,source_ref={**ref,'allow_historical':True}),201)
    assert created['source_impact']['state']=='unavailable'
    assert any(r['code']=='dataset_integrity' for r in created['source_impact']['reasons'])
    current=store.owned('runs',actor.user['id'],report['id'])
    assert current['result']==frozen and inspect_report_integrity(store,current)['report_integrity']['valid']


def test_direct_bad_live_input_cannot_be_accepted_as_history(actor):
    d=actor.dataset();store=actor.client.app.state.store;p=copy.deepcopy(d['payload']);p['periods'][-1]['cost']+=99
    with store.transaction() as db:db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(p),d['id']))
    before=store.db.total_changes
    response=action(actor,d,source_ref={'kind':'dataset','dataset_version':d['version'],'dataset_hash':d['content_hash'],'allow_historical':True})
    assert response.status_code==409 and response.json()['error']['code']=='SOURCE_INTEGRITY'
    assert store.db.total_changes==before
