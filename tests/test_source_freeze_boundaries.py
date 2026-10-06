"""New artifacts reject corrupt inputs; genuine old approvals grant no new send."""
import copy
import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from conftest import Actor, editable
from source_binding_cases import Providers, ok
from server.store import encode
from server.studio import check_bindings, plan_fingerprint_valid


@pytest.mark.parametrize('kind',['plan','legacy_local','experiment','comparison'])
def test_known_bad_dataset_never_creates_a_new_frozen_business_record(actor,kind):
    d=actor.dataset();store=actor.client.app.state.store;peer=None
    if kind=='comparison':
        p=editable(d);p.pop('version');p['company']='另一隔离企业';peer=ok(actor.post('/datasets',json=p),201)
    target=peer or d;p=copy.deepcopy(target['payload']);p['periods'][-1]['cost']+=1
    session=actor.conversation(company=d['payload']['company']) if kind=='legacy_local' else None
    with store.transaction() as db:db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(p),target['id']))
    before=store.db.total_changes
    if kind=='plan':response=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'核对毛利率'})
    elif kind=='legacy_local':response=actor.post('/runs',json={'dataset_id':d['id'],'session_id':session['id'],'query':'核对毛利率'},headers={'Idempotency-Key':'bad-dataset-local'})
    elif kind=='experiment':response=actor.post('/workspace/experiments',json={'dataset_id':d['id'],'dataset_version':d['version'],'dataset_hash':d['content_hash'],'kind':'scenario','name':'隔离数学实验','price_change':.1,'cost_change':.03,'volume_change':-.05,'fixed_cost_share':.4,'assumptions':'明确合成假设'})
    else:response=actor.post('/workspace/comparisons',json={'name':'两企业对照','comparability_note':'隔离测试统一口径','datasets':[{'id':x['id'],'version':x['version'],'hash':x['content_hash']} for x in (d,peer)]})
    assert response.status_code==409 and response.json()['error']['code']=='SOURCE_INTEGRITY',response.text
    assert store.db.total_changes==before


def restore_old_queued_plan(actor):
    fixture=json.loads((Path(__file__).parent/'fixtures/legacy-approved-plan-80ce00c8.json').read_text())
    store=actor.client.app.state.store
    order=['datasets','dataset_revisions','evidence','memories','workspace_objects','conversations','runs','messages','run_events','event_integrity']
    with store.transaction() as db:
        for table in order:
            for raw in fixture['tables'][table]:
                row=dict(raw)
                if 'user_id' in row:row['user_id']=actor.user['id']
                if table=='dataset_revisions':
                    generated=dict(db.execute('SELECT * FROM dataset_revisions WHERE dataset_id=? AND version=?',(row['dataset_id'],row['version'])).fetchone())
                    assert generated==row
                    continue
                columns=list(row)
                db.execute('INSERT INTO '+table+'('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',[row[k] for k in columns])
        for row in fixture['tables']['evidence']:
            store.index_evidence(db,row['id'],actor.user['id'],json.loads(row['payload'])['text'])
    return store,fixture


def test_actual_80ce_approval_remains_frozen_and_needs_new_evidence_consent(factory):
    provider=Providers();provider.provider=SimpleNamespace(id='legacy-stub',model='local-only',host='synthetic.invalid',path='/never-networked')
    provider.select=lambda id='':provider.provider if id in ('','legacy-stub') else None
    actor=Actor(factory(providers=provider));store,fixture=restore_old_queued_plan(actor)
    original=store.owned('runs',actor.user['id'],fixture['run_id']);plan=fixture['original_draft']
    assert plan_fingerprint_valid(plan['payload'])
    assert 'review_hash' not in plan['payload']['snapshot']['citations'][0]
    before=store.db.total_changes
    with pytest.raises(HTTPException) as error:check_bindings(store,actor.user,plan,provider)
    assert error.value.status_code==409 and error.value.detail['code']=='PLAN_STALE'
    assert store.db.total_changes==before
    archived=actor.execute(original)
    assert provider.calls==[] and archived['snapshot']==original['snapshot']
    assert archived['result'] and all(c['dispatched'] is False for c in archived['result']['llm']['calls'])
    assert ok(actor.get('/workspace/runs/'+original['id']+'/audit'))['report_integrity']['valid']
    frozen_result=copy.deepcopy(archived['result'])
    fresh=ok(actor.post('/workspace/plans',json={'dataset_id':original['dataset_id'],'session_id':original['session_id'],
        'query':'重新核对毛利率现金流','use_llm':True,'provider':'legacy-stub','max_calls':2}),201)
    assert fresh['payload']['snapshot']['citations'][0]['review_hash']
    run=ok(actor.post('/workspace/plans/'+fresh['id']+'/execute',json={'version':fresh['version'],'fingerprint':fresh['payload']['fingerprint'],'external_consent':True}),202)
    actor.execute(run);assert len(provider.calls)==2
    assert ok(actor.get('/runs/'+original['id']))['result']==frozen_result


@pytest.mark.parametrize('change',['start_text','start_negative','excerpt','oversized'])
def test_bad_index_candidates_are_readable_integrity_errors_not_new_plan_inputs(actor,change):
    d=actor.dataset();doc=ok(actor.post('/evidence',json={'title':'字符区间合成原文','text':'😀毛利率现金流。'*300,'company':d['payload']['company']}),201)
    store=actor.client.app.state.store
    chunk=store.one('SELECT * FROM evidence_chunks WHERE document_id=? ORDER BY start LIMIT 1',(doc['id'],))
    with store.transaction() as db:
        if change.startswith('start_'):db.execute('UPDATE evidence_chunks SET start=? WHERE id=?',('bad' if change=='start_text' else -1,chunk['id']))
        else:db.execute('UPDATE evidence_chunks SET excerpt=? WHERE id=?',('毛利率不属于原文' if change=='excerpt' else doc['payload']['text'][:1101],chunk['id']))
    before=store.db.total_changes
    response=actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'核查毛利率现金流'})
    assert response.status_code==409 and response.json()['error']['code']=='SOURCE_INTEGRITY',response.text
    assert store.db.total_changes==before


def test_unicode_excerpt_uses_character_offsets_and_original_text_digest(actor):
    d=actor.dataset();doc=ok(actor.post('/evidence',json={'title':'字符区间合成原文','text':'😀毛利率现金流。'*300,'company':d['payload']['company']}),201)
    plan=ok(actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'核查毛利率现金流'}),201)
    citations=plan['payload']['snapshot']['citations'];assert citations
    assert all(c['excerpt']==doc['payload']['text'][c['start']:c['end']] for c in citations)
