"""Pure bootstrap race contracts, not native-browser acceptance evidence."""
import ast
from pathlib import Path

import pytest

from scripts.product_browser_audit import FORM_TIMEOUT_MS, Probe


INTRO = 'dialog.brand-intro'
AUTH = '#auth-form'
ENTRY = '.auth-panel [data-action="auth-toggle"]'


class Locator:
    def __init__(self, page, selector):
        self.page, self.selector = page, selector

    def wait_for(self, *, state, timeout):
        p = self.page
        p.events.append(('wait', self.selector, state, timeout))
        assert timeout == FORM_TIMEOUT_MS
        if self.selector == INTRO:
            assert state == 'detached'  # Merely hidden is not completion.
            if p.finish == 'during-wait':
                p.intro_attached = False
            if p.intro_attached:
                raise TimeoutError('original intro is still attached')
        elif self.selector == '[data-intro-skip]':
            if not p.intro_attached:
                raise TimeoutError('expired skip control cannot become visible again')
        elif self.selector in (AUTH, ENTRY):
            assert state == 'visible'
            if p.missing == self.selector:
                raise TimeoutError('real registration control is missing or hidden')
        else:
            raise AssertionError('Unexpected selector: ' + self.selector)

    def count(self):
        return 2 if self.page.duplicate == self.selector else 1

    def click(self, *, trial=False, timeout=None):
        self.page.events.append(('click', self.selector, trial, timeout))
        assert self.selector == ENTRY and trial is True and timeout == FORM_TIMEOUT_MS
        if self.page.action_error:
            raise self.page.action_error
        assert not self.page.intro_attached


class Page:
    """Small lifecycle fake; no renderer, application, network or browser."""
    def __init__(self, finish='during-wait', *, missing=None, duplicate=None, action_error=None):
        self.finish = finish
        self.intro_attached = finish != 'already-ended'
        self.missing, self.duplicate, self.action_error = missing, duplicate, action_error
        self.events = []
        self.screenshot_count = 0

    def locator(self, selector):
        return Locator(self, selector)

    def screenshot(self, *, path, full_page, timeout):
        self.screenshot_count += 1
        # Match F3: viewport-before has the intro; full-page-before has login.
        if self.finish == 'between-before-screenshots' and self.screenshot_count == 2:
            self.intro_attached = False
        self.events.append(('screenshot', full_page, self.intro_attached))
        Path(path).write_bytes(b'pure-contract-only:' + str(self.intro_attached).encode())


@pytest.mark.parametrize('finish', ['during-wait', 'between-before-screenshots', 'already-ended'])
def test_original_intro_completion_requires_actionable_real_registration(tmp_path, finish):
    page = Page(finish)
    probe = Probe(page, 'unused-no-network', tmp_path, None)
    probe.await_registration_ready()
    assert probe.steps[0]['status'] == 'completed'
    assert probe.observations['registration_readiness'] == {
        'intro_detached': True, 'auth_form_visible': True,
        'registration_entry_actionable': True, 'skip_click_dispatched': False,
    }
    actions = [event for event in page.events if event[0] != 'screenshot']
    assert actions == [
        ('wait', INTRO, 'detached', FORM_TIMEOUT_MS),
        ('wait', AUTH, 'visible', FORM_TIMEOUT_MS),
        ('wait', ENTRY, 'visible', FORM_TIMEOUT_MS),
        ('click', ENTRY, True, FORM_TIMEOUT_MS),
    ]
    assert len(probe.screenshots) == 4
    if finish == 'between-before-screenshots':
        assert page.events[:2] == [('screenshot', False, True), ('screenshot', True, False)]


def test_regression_old_skip_path_fails_when_evidence_outlasts_intro(tmp_path):
    page = Page('between-before-screenshots')
    probe = Probe(page, 'unused-no-network', tmp_path, None)
    assert page.intro_attached  # The old pre-step visibility observation.
    with pytest.raises(TimeoutError, match='expired skip control'):
        probe.click('[data-intro-skip]')
    assert probe.steps[0]['status'] == 'failed'
    assert not any(event[0] == 'click' for event in page.events)


def test_missing_skip_button_does_not_excuse_stuck_or_hidden_intro(tmp_path):
    page = Page('stuck')
    probe = Probe(page, 'unused-no-network', tmp_path, None)
    with pytest.raises(TimeoutError, match='still attached'):
        probe.await_registration_ready()
    assert probe.steps[0]['status'] == 'failed'
    assert 'registration_readiness' not in probe.observations
    assert not any(event[0] == 'click' for event in page.events)


@pytest.mark.parametrize('selector', [AUTH, ENTRY])
@pytest.mark.parametrize('condition', ['missing', 'duplicate'])
def test_intro_disappearance_without_unique_visible_auth_is_not_success(tmp_path, selector, condition):
    page = Page('already-ended', **{condition: selector})
    probe = Probe(page, 'unused-no-network', tmp_path, None)
    with pytest.raises(TimeoutError if condition == 'missing' else AssertionError):
        probe.await_registration_ready()
    assert probe.steps[0]['status'] == 'failed'
    assert 'registration_readiness' not in probe.observations
    assert not any(event[0] == 'click' for event in page.events)


@pytest.mark.parametrize('error', [TimeoutError('entry disabled'), TimeoutError('entry covered'),
                                  RuntimeError('page closed')])
def test_actionability_or_transport_failure_is_never_suppressed(tmp_path, error):
    page = Page('already-ended', action_error=error)
    probe = Probe(page, 'unused-no-network', tmp_path, None)
    with pytest.raises(type(error), match=str(error)) as caught:
        probe.await_registration_ready()
    assert caught.value is error
    assert probe.steps[0]['status'] == 'failed'
    assert 'registration_readiness' not in probe.observations
    assert len(probe.screenshots) == 4  # Before plus after-failure evidence.


def test_both_bootstrap_paths_use_shared_readiness_before_real_registration_click():
    root = Path(__file__).resolve().parents[1] / 'scripts'
    for filename, function_name in [('product_browser_audit.py', 'bootstrap'),
                                    ('product_first_use_audit.py', 'register_empty_workspace')]:
        source = (root / filename).read_text()
        function = next(node for node in ast.walk(ast.parse(source))
                        if isinstance(node, ast.FunctionDef) and node.name == function_name)
        body = ast.get_source_segment(source, function)
        assert body.count('.await_registration_ready()') == 1
        assert body.index('.await_registration_ready()') < body.index('.click(\'[data-action="auth-toggle"]\'')
        assert '[data-intro-skip]' not in body
    source = (root / 'product_browser_audit.py').read_text()
    helper = next(node for node in ast.walk(ast.parse(source))
                  if isinstance(node, ast.FunctionDef) and node.name == 'await_registration_ready')
    assert not any(isinstance(node, ast.ExceptHandler) for node in ast.walk(helper))
