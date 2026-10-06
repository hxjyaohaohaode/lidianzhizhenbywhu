import pytest
from server.store import encode
from source_binding_cases import ok

@pytest.mark.parametrize('target,value',[('dataset',None),('dataset',{}),('review',None),('review',[])])
def test_malformed_live_source_rejected_with_controlled_409(actor,target,value):
    d=actor.dataset();store=actor.client.app.state.store
    doc=ok(actor.post('/evidence',json={'title':'有界校验资料','text':'毛利率现金流原文资料需要核对。'*8,'company':d['payload']['company']}),201)
    plan=ok(actor.post('/workspace/plans',json={'dataset_id':d['id'],'query':'核查毛利率现金流'}),201)
    assert plan['payload']['snapshot']['citations']
    with store.transaction() as db:
        if target=='dataset':db.execute('UPDATE datasets SET payload=? WHERE id=?',(encode(value),d['id']))
        else:db.execute("UPDATE workspace_objects SET payload=? WHERE kind='evidence_review' AND natural_key=?",(encode(value),doc['id']))
    before=store.db.total_changes
    response=actor.post('/workspace/plans/'+plan['id']+'/execute',json={'version':plan['version'],'fingerprint':plan['payload']['fingerprint'],'external_consent':False})
    assert response.status_code==409,(target,value,response.status_code,response.text)
    assert store.db.total_changes==before
