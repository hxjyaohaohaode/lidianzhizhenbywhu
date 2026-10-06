"""Durable pytest progress and a hard, whole-test watchdog for verification.

Only test identities, phase outcomes and timing are journaled, never captured
bodies, headers, credentials, fixture values or assertion representations.
Python's C watchdog dumps stacks and exits nonzero even during a deadlock. Its
cancel operation synchronizes with the watchdog before the next test is armed.
"""
from collections import Counter
from datetime import datetime, timezone
import faulthandler
import json
import math
from pathlib import Path
import sys
from time import monotonic, process_time

import pytest

MAX_TEST_SECONDS = 120


def pytest_addoption(parser):
    group = parser.getgroup('verification diagnostics')
    group.addoption('--diagnostics-output', required=False,
        help='Flushed JSONL progress file; stack dumps use its .stacks.log sibling')
    group.addoption('--diagnostics-test-timeout', type=float, default=MAX_TEST_SECONDS,
        help='Whole-test hard bound, including setup and teardown (maximum 120 seconds)')


def pytest_configure(config):
    # pytest's built-in exception hook cancels faulthandler timers after an
    # assertion failure. Replace it, so a subsequent teardown hang stays bounded.
    if config.pluginmanager.hasplugin('faulthandler'):
        raise pytest.UsageError('verification diagnostics requires -p no:faulthandler')
    # Admission creates diagnostics only after exact final shard selection.
    if config.getoption('--shard-request', default=None):
        return
    path = config.getoption('--diagnostics-output')
    timeout = config.getoption('--diagnostics-test-timeout')
    if not path or not math.isfinite(timeout) or not 0 < timeout <= MAX_TEST_SECONDS:
        raise pytest.UsageError('diagnostics requires an output and a finite timeout in (0, 120]')
    config.pluginmanager.register(Diagnostics(Path(path), timeout), 'verification-progress')


class Diagnostics:
    def __init__(self, path, timeout, *, identity=None, admission=None):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.output = path.open('w', encoding='utf-8', buffering=1)
        self.stacks = path.with_suffix('.stacks.log').open('w', encoding='utf-8', buffering=1)
        self.started_at = monotonic()
        self.timeout = timeout
        self.collected = []
        self.started = []
        self.completed = []
        self.phase_outcomes = Counter()
        self.phases = {}
        self.original_handler = faulthandler.is_enabled()
        faulthandler.enable(file=self.stacks, all_threads=True)
        self.emit('session_started', test_timeout_seconds=timeout, identity=identity, admission=admission)

    def emit(self, event, **fields):
        self.output.write(json.dumps({'event': event,
            'utc': datetime.now(timezone.utc).isoformat(),
            'elapsed_seconds': round(monotonic() - self.started_at, 6),
            'process_cpu_seconds': round(process_time(), 6), **fields},
            ensure_ascii=False) + '\n')
        self.output.flush()

    def pytest_collection_finish(self, session):
        self.collected = [item.nodeid for item in session.items]
        for nodeid in self.collected:
            self.emit('test_collected', nodeid=nodeid)
        self.emit('collection_finished', collected=len(self.collected))

    @pytest.hookimpl(wrapper=True, tryfirst=True)
    def pytest_runtest_protocol(self, item, nextitem):
        self.started.append(item.nodeid)
        self.phases = {}
        self.emit('test_started', nodeid=item.nodeid)
        # No Python Timer, retry or timer reset between phases. A slow setup
        # consumes the same 120-second budget as the call and final teardown.
        faulthandler.dump_traceback_later(self.timeout, file=self.stacks, exit=True)
        interrupted = True
        try:
            result = yield
            interrupted = False
            return result
        finally:
            faulthandler.cancel_dump_traceback_later()
            complete = not interrupted and 'setup' in self.phases and 'teardown' in self.phases
            if self.phases.get('setup') == 'passed':
                complete = complete and 'call' in self.phases
            if complete:
                self.completed.append(item.nodeid)
            self.emit('test_finished', nodeid=item.nodeid, complete=complete,
                interrupted=interrupted)

    @pytest.hookimpl(tryfirst=True)
    def pytest_runtest_setup(self, item):
        self.emit('phase_started', nodeid=item.nodeid, phase='setup')

    @pytest.hookimpl(tryfirst=True)
    def pytest_runtest_call(self, item):
        self.emit('phase_started', nodeid=item.nodeid, phase='call')

    @pytest.hookimpl(tryfirst=True)
    def pytest_runtest_teardown(self, item):
        self.emit('phase_started', nodeid=item.nodeid, phase='teardown')

    def pytest_runtest_logreport(self, report):
        self.phases[report.when] = report.outcome
        self.phase_outcomes[f'{report.when}_{report.outcome}'] += 1
        self.emit('phase_finished', nodeid=report.nodeid, phase=report.when,
            outcome=report.outcome, wasxfail=hasattr(report, 'wasxfail'),
            duration_seconds=round(report.duration, 6))

    @pytest.hookimpl(trylast=True)
    def pytest_sessionfinish(self, session, exitstatus):
        complete = bool(self.collected) and Counter(self.completed) == Counter(self.collected)
        # An incomplete or short-circuited protocol can never become a green
        # verification stage, even if another plugin returned success.
        if not complete and session.exitstatus == 0:
            session.exitstatus = pytest.ExitCode.TESTS_FAILED
        self.emit('session_finished', exit_code=int(session.exitstatus),
            collected=len(self.collected), started=len(self.started),
            completed=len(self.completed), complete=complete,
            phase_outcomes=dict(self.phase_outcomes))

    def pytest_unconfigure(self):
        faulthandler.cancel_dump_traceback_later()
        faulthandler.disable()
        if self.original_handler:
            faulthandler.enable(file=sys.__stderr__, all_threads=True)
        self.output.close()
        self.stacks.close()
