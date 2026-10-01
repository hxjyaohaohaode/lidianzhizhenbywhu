"""Synthetic capacity setup respects the unchanged HTTP rate limit before writes."""
import pytest
from scripts.service_browser_check import FixtureRequestBudget


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
