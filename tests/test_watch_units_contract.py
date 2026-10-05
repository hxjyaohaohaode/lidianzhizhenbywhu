"""Authenticated canonical contracts behind L4 display/entry units; no browser claim."""
from copy import deepcopy
from datetime import datetime, timezone

from conftest import dataset_ref, editable
from server.copilot import evaluate_watches
from server import workspace_store as ws
from test_services import ok, watch, thread, proposal, confirm


def financial_input(actor, example):
    data=deepcopy(example)
    today=datetime.now(timezone.utc).date()
    current_quarter=(today.month-1)//3+1
    quarter=current_quarter-1 or 4
    year=today.year-(current_quarter==1)
    row={**data['periods'][0], 'period':f'{year}-Q{quarter}',
         'revenue':100000, 'cost':80000, 'cash_flow':12345.67}
    data.update(company='L4隔离合成企业', name='L4合成季度输入', source_kind='user_provided', periods=[row])
    return ok(actor.post('/datasets', json=data), 201)


def update(actor, row, **patch):
    fields=('title','identity_id','dataset_id','metric','operator','threshold','active','stale_after_days','expires_at')
    body={key:row['payload'].get(key) for key in fields}
    return actor.put('/services/watches/'+row['id'], json={**body, 'version':row['version'], **patch})


def test_percent_lifecycle_and_yuan_alerts_keep_canonical_values_and_frozen_history(actor,example):
    data=financial_input(actor,example)
    store=actor.client.app.state.store
    row=watch(actor,data,threshold=.15)
    assert row['payload']['threshold']==.15
    original=deepcopy(row)
    clear=evaluate_watches(store,actor.user['id'])['evaluations'][0]
    assert clear['value']==.2 and clear['threshold']==.15 and clear['state']=='clear'
    assert not ws.objects(store,actor.user['id'],'alert')
    # Merely viewing/cancelling an edit supplies no write; saved values are unchanged.
    assert ws.get(store,actor.user['id'],'watch',row['id'])['payload']==original['payload']
    changed=ok(update(actor,row,threshold=.25))
    assert changed['id']==row['id'] and changed['version']==row['version']+1
    assert changed['payload']['threshold']==.25
    hit=evaluate_watches(store,actor.user['id'])['evaluations'][0]
    assert hit['state']=='triggered' and hit['value']==.2 and hit['threshold']==.25
    for _ in range(3):
        repeated=evaluate_watches(store,actor.user['id'])['evaluations'][0]
        assert repeated['alert_id']==hit['alert_id']
    alerts=ws.objects(store,actor.user['id'],'alert')
    assert len(alerts)==1
    historical=deepcopy(alerts[0])
    frozen=historical['payload']
    assert frozen['value']==.2 and frozen['threshold']==.25
    assert frozen['dataset_version']==data['version'] and frozen['dataset_hash']==data['content_hash']
    assert frozen['period']==data['payload']['periods'][0]['period']
    before=store.db.total_changes
    assert update(actor,row,threshold=.3).status_code==409
    assert store.db.total_changes==before
    paused=ok(update(actor,changed,active=False))
    assert evaluate_watches(store,actor.user['id'])['evaluations']==[]
    reopened=ok(update(actor,paused,active=True))
    assert reopened['payload']['evaluation_revision']==changed['payload']['evaluation_revision']
    assert evaluate_watches(store,actor.user['id'])['evaluations'][0]['alert_id']==hit['alert_id']
    assert len(ws.objects(store,actor.user['id'],'alert'))==1
    cash=watch(actor,data,metric='cash_flow',threshold=15000.25,title='人民币现金流下限')
    evaluated=evaluate_watches(store,actor.user['id'])
    money=next(value for value in evaluated['evaluations'] if value['rule_id']==cash['id'])
    assert money['state']=='triggered' and money['value']==12345.67 and money['threshold']==15000.25
    revised=editable(data);revised['periods'][0]['cost']=70000
    ok(actor.put('/datasets/'+data['id'],json=revised))
    assert next(value for value in evaluate_watches(store,actor.user['id'])['evaluations'] if value['rule_id']==row['id'])['state']=='clear'
    assert ws.get(store,actor.user['id'],'alert',historical['id'])==historical
    assert ws.get(store,actor.user['id'],'watch',row['id'])['payload']['threshold']==.25


def test_watch_proposals_preview_and_confirm_canonical_percent_and_yuan_without_migration(actor,example):
    data=financial_input(actor,example);store=actor.client.app.state.store;t=thread(actor,data)
    for index,(metric,threshold) in enumerate([('gross_margin',.25),('cash_flow',15000.25)]):
        before=len(ws.objects(store,actor.user['id'],'watch'))
        p=ok(proposal(actor,t,kind='watch',metric=metric,operator='lt',threshold=threshold,
                      request_id=f'L4-proposal-{index}'),201)
        assert p['payload']['preview']['threshold']==threshold
        assert len(ws.objects(store,actor.user['id'],'watch'))==before
        result=ok(confirm(actor,p))
        assert len(ws.objects(store,actor.user['id'],'watch'))==before+1
        saved=ws.get(store,actor.user['id'],'watch',result['payload']['result']['watch_id'])
        assert saved['payload']['threshold']==threshold and saved['payload']['metric']==metric
        assert ok(confirm(actor,p))['payload']['result']['watch_id']==saved['id']


def test_existing_signed_and_above_100_percent_bounds_are_unchanged(actor,example):
    data=financial_input(actor,example);store=actor.client.app.state.store
    for metric in ('gross_margin','cash_flow'):
        for threshold in (-1e15,1e15,-1.25,2.5,1e-9):
            saved=watch(actor,data,metric=metric,threshold=threshold)
            assert saved['payload']['threshold']==threshold
        for threshold in (-1e15-1,1e15+1):
            before=store.db.total_changes
            result=actor.post('/services/watches',json={'title':'拒绝越界','dataset_id':data['id'],
                'source_ref':dataset_ref(data),'metric':metric,'operator':'lt','threshold':threshold})
            assert result.status_code==422
            assert store.db.total_changes==before
