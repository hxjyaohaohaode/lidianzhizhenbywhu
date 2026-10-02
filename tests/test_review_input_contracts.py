"""Current reviewed-input contracts; isolated financial fixtures, no supplier calls."""
import pytest
from conftest import editable
from server.question_scope import resolve_question, resolve_followup
from test_services import thread, message, ok


@pytest.mark.parametrize('text', ['毛利额', '毛利金额', '毛利润', '毛利润总额', 'gross profit', 'gross profit amount', 'gross-profit amount', 'gross margin and gross-profit amount', '毛利总金额', '毛利率和毛利额'])
def test_explicit_gross_profit_amount_cannot_be_substituted_with_a_percentage(example, text):
    result=resolve_question('2025-Q4 '+text,example,['gross_margin','cash_ratio'])
    assert result['status']=='unsupported_topic' and not result['can_calculate'] and result['topics']==[]
    assert '毛利率' in result['notice'] and '金额' in result['notice']


@pytest.mark.parametrize('text', ['毛利率','毛利润率','gross margin','gross profit margin','gross-profit margin'])
def test_explicit_gross_margin_ratio_remains_supported(example,text):
    result=resolve_question('2025-Q4 '+text,example,[])
    assert result['can_calculate'] and result['topics']==['gross_margin']


def test_amount_followup_does_not_inherit_an_earlier_percentage(example):
    previous=resolve_question('2025-Q4毛利率环比',example,[])
    result=resolve_followup('继续看看毛利额',example,['gross_margin'],previous)
    assert result['status']=='unsupported_topic' and result['topics']==[]
    assert not result['can_calculate']


def test_both_assistants_disclose_unsupported_amount_without_ratio_facts(actor):
    d=actor.dataset();query='2025-Q4毛利额'
    legacy=ok(actor.post('/workspace/assistant',json={'dataset_id':d['id'],'query':query}))
    service=ok(message(actor,thread(actor,d),text=query),201)['message']['payload']['response']
    for result in (legacy,service):
        scope=result.get('question_scope') or result['context']['question_scope']
        assert scope['status']=='unsupported_topic' and result['facts']==[]
        assert '金额' in result['answer'] and result['external_calls']==0


def experiment_request(d):
    return {'dataset_id':d['id'],'dataset_version':d['version'],'dataset_hash':d['content_hash'],
            'name':'仅用于隔离版本合同核查','kind':'scenario','price_change':.05,'assumptions':'明确基于当前已查看财务版本的隔离假设'}


def experiment_snapshot(store):
    return {table:store.all('SELECT * FROM '+table+' ORDER BY rowid') for table in
            ('datasets','dataset_revisions','workspace_objects','audit')}


@pytest.mark.parametrize('missing',['both','dataset_version','dataset_hash'])
def test_experiment_requires_both_reviewed_revision_fields_without_writes(actor,missing):
    d=actor.dataset();body=experiment_request(d)
    for field in (['dataset_version','dataset_hash'] if missing=='both' else [missing]):body.pop(field)
    before=experiment_snapshot(actor.client.app.state.store)
    r=actor.post('/workspace/experiments',json=body)
    assert r.status_code==422,r.text
    assert experiment_snapshot(actor.client.app.state.store)==before


@pytest.mark.parametrize('patch',[{'dataset_version':None},{'dataset_hash':None},{'dataset_version':True},
                                  {'dataset_version':1.0},{'dataset_version':0},{'dataset_hash':'not-a-hash'}])
def test_experiment_rejects_invalid_reviewed_revision_types(actor,patch):
    d=actor.dataset();body={**experiment_request(d),**patch};before=experiment_snapshot(actor.client.app.state.store)
    r=actor.post('/workspace/experiments',json=body)
    assert r.status_code==422,r.text
    assert experiment_snapshot(actor.client.app.state.store)==before


def test_experiment_cannot_save_unbound_or_stale_assumptions_after_source_revision(actor):
    d=actor.dataset();request=experiment_request(d);change=editable(d);change['periods'][-1]['revenue']+=100000
    updated=ok(actor.put('/datasets/'+d['id'],json=change));before=experiment_snapshot(actor.client.app.state.store)
    unbound={k:v for k,v in request.items() if k not in ('dataset_version','dataset_hash')}
    assert actor.post('/workspace/experiments',json=unbound).status_code==422
    assert actor.post('/workspace/experiments',json=request).status_code==409
    assert experiment_snapshot(actor.client.app.state.store)==before
    accepted=ok(actor.post('/workspace/experiments',json=experiment_request(updated)),201)
    assert accepted['payload']['snapshot']==updated['payload']
    assert accepted['payload']['dataset_version']==updated['version']
    assert accepted['payload']['dataset_hash']==updated['content_hash']
    assert accepted['payload']['request']['dataset_version']==updated['version']
