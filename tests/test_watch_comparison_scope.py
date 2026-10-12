"""Synthetic, local API regression for explicit growth comparison handoff."""
import copy
from datetime import date
import pytest
from conftest import Actor, dataset_ref
from in_process_oracle import offline_test_client
from server.app import make_app
from server.config import Settings
from test_services import ok, thread, message, proposal, confirm, watch
from server import workspace_store as ws
from server.copilot import evaluate_watches
from server.models import calculate
from server.store import encode, digest

TODAY=date(2026,10,1)


@pytest.fixture
def actor(tmp_path):
    # Only the empty ASGI host initializes its Windows wake-up socketpair before
    # the guard. App construction, lifespan, requests and teardown stay offline;
    # no loopback/application address is allowlisted and caught attempts fail.
    def build_app(providers):
        return make_app(Settings(data_dir=tmp_path, origin='http://testserver'),
                        providers=providers, worker_enabled=False)
    with offline_test_client(build_app) as (client, _providers, _attempts):
        yield Actor(client)



def source(actor):
    d=actor.dataset();t=thread(actor,d)
    m=ok(message(actor,t,text='2025-Q4营业收入环比增长率'),201)['message']
    return d,t,m


def growth_proposal(actor,t,m,**patch):
    return proposal(actor,t,kind='watch',text='',source_message_id=m['id'],
        metric='revenue_growth',operator='lt',threshold=.1,**patch)


def evaluate(actor):
    return evaluate_watches(actor.client.app.state.store,actor.user['id'],today=TODAY)


def direct(actor,d,**patch):
    return actor.post('/services/watches',json={'source_ref':dataset_ref(d),'title':'增长规则',
        'dataset_id':d['id'],'metric':'revenue_growth','operator':'lt','threshold':.1,
        'stale_after_days':1460,**patch})


def update(actor,w,**patch):
    p=w['payload'];fields=('title','identity_id','dataset_id','metric','operator','threshold','active','stale_after_days','expires_at')
    return actor.put('/services/watches/'+w['id'],json={**{k:p[k] for k in fields},'version':w['version'],**patch})


def replace_payload(actor,row,p):
    with actor.client.app.state.store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',(encode(p),row['id']))


def assert_no_alerts(actor):
    store=actor.client.app.state.store
    assert not ws.objects(store,actor.user['id'],'alert')
    assert not store.all('SELECT * FROM tracking_receipts')


def test_qoq_source_preview_confirmation_and_latest_quarter_use_approved_basis(actor):
    d,t,m=source(actor);p=ok(growth_proposal(actor,t,m),201);preview=p['payload']['preview']
    assert preview['comparison']=='previous'
    assert preview['source_scope']=={'schema_version':1,'comparison':'previous','period_policy':'latest_saved_quarter',
        'source_kind':'copilot','source_period':'2025-Q4','question_scope_hash':digest(m['payload']['response']['context']['question_scope'])}
    assert not ws.objects(actor.client.app.state.store,actor.user['id'],'watch')
    result=ok(confirm(actor,p));entry=evaluate(actor)['evaluations'][0]
    assert entry['comparison']=='previous' and entry['period']=='2026-Q3' and entry['baseline_period']=='2026-Q2'
    assert entry['value']==calculate(d['payload'],'previous',today=TODAY)['metrics']['revenue_growth']
    assert entry['value']!=calculate(d['payload'],'year_over_year',today=TODAY)['metrics']['revenue_growth']
    assert entry['state']=='triggered'  # .05699 < .1; wrong .21428 would silently clear.
    assert ok(confirm(actor,p))['id']==result['id']
    assert evaluate(actor)['evaluations'][0]['alert_id']==entry['alert_id']
    assert len(ws.objects(actor.client.app.state.store,actor.user['id'],'alert'))==1


@pytest.mark.parametrize('comparison',['previous','year_over_year'])
def test_dataset_requires_explicit_basis_and_formula_unchanged(actor,comparison):
    d=actor.dataset();before=actor.client.app.state.store.db.total_changes
    ok(direct(actor,d),422)
    assert actor.client.app.state.store.db.total_changes==before
    w=ok(direct(actor,d,comparison=comparison),201);entry=evaluate(actor)['evaluations'][0]
    assert w['payload']['source_scope']['source_kind']=='dataset'
    assert entry['value']==calculate(d['payload'],comparison,today=TODAY)['metrics']['revenue_growth']
    assert entry['state']==('triggered' if comparison=='previous' else 'clear')


@pytest.mark.parametrize('comparison',['quarterly',{},True])
def test_invalid_typed_basis_rejected_without_writes(actor,comparison):
    d=actor.dataset();before=actor.client.app.state.store.db.total_changes
    ok(direct(actor,d,comparison=comparison),422)
    assert actor.client.app.state.store.db.total_changes==before


def test_direct_copilot_binds_original_and_cannot_override_or_fall_back(actor):
    d,t,m=source(actor);ref={'kind':'copilot','thread_id':t['id'],'message_id':m['id']}
    ok(direct(actor,d,source_ref=ref,comparison='year_over_year'),422)
    w=ok(direct(actor,d,source_ref=ref),201)
    assert w['payload']['comparison']=='previous'
    ok(growth_proposal(actor,t,m,comparison='year_over_year'),422)
    ok(direct(actor,d,source_ref={'kind':'copilot','thread_id':t['id'],
        'dataset_version':d['version'],'dataset_hash':d['content_hash']},comparison='previous'),422)
    assert len(ws.objects(actor.client.app.state.store,actor.user['id'],'watch'))==1


@pytest.mark.parametrize('bad_scope',[None,{}, {'status':'supported','can_calculate':True,'comparison':'previous','period':'2025-Q4','topics':['revenue']},
    {'status':'unsupported','can_calculate':False,'comparison':'previous','period':'2025-Q4','topics':['revenue_growth']}])
def test_malformed_or_unsupported_copilot_scope_never_becomes_dataset_source(actor,bad_scope):
    d,t,m=source(actor);payload=copy.deepcopy(m['payload']);payload['response']['context']['question_scope']=bad_scope
    store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE copilot_messages SET payload=? WHERE id=?',(encode(payload),m['id']))
    before=store.db.total_changes
    ok(direct(actor,d,source_ref={'kind':'copilot','thread_id':t['id'],'message_id':m['id']},comparison='previous'),422)
    ok(growth_proposal(actor,t,m,comparison='previous'),422)
    assert store.db.total_changes==before


def test_legacy_draft_cannot_be_confirmed_or_resealed(actor):
    d,t,m=source(actor);p=ok(growth_proposal(actor,t,m),201);payload=copy.deepcopy(p['payload'])
    payload['preview'].pop('comparison');payload['preview'].pop('source_scope');payload.pop('fingerprint');payload['fingerprint']=digest(payload)
    replace_payload(actor,p,payload);p['payload']=payload;before=actor.client.app.state.store.db.total_changes
    assert ok(confirm(actor,p),409)['error']['code']=='WATCH_SCOPE_REQUIRED'
    assert actor.client.app.state.store.db.total_changes==before
    assert not ws.objects(actor.client.app.state.store,actor.user['id'],'watch')


def test_unknown_legacy_rule_preserves_history_no_new_receipt_and_can_pause(actor):
    d=actor.dataset();w=ok(direct(actor,d,comparison='previous'),201);evaluate(actor);store=actor.client.app.state.store
    history=store.all("SELECT * FROM workspace_objects WHERE kind='alert'")
    receipts=store.all('SELECT * FROM tracking_receipts');p=copy.deepcopy(w['payload']);p.pop('comparison');p.pop('source_scope');replace_payload(actor,w,p);w['payload']=p
    before=store.db.total_changes;entry=evaluate(actor)['evaluations'][0]
    assert entry['state']=='unknown' and 'value' not in entry
    assert store.db.total_changes==before
    assert store.all("SELECT * FROM workspace_objects WHERE kind='alert'")==history
    assert store.all('SELECT * FROM tracking_receipts')==receipts
    ok(update(actor,w,comparison='previous'),409)
    ok(update(actor,w,metric='gross_margin'),409)
    paused=ok(update(actor,w,active=False))
    assert paused['payload'].get('source_scope') is None and paused['payload'].get('comparison') is None
    assert paused['payload']['evaluation_revision']==1
    assert not evaluate(actor)['evaluations']


@pytest.mark.parametrize('mutation',['missing_policy','wrong_basis','missing_scope','message_changed','message_removed'])
def test_invalid_saved_scope_or_changed_original_blocks_only_growth(actor,mutation):
    d,t,m=source(actor);p=ok(growth_proposal(actor,t,m),201);result=ok(confirm(actor,p));store=actor.client.app.state.store
    w=ws.get(store,actor.user['id'],'watch',result['payload']['result']['watch_id']);wp=copy.deepcopy(w['payload'])
    if mutation=='missing_policy':wp['source_scope'].pop('period_policy')
    elif mutation=='wrong_basis':wp['comparison']='year_over_year'
    elif mutation=='missing_scope':wp.pop('source_scope')
    else:
        with store.transaction() as db:
            if mutation=='message_removed':db.execute('DELETE FROM copilot_messages WHERE id=?',(m['id'],))
            else:db.execute('UPDATE copilot_messages SET payload=? WHERE id=?',(encode({**m['payload'],'question':'不同原问题'}),m['id']))
    replace_payload(actor,w,wp);healthy=watch(actor,d,threshold=.99);before=store.db.total_changes
    entries={x['rule_id']:x for x in evaluate(actor)['evaluations']}
    assert entries[w['id']]['state']=='unknown' and 'value' not in entries[w['id']]
    assert entries[healthy['id']]['state']=='triggered'
    assert not store.all('SELECT * FROM tracking_receipts WHERE rule_id=?',(w['id'],))


def test_dataset_basis_edit_has_semantic_revision_and_old_client_metadata_keeps_basis(actor):
    d=actor.dataset();w=ok(direct(actor,d,comparison='previous',threshold=1.0),201);evaluate(actor);store=actor.client.app.state.store
    old_alert=copy.deepcopy(ws.objects(store,actor.user['id'],'alert')[0])
    renamed=ok(update(actor,w,title='新名称'))
    assert renamed['payload']['comparison']=='previous' and renamed['payload']['evaluation_revision']==1
    changed=ok(update(actor,renamed,comparison='year_over_year'))
    assert changed['payload']['comparison']=='year_over_year' and changed['payload']['source_scope']['comparison']=='year_over_year'
    assert changed['payload']['evaluation_revision']==2
    entry=evaluate(actor)['evaluations'][0]
    assert entry['comparison']=='year_over_year' and entry['alert_id']!=old_alert['id']
    assert ws.get(store,actor.user['id'],'alert',old_alert['id'])==old_alert
    assert len(store.all('SELECT * FROM tracking_receipts'))==2


def test_incomplete_quarter_still_refuses_even_with_valid_basis(actor):
    d=actor.dataset();ok(direct(actor,d,comparison='previous'),201)
    entry=evaluate_watches(actor.client.app.state.store,actor.user['id'],today=date(2026,8,1))['evaluations'][0]
    assert entry['state']=='incomplete';assert_no_alerts(actor)


@pytest.mark.parametrize('kind',['report','action','alert'])
def test_direct_handoffs_without_verifiable_growth_scope_refuse_without_history_mutation(actor,kind):
    from test_business_provenance import action
    from test_workspace_api import plan,execute
    d=actor.dataset();store=actor.client.app.state.store
    if kind=='report':
        r=execute(actor,plan(actor,d));ref={'kind':'report','run_id':r['id']}
    elif kind=='action':
        r=ok(action(actor,d),201);ref={'kind':'action','action_id':r['id'],'action_version':r['version'],'action_hash':digest(r['payload'])}
    else:
        watch(actor,d);evaluate(actor);r=ws.objects(store,actor.user['id'],'alert')[0];ref={'kind':'alert','alert_id':r['id']}
    before=store.db.total_changes;history=store.all('SELECT * FROM workspace_objects');reports=store.all('SELECT * FROM runs')
    response=ok(direct(actor,d,comparison='previous',source_ref=ref),422)
    assert response['error']['code']=='WATCH_SCOPE_REQUIRED'
    assert store.db.total_changes==before
    assert store.all('SELECT * FROM workspace_objects')==history and store.all('SELECT * FROM runs')==reports


def test_new_dataset_revision_does_not_replace_copilot_basis_or_original_scope(actor):
    from conftest import editable
    d,t,m=source(actor);p=ok(growth_proposal(actor,t,m),201);ok(confirm(actor,p));first=evaluate(actor)['evaluations'][0]
    body=editable(d);body['periods'][-1]['revenue']+=100
    revised=ok(actor.put('/datasets/'+d['id'],json=body));again=evaluate(actor)['evaluations'][0]
    assert again['comparison']=='previous' and again['source_scope']==first['source_scope']
    assert again['dataset_version']==2 and again['alert_id']!=first['alert_id']
    assert again['value']==calculate(revised['payload'],'previous',today=TODAY)['metrics']['revenue_growth']


def test_client_cannot_supply_or_reseal_source_scope(actor):
    d=actor.dataset()
    ok(direct(actor,d,comparison='previous',source_scope={'schema_version':1,'comparison':'previous','source_kind':'dataset'}),422)
    assert not ws.objects(actor.client.app.state.store,actor.user['id'],'watch')


def test_non_growth_behavior_and_old_creation_idempotency_hash_are_unchanged(actor):
    d=actor.dataset();w=watch(actor,d,request_id='legacy-compatible-create')
    creation=copy.deepcopy(w['payload']['creation_request']);assert 'comparison' not in creation
    assert w['payload']['creation_request_hash']==digest(creation)
    assert watch(actor,d,request_id='legacy-compatible-create')['id']==w['id']
    ok(direct(actor,d,metric='gross_margin',comparison='previous'),422)


@pytest.mark.parametrize('field',['source_message_id','thread_id'])
def test_malformed_saved_source_ids_are_unknown_not_a_tracking_crash(actor,field):
    d,t,m=source(actor);p=ok(growth_proposal(actor,t,m),201);result=ok(confirm(actor,p));store=actor.client.app.state.store
    w=ws.get(store,actor.user['id'],'watch',result['payload']['result']['watch_id']);payload=copy.deepcopy(w['payload'])
    payload['provenance'][field]=['not-a-scalar-id'];replace_payload(actor,w,payload)
    before=store.db.total_changes;entry=evaluate(actor)['evaluations'][0]
    assert entry['state']=='unknown' and 'value' not in entry
    assert store.db.total_changes==before;assert_no_alerts(actor)
