"""Structured evidence URL minimization; synthetic API/provider-double tests only.

These tests do not promise general text/secret DLP: explicit approved free text
remains unchanged. Every provider call below is a local capture, never a network
request, and legacy contexts are produced before their approval fingerprint.
"""
from __future__ import annotations
import copy
import json
from types import SimpleNamespace
import pytest
from conftest import Actor
from server import studio, adaptive_runtime
from server.adaptive_runtime import AdaptiveRun
from server.model_context import provider_context
from server.store import digest, encode, now

ORIGINAL = 'https://fixture-user:SYNTHETIC_PASSWORD@evidence.example/report?signature=SYNTHETIC_SIGNED_QUERY#SYNTHETIC_FRAGMENT'
DISPLAY = 'https://evidence.example/current?token=SYNTHETIC_DISPLAY_TOKEN'
CORRECTED = 'https://evidence.example/corrected'
MARKERS = ('SYNTHETIC_PASSWORD', 'SYNTHETIC_SIGNED_QUERY', 'SYNTHETIC_FRAGMENT', 'SYNTHETIC_DISPLAY_TOKEN')


class CaptureProviders:
    """Small provider protocol with no transport or environment credentials."""
    def __init__(self, *, revision=False):
        self.provider = SimpleNamespace(id='metadata-test', model='test-only', host='synthetic.invalid', path='/never-requested')
        self.calls = []; self.revision = revision; self.on_call = None

    def select(self, id=''):
        return self.provider if id in ('', self.provider.id) else None

    def status(self):
        return [{'id': self.provider.id, 'model': self.provider.model, 'configured': True,
                 'connectivity': 'isolated_provider_double'}]

    async def complete(self, p, system, context):
        obj = json.loads(context)
        role = ('revision_1' if 'structural_rejections' in obj else
                'challenger' if 'prior_hypotheses' in obj else
                'researcher' if '外部资料的适用性' in system or '核查外部资料' in system else 'analyst')
        self.capture(p, role, context)
        claims = ([{'text': '隔离测试结构无效解释', 'metric_ids': ['invented_metric']}]
                  if self.revision and role != 'revision_1' else [])
        return {'output': {'claims': claims, 'missing': []}, 'provider': p.id,
                'model': p.model, 'usage': {'total_tokens': 0}}

    async def propose(self, p, context):
        self.capture(p, 'planner', context)
        return {'output': {'focus': ['evidence', 'counterevidence'],
                           'specialists': ['analyst', 'researcher', 'challenger'],
                           'rationale': '隔离测试保留已批准的职责'}, 'usage': {'total_tokens': 0}}

    def capture(self, provider, role, raw):
        # Projection must not change the approved recipient or endpoint.
        assert provider is self.provider
        assert (provider.host, provider.path) == ('synthetic.invalid', '/never-requested')
        self.calls.append({'role': role, 'raw': raw, 'context': json.loads(raw)})
        if self.on_call:
            self.on_call()


def good(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def seeded(actor):
    dataset = actor.dataset(); documents = []
    for index, url in enumerate((ORIGINAL, DISPLAY)):
        documents.append(good(actor.post('/evidence', json={
            'title': f'隔离测试原文{index}', 'text': f'隔离测试原文{index}。毛利率现金流营业收入成本需要原文核查。' * 5,
            'company': dataset['payload']['company'], 'source_url': url}), 201))
    edited = good(actor.put('/evidence/' + documents[0]['id'] + '/metadata', json={
        'version': documents[0]['version'], 'title': '已更正展示地址的隔离测试资料', 'source_url': CORRECTED}))
    assert edited['payload']['original_source_url'] == ORIGINAL
    assert edited['payload']['source_url'] == CORRECTED
    return dataset


def preview(actor, dataset, adaptive, **options):
    body = {'dataset_id': dataset['id'], 'query': '核查毛利率现金流营业收入成本',
            'mode': 'deep_dive', 'use_llm': True, 'provider': 'metadata-test',
            'max_calls': 8 if adaptive else 3, **options}
    if adaptive:
        body.setdefault('execution', {'model_planning': True, 'max_revisions': 1, 'depth': 'deep'})
    return good(actor.post('/workspace/plans', json=body), 201)


def dispatch(actor, plan):
    return good(actor.post('/workspace/plans/' + plan['id'] + '/execute', json={
        'version': plan['version'], 'fingerprint': plan['payload']['fingerprint'], 'external_consent': True}), 202)


def assert_captures(actor, run, providers, *, historical_calls=0):
    events = [e['payload'] for e in good(actor.get('/runs/' + run['id'] + '/trace'))['items']
              if e['type'] == 'external_dispatch']
    assert len(events) == len(providers.calls)
    for index, call in enumerate(providers.calls):
        # Search the entire final serialized prompt, not just its evidence list:
        # appended adaptive tool projections must not reintroduce metadata URLs.
        if index >= historical_calls:
            assert all(marker not in call['raw'] for marker in MARKERS)
            assert all('source_url' not in e and 'original_source_url' not in e
                       for e in call['context'].get('evidence', []))
        entry = next(e for e in events if e['agent'] == call['role'])
        assert entry['request_hash'] == digest(call['raw'])
        assert entry['characters'] == len(call['raw'])
        assert entry['provider'] == 'metadata-test' and entry['model'] == 'test-only'
        if call['role'] == 'planner':
            assert 'evidence' not in call['context']
        else:
            assert len(call['context']['evidence']) == 2
            assert all(e['excerpt'] and e['source_kind'] == 'user_provided' for e in call['context']['evidence'])
    audit = good(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    assert audit['ledger']['valid']


def test_projection_is_nonmutating_and_does_not_rewrite_approved_text():
    original = {'question': DISPLAY, 'history': [{'text': ORIGINAL}],
                'evidence': [{'id': 'citation', 'excerpt': ORIGINAL, 'source_url': DISPLAY,
                              'original_source_url': ORIGINAL, 'source_kind': 'user_provided'}]}
    frozen = copy.deepcopy(original)
    result = provider_context(original)
    assert original == frozen and result is not original
    assert result['evidence'][0] is not original['evidence'][0]
    assert result['evidence'] == [{'id': 'citation', 'excerpt': ORIGINAL, 'source_kind': 'user_provided'}]
    assert result['question'] == DISPLAY and result['history'] == original['history']
    assert provider_context({'question': 'planner'}) == {'question': 'planner'}


@pytest.mark.parametrize('adaptive', [False, True], ids=['ordinary', 'adaptive'])
@pytest.mark.parametrize('saved_stage', ['fresh', 'legacy_draft', 'legacy_queued'])
def test_source_metadata_stays_local_for_new_and_saved_plans(factory, monkeypatch, adaptive, saved_stage):
    providers = CaptureProviders(revision=adaptive); actor = Actor(factory(providers))
    dataset = seeded(actor)
    # Reproduce an old packer before fingerprinting. No persisted object, hash,
    # ownership binding or approval record is rewritten to manufacture a pass.
    with monkeypatch.context() as old:
        if saved_stage != 'fresh':
            old.setattr(studio, 'provider_context', copy.deepcopy)
        plan = preview(actor, dataset, adaptive)
        assert not plan['payload']['blockers']
        packed = plan['payload']['context']['evidence']
        assert all(('source_url' in item) == (saved_stage != 'fresh') for item in packed)
        denied = actor.post('/workspace/plans/' + plan['id'] + '/execute', json={
            'version': plan['version'], 'fingerprint': plan['payload']['fingerprint'], 'external_consent': False})
        assert denied.status_code == 403 and providers.calls == []
        queued = dispatch(actor, plan) if saved_stage == 'legacy_queued' else None
    if saved_stage == 'fresh':
        assert '地址元数据保留本地' in ''.join(plan['payload']['consent_scope'])
    # No packing should occur after saving, including a legacy draft's dispatch.
    monkeypatch.setattr(studio, 'pack_context', lambda *a, **k: pytest.fail('Saved run was silently repacked'))
    run = queued or dispatch(actor, plan); frozen = copy.deepcopy(run['snapshot'])
    result = actor.execute(run)
    assert result['state'] == 'succeeded', result
    assert result['snapshot'] == frozen
    saved = good(actor.get('/workspace/plans/' + plan['id']))['payload']
    assert saved['context'] == plan['payload']['context'] and saved['snapshot'] == plan['payload']['snapshot']
    assert saved['fingerprint'] == plan['payload']['fingerprint'] and studio.plan_fingerprint_valid(saved)
    assert_captures(actor, run, providers)
    roles = {call['role'] for call in providers.calls}
    assert roles == ({'planner', 'analyst', 'researcher', 'challenger', 'revision_1'} if adaptive
                     else {'analyst', 'researcher', 'challenger'})
    exported = good(actor.get('/runs/' + run['id'] + '/export?format=json'))
    citation = next(c for c in exported['citations'] if c['url'] == CORRECTED)
    assert citation['original_source_url'] == ORIGINAL
    assert any(c['url'] == DISPLAY for c in exported['citations'])
    count = len(providers.calls)
    actor.execute(run)
    assert len(providers.calls) == count  # Completed calls are not sent again.


def test_legacy_paused_run_resumes_with_projected_context_without_rebilling(factory, monkeypatch):
    providers = CaptureProviders(); actor = Actor(factory(providers)); dataset = seeded(actor)
    with monkeypatch.context() as old:
        old.setattr(studio, 'provider_context', copy.deepcopy)
        plan = preview(actor, dataset, True, max_calls=2,
                       execution={'max_revisions': 0, 'parallelism': 1})
        run = dispatch(actor, plan)
    frozen = copy.deepcopy(run['snapshot']); store = actor.client.app.state.store
    def pause_after_first():
        if len(providers.calls) == 1:
            with store.transaction() as db:
                db.execute("UPDATE adaptive_controls SET status='pause_requested',version=version+1 WHERE run_id=?", (run['id'],))
    providers.on_call = pause_after_first
    # Simulate the completed pre-upgrade send with a provider double only. Its
    # original request hash/checkpoint must remain valid after the projection changes.
    with monkeypatch.context() as old:
        old.setattr(adaptive_runtime, 'provider_context', copy.deepcopy)
        first = actor.execute(run)
    assert first['state'] == 'interrupted' and len(providers.calls) == 1
    assert all(marker in providers.calls[0]['raw'] for marker in MARKERS)
    runtime = good(actor.get('/workspace/runs/' + run['id'] + '/runtime'))
    good(actor.post('/workspace/runs/' + run['id'] + '/control', json={
        'version': runtime['control']['version'], 'action': 'resume'}))
    result = actor.execute(run)
    assert result['state'] == 'succeeded' and len(providers.calls) == 2
    assert result['snapshot'] == frozen
    assert 'analyst' in result['result']['adaptive']['reflection']['restored_nodes']
    assert_captures(actor, run, providers, historical_calls=1)


def test_legacy_unknown_dispatch_is_not_retried_after_projection_change(factory, monkeypatch):
    providers = CaptureProviders(); actor = Actor(factory(providers)); dataset = seeded(actor)
    with monkeypatch.context() as old:
        old.setattr(studio, 'provider_context', copy.deepcopy)
        plan = preview(actor, dataset, True, max_calls=1, execution={'max_revisions': 0})
        run = dispatch(actor, plan)
    store = actor.client.app.state.store; worker = actor.client.app.state.worker
    with store.transaction() as db:
        db.execute("UPDATE runs SET state='running' WHERE id=?", (run['id'],))
    async def interrupted_send():
        runner = AdaptiveRun(worker, run['id'])
        for cap in ('quality', 'quant', 'evidence'):
            await runner.execute_node(next(n for n in runner.graph['nodes'] if n['id'] == cap))
        node = next(n for n in runner.graph['nodes'] if n['id'] == 'analyst')
        with store.transaction() as db:
            db.execute('INSERT INTO adaptive_checkpoints VALUES(?,?,?,?,?,NULL,?,NULL)',
                       (run['id'], 'analyst', 'analyst', 'running', digest({'snapshot': digest(runner.s), 'node': node}), now()))
        # Synthetic historical reservation with old URL metadata; no actual send.
        call, error = runner.reserve_call(node, runner.graph['provider_bindings']['analyst'],
                                         encode(runner.st['context']), {'memory_ids': [], 'citation_ids': []})
        assert call and not error
        with store.transaction() as db:
            db.execute("UPDATE runs SET state='interrupted' WHERE id=?", (run['id'],))
    actor.client.portal.call(interrupted_send)
    runtime = good(actor.get('/workspace/runs/' + run['id'] + '/runtime'))
    good(actor.post('/workspace/runs/' + run['id'] + '/control', json={
        'version': runtime['control']['version'], 'action': 'resume'}))
    result = actor.execute(run)
    assert result['state'] == 'degraded' and providers.calls == []
    runtime = good(actor.get('/workspace/runs/' + run['id'] + '/runtime'))
    assert len(runtime['calls']) == 1 and runtime['calls'][0]['state'] == 'unknown'
    assert result['snapshot'] == run['snapshot']


def test_projection_preserves_adaptive_budget_gate(factory, monkeypatch):
    providers = CaptureProviders(); actor = Actor(factory(providers)); dataset = seeded(actor)
    with monkeypatch.context() as old:
        old.setattr(studio, 'provider_context', copy.deepcopy)
        plan = preview(actor, dataset, True, max_calls=2, query='核查毛利率现金流营业收入成本' + '需核对原报表。' * 210,
                       execution={'total_context_chars': 2000})
        run = dispatch(actor, plan)
    result = actor.execute(run)
    assert result['result'] and providers.calls == []
    runtime = good(actor.get('/workspace/runs/' + run['id'] + '/runtime'))
    assert runtime['usage']['attempts'] == 0
