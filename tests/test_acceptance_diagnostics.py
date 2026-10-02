"""Acceptance observations stay bounded and never change network behavior."""
import json
from pathlib import Path
import subprocess
import sys
import threading
from types import SimpleNamespace

from scripts.acceptance_diagnostics import (
    EventJournal, attach_browser_diagnostics, message_metadata, route_metadata, safe_location,
)
from scripts.native_acceptance import observe_server_exit, partial_output


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]


def test_diagnostic_journal_is_bounded_and_records_wall_and_elapsed_clocks(tmp_path):
    clock = [5.0]
    path = tmp_path / 'events.jsonl'
    journal = EventJournal(path, lambda: clock[0], lambda: 'known-utc', limit=2)
    clock[0] = 5.25
    journal.emit('request', status=200)
    journal.emit('ignored')
    assert len(rows(path)) == 2  # Already flushed before close or a later failure.
    journal.close(); journal.close(); journal.emit('closed')
    result = rows(path)
    assert result[1]['utc'] == 'known-utc'
    assert result[1]['elapsed_seconds'] == .25
    assert result[-1]['events_written'] == 2
    assert result[-1]['events_dropped'] == 1


def test_location_and_console_metadata_omit_credentials_queries_and_arbitrary_text():
    sensitive = 'NeverLogThisSyntheticSecret'
    assert safe_location('http://127.0.0.1:8000/api/runs?token=' + sensitive + '#private') == '/api/runs'
    assert safe_location('https://user:' + sensitive + '@remote.invalid/private') == '[non-local location omitted]'
    assert safe_location('http://127.0.0.1:8000/api/runs/' + sensitive) == '/api/runs/:value'
    assert safe_location('data:text/plain,' + sensitive) == '[non-local location omitted]'
    value = message_metadata('Failed fetch net::ERR_CONNECTION_RESET; password=' + sensitive)
    assert value['network_codes'] == ['net::ERR_CONNECTION_RESET']
    assert sensitive not in json.dumps(value)
    assert value['text_omitted'] and len(value['message_sha256']) == 64
    assert route_metadata('agents:'+sensitive) == {'workspace':'agents','dynamic':True}
    assert route_metadata(sensitive) == {'workspace':'[unknown]','dynamic':False}


class FakePage:
    def __init__(self): self.callbacks = {}
    def on(self, event, callback): self.callbacks[event] = callback


class FakeRequest:
    method = 'GET'
    url = 'http://127.0.0.1:8000/api/runs?identity_id=not-recorded'
    resource_type = 'fetch'
    timing = {'startTime': 1000, 'responseEnd': 42}
    failure = 'net::ERR_CONNECTION_RESET'
    @property
    def headers(self): raise AssertionError('Never inspect headers')
    @property
    def post_data(self): raise AssertionError('Never inspect bodies')


def test_browser_events_capture_failed_and_successful_requests_without_fetching(tmp_path):
    path = tmp_path / 'events.jsonl'; journal = EventJournal(path)
    page = FakePage(); attach_browser_diagnostics(page, journal)
    failed = FakeRequest(); success = FakeRequest()
    page.callbacks['request'](failed)
    page.callbacks['requestfailed'](failed)
    page.callbacks['request'](success)
    page.callbacks['response'](SimpleNamespace(request=success, url=success.url, status=200))
    page.callbacks['requestfinished'](success)
    page.callbacks['console'](SimpleNamespace(type='error', text='net::ERR_CONNECTION_RESET secret-content',
        location={'url': 'http://127.0.0.1:8000/assets/api.js?secret', 'lineNumber': 20, 'columnNumber': 3}))
    page.callbacks['pageerror'](RuntimeError('secret-content'))
    page.callbacks['crash'](); page.callbacks['close'](); journal.close()
    result = rows(path)
    failure = next(row for row in result if row['event'] == 'requestfailed')
    assert failure['request_id'] == 1 and failure['timing']['responseEnd'] == 42
    assert failure['network_codes'] == ['net::ERR_CONNECTION_RESET']
    assert next(row for row in result if row['event'] == 'requestfinished')['request_id'] == 2
    assert next(row for row in result if row['event'] == 'console')['line'] == 20
    assert any(row['event'] == 'page_crashed' for row in result)
    assert 'secret-content' not in path.read_text() and 'not-recorded' not in path.read_text()


def test_process_observer_distinguishes_observed_exit_before_requested_cleanup(tmp_path):
    path = tmp_path / 'process.jsonl'; journal = EventJournal(path)
    cleanup = threading.Event()
    server = subprocess.Popen([sys.executable, '-c', 'raise SystemExit(7)'])
    observer = threading.Thread(target=observe_server_exit, args=(server, journal, cleanup))
    observer.start(); observer.join(timeout=10)
    assert not observer.is_alive()
    cleanup.set(); journal.close()
    exited = next(row for row in rows(path) if row['event'] == 'server_exit_observed')
    assert exited['exit_code'] == 7 and exited['cleanup_requested'] is False
    assert exited['utc'] and exited['elapsed_seconds'] >= 0


def test_process_observer_marks_intentional_cleanup_without_inventing_success(tmp_path):
    path = tmp_path / 'process.jsonl'; journal = EventJournal(path)
    cleanup = threading.Event(); cleanup.set()
    observe_server_exit(SimpleNamespace(wait=lambda: -15), journal, cleanup)
    journal.close()
    exited = next(row for row in rows(path) if row['event'] == 'server_exit_observed')
    assert exited['exit_code'] == -15 and exited['cleanup_requested'] is True
    assert 'all_checks_passed' not in exited


def test_timeout_partial_output_preserves_bytes_and_text_without_retry():
    exc = subprocess.TimeoutExpired(['test-only'], 300, output=b'partial\xff', stderr='tail')
    assert partial_output(exc) == 'partial\ufffdtail'


def test_current_ci_collects_and_clears_diagnostics(tmp_path):
    from scripts.prepare_evidence import prepare
    evidence = tmp_path / 'evidence'; evidence.mkdir()
    for name in ('native-browser-events.jsonl', 'native-process-events.jsonl', 'keep-history.json'):
        (evidence / name).write_text('{}')
    receipt = prepare(tmp_path)
    assert set(receipt['cleared_outputs']) == {'native-browser-events.jsonl', 'native-process-events.jsonl'}
    assert (evidence / 'keep-history.json').is_file()
    workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/ci.yml').read_text()
    assert 'evidence/*-browser-events.jsonl' in workflow
    assert 'evidence/*-process-events.jsonl' in workflow
