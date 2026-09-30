"""Adverse service/assistant contracts. All provider traffic is an in-process double."""
from __future__ import annotations
import concurrent.futures
import copy
import json
import threading
from datetime import date
import pytest
from conftest import Actor, editable
from test_services import ok, identity, thread, message, proposal, confirm, connection, watch
from server import workspace_store as ws
from server.connections import scoped_providers
from server.copilot import evaluate_watches
from server.store import digest, encode


def test_thread_creation_idempotency_survives_chat_title_change(actor):
    d=actor.dataset();body={'dataset_id':d['id'],'request_id':'create-thread-0001'}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        replies=list(pool.map(lambda _:actor.post('/services/threads',json=body),range(3)))
    rows=[ok(r,201) for r in replies]
    assert len({r['id'] for r in rows})==1
    ok(message(actor,rows[0],text='现金流来源在哪里'),201)
    replay=ok(actor.post('/services/threads',json=body),201)
    assert replay['id']==rows[0]['id'] and replay['version']==2
    ok(actor.post('/services/threads',json={**body,'title':'不同初始标题'}),409)
    assert len(ok(actor.get('/services/threads?dataset_id='+d['id']))['items'])==1


def test_identity_and_chat_deletes_require_observed_revision(actor):
    d=actor.dataset();i=identity(actor,d);t=thread(actor,d,i)
    ok(actor.delete('/services/identities/'+i['id']),428)
    ok(actor.delete('/services/threads/'+t['id']),428)
    changed=ok(actor.put('/services/identities/'+i['id'],json={**i['payload'],'version':1,'objective':'新目标'}))
    ok(actor.delete('/services/identities/'+i['id']+'?version=1'),409)
    ok(message(actor,t),201)
    ok(actor.delete('/services/threads/'+t['id']+'?version=1'),409)
    assert len(ok(actor.get('/services/threads/'+t['id']))['messages'])==1
    ok(actor.delete('/services/identities/'+i['id']+'?version='+str(changed['version'])))
    archived=ok(actor.get('/services/threads/'+t['id']))
    assert not archived['context']['writable'] and archived['messages']
    assert archived['identity']['name']==i['payload']['name']
    ok(message(actor,t,key='blocked-new-message',version=2),404)
    ok(actor.delete('/services/threads/'+t['id']+'?version=2'))


def test_watch_alert_and_proposal_deletes_are_revision_bound(actor):
    d=actor.dataset();w=watch(actor,d)
    changed=ok(actor.put('/services/watches/'+w['id'],json={**w['payload'],'version':1,'threshold':0.98}))
    ok(actor.delete('/services/watches/'+w['id']+'?version=1'),409)
    status=evaluate_watches(actor.client.app.state.store,actor.user['id'],today=date(2026,10,1))
    aid=status['evaluations'][0]['alert_id']
    ok(actor.post('/services/alerts/'+aid+'/acknowledge',json={'version':1}))
    ok(actor.delete('/services/alerts/'+aid+'?version=1'),409)
    ok(actor.delete('/services/alerts/'+aid+'?version=2'))
    t=thread(actor,d);p=ok(proposal(actor,t,'memory'),201)
    discarded=ok(actor.delete('/services/proposals/'+p['id']+'?version=1'))
    assert discarded['payload']['status']=='discarded'
    ok(actor.delete('/services/proposals/'+p['id']+'?version=1'),409)
    ok(confirm(actor,p),409)
    ok(actor.delete('/services/watches/'+w['id']+'?version='+str(changed['version'])))


def test_tampered_proposal_payload_cannot_use_old_approval_fingerprint(actor):
    d=actor.dataset();t=thread(actor,d);p=ok(proposal(actor,t,'watch',threshold=0.2),201)
    bad=copy.deepcopy(p['payload']);bad['preview']['threshold']=0.99
    with actor.client.app.state.store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(bad),p['id']))
    assert ok(confirm(actor,p),409)['error']['code']=='PROPOSAL_CORRUPT'
    assert ok(actor.get('/services/tracking'))['rules']==[]


def test_private_connection_owner_is_mandatory_and_removal_is_versioned(actor):
    c=ok(connection(actor),201);service=actor.client.app.state.providers
    assert service.select(c['id']) is None
    assert scoped_providers(service,actor.user['id']).select(c['id']).id==c['id']
    other=Actor(actor.client)
    assert scoped_providers(service,other.user['id']).select(c['id']) is None
    with pytest.raises(TypeError):service.vault.select(c['id'])
    assert ok(actor.post('/services/connections/'+c['id']+'/remove',json={'password':actor.password,'version':9}),409)['error']['code']=='VERSION_CONFLICT'
    assert len(service.vault.catalog(actor.user['id']))==1
    ok(actor.post('/services/connections/'+c['id']+'/remove',json={'password':actor.password,'version':1}))
    assert service.vault.catalog(actor.user['id'])==[]


@pytest.mark.parametrize('operation',['create','update','remove','revoke'])
@pytest.mark.parametrize('mutation',['password','session'])
def test_revoked_auth_cannot_resume_sensitive_mutation(actor,monkeypatch,operation,mutation):
    import server.service_api as api
    c=ok(connection(actor),201) if operation in ('update','remove') else None
    store=actor.client.app.state.store
    checked=threading.Event();resume=threading.Event();real=api.password_matches
    def paused(password,stored):
        valid=real(password,stored);checked.set()
        assert resume.wait(5)
        return valid
    monkeypatch.setattr(api,'password_matches',paused)
    def run():
        if operation=='create':return connection(actor)
        if operation=='update':return actor.put('/services/connections/'+c['id'],json={
            'name':'must not change','base_url':'https://models.test.example/v1','model':'fixture-model',
            'password':actor.password,'version':1})
        if operation=='remove':return actor.post('/services/connections/'+c['id']+'/remove',json={'password':actor.password,'version':1})
        return actor.post('/services/sessions/revoke',json={'password':actor.password,'others':True})
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(run)
        assert checked.wait(5)
        with store.transaction() as db:
            if mutation=='password':
                db.execute("UPDATE users SET password_hash=password_hash || '-changed',version=version+1 WHERE id=?",(actor.user['id'],))
            else:
                db.execute('DELETE FROM auth_sessions WHERE user_id=? AND token_hash=?',(actor.user['id'],digest(actor.token)))
        resume.set();response=future.result(timeout=10)
    ok(response,401)
    rows=actor.client.app.state.providers.vault.catalog(actor.user['id'])
    assert len(rows)==(1 if c else 0)
    if c:assert rows[0]['version']==1 and rows[0]['name']==c['name']


def test_tracking_never_calls_open_or_future_quarters_clear(actor):
    d=actor.dataset();watch(actor,d);store=actor.client.app.state.store
    for today in (date(2026,1,1),date(2026,9,30)):
        result=evaluate_watches(store,actor.user['id'],today=today)
        assert result['evaluations'][0]['state']=='incomplete'
        assert 'alert_id' not in result['evaluations'][0]
    assert ws.objects(store,actor.user['id'],'alert')==[]
    assert evaluate_watches(store,actor.user['id'],today=date(2026,10,1))['evaluations'][0]['state']=='triggered'


def test_tracking_expiry_is_inclusive_utc_and_preview_preserves_it(actor):
    d=actor.dataset();t=thread(actor,d)
    p=ok(proposal(actor,t,'watch',threshold=0.99,expires_at='2026-10-01'),201)
    assert p['payload']['preview']['expires_at']=='2026-10-01'
    w=ok(confirm(actor,p))['payload']['result']['watch_id']
    store=actor.client.app.state.store
    first=evaluate_watches(store,actor.user['id'],today=date(2026,10,1))['evaluations'][0]
    assert first['state']=='triggered' and first['rule_id']==w
    expired=evaluate_watches(store,actor.user['id'],today=date(2026,10,2))['evaluations'][0]
    assert expired['state']=='expired' and 'alert_id' not in expired
    assert len(ws.objects(store,actor.user['id'],'alert'))==1


def test_grounded_answer_contains_actual_values_provenance_gaps_and_next_steps(actor):
    d=actor.dataset();t=thread(actor,d)
    r=ok(message(actor,t,text='为什么毛利现金流同比下降？请给出原始依据'),201)['message']['payload']['response']
    from server.analytics import calculate
    analysis=calculate(d['payload'])
    margin=next(f for f in r['facts'] if f['id']=='gross_margin')
    assert margin['value']==analysis['metrics']['gross_margin']
    assert margin['display_value'] in r['answer'] and margin['formula'] and margin['inputs']
    assert margin['comparison']['period']==analysis['baseline_period']
    assert margin['trend'] and margin['input_hash']==d['content_hash']
    assert r['research_brief']['intent']=='causal_review' and not r['research_brief']['causal_claims_supported']
    assert r['research_brief']['evidence_state']=='no_matching_saved_evidence'
    assert all(s['reason'] and s['acceptance'] for s in r['next_steps'])
    assert r['external_calls']==0


def test_missing_metrics_are_not_zero_and_explicit_previous_quarter_is_respected(actor):
    d=actor.dataset();body=editable(d);body['periods'][-1]['cash_flow']=None
    d=ok(actor.put('/datasets/'+d['id'],json=body));t=thread(actor,d)
    r=ok(message(actor,t,text='比较现金流与毛利环比'),201)['message']['payload']['response']
    assert r['research_brief']['scope']['comparison']=='previous'
    assert r['research_brief']['scope']['baseline_period']=='2026-Q2'
    cash=next(f for f in r['facts'] if f['id']=='cash_flow')
    assert cash['value'] is None and cash['status']=='missing'
    assert 'cash_flow' in r['research_brief']['missing_metric_ids']
    assert '保持空值' in r['answer']


def test_lens_defaults_and_actions_do_not_mix_with_other_identity(actor):
    d=actor.dataset();i=identity(actor,d,perspective='investor');j=identity(actor,d,perspective='auditor')
    ti=thread(actor,d,i);tj=thread(actor,d,j)
    p=ok(proposal(actor,ti,'action',acceptance='核对同期间财报并记录原始来源'),201);ok(confirm(actor,p))
    r=ok(message(actor,tj,text='需要做哪些跟进行动'),201)['message']['payload']['response']
    assert next(c for c in r['cards'] if c['kind']=='actions')['data']==[]
    assert r['facts']==[] and r['context']['question_scope']['status']=='workspace_query'
    overview=ok(message(actor,tj,text='经营概览',key='overview-after-actions',version=2),201)['message']['payload']['response']
    assert [f['id'] for f in overview['facts']]==['cash_ratio','leverage','gross_margin']
    ok(message(actor,tj,text='   ',key='whitespace-message',version=2),422)


def test_grounded_evidence_is_owner_company_review_scoped_and_keeps_uncertainty(actor):
    from test_workspace_api import evidence
    d=actor.dataset();t=thread(actor,d);company=d['payload']['company']
    accepted,_=evidence(actor,company,status='accepted',stance='supports',text='毛利率现金流变化需要核对同期间成本与收款凭证。'*12)
    rejected,_=evidence(actor,company,status='rejected',text='毛利率现金流变化的错误材料。'*12)
    expired,_=evidence(actor,company,status='accepted',expires='2000-01-01',text='毛利率现金流变化的过期资料。'*12)
    unrelated,_=evidence(actor,'另一企业',status='accepted',text='毛利率现金流变化的另一企业资料。'*12)
    other=Actor(actor.client);foreign,_=evidence(other,company,status='accepted',text='毛利率现金流变化的私有账户资料。'*12)
    r=ok(message(actor,t,text='为什么毛利率现金流变化，证据是什么？'),201)['message']['payload']['response']
    docs={c['document_id'] for c in r['citations']}
    assert docs=={accepted['id']}
    assert not docs.intersection({rejected['id'],expired['id'],unrelated['id'],foreign['id']})
    assert r['research_brief']['matched_document_count']==1
    assert r['research_brief']['stance_counts']['supports']==1
    assert r['research_brief']['evidence_state']=='retrieved_candidates'
    assert not r['research_brief']['causal_claims_supported']
    assert all(c['start']>=0 and len(c['content_hash'])==64 for c in r['citations'])


def test_historical_chat_survives_dataset_removal_without_reauthorizing_writes(actor):
    d=actor.dataset();t=thread(actor,d);ok(message(actor,t),201)
    ok(actor.delete('/datasets/'+d['id']+'?version=1'))
    read=ok(actor.get('/services/threads/'+t['id']))
    assert read['messages'] and read['context']['writable'] is False
    ok(message(actor,t,key='removed-dataset-message',version=2),409)
    ok(proposal(actor,t,'watch'),409)
