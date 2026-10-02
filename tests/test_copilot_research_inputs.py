"""Actual assistant → approved saved mathematics flows; isolated inputs, no providers."""
import pytest
from conftest import Actor
from test_services import thread, message, proposal, confirm, identity, ok
from test_saved_experiments import save, reference as experiment_ref, long_dataset, modify_experiment
from test_saved_comparisons import inputs, saved, reference as comparison_ref, revise
from server.evolution import replay
from test_adaptive import ResearchProviders


def plan_for(actor, proposal_row):
    return ok(actor.get('/workspace/plans/'+proposal_row['payload']['plan_id']))


def execute_proposal(actor, p):
    confirmed=ok(confirm(actor,p))
    run=ok(actor.get('/runs/'+confirmed['payload']['result']['run_id']))
    return actor.execute(run)


def test_assistant_saved_scenario_and_comparison_share_exact_approved_chain(actor):
    ds=inputs(actor);e=save(actor,ds[0]);c=saved(actor,ds);t=thread(actor,ds[0])
    p=ok(proposal(actor,t,experiment=experiment_ref(e),comparison_artifact=comparison_ref(c)),201)
    assert actor.client.app.state.store.all('SELECT * FROM runs')==[]
    plan=plan_for(actor,p)['payload']
    assert plan['bindings']['experiment']==experiment_ref(e)
    assert plan['bindings']['comparison_artifact']==comparison_ref(c)
    assert p['payload']['preview']['selected_experiment']['hash']==e['experiment_hash']
    assert len(p['payload']['preview']['selected_comparison']['members'])==2
    duplicate=ok(proposal(actor,t,experiment=experiment_ref(e),comparison_artifact=comparison_ref(c)),201)
    assert duplicate['id']==p['id']
    assert len(actor.get('/workspace/plans').json()['items'])==1
    run=execute_proposal(actor,p);result=run['result'];outputs=result['adaptive']['mathematical_outputs']
    assert outputs['sensitivity']['result']==e['payload']['result']['result']
    assert outputs['comparison']['items']==c['payload']['result']['items']
    assert replay(run,['sensitivity','comparison'],None)['covered']==['comparison','sensitivity']
    loaded=ok(actor.get('/services/threads/'+t['id']))
    assert loaded['runs'][0]['result']==result
    assert loaded['runs'][0]['source_impact']['state']=='current'
    assert c['comparison_hash'] in actor.get('/runs/'+run['id']+'/export?format=md').text
    # Peer-only updates were invisible to the old chat result card.
    revise(actor,ds[1]);loaded=ok(actor.get('/services/threads/'+t['id']))
    chat_run=loaded['runs'][0]
    assert chat_run['current_dataset_version']==chat_run['dataset_version']
    assert chat_run['source_impact']['state']=='changed'
    assert any(x['code']=='comparison_member_changed' for x in chat_run['source_impact']['reasons'])
    assert chat_run['result']==result
    modify_experiment(actor,e,delete=True)
    assert any(x['code']=='experiment_removed' for x in ok(actor.get('/services/threads/'+t['id']))['runs'][0]['source_impact']['reasons'])
    assert ok(confirm(actor,p))['payload']['result']['run_id']==run['id']


def test_saved_forecast_does_not_gain_conflicting_defaults(actor):
    d=long_dataset(actor);e=save(actor,d,kind='forecast',metric='cash_flow',horizon=3);t=thread(actor,d)
    p=ok(proposal(actor,t,experiment=experiment_ref(e),execution={'depth':'deep'}),201)
    assert plan_for(actor,p)['payload']['request']['execution']['horizon']==3
    run=execute_proposal(actor,p)
    output=run['result']['adaptive']['mathematical_outputs']['forecast']
    assert output['forecast']==e['payload']['result']['forecast']
    assert output['experiment']['hash']==e['experiment_hash']


@pytest.mark.parametrize('change',['experiment_hash','comparison_hash','owner','identity','not_member','conflicting_forecast','period'])
def test_invalid_assistant_artifacts_create_no_plan_or_proposal(actor,change):
    ds=inputs(actor);e=save(actor,ds[0]);c=saved(actor,ds);t=thread(actor,ds[0]);who=actor
    kwargs={'experiment':experiment_ref(e),'comparison_artifact':comparison_ref(c)}
    if change=='experiment_hash':kwargs['experiment']['hash']='0'*64
    elif change=='comparison_hash':kwargs['comparison_artifact']['hash']='0'*64
    elif change=='owner':who=Actor(actor.client);t=thread(who,who.dataset())
    elif change=='identity':t=thread(actor,ds[0],identity(actor,ds[0]))
    elif change=='not_member':t=thread(actor,actor.dataset())
    elif change=='conflicting_forecast':
        e=save(actor,ds[0],kind='forecast',metric='cash_flow',horizon=3)
        kwargs['experiment']=experiment_ref(e);kwargs['execution']={'forecast':False}
    else:kwargs['text']=ds[0]['payload']['periods'][0]['period']+'毛利率核查'
    r=proposal(who,t,**kwargs)
    assert r.status_code in (403,404,409),r.text
    assert ok(who.get('/workspace/plans'))['items']==[]
    assert ok(who.get('/services/threads/'+t['id']))['proposals']==[]


@pytest.mark.parametrize('kind',['action','watch','memory'])
@pytest.mark.parametrize('field',['experiment','comparison_artifact'])
def test_nonresearch_references_fail_at_contract_boundary(actor,kind,field):
    t=thread(actor,actor.dataset())
    r=proposal(actor,t,kind,**{field:{'id':'unused','version':1,'hash':'a'*64}})
    assert r.status_code==422
    assert ok(actor.get('/services/threads/'+t['id']))['proposals']==[]


@pytest.mark.parametrize('change',['experiment_removed','peer_changed','comparison_removed'])
def test_sources_changed_after_assistant_preview_block_confirmation(actor,change):
    ds=inputs(actor);e=save(actor,ds[0]);c=saved(actor,ds);t=thread(actor,ds[0])
    p=ok(proposal(actor,t,experiment=experiment_ref(e),comparison_artifact=comparison_ref(c)),201)
    if change=='experiment_removed':modify_experiment(actor,e,delete=True)
    elif change=='peer_changed':revise(actor,ds[1])
    else:ok(actor.delete('/workspace/comparisons/'+c['id']+'?version=1'))
    r=confirm(actor,p)
    assert r.status_code==409 and r.json()['error']['code']=='PLAN_STALE'
    assert actor.client.app.state.store.all('SELECT * FROM runs')==[]
    assert ok(actor.get('/services/threads/'+t['id']))['proposals'][0]['payload']['status']=='draft'


def test_repeated_followups_and_sourced_handoff_preserve_normalized_scope(actor):
    d=actor.dataset();t=thread(actor,d);target=d['payload']['periods'][0]['period']
    first=ok(message(actor,t,text=target+'毛利率环比核查'),201)['message']
    last=first
    for version,text in enumerate(['继续展开刚才的原因','继续展开','继续展开','继续看现金流'],2):
        last=ok(message(actor,t,text=text,version=version,key='followup-'+str(version)),201)['message']
        response=last['payload']['response'];scope=response['context']['question_scope']
        assert scope['can_calculate'] and scope['period']==target and scope['comparison']=='previous'
        assert all(f['period']==target for f in response['facts'])
    assert 'cash_flow' in scope['topics'] and 'gross_margin' not in scope['topics']
    p=ok(proposal(actor,t,text='',source_message_id=last['id']),201)
    plan=plan_for(actor,p)['payload']
    assert plan['snapshot']['research_scope']['period']==target
    assert plan['request']['comparison']=='previous' and not plan['blockers']
    assert target in p['payload']['text'] and p['payload']['resolved_source_scope']['period']==target
    assert first['payload']['question'] not in plan['context']['question']
    assert not p['payload'].get('history_message_ids')
    assert execute_proposal(actor,p)['result']['analysis']['current_period']==target
    # Edited target is authoritative, even though the source receipt remains attached.
    edited=ok(proposal(actor,t,text='2025-Q3收入同比核查',source_message_id=last['id'],request_id='edited-goal'),201)
    assert plan_for(actor,edited)['payload']['snapshot']['research_scope']['period']=='2025-Q3'
    assert plan_for(actor,edited)['payload']['request']['comparison']=='year_over_year'


def test_inherited_period_cannot_be_silently_replaced_by_saved_comparison(actor):
    ds=inputs(actor);c=saved(actor,ds);t=thread(actor,ds[0]);target=ds[0]['payload']['periods'][0]['period']
    ok(message(actor,t,text=target+'毛利率核查'),201)
    m=ok(message(actor,t,text='继续展开原因',version=2,key='continue-again'),201)['message']
    r=proposal(actor,t,text='',source_message_id=m['id'],comparison_artifact=comparison_ref(c))
    assert r.status_code==409 and r.json()['error']['code']=='COMPARISON_PERIOD'
    assert ok(actor.get('/workspace/plans'))['items']==[]


@pytest.mark.parametrize('text,status,period,comparison',[
    ('继续看2025-Q3现金流同比','supported','2025-Q3','year_over_year'),
    ('继续看最新现金流','supported','2026-Q3','year_over_year'),
    ('继续看2025年度现金流','needs_clarification',None,None),
    ('继续看2024-Q1现金流','period_unavailable',None,None),
    ('继续比较2025-Q2和2025-Q3收入','needs_clarification',None,None),
    ('继续查看跟进行动','workspace_query',None,None),
    ('继续看市场占有率','unsupported_topic',None,None),
    ('不继续分析毛利了，查看现金流','needs_clarification',None,None),
    ('不要继续刚才的季度毛利核查','needs_clarification',None,None),
])
def test_explicit_new_scope_or_unrecognized_requests_are_never_repaired(actor,text,status,period,comparison):
    t=thread(actor,actor.dataset());ok(message(actor,t,text='2025-Q2毛利率环比核查'),201)
    m=ok(message(actor,t,text=text,version=2,key='different-scope'),201)['message']['payload']['response']
    s=m['context']['question_scope'];assert s['status']==status
    if period:assert (s['period'],s['comparison'])==(period,comparison)
    else:assert not m['facts']


def test_research_acceptance_contract_does_not_raise_internal_error(actor):
    r=proposal(actor,thread(actor,actor.dataset()),acceptance='验'*1001)
    assert r.status_code==422


def test_negated_continuation_cannot_become_an_approved_latest_quarter_plan(actor):
    t=thread(actor,actor.dataset());ok(message(actor,t,text='2025-Q2毛利率环比核查'),201)
    m=ok(message(actor,t,text='不继续分析毛利了，查看现金流',version=2,key='negate-followup'),201)['message']
    p=ok(proposal(actor,t,text='',source_message_id=m['id']),201)
    assert plan_for(actor,p)['payload']['blockers']
    assert confirm(actor,p).status_code==409
    assert actor.client.app.state.store.all('SELECT * FROM runs')==[]


@pytest.mark.parametrize('text,period,comparison',[
    ('那同比呢','2025-Q2','year_over_year'),('那环比呢','2025-Q2','previous'),
    ('那2025-Q3呢','2025-Q3','previous'),('继续看2025年第三季度同比','2025-Q3','year_over_year')])
def test_scope_only_followup_keeps_financial_topic(actor,text,period,comparison):
    t=thread(actor,actor.dataset());ok(message(actor,t,text='2025-Q2毛利率环比核查'),201)
    m=ok(message(actor,t,text=text,version=2,key='scope-only-followup'),201)['message']
    s=m['payload']['response']['context']['question_scope']
    assert (s['period'],s['comparison'],s['topics'])==(period,comparison,['gross_margin'])
    p=ok(proposal(actor,t,text='',source_message_id=m['id']),201)
    assert plan_for(actor,p)['payload']['snapshot']['research_scope']['period']==period


def test_assistant_explicit_external_consent_sends_only_verified_selected_outputs(factory):
    async def handler(provider,system,context,count):
        tools=context['approved_tool_results']
        assert tools['sensitivity']['experiment']['hash']==e['experiment_hash']
        assert tools['comparison']['comparison_provenance']['hash']==c['comparison_hash']
        assert len(tools['comparison']['items'])==2
        return {'output':{'claims':[], 'missing':['仅为受控替身验收，不是外部供应商回复']}}
    providers=ResearchProviders(handler=handler);actor=Actor(factory(providers))
    ds=inputs(actor);e=save(actor,ds[0]);c=saved(actor,ds);t=thread(actor,ds[0])
    p=ok(proposal(actor,t,experiment=experiment_ref(e),comparison_artifact=comparison_ref(c),
        use_llm=True,provider='alpha',max_calls=1),201)
    assert providers.calls==[]
    assert all(d['payload']['company'] in '\n'.join(p['payload']['preview']['scope']) for d in ds)
    assert confirm(actor,p).status_code==403
    assert providers.calls==[]
    confirmed=ok(confirm(actor,p,external_consent=True))
    run=actor.execute(ok(actor.get('/runs/'+confirmed['payload']['result']['run_id'])))
    assert len(providers.calls)==1 and run['result']
