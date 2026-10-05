"""No-browser runner contracts: isolation, evidence and fail-closed lifecycle."""
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace

import pytest

from scripts import native_acceptance, product_browser_audit as runner
from scripts.product_audit_config import audit_suite
from scripts.product_first_use_audit import REVIEWED_WEB, REVIEWED_SERVER


@pytest.mark.parametrize('flag,suite', [('--product-audit', 'contract'), ('--product-first-use', 'first-use'), ('--product-integrity','integrity'),('--product-comparison-integrity','comparison-integrity'),('--product-source-integrity','source-integrity'),('--product-tracking-integrity','tracking-integrity'),('--product-plan-history','plan-history')])
def test_local_native_modes_stop_before_socket_process_or_browser(tmp_path, monkeypatch, flag, suite):
    monkeypatch.setattr(native_acceptance, 'ROOT', tmp_path)
    monkeypatch.setattr(sys, 'argv', ['native_acceptance.py', flag])
    monkeypatch.delenv('GITHUB_ACTIONS', raising=False)
    def prohibited(*args, **kwargs):
        pytest.fail('A local audit cannot open a socket, spawn a server, or run a browser command')
    monkeypatch.setattr(native_acceptance.socket, 'socket', prohibited)
    monkeypatch.setattr(native_acceptance.subprocess, 'Popen', prohibited)
    monkeypatch.setattr(native_acceptance.subprocess, 'run', prohibited)
    with pytest.raises(SystemExit, match='GitHub runner'):
        native_acceptance.main()
    report = json.loads((tmp_path / 'evidence' / audit_suite(suite)['report']).read_text())
    assert report['suite'] == suite and report['all_checks_passed'] is False


@pytest.mark.parametrize('suite',['contract','first-use','integrity','comparison-integrity','source-integrity','tracking-integrity','plan-history'])
def test_native_subprocess_receives_selected_suite_and_both_protected_tree_ids(suite):
    assert native_acceptance.product_browser_options(suite,'a'*40,'b'*40)==[
        '--suite',suite,'--expected-web-tree','a'*40,'--expected-server-tree','b'*40]
    with pytest.raises(ValueError):native_acceptance.product_browser_options('not-a-suite','a'*40,'b'*40)


def test_suite_destinations_and_registry_are_disjoint_with_l6_history():
    contract, first_use, integrity, comparison_integrity, source_integrity, tracking_integrity, plan_history = [audit_suite(name) for name in ('contract', 'first-use', 'integrity','comparison-integrity','source-integrity','tracking-integrity','plan-history')]
    assert len({x['mode'] for x in (contract,first_use,integrity,comparison_integrity,source_integrity,tracking_integrity,plan_history)})==7
    assert len({x['report'] for x in (contract,first_use,integrity,comparison_integrity,source_integrity,tracking_integrity,plan_history)})==7
    assert contract['mode'] != first_use['mode'] and contract['report'] != first_use['report']
    assert contract['mode'] == 'product-audit' and contract['report'] == 'product-browser-audit.json'
    assert contract['scenarios'] == runner.SCENARIOS
    registry = runner.scenario_registry(repository_root='unused', data_dir='unused',
        expected_web_tree=REVIEWED_WEB, expected_server_tree=REVIEWED_SERVER)
    assert tuple(registry) == ('F1-trace-handoff', 'F2-forecast-units', 'F3-report-points', 'L1-first-use-report',
        'I1-import-integrity','I2-report-integrity','I3-memory-integrity','I4-comparison-integrity','I5-review-scope','I6-dataset-source','I7-tracking-source','L6-plan-history')
    assert registry['L1-first-use-report'].keywords['expected_web_tree'] == REVIEWED_WEB
    assert tuple(code for code, _ in first_use['scenarios']) == ('L1-first-use-report',)
    assert integrity['database_fault_injection'] is True and comparison_integrity['database_fault_injection'] is True
    assert tuple(code for code,_ in comparison_integrity['scenarios'])==('I4-comparison-integrity',)
    assert registry['I4-comparison-integrity'].keywords['expected_web_tree']==REVIEWED_WEB
    assert source_integrity['database_fault_injection'] is True
    assert tracking_integrity['database_fault_injection'] is True
    assert tuple(code for code,_ in tracking_integrity['scenarios'])==('I7-tracking-source',)
    assert registry['I7-tracking-source'].keywords['expected_server_tree']==REVIEWED_SERVER
    assert tuple(code for code,_ in source_integrity['scenarios'])==('I5-review-scope','I6-dataset-source')
    assert all(registry[code].keywords['expected_server_tree']==REVIEWED_SERVER for code,_ in source_integrity['scenarios'])
    assert all(registry[code].keywords['expected_server_tree']==REVIEWED_SERVER for code,_ in integrity['scenarios'])
    assert tuple(code for code,_ in plan_history['scenarios'])==('L6-plan-history',)
    assert not plan_history.get('database_fault_injection')
    assert registry['L6-plan-history'].keywords['expected_server_tree']==REVIEWED_SERVER
    with pytest.raises(ValueError, match='Unknown'):
        audit_suite('L6')


def test_preparation_clears_only_known_first_use_root_outputs(tmp_path):
    from scripts.prepare_evidence import prepare
    evidence = tmp_path / 'evidence'
    evidence.mkdir()
    names = ('product-first-use-audit.json', 'product-first-use-service-command.json',
        'product-first-use-transfer-status.json', 'product-first-use-server.log',
        'product-first-use-service-browser.log', 'product-first-use-process-events.jsonl')
    for name in names:
        (evidence / name).write_text('stale output')
    archive = evidence / 'unrelated-historical-audit'
    archive.mkdir()
    (archive / 'report.json').write_text('keep historical evidence')
    (evidence / 'historical-review.json').write_text('keep unrelated report')
    receipt = prepare(tmp_path)
    assert set(names) <= set(receipt['cleared_outputs'])
    assert (archive / 'report.json').read_text() == 'keep historical evidence'
    assert (evidence / 'historical-review.json').read_text() == 'keep unrelated report'


class FakeContext:
    """Records lifecycle without importing or calling Playwright."""
    def __init__(self, configuration, *, broken_trace=False):
        self.configuration = configuration
        self.closed = False
        self.trace_started = False
        self.broken_trace = broken_trace
        self.tracing = SimpleNamespace(start=self.start, stop=self.stop)
        video = Path(configuration['record_video_dir']) / 'contract-only.webm'
        video.parent.mkdir(parents=True)
        self.video_file = video
        self.page = SimpleNamespace(video=SimpleNamespace(path=lambda: str(video)),
            set_default_timeout=lambda _: None, on=lambda *args: None, screenshot=self.screenshot)

    def start(self, **kwargs):
        assert kwargs == {'screenshots': True, 'snapshots': True, 'sources': True}
        self.trace_started = True

    def stop(self, *, path):
        if self.broken_trace:
            raise RuntimeError('contract-only trace finalization failure')
        Path(path).write_bytes(b'contract-only fake trace')

    def new_page(self):
        return self.page

    def screenshot(self, *, path, full_page, timeout):
        Path(path).write_bytes(b'contract-only fake pixels:' + str(full_page).encode())

    def close(self):
        self.closed = True
        self.video_file.write_bytes(b'contract-only fake video')


@pytest.mark.parametrize('failure,broken_trace,expected', [(None, False, 'passed'),
    (AssertionError('outcome missing'), False, 'failed'),
    (RuntimeError('adapter incomplete'), False, 'blocked_or_error'),
    (None, True, 'evidence_incomplete')])
def test_first_use_reuses_capture_finalize_and_failure_contract(tmp_path, monkeypatch, failure, broken_trace, expected):
    monkeypatch.syspath_prepend(str(Path(runner.__file__).parent))
    monkeypatch.setattr(runner, 'require_isolated_runner', lambda *args: None)
    identity = {'head': 'fixture', 'protected_tree_ids': {'web': REVIEWED_WEB, 'server': REVIEWED_SERVER},
        'protected_diff': '', 'protected_untracked': '', 'protected_file_sha256': {}}
    monkeypatch.setattr(runner, 'git_identity', lambda _: identity.copy())
    contexts = []
    def new_context(**kwargs):
        context = FakeContext(kwargs, broken_trace=broken_trace)
        contexts.append(context)
        return context
    def scenario(probe):
        def action():
            path = probe.directory / 'current-only.csv'
            path.write_bytes(b'contract-only synthetic input')
            probe.record_artifact(path, kind='synthetic-input')
            if failure:
                raise failure
        probe.step('isolated runner contract, not product acceptance', action)
    monkeypatch.setattr(runner, 'scenario_registry', lambda **kwargs: {'L1-first-use-report': scenario})
    report = runner.run_contract_audit(SimpleNamespace(version='fake-contract-only', new_context=new_context),
        base_url='unused-no-network', data_dir='unused', output_dir=tmp_path / 'evidence/product-first-use',
        repository_root=tmp_path, expected_web_tree=REVIEWED_WEB, expected_server_tree=REVIEWED_SERVER,
        suite='first-use', submit_form=lambda *args: None)
    assert len(contexts) == 1 and contexts[0].closed and contexts[0].trace_started
    assert contexts[0].configuration['timezone_id'] == 'UTC'
    assert report['suite'] == 'first-use' and len(report['scenarios']) == 1
    result = report['scenarios'][0]
    assert result['status'] == expected and report['all_checks_passed'] == (expected == 'passed')
    assert {s['kind'] for s in result['screenshots']} == {'viewport', 'full-page'}
    assert result['video']['sha256'] and result['diagnostic_journal']['sha256']
    assert result['artifacts'][0]['file'] == 'current-only.csv'
    assert result['artifacts'][0]['sha256']
    assert ('trace' in result) is not broken_trace
    assert not (tmp_path / 'evidence/product-browser-audit.json').exists()


def test_artifact_registration_rejects_other_directory_and_duplicates(tmp_path):
    directory = tmp_path / 'L1'
    directory.mkdir()
    probe = runner.Probe(None, 'unused', directory, None)
    outside = tmp_path / 'unrelated.csv'
    outside.write_bytes(b'not scenario evidence')
    with pytest.raises(ValueError, match='directly'):
        probe.record_artifact(outside, kind='synthetic-input')
    current = directory / 'current.csv'
    current.write_bytes(b'current evidence')
    probe.record_artifact(current, kind='synthetic-input')
    with pytest.raises(ValueError, match='already recorded'):
        probe.record_artifact(current, kind='synthetic-input')


def test_existing_f_job_and_l1_job_keep_separate_bounded_contracts():
    root = Path(__file__).resolve().parents[1]
    after = (root / '.github/workflows/ci.yml').read_text()
    def section(name):return re.search(r'^  '+re.escape(name)+r':\n(.*?)(?=^  [a-z][a-z-]*:|\Z)',after,re.M|re.S).group(1)
    legacy_job,first_use,integrity,comparison_integrity,source_integrity,tracking_integrity,plan_history=[section(name) for name in ('product-audit','product-first-use','product-integrity','product-comparison-integrity','product-source-integrity','product-tracking-integrity','product-plan-history')]
    for job, mode, report_name, pack_options in (
        (legacy_job, 'product-audit', 'product-browser-audit.json', ''),
        (first_use, 'product-first-use', 'product-first-use-audit.json', ' --suite first-use'),
        (integrity, 'product-integrity', 'product-integrity-audit.json', ' --suite integrity'),
        (comparison_integrity, 'product-comparison-integrity', 'product-comparison-integrity-audit.json', ' --suite comparison-integrity'),
        (source_integrity, 'product-source-integrity', 'product-source-integrity-audit.json', ' --suite source-integrity'),
        (tracking_integrity, 'product-tracking-integrity', 'product-tracking-integrity-audit.json', ' --suite tracking-integrity'),
        (plan_history, 'product-plan-history', 'product-plan-history-audit.json', ' --suite plan-history'),
    ):
        assert 'timeout-minutes: 15' in job
        assert 'os: [ubuntu-latest, windows-latest]' in job
        command = re.search(r'python scripts/native_acceptance\.py ([^\n]+)', job)
        assert command and re.fullmatch(r'--' + mode +
            r' --expected-web-tree [0-9a-f]{40} --expected-server-tree [0-9a-f]{40}', command.group(1))
        assert 'python scripts/pack_product_audit.py' + pack_options + '\n' in job
        assert 'evidence/' + report_name + '\n' in job
        assert 'evidence/' + mode + '-transfer/manifest.json' in job
        assert job.count('path: evidence/' + mode + '-transfer/part-') == 16
    assert 'product-first-use' not in legacy_job
    assert 'product-browser-audit.json' not in first_use
