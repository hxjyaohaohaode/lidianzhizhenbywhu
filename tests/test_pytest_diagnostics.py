"""Real isolated pytest processes verify diagnostics without weakening tests."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]


def probe(tmp_path, source, *, timeout=1, conftest='', extra=()):
    (tmp_path / 'pytest.ini').write_text('[pytest]\n', encoding='utf-8')
    (tmp_path / 'test_probe.py').write_text(source, encoding='utf-8')
    (tmp_path / 'conftest.py').write_text(conftest, encoding='utf-8')
    progress = tmp_path / 'progress.jsonl'
    command = [sys.executable, '-m', 'pytest', '-q', '-c', str(tmp_path / 'pytest.ini'),
        '-p', 'no:faulthandler', '-p', 'scripts.pytest_diagnostics',
        '--diagnostics-output=' + str(progress), '--diagnostics-test-timeout=' + str(timeout),
        '--junitxml=' + str(tmp_path / 'results.xml'), *extra, str(tmp_path / 'test_probe.py')]
    environment = {**os.environ, 'PYTHONPATH': str(ROOT), 'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1',
        'PYTEST_ADDOPTS': '', 'PYTEST_PLUGINS': '', 'PYTHONIOENCODING': 'utf-8'}
    return command, environment, progress


def events(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]


def run_probe(tmp_path, source, **kwargs):
    command, environment, progress = probe(tmp_path, source, **kwargs)
    result = subprocess.run(command, cwd=tmp_path, env=environment,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', timeout=20)
    return result, events(progress) if progress.exists() else []


def test_normal_failure_keeps_all_outcomes_and_never_becomes_timeout(tmp_path):
    result, journal = run_probe(tmp_path, '''
def test_first(): assert True
def test_fails(): assert False, 'isolated assertion sentinel'
def test_last(): assert True
''')
    assert result.returncode == 1 and 'isolated assertion sentinel' in result.stdout
    summary = journal[-1]
    assert summary['event'] == 'session_finished' and summary['exit_code'] == 1
    assert summary['collected'] == summary['started'] == summary['completed'] == 3
    assert summary['complete'] is True and summary['phase_outcomes']['call_failed'] == 1
    assert summary['phase_outcomes']['teardown_passed'] == 3
    assert 'isolated assertion sentinel' not in json.dumps(journal)
    assert (tmp_path / 'results.xml').exists()
    assert 'Timeout' not in (tmp_path / 'progress.stacks.log').read_text()
    assert all('process_cpu_seconds' in event for event in journal)


@pytest.mark.parametrize('phase,fail_before_teardown', [
    ('setup', False), ('call', False), ('teardown', False), ('teardown', True)])
def test_hung_phase_dumps_stacks_and_exits_without_fake_completion(tmp_path, phase, fail_before_teardown):
    source = f'''
import time
import pytest
@pytest.fixture
def fixture():
    {'time.sleep(10)' if phase == 'setup' else 'pass'}
    yield
    {'time.sleep(10)' if phase == 'teardown' else 'pass'}
def test_hangs(fixture):
    {'time.sleep(10)' if phase == 'call' else 'assert False' if fail_before_teardown else 'pass'}
def test_never_reached(): assert True
'''
    result, journal = run_probe(tmp_path, source, timeout=.3)
    assert result.returncode != 0
    assert [e['phase'] for e in journal if e['event'] == 'phase_started'][-1] == phase
    assert len([e for e in journal if e['event'] == 'test_started']) == 1
    assert not any(e['event'] in ('test_finished', 'session_finished') for e in journal)
    stacks = (tmp_path / 'progress.stacks.log').read_text()
    assert 'Timeout' in stacks and 'test_probe.py' in stacks and 'Thread' in stacks
    assert not (tmp_path / 'results.xml').exists()
    if fail_before_teardown:
        assert any(e.get('phase') == 'call' and e.get('outcome') == 'failed' for e in journal)


def test_watchdog_cancellation_cannot_kill_the_following_test(tmp_path):
    result, journal = run_probe(tmp_path, '''
import time
def test_first(): time.sleep(1)
def test_second(): time.sleep(1.5)
''', timeout=2)
    assert result.returncode == 0, result.stdout
    assert journal[-1]['completed'] == 2 and journal[-1]['complete'] is True
    assert journal[-1]['elapsed_seconds'] > 2
    assert (tmp_path / 'progress.stacks.log').read_text() == ''


def test_watchdog_budget_is_not_reset_between_setup_call_and_teardown(tmp_path):
    result, journal = run_probe(tmp_path, '''
import time
import pytest
@pytest.fixture
def fixture():
    time.sleep(1)
    yield
    time.sleep(1)
def test_whole_budget(fixture): time.sleep(1)
''', timeout=2.5)
    assert result.returncode != 0
    assert [e['phase'] for e in journal if e['event'] == 'phase_started'][-1] == 'teardown'
    assert 'Timeout' in (tmp_path / 'progress.stacks.log').read_text()
    assert not any(e['event'] == 'session_finished' for e in journal)


def test_external_kill_preserves_flushed_completed_and_active_test_identity(tmp_path):
    command, environment, progress = probe(tmp_path, '''
import time
def test_completed(): assert True
def test_interrupted(): time.sleep(60)
''', timeout=120)
    with subprocess.Popen(command, cwd=tmp_path, env=environment,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as process:
        deadline = time.monotonic() + 10
        observed = []
        try:
            while time.monotonic() < deadline and process.poll() is None:
                if progress.exists():
                    observed = events(progress)
                    if any(e['event'] == 'phase_started' and e.get('phase') == 'call'
                            and e.get('nodeid', '').endswith('test_interrupted') for e in observed):
                        break
                time.sleep(.02)
            assert any(e['event'] == 'test_finished' and e['complete'] for e in observed)
            assert observed[-1]['event'] == 'phase_started' and observed[-1]['phase'] == 'call'
        finally:
            process.terminate()
            process.communicate(timeout=5)
    journal = events(progress)
    assert process.returncode != 0
    assert journal == observed  # Read while alive; no interpreter-exit flush was needed.
    assert not any(e['event'] == 'session_finished' for e in journal)
    assert not (tmp_path / 'results.xml').exists()


def test_short_circuit_cannot_report_a_complete_success(tmp_path):
    result, journal = run_probe(tmp_path, 'def test_must_run(): assert False\n',
        conftest='def pytest_runtest_protocol(item, nextitem): return True\n')
    assert result.returncode != 0
    assert journal[-1]['collected'] == 1 and journal[-1]['completed'] == 0
    assert journal[-1]['complete'] is False and journal[-1]['exit_code'] != 0


def test_collection_exception_remains_a_failure(tmp_path):
    result, journal = run_probe(tmp_path, 'raise RuntimeError("collection failure sentinel")\n')
    assert result.returncode != 0 and 'collection failure sentinel' in result.stdout
    assert journal[-1]['event'] == 'session_finished' and journal[-1]['exit_code'] != 0
    assert journal[-1]['completed'] == 0 and journal[-1]['complete'] is False


@pytest.mark.parametrize('timeout', [0, -1, 121, 'nan', 'inf'])
def test_invalid_or_unbounded_watchdog_is_rejected(tmp_path, timeout):
    result, journal = run_probe(tmp_path, 'def test_valid(): pass\n', timeout=timeout)
    assert result.returncode == 4 and not journal


def test_competing_builtin_watchdog_is_rejected(tmp_path):
    result, journal = run_probe(tmp_path, 'def test_valid(): pass\n', extra=['-p', 'faulthandler'])
    assert result.returncode == 4 and not journal
    assert 'requires -p no:faulthandler' in result.stdout


def test_protocol_exception_synchronously_cancels_watchdog(monkeypatch):
    spec = importlib.util.spec_from_file_location('isolated_diagnostics', ROOT / 'scripts/pytest_diagnostics.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = []
    monkeypatch.setattr(module, 'faulthandler', SimpleNamespace(
        dump_traceback_later=lambda *a, **kw: calls.append(('arm', a, kw)),
        cancel_dump_traceback_later=lambda: calls.append(('cancel',))))
    diagnostic = module.Diagnostics.__new__(module.Diagnostics)
    diagnostic.started = []; diagnostic.completed = []; diagnostic.timeout = 120; diagnostic.stacks = object()
    diagnostic.emit = lambda event, **fields: calls.append((event, fields))
    protocol = diagnostic.pytest_runtest_protocol(SimpleNamespace(nodeid='test_exception'), None)
    next(protocol)
    with pytest.raises(RuntimeError, match='protocol failure'):
        protocol.throw(RuntimeError('protocol failure'))
    assert calls[1] == ('arm', (120,), {'file': diagnostic.stacks, 'exit': True})
    assert calls[2] == ('cancel',)
    assert calls[3] == ('test_finished', {'nodeid': 'test_exception', 'complete': False, 'interrupted': True})
    assert diagnostic.completed == []
