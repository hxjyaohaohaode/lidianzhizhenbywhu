"""Current applicability never upgrades corrupt live bytes or rewrites frozen history.

All mutations and reports use isolated synthetic temporary databases. The only
model calls below use the named in-process StudioProvider test double.
"""
from copy import deepcopy

import pytest

from conftest import Actor
from server import workspace_store as ws
from server.business_provenance import with_source_impact
from server.store import digest, encode
from test_business_provenance import action, action_ref, actions, ok
from test_report_source_integrity import watch_request
from test_services import identity, watch
from test_workspace_api import StudioProvider, execute, plan


def chain(actor, dataset, *, identity_id='', **plan_options):
    report = execute(actor, plan(actor, dataset, identity_id=identity_id, **plan_options))
    source = {'kind': 'report', 'run_id': report['id']}
    saved = ok(action(actor, dataset, identity_id=identity_id, source_ref=source), 201)
    rule = watch(actor, dataset, identity_id=identity_id, source_ref=action_ref(saved))
    return report, saved, rule


def impacts(actor, report, saved, rule):
    store = actor.client.app.state.store
    before = store.db.total_changes
    audit = ok(actor.get('/workspace/runs/' + report['id'] + '/audit'))
    listed = next(item for item in actions(actor) if item['id'] == saved['id'])
    # The tracking endpoint also evaluates watches; inspect this read-only
    # projection directly to keep its immutability evidence unambiguous.
    tracking = with_source_impact(store, actor.user['id'], ws.get(store, actor.user['id'], 'watch', rule['id']))
    assert audit['report_integrity']['valid']
    assert store.owned('runs', actor.user['id'], report['id']) == report
    assert listed['payload'] == saved['payload'] and listed['version'] == saved['version']
    assert tracking['payload'] == rule['payload'] and tracking['version'] == rule['version']
    assert store.db.total_changes == before
    return [audit['source_impact'], listed['source_impact'], tracking['source_impact']]


def assert_choice_required(actor, dataset, report, saved, *, state, identity_id=''):
    store = actor.client.app.state.store
    for ref in ({'kind': 'report', 'run_id': report['id']}, action_ref(saved)):
        before = store.db.total_changes
        rejected = action(actor, dataset, identity_id=identity_id, source_ref=ref)
        assert rejected.status_code == 409 and rejected.json()['error']['code'] == 'SOURCE_CHANGED'
        if not identity_id:
            assert watch_request(actor, dataset, ref).status_code == 409
        assert store.db.total_changes == before
        accepted = ok(action(actor, dataset, identity_id=identity_id,
            source_ref={**ref, 'allow_historical': True}), 201)
        assert accepted['source_impact']['state'] == state
        assert accepted['payload']['provenance']['historical_acknowledged']


def change_preferences(actor, **changes):
    user = ok(actor.get('/auth/me'))['user']
    if set(changes) == {'role'}:
        return ok(actor.put('/preferences/role', json={**changes, 'version': user['version']}))
    return ok(actor.put('/preferences', json={**user['preferences'], 'name': user['name'],
        'version': user['version'], **changes}))


def memory(actor, dataset, **options):
    return ok(actor.post('/memories', json={'text': '隔离合成：核对企业现金流研究重点',
        'company': dataset['payload']['company'], 'approved': True, 'role': 'enterprise', **options}), 201)


def evidence(actor, dataset):
    return ok(actor.post('/evidence', json={'title': '毛利率现金流采购成本隔离依据',
        'text': '隔离合成资料：毛利率现金流采购成本需要核对。' * 30,
        'company': dataset['payload']['company']}), 201)


@pytest.mark.parametrize('change', ['disable_memory', 'change_role'])
@pytest.mark.parametrize('workflow', ['studio', 'legacy'])
def test_real_preferences_withdraw_used_memory_and_require_historical_choice(actor, change, workflow):
    dataset = actor.dataset(); selected = memory(actor, dataset)
    if workflow == 'studio':
        report, saved, rule = chain(actor, dataset)
    else:
        report = actor.execute(ok(actor.run(dataset), 202))
        saved = ok(action(actor, dataset, source_ref={'kind': 'report', 'run_id': report['id']}), 201)
        rule = watch(actor, dataset, source_ref=action_ref(saved))
    assert [item['id'] for item in report['snapshot']['memory']] == [selected['id']]
    change_preferences(actor, **({'memory_enabled': False} if change == 'disable_memory' else {'role': 'investor'}))
    assert not plan(actor, dataset)['payload']['snapshot']['memory']
    for impact in impacts(actor, report, saved, rule):
        assert impact['state'] == 'changed'
        assert 'memory_withdrawn' in {r['code'] for r in impact['reasons']}
    assert_choice_required(actor, dataset, report, saved, state='changed')
    impacts(actor, report, saved, rule)


@pytest.mark.parametrize('kind', ['no_memory', 'all_role_memory', 'identity_role_memory', 'unrelated_preference'])
def test_preference_changes_only_affect_memories_whose_eligibility_changed(actor, kind):
    dataset = actor.dataset(); lens = None
    if kind != 'no_memory':
        if kind == 'identity_role_memory':
            lens = identity(actor, dataset, perspective='operator', include_shared_memory=False)
        selected = memory(actor, dataset, role='all' if kind == 'all_role_memory' else 'enterprise',
            identity_id=lens['id'] if lens else '')
    report, saved, rule = chain(actor, dataset, identity_id=lens['id'] if lens else '')
    if kind == 'unrelated_preference':
        change_preferences(actor, theme='dark')
    elif kind == 'no_memory':
        change_preferences(actor, role='investor', memory_enabled=False)
    else:
        change_preferences(actor, role='investor')
        fresh = plan(actor, dataset, identity_id=lens['id'] if lens else '')
        assert [m['id'] for m in fresh['payload']['snapshot']['memory']] == [selected['id']]
    assert all(i['state'] == 'current' and not i['reasons'] for i in impacts(actor, report, saved, rule))
    ok(action(actor, dataset, identity_id=lens['id'] if lens else '', source_ref=action_ref(saved)), 201)


def test_identity_shared_memory_withdrawal_is_detected_without_widening_scope(actor):
    dataset = actor.dataset(); memory(actor, dataset)
    lens = identity(actor, dataset, include_shared_memory=True)
    other_lens = identity(actor, dataset, name='另一隔离视角')
    report, saved, rule = chain(actor, dataset, identity_id=lens['id'])
    ok(actor.put('/services/identities/' + lens['id'], json={**lens['payload'],
        'version': lens['version'], 'include_shared_memory': False}))
    assert not plan(actor, dataset, identity_id=lens['id'])['payload']['snapshot']['memory']
    assert all('memory_withdrawn' in {r['code'] for r in i['reasons']} for i in impacts(actor, report, saved, rule))
    assert_choice_required(actor, dataset, report, saved, state='changed', identity_id=lens['id'])
    for source in ({'kind': 'report', 'run_id': report['id']}, action_ref(saved)):
        assert action(actor, dataset, identity_id=other_lens['id'],
            source_ref={**source, 'allow_historical': True}).status_code == 403
        assert action(Actor(actor.client), None, identity_id=lens['id'],
            source_ref={**source, 'allow_historical': True}).status_code == 404


def test_new_memories_do_not_revoke_an_eligible_older_selection_by_budget(actor):
    dataset = actor.dataset(); selected = memory(actor, dataset)
    report, saved, rule = chain(actor, dataset)
    for _ in range(8): memory(actor, dataset)
    assert selected['id'] not in {m['id'] for m in plan(actor, dataset)['payload']['snapshot']['memory']}
    assert all(i['state'] == 'current' for i in impacts(actor, report, saved, rule))


@pytest.mark.parametrize('change', ['text', 'text_type', 'payload_type', 'stored_hash', 'rehash'])
def test_live_evidence_integrity_and_frozen_report_trust_are_separate(actor, change):
    dataset = actor.dataset(); doc = evidence(actor, dataset)
    report, saved, rule = chain(actor, dataset)
    assert any(c['document_id'] == doc['id'] for c in report['snapshot']['citations'])
    store = actor.client.app.state.store
    payload = {**doc['payload'], 'text': '不同的隔离合成正文。' * 30}
    if change == 'text_type': payload['text'] = None
    if change == 'payload_type': payload = None
    content_hash = digest(payload['text']) if change == 'rehash' else '0' * 64 if change == 'stored_hash' else doc['content_hash']
    with store.transaction() as db:
        db.execute('UPDATE evidence SET payload=?,content_hash=? WHERE id=?', (encode(payload), content_hash, doc['id']))
    state = 'changed' if change == 'rehash' else 'unavailable'
    code = 'evidence_changed' if change == 'rehash' else 'evidence_integrity'
    for impact in impacts(actor, report, saved, rule):
        assert impact['state'] == state and code in {r['code'] for r in impact['reasons']}
    assert_choice_required(actor, dataset, report, saved, state=state)
    impacts(actor, report, saved, rule)
    # Damaging the frozen source itself cannot be acknowledged as history.
    damaged = deepcopy(report['snapshot']); damaged['citations'][0]['excerpt'] = '损坏的冻结文本'
    with store.transaction() as db: db.execute('UPDATE runs SET snapshot=? WHERE id=?', (encode(damaged), report['id']))
    before = store.db.total_changes
    for source in ({'kind': 'report', 'run_id': report['id']}, action_ref(saved)):
        for historical in (False, True):
            response = action(actor, dataset, source_ref={**source, 'allow_historical': historical})
            assert response.status_code == 409 and response.json()['error']['code'] == 'REPORT_INTEGRITY'
    assert store.db.total_changes == before


def test_corrupt_live_acceptance_evidence_is_unavailable_and_cannot_be_captured_again(actor):
    dataset = actor.dataset(); doc = evidence(actor, dataset); ref = actor.evidence_ref(doc)
    saved = ok(action(actor, dataset), 201)
    ok(actor.put('/workspace/actions/' + saved['id'] + '/status', json={'version': 1, 'status': 'in_progress'}))
    completed = ok(actor.put('/workspace/actions/' + saved['id'] + '/status', json={'version': 2,
        'status': 'done', 'note': '隔离测试核对完整验收资料', 'evidence_refs': [ref]}))
    rule = watch(actor, dataset, source_ref=action_ref(completed))
    pending = ok(action(actor, dataset), 201)
    ok(actor.put('/workspace/actions/' + pending['id'] + '/status', json={'version': 1, 'status': 'in_progress'}))
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE evidence SET payload=? WHERE id=?',
            (encode({**doc['payload'], 'text': '改变后不能被旧指纹证明的正文'}), doc['id']))
    before = store.db.total_changes
    live = next(a for a in actions(actor) if a['id'] == completed['id'])
    assert live['payload'] == completed['payload'] and live['payload']['status'] == 'done'
    assert live['acceptance_impact']['state'] == 'unavailable'
    assert {r['code'] for r in live['acceptance_impact']['reasons']} == {'evidence_integrity'}
    tracking = with_source_impact(store, actor.user['id'], rule)
    assert tracking['payload'] == rule['payload'] and tracking['source_impact']['state'] == 'unavailable'
    assert any(r['code'] == 'evidence_integrity' and r['dependency'] == 'action_acceptance' for r in tracking['source_impact']['reasons'])
    rejected = actor.put('/workspace/actions/' + pending['id'] + '/status', json={'version': 2,
        'status': 'done', 'note': '不能把损坏原文捕获为新验收快照', 'evidence_refs': [ref]})
    assert rejected.status_code == 409 and rejected.json()['error']['code'] == 'SOURCE_INTEGRITY'
    assert store.db.total_changes == before


@pytest.mark.parametrize('change', ['same_version', 'normal_revision', 'default_profile'])
def test_profile_comparison_uses_its_frozen_payload_and_version(actor, change):
    dataset = actor.dataset(); store = actor.client.app.state.store
    if change != 'default_profile':
        ok(actor.post('/workspace/profiles', json={'company': dataset['payload']['company'], 'objective': '原始隔离研究目标'}))
    report, saved, rule = chain(actor, dataset)
    assert all(i['state'] == 'current' for i in impacts(actor, report, saved, rule))
    if change == 'same_version':
        row = ws.keyed(store, actor.user['id'], 'profile', dataset['payload']['company'])
        with store.transaction() as db:
            db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',
                (encode({**row['payload'], 'objective': '相同版本不同目标'}), row['id']))
    else:
        ok(actor.post('/workspace/profiles', json={'company': dataset['payload']['company'], 'objective': '正常新建或修订目标', **({'version': 1} if change == 'normal_revision' else {})}))
    for impact in impacts(actor, report, saved, rule):
        assert impact['state'] == 'changed' and 'objective_changed' in {r['code'] for r in impact['reasons']}
    assert_choice_required(actor, dataset, report, saved, state='changed')


def claim_chain(factory, *, with_evidence=False):
    provider = StudioProvider(); actor = Actor(factory(providers=provider)); dataset = actor.dataset()
    if with_evidence: evidence(actor, dataset)
    report = execute(actor, plan(actor, dataset, use_llm=True), True)
    claim = report['result']['llm']['review']['claims'][0]
    review = ok(actor.post('/workspace/runs/' + report['id'] + '/reviews', json={
        'claim_id': claim['id'], 'verdict': 'accepted', 'note': '原始人工核查限定说明'}))
    saved = ok(action(actor, dataset, source_ref={'kind': 'report', 'run_id': report['id'], 'claim_id': claim['id']}), 201)
    rule = watch(actor, dataset, source_ref=action_ref(saved))
    assert provider.calls
    return actor, dataset, report, review, saved, rule


@pytest.mark.parametrize('change', ['note', 'normal_revision', 'unrelated_review'])
def test_claim_review_fingerprint_catches_same_version_change_without_affecting_other_claims(factory, change):
    actor, dataset, report, review, saved, rule = claim_chain(factory)
    assert all(i['state'] == 'current' for i in impacts(actor, report, saved, rule))
    store = actor.client.app.state.store
    if change == 'note':
        with store.transaction() as db:
            db.execute('UPDATE workspace_objects SET payload=? WHERE id=?',
                (encode({**review['payload'], 'note': '同版本的不同核查限定说明'}), review['id']))
    elif change == 'normal_revision':
        ok(actor.post('/workspace/runs/' + report['id'] + '/reviews', json={
            **{k: review['payload'][k] for k in ('claim_id', 'verdict')}, 'version': review['version'], 'note': '正常更新的核查限定说明'}))
    else:
        claim = report['result']['llm']['review']['claims'][1]
        ok(actor.post('/workspace/runs/' + report['id'] + '/reviews', json={
            'claim_id': claim['id'], 'verdict': 'accepted', 'note': '另一解释的独立审阅'}))
    current = impacts(actor, report, saved, rule)
    assert current[0]['state'] == 'current'  # The whole report did not freeze a selected claim review.
    if change == 'unrelated_review':
        assert all(i['state'] == 'current' for i in current)
        ok(action(actor, dataset, source_ref=action_ref(saved)), 201)
    else:
        for impact in current[1:]:
            assert impact['state'] == 'changed' and 'claim_review_changed' in {r['code'] for r in impact['reasons']}
        before = store.db.total_changes
        response = action(actor, dataset, source_ref=action_ref(saved))
        assert response.status_code == 409 and response.json()['error']['code'] == 'SOURCE_CHANGED'
        assert store.db.total_changes == before
        accepted = ok(action(actor, dataset, source_ref={**action_ref(saved), 'allow_historical': True}), 201)
        assert accepted['source_impact']['state'] == 'changed'


@pytest.mark.parametrize('value', [None, '', [], 'not-a-hash'])
def test_missing_legacy_claim_fingerprint_is_unknown_but_malformed_receipt_is_not_historical_consent(factory, value):
    actor, dataset, report, review, saved, rule = claim_chain(factory)
    store = actor.client.app.state.store
    changed = deepcopy(saved['payload'])
    if value is None: changed['provenance'].pop('claim_review_hash')
    else: changed['provenance']['claim_review_hash'] = value
    with store.transaction() as db: db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(changed), saved['id']))
    # This is a compatibility-shape test, not a claim of an authenticated old fixture.
    current = ws.get(store, actor.user['id'], 'action', saved['id'])
    current['object_hash'] = digest(current['payload'])
    before = store.db.total_changes
    impact = with_source_impact(store, actor.user['id'], current)['source_impact']
    expected = 'unknown' if value is None else 'unavailable'
    assert impact['state'] == expected
    response = action(actor, dataset, source_ref=action_ref(current))
    assert response.status_code == 409
    assert store.db.total_changes == before
    response = action(actor, dataset, source_ref={**action_ref(current), 'allow_historical': True})
    if value is None:
        assert response.status_code == 201 and response.json()['source_impact']['state'] == 'unknown'
        assert 'claim_review_hash' not in response.json()['payload']['provenance']
    else:
        assert response.status_code == 409 and response.json()['error']['code'] == 'SOURCE_INTEGRITY'
        assert store.db.total_changes == before
    assert store.owned('runs', actor.user['id'], report['id']) == report


def test_claim_without_citation_does_not_inherit_an_unrelated_evidence_integrity_warning(factory):
    actor, dataset, report, review, saved, rule = claim_chain(factory, with_evidence=True)
    assert report['snapshot']['citations'] and not saved['payload']['provenance']['evidence']
    store = actor.client.app.state.store
    doc = store.owned('evidence', actor.user['id'], report['snapshot']['citations'][0]['document_id'])
    with store.transaction() as db:
        db.execute('UPDATE evidence SET payload=? WHERE id=?',
            (encode({**doc['payload'], 'text': '不同的、未被此解释引用的正文'}), doc['id']))
    current = impacts(actor, report, saved, rule)
    assert current[0]['state'] == 'unavailable'
    assert all(i['state'] == 'current' and not i['reasons'] for i in current[1:])
    ok(action(actor, dataset, source_ref=action_ref(saved)), 201)


def test_other_owners_same_company_context_cannot_change_this_owners_report(actor):
    dataset = actor.dataset(); memory(actor, dataset); evidence(actor, dataset)
    report, saved, rule = chain(actor, dataset)
    foreign = Actor(actor.client); other = foreign.dataset()
    assert other['payload']['company'] == dataset['payload']['company']
    foreign_memory = memory(foreign, other); foreign_doc = evidence(foreign, other)
    change_preferences(foreign, memory_enabled=False, role='investor')
    ok(foreign.post('/workspace/profiles', json={'company': other['payload']['company'], 'objective': '另一个账户的目标'}))
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE memories SET payload=? WHERE id=?', (encode(None), foreign_memory['id']))
        db.execute('UPDATE evidence SET payload=? WHERE id=?', (encode(None), foreign_doc['id']))
    assert all(i['state'] == 'current' and not i['reasons'] for i in impacts(actor, report, saved, rule))
    ok(action(actor, dataset, source_ref=action_ref(saved)), 201)
    assert foreign.get('/workspace/runs/' + report['id'] + '/audit').status_code == 404


@pytest.mark.parametrize('change', [
    'preferences_null', 'preferences_list', 'preferences_missing_role', 'preferences_missing_memory_choice',
    'preferences_invalid_role', 'preferences_string_memory_choice',
    'identity_missing_perspective', 'identity_missing_shared_choice',
    'identity_invalid_perspective', 'identity_string_shared_choice',
])
def test_malformed_live_memory_authority_is_unavailable_without_inventing_defaults(actor, change):
    dataset = actor.dataset()
    lens = identity(actor, dataset) if change.startswith('identity') else None
    memory(actor, dataset)
    report, saved, rule = chain(actor, dataset, identity_id=lens['id'] if lens else '')
    store = actor.client.app.state.store
    with store.transaction() as db:
        if change.startswith('preferences'):
            payload = deepcopy(actor.user['preferences'])
            if change == 'preferences_null': payload = None
            elif change == 'preferences_list': payload = []
            elif change == 'preferences_missing_role': payload.pop('role')
            elif change == 'preferences_missing_memory_choice': payload.pop('memory_enabled')
            elif change == 'preferences_invalid_role': payload['role'] = []
            else: payload['memory_enabled'] = 'true'
            db.execute('UPDATE users SET preferences=? WHERE id=?', (encode(payload), actor.user['id']))
        else:
            payload = deepcopy(lens['payload'])
            if change == 'identity_missing_perspective': payload.pop('perspective')
            elif change == 'identity_missing_shared_choice': payload.pop('include_shared_memory')
            elif change == 'identity_invalid_perspective': payload['perspective'] = 'unrecognized'
            else: payload['include_shared_memory'] = 'true'
            db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(payload), lens['id']))
    current = impacts(actor, report, saved, rule)
    for impact in current:
        assert impact['state'] == 'unavailable'
        assert 'memory_context_unavailable' in {reason['code'] for reason in impact['reasons']}
    before = store.db.total_changes
    for source in ({'kind': 'report', 'run_id': report['id']}, action_ref(saved)):
        rejected = action(actor, dataset, identity_id=lens['id'] if lens else '', source_ref=source)
        assert rejected.status_code == 409
        rejected_watch = actor.post('/services/watches', json={'dataset_id': dataset['id'],
            'identity_id': lens['id'] if lens else '', 'title': '不能采用损坏的当前记忆许可',
            'metric': 'gross_margin', 'operator': 'lt', 'threshold': 0.9, 'source_ref': source})
        assert rejected_watch.status_code == 409
        assert store.db.total_changes == before
    for source in ({'kind': 'report', 'run_id': report['id']}, action_ref(saved)):
        historical = action(actor, dataset, identity_id=lens['id'] if lens else '',
            source_ref={**source, 'allow_historical': True})
        if lens:
            # A corrupt live identity cannot supply scope authorization, even
            # though its old report remains a valid, readable historical fact.
            assert historical.status_code == 409 and historical.json()['error']['code'] == 'SOURCE_INTEGRITY'
            assert store.db.total_changes == before
        else:
            assert historical.status_code == 201
            assert historical.json()['source_impact']['state'] == 'unavailable'
    impacts(actor, report, saved, rule)


@pytest.mark.parametrize('value', [None, [], {}])
def test_no_memory_dependency_does_not_create_authority_from_malformed_preferences(actor, value):
    dataset = actor.dataset(); report, saved, rule = chain(actor, dataset)
    assert not report['snapshot']['memory']
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE users SET preferences=? WHERE id=?', (encode(value), actor.user['id']))
    assert all(i['state'] == 'current' for i in impacts(actor, report, saved, rule))


@pytest.mark.parametrize('change', ['null', 'list', 'empty', 'missing_verdict', 'invalid_note', 'wrong_run', 'wrong_claim'])
def test_malformed_live_claim_review_cannot_become_a_fresh_receipt_but_prior_history_stays_frozen(factory, change):
    actor, dataset, report, review, saved, rule = claim_chain(factory)
    payload = deepcopy(review['payload'])
    if change == 'null': payload = None
    elif change == 'list': payload = []
    elif change == 'empty': payload = {}
    elif change == 'missing_verdict': payload.pop('verdict')
    elif change == 'invalid_note': payload['note'] = []
    elif change == 'wrong_run': payload['run_id'] = 'unrelated-run'
    else: payload['claim_id'] = 'unrelated-claim'
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(payload), review['id']))
    for impact in impacts(actor, report, saved, rule):
        assert impact['state'] == 'unavailable'
        assert 'claim_review_unavailable' in {reason['code'] for reason in impact['reasons']}
    before = store.db.total_changes
    direct = {'kind': 'report', 'run_id': report['id'], 'claim_id': review['payload']['claim_id']}
    for historical in (False, True):
        response = action(actor, dataset, source_ref={**direct, 'allow_historical': historical})
        assert response.status_code == 409 and response.json()['error']['code'] == 'SOURCE_INTEGRITY'
        assert watch_request(actor, dataset, {**direct, 'allow_historical': historical}).status_code == 409
    assert action(actor, dataset, source_ref=action_ref(saved)).status_code == 409
    assert watch_request(actor, dataset, action_ref(saved)).status_code == 409
    assert store.db.total_changes == before
    retained = ok(action(actor, dataset, source_ref={**action_ref(saved), 'allow_historical': True}), 201)
    assert retained['source_impact']['state'] == 'unavailable'
    assert retained['payload']['provenance']['claim_review_hash'] == digest(review['payload'])
    impacts(actor, report, saved, rule)
    # Corruption of the recorded historical hash remains a hard refusal, even
    # when the live review is independently malformed too.
    damaged = deepcopy(saved['payload']); damaged['provenance']['claim_review_hash'] = []
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(damaged), saved['id']))
    damaged_row = ws.get(store, actor.user['id'], 'action', saved['id'])
    damaged_row['object_hash'] = digest(damaged_row['payload'])
    before = store.db.total_changes
    response = action(actor, dataset, source_ref={**action_ref(damaged_row), 'allow_historical': True})
    assert response.status_code == 409 and response.json()['error']['code'] == 'SOURCE_INTEGRITY'
    assert store.db.total_changes == before
    assert store.owned('runs', actor.user['id'], report['id']) == report


def test_malformed_unselected_claim_review_does_not_taint_an_independently_selected_claim(factory):
    actor, dataset, report, review, saved, rule = claim_chain(factory)
    other = report['result']['llm']['review']['claims'][1]
    unrelated = ok(actor.post('/workspace/runs/' + report['id'] + '/reviews', json={
        'claim_id': other['id'], 'verdict': 'accepted', 'note': '独立解释的审阅限定说明'}))
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(None), unrelated['id']))
    current = impacts(actor, report, saved, rule)
    assert current[0]['state'] == 'unavailable'
    assert all(i['state'] == 'current' and not i['reasons'] for i in current[1:])
    ok(action(actor, dataset, source_ref=action_ref(saved)), 201)
