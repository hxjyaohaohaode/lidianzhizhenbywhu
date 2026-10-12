"""Pre-fix API plans must not turn missing modern seals into execution authority."""
import hashlib
import pytest
from test_percentage_execution_scope import captured_actor,objects
from test_legacy_execution_scope import frozen
from server.studio import approved_run_valid,plan_fingerprint_valid

FIXTURE='unsealed-experiment-plans-41b763e.json'

@pytest.fixture
def restore_exact_synthetic_provider(captured_actor):
    # Restore the same non-network provider configuration used by the capture,
    # so an unrelated PROVIDER_CHANGED error cannot mask the missing seal gate.
    from server.providers import Provider
    captured_actor.client.app.state.worker.providers.providers['fixture']=Provider(
        'fixture','synthetic.invalid','/never','fixture','NOT-A-REAL-KEY')

@pytest.mark.usefixtures('restore_exact_synthetic_provider')
@pytest.mark.parametrize('captured_actor',[FIXTURE],indirect=True)
def test_old_unsealed_draft_rejects_new_approval_before_any_write(captured_actor):
    a=captured_actor;store,case,p,_=objects(a,'draft');before=frozen(store,case);changes=store.db.total_changes
    detail=a.get('/workspace/experiments/'+case['experiment_id']).json()
    assert detail['integrity']['valid'] is False
    response=a.post('/workspace/plans/'+p['id']+'/execute',json={'version':p['version'],'fingerprint':p['payload']['fingerprint'],'external_consent':True})
    assert response.status_code==409,response.text
    assert response.json()['error']['code'] in ('PLAN_STALE','EXPERIMENT_INTEGRITY','PLAN_SCOPE_REPREVIEW')
    assert store.db.total_changes==changes and frozen(store,case)==before

@pytest.mark.usefixtures('restore_exact_synthetic_provider')
@pytest.mark.parametrize('captured_actor',[FIXTURE],indirect=True)
def test_old_unsealed_queue_stops_before_any_calculation_or_provider(captured_actor):
    a=captured_actor;store,case,p,run=objects(a,'queued');before=frozen(store,case)
    done=a.execute(run)
    assert done['state']=='interrupted' and done['result'] is None,done
    assert '重新预览' in done['error'] and frozen(store,case)==before
    assert plan_fingerprint_valid(p['payload']) and approved_run_valid(store,done)
    events=store.all('SELECT * FROM run_events WHERE run_id=?',(run['id'],))
    assert [e['type'] for e in events]==['queued','running','scope_repreview_required']
    assert store.all('SELECT * FROM adaptive_calls WHERE run_id=?',(run['id'],))==[]

@pytest.mark.usefixtures('restore_exact_synthetic_provider')
@pytest.mark.parametrize('captured_actor',[FIXTURE],indirect=True)
def test_old_unsealed_pause_cannot_resume_or_replace_original_frozen_scope(captured_actor):
    a=captured_actor;store,case,p,run=objects(a,'paused');before=frozen(store,case)
    control=store.one('SELECT * FROM adaptive_controls WHERE run_id=?',(run['id'],));changes=store.db.total_changes
    response=a.post('/workspace/runs/'+run['id']+'/control',json={'version':control['version'],'action':'resume'})
    assert response.status_code==409 and response.json()['error']['code']=='PLAN_SCOPE_REPREVIEW'
    assert store.db.total_changes==changes and frozen(store,case)==before
    assert store.one('SELECT * FROM adaptive_controls WHERE run_id=?',(run['id'],))==control

@pytest.mark.usefixtures('restore_exact_synthetic_provider')
@pytest.mark.parametrize('captured_actor',[FIXTURE],indirect=True)
def test_completed_pre_fix_report_remains_byte_exact_read_only(captured_actor):
    a=captured_actor;store,case,p,run=objects(a,'completed');before=frozen(store,case);changes=store.db.total_changes
    assert a.get('/runs/'+run['id']).json()['result']==run['result']
    for fmt,sha in case['export_sha256'].items():
        response=a.get('/runs/'+run['id']+'/export?format='+fmt)
        assert response.status_code==200 and hashlib.sha256(response.content).hexdigest()==sha
    assert store.db.total_changes==changes and frozen(store,case)==before


def test_implicit_experiment_selection_is_adaptive_and_shared_source_guard_rechecks_deletion(actor):
    from test_saved_experiments import save,reference
    from server.source_bindings import source_error
    dataset=actor.dataset();experiment=save(actor,dataset)
    response=actor.post('/workspace/plans',json={'dataset_id':dataset['id'],'query':'经营毛利研判','experiment':reference(experiment)})
    assert response.status_code==201,response.text
    plan=response.json()['payload']
    # The current API fills explicit saved assumptions before attaching the graph;
    # an omitted execution field no longer creates the old unguarded legacy path.
    assert plan['adaptive'] and plan['request']['execution']['scenario']
    store=actor.client.app.state.store;user=store.one('SELECT * FROM users WHERE id=?',(actor.user['id'],))
    assert source_error(store,user,plan['request'],plan['snapshot'],plan['bindings']) is None
    assert actor.delete('/workspace/archive/experiment/'+experiment['id']+'?version=1').status_code==200
    assert '实验' in source_error(store,user,plan['request'],plan['snapshot'],plan['bindings'])
