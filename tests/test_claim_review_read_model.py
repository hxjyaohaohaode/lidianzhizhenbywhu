"""Synthetic current-review route checks; no browser, provider network or repair job."""
from copy import deepcopy

import pytest
from starlette.responses import JSONResponse

from conftest import Actor
from server import workspace_store as ws
from server.store import encode
from test_business_provenance import ok
from test_provenance_eligibility import claim_chain
from test_workspace_api import StudioProvider, execute, plan


def saved_review(actor, report, **changes):
    return ok(actor.post('/workspace/runs/' + report['id'] + '/reviews', json={
        'claim_id': report['result']['llm']['review']['claims'][0]['id'],
        'verdict': 'accepted', 'note': '隔离合成的原始人工核对依据', **changes}))


def setup_review(factory):
    actor = Actor(factory(providers=StudioProvider())); dataset = actor.dataset()
    report = execute(actor, plan(actor, dataset, use_llm=True), True)
    review = saved_review(actor, report)
    review = saved_review(actor, report, version=review['version'], note='第二次隔离合成人工复核依据')
    return actor, dataset, report, review


def corrupt(actor, review, value, *, raw=False, key=None, version=None):
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=?,natural_key=?,version=? WHERE id=?',
            (value if raw else encode(value), key or review['natural_key'],
             review['version'] if version is None else version, review['id']))


def review_url(report):
    return '/workspace/runs/' + report['id'] + '/reviews'


def test_healthy_response_bytes_and_ordinary_re_review_remain_compatible(factory):
    actor, dataset, report, review = setup_review(factory); store = actor.client.app.state.store
    before = store.db.total_changes
    response = actor.get(review_url(report))
    assert response.status_code == 200
    assert response.content == JSONResponse({'items': [review]}).body
    assert store.db.total_changes == before
    updated = saved_review(actor, report, version=review['version'], verdict='needs_evidence')
    assert updated['id'] == review['id'] and updated['version'] == review['version'] + 1
    assert actor.get(review_url(report)).content == JSONResponse({'items': [updated]}).body
    assert store.owned('runs', actor.user['id'], report['id']) == report


@pytest.mark.parametrize('value', [None, [], 'broken', 42, True, {},
    {'verdict': 'accepted', 'note': '缺少绑定但保留的损坏内容'},
    {'note': 0}, {'verdict': 'unknown'}], ids=['null', 'list', 'string', 'number',
        'boolean', 'empty-object', 'missing-bindings', 'invalid-note', 'invalid-verdict'])
def test_malformed_json_values_are_visible_and_use_the_actual_revision(factory, value):
    actor, dataset, report, review = setup_review(factory); store = actor.client.app.state.store
    if isinstance(value, dict) and set(value) <= {'note', 'verdict'} and len(value) == 1:
        value = {**review['payload'], **value}
    corrupt(actor, review, value)
    before = store.db.total_changes
    response = ok(actor.get(review_url(report)))
    assert response['items'] == [] and len(response['unavailable']) == 1
    missing = response['unavailable'][0]
    assert missing == {'id': review['id'], 'version': review['version'],
        'claim_id': review['payload']['claim_id'], 'target_claim_id': review['payload']['claim_id'],
        'candidate_claim_ids': [], 'reason_code': 'invalid_payload', 'association': 'natural_key',
        'reason': '已有审阅记录无法核验；原结论与依据不可用，可明确提交新的人工复核',
        'can_rereview': True}
    assert 'payload' not in missing and 'verdict' not in missing and 'note' not in missing
    audit = ok(actor.get('/workspace/runs/' + report['id'] + '/audit'))
    assert audit['source_impact']['state'] == 'unavailable'
    assert audit['report_integrity']['valid']
    assert store.db.total_changes == before
    assert store.owned('runs', actor.user['id'], report['id']) == report
    request = {'claim_id': missing['claim_id'], 'verdict': 'needs_evidence', 'note': '明确重新核查后记录新的依据'}
    assert actor.post(review_url(report), json={**request, 'version': 0}).status_code == 409
    assert store.db.total_changes == before
    updated = ok(actor.post(review_url(report), json={**request, 'version': missing['version']}))
    assert updated['id'] == missing['id'] and updated['version'] == missing['version'] + 1
    assert updated['payload'] == {'run_id': report['id'], **request}
    assert actor.get(review_url(report)).content == JSONResponse({'items': [updated]}).body
    assert store.owned('runs', actor.user['id'], report['id']) == report
    assert actor.post(review_url(report), json={**request, 'version': missing['version']}).status_code == 409
    history = store.all("SELECT action,metadata FROM audit WHERE user_id=? AND resource='claim_review' AND resource_id=? ORDER BY seq", (actor.user['id'], review['id']))
    assert history[-1] == {'action': 'updated', 'metadata': {'version': updated['version']}}


@pytest.mark.parametrize('case', ['wrong-run', 'wrong-claim', 'wrong-key', 'unknown-claim', 'invalid-version', 'invalid-json'])
def test_ambiguous_or_unusable_rows_have_no_fabricated_prior_review(factory, case):
    actor, dataset, report, review = setup_review(factory); store = actor.client.app.state.store
    value = deepcopy(review['payload']); key = None; version = None
    if case == 'wrong-run': value['run_id'] = 'unrelated-private-report'
    if case == 'wrong-claim': value['claim_id'] = 'unrelated-private-claim'
    if case == 'wrong-key': key = 'unrelated-private-report:unrelated-private-claim'
    if case == 'unknown-claim':
        value['claim_id'] = 'nonexistent-claim'; key = report['id'] + ':nonexistent-claim'
    if case == 'invalid-version': version = -1
    if case == 'invalid-json': value = '{invalid-json-secret'
    corrupt(actor, review, value, key=key, version=version, raw=case == 'invalid-json')
    before = store.db.total_changes
    response = ok(actor.get(review_url(report)))
    assert response['items'] == [] and len(response['unavailable']) == 1
    missing = response['unavailable'][0]
    assert missing['id'] == review['id'] and missing['version'] == (version or review['version'])
    assert not missing['can_rereview']
    if case not in {'invalid-version', 'invalid-json'}:
        assert missing['claim_id'] is None and missing['association'] == 'unverified'
    assert all(value not in str(response) for value in ['unrelated-private', 'nonexistent-claim', 'invalid-json-secret'])
    assert store.db.total_changes == before
    assert store.owned('runs', actor.user['id'], report['id']) == report


def test_owner_unrelated_report_and_deleted_parent_isolation(factory):
    actor, dataset, report, review = setup_review(factory); store = actor.client.app.state.store
    other = execute(actor, plan(actor, dataset, use_llm=True), True); other_review = saved_review(actor, other)
    foreign = Actor(actor.client); foreign_data = foreign.dataset()
    foreign_report = execute(foreign, plan(foreign, foreign_data, use_llm=True), True)
    foreign_review = saved_review(foreign, foreign_report)
    # Both saved bindings forged toward this report still grant no owner access.
    corrupt(foreign, foreign_review, {**foreign_review['payload'], 'run_id': report['id']},
        key=report['id'] + ':' + foreign_review['payload']['claim_id'])
    corrupt(actor, review, None)
    before = store.db.total_changes
    assert [r['id'] for r in ok(actor.get(review_url(report)))['unavailable']] == [review['id']]
    assert actor.get(review_url(other)).content == JSONResponse({'items': [other_review]}).body
    assert foreign.get(review_url(report)).status_code == 404
    assert foreign.post(review_url(report), json={'claim_id': review['payload']['claim_id'],
        'version': review['version'], 'verdict': 'accepted', 'note': '不能越过账户拥有权'}).status_code == 404
    assert actor.get(review_url(foreign_report)).status_code == 404
    assert store.db.total_changes == before
    # Simulate legacy orphan history; the live endpoint may not revive it.
    with store.transaction() as db: db.execute('DELETE FROM runs WHERE id=?', (report['id'],))
    before = store.db.total_changes
    assert actor.get(review_url(report)).status_code == 404
    assert actor.post(review_url(report), json={'claim_id': review['payload']['claim_id'],
        'version': review['version'], 'verdict': 'accepted', 'note': '已删除报告不能重新审阅'}).status_code == 404
    assert actor.get(review_url(other)).content == JSONResponse({'items': [other_review]}).body
    assert store.db.total_changes == before


def test_explicit_re_review_preserves_frozen_report_action_watch_and_source_fingerprints(factory):
    actor, dataset, report, review, action, watch = claim_chain(factory)
    store = actor.client.app.state.store
    original_action = ws.get(store, actor.user['id'], 'action', action['id'])
    original_watch = ws.get(store, actor.user['id'], 'watch', watch['id'])
    corrupt(actor, review, None)
    missing = ok(actor.get(review_url(report)))['unavailable'][0]
    updated = saved_review(actor, report, version=missing['version'], verdict='needs_evidence', note='人工重新核查后的新结论与依据')
    assert updated['version'] == review['version'] + 1
    assert store.owned('runs', actor.user['id'], report['id']) == report
    assert ws.get(store, actor.user['id'], 'action', action['id']) == original_action
    assert ws.get(store, actor.user['id'], 'watch', watch['id']) == original_watch
    source = ok(actor.get('/workspace/actions'))['items'][0]['source_impact']
    assert source['state'] == 'changed'
    assert 'claim_review_changed' in {r['code'] for r in source['reasons']}


def test_conflicting_second_review_cannot_block_healthy_first_claim(factory):
    actor, dataset, report, first = setup_review(factory); store = actor.client.app.state.store
    second_claim = report['result']['llm']['review']['claims'][1]['id']
    second = saved_review(actor, report, claim_id=second_claim)
    corrupt(actor, second, {**second['payload'], 'claim_id': first['payload']['claim_id']})
    before = store.db.total_changes
    response = ok(actor.get(review_url(report)))
    assert response['items'] == [first]
    bad = response['unavailable'][0]
    assert bad['id'] == second['id'] and bad['claim_id'] is None
    assert bad['target_claim_id'] == second_claim and not bad['can_rereview']
    assert bad['reason_code'] == 'ambiguous_association'
    assert store.db.total_changes == before
    second_before = ws.get(store, actor.user['id'], 'claim_review', second['id'])
    updated = saved_review(actor, report, version=first['version'], note='第一条独立解释可以正常再次复核')
    assert updated['id'] == first['id'] and updated['version'] == first['version'] + 1
    assert ws.get(store, actor.user['id'], 'claim_review', second['id']) == second_before
    assert store.owned('runs', actor.user['id'], report['id']) == report


def test_conflict_candidates_keep_an_unreviewed_claim_from_looking_new(factory):
    actor = Actor(factory(providers=StudioProvider())); dataset = actor.dataset()
    report = execute(actor, plan(actor, dataset, use_llm=True), True)
    first_claim, second_claim = [c['id'] for c in report['result']['llm']['review']['claims'][:2]]
    second = saved_review(actor, report, claim_id=second_claim)
    corrupt(actor, second, {**second['payload'], 'claim_id': first_claim})
    store = actor.client.app.state.store; before = store.db.total_changes
    response = ok(actor.get(review_url(report))); bad = response['unavailable'][0]
    assert response['items'] == []
    assert bad['claim_id'] is None and bad['target_claim_id'] == second_claim
    assert bad['candidate_claim_ids'] == [first_claim] and not bad['can_rereview']
    assert store.db.total_changes == before
    # An independent correctly keyed review still remains independently usable.
    first = saved_review(actor, report)
    response = ok(actor.get(review_url(report)))
    assert response['items'] == [first] and response['unavailable'][0] == bad
    updated = saved_review(actor, report, version=first['version'], note='独立绑定的第一条仍可明确更新')
    assert updated['id'] == first['id'] and updated['version'] == first['version'] + 1
    assert store.owned('runs', actor.user['id'], report['id']) == report


def test_safe_integer_cap_keeps_trusted_content_readable_and_rejects_all_further_writes(factory):
    from server.schemas import MAX_SAFE_INTEGER
    actor, dataset, report, review = setup_review(factory); store = actor.client.app.state.store
    corrupt(actor, review, review['payload'], version=MAX_SAFE_INTEGER)
    stored = ws.get(store, actor.user['id'], 'claim_review', review['id'])
    foreign = Actor(actor.client); before = store.db.total_changes
    response = ok(actor.get(review_url(report)))
    assert response['items'] == [stored] and 'unavailable' not in response
    assert response['read_only'] == [{'id': review['id'], 'version': MAX_SAFE_INTEGER,
        'claim_id': review['payload']['claim_id'], 'reason_code': 'version_limit',
        'reason': '审阅版本计数已达上限；已有结论与依据仍可查看，当前记录只读，不能再次提交复核'}]
    assert response['items'][0]['payload'] == review['payload']
    assert ok(actor.get('/workspace/runs/' + report['id'] + '/audit'))['source_impact']['state'] == 'current'
    request = {k: v for k, v in review['payload'].items() if k != 'run_id'}
    conflict = actor.post(review_url(report), json={**request, 'version': MAX_SAFE_INTEGER - 1})
    assert conflict.status_code == 409 and conflict.json()['error']['code'] == 'VERSION_CONFLICT'
    capped = actor.post(review_url(report), json={**request, 'version': MAX_SAFE_INTEGER})
    assert capped.status_code == 409 and capped.json()['error']['code'] == 'VERSION_LIMIT'
    assert foreign.post(review_url(report), json={**request, 'version': MAX_SAFE_INTEGER}).status_code == 404
    assert actor.post(review_url(report), json={**request, 'claim_id': 'no-such-claim', 'version': MAX_SAFE_INTEGER}).status_code == 404
    assert store.db.total_changes == before
    assert ws.get(store, actor.user['id'], 'claim_review', review['id']) == stored
    assert store.owned('runs', actor.user['id'], report['id']) == report


def test_concurrent_last_safe_revision_has_one_winner_and_never_overflows(factory):
    from concurrent.futures import ThreadPoolExecutor
    from server.schemas import MAX_SAFE_INTEGER
    actor, dataset, report, review = setup_review(factory); store = actor.client.app.state.store
    corrupt(actor, review, review['payload'], version=MAX_SAFE_INTEGER - 1)
    request = {k: v for k, v in review['payload'].items() if k != 'run_id'}
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda _: actor.post(review_url(report),
            json={**request, 'version': MAX_SAFE_INTEGER - 1}), range(8)))
    assert sum(r.status_code == 200 for r in responses) == 1
    assert sum(r.status_code == 409 and r.json()['error']['code'] == 'VERSION_CONFLICT' for r in responses) == 7
    stored = ws.get(store, actor.user['id'], 'claim_review', review['id'])
    assert stored['version'] == MAX_SAFE_INTEGER and stored['payload'] == review['payload']
    before = store.db.total_changes
    blocked = actor.post(review_url(report), json={**request, 'version': MAX_SAFE_INTEGER})
    assert blocked.status_code == 409 and blocked.json()['error']['code'] == 'VERSION_LIMIT'
    assert store.db.total_changes == before
    assert store.owned('runs', actor.user['id'], report['id']) == report


def test_existing_zero_version_is_not_repaired_but_empty_zero_slot_can_be_created(factory):
    actor, dataset, report, review = setup_review(factory); store = actor.client.app.state.store
    corrupt(actor, review, review['payload'], version=0)
    stored = ws.get(store, actor.user['id'], 'claim_review', review['id'])
    before = store.db.total_changes
    response = ok(actor.get(review_url(report)))
    bad = response['unavailable'][0]
    assert response['items'] == [] and bad['version'] == 0
    assert bad['reason_code'] == 'invalid_version' and not bad['can_rereview']
    request = {k: v for k, v in review['payload'].items() if k != 'run_id'}
    stale = actor.post(review_url(report), json={**request, 'version': 1})
    assert stale.status_code == 409 and stale.json()['error']['code'] == 'VERSION_CONFLICT'
    blocked = actor.post(review_url(report), json={**request, 'version': 0})
    assert blocked.status_code == 409 and blocked.json()['error']['code'] == 'INVALID_VERSION'
    assert store.db.total_changes == before
    assert ws.get(store, actor.user['id'], 'claim_review', review['id']) == stored
    assert store.owned('runs', actor.user['id'], report['id']) == report
    second_claim = report['result']['llm']['review']['claims'][1]['id']
    fresh = saved_review(actor, report, claim_id=second_claim, version=0)
    assert fresh['version'] == 1 and fresh['natural_key'] == report['id'] + ':' + second_claim
    assert ws.get(store, actor.user['id'], 'claim_review', review['id']) == stored
    assert store.owned('runs', actor.user['id'], report['id']) == report
