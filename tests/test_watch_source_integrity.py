import copy
import pytest
from datetime import date
from conftest import editable
from test_services import watch
from test_business_provenance import ok
from server import workspace_store as ws
from server.copilot import evaluate_watches
from server.store import encode,digest

TODAY=date(2026,10,5)
def corrupt(store,d,value='changed'):
 p=copy.deepcopy(d['payload']) if value=='changed' else value
 if value=='changed':p['periods'][-1]['cost']=19400000
 with store.transaction() as db:db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(p),d['id']))
 return p

def test_bad_live_payload_must_not_freeze_false_alert_or_receipt(actor):
 d=actor.dataset();store=actor.client.app.state.store;w=watch(actor,d,threshold=.1)
 clean=evaluate_watches(store,actor.user['id'],today=TODAY)
 assert clean['evaluations'][0]['state']=='clear'
 original_rule=ws.get(store,actor.user['id'],'watch',w['id'])
 altered=corrupt(store,d);before=store.db.total_changes
 result=evaluate_watches(store,actor.user['id'],today=TODAY)
 alerts=ws.objects(store,actor.user['id'],'alert');receipts=store.all('SELECT * FROM tracking_receipts WHERE rule_id=?',(w['id'],))
 assert not alerts and not receipts,(result,alerts,receipts)
 assert result['evaluations'][0]['state']=='unknown'
 assert store.db.total_changes==before

@pytest.mark.parametrize('value',['changed',None,{}])
def test_bad_rule_is_unknown_and_other_healthy_rule_still_evaluates(actor,value):
 d=actor.dataset();store=actor.client.app.state.store;bad=watch(actor,d,threshold=.1)
 p=editable(d);p.pop('version');p['company']='另一健康企业';healthy=ok(actor.post('/datasets',json=p),201);good=watch(actor,healthy,threshold=.99)
 corrupt(store,d,value)
 result=evaluate_watches(store,actor.user['id'],today=TODAY)
 entries={x['rule_id']:x for x in result['evaluations']}
 assert entries[bad['id']]['state']=='unknown',entries
 assert entries[good['id']]['state']=='triggered',entries
 assert 'value' not in entries[bad['id']]
 assert len(ws.objects(store,actor.user['id'],'alert'))==1
 assert len(store.all('SELECT * FROM tracking_receipts'))==1
 assert not store.all('SELECT * FROM tracking_receipts WHERE rule_id=?',(bad['id'],))

def test_healthy_evaluation_alert_and_archive_dedup_remain_unchanged(actor):
 d=actor.dataset();store=actor.client.app.state.store;w=watch(actor,d,threshold=.99)
 first=evaluate_watches(store,actor.user['id'],today=TODAY);again=evaluate_watches(store,actor.user['id'],today=TODAY)
 assert first['evaluations'][0]['state']=='triggered'
 assert first['evaluations'][0]['alert_id']==again['evaluations'][0]['alert_id']
 assert len(ws.objects(store,actor.user['id'],'alert'))==1
 assert len(store.all('SELECT * FROM tracking_receipts'))==1
