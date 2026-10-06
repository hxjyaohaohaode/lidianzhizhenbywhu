"""Model tools can reference sources omitted from base excerpt packing."""
import json
import tempfile
from pathlib import Path
import pytest
from source_binding_cases import Providers, Actor, ok
from fastapi.testclient import TestClient
from server.app import make_app
from server.config import Settings
from server.source_bindings import source_error

def exercise(resume):
    vendor = Providers(boundary=True)
    with tempfile.TemporaryDirectory(prefix='audit-packing-edge-') as tmp:
        settings = Settings(data_dir=Path(tmp), origin='http://testserver', production=False,
                            invite_code='', max_context_chars=6000)
        with TestClient(make_app(settings, providers=vendor, worker_enabled=False), raise_server_exceptions=False) as client:
            actor = Actor(client); store = client.app.state.store; dataset = actor.dataset()
            for index in range(6):
                ok(actor.post('/evidence', json={'title': f'隔离反证{index}',
                    'text': f'隔离编号{index}。' + '毛利率现金流营业收入成本需要原文核查。' * 40,
                    'company': dataset['payload']['company']}), 201)
            plan = ok(actor.post('/workspace/plans', json={'dataset_id': dataset['id'],
                'query': '核查反证毛利率现金流营业收入成本', 'mode': 'operational',
                'use_llm': True, 'provider': 'audit-stub', 'max_calls': 2,
                'execution': {'max_revisions': 0, 'parallelism': 1}}), 201)
            payload = plan['payload']; included = payload['packing']['included_citation_ids']
            citations = payload['snapshot']['citations']
            dropped = next(c for c in citations if c['id'] not in included)
            assert not any(c['id'] in included for c in citations if c['document_id'] == dropped['document_id'])
            review = store.one("SELECT * FROM workspace_objects WHERE kind='evidence_review' AND natural_key=?", (dropped['document_id'],))
            run = ok(actor.post('/workspace/plans/' + plan['id'] + '/execute', json={
                'version': plan['version'], 'fingerprint': payload['fingerprint'], 'external_consent': True}), 202)
            if resume:
                def pause(count):
                    if count == 1:
                        with store.transaction() as db:
                            db.execute("UPDATE adaptive_controls SET status='pause_requested' WHERE run_id=?", (run['id'],))
                vendor.on_call = pause
                paused = actor.execute(run)
                assert paused['state'] == 'interrupted' and len(vendor.calls) == 1
                vendor.on_call = None
            changed = ok(actor.put('/workspace/evidence/' + dropped['document_id'] + '/review', json={
                **review['payload'], 'version': review['version'], 'company': '另一家隔离企业'}))
            if resume:
                runtime = ok(actor.get('/workspace/runs/' + run['id'] + '/runtime'))
                ok(actor.post('/workspace/runs/' + run['id'] + '/control', json={
                    'version': runtime['control']['version'], 'action': 'resume'}))
            completed = actor.execute(run)
            captures = []
            for call in vendor.calls:
                context = call['context']
                counter = context.get('approved_tool_results', {}).get('counterevidence', {})
                captures.append({'evidence_ids': [c['id'] for c in context.get('evidence', [])],
                    'counterevidence': counter,
                    'dropped_id_sent': dropped['id'] in json.dumps(counter)})
            return {'stage': 'resume_after_first' if resume else 'after_approval',
                'snapshot_citations': len(citations), 'included_citations': len(included),
                'dropped_id': dropped['id'], 'review_version_before': review['version'],
                'source_without_packing': source_error(store, actor.user, payload['request'], payload['snapshot'], payload['bindings']),
                'stub_calls': len(vendor.calls), 'state': completed['state'],
                'snapshot_unchanged': completed['snapshot'] == run['snapshot'],
                'captures': captures}


@pytest.mark.parametrize('resume',[False,True],ids=['queued','resume-after-first'])
def test_packed_out_source_revocation_still_gates_counterevidence_tools(resume):
    result=exercise(resume)
    assert result['snapshot_citations']==6 and result['included_citations']<6
    assert result['stub_calls']==(1 if resume else 0),result
    assert result['snapshot_unchanged'] and result['source_without_packing'],result
    # The already approved, completed call can contain this tool reference;
    # withdrawal prevents the next send and never rewrites the earlier capture.
    if resume:assert result['captures'][0]['dropped_id_sent'],result
