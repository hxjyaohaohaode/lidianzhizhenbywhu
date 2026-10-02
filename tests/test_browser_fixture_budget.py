"""Synthetic capacity setup respects the unchanged HTTP rate limit before writes."""
import pytest
from scripts.service_browser_check import FixtureRequestBudget, assert_form_errors


def test_fixture_budget_skips_non_api_and_separate_auth_window():
    budget = FixtureRequestBudget(lambda: 1)
    for path in ('/', '/assets/app.js', '/api/auth/me', '/api/auth/login'):
        budget.record('http://127.0.0.1:8000' + path)
    assert not budget.requests
    for _ in range(300):
        budget.record('http://127.0.0.1:8000/api/workspace/comparisons')
    assert budget.reserve(300, lambda _: pytest.fail('No wait required')) == 0


def test_fixture_budget_waits_for_measured_window_not_a_http_error_or_retry():
    clock = [10.0]; waits = []
    budget = FixtureRequestBudget(lambda: clock[0])
    for _ in range(301):
        budget.record('http://127.0.0.1:8000/api/workspace/comparisons')
    clock[0] = 55
    def advance(seconds):
        waits.append(seconds); clock[0] += seconds
    assert budget.reserve(300, advance) == 15.05
    assert len(waits) == 1 and not budget.requests


def test_fixture_budget_is_bounded_with_no_security_limit_override():
    clock = [0.0]
    budget = FixtureRequestBudget(lambda: clock[0])
    for count in (0, 601):
        with pytest.raises(ValueError): budget.reserve(count)
    for _ in range(301): budget.record('/api/workspace/comparisons')
    def busy(seconds):
        clock[0] += seconds
        for _ in range(301): budget.record('/api/workspace/comparisons')
    with pytest.raises(RuntimeError, match='65 seconds'): budget.reserve(300, busy)


@pytest.mark.parametrize('messages', [[], [' ', '\n']])
def test_form_error_snapshot_handles_replaced_form_without_waiting_for_old_elements(messages):
    class Page:
        calls = 0
        def locator(self, selector):
            assert selector == '#import-file-form .form-error'
            return self
        def all_text_contents(self):
            self.calls += 1
            return messages
        def count(self): pytest.fail('A separate count would reintroduce the transition race')
        def inner_text(self): pytest.fail('Never wait for the removed form')
    page = Page()
    assert_form_errors(page, '#import-file-form')
    assert page.calls == 1


def test_form_error_snapshot_still_fails_on_real_nonempty_errors():
    class Page:
        def locator(self, selector): return self
        def all_text_contents(self): return ['  ', '  数据版本已变化  ']
    with pytest.raises(AssertionError, match='数据版本已变化'):
        assert_form_errors(Page(), '#import-file-form')
