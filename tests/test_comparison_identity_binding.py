"""Saved comparison authority is bound before a later plan is constructed."""
import pytest
from test_services import identity, ok
from test_saved_comparisons import inputs, saved, plan, run
from test_business_provenance import action
from server.store import digest


@pytest.mark.parametrize('patch',[{'objective':'新的明确研究目标'},{'allow_external':True},{'dataset_ids':[]}],ids=['objective','permission','scope-widened'])
def test_identity_edit_invalidates_saved_comparison_before_new_plan(actor,patch):
    ds=inputs(actor);ident=identity(actor,dataset_ids=[d['id'] for d in ds]);comparison=saved(actor,ds,identity_id=ident['id'])
    ok(actor.put('/services/identities/'+ident['id'],json={**ident['payload'],**patch,'version':ident['version']}))
    row=ok(actor.get('/workspace/comparisons/'+comparison['id']+'?identity_id='+ident['id']))
    assert row['payload']==comparison['payload'] and row['comparison_hash']==comparison['comparison_hash']
    assert row['source_impact']['state']!='current',row['source_impact']
    before=actor.client.app.state.store.db.total_changes
    response=plan(actor,ds,comparison,identity_id=ident['id'])
    assert response.status_code==409 and response.json()['error']['code']=='PLAN_STALE',response.text
    assert actor.client.app.state.store.db.total_changes==before


def test_real_archived_comparison_projection_keeps_existing_identity_compatibility(actor):
    ds=inputs(actor);ident=identity(actor,dataset_ids=[d['id'] for d in ds]);comparison=saved(actor,ds,identity_id=ident['id'])
    report=run(actor,ds,comparison,identity_id=ident['id'])
    original=ok(action(actor,ds[0],identity_id=ident['id'],source_ref={'kind':'report','run_id':report['id']}),201)
    reference=original['payload']['provenance']['comparison_reference']
    assert 'identity_binding' not in reference['payload']  # genuine existing producer; nothing removed
    assert original['source_impact']['state']=='current'
    child=ok(action(actor,ds[0],identity_id=ident['id'],source_ref={'kind':'action','action_id':original['id'],
        'action_version':original['version'],'action_hash':digest(original['payload'])}),201)
    assert child['source_impact']['state']=='current' and child['payload']['provenance']['comparison_reference']==reference



def test_payload_marker_cannot_exempt_a_full_saved_comparison_identity_binding(actor):
    from server.saved_comparisons import current_impact, freeze
    ds=inputs(actor);ident=identity(actor,dataset_ids=[d['id'] for d in ds]);comparison=saved(actor,ds,identity_id=ident['id'])
    ok(actor.put('/services/identities/'+ident['id'],json={**ident['payload'],'objective':'改变后的目标','version':ident['version']}))
    frozen=freeze(comparison);frozen['projection_hash']=digest(frozen['payload'])
    assert current_impact(actor.client.app.state.store,actor.user['id'],frozen)['state']=='changed'
