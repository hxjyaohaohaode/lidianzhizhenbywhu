"""Peer input changes propagate without rewriting the primary company's history."""
from copy import deepcopy
import pytest
from conftest import editable
from test_adaptive import preview, dispatch


def ok(response, code=200):
    assert response.status_code == code, response.text
    return response.json()


def comparison_case(actor):
    primary=actor.dataset()
    body=editable(primary);body.pop('version',None)
    body['company']='独立合成对照企业';body['name']='对照样本'
    peer=ok(actor.post('/datasets',json=body),201)
    saved=ok(actor.post('/workspace/comparisons',json={
        'name':'来源生命周期对照','identity_id':'','comparison':'year_over_year',
        'datasets':[{'id':d['id'],'version':d['version'],'hash':d['content_hash']} for d in (primary,peer)],
        'comparability_note':'仅验证共同季度与明确来源，不把合成样本当作行业排名'}),201)
    ref={'id':saved['id'],'version':saved['version'],'hash':saved['comparison_hash']}
    plan=preview(actor,primary,query='核查'+saved['payload']['period']+'对照的毛利率和财务口径',comparison_artifact=ref)
    run=actor.execute(dispatch(actor,plan))
    assert run['result'],run
    action=ok(actor.post('/workspace/actions',json={
        'dataset_id':primary['id'],'title':'核对企业对照口径',
        'acceptance':'核对两个企业共同季度的真实来源、业务口径与差异',
        'source_ref':{'kind':'report','run_id':run['id']}}),201)
    return primary,peer,saved,run,action


@pytest.mark.parametrize('change',['peer_revision','peer_removed','artifact_removed'])
def test_peer_change_propagates_to_report_and_action_without_mutating_history(actor,change):
    primary,peer,saved,run,action=comparison_case(actor)
    frozen=deepcopy(run['result']);snapshot=deepcopy(run['snapshot'])
    if change=='peer_revision':
        body=editable(peer);body['periods'][-1]['revenue']+=17
        ok(actor.put('/datasets/'+peer['id'],json=body))
    elif change=='peer_removed':
        ok(actor.delete('/datasets/'+peer['id']+'?version='+str(peer['version'])))
    else:
        ok(actor.delete('/workspace/comparisons/'+saved['id'],params={'identity_id':'','version':saved['version']}))
    after=ok(actor.get('/runs/'+run['id']))
    assert after['result']==frozen and after['snapshot']==snapshot
    report=ok(actor.get('/workspace/runs/'+run['id']+'/audit'))
    assert report['report_hash_valid'] and report['snapshot_hash_valid']
    rows=ok(actor.get('/workspace/actions'))['items'];after_action=next(r for r in rows if r['id']==action['id'])
    assert after_action['payload']==action['payload'] and after_action['version']==action['version']
    assert any(r['code'].startswith('comparison_') for r in after_action['source_impact']['reasons'])
    assert after_action['source_impact']['state']==('changed' if change=='peer_revision' else 'unavailable')
    # The primary input is unchanged, but its report's peer basis is no longer current.
    assert ok(actor.get('/datasets/'+primary['id']))['version']==primary['version']
    body={'dataset_id':primary['id'],'title':'再次核对旧对照报告',
        'acceptance':'在明确历史来源的前提下核对变化，不把旧比较当作当前结果',
        'source_ref':{'kind':'report','run_id':run['id']}}
    assert actor.post('/workspace/actions',json=body).status_code==409
    body['source_ref']['allow_historical']=True
    historical=ok(actor.post('/workspace/actions',json=body),201)
    assert historical['payload']['provenance']['dataset_version']==primary['version']


def test_action_watch_keep_bounded_comparison_receipt_after_source_report_removed(actor):
    from test_services import watch
    from server.store import digest
    primary,peer,saved,run,action=comparison_case(actor)
    receipt=action['payload']['provenance']['comparison_reference']
    assert receipt['hash']==saved['comparison_hash']
    assert receipt['projection_hash']==digest(receipt['payload'])
    assert all('snapshot' not in m for m in receipt['payload']['members'])
    assert len(receipt['payload']['result']['items'])==2
    row=watch(actor,primary,source_ref={'kind':'action','action_id':action['id'],
        'action_version':action['version'],'action_hash':action['object_hash']})
    assert row['payload']['provenance']['comparison_reference']==receipt
    sessions=ok(actor.get('/conversations'))['items']
    session=next(s for s in sessions if s['id']==run['session_id'])
    ok(actor.delete('/conversations/'+session['id']+'?version='+str(session['version'])))
    assert actor.get('/runs/'+run['id']).status_code==404
    ok(actor.delete('/datasets/'+peer['id']+'?version='+str(peer['version'])))
    after_action=next(a for a in ok(actor.get('/workspace/actions'))['items'] if a['id']==action['id'])
    after_watch=next(w for w in ok(actor.get('/services/tracking?identity_id='))['rules'] if w['id']==row['id'])
    for after in (after_action,after_watch):
        assert after['payload']['provenance']['comparison_reference']==receipt
        assert after['source_impact']['state']=='unavailable'
        codes={r['code'] for r in after['source_impact']['reasons']}
        assert {'report_removed','comparison_member_removed'}<=codes
