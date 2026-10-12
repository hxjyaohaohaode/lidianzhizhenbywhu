"""Authentic pre-fix 41b763e API records; no fabricated or re-sealed plans.

The fixture contains synthetic business rows only. Owner columns are mapped to
an isolated test actor, while original payloads/fingerprints remain byte exact.
"""
import hashlib
import pytest
from test_percentage_execution_scope import captured_actor, objects
from test_legacy_execution_scope import frozen,approve
from server.execution_scope import plan_scope_issue
from server.studio import approved_run_valid,plan_fingerprint_valid

FIXTURE='unsupported-plan-scope-41b763e.json'
HISTORICAL_FIXTURES=[FIXTURE,'annualization-scope-r1.json']

@pytest.mark.parametrize('captured_actor',HISTORICAL_FIXTURES,indirect=True)
@pytest.mark.parametrize('key',['legacy_draft','adaptive_draft'])
def test_old_unsupported_draft_requires_new_preview_without_writes(captured_actor,key):
    a=captured_actor;store,case,p,_=objects(a,key);before=frozen(store,case);changes=store.db.total_changes
    expected='annualization_unsupported' if '年化' in p['payload']['request']['query'] else 'financial_operation_unsupported'
    assert plan_scope_issue(store,p)['reason']==expected
    response=approve(a,case,p)
    assert response.status_code==409 and response.json()['error']['code']=='PLAN_SCOPE_REPREVIEW'
    assert store.db.total_changes==changes and frozen(store,case)==before

@pytest.mark.parametrize('captured_actor',HISTORICAL_FIXTURES,indirect=True)
@pytest.mark.parametrize('key',['legacy_queued','adaptive_queued'])
def test_old_unsupported_queue_stops_before_calculation_and_keeps_original_bytes(captured_actor,key):
    a=captured_actor;store,case,p,run=objects(a,key);before=frozen(store,case)
    done=a.execute(run)
    assert done['state']=='interrupted' and done['result'] is None
    assert '重新预览' in done['error'] and frozen(store,case)==before
    assert plan_fingerprint_valid(p['payload']) and approved_run_valid(store,done)
    assert store.all('SELECT * FROM run_events WHERE run_id=?',(run['id'],))[-1]['type']=='scope_repreview_required'

@pytest.mark.parametrize('captured_actor',HISTORICAL_FIXTURES,indirect=True)
def test_old_unsupported_resume_does_not_requeue_or_rewrite_checkpoints(captured_actor):
    a=captured_actor;store,case,p,run=objects(a,'adaptive_paused');before=frozen(store,case)
    control=store.one('SELECT * FROM adaptive_controls WHERE run_id=?',(run['id'],));changes=store.db.total_changes
    response=a.post('/workspace/runs/'+run['id']+'/control',json={'version':control['version'],'action':'resume'})
    assert response.status_code==409 and response.json()['error']['code']=='PLAN_SCOPE_REPREVIEW'
    assert store.db.total_changes==changes and frozen(store,case)==before
    assert store.one('SELECT * FROM adaptive_controls WHERE run_id=?',(run['id'],))==control

@pytest.mark.parametrize('captured_actor',HISTORICAL_FIXTURES,indirect=True)
@pytest.mark.parametrize('key',['legacy_completed','adaptive_completed'])
def test_historical_unsupported_report_stays_readable_byte_exact_without_rerun(captured_actor,key):
    a=captured_actor;store,case,p,run=objects(a,key);before=frozen(store,case);changes=store.db.total_changes
    assert a.get('/runs/'+run['id']).json()['result']==run['result']
    for fmt,sha in case['export_sha256'].items():
        response=a.get('/runs/'+run['id']+'/export?format='+fmt)
        assert response.status_code==200 and hashlib.sha256(response.content).hexdigest()==sha
    assert frozen(store,case)==before and store.db.total_changes==changes


def test_real_pre_fix_account_and_annualized_plans_require_repreview_without_resealing():
    import json
    from pathlib import Path
    from copy import deepcopy
    # Three authentic R1 API plans, captured before account/annualization guards;
    # no payload, scope, fingerprint, or owner value is changed by this test.
    rows=json.loads((Path(__file__).parent/'fixtures/legacy-account-plans-r1.json').read_text())
    before=deepcopy(rows);reasons={}
    for row in rows:
        assert plan_fingerprint_valid(row['payload'])
        result=plan_scope_issue(None,row)
        reasons[row['payload']['request']['query']]=result['reason'] if result else None
    assert reasons=={'2025-Q4年化净资产收益率':'annualization_unsupported',
                    '2025-Q4营业外收入':'financial_operation_unsupported','2025-Q4营业收入':None}
    assert rows==before
