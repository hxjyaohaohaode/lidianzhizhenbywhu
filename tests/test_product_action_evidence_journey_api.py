"""Real offline ASGI responses for L12 oracles; never native UI evidence.

Only declared API writes create the synthetic inputs, reviews and action.
The existing guard rejects app network/listener and supplier attempts.
"""
from copy import deepcopy
import hashlib
from types import SimpleNamespace

import pytest

from conftest import Actor
from in_process_oracle import offline_test_client
from scripts import product_action_evidence_journey as journey
from server.app import make_app
from server.config import Settings


def ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


@pytest.fixture
def case(tmp_path):
    with offline_test_client(lambda providers: make_app(
            Settings(data_dir=tmp_path, origin='http://testserver'),
            providers=providers, worker_enabled=False)) as (client, providers, attempts):
        mutations = []

        def record(request):
            if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
                mutations.append({'method': request.method, 'path': request.url.path})

        client.event_hooks['request'].append(record)
        yield SimpleNamespace(actor=Actor(client), providers=providers,
                              attempts=attempts, mutations=mutations)
        assert providers.calls == [] and attempts == []


def reviewed_catalog(actor):
    company = ok(actor.post('/evidence', json={
        'title': journey.COMPANY_TITLE, 'text': journey.COMPANY_TEXT,
        'company': journey.COMPANY, 'global_scope': False,
        'source_url': journey.COMPANY_URL, 'published_at': journey.PUBLISHED}), 201)
    review = ok(actor.put('/workspace/evidence/' + company['id'] + '/review', json={
        'version': 1, 'company': journey.COMPANY, 'global_scope': False,
        'status': 'accepted', 'stance': 'supports', 'note': journey.ORIGINAL_NOTE}))
    assert review['version'] == 2
    ok(actor.post('/evidence', json={
        'title': journey.GLOBAL_TITLE, 'text': journey.GLOBAL_TEXT,
        'company': '', 'global_scope': True,
        'source_url': journey.GLOBAL_URL, 'published_at': journey.PUBLISHED}), 201)
    return ok(actor.get('/workspace/evidence'))['items']


@pytest.mark.parametrize('texts', [
    pytest.param((journey.COMPANY_TEXT, journey.GLOBAL_TEXT), id='exact-native-texts'),
    pytest.param(('合成企业原文：包含"引号"和换行。\n第二段保留反斜线\\与中文，不代表真实企业事实。',
                  '合成通用原文：第一行写明"尚未审阅"。\n第二行仅为摘要契约测试，不表示独立核验。'),
                 id='quoted-multiline-chinese'),
])
def test_actual_catalog_uses_utf8_text_hash_and_rejects_json_string_hash(case, monkeypatch, texts):
    # Vary only the synthetic inputs. The unchanged native oracle still checks
    # full exact text, versions, source metadata, eligibility and complete review.
    monkeypatch.setattr(journey, 'COMPANY_TEXT', texts[0])
    monkeypatch.setattr(journey, 'GLOBAL_TEXT', texts[1])
    rows = reviewed_catalog(case.actor)
    journey.expect_catalog(rows)
    for index, row in enumerate(rows):
        text = row['payload']['text']
        raw_hash = hashlib.sha256(text.encode('utf-8')).hexdigest()
        json_string_hash = journey.canonical_hash(text)
        assert raw_hash != json_string_hash
        assert row['content_hash'] == raw_hash
        assert row['review_hash'] == journey.canonical_hash(row['review'])
        for wrong_hash in (json_string_hash, '0' * 64):
            damaged = deepcopy(rows)
            damaged[index]['content_hash'] = wrong_hash
            with pytest.raises(AssertionError):
                journey.expect_catalog(damaged)
        damaged = deepcopy(rows)
        damaged[index]['review_hash'] = raw_hash
        with pytest.raises(AssertionError):
            journey.expect_catalog(damaged)


def test_actual_api_completion_and_later_review_preserve_original_report_and_history(case):
    """Exercise downstream API contracts that the red native run never reached."""
    actor = case.actor
    assert ok(actor.get('/datasets'))['items'] == []
    assert ok(actor.get('/runs'))['items'] == []
    template = actor.get('/import/template')
    assert template.status_code == 200
    staged = ok(actor.post('/workspace/imports/file', data={
        'company': journey.COMPANY, 'amount_unit': 'yuan', 'basis': 'standalone_quarter',
        'target_id': '', 'target_version': '0', 'merge_mode': 'replace'}, files={
            'file': (journey.FILE_NAME, journey.fixture_csv(template.content), 'text/csv')}), 201)
    assert ok(actor.get('/datasets'))['items'] == []
    dataset = ok(actor.post('/workspace/imports/' + staged['id'] + '/commit', json={
        'version': staged['version'], 'fingerprint': staged['payload']['fingerprint']}), 201)
    assert dataset['version'] == 1 and dataset['payload']['company'] == journey.COMPANY
    assert dataset['content_hash'] == journey.canonical_hash(dataset['payload'])
    assert [(q['period'], q['revenue'], q['cost']) for q in dataset['payload']['periods']] == [
        ('2024-Q1', 100000, 80000), ('2024-Q2', 100000, 80000)]
    plan = ok(actor.post('/workspace/plans', json={'dataset_id': dataset['id'],
        'query': journey.QUESTION, 'use_llm': False, 'execution': {'depth': 'balanced'}}), 201)
    assert plan['payload']['max_calls'] == 0 and plan['payload']['request']['use_llm'] is False
    assert plan['payload']['snapshot']['dataset'] == dataset['payload']
    queued = ok(actor.post('/workspace/plans/' + plan['id'] + '/execute', json={
        'version': plan['version'], 'fingerprint': plan['payload']['fingerprint'],
        'external_consent': False}), 202)
    run = actor.execute(queued)
    assert run['state'] in ('succeeded', 'degraded') and run['payload']['query'] == journey.QUESTION
    assert run['snapshot']['dataset'] == dataset['payload']
    assert run['result']['dataset_hash'] == dataset['content_hash']
    assert run['result']['llm']['state'] == 'not_requested' and run['result']['llm']['calls'] == []
    facts = run['result']['readout']['facts']
    assert len(facts) == 1 and facts[0]['id'] == 'gross_margin' and facts[0]['value'] == .2
    assert facts[0]['period'] == '2024-Q1' and run['result']['citations'] == []
    action = ok(actor.post('/workspace/actions', json={
        'title': journey.ACTION_TITLE, 'acceptance': journey.ACCEPTANCE,
        'dataset_id': dataset['id'], 'run_id': run['id'],
        'source_ref': {'kind': 'report', 'run_id': run['id']}}), 201)
    assert action['version'] == 1 and action['payload']['status'] == 'open'
    assert action['payload']['company'] == journey.COMPANY
    assert action['payload']['run_id'] == run['id'] and action['payload']['dataset_id'] == dataset['id']
    active = ok(actor.put('/workspace/actions/' + action['id'] + '/status', json={
        'version': 1, 'status': 'in_progress', 'note': journey.START_NOTE}))
    assert active['version'] == 2 and active['payload']['history'][-1]['evidence_snapshots'] == []
    company, global_doc = journey.expect_catalog(reviewed_catalog(actor))
    completed = ok(actor.put('/workspace/actions/' + action['id'] + '/status', json={
        'version': 2, 'status': 'done', 'note': journey.DONE_NOTE,
        'evidence_ids': [company['id']],
        'evidence_refs': [{key: company[key] for key in journey.REF_FIELDS}]}))
    journey.expect_completed(completed, active, company)
    assert ok(actor.get('/workspace/actions'))['items'] == [completed]
    ok(actor.put('/workspace/evidence/' + company['id'] + '/review', json={
        'version': company['review_version'], **company['review'],
        'stance': 'contradicts', 'note': journey.LATER_NOTE}))
    revised, unchanged_global = journey.expect_catalog(
        ok(actor.get('/workspace/evidence'))['items'], later=True)
    assert unchanged_global == global_doc
    current = ok(actor.get('/workspace/actions'))['items']
    assert len(current) == 1
    journey.expect_preserved_history(current[0], completed, company, revised)
    reread = ok(actor.get('/runs/' + run['id']))
    assert reread['result'] == run['result'] and reread['snapshot'] == run['snapshot']
    assert ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))['report_integrity']['valid']
    assert ok(actor.get('/datasets'))['items'] == [dataset]
    assert len(ok(actor.get('/runs'))['items']) == len(ok(actor.get('/workspace/plans'))['items']) == 1
    journey.expect_mutations(case.mutations, stage_id=staged['id'], plan_id=plan['id'],
                             action_id=action['id'], evidence_id=company['id'])
    assert case.providers.calls == [] and case.attempts == []
