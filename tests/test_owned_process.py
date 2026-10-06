"""Real process trees exercise ownership; Windows runs real Jobs, never mocks."""
import ctypes
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import pytest

from scripts import owned_process
from scripts.owned_process import OwnedProcess


ROOT = Path(__file__).resolve().parents[1]


def await_file(path, timeout=10):
    until = time.monotonic()+timeout
    while time.monotonic() < until:
        if path.exists() and path.stat().st_size:
            return path.read_text(encoding='utf-8')
        time.sleep(.02)
    raise AssertionError(f'process did not write {path.name}')


def exists(pid):
    if os.name == 'nt':
        from ctypes import wintypes as w
        api = ctypes.WinDLL('kernel32', use_last_error=True)
        api.OpenProcess.argtypes, api.OpenProcess.restype = [w.DWORD, w.BOOL, w.DWORD], w.HANDLE
        api.WaitForSingleObject.argtypes, api.WaitForSingleObject.restype = [w.HANDLE, w.DWORD], w.DWORD
        api.CloseHandle.argtypes, api.CloseHandle.restype = [w.HANDLE], w.BOOL
        handle = api.OpenProcess(0x100000, False, pid)  # SYNCHRONIZE
        if not handle:
            assert ctypes.get_last_error() == 87  # ERROR_INVALID_PARAMETER (no such PID)
            return False
        try:
            state = api.WaitForSingleObject(handle, 0)
            assert state in (0, 258)  # WAIT_OBJECT_0, WAIT_TIMEOUT
            return state == 258
        finally:
            assert api.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True  # A zombie is deliberately NOT accepted as reaped.
    except ProcessLookupError:
        return False


@pytest.fixture
def launch(tmp_path):
    running = []

    def start(command, *, seconds=15, reserve=3, env=None):
        process = OwnedProcess(command, cwd=tmp_path, env=env or os.environ,
            stdout_path=tmp_path/f'output-{len(running)}.log', temp_root=tmp_path,
            deadline=time.monotonic()+seconds, cleanup_reserve=reserve)
        running.append(process)
        return process

    yield start
    for process in running:
        process.request_cancel()
    for process in running:
        process.wait()


def node_command(pid_path):
    node = shutil.which('node')
    assert node, 'Node is required by the backend verification environment'
    return [node, '-e', "require('fs').writeFileSync(process.argv[1], String(process.pid));"
            "setInterval(()=>{}, 1000)", str(pid_path)]


def tree_command(tmp_path):
    source = ('import os, pathlib, subprocess, time\n'
              f'pathlib.Path({str(tmp_path / "command.pid")!r}).write_text(str(os.getpid()))\n'
              f'subprocess.Popen({node_command(tmp_path / "node.pid")!r})\n'
              'print("tree is alive", flush=True)\n'
              'time.sleep(60)\n')
    return [sys.executable, '-c', source]


@pytest.mark.parametrize('exit_code', [0, 7])
def test_real_exit_is_distinct_from_guardian_and_full_stdout_cannot_deadlock(tmp_path, launch, exit_code):
    process = launch([sys.executable, '-c',
                      f'import sys; sys.stdout.write("x"*2000000); sys.exit({exit_code})'])
    result = process.wait()
    assert result.returncode == exit_code and result.cleanup_confirmed
    assert result.error is None and not result.timed_out and not result.cancelled
    assert result.receipt['command_pid'] != result.receipt['bootstrap_pid'] != process.guardian_pid
    assert result.receipt['guardian_returncode'] == result.receipt['bootstrap_returncode'] == 0
    assert result.receipt['ownership'] == ('windows-job' if os.name == 'nt' else 'posix-group')
    assert (tmp_path / 'output-0.log').read_bytes() == b'x'*2000000
    assert result.as_dict()['returncode'] == exit_code


def test_watchdog_exit_reaps_live_node_descendant_and_preserves_stacks(tmp_path, launch):
    (tmp_path / 'pytest.ini').write_text('[pytest]\n', encoding='utf-8')
    (tmp_path / 'test_hang.py').write_text(
        'import subprocess, time\n'
        'def test_hangs():\n'
        f'    subprocess.Popen({node_command(tmp_path / "node.pid")!r})\n'
        '    print("watchdog target started", flush=True)\n'
        '    time.sleep(60)\n', encoding='utf-8')
    progress = tmp_path / 'progress.jsonl'
    command = [sys.executable, '-m', 'pytest', '-s', '-q', '-c', str(tmp_path / 'pytest.ini'),
               '-p', 'no:faulthandler', '-p', 'scripts.pytest_diagnostics',
               '--diagnostics-output='+str(progress), '--diagnostics-test-timeout=1',
               str(tmp_path / 'test_hang.py')]
    result = launch(command, env={**os.environ, 'PYTHONPATH': str(ROOT),
        'PYTEST_ADDOPTS': '', 'PYTEST_PLUGINS': '', 'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1'}).wait()
    assert result.returncode != 0 and result.returncode is not None
    assert result.cleanup_confirmed and not result.timed_out and result.error is None
    assert not exists(int(await_file(tmp_path / 'node.pid')))
    assert not exists(result.receipt['command_pid'])
    assert 'watchdog target started' in (tmp_path / 'output-0.log').read_text()
    assert 'Timeout' in progress.with_suffix('.stacks.log').read_text()
    journal = [json.loads(line) for line in progress.read_text().splitlines()]
    assert any(event['event'] == 'test_started' for event in journal)
    assert not any(event['event'] == 'session_finished' for event in journal)


def test_deadline_stops_entire_tree_inside_original_budget(tmp_path, launch):
    started = time.monotonic()
    process = launch(tree_command(tmp_path), seconds=5, reserve=2)
    command_pid = int(await_file(tmp_path / 'command.pid'))
    node_pid = int(await_file(tmp_path / 'node.pid'))
    result = process.wait()
    assert result.timed_out and result.cleanup_confirmed
    assert result.returncode is None  # Terminated wrapper cannot invent a child exit.
    assert time.monotonic()-started < 5
    assert result.receipt['finished_monotonic'] < process.deadline
    assert not exists(command_pid) and not exists(node_pid)
    assert 'tree is alive' in (tmp_path / 'output-0.log').read_text()


def test_cancel_requests_stop_two_trees_before_waiting(tmp_path, launch):
    processes, pids = [], []
    for index in range(2):
        directory = tmp_path / str(index)
        directory.mkdir()
        processes.append(launch(tree_command(directory)))
        pids.extend([int(await_file(directory / 'command.pid')), int(await_file(directory / 'node.pid'))])
    for process in processes:
        process.request_cancel()
    results = [process.wait() for process in processes]
    assert all(result.cleanup_confirmed and result.cancelled and not result.timed_out for result in results)
    assert all(not exists(pid) for pid in pids)


@pytest.mark.parametrize('kill_guardian', [False, True] if os.name == 'nt' else [False])
def test_abrupt_controller_kill_still_cleans_and_reaps_command_tree(tmp_path, kill_guardian):
    # On Windows additionally kill the Job's sole handle owner: this exercises
    # KILL_ON_JOB_CLOSE itself, rather than the normal TerminateJobObject path.
    crash_guardian = (
        f'while not pathlib.Path({str(tmp_path / "kill-guardian")!r}).exists(): time.sleep(.02)\n'
        'p._guardian.kill()\n'
        'p._guardian.wait(timeout=5)\n'
        f'pathlib.Path({str(tmp_path / "crash-result.json")!r}).write_text(json.dumps(p.wait().as_dict()))\n'
        if kill_guardian else '')
    controller_source = (
        'import json, os, pathlib, sys, time\n'
        f'sys.path.insert(0, {str(ROOT)!r})\n'
        'from scripts.owned_process import OwnedProcess\n'
        f'p=OwnedProcess({tree_command(tmp_path)!r}, cwd={str(tmp_path)!r}, env=os.environ, '
        f'stdout_path={str(tmp_path / "output.log")!r}, temp_root={str(tmp_path)!r}, '
        'deadline=time.monotonic()+20, cleanup_reserve=3)\n'
        f'pathlib.Path({str(tmp_path / "receipt-path")!r}).write_text(str(p.receipt_path))\n'
        + crash_guardian +
        'time.sleep(60)\n')
    with subprocess.Popen([sys.executable, '-I', '-S', '-c', controller_source],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as controller:
        try:
            receipt_path = Path(await_file(tmp_path / 'receipt-path'))
            pids = [int(await_file(tmp_path / 'command.pid')), int(await_file(tmp_path / 'node.pid'))]
            assert all(exists(pid) for pid in pids)
            if kill_guardian:
                (tmp_path / 'kill-guardian').touch()
                failed = json.loads(await_file(tmp_path / 'crash-result.json'))
                assert not failed['cleanup_confirmed'] and failed['error']
        finally:
            controller.kill()  # SIGKILL on POSIX; TerminateProcess on Windows.
            controller.wait(timeout=5)
    until = time.monotonic()+7
    while time.monotonic() < until:
        receipt = json.loads(receipt_path.read_text())
        if all(not exists(pid) for pid in pids) and (kill_guardian or receipt.get('complete')):
            break
        time.sleep(.02)
    if not kill_guardian:
        assert receipt['complete'] and receipt['cancelled'] and receipt['cleanup_confirmed']
    else:
        assert not receipt['complete']  # Actual cleanup without a receipt cannot pass.
    assert all(not exists(pid) for pid in pids)


def inject_assignment(monkeypatch, tmp_path, action):
    launcher = tmp_path / 'guarded_launcher.py'
    launcher.write_text(
        'import json, os, pathlib, sys, time\n'
        f'sys.path.insert(0, {str(ROOT)!r})\n'
        'from scripts import owned_process as owner\n'
        'base=owner._WindowsJob if os.name=="nt" else owner._PosixTree\n'
        'class Tree(base):\n'
        '    def assign(self, child):\n'
        '        super().assign(child)\n'
        f'        pathlib.Path({str(tmp_path / "assigned")!r}).write_text(str(child.pid))\n'
        f'        {action}\n'
        'if os.name=="nt": owner._WindowsJob=Tree\n'
        'else: owner._PosixTree=Tree\n'
        'spec=json.loads(pathlib.Path(sys.argv[2]).read_text())\n'
        'raise SystemExit(owner._guardian(spec))\n', encoding='utf-8')
    monkeypatch.setattr(owned_process, '__file__', str(launcher))


@pytest.mark.parametrize('failure', ['assignment', 'controller_eof'])
def test_gate_prevents_target_and_sitecustomize_before_ownership_failure(tmp_path, launch, monkeypatch, failure):
    # This real guardian delay/error injection never replaces OS ownership APIs.
    inject_assignment(monkeypatch, tmp_path,
                      'raise OSError("assignment sentinel")' if failure == 'assignment' else 'time.sleep(.5)')
    imported = tmp_path / 'imported'
    ran = tmp_path / 'ran'
    (tmp_path / 'sitecustomize.py').write_text(
        f'from pathlib import Path; Path({str(imported)!r}).write_text("unsafe import")\n')
    process = launch([sys.executable, '-c',
        f'from pathlib import Path; Path({str(ran)!r}).write_text("unsafe target")'],
        env={**os.environ, 'PYTHONPATH': str(tmp_path)})
    bootstrap_pid = int(await_file(tmp_path / 'assigned'))
    if failure == 'controller_eof':
        process.request_cancel()
    result = process.wait()
    assert result.returncode is None and result.error and result.cleanup_confirmed
    assert not imported.exists() and not ran.exists() and not exists(bootstrap_pid)


def test_unconfirmed_cleanup_never_becomes_success(tmp_path, launch, monkeypatch):
    inject_assignment(monkeypatch, tmp_path, 'self.empty=lambda: False')
    process = launch([sys.executable, '-c', 'pass'], seconds=5, reserve=1)
    result = process.wait()
    assert result.returncode == 0
    assert not result.cleanup_confirmed and result.error == 'descendant cleanup not confirmed'


def test_unlaunchable_command_is_not_a_wrapper_success(tmp_path, launch):
    result = launch([str(tmp_path / 'does-not-exist')]).wait()
    assert result.returncode is None and result.cleanup_confirmed and result.error


def test_exhausted_deadline_does_not_launch_target(tmp_path, launch):
    with pytest.raises(TimeoutError, match='deadline exhausted'):
        launch([sys.executable, '-c', 'raise AssertionError("must not launch")'], seconds=1, reserve=2)
    assert not list(tmp_path.glob('owned-*')) and not list(tmp_path.glob('output-*.log'))


def test_missing_cleanup_receipt_cannot_turn_actual_zero_into_success(tmp_path, launch):
    process = launch([sys.executable, '-c', 'pass'])
    assert process._guardian.wait(timeout=10) == 0
    assert json.loads(process.receipt_path.read_text())['returncode'] == 0
    process.receipt_path.unlink()
    result = process.wait()
    assert result.returncode is None and not result.cleanup_confirmed and result.error
