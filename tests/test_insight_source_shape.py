import pytest
from test_business_provenance import action
from server.intelligence import build_insights
from server.store import encode
@pytest.mark.parametrize('value',[None,{}])
def test_saved_insight_choice_rejects_malformed_live_source(actor,value):
 d=actor.dataset();store=actor.client.app.state.store
 insight=build_insights(store,actor.user['id'])['items'][0]
 with store.transaction() as db:db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(value),d['id']))
 before=store.db.total_changes
 response=action(actor,d,source_ref={'kind':'insight','source_key':insight['key'],'allow_historical':True})
 assert response.status_code==409,(response.status_code,response.text)
 assert store.db.total_changes==before
