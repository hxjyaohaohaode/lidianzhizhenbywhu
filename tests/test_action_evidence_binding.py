"""2026-10-02: explicit versioned evidence selection; isolated local fixtures only."""
from copy import deepcopy
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from conftest import Actor
from server.business_provenance import EvidenceRef, evidence_snapshots
from server.contracts import ActionTransition
from server.store import digest
from test_action_lifecycle import create, ok


FIELDS=('id','version','content_hash','review_version')


def capture(actor,suffix=''):
    return ok(actor.post('/evidence',json={'title':'版本绑定验收证据'+suffix,
        'text':('仅供隔离测试，行动验收必须使用本人已核对的原文及审阅版本。'+suffix)*10,
        'company':'测试企业'}),201)


def selection(actor,doc):
    return next(e for e in ok(actor.get('/workspace/evidence'))['items'] if e['id']==doc['id'])


def unchanged(store,owner,row,audit):
    assert store.one('SELECT * FROM workspace_objects WHERE user_id=? AND id=?',(owner,row['id']))==row
    assert store.all('SELECT * FROM audit ORDER BY seq')==audit


@pytest.mark.parametrize('shape',['ids_only','missing_ref','extra_ref','duplicate_id','duplicate_ref'])
def test_incomplete_or_ambiguous_evidence_selection_is_rejected_before_writing(actor,shape):
    row=create(actor,company='测试企业');doc=capture(actor);second=capture(actor,'第二份')
    ref=actor.evidence_ref(doc);other=actor.evidence_ref(second)
    bodies={
        'ids_only':{'evidence_ids':[doc['id']]},
        'missing_ref':{'evidence_ids':[doc['id'],second['id']],'evidence_refs':[ref]},
        'extra_ref':{'evidence_ids':[doc['id']],'evidence_refs':[ref,other]},
        'duplicate_id':{'evidence_ids':[doc['id'],doc['id']],'evidence_refs':[ref]},
        'duplicate_ref':{'evidence_refs':[ref,ref]},
    }
    body={'version':row['version'],'status':'in_progress',**bodies[shape]}
    with pytest.raises(ValidationError):ActionTransition.model_validate(body)
    store=actor.client.app.state.store
    before=store.one('SELECT * FROM workspace_objects WHERE id=?',(row['id'],))
    audit=store.all('SELECT * FROM audit ORDER BY seq')
    assert actor.put('/workspace/actions/'+row['id']+'/status',json=body).status_code==422
    unchanged(store,actor.user['id'],before,audit)


@pytest.mark.parametrize('field',['version','content_hash','review_version'])
def test_each_evidence_binding_field_is_mandatory_and_independently_checked(actor,field):
    row=create(actor,company='测试企业');doc=capture(actor);ref=actor.evidence_ref(doc)
    route='/workspace/actions/'+row['id']+'/status'
    missing={k:v for k,v in ref.items() if k!=field}
    assert actor.put(route,json={'version':1,'status':'in_progress','evidence_refs':[missing]}).status_code==422
    invalid={**ref,field:'0'*64 if field=='content_hash' else ref[field]+1}
    result=actor.put(route,json={'version':1,'status':'in_progress','evidence_refs':[invalid]})
    assert result.status_code==409 and result.json()['error']['code']=='ACTION_EVIDENCE_CHANGED'
    current=next(a for a in ok(actor.get('/workspace/actions'))['items'] if a['id']==row['id'])
    assert current['version']==row['version'] and current['payload']==row['payload']


@pytest.mark.parametrize('change',['metadata','review'])
@pytest.mark.parametrize('target',['in_progress','done'])
def test_changed_evidence_cannot_be_attached_by_omitting_refs_and_requires_reselection(actor,change,target):
    row=create(actor,company='测试企业');doc=capture(actor);selected=selection(actor,doc)
    ref={k:selected[k] for k in FIELDS};route='/workspace/actions/'+row['id']+'/status'
    if target=='done':row=ok(actor.put(route,json={'version':1,'status':'in_progress'}))
    if change=='metadata':
        ok(actor.put('/evidence/'+doc['id']+'/metadata',json={'version':doc['version'],'title':'后来修改的证据标题'}))
    else:
        ok(actor.put('/workspace/evidence/'+doc['id']+'/review',json={'version':selected['review_version'],
            'company':'测试企业','status':'accepted','note':'后来新增且尚未在验收中确认的审阅说明'}))
    body={'version':row['version'],'status':target,'note':'核对选中原文并记录本次验收结论','evidence_ids':[doc['id']]}
    store=actor.client.app.state.store
    before=store.one('SELECT * FROM workspace_objects WHERE id=?',(row['id'],))
    audit=store.all('SELECT * FROM audit ORDER BY seq')
    assert actor.put(route,json=body).status_code==422
    stale=actor.put(route,json={**body,'evidence_refs':[ref]})
    assert stale.status_code==409 and stale.json()['error']['code']=='ACTION_EVIDENCE_CHANGED'
    unchanged(store,actor.user['id'],before,audit)
    refreshed=selection(actor,doc);fresh_ref={k:refreshed[k] for k in FIELDS}
    accepted=ok(actor.put(route,json={**body,'evidence_refs':[fresh_ref]}))
    frozen=accepted['payload']['history'][-1]['evidence_snapshots'][0]
    assert {k:frozen[k] for k in FIELDS}==fresh_ref
    assert frozen['review']==refreshed['review'] and frozen['review_hash']==digest(refreshed['review'])
    assert frozen['title']==refreshed['payload']['title'] and frozen['text']==refreshed['payload']['text']


@pytest.mark.parametrize('with_ids',[False,True])
def test_current_evidence_refs_accept_multiple_selections_without_modifying_prior_history(actor,with_ids):
    row=create(actor,company='测试企业');first=capture(actor);second=capture(actor,'另一份')
    refs=[actor.evidence_ref(first),actor.evidence_ref(second)]
    body={'version':1,'status':'in_progress','evidence_refs':refs}
    if with_ids:body['evidence_ids']=[second['id'],first['id']]
    before=deepcopy(row['payload']['history'])
    accepted=ok(actor.put('/workspace/actions/'+row['id']+'/status',json=body))
    history=accepted['payload']['history']
    assert history[:-1]==before and accepted['version']==2
    expected_ids=body.get('evidence_ids',[ref['id'] for ref in refs])
    assert history[-1]['evidence_ids']==expected_ids
    assert {e['id']: {k:e[k] for k in FIELDS} for e in history[-1]['evidence_snapshots']}=={r['id']:r for r in refs}


@pytest.mark.parametrize('kind',['foreign','deleted'])
def test_refs_only_selection_still_requires_live_owned_evidence(actor,kind):
    row=create(actor,company='测试企业')
    owner=Actor(actor.client) if kind=='foreign' else actor
    doc=capture(owner);ref=owner.evidence_ref(doc)
    if kind=='deleted':ok(actor.delete('/evidence/'+doc['id']+'?version='+str(doc['version'])))
    result=actor.put('/workspace/actions/'+row['id']+'/status',json={'version':1,'status':'in_progress','evidence_refs':[ref]})
    assert result.status_code==404
    latest=next(a for a in ok(actor.get('/workspace/actions'))['items'] if a['id']==row['id'])
    assert latest['version']==1 and latest['payload']==row['payload']


def test_evidence_snapshot_resolver_also_rejects_unbound_internal_calls():
    with pytest.raises(HTTPException) as error:evidence_snapshots(None,'owner','company',['evidence'])
    assert error.value.status_code==422 and error.value.detail['code']=='ACTION_EVIDENCE_VERSION_REQUIRED'
    ref=EvidenceRef(id='another',version=1,content_hash='a'*64,review_version=1)
    with pytest.raises(HTTPException) as error:evidence_snapshots(None,'owner','company',['evidence'],[ref])
    assert error.value.status_code==422 and error.value.detail['code']=='EVIDENCE_MISMATCH'


def test_no_evidence_transition_remains_supported_and_does_not_invent_snapshots(actor):
    row=create(actor);route='/workspace/actions/'+row['id']+'/status'
    active=ok(actor.put(route,json={'version':1,'status':'in_progress'}))
    done=ok(actor.put(route,json={'version':active['version'],'status':'done','note':'本次验收结果已写明但没有附加证据'}))
    assert done['payload']['history'][-1]['evidence_ids']==[]
    assert done['payload']['history'][-1]['evidence_snapshots']==[]
