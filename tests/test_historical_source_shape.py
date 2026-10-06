import copy
import pytest
from test_workspace_api import plan,execute
from test_business_provenance import action,ok
from server.store import encode,digest

@pytest.mark.parametrize('value',[None,{}])
@pytest.mark.parametrize('kind',['report','action'])
def test_valid_archived_source_survives_unparseable_current_dataset(actor,kind,value):
 d=actor.dataset();store=actor.client.app.state.store;report=execute(actor,plan(actor,d))
 a=ok(action(actor,d,source_ref={'kind':'report','run_id':report['id']}),201)
 source={'kind':'report','run_id':report['id']} if kind=='report' else {'kind':'action','action_id':a['id'],'action_version':a['version'],'action_hash':digest(a['payload'])}
 with store.transaction() as db:db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(value),d['id']))
 response=action(actor,d,source_ref={**source,'allow_historical':True})
 assert response.status_code==201,(kind,value,response.status_code,response.text)
 assert response.json()['source_impact']['state']!='current'
 assert store.owned('runs',actor.user['id'],report['id'])['result']==report['result']
