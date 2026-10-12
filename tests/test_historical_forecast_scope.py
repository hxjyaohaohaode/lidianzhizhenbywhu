"""Genuine unmodified R4 approvals must not execute their wrong default metric."""
import hashlib
import pytest
from test_percentage_execution_scope import captured_actor,objects
from test_legacy_execution_scope import frozen,approve
from server.execution_scope import plan_scope_issue
from server.studio import approved_run_valid,plan_fingerprint_valid

FIXTURE='forecast-execution-scope-r4.json'


@pytest.mark.parametrize('captured_actor',[FIXTURE],indirect=True)
@pytest.mark.parametrize('metric',['net_profit','cash_flow'])
def test_old_draft_rejects_wrong_metric_without_writes(captured_actor,metric):
    a=captured_actor;store,case,p,_=objects(a,metric+'_draft');before=frozen(store,case)
    assert plan_scope_issue(store,p)['reason']=='forecast_metric_mismatch'
    changes=store.db.total_changes;r=approve(a,case,p)
    assert r.status_code==409 and r.json()['error']['code']=='PLAN_SCOPE_REPREVIEW'
    assert store.db.total_changes==changes and frozen(store,case)==before


@pytest.mark.parametrize('captured_actor',[FIXTURE],indirect=True)
@pytest.mark.parametrize('metric',['net_profit','cash_flow'])
def test_old_queued_wrong_metric_stops_before_any_local_node_or_send(captured_actor,metric):
    a=captured_actor;store,case,p,run=objects(a,metric+'_queued');before=frozen(store,case)
    done=a.execute(run)
    assert done['state']=='interrupted' and done['result'] is None and '重新预览' in done['error']
    assert frozen(store,case)==before and approved_run_valid(store,done) and plan_fingerprint_valid(p['payload'])
    events=store.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq',(run['id'],))
    assert [e['type'] for e in events]==['queued','running','scope_repreview_required']
    assert store.all('SELECT * FROM adaptive_calls WHERE run_id=?',(run['id'],))==[]


@pytest.mark.parametrize('captured_actor',[FIXTURE],indirect=True)
@pytest.mark.parametrize('metric',['net_profit','cash_flow'])
def test_old_paused_wrong_metric_cannot_resume_or_rewrite_checkpoint(captured_actor,metric):
    a=captured_actor;store,case,p,run=objects(a,metric+'_paused');before=frozen(store,case)
    assert before['adaptive_checkpoints'], 'Capture must include a genuine completed quality checkpoint'
    control=store.one('SELECT * FROM adaptive_controls WHERE run_id=?',(run['id'],));changes=store.db.total_changes
    r=a.post('/workspace/runs/'+run['id']+'/control',json={'version':control['version'],'action':'resume'})
    assert r.status_code==409 and r.json()['error']['code']=='PLAN_SCOPE_REPREVIEW'
    assert store.db.total_changes==changes and frozen(store,case)==before
    assert store.one('SELECT * FROM adaptive_controls WHERE run_id=?',(run['id'],))==control


@pytest.mark.parametrize('captured_actor',[FIXTURE],indirect=True)
@pytest.mark.parametrize('metric',['net_profit','cash_flow'])
def test_old_completed_wrong_metric_history_and_exports_remain_exact(captured_actor,metric):
    a=captured_actor;store,case,p,run=objects(a,metric+'_completed');before=frozen(store,case);changes=store.db.total_changes
    assert run['result']['adaptive']['mathematical_outputs']['forecast']['metric']=='revenue'
    assert a.get('/runs/'+run['id']).json()['result']==run['result']
    for fmt,sha in case['export_sha256'].items():
        r=a.get('/runs/'+run['id']+'/export?format='+fmt)
        assert r.status_code==200 and hashlib.sha256(r.content).hexdigest()==sha
    assert store.db.total_changes==changes and frozen(store,case)==before
