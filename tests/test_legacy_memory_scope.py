"""Default legacy run memory scope with API-created synthetic data only."""
import pytest
from conftest import Actor
from server.store import encode


def memory(actor,**patch):
    response=actor.post('/memories',json={'text':'Synthetic shared memory','approved':True,**patch})
    assert response.status_code==201,response.text
    return response.json()


def selected(actor,data=None,**fields):
    response=actor.run(dataset=data,**fields)
    assert response.status_code==202,response.text
    return response.json()


def ids(run):return {m['id'] for m in run['snapshot']['memory']}


def corrupt(actor,row,payload):
    with actor.client.app.state.store.transaction() as db:db.execute('UPDATE memories SET payload=? WHERE id=?',(encode(payload),row['id']))


def test_default_context_includes_shared_only_and_never_other_account(actor):
    data=actor.dataset();identity=actor.post('/services/identities',json={'name':'Synthetic other lens','dataset_ids':[data['id']]}).json()
    scoped=memory(actor,identity_id=identity['id'],text='Synthetic identity-only');shared=memory(actor,text='Synthetic shared')
    default=memory(actor,identity_id='',text='Synthetic default',company=data['payload']['company'],role=actor.user['preferences']['role'],expires_at='2099-01-01')
    foreign=memory(Actor(actor.client));run=selected(actor,data)
    assert ids(run)=={shared['id'],default['id']} and scoped['id'] not in ids(run) and foreign['id'] not in ids(run)


@pytest.mark.parametrize('patch',[{'approved':False},{'company':'Synthetic other company'},{'role':'investor'},{'expires_at':'2000-01-01'}])
def test_canonical_scope_and_consent_gates(actor,patch):
    memory(actor,**patch);healthy=memory(actor,text='Synthetic healthy neighbor');assert ids(selected(actor))=={healthy['id']}


@pytest.mark.parametrize('field',['identity_id','approved','company','role','expires_at','kind','text'])
def test_missing_fields_never_gain_default_consent(actor,field):
    broken=memory(actor);payload=dict(broken['payload']);payload.pop(field);corrupt(actor,broken,payload)
    healthy=memory(actor,text='Synthetic healthy neighbor');assert ids(selected(actor))=={healthy['id']}


@pytest.mark.parametrize('patch',[{'identity_id':None},{'approved':'true'},{'approved':1},{'company':[]},{'role':{}},{'expires_at':'bad-date'},{'text':5},{'kind':'invented'},{'extra':'unrecognized'}])
def test_malformed_metadata_does_not_select_or_hide_healthy_rows(actor,patch):
    broken=memory(actor);corrupt(actor,broken,{**broken['payload'],**patch})
    healthy=memory(actor,text='Synthetic healthy neighbor');assert ids(selected(actor))=={healthy['id']}


@pytest.mark.parametrize('preferences',[{'memory_enabled':False},{'memory_enabled':'true'},{'role':'invalid'},None,[]])
def test_disabled_or_invalid_live_preferences_supply_no_memory_authority(actor,preferences):
    memory(actor);payload={**actor.user['preferences'],**preferences} if isinstance(preferences,dict) else preferences
    with actor.client.app.state.store.transaction() as db:db.execute('UPDATE users SET preferences=? WHERE id=?',(encode(payload),actor.user['id']))
    assert ids(selected(actor))==set()


def test_request_exclusion_and_eight_record_cap_skip_bad_neighbors(actor):
    good=[memory(actor,text='Synthetic eligible '+str(i)) for i in range(10)]
    for i in range(5):
        row=memory(actor,text='Synthetic broken '+str(i));payload=dict(row['payload']);payload.pop('identity_id');corrupt(actor,row,payload)
    assert ids(selected(actor,include_memory=False))==set()
    actual=ids(selected(actor));assert len(actual)==8 and actual<={row['id'] for row in good}


def test_idempotent_replay_keeps_original_snapshot_without_new_writes(actor):
    data=actor.dataset();session=actor.conversation();row=memory(actor);run=selected(actor,data,session=session,key='synthetic-replay-key')
    assert ids(run)=={row['id']}
    actor.put('/memories/'+row['id'],json={**row['payload'],'approved':False,'version':row['version']})
    store=actor.client.app.state.store;before=store.db.total_changes;replay=selected(actor,data,session=session,key='synthetic-replay-key')
    assert replay['id']==run['id'] and encode(replay['snapshot'])==encode(run['snapshot']) and store.db.total_changes==before


def test_historical_snapshot_bytes_not_rewritten_by_new_admission(actor):
    data=actor.dataset();run=selected(actor,data);historical={**run['snapshot'],'memory':[{'id':'synthetic-old-scope','version':1,'text':'Historical retained snapshot','kind':'note'}]}
    store=actor.client.app.state.store
    with store.transaction() as db:db.execute('UPDATE runs SET snapshot=? WHERE id=?',(encode(historical),run['id']))
    raw=store.db.execute('SELECT snapshot FROM runs WHERE id=?',(run['id'],)).fetchone()[0];selected(actor,data)
    assert store.db.execute('SELECT snapshot FROM runs WHERE id=?',(run['id'],)).fetchone()[0]==raw


def test_modern_explicit_identity_keeps_matching_and_shared_rules(actor):
    data=actor.dataset();profile=actor.post('/services/identities',json={'name':'Synthetic explicit lens','dataset_ids':[data['id']],'include_shared_memory':False}).json()
    own=memory(actor,identity_id=profile['id']);memory(actor,text='Synthetic shared excluded')
    response=actor.post('/workspace/plans',json={'dataset_id':data['id'],'identity_id':profile['id'],'query':'核查毛利率'})
    assert response.status_code==201,response.text
    assert {m['id'] for m in response.json()['payload']['snapshot']['memory']}=={own['id']}
