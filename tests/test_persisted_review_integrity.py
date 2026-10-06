"""Corrupt only isolated test databases; never repair or rewrite archived facts."""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from conftest import Actor
from server.store import digest, encode
from server.business_provenance import with_source_impact
from test_business_provenance import action, action_ref, ok, revise
from test_financial_import_workflow import commit
from test_report_source_integrity import CORRUPTIONS, corrupt, watch_request, execute_unanchored_legacy
from test_workspace_api import execute, plan


def test_changed_persisted_preview_cannot_write_with_the_original_displayed_fingerprint(actor):
    stage = ok(actor.post('/workspace/imports/file', data={'company':'合成预览完整性企业','amount_unit':'wan'},
        files={'file':('synthetic.csv', '季度,营业收入,营业成本\n2024-Q1,10,8'.encode())}), 201)
    store = actor.client.app.state.store
    altered = deepcopy(stage['payload']); altered['dataset']['periods'][0]['cost'] = 99999.0
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE user_id=? AND id=?',
            (encode(altered), actor.user['id'], stage['id']))
    before = store.db.total_changes
    response = commit(actor, stage)
    assert response.status_code == 409, response.text
    assert response.json()['error']['code'] == 'PREVIEW_INTEGRITY'
    assert ok(actor.get('/datasets'))['items'] == []
    assert store.all('SELECT * FROM dataset_revisions') == []
    assert store.all('SELECT * FROM dataset_import_receipts') == []
    assert store.db.total_changes == before


def make_stage(actor, target=None):
    fields={'company':target['payload']['company'] if target else '合成预览完整性企业','amount_unit':'wan'}
    if target:fields.update(target_id=target['id'],target_version=str(target['version']),merge_mode='merge')
    return ok(actor.post('/workspace/imports/file', data=fields,
        files={'file':('synthetic.csv','季度,营业收入,营业成本\n2024-Q1,10,8'.encode())}),201)


@pytest.mark.parametrize('targeted',[False,True])
@pytest.mark.parametrize('change',['basis','file_hash','quality','diff','created_at','status_shape','payload_shape'])
def test_every_persisted_preview_field_is_bound_before_new_or_revision_write(actor,targeted,change):
    target=actor.dataset() if targeted else None;stage=make_stage(actor,target);p=deepcopy(stage['payload'])
    if change=='basis':p['basis']='year_to_date'
    elif change=='file_hash':p['import_context']['source_file_sha256']='0'*64
    elif change=='quality':p['quality']['warning_count']=999
    elif change=='diff':p['diff']=[{'path':'unapproved','before':1,'after':2}]
    elif change=='created_at':p['created_at']='invalid-date'
    elif change=='status_shape':p['status']=[]
    else:p=None
    store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(p),stage['id']))
    before={t:store.all('SELECT * FROM '+t) for t in ('datasets','dataset_revisions','dataset_import_receipts','audit')};changes=store.db.total_changes
    result=commit(actor,stage);assert result.status_code==409 and result.json()['error']['code']=='PREVIEW_INTEGRITY'
    assert {t:store.all('SELECT * FROM '+t) for t in before}==before and store.db.total_changes==changes


@pytest.mark.parametrize('change',['fake_committed','redirect','receipt_hash','receipt_rehashed_source','receipt_missing','rolled_back_stage'])
def test_completion_metadata_cannot_forge_success_or_duplicate_a_completed_import(actor,change):
    stage=make_stage(actor);store=actor.client.app.state.store
    if change=='fake_committed':
        other=actor.dataset();p={**stage['payload'],'status':'committed','committed_id':other['id']}
    else:
        saved=ok(commit(actor,stage),201)
        assert ok(commit(actor,stage),201)['id']==saved['id']
        row=store.one('SELECT * FROM workspace_objects WHERE id=?',(stage['id'],));p=row['payload']
        if change=='redirect':p={**p,'committed_id':actor.dataset()['id']}
        elif change=='rolled_back_stage':p=deepcopy(stage['payload'])
        else:
            receipt=store.one('SELECT * FROM dataset_import_receipts WHERE dataset_id=?',(saved['id'],))
            with store.transaction() as db:
                if change=='receipt_missing':db.execute('DELETE FROM dataset_import_receipts WHERE dataset_id=?',(saved['id'],))
                elif change=='receipt_hash':db.execute('UPDATE dataset_import_receipts SET content_hash=? WHERE dataset_id=?',('0'*64,saved['id']))
                else:
                    altered=deepcopy(receipt['payload']);altered['import_context']['source_file_sha256']='0'*64
                    db.execute('UPDATE dataset_import_receipts SET payload=?,content_hash=? WHERE dataset_id=?',(encode(altered),digest(altered),saved['id']))
    with store.transaction() as db:db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(p),stage['id']))
    before={t:store.all('SELECT * FROM '+t) for t in ('datasets','dataset_revisions','dataset_import_receipts','audit')};changes=store.db.total_changes
    result=commit(actor,stage);assert result.status_code==409 and result.json()['error']['code']=='PREVIEW_INTEGRITY'
    assert {t:store.all('SELECT * FROM '+t) for t in before}==before and store.db.total_changes==changes


def test_verified_duplicate_import_and_fresh_preview_recovery_preserve_owner_version_contract(actor):
    stage=make_stage(actor);saved=ok(commit(actor,stage),201);revised=revise(actor,saved)
    before=actor.client.app.state.store.db.total_changes
    assert ok(commit(actor,stage),201)==revised
    assert actor.client.app.state.store.db.total_changes==before
    assert commit(Actor(actor.client),stage).status_code==404
    fresh=make_stage(actor,revised);wrong=actor.post('/workspace/imports/'+fresh['id']+'/commit',json={'version':fresh['version'],'fingerprint':'0'*64})
    assert wrong.status_code==409 and wrong.json()['error']['code']=='PREVIEW_MISMATCH'
    wrong=actor.post('/workspace/imports/'+fresh['id']+'/commit',json={'version':fresh['version']+1,'fingerprint':fresh['payload']['fingerprint']})
    assert wrong.status_code==409 and wrong.json()['error']['code']=='VERSION_CONFLICT'
    assert ok(commit(actor,fresh),201)['version']==revised['version']+1


def test_comparison_rejects_a_report_that_its_audit_already_marks_corrupt(actor):
    dataset = actor.dataset()
    left = execute(actor, plan(actor, dataset)); right = execute(actor, plan(actor, dataset))
    store = actor.client.app.state.store
    corrupt(store, right, 'result')
    assert not ok(actor.get('/workspace/runs/'+right['id']+'/audit'))['report_integrity']['valid']
    before = store.db.total_changes
    response = actor.get('/workspace/reports/compare', params={'left':left['id'],'right':right['id']})
    assert response.status_code == 409, response.text
    assert response.json()['error']['code'] == 'REPORT_INTEGRITY'
    assert 'changes' not in response.json()
    assert store.db.total_changes == before


@pytest.mark.parametrize('side',['left','right'])
@pytest.mark.parametrize('change',CORRUPTIONS)
def test_no_corrupt_comparison_operand_can_publish_deltas(actor,side,change):
    dataset=actor.dataset();left=execute(actor,plan(actor,dataset));right=execute(actor,plan(actor,dataset))
    store=actor.client.app.state.store;bad=left if side=='left' else right;corrupt(store,bad,change)
    assert not ok(actor.get('/workspace/runs/'+bad['id']+'/audit'))['report_integrity']['valid']
    before=store.db.total_changes
    r=actor.get('/workspace/reports/compare',params={'left':left['id'],'right':right['id']})
    assert r.status_code==409 and r.json()['error']['code']=='REPORT_INTEGRITY',r.text
    assert ('基准报告' if side=='left' else '对照报告') in r.json()['error']['message']
    assert 'changes' not in r.json() and store.db.total_changes==before


@pytest.mark.parametrize('workflow',['studio','adaptive','legacy','legacy_unanchored'])
def test_intact_historical_reports_compare_even_after_live_inputs_change(actor,monkeypatch,workflow):
    dataset=actor.dataset()
    def build():
        if workflow=='legacy_unanchored':return execute_unanchored_legacy(actor,dataset,monkeypatch)
        if workflow=='legacy':return actor.execute(ok(actor.run(dataset),202))
        return execute(actor,plan(actor,dataset,**({'execution':{}} if workflow=='adaptive' else {})))
    left,right=build(),build();expected=ok(actor.get('/workspace/reports/compare',params={'left':left['id'],'right':right['id']}))
    assert expected['verification']['left']['whole_output_hash_verified'] is (None if workflow=='legacy_unanchored' else True)
    if workflow=='legacy_unanchored':assert '未保存完整输出的独立散列' in expected['warning']
    revise(actor,dataset);store=actor.client.app.state.store;before=store.db.total_changes
    assert ok(actor.get('/workspace/reports/compare',params={'left':left['id'],'right':right['id']}))==expected
    assert store.db.total_changes==before
    assert Actor(actor.client).get('/workspace/reports/compare',params={'left':left['id'],'right':right['id']}).status_code==404


def test_same_version_changed_memory_stales_sources_without_rewriting_frozen_reports(actor):
    dataset = actor.dataset()
    memory = ok(actor.post('/memories', json={'text':'核对批准的毛利率与现金流口径','company':dataset['payload']['company'],'approved':True}), 201)
    report = execute(actor, plan(actor, dataset))
    assert report['snapshot']['memory'][0]['payload_hash'] == digest(memory['payload'])
    source = {'kind':'report','run_id':report['id']}
    saved_action = ok(action(actor, dataset, source_ref=source), 201)
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE memories SET payload=? WHERE user_id=? AND id=?',
            (encode({**memory['payload'],'text':'未经原批准记录的不同研究目标'}), actor.user['id'], memory['id']))
    assert store.owned('memories', actor.user['id'], memory['id'])['version'] == memory['version']
    before = store.db.total_changes
    audit = ok(actor.get('/workspace/runs/'+report['id']+'/audit'))
    assert audit['report_integrity']['valid']
    assert audit['source_impact']['state'] == 'changed'
    assert 'memory_changed' in {x['code'] for x in audit['source_impact']['reasons']}
    current = next(x for x in ok(actor.get('/workspace/actions'))['items'] if x['id']==saved_action['id'])
    assert current['payload'] == saved_action['payload'] and current['source_impact']['state'] == 'changed'
    assert action(actor, dataset, source_ref=source).status_code == 409
    assert watch_request(actor, dataset, source).status_code == 409
    assert store.owned('runs', actor.user['id'], report['id']) == report
    assert store.db.total_changes == before


@pytest.mark.parametrize('field,value',[('company','不同企业'),('role','investor'),('text','不同研究目的'),('kind','preference'),('expires_at',42),('expires_at',86400),('whole_payload',None)])
def test_changed_or_malformed_live_memory_requires_review_but_healthy_archive_stays_frozen(actor,field,value):
    dataset=actor.dataset();m=ok(actor.post('/memories',json={'text':'仅临时测试的批准偏好','approved':True}),201)
    report=execute(actor,plan(actor,dataset));store=actor.client.app.state.store
    changed=None if field=='whole_payload' else {**m['payload'],field:value}
    with store.transaction() as db:db.execute('UPDATE memories SET payload=? WHERE id=?',(encode(changed),m['id']))
    source={'kind':'report','run_id':report['id']};a=ok(actor.get('/workspace/runs/'+report['id']+'/audit'))
    assert a['report_integrity']['valid'] and a['source_impact']['state']=='changed'
    assert action(actor,dataset,source_ref=source).status_code==409
    accepted=ok(action(actor,dataset,source_ref={**source,'allow_historical':True}),201)
    assert accepted['source_impact']['state']=='changed'
    assert store.owned('runs',actor.user['id'],report['id'])==report


def test_true_pre_fix_legacy_memory_is_unknown_and_requires_explicit_historical_use(actor):
    # This fixture was generated by actual 19fc API/worker code before the hash
    # change. Only synthetic owner IDs are remapped; immutable values, events,
    # hashes and their anchors are restored unchanged. This is not a migration claim.
    fixture=json.loads((Path(__file__).parent/'fixtures/legacy-memory-report-19fce3fb.json').read_text())
    store=actor.client.app.state.store
    expected_tables=['datasets','memories','conversations','runs','run_events','event_integrity','agent_artifacts']
    assert set(fixture['tables'])==set(expected_tables)
    with store.transaction() as db:
        for table in expected_tables:
            for raw in fixture['tables'][table]:
                row={**raw}
                if 'user_id' in row:row['user_id']=actor.user['id']
                columns=list(row);db.execute('INSERT INTO '+table+'('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',[row[k] for k in columns])
    run=store.owned('runs',actor.user['id'],fixture['run_id']);dataset=store.owned('datasets',actor.user['id'],run['dataset_id'])
    assert run['snapshot']['memory'] and 'payload_hash' not in run['snapshot']['memory'][0]
    before=store.db.total_changes;audit=ok(actor.get('/workspace/runs/'+run['id']+'/audit'))
    assert audit['report_integrity']['valid'] and audit['source_impact']['state']=='unknown'
    assert 'memory_baseline_unknown' in {r['code'] for r in audit['source_impact']['reasons']}
    source={'kind':'report','run_id':run['id']}
    assert action(actor,dataset,source_ref=source).status_code==409 and store.db.total_changes==before
    parent=ok(action(actor,dataset,source_ref={**source,'allow_historical':True}),201)
    assert parent['source_impact']['state']=='unknown'
    assert watch_request(actor,dataset,action_ref(parent)).status_code==409
    rule=ok(watch_request(actor,dataset,{**action_ref(parent),'allow_historical':True}),201)
    assert rule['source_impact']['state']=='unknown'
    assert store.owned('runs',actor.user['id'],run['id'])==run
    revise(actor,dataset)
    changed=ok(actor.get('/workspace/runs/'+run['id']+'/audit'))['source_impact']
    assert changed['state']=='changed'
    assert {'memory_baseline_unknown','dataset_changed'}<={r['code'] for r in changed['reasons']}
    listed=next(x for x in ok(actor.get('/workspace/actions'))['items'] if x['id']==parent['id'])
    assert listed['source_impact']['state']=='changed'
    assert with_source_impact(store,actor.user['id'],rule)['source_impact']['state']=='changed'
    assert store.owned('runs',actor.user['id'],run['id'])==run


def test_actual_pre_fix_committed_import_receipt_remains_idempotent(actor):
    fixture=json.loads((Path(__file__).parent/'fixtures/legacy-import-commit-19fce3fb.json').read_text())
    store=actor.client.app.state.store
    with store.transaction() as db:
        for table in ['datasets','workspace_objects','dataset_import_receipts']:
            for raw in fixture['tables'][table]:
                row={**raw,'user_id':actor.user['id']};columns=list(row)
                db.execute('INSERT INTO '+table+'('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',[row[k] for k in columns])
    before=store.db.total_changes
    response=actor.post('/workspace/imports/'+fixture['stage_id']+'/commit',json=fixture['approved_body'])
    saved=ok(response,201)
    assert saved['id']==fixture['tables']['datasets'][0]['id'] and saved['version']==1
    assert store.db.total_changes==before
    revised=revise(actor,saved);before=store.db.total_changes
    assert ok(actor.post('/workspace/imports/'+fixture['stage_id']+'/commit',json=fixture['approved_body']),201)==revised
    assert store.db.total_changes==before
