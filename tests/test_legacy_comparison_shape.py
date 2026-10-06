"""Real pre-anchor output compatibility; isolated malformed rows stay read-only."""
import json
from pathlib import Path
import pytest
from server.store import encode

def restore_true_legacy(actor):
    fixture=json.loads((Path(__file__).parent/'fixtures/legacy-preanchor-report-b851806a.json').read_text())
    store=actor.client.app.state.store
    tables=['datasets','conversations','runs','run_events','event_integrity','agent_artifacts']
    assert set(fixture['tables'])==set(tables)
    with store.transaction() as db:
        for table in tables:
            for raw in fixture['tables'][table]:
                row=dict(raw)
                if 'user_id' in row: row['user_id']=actor.user['id']
                columns=list(row)
                db.execute('INSERT INTO '+table+'('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',[row[k] for k in columns])
    return store,fixture['run_id']

def test_real_preanchor_healthy_comparison_stays_available(actor):
    store,run_id=restore_true_legacy(actor); before=store.db.total_changes
    response=actor.get('/workspace/reports/compare',params={'left':run_id,'right':run_id})
    assert response.status_code==200,response.text
    assert response.json()['verification']['left']['whole_output_hash_verified'] is None
    assert store.db.total_changes==before

@pytest.mark.parametrize('change',['analysis_missing','analysis_list','metrics_list','metrics_empty','metrics_only_period',
    'metric_boolean','metric_string','metric_list','period_missing','period_bad','period_mismatch','rule_missing','rule_boolean','rule_empty'])
def test_real_preanchor_bad_comparison_shape_fails_closed(actor,change):
    store,run_id=restore_true_legacy(actor); run=store.owned('runs',actor.user['id'],run_id); result=run['result']
    if change=='analysis_missing':del result['analysis']
    elif change=='analysis_list':result['analysis']=[]
    elif change=='metrics_list':result['analysis']['metrics']=['gross_margin']
    elif change=='metrics_empty':result['analysis']['metrics']={}
    elif change=='metrics_only_period':result['analysis']['metrics']={'period':result['analysis']['current_period']}
    elif change=='metric_boolean':result['analysis']['metrics']['gross_margin']=True
    elif change=='metric_string':result['analysis']['metrics']['gross_margin']='.2'
    elif change=='metric_list':result['analysis']['metrics']['gross_margin']=[]
    elif change=='period_missing':del result['analysis']['current_period']
    elif change=='period_bad':result['analysis']['current_period']='2024-Q5'
    elif change=='period_mismatch':result['analysis']['metrics']['period']='2024-Q1'
    elif change=='rule_missing':del result['analysis']['model_version']
    elif change=='rule_boolean':result['analysis']['model_version']=False
    else:result['analysis']['model_version']=' '
    with store.transaction() as db:db.execute('UPDATE runs SET result=? WHERE id=?',(encode(result),run_id))
    audit=actor.get('/workspace/runs/'+run_id+'/audit')
    assert audit.status_code==200,audit.text
    assert audit.json()['report_integrity']['valid'] and audit.json()['report_hash_valid'] is None
    before=store.db.total_changes
    response=actor.get('/workspace/reports/compare',params={'left':run_id,'right':run_id})
    assert response.status_code==409,(change,response.status_code,response.text)
    assert response.json()['error']['code']=='REPORT_INTEGRITY'
    assert store.db.total_changes==before


@pytest.mark.parametrize('value',[float('nan'),float('inf'),float('-inf'),10**400])
def test_preanchor_nonfinite_or_unrepresentable_metric_is_rejected_without_response_500(actor,value):
    store,run_id=restore_true_legacy(actor);result=store.owned('runs',actor.user['id'],run_id)['result']
    result['analysis']['metrics']['gross_margin']=value
    # The actual writer refuses these values. Explicit raw corruption must also
    # fail the read boundary before hash/JSON serialization can throw a 500.
    with store.transaction() as db:db.execute('UPDATE runs SET result=? WHERE id=?',(json.dumps(result),run_id))
    before=store.db.total_changes
    response=actor.get('/workspace/reports/compare',params={'left':run_id,'right':run_id})
    assert response.status_code==409 and response.json()['error']['code']=='REPORT_INTEGRITY'
    assert store.db.total_changes==before


def test_preanchor_stored_zero_and_missing_values_are_not_recalculated(actor):
    store,run_id=restore_true_legacy(actor);result=store.owned('runs',actor.user['id'],run_id)['result']
    result['analysis']['metrics'].update(gross_margin=0,cash_ratio=None)
    with store.transaction() as db:db.execute('UPDATE runs SET result=? WHERE id=?',(encode(result),run_id))
    before=store.db.total_changes
    response=actor.get('/workspace/reports/compare',params={'left':run_id,'right':run_id})
    assert response.status_code==200 and response.json()['verification']['left']['whole_output_hash_verified'] is None
    rows={x['metric']:x for x in response.json()['changes']}
    assert rows['gross_margin']=={'metric':'gross_margin','before':0,'after':0,'delta':0}
    assert rows['cash_ratio']=={'metric':'cash_ratio','before':None,'after':None,'delta':None}
    assert store.db.total_changes==before and store.owned('runs',actor.user['id'],run_id)['result']==result
