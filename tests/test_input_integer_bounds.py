"""One integer contract for SSE, polling, revisions, and optimistic writes."""
import pytest
from pydantic import ValidationError
from server.schemas import MAX_SAFE_INTEGER, DatasetUpdate, BatchDelete
from server.autonomy_contracts import RunControl, ActivateStrategy
from conftest import editable


@pytest.mark.parametrize('value',[MAX_SAFE_INTEGER+1,2**63,10**100,-1])
@pytest.mark.parametrize('route',['/sync?after=','/runs?offset=','/services/history?offset='])
def test_integer_polling_cursors_reject_before_sql_binding(actor,value,route):
    # /services/history is the retained orphan-history read entry point.
    response=actor.get(route+str(value))
    assert response.status_code==422,response.text


@pytest.mark.parametrize('value',[MAX_SAFE_INTEGER+1,2**63,10**100,-1])
def test_sse_query_rejection_happens_before_stream_headers(actor,value):
    run=actor.execute(actor.run().json())
    response=actor.get('/runs/'+run['id']+'/events?after='+str(value))
    assert response.status_code==422 and response.headers['content-type'].startswith('application/json')


@pytest.mark.parametrize('value',['x','1.5','-1','1e3',str(MAX_SAFE_INTEGER+1),str(2**63),'9'*5000,'0'*5000])
def test_sse_reconnect_header_is_bounded_ascii_decimal(actor,value):
    run=actor.execute(actor.run().json())
    response=actor.get('/runs/'+run['id']+'/events',headers={'Last-Event-ID':value})
    assert response.status_code==422 and response.json()['error']['code']=='INVALID_CURSOR'


def test_maximum_cursor_and_header_query_precedence_remain_readable(actor):
    run=actor.execute(actor.run().json());path='/runs/'+run['id']
    events=actor.get(path+'/trace').json()['items'];pivot=events[3]['seq']
    for query,header in [(pivot,events[1]['seq']),(events[1]['seq'],pivot)]:
        result=actor.get(path+'/events?after='+str(query),headers={'Last-Event-ID':str(header)})
        assert result.status_code==200
        assert [int(x[4:]) for x in result.text.splitlines() if x.startswith('id: ')]==[x['seq'] for x in events if x['seq']>pivot]
        assert 'event: end' in result.text
    for route in ['/sync?after=','/runs?offset=']:
        assert actor.get(route+str(MAX_SAFE_INTEGER)).status_code==200
    response=actor.get(path+'/events',headers={'Last-Event-ID':str(MAX_SAFE_INTEGER)})
    assert response.status_code==200 and 'event: end' in response.text and 'id: ' not in response.text


def test_revision_and_delete_query_bounds_do_not_mutate_objects(actor):
    data=actor.dataset();session=actor.conversation();huge=str(2**63)
    assert actor.get('/workspace/datasets/'+data['id']+'/lineage?revision='+huge).status_code==422
    assert actor.delete('/datasets/'+data['id']+'?version='+huge).status_code==422
    assert actor.delete('/conversations/'+session['id']+'?version='+huge).status_code==422
    assert actor.get('/datasets/'+data['id']).json()['version']==1
    assert actor.get('/conversations/'+session['id']+'/messages').status_code==200


def test_version_bodies_and_nested_batch_versions_share_bound(actor):
    data=actor.dataset();body=editable(data);body['version']=2**63
    response=actor.put('/datasets/'+data['id'],json=body)
    assert response.status_code==422
    with pytest.raises(ValidationError):DatasetUpdate.model_validate(body)
    with pytest.raises(ValidationError):BatchDelete(ids=['x'],versions={'x':2**63})
    with pytest.raises(ValidationError):RunControl(version=2**63,action='pause')
    with pytest.raises(ValidationError):ActivateStrategy(expected_active_version=2**63,evaluation_id='evaluation')
    assert RunControl(version=MAX_SAFE_INTEGER,action='pause').version==MAX_SAFE_INTEGER
    assert actor.get('/datasets/'+data['id']).json()['version']==1
