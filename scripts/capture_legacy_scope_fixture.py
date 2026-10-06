"""Capture authentic old API objects for the execution-scope regression.

Run with the repository's test Python, a clean a20a9c4 checkout, an empty
temporary data directory and an output JSON path. No saved object is rehashed.
Only synthetic business rows are exported; no authentication rows or keys.
"""
import argparse
import asyncio
import hashlib
import json
import socket
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

BASE = 'a20a9c45a846f6a5de94432420c6bcc56fed7b9f'
TABLES = ['datasets', 'dataset_revisions', 'conversations', 'workspace_objects',
          'copilot_messages', 'runs', 'messages', 'run_events', 'event_integrity',
          'adaptive_controls', 'adaptive_graphs', 'agent_artifacts',
          'adaptive_checkpoints', 'adaptive_calls']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source_tree', type=Path)
    parser.add_argument('data_dir', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    def git(*command):
        return subprocess.check_output(['git', *command], cwd=args.source_tree, text=True).strip()
    assert git('rev-parse', 'HEAD') == BASE
    assert not git('status', '--porcelain', '--untracked-files=no')
    assert not args.data_dir.exists()
    def forbidden(*unused, **kwargs):
        raise AssertionError('Network/listener prohibited')
    socket.socket.connect = socket.socket.connect_ex = forbidden
    socket.create_connection = socket.socket.bind = socket.socket.listen = forbidden
    sys.path.insert(0, str(args.source_tree.resolve()))
    from fastapi.testclient import TestClient
    from server.app import make_app
    from server.config import Settings
    from server.providers import Provider, ProviderService
    from server.security import COOKIE
    from server.adaptive_runtime import AdaptiveRun
    from server.studio import plan_fingerprint_valid, approved_run_valid
    class Providers(ProviderService):
        def __init__(self):
            super().__init__()
            self.providers = {'fixture': Provider('fixture', 'synthetic.invalid', '/never', 'fixture', 'NOT-A-REAL-KEY')}
            self.calls = 0
        async def complete(self, *args, **kwargs):
            self.calls += 1
            raise asyncio.CancelledError()
        async def propose(self, *args, **kwargs):
            raise AssertionError('No planner execution')
    providers = Providers()
    app = make_app(Settings(data_dir=args.data_dir, origin='http://testserver', max_queued_per_user=100), providers=providers, worker_enabled=False)
    cases = {}
    with TestClient(app, raise_server_exceptions=False) as client:
        login = client.post('/api/auth/register', json={'email': 'scope-history@test.example', 'password': 'Synthetic-only-password-2026', 'name': '测试研究员'})
        assert login.status_code == 201, login.text
        headers = {'X-CSRF-Token': login.json()['csrf'], 'Cookie': COOKIE + '=' + login.cookies[COOKIE]}
        def call(method, path, body=None, status=200):
            reply = client.request(method, '/api' + path, json=body, headers=headers)
            assert reply.status_code == status, (path, reply.status_code, reply.text)
            return reply.json()
        data = json.loads((args.source_tree / 'tests/fixtures/synthetic-financial.json').read_text())
        data.update(source_kind='user_provided', company='旧口径隔离合成企业')
        for row, period, revenue in zip(data['periods'], ['2023-Q4', '2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4', '2025-Q1'], [100, 110, 130, 200, 300, 500]):
            row.update(period=period, revenue=revenue, cost=revenue * .6, net_profit=revenue * .1, cash_flow=revenue * .2)
        dataset = call('POST', '/datasets', data, 201)
        def plan(query, engine='adaptive', **fields):
            return call('POST', '/workspace/plans', {'dataset_id': dataset['id'], 'query': query,
                **({'execution': {'parallelism': 1, 'local_recovery': False}} if engine == 'adaptive' else {}), **fields}, 201)
        def dispatch(p):
            return call('POST', '/workspace/plans/' + p['id'] + '/execute', {'version': p['version'], 'fingerprint': p['payload']['fingerprint'], 'external_consent': True}, 202)
        def remember(key, p, run=None, proposal=None):
            cases[key] = {'plan_id': p['id'], 'query': p['payload']['request']['query'],
                          'comparison': p['payload']['request']['comparison'], 'run_id': run['id'] if run else None,
                          'proposal_id': proposal['id'] if proposal else None}
            if run and run.get('result'):
                cases[key]['export_sha256'] = {}
                for kind in ('json', 'md'):
                    reply = client.get('/api/runs/' + run['id'] + '/export?format=' + kind, headers=headers)
                    assert reply.status_code == 200, reply.text
                    cases[key]['export_sha256'][kind] = hashlib.sha256(reply.content).hexdigest()
        queries = {'usd': '2024-Q4 USD revenue', 'eur': '2024-Q4 EUR revenue',
            'overview': '2024-Q4 USD overview', 'overview_evidence': '2024-Q4美元经营概览及证据',
            'qoq': '2024-Q4 QoQ revenue growth', 'qoq_space': '2024-Q4 quarter over quarter revenue growth',
            'qoq_hyphen': '2024-Q4 quarter-over-quarter revenue growth',
            'yoy': '2024-Q4 YoY revenue growth', 'yoy_space': '2024-Q4 year over year revenue growth',
            'yoy_hyphen': '2024-Q4 year-over-year revenue growth', 'both_comparisons': '2024-Q4 QoQ and YoY revenue growth',
            'cny': '2024-Q4人民币收入', 'cn_qoq': '2024-Q4收入环比', 'cn_yoy': '2024-Q4收入同比',
            'default': '2024-Q4经营概览', 'form_qoq': '2024-Q4 revenue', 'evidence': '查看美元欧元资料证据'}
        for key, query in queries.items():
            p = plan(query, **({'comparison': 'previous'} if key in ('form_qoq', 'yoy', 'yoy_hyphen') else {}))
            assert not p['payload']['blockers'], (key, p['payload']['blockers'])
            remember(key + '_draft', p)
        for engine in ('legacy', 'adaptive'):
            for key in ('usd', 'qoq', 'cny'):
                p = plan(queries[key], engine); run = dispatch(p)
                remember(key + '_' + engine + '_queued', p, run)
            for key in ('usd', 'qoq'):
                p = plan(queries[key], engine, use_llm=True, provider='fixture', max_calls=1)
                remember(key + '_' + engine + '_external_queued', p, dispatch(p))
            for key in ('usd', 'qoq'):
                p = plan(queries[key], engine); run = dispatch(p)
                client.portal.call(app.state.worker.execute, run['id'])
                done = call('GET', '/runs/' + run['id'])
                assert done['result'] and done['result']['analysis']['baseline_period'] == '2023-Q4'
                remember(key + '_' + engine + '_completed', p, done)
        def sourced(key, current, prior=None, edited=None, followup=False, state='draft'):
            t = call('POST', '/services/threads', {'dataset_id': dataset['id'], 'identity_id': ''}, 201)
            def message(text):
                current_thread = call('GET', '/services/threads/' + t['id'])['thread']
                return call('POST', '/services/threads/' + t['id'] + '/messages', {'text': text,
                    'version': current_thread['version'], 'request_id': 'message-' + str(current_thread['version'])}, 201)['message']
            if prior: message(prior)
            m = message(current)
            if followup: m = message('继续展开')
            p = call('POST', '/services/threads/' + t['id'] + '/proposals', {'kind': 'research',
                'text': edited or '', 'source_message_id': m['id'], 'include_thread_history': bool(prior),
                'request_id': 'proposal-history', 'execution': {'parallelism': 1, 'local_recovery': False}}, 201)
            preview = call('GET', '/workspace/plans/' + p['payload']['plan_id'])
            assert not preview['payload']['blockers'], (key, preview['payload']['blockers'])
            run = None
            if state != 'draft':
                result = call('POST', '/services/proposals/' + p['id'] + '/confirm', {'version': p['version'], 'fingerprint': p['payload']['fingerprint']})
                run = call('GET', '/runs/' + result['payload']['result']['run_id'])
                if state == 'completed':
                    client.portal.call(app.state.worker.execute, run['id'])
                    run = call('GET', '/runs/' + run['id']); assert run['result']
            remember(key, preview, run, p)
        sourced('source_usd_draft', queries['usd'])
        sourced('source_qoq_draft', queries['qoq'])
        sourced('source_history_draft', queries['cn_qoq'], prior='2024-Q4 USD revenue 同比')
        sourced('source_edited_cny_draft', queries['usd'], edited=queries['cn_qoq'])
        sourced('source_edited_usd_draft', queries['cn_qoq'], edited=queries['usd'])
        sourced('source_followup_draft', queries['cn_qoq'], followup=True)
        sourced('source_history_queued', queries['cn_qoq'], prior='2024-Q4 USD revenue 同比', state='queued')
        sourced('source_usd_queued', queries['usd'], state='queued')
        sourced('source_qoq_queued', queries['qoq'], state='queued')
        sourced('source_usd_completed', queries['usd'], state='completed')
        for key in ('usd', 'qoq', 'cny'):
            p = plan(queries[key]); run = dispatch(p)
            reached = threading.Event(); released = threading.Event(); original = AdaptiveRun.execute_node
            async def boundary(self, node):
                await original(self, node)
                if node['id'] == 'quality':
                    reached.set()
                    await asyncio.to_thread(released.wait, 10)
            AdaptiveRun.execute_node = boundary
            try:
                future = client.portal.start_task_soon(app.state.worker.execute, run['id'])
                assert reached.wait(10)
                call('POST', '/workspace/runs/' + run['id'] + '/control', {'action': 'pause', 'version': 1})
                released.set(); future.result(10)
            finally:
                released.set(); AdaptiveRun.execute_node = original
            paused = call('GET', '/runs/' + run['id']); assert paused['state'] == 'interrupted'
            remember(key + '_paused', p, paused)
        for state in ('paused', 'queued'):
            p = plan(queries['qoq'], use_llm=True, provider='fixture', max_calls=1)
            run = dispatch(p); app.state.worker.closing = True
            client.portal.call(app.state.worker.execute, run['id']); app.state.worker.closing = False
            interrupted = call('GET', '/runs/' + run['id']); assert interrupted['state'] == 'interrupted'
            if state == 'queued':
                control = call('GET', '/workspace/runs/' + run['id'] + '/runtime')['control']
                call('POST', '/workspace/runs/' + run['id'] + '/control', {'action': 'resume', 'version': control['version']})
                interrupted = call('GET', '/runs/' + run['id']); assert interrupted['state'] == 'queued'
            remember('qoq_unknown_' + state, p, interrupted)
        assert providers.calls == 2
        store = app.state.store
        for case in cases.values():
            saved = store.one('SELECT * FROM workspace_objects WHERE id=?', (case['plan_id'],))
            assert plan_fingerprint_valid(saved['payload']) and 'scope_query' not in saved['payload']
            if case['run_id']:
                assert approved_run_valid(store, store.one('SELECT * FROM runs WHERE id=?', (case['run_id'],)))
        result = {'source': {'commit': BASE, 'tree': git('rev-parse', 'HEAD^{tree}'),
            'captured_at': datetime.now(timezone.utc).isoformat(),
            'capture': 'Clean full old checkout; actual authenticated TestClient APIs and old workers; frozen rows unmodified; two cancellation-only provider stubs, no network or listeners.',
            'question_scope_sha256': hashlib.sha256((args.source_tree / 'server/question_scope.py').read_bytes()).hexdigest()},
            'cases': cases, 'tables': {table: [dict(row) for row in store.db.execute('SELECT * FROM ' + table)] for table in TABLES}}
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'cases': len(cases), 'output': str(args.output), 'bytes': args.output.stat().st_size, 'provider_stubs': providers.calls}))


if __name__ == '__main__':
    main()
