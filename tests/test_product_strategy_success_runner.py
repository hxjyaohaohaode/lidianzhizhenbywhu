"""Windows L13 admission contracts; no environment impersonation or browser."""
import builtins
from itertools import product
import json
import os
from pathlib import Path
import re
import sys

import pytest

from scripts import native_acceptance, product_browser_audit as runner
from scripts import product_audit_config as config


def actual_windows_ci():
    return config.windows_ci_runner_matches(os_name=os.name, platform=sys.platform,
        github_actions=os.getenv('GITHUB_ACTIONS'), runner_os=os.getenv('RUNNER_OS'))


@pytest.mark.parametrize('os_name,platform,github_actions,runner_os', list(product(
    ('nt', 'posix'), ('win32', 'linux'), ('true', 'false'), ('Windows', 'Linux'))))
def test_windows_admission_requires_every_real_runtime_and_ci_signal(os_name, platform, github_actions, runner_os):
    # These are pure input values, not changes to the local process identity.
    assert config.windows_ci_runner_matches(os_name=os_name, platform=platform,
        github_actions=github_actions, runner_os=runner_os) is (
            (os_name, platform, github_actions, runner_os) == ('nt', 'win32', 'true', 'Windows'))


@pytest.mark.parametrize('field,value', [('os_name', None), ('platform', 'cygwin'),
    ('github_actions', None), ('github_actions', 'True'), ('runner_os', None), ('runner_os', 'windows')])
def test_missing_or_approximate_windows_signals_are_rejected(field, value):
    observed = {'os_name': 'nt', 'platform': 'win32', 'github_actions': 'true', 'runner_os': 'Windows'}
    observed[field] = value
    assert config.windows_ci_runner_matches(**observed) is False


def test_suite_guard_reads_actual_runtime_and_has_no_override_parameters(monkeypatch):
    original = config.windows_ci_runner_matches
    observed = []
    def capture(**kwargs):
        observed.append(kwargs)
        return original(**kwargs)
    monkeypatch.setattr(config, 'windows_ci_runner_matches', capture)
    if actual_windows_ci():
        config.require_suite_runner('strategy-success')
    else:
        with pytest.raises(RuntimeError, match='real Windows GitHub runner'):
            config.require_suite_runner('strategy-success')
    assert observed[-1] == {'os_name': os.name, 'platform': sys.platform,
        'github_actions': os.getenv('GITHUB_ACTIONS'), 'runner_os': os.getenv('RUNNER_OS')}
    with pytest.raises(TypeError):
        config.require_suite_runner('strategy-success', platform='win32')


def test_new_platform_gate_does_not_change_the_eighteen_earlier_suites():
    previous = {name: suite for name, suite in config.AUDIT_SUITES.items() if name != 'strategy-success'}
    assert len(previous) == 18
    assert all('runner_platform' not in suite for suite in previous.values())
    for name in previous:
        assert config.require_suite_runner(name) is None


def test_native_entry_blocks_before_socket_process_browser_or_temp_server(tmp_path, monkeypatch):
    if actual_windows_ci():
        # Authorized CI still tests rejection, never a local admission bypass.
        monkeypatch.setattr(config, 'windows_ci_runner_matches', lambda **kwargs: False)
    monkeypatch.setattr(native_acceptance, 'ROOT', tmp_path)
    monkeypatch.setattr(sys, 'argv', ['native_acceptance.py', '--product-strategy-success'])
    def prohibited(*args, **kwargs):
        pytest.fail('Windows-only admission must happen before socket, server, subprocess or temporary DATA_DIR')
    monkeypatch.setattr(native_acceptance.socket, 'socket', prohibited)
    monkeypatch.setattr(native_acceptance.subprocess, 'Popen', prohibited)
    monkeypatch.setattr(native_acceptance.subprocess, 'run', prohibited)
    monkeypatch.setattr(native_acceptance, 'WindowsSafeTemporaryDirectory', prohibited)
    with pytest.raises(SystemExit, match='real Windows GitHub runner'):
        native_acceptance.main()
    report = json.loads((tmp_path / 'evidence/product-strategy-success-audit.json').read_text())
    assert report['suite'] == 'strategy-success' and report['mode'] == 'product-strategy-success'
    assert report['status'] == 'blocked_or_error'
    assert report['all_checks_passed'] is False and report['native_network_e2e'] is False
    events = [json.loads(line) for line in
        (tmp_path / 'evidence/product-strategy-success-process-events.jsonl').read_text().splitlines()]
    blocked = [event for event in events if event['event'] == 'product_audit_blocked']
    assert len(blocked) == 1 and blocked[0]['reason'] == 'authorized_windows_ci_runner_required'
    assert events[-1]['event'] == 'journal_closed'


def test_browser_script_and_callable_block_before_any_browser_or_identity_access(tmp_path, monkeypatch):
    if actual_windows_ci():
        # Narrow the policy for this test without changing OS or CI identities.
        monkeypatch.setattr(config, 'windows_ci_runner_matches', lambda **kwargs: False)
    def prohibited(*args, **kwargs):
        pytest.fail('The Windows gate must run before general runner access, git, browser or network')
    monkeypatch.setattr(runner, 'require_isolated_runner', prohibited)
    monkeypatch.setattr(runner, 'git_identity', prohibited)
    real_import = builtins.__import__
    def no_playwright(name, *args, **kwargs):
        if name.startswith('playwright'):
            prohibited()
        return real_import(name, *args, **kwargs)
    monkeypatch.setattr(builtins, '__import__', no_playwright)
    monkeypatch.setattr(sys, 'argv', ['product_browser_audit.py', '--repo', str(tmp_path),
        '--suite', 'strategy-success', '--expected-web-tree', 'a' * 40, '--expected-server-tree', 'b' * 40])
    assert runner.main() == 1
    report = json.loads((tmp_path / 'evidence/product-strategy-success-audit.json').read_text())
    assert report['status'] == 'blocked_or_error' and report['all_checks_passed'] is False
    assert 'real Windows GitHub runner' in report['error']['message']
    with pytest.raises(RuntimeError, match='real Windows GitHub runner'):
        runner.run_contract_audit(object(), base_url='unused', data_dir='unused', output_dir=tmp_path,
            repository_root=tmp_path, expected_web_tree='a' * 40, expected_server_tree='b' * 40,
            suite='strategy-success')


def test_strategy_success_has_disjoint_registry_and_fixture_destinations():
    suite = config.audit_suite('strategy-success')
    assert suite['mode'] == 'product-strategy-success'
    assert suite['report'] == 'product-strategy-success-audit.json'
    assert suite['runner_platform'] == 'windows'
    assert suite['fixture_files'] == tuple(f'strategy-success-input-{index}.csv' for index in range(1, 4))
    assert tuple(code for code, _ in suite['scenarios']) == ('L13-strategy-success',)
    assert config.audit_artifact_kinds('strategy-success') == ('download', 'synthetic-input')
    assert not suite.get('database_fault_injection') and not suite.get('legacy_history_preparation')
    for name, old in config.AUDIT_SUITES.items():
        if name != 'strategy-success':
            assert old['mode'] != suite['mode'] and old['report'] != suite['report']
    registry = runner.scenario_registry(repository_root='unused', data_dir='unused',
        expected_web_tree='a' * 40, expected_server_tree='b' * 40)
    function = registry['L13-strategy-success']
    assert function.func.__module__ == 'scripts.product_strategy_success'
    assert function.func.__name__ == 'strategy_success_journey'
    assert function.keywords == {'repository_root': 'unused', 'data_dir': 'unused',
        'expected_web_tree': 'a' * 40, 'expected_server_tree': 'b' * 40}
    assert native_acceptance.product_browser_options('strategy-success', 'a' * 40, 'b' * 40) == [
        '--suite', 'strategy-success', '--expected-web-tree', 'a' * 40, '--expected-server-tree', 'b' * 40]


def test_preparation_clears_new_current_outputs_without_touching_earlier_evidence(tmp_path):
    from scripts.prepare_evidence import prepare
    evidence = tmp_path / 'evidence'
    evidence.mkdir()
    names = [f'product-strategy-success{suffix}' for suffix in (
        '-audit.json', '-service-command.json', '-transfer-status.json', '-server.log',
        '-service-browser.log', '-process-events.jsonl')]
    for name in names:
        (evidence / name).write_text('old')
    old_directory = evidence / 'old-strategy-consent-capture'
    old_directory.mkdir()
    (old_directory / 'result.json').write_text('preserve')
    receipt = prepare(tmp_path)
    assert set(names) <= set(receipt['cleared_outputs'])
    assert (old_directory / 'result.json').read_text() == 'preserve'


def test_windows_only_ci_adds_one_bounded_job_and_preserves_original_linux_hold():
    root = Path(__file__).resolve().parents[1]
    workflow = (root / '.github/workflows/ci.yml').read_text()
    def section(name):
        return re.search(r'^  ' + name + r':\n(.*?)(?=^  [a-z][a-z-]*:|\Z)', workflow, re.M | re.S).group(1)
    job = section('product-strategy-success')
    assert 'runs-on: ${{ matrix.os }}' in job and 'os: [windows-latest]' in job
    assert 'ubuntu' not in job and 'timeout-minutes: 15' in job
    assert 'python -m pip install -r requirements-dev.txt' in job
    assert 'python -m playwright install --with-deps chromium' in job
    assert 'python scripts/native_acceptance.py --product-strategy-success ' in job
    assert 'python scripts/pack_product_audit.py --suite strategy-success' in job
    assert job.count('uses: actions/upload-artifact@v4') == 17
    assert job.count('if: always()') == 18 and job.count('retention-days: 14') == 17
    assert job.count('if-no-files-found: ignore') == 16
    for part in range(1, 17):
        assert f'name: product-strategy-success-${{{{ matrix.os }}}}-part-{part:02d}\n' in job
        assert f'path: evidence/product-strategy-success-transfer/part-{part:02d}/\n' in job
    for name in ('audit.json', 'service-command.json', 'transfer-status.json'):
        assert f'evidence/product-strategy-success-{name}' in job
    assert 'evidence/product-strategy-success-transfer/manifest.json' in job
    old = section('product-strategy-consent')
    assert 'Record blocked L9 Linux access' in old
    assert "if: matrix.os == 'ubuntu-latest'" in old
    assert "if: always() && matrix.os != 'ubuntu-latest'" in old
    assert 'python scripts/record_strategy_access_block.py' in old
    assert 'os: [ubuntu-latest, windows-latest]' in old
    assert 'timeout=300' in (root / 'scripts/native_acceptance.py').read_text()
    jobs = re.findall(r'^  ([a-z][a-z-]*):\n', workflow, re.M)
    assert len(jobs) == 21
    assert sum(2 if 'os: [ubuntu-latest, windows-latest]' in section(name) else 1 for name in jobs) == 40
