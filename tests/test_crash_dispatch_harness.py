"""Collector contracts; real socket/process acceptance runs as its own CI stage."""
from pathlib import Path
from types import SimpleNamespace
import json

import pytest

from scripts import crash_dispatch_check as harness


@pytest.fixture(autouse=True)
def isolated_source_identity(monkeypatch):
    # Collector unit tests never start external commands. The standalone HTTP
    # stage exercises actual Git/OwnedProcess identity collection.
    monkeypatch.setattr(harness, 'source_identity', lambda *args:{'git_head':'f'*40,'files_sha256':{'fixture.py':'a'*64}})


def test_reserves_cleanup_and_reporting_inside_one_stage_deadline(monkeypatch, tmp_path):
    times = []
    clock = [1000.0]
    monkeypatch.setattr(harness.time, 'monotonic', lambda: clock[0])
    def case(name, directory, owned, process_deadline, work_deadline, record):
        times.append((process_deadline, work_deadline))
        clock[0] += 5
        record['passed'] = True
    monkeypatch.setattr(harness, 'run_case', case)
    assert harness.run(tmp_path) == 0
    report = json.loads((tmp_path/'crash-dispatch-http.json').read_text())
    assert times == [(1118, 1110)] * 4
    assert report['budget_seconds'] == 120 and report['cleanup_reserve_seconds'] == 8
    assert report['report_reserve_seconds'] == 2 and report['elapsed_seconds'] == 20
    assert report['passed'] and report['cleanup_confirmed']


def test_expired_work_deadline_does_not_start_another_http_request(monkeypatch):
    monkeypatch.setattr(harness.time, 'monotonic', lambda: 50)
    calls = []
    client = SimpleNamespace(request=lambda *args, **kwargs: calls.append(args))
    with pytest.raises(TimeoutError, match='aggregate work deadline'):
        harness.request(client, 'GET', '/not-called', 50)
    assert not calls


def test_failure_retains_first_round_and_a_rerun_does_not_overwrite_it(monkeypatch, tmp_path):
    roots = []
    def make_root(**kwargs):
        path = tmp_path / ('isolated-' + str(len(roots)))
        path.mkdir(); roots.append(path)
        return str(path)
    monkeypatch.setattr(harness.tempfile, 'mkdtemp', make_root)
    def failed(name, directory, owned, process_deadline, work_deadline, record):
        record['boundary_diagnostic'] = 'original failure snapshot'
        raise AssertionError('first boundary failed')
    monkeypatch.setattr(harness, 'run_case', failed)
    out = tmp_path/'out'
    assert harness.run(out) == 1
    initial = (roots[0]/'failure-report.json').read_bytes()
    assert json.loads(initial)['cases'][0]['boundary_diagnostic'] == 'original failure snapshot'
    monkeypatch.setattr(harness, 'run_case', lambda *args: args[-1].update(passed=True))
    assert harness.run(out) == 0
    assert (roots[0]/'failure-report.json').read_bytes() == initial
    assert not roots[1].exists()


def test_unconfirmed_cleanup_is_failure_and_preserves_temporary_files(monkeypatch, tmp_path):
    isolated = tmp_path/'isolated';isolated.mkdir()
    monkeypatch.setattr(harness.tempfile, 'mkdtemp', lambda **kwargs:str(isolated))
    monkeypatch.setattr(harness, 'run_case', lambda *args: args[-1].update(passed=True))
    monkeypatch.setattr(harness, 'cleanup_owned', lambda owned:[{'cleanup_confirmed':False,'error':'guardian missing'}])
    assert harness.run(tmp_path/'out') == 1
    report = json.loads((tmp_path/'out/crash-dispatch-http.json').read_text())
    assert not report['passed'] and not report['cleanup_confirmed']
    assert report['retained_temporary_root'] == str(isolated)
    assert (isolated/'failure-report.json').exists()


def test_cleanup_cancels_all_children_before_wait_and_handles_receipt_failure(tmp_path):
    events = []
    class Process:
        def __init__(self, label):self.label = label
        def request_cancel(self):events.append('cancel-' + self.label)
        def wait(self):
            events.append('wait-' + self.label)
            if self.label == 'one':raise OSError('missing guardian receipt')
            return SimpleNamespace(as_dict=lambda:{'cleanup_confirmed':True})
    owned = [(SimpleNamespace(case='fixture',phase=label,log=tmp_path/'absent.log'),Process(label))
             for label in ('one','two')]
    result = harness.cleanup_owned(owned)
    assert events == ['cancel-one','cancel-two','wait-one','wait-two']
    assert result[0]['cleanup_confirmed'] is False and 'missing guardian receipt' in result[0]['error']
    assert result[1]['cleanup_confirmed'] is True


def test_first_write_invalidates_success_before_starting_any_server(monkeypatch, tmp_path):
    report_path = tmp_path/'crash-dispatch-http.json'
    report_path.write_text('{"passed":true}')
    observed = []
    def case(*args):
        observed.append(json.loads(report_path.read_text()))
        raise RuntimeError('do not launch fixture servers')
    monkeypatch.setattr(harness, 'run_case', case)
    assert harness.run(tmp_path) == 1
    assert len(observed) == 1
    assert observed[0]['passed'] is False and observed[0]['status'] == 'not_started'
    retained = Path(json.loads(report_path.read_text())['retained_temporary_root'])
    harness.shutil.rmtree(retained)  # Fixture-only collector failure, not live-process evidence.


def test_late_return_cannot_report_pass_even_when_cases_return_success(monkeypatch, tmp_path):
    clock = [1000.0]
    monkeypatch.setattr(harness.time, 'monotonic', lambda:clock[0])
    def case(*args):
        clock[0] += 30
        args[-1]['passed'] = True
    monkeypatch.setattr(harness, 'run_case', case)
    assert harness.run(tmp_path) == 1
    report = json.loads((tmp_path/'crash-dispatch-http.json').read_text())
    assert report['passed'] is False and report['status'] == 'failed' and report['budget_error']
    harness.shutil.rmtree(report['retained_temporary_root'])


@pytest.mark.parametrize('mutation', ['duplicate_reservation', 'repeat_provider_entry', 'extra_context_debit'])
def test_recovery_verdict_rejects_duplicate_dispatch_or_extra_debit(mutation):
    initial = {'id':'original-call','node_id':'analyst','characters':100}
    before = {'calls':[initial], 'provider_journal':[{'node_id':'analyst','event':'sent'}]}
    after = {'calls':[dict(initial)], 'provider_journal':list(before['provider_journal'])}
    if mutation == 'duplicate_reservation':
        after['calls'].append({**initial,'id':'second-call'})
    elif mutation == 'repeat_provider_entry':
        after['provider_journal'].append({'node_id':'analyst','event':'provider_entered'})
    else:
        after['calls'][0]['characters'] += 1
    with pytest.raises(AssertionError, match='re-reserved|re-entered|debited'):
        harness.validate_recovery('sent_no_response', before, after, {}, {})


def test_changed_source_fails_otherwise_successful_cases(monkeypatch,tmp_path):
    identities = iter([{'git_head':'a'*40,'files_sha256':{'server/app.py':'one'}},
                       {'git_head':'a'*40,'files_sha256':{'server/app.py':'two'}}])
    monkeypatch.setattr(harness,'source_identity',lambda *args:next(identities))
    monkeypatch.setattr(harness,'run_case',lambda *args:args[-1].update(passed=True))
    assert harness.run(tmp_path)==1
    report=json.loads((tmp_path/'crash-dispatch-http.json').read_text())
    assert report['source_unchanged'] is False and report['passed'] is False
    harness.shutil.rmtree(report['retained_temporary_root'])
