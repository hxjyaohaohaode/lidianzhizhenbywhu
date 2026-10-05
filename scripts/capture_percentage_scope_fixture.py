"""Capture unmodified old-version plans via authenticated, isolated local APIs.

Requires a clean 80defc9 checkout and a nonexistent data directory. Only synthetic
business rows are exported; auth data and credentials are excluded. No sockets.
"""
import argparse
import hashlib
import json
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE = '80defc9b54159155000ac7564fbdd1247c0f0403'
TABLES = ['datasets', 'dataset_revisions', 'conversations', 'workspace_objects',
          'copilot_messages', 'runs', 'messages', 'run_events', 'event_integrity',
          'adaptive_controls', 'adaptive_graphs', 'agent_artifacts',
          'adaptive_checkpoints', 'adaptive_calls']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source_tree', type=Path)
    parser.add_argument('data_dir', type=Path)
    parser.add_argument('output', type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--word-order-only', action='store_true')
    mode.add_argument('--bare-percent-only', action='store_true')
    args = parser.parse_args()
    def git(*command):
        return subprocess.check_output(['git', *command], cwd=args.source_tree, text=True).strip()
    assert git('rev-parse', 'HEAD') == BASE
    assert not git('status', '--porcelain', '--untracked-files=no')
    assert not args.data_dir.exists()
    def forbidden(*unused, **kwargs):
        raise AssertionError('Network/listener prohibited')
    socket.socket.connect = socket.socket.connect_ex = socket.create_connection = forbidden
    socket.socket.bind = socket.socket.listen = forbidden
    sys.path[:0] = [str(args.source_tree.resolve()), str(args.source_tree.resolve() / 'tests')]
    from fastapi.testclient import TestClient
    from server.app import make_app
    from server.config import Settings
    from server.providers import ProviderService
    from server.studio import plan_fingerprint_valid, approved_run_valid
    from conftest import Actor
    from test_services import ok, thread, message, proposal
    from test_workspace_api import plan, approve
    class ForbiddenProviders(ProviderService):
        async def complete(self, *args, **kwargs):
            raise AssertionError('No external provider calls')
        async def propose(self, *args, **kwargs):
            raise AssertionError('No external planner calls')
    app = make_app(Settings(data_dir=args.data_dir, origin='http://testserver', max_queued_per_user=100),
                   providers=ForbiddenProviders(), worker_enabled=False)
    cases = {}
    with TestClient(app, raise_server_exceptions=False) as client:
        actor = Actor(client)
        data = json.loads((args.source_tree / 'tests/fixtures/synthetic-financial.json').read_text())
        data.update(source_kind='user_provided', company='旧百分比计划隔离合成企业')
        data['periods'] = data['periods'][:2]
        for row, period, cost, profit, revenue in zip(data['periods'], ['2024-Q1', '2024-Q2'],
                [80000, 100000], [5000, 10000], [100000, 150000]):
            row.update(period=period, cost=cost, net_profit=profit, revenue=revenue)
        dataset = ok(actor.post('/datasets', json=data), 201)
        def remember(key, preview, run=None, prop=None):
            case = {'plan_id': preview['id'], 'run_id': run['id'] if run else None,
                    'proposal_id': prop['id'] if prop else None}
            if run and run['result']:
                case['export_sha256'] = {}
                for kind in ('json', 'md'):
                    response = actor.get('/runs/'+run['id']+'/export?format='+kind)
                    assert response.status_code == 200
                    case['export_sha256'][kind] = hashlib.sha256(response.content).hexdigest()
            cases[key] = case
        if args.bare_percent_only:
            queries = ['2024-Q2营业成本是百分之多少', '2024-Q2净利润是多少百分比',
                       '2024-Q2成本的百分比是多少']
            for engine in ('legacy', 'adaptive'):
                for index, query in enumerate(queries):
                    for state in (('draft', 'queued', 'completed') if index == 0 else ('draft', 'queued')):
                        p = plan(actor, dataset, query=query,
                                 **({'execution': {'parallelism': 1, 'local_recovery': False}} if engine == 'adaptive' else {}))
                        assert not p['payload']['blockers']
                        run = ok(approve(actor, p), 202) if state != 'draft' else None
                        if state == 'completed':
                            run = actor.execute(run); assert run['result']
                        remember('bare_'+engine+'_'+str(index)+'_'+state, p, run)
            for key, query in [('amount', '2024-Q2成本环比增加多少元'),
                               ('revenue', '2024-Q2收入环比增长率是多少'),
                               ('ratio', '2024-Q2毛利率是多少百分比'),
                               ('mixed', '2024-Q2成本金额与毛利率是多少百分比')]:
                p = plan(actor, dataset, query=query); assert not p['payload']['blockers']
                remember('bare_'+key+'_draft', p)
            for key, current, edited in [('source_bad', '2024-Q2成本金额', '2024-Q2成本的百分比是多少'),
                                         ('source_good', '2024-Q2成本的百分比是多少', '2024-Q2成本金额与毛利率是多少百分比')]:
                t = thread(actor, dataset); m = ok(message(actor, t, text=current), 201)['message']
                prop = ok(proposal(actor, t, 'research', text=edited, source_message_id=m['id'],
                                   include_thread_history=True, execution={'parallelism': 1, 'local_recovery': False}), 201)
                p = ok(actor.get('/workspace/plans/'+prop['payload']['plan_id']))
                assert not p['payload']['blockers']
                remember('bare_'+key+'_draft', p, prop=prop)
        elif args.word_order_only:
            queries = ['2024-Q2成本环比百分之多少', '2024-Q2净利润环比百分之多少',
                       '2024-Q2成本环比变化百分比是多少', '2024-Q2成本环比增加了多少百分比']
            for index, query in enumerate(queries):
                for state in ('draft', 'queued'):
                    p = plan(actor, dataset, query=query,
                             **({'execution': {'parallelism': 1, 'local_recovery': False}} if index % 2 else {}))
                    assert not p['payload']['blockers']
                    run = ok(approve(actor, p), 202) if state == 'queued' else None
                    remember('word_order_'+str(index)+'_'+state, p, run)
        else:
            for engine in ('legacy', 'adaptive'):
                for state in ('draft', 'queued', 'completed'):
                    query = '2024-Q2 成本环比增长百分之多少' if engine == 'legacy' else '2024-Q2 net profit percentage growth QoQ'
                    p = plan(actor, dataset, query=query,
                             **({'execution': {'parallelism': 1, 'local_recovery': False}} if engine == 'adaptive' else {}))
                    assert not p['payload']['blockers']
                    run = ok(approve(actor, p), 202) if state != 'draft' else None
                    if state == 'completed':
                        run = actor.execute(run); assert run['result']
                    remember(engine+'_'+state, p, run)
            for key, query in [('amount', '2024-Q2成本环比增加多少元'), ('revenue', '2024-Q2收入环比增长率是多少'),
                               ('points', '2024-Q2毛利率环比增加多少个百分点')]:
                p = plan(actor, dataset, query=query); assert not p['payload']['blockers']
                remember(key+'_draft', p)
            for key, current, edited in [('source_bad', '2024-Q2成本金额', '2024-Q2成本环比涨幅是多少'),
                                         ('source_good', '2024-Q2成本环比涨幅是多少', '2024-Q2成本环比增加多少元')]:
                t = thread(actor, dataset); m = ok(message(actor, t, text=current), 201)['message']
                prop = ok(proposal(actor, t, 'research', text=edited, source_message_id=m['id'],
                                   include_thread_history=True, execution={'parallelism': 1, 'local_recovery': False}), 201)
                p = ok(actor.get('/workspace/plans/'+prop['payload']['plan_id']))
                assert not p['payload']['blockers']
                remember(key+'_draft', p, prop=prop)
        store = app.state.store
        for case in cases.values():
            saved = store.one('SELECT * FROM workspace_objects WHERE id=?', (case['plan_id'],))
            assert plan_fingerprint_valid(saved['payload'])
            if case['run_id']:
                assert approved_run_valid(store, store.one('SELECT * FROM runs WHERE id=?', (case['run_id'],)))
        result = {'source': {'commit': BASE, 'tree': git('rev-parse', 'HEAD^{tree}'),
            'captured_at': datetime.now(timezone.utc).isoformat(),
            'capture': 'Clean old checkout; authenticated in-process API; original serialized rows and fingerprints; zero provider calls or listeners.',
            'question_scope_sha256': hashlib.sha256((args.source_tree / 'server/question_scope.py').read_bytes()).hexdigest()},
            'cases': cases, 'tables': {table: [dict(row) for row in store.db.execute('SELECT * FROM '+table)] for table in TABLES}}
        args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n')
        print(json.dumps({'cases': len(cases), 'bytes': args.output.stat().st_size,
                          'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
