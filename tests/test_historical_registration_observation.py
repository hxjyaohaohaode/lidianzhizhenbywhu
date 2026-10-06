"""Instrumented timing/ownership contracts, never native browser evidence.

The real registration helper, Probe steps, response capture and submit_form run
against a deterministic page double. Virtual time includes every before/after
capture and the natural opening; no browser, sleeps or external calls occur.
"""
from types import SimpleNamespace

import pytest

from scripts import native_historical_fixture as fixture
from scripts import product_historical_warning_journey as journey
from scripts.product_browser_audit import FORM_TIMEOUT_MS, Probe
from scripts.product_first_use_audit import register_empty_workspace
from scripts.product_integrity_outcomes import _capture_response
from scripts.service_browser_check import FORM_COMPLETION, UI_TIMEOUT_MS, submit_form


class ResponseWindow:
    def __init__(self, page, predicate, timeout):
        self.page, self.predicate, self.timeout = page, predicate, timeout
        self.response = None

    def __enter__(self):
        self.start = self.page.ms
        self.deadline = self.start + self.timeout
        self.page.windows.append(self)
        self.page.events.append(('observe', self.start))
        return self

    @property
    def value(self):
        if self.response is None:
            self.page.advance(max(0, self.deadline - self.page.ms))
        if self.response is None:
            raise TimeoutError('No matching response within the original response window')
        return self.response

    def __exit__(self, kind, value, traceback):
        if kind is None:
            self.value


class RegistrationPage:
    def __init__(self, *, status=201, delay=140, missing=False, form_error='',
                 writes=None, response_path='/api/auth/register', response_method='POST'):
        self.ms, self.events, self.windows, self.pending, self.listeners = 0, [], [], [], []
        self.status, self.delay, self.missing, self.form_error = status, delay, missing, form_error
        self.writes = writes if writes is not None else [('POST', '/api/auth/register')]
        self.response_path, self.response_method = response_path, response_method
        self.clicks = 0

    def advance(self, ms):
        end = self.ms + ms
        for at, response in list(self.pending):
            if at <= end:
                for window in self.windows:
                    if window.start <= at <= window.deadline and window.predicate(response):
                        window.response = window.response or response
                self.pending.remove((at, response))
        self.ms = end

    def expect_response(self, predicate, timeout):
        assert timeout == FORM_TIMEOUT_MS == 10_000
        return ResponseWindow(self, predicate, timeout)

    def goto(self, url, **kwargs):
        self.events.append(('landing', url, kwargs))
        return SimpleNamespace(status=200, headers={'content-security-policy': "script-src 'self'"})

    def locator(self, selector):
        return RegistrationLocator(self, selector)

    def on(self, event, listener):
        assert event == 'request'
        self.listeners.append(listener)

    def remove_listener(self, event, listener):
        assert event == 'request'
        self.listeners.remove(listener)


class RegistrationLocator:
    def __init__(self, page, selector):
        self.page, self.selector = page, selector

    def wait_for(self, **kwargs):
        self.page.events.append(('wait', self.selector, kwargs))
        if self.selector == 'dialog.brand-intro':
            assert kwargs == {'state': 'detached', 'timeout': 10_000}
            self.page.advance(3000)

    def count(self):
        return 1

    def click(self, **kwargs):
        self.page.events.append(('entry-click', self.selector, kwargs))

    def fill(self, value):
        self.page.events.append(('fill', self.selector))

    def inner_text(self):
        assert self.selector == '#main'
        return '建立你的研究底稿 准备企业经营数据'

    def element_handle(self):
        assert self.selector == '#auth-form'
        self.page.events.append(('form-handle', self.page.ms))
        return RegistrationForm(self.page)


class RegistrationForm:
    def __init__(self, page):
        self.page = page

    def query_selector(self, selector):
        assert selector == 'button[type="submit"]'
        return self

    def click(self):
        p = self.page
        p.clicks += 1
        p.events.append(('submit-click', p.ms))
        for method, path in p.writes:
            request = SimpleNamespace(method=method, url='http://127.0.0.1:8000' + path)
            for listener in p.listeners:
                listener(request)
        if not p.missing:
            response = SimpleNamespace(status=p.status,
                url='http://127.0.0.1:8000' + p.response_path,
                request=SimpleNamespace(method=p.response_method),
                json=lambda: {'user': {'id': 'this-registration-owner'}})
            p.pending.append((p.ms + p.delay, response))

    def evaluate(self, script, timeout):
        assert script == FORM_COMPLETION and timeout == UI_TIMEOUT_MS == 10_000
        self.page.events.append(('form-completion', timeout))
        self.page.advance(min(self.page.delay, timeout))
        if self.page.delay > timeout:
            raise TimeoutError('Original form lifecycle exceeded 10000 ms')
        return [self.page.form_error]


def probe(tmp_path, **kwargs):
    page = RegistrationPage(**kwargs)
    p = Probe(page, 'http://127.0.0.1:8000', tmp_path, submit_form)
    def screenshot(suffix):
        page.events.append(('screenshot', p.step_no, suffix))
        page.advance(1200)
        return f'instrument-only-{p.step_no}-{suffix}'
    def get(path):
        page.events.append(('read', path))
        return {'providers': []} if path == '/api/capabilities' else {'items': []}
    p.screenshot, p.get = screenshot, get
    return p


def observe(p, operation):
    return _capture_response(p, 'POST', '/api/auth/register', operation)


def test_old_outer_window_reproduces_timeout_after_slow_preparation(tmp_path):
    p = probe(tmp_path)
    with pytest.raises(TimeoutError, match='original response window'):
        observe(p, lambda: register_empty_workspace(p))
    assert p.page.windows[0].start == 0
    submit_at = next(event[1] for event in p.page.events if event[0] == 'submit-click')
    assert submit_at > 10_000 and p.page.clicks == 1
    assert p.steps[-1]['status'] == 'completed'  # Empty workspace was reached.
    assert 'native_responses' not in p.observations


@pytest.mark.parametrize('delay', [140, 9999])
def test_submit_window_excludes_preparation_and_preserves_every_step(tmp_path, delay):
    p = probe(tmp_path, delay=delay)
    status, body = register_empty_workspace(p, observe_registration=lambda action: observe(p, action))
    assert status == 201 and body['user']['id'] == 'this-registration-owner'
    window = p.page.windows[0]
    submit_at = next(event[1] for event in p.page.events if event[0] == 'submit-click')
    assert window.start == submit_at > 10_000
    assert window.timeout == 10_000 and p.page.delay == delay and p.page.clicks == 1
    event_names = [event[0] for event in p.page.events]
    start = event_names.index('observe')
    assert event_names[start:start + 4] == ['observe', 'form-handle', 'submit-click', 'form-completion']
    assert p.observations['native_responses'] == [
        {'method': 'POST', 'path': '/api/auth/register', 'status': 201, 'error_code': None}]
    default_dir = tmp_path / 'default'; default_dir.mkdir()
    original = probe(default_dir, delay=delay)
    assert register_empty_workspace(original) is None
    assert original.page.windows == [] and original.page.clicks == 1
    assert [step['label'] for step in p.steps] == [step['label'] for step in original.steps]
    assert all(step['status'] == 'completed' and step['before'] and step['after'] for step in p.steps)
    # Timing and the optional observer are the only differences. In particular,
    # readiness, three fields, real submit lifecycle, screenshots and reads stay.
    assert [event for event in p.page.events if event[0] != 'observe'] == original.page.events


def run_until_preparation(monkeypatch, p, tmp_path, prepare):
    # This is an instrumented entry contract, not an override exposed to any
    # runner. Existing unpatched admission-denial tests remain mandatory.
    for name in ('require_history_admission', 'require_native_contract',
                 'require_history_environment', 'verified_closure'):
        monkeypatch.setattr(journey, name, lambda *args, **kwargs: None)
    monkeypatch.setattr(journey, 'prepare_native_history', prepare)
    journey.historical_warning_journey(p, repository_root=tmp_path, data_dir=tmp_path,
        expected_web_tree='a' * 40, expected_server_tree='b' * 40, admission_scope=fixture.SCOPE)


class PreparationReached(Exception):
    pass


def test_journey_uses_this_201_owner_only_after_empty_workspace_check(monkeypatch, tmp_path):
    p = probe(tmp_path)
    def prepare(received_probe, **kwargs):
        assert received_probe is p and kwargs['registration_owner'] == 'this-registration-owner'
        assert p.observations['historical_native_registration_owner'] == 'this-registration-owner'
        assert kwargs['admission_scope'] == fixture.SCOPE
        assert p.steps[-2]['label'] == '核对真实空工作台，不展示样例数值或完成结论'
        assert p.steps[-2]['status'] == 'completed'
        raise PreparationReached
    with pytest.raises(PreparationReached):
        run_until_preparation(monkeypatch, p, tmp_path, prepare)
    assert p.page.clicks == 1 and p.page.listeners == []


@pytest.mark.parametrize('damage', [
    {'status': 200}, {'status': 409}, {'status': 500}, {'missing': True}, {'delay': 10_001},
    {'form_error': 'Registration rejected'}, {'response_path': '/api/auth/login'}, {'response_method': 'GET'},
    {'writes': [('POST', '/api/auth/register'), ('POST', '/api/auth/register')]},
    {'writes': [('POST', '/api/auth/register'), ('POST', '/api/workspace/plans')]},
])
def test_failed_or_ambiguous_registration_never_prepares_or_retries(monkeypatch, tmp_path, damage):
    p = probe(tmp_path, **damage)
    def forbidden(*args, **kwargs):
        pytest.fail('Failed or duplicated registration must never prepare history')
    with pytest.raises((AssertionError, TimeoutError)):
        run_until_preparation(monkeypatch, p, tmp_path, forbidden)
    assert p.page.clicks == 1 and p.page.listeners == []
    assert 'historical_native_registration_owner' not in p.observations
    assert 'historical_preparation' not in p.observations


@pytest.mark.parametrize('response_owner,recorded_owner', [
    ('another-registration', 'current-owner'), ('current-owner', 'another-registration'),
    ('another-registration', 'another-registration'), ('current-owner', None),
])
def test_original_preparation_rechecks_current_login_before_any_database_write(
        monkeypatch, tmp_path, response_owner, recorded_owner):
    def forbidden(*args, **kwargs):
        pytest.fail('Owner mismatch must not open the database or record a receipt')
    monkeypatch.setattr(fixture, 'require_history_environment', lambda *args: tmp_path / 'unused.sqlite3')
    monkeypatch.setattr(fixture.sqlite3, 'connect', forbidden)
    p = SimpleNamespace(directory=tmp_path, record_artifact=forbidden,
        get=lambda path: {'user': {'id': 'current-owner'}} if path == '/api/auth/me' else forbidden(),
        observations={'historical_native_registration_owner': recorded_owner})
    with pytest.raises(RuntimeError, match='actual registration response'):
        fixture.prepare_native_history(p, data_dir=tmp_path, repository_root=tmp_path,
            registration_owner=response_owner, admission_scope=fixture.SCOPE)
    assert list(tmp_path.iterdir()) == []
