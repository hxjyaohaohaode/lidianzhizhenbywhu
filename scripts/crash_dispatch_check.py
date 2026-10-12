"""Real Uvicorn/SQLite crash boundaries with an injected, offline test provider.

The application is driven through ordinary owner-authenticated HTTP APIs. Only
this disposable server launcher installs boundary hooks; production has no crash
switch. A durable independent provider journal distinguishes a reservation from
an attempted send. It models provider outcomes, not a live supplier integration.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.owned_process import OwnedProcess
from scripts.source_identity import collect_source_identity

MAX_SECONDS = 120
CLEANUP_RESERVE = 8
REPORT_RESERVE = 2
CRASH_EXIT = 91
CASES = ('reserved_before_send', 'sent_no_response',
         'completed_before_checkpoint', 'known_unsent_before_checkpoint')


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w', encoding='utf-8') as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def journal(path, value):
    with Path(path).open('a', encoding='utf-8') as output:
        output.write(json.dumps(value, ensure_ascii=False) + '\n')
        output.flush()
        os.fsync(output.fileno())


def read_journal(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines()] if Path(path).exists() else []


def serve(directory, case, phase, port):
    """Test-only child entry point, never imported by the production server."""
    import uvicorn
    from server.app import make_app
    from server.config import Settings
    from server.providers import Provider, ProviderService
    from server.adaptive_runtime import AdaptiveRun
    from server.store import digest

    directory = Path(directory)
    provider_journal = directory / 'provider.jsonl'

    def crash(runner, boundary, call_id):
        atomic_json(directory / 'crash.json', {
            'case': case, 'boundary': boundary, 'run_id': runner.id,
            'call_id': call_id, 'node_id': 'analyst', 'exit_code': CRASH_EXIT})
        os._exit(CRASH_EXIT)

    reserve = AdaptiveRun.reserve_call
    record = AdaptiveRun.record

    def reserve_hook(runner, node, binding, prompt, disclosure):
        result = reserve(runner, node, binding, prompt, disclosure)
        if phase == 'crash' and case == 'reserved_before_send' and node['id'] == 'analyst' and result[0]:
            crash(runner, 'reservation_committed_before_provider_entry', result[0])
        return result

    def record_hook(runner, node, result, state):
        if phase == 'crash' and node['id'] == 'analyst' and case in (
                'completed_before_checkpoint', 'known_unsent_before_checkpoint'):
            call = runner.store.one('SELECT * FROM adaptive_calls WHERE run_id=? AND node_id=?',
                                    (runner.id, node['id']))
            expected = 'completed' if case == 'completed_before_checkpoint' else 'failed'
            if not call or call['state'] != expected:
                raise AssertionError('test boundary did not reach expected closure')
            crash(runner, 'call_closed_before_terminal_checkpoint', call['id'])
        return record(runner, node, result, state)

    AdaptiveRun.reserve_call = reserve_hook
    AdaptiveRun.record = record_hook

    class OfflineProviders(ProviderService):
        def __init__(self):
            super().__init__()
            self.providers = {'crash_fixture': Provider('crash_fixture', 'offline.invalid',
                '/never-contacted', 'synthetic-crash-model', 'synthetic-noncredential')}

        async def complete(self, provider, system, context):
            # Read the real reservation rather than inventing a send counter in
            # the application database. Parallelism is explicitly one in approval.
            call = self.vault.store.one("SELECT * FROM adaptive_calls WHERE state='reserved' AND json_extract(payload,'$.request_hash')=? ORDER BY created_at DESC LIMIT 1", (digest(context),))
            if not call:
                raise AssertionError('provider entered without a persisted reservation')
            entry = {'call_id': call['id'], 'node_id': call['node_id'], 'phase': phase}
            journal(provider_journal, {**entry, 'event': 'provider_entered'})
            if phase == 'crash' and call['node_id'] == 'analyst' and case == 'known_unsent_before_checkpoint':
                journal(provider_journal, {**entry, 'event': 'known_unsent'})
                raise ValueError('MODEL_TRANSPORT_BUSY')
            if not provider.dispatch_guard or not provider.dispatch_guard():
                raise ValueError('MODEL_AUTHORIZATION_CHANGED')
            provider.dispatch_started()
            journal(provider_journal, {**entry, 'event': 'sent'})
            if phase == 'crash' and call['node_id'] == 'analyst' and case == 'sent_no_response':
                # The process dies after the test transport's first-send receipt,
                # without any response or application closure/checkpoint.
                atomic_json(directory / 'crash.json', {'case': case,
                    'boundary': 'test_transport_sent_without_response',
                    'run_id': call['run_id'], 'call_id': call['id'],
                    'node_id': 'analyst', 'exit_code': CRASH_EXIT})
                os._exit(CRASH_EXIT)
            journal(provider_journal, {**entry, 'event': 'completed'})
            return {'output': {'claims': [], 'missing': ['Explicit synthetic provider result.']},
                    'usage': {'total_tokens': 7}, 'provider': provider.id, 'model': provider.model}

    settings = Settings(data_dir=directory / 'data', origin=f'http://127.0.0.1:{port}',
                        production=False, invite_code='', concurrency=1)
    uvicorn.run(make_app(settings, providers=OfflineProviders()),
                host='127.0.0.1', port=port, log_level='warning')


def remaining(deadline, cap=2):
    value = deadline - time.monotonic()
    if value <= 0:
        raise TimeoutError('crash-dispatch aggregate work deadline exhausted')
    return min(cap, value)


def request(client, method, path, deadline, expected=200, **kwargs):
    response = client.request(method, path, timeout=remaining(deadline), **kwargs)
    if response.status_code != expected:
        raise AssertionError(f'{method} {path}: expected {expected}, got {response.status_code}: {response.text[:800]}')
    return response.json()


class Server:
    def __init__(self, directory, case, phase, owned, deadline, work_deadline):
        self.directory = directory
        self.case, self.phase = case, phase
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            self.port = listener.getsockname()[1]
        self.base = f'http://127.0.0.1:{self.port}'
        self.deadline, self.work_deadline = deadline, work_deadline
        self.log = directory / f'{phase}-server.log'
        env = dict(os.environ)
        for key in list(env):
            if key.endswith('_API_KEY') or key.startswith('SERVER_AI_') or key in ('APP_ENV', 'REGISTRATION_CODE', 'DATA_DIR', 'APP_ORIGIN'):
                env.pop(key, None)
        env.update(PYTHONPATH=str(ROOT), PYTHONIOENCODING='utf-8',
                   PYTHONDONTWRITEBYTECODE='1', PYTHONPYCACHEPREFIX=str(directory / 'pycache'))
        self.process = OwnedProcess([sys.executable, str(Path(__file__).resolve()),
            '--serve', str(directory), '--case', case, '--phase', phase, '--port', str(self.port)],
            cwd=ROOT, env=env, stdout_path=self.log, temp_root=directory,
            deadline=deadline, cleanup_reserve=CLEANUP_RESERVE)
        owned.append((self, self.process))

    def ready(self):
        import httpx
        startup = min(self.work_deadline, time.monotonic() + 12)
        with httpx.Client(trust_env=False) as client:
            while True:
                remaining(startup)
                result = self.process.poll()
                if result is not None:
                    raise RuntimeError(f'{self.phase} server exited before readiness: {result.as_dict()}')
                try:
                    response = client.get(self.base + '/api/openapi.json', timeout=remaining(startup, .5))
                    if response.status_code == 200:
                        return
                except httpx.HTTPError:
                    pass
                time.sleep(min(.04, remaining(startup)))

    def stopped(self):
        result = self.process.cancel()
        if not result.cleanup_confirmed:
            raise RuntimeError('owned server cleanup was not confirmed; retain temporary root')
        return result


def snapshot(directory, run_id):
    """Read-only diagnostic copy. Never repair or manufacture a business row."""
    database = (directory / 'data' / 'lidian.sqlite3').resolve()
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=.5) as db:
        db.row_factory = sqlite3.Row
        def rows(table, clause='run_id=?'):
            values = [dict(row) for row in db.execute(f'SELECT * FROM {table} WHERE {clause}', (run_id,))]
            for value in values:
                for key in ('payload', 'snapshot', 'result'):
                    if isinstance(value.get(key), str):
                        value[key] = json.loads(value[key])
            return values
        return {'run': rows('runs', 'id=?')[0], 'calls': rows('adaptive_calls'),
                'checkpoints': rows('adaptive_checkpoints'), 'artifacts': rows('agent_artifacts'),
                'events': sorted(rows('run_events'), key=lambda row: row['seq']),
                'integrity': rows('event_integrity'),
                'provider_journal': read_journal(directory / 'provider.jsonl')}


def validate_chain(data):
    from server.store import digest
    previous = ''
    integrity = {row['event_seq']: row for row in data['integrity']}
    assert set(integrity) == {row['seq'] for row in data['events']}, 'event/hash rows differ'
    for event in data['events']:
        current = digest({'previous': previous, 'event': event})
        assert integrity[event['seq']]['previous_hash'] == previous
        assert integrity[event['seq']]['entry_hash'] == current
        previous = current
    for artifact in data['artifacts']:
        assert digest(artifact['payload']) == artifact['content_hash'], 'artifact hash mismatch'
    return {'valid': True, 'event_count': len(data['events']), 'head_hash': previous}


def validate_crash(case, data, marker):
    assert marker['case'] == case and marker['exit_code'] == CRASH_EXIT
    calls = data['calls']
    assert len(calls) == 1 and calls[0]['id'] == marker['call_id'] and calls[0]['node_id'] == 'analyst'
    call = calls[0]
    checkpoint = next(row for row in data['checkpoints'] if row['node_id'] == 'analyst')
    assert checkpoint['state'] == 'running' and checkpoint['artifact_id'] is None
    assert not any(row['node'] == 'analyst' for row in data['artifacts'])
    expected = {'reserved_before_send': 'reserved', 'sent_no_response': 'sent',
                'completed_before_checkpoint': 'completed', 'known_unsent_before_checkpoint': 'failed'}[case]
    assert call['state'] == expected, (case, call)
    dispatches = [row for row in data['events'] if row['type'] == 'external_dispatch']
    sends = [row for row in data['provider_journal'] if row['event'] == 'sent']
    sent = case in ('sent_no_response', 'completed_before_checkpoint')
    assert len(dispatches) == len(sends) == int(sent)
    assert sum(row['event'] == 'completed' for row in data['provider_journal']) == int(case == 'completed_before_checkpoint')
    closures = [row for row in data['events'] if row['type'] == 'external_call_closed']
    assert len(closures) == int(case in ('completed_before_checkpoint', 'known_unsent_before_checkpoint'))
    if closures:
        from server.store import digest
        assert closures[0]['payload']['payload_hash'] == digest(call['payload'])
    if case == 'known_unsent_before_checkpoint':
        assert call['payload']['dispatched'] is False and call['payload']['remote_outcome_known'] is True
        assert call['payload']['error_class'] == 'MODEL_TRANSPORT_BUSY'
    return validate_chain(data)


def validate_recovery(case, before, after, audit, runtime):
    initial = before['calls'][0]
    target = [row for row in after['calls'] if row['node_id'] == 'analyst']
    assert len(target) == 1 and target[0]['id'] == initial['id'], 'crashed node re-reserved'
    assert target[0]['characters'] == initial['characters'], 'crashed node debited extra context'
    assert [r for r in after['provider_journal'] if r['node_id'] == 'analyst'] == before['provider_journal'], 'crashed node re-entered provider'
    assert after['events'][:len(before['events'])] == before['events'], 'old event history changed'
    # Four approved calls leave headroom; a no-repeat verdict is not merely a
    # side effect of an exhausted one-call budget. Challenger is a distinct node.
    assert len(after['calls']) == 2 and {row['node_id'] for row in after['calls']} == {'analyst', 'challenger'}
    assert runtime['usage']['attempts'] == 2 < runtime['graph']['payload']['envelope']['max_calls']
    challenger = next(row for row in after['calls'] if row['node_id'] == 'challenger')
    assert challenger['state'] == 'completed'
    assert [row['event'] for row in after['provider_journal'] if row['node_id'] == 'challenger'] == ['provider_entered', 'sent', 'completed']
    assert all(row['call_id'] == challenger['id'] for row in after['provider_journal'] if row['node_id'] == 'challenger')
    assert runtime['usage']['characters'] == sum(row['characters'] for row in after['calls'])
    assert runtime['usage']['tokens'] == sum(row['payload'].get('usage', {}).get('total_tokens', 0) for row in after['calls'])
    assert runtime['usage']['tokens'] == (14 if case == 'completed_before_checkpoint' else 7)
    target_artifact = next(row for row in after['artifacts'] if row['node'] == 'analyst')
    if case == 'known_unsent_before_checkpoint':
        assert target[0] == initial
        assert target_artifact['payload']['status'] == 'failed'
        assert target_artifact['payload']['error_class'] == 'MODEL_TRANSPORT_BUSY'
    else:
        assert target_artifact['payload']['status'] == 'unknown'
        assert target_artifact['payload']['error_class'] == 'REMOTE_OUTCOME_UNKNOWN'
        if case == 'completed_before_checkpoint':
            assert target[0] == initial  # Usage remains durable although the output was lost.
        else:
            assert target[0]['state'] == 'unknown' and target[0]['payload']['remote_outcome_known'] is False
    assert after['run']['state'] == 'degraded' and after['run']['result']
    assert audit['ledger']['valid'] and audit['report_hash_valid'] and audit['snapshot_hash_valid']
    assert audit['report_integrity']['valid']
    assert audit['artifacts'] and all(row['event_anchor_valid'] and row['integrity_valid'] for row in audit['artifacts'])
    return validate_chain(after)


def run_case(case, directory, owned, process_deadline, work_deadline, record):
    import httpx
    directory.mkdir()
    server = Server(directory, case, 'crash', owned, process_deadline, work_deadline)
    server.ready()
    with httpx.Client(base_url=server.base, trust_env=False) as client:
        account = request(client, 'POST', '/api/auth/register', work_deadline, 201,
            json={'email': uuid.uuid4().hex + '@crash-dispatch.test',
                  'password': 'Synthetic-crash-check-password', 'name': '崩溃验收合成账户'})
        client.headers['X-CSRF-Token'] = account['csrf']
        fixture = json.loads((ROOT / 'tests/fixtures/synthetic-financial.json').read_text(encoding='utf-8'))
        fixture['source_kind'] = 'user_provided'
        dataset = request(client, 'POST', '/api/datasets', work_deadline, 201, json=fixture)
        plan = request(client, 'POST', '/api/workspace/plans', work_deadline, 201, json={
            'dataset_id': dataset['id'], 'query': '核验合成企业经营现金回流与毛利变化',
            'use_llm': True, 'provider': 'crash_fixture', 'max_calls': 4,
            'execution': {'depth': 'concise', 'max_revisions': 0, 'local_recovery': False,
                          'parallelism': 1, 'total_context_chars': 144000}})
        assert not read_journal(directory / 'provider.jsonl'), 'preview contacted provider'
        run = request(client, 'POST', '/api/workspace/plans/' + plan['id'] + '/execute', work_deadline, 202,
            json={'version': plan['version'], 'fingerprint': plan['payload']['fingerprint'], 'external_consent': True})
        record['run_id'] = run['id']
        while server.process.poll() is None:
            time.sleep(min(.02, remaining(work_deadline)))
        death = server.process.wait()
        record['crash_process'] = death.as_dict()
        assert death.cleanup_confirmed and death.returncode == CRASH_EXIT, death.as_dict()
        marker = json.loads((directory / 'crash.json').read_text(encoding='utf-8'))
        assert marker['run_id'] == run['id']
        before = snapshot(directory, run['id'])
        record.update(crash_marker=marker, before_restart=before)
        record['crash_chain'] = validate_crash(case, before, marker)

        restarted = Server(directory, case, 'resume', owned, process_deadline, work_deadline)
        restarted.ready()
        client.base_url = restarted.base
        runtime_path = '/api/workspace/runs/' + run['id'] + '/runtime'
        rt = request(client, 'GET', runtime_path, work_deadline)
        assert rt['state'] == 'interrupted', rt
        assert snapshot(directory, run['id'])['provider_journal'] == before['provider_journal']
        request(client, 'POST', '/api/workspace/runs/' + run['id'] + '/control', work_deadline,
            json={'action': 'resume', 'version': rt['control']['version']})
        while True:
            done = request(client, 'GET', '/api/runs/' + run['id'], work_deadline)
            if done['state'] not in ('queued', 'running'):
                break
            time.sleep(min(.03, remaining(work_deadline)))
        rt = request(client, 'GET', runtime_path, work_deadline)
        audit = request(client, 'GET', '/api/workspace/runs/' + run['id'] + '/audit', work_deadline)
        after = snapshot(directory, run['id'])
        record.update(after_resume=after, runtime=rt, audit=audit)
        record['recovery_chain'] = validate_recovery(case, before, after, audit, rt)
        restarted.stopped()

        again = Server(directory, case, 'second_restart', owned, process_deadline, work_deadline)
        again.ready()
        client.base_url = again.base
        final = request(client, 'GET', '/api/runs/' + run['id'], work_deadline)
        rt2 = request(client, 'GET', runtime_path, work_deadline)
        # Terminal control denial is explicit; it must not schedule another send.
        denied = request(client, 'POST', '/api/workspace/runs/' + run['id'] + '/control', work_deadline, 409,
            json={'action': 'resume', 'version': rt2['control']['version']})
        assert denied['error']['code'] == 'RUN_TERMINAL'
        second = snapshot(directory, run['id'])
        assert final['state'] == 'degraded' and final['result'] == done['result']
        assert second == after and rt2 == rt, 'second restart changed durable result/ledger'
        record['second_restart'] = {'unchanged': True, 'terminal_resume_error': denied['error']['code'],
                                    'chain': validate_chain(second)}
        again.stopped()
        record['passed'] = True


def cleanup_owned(owned):
    """Request every cancellation before waiting on any single process."""
    failures = {}
    for server, process in owned:
        try:
            process.request_cancel()
        except Exception as exc:
            failures[id(process)] = repr(exc)
    receipts = []
    for server, process in owned:
        try:
            receipt = process.wait().as_dict()
        except Exception as exc:
            receipt = {'cleanup_confirmed': False, 'error': repr(exc)}
        if id(process) in failures:
            receipt = {**receipt, 'cleanup_confirmed': False, 'cancel_error': failures[id(process)]}
        try:
            with server.log.open('rb') as log:
                log.seek(max(0, server.log.stat().st_size - 12000))
                tail = log.read(12000).decode('utf-8', errors='replace')
        except OSError as exc:
            tail = 'Server log unavailable: ' + repr(exc)
        receipts.append({'case': server.case, 'phase': server.phase, **receipt, 'log_tail': tail})
    return receipts


def source_identity(root, owned, process_deadline, work_deadline, phase):
    """Bind evidence to verified package bytes or this checkout's actual HEAD."""
    paths = sorted((ROOT / 'server').rglob('*.py')) + [
        ROOT / 'scripts/crash_dispatch_check.py', ROOT / 'scripts/owned_process.py',
        ROOT / 'scripts/source_identity.py', ROOT / 'tests/fixtures/synthetic-financial.json']
    return collect_source_identity(ROOT, paths, scratch_root=root,
        register_process=lambda descriptor, process: owned.append((descriptor, process)),
        process_deadline=process_deadline, work_deadline=work_deadline,
        cleanup_reserve=CLEANUP_RESERVE, phase=phase)


def run(out=None):
    out = Path(out) if out else ROOT / 'evidence'
    out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    deadline = started + MAX_SECONDS
    process_deadline = deadline - REPORT_RESERVE
    work_deadline = process_deadline - CLEANUP_RESERVE
    invocation = uuid.uuid4().hex
    report = {'schema': 'crash-dispatch-http-v1', 'invocation_id': invocation,
        'started_at': datetime.now(timezone.utc).isoformat(), 'passed': False, 'status': 'not_started',
        'transport': 'real loopback HTTP + Uvicorn + isolated SQLite; injected offline provider',
        'real_external_supplier_calls': 0, 'synthetic_data_only': True,
        'budget_seconds': MAX_SECONDS, 'cleanup_reserve_seconds': CLEANUP_RESERVE,
        'report_reserve_seconds': REPORT_RESERVE, 'cases': [], 'processes': [], 'cleanup_confirmed': False,
        'not_exercised': ['Live supplier/network dispatch', 'Native browser behavior', 'Public deployment']}
    atomic_json(out / 'crash-dispatch-http.json', report)
    root = Path(tempfile.mkdtemp(prefix='lidian-crash-dispatch-'))
    owned = []
    try:
        report['status'] = 'running'
        report['source_before'] = source_identity(root, owned, process_deadline, work_deadline, 'before')
        for case in CASES:
            record = {'case': case, 'passed': False}
            report['cases'].append(record)
            run_case(case, root / case, owned, process_deadline, work_deadline, record)
            print('PASS', case, flush=True)
        report['source_after'] = source_identity(root, owned, process_deadline, work_deadline, 'after')
        report['source_unchanged'] = report['source_after'] == report['source_before']
        if not report['source_unchanged']:
            raise RuntimeError('Source identity or runtime/harness bytes changed during crash acceptance')
        report['passed'] = True
    except Exception as exc:
        report['error'] = repr(exc)
        report['first_failure'] = {'case': report['cases'][-1]['case'] if report['cases'] else None,
                                   'error': repr(exc)}
        print('FAIL', repr(exc), flush=True)
    finally:
        report['processes'] = cleanup_owned(owned)
        report['cleanup_confirmed'] = all(row['cleanup_confirmed'] for row in report['processes'])
        if not report['cleanup_confirmed']:
            report['passed'] = False
            report['cleanup_error'] = 'Unconfirmed descendant cleanup; temporary files must be retained.'
        if time.monotonic() >= deadline:
            report['passed'] = False
            report['budget_error'] = 'Aggregate 120-second deadline exceeded including cleanup/report preparation.'
        report['status'] = 'passed' if report['passed'] else 'failed'
        if not report['passed']:
            # Never overwrite a first failed round with a later rerun. Keep the
            # unique isolated root and full report even after confirmed cleanup.
            report['retained_temporary_root'] = str(root)
            report['elapsed_seconds'] = round(time.monotonic() - started, 3)
            atomic_json(root / 'failure-report.json', report)
        else:
            try:
                shutil.rmtree(root)
            except OSError as exc:
                report.update(passed=False, status='failed', retained_temporary_root=str(root),
                              cleanup_error='Temporary-root removal failed: ' + repr(exc))
                atomic_json(root / 'failure-report.json', report)
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        if time.monotonic() >= deadline:
            report.update(passed=False, status='failed', budget_error='Aggregate deadline exceeded during cleanup/report preparation.')
        atomic_json(out / 'crash-dispatch-http.json', report)
    return 0 if report['passed'] else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--serve', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--case', choices=CASES, help=argparse.SUPPRESS)
    parser.add_argument('--phase', choices=('crash', 'resume', 'second_restart'), help=argparse.SUPPRESS)
    parser.add_argument('--port', type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve:
        if not args.case or not args.phase or not args.port:
            parser.error('isolated child requires case, phase and port')
        serve(args.serve, args.case, args.phase, args.port)
        return 0
    return run(args.output_dir)


if __name__ == '__main__':
    raise SystemExit(main())
