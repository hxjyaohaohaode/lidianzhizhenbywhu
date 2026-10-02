"""The acceptance helper observes exactly one original submission and its error."""
import pytest

from scripts.service_browser_check import FORM_COMPLETION, UI_TIMEOUT_MS, submit_form


class Form:
    def __init__(self, errors=(), failure=None):
        self.errors=errors;self.failure=failure;self.calls=[]

    def query_selector(self, selector):
        assert selector=='button[type="submit"]'
        self.calls.append('button')
        return self

    def click(self):self.calls.append('click')

    def evaluate(self, expression, timeout):
        assert expression==FORM_COMPLETION and timeout==UI_TIMEOUT_MS==10000
        self.calls.append('completion')
        if self.failure:raise self.failure
        return self.errors


class Page:
    def __init__(self, form):self.form=form;self.lookups=[]
    def locator(self, selector):
        assert selector=='#preferences-form'
        self.lookups.append(selector)
        return self
    def element_handle(self):return self.form
    def wait_for_timeout(self, _):pytest.fail('No fixed-duration completion wait')


def test_submit_uses_original_form_once_with_unchanged_bound():
    form=Form(['', '  ']);page=Page(form)
    submit_form(page,'#preferences-form')
    assert form.calls==['button','click','completion']
    assert page.lookups==['#preferences-form']


def test_submit_preserves_original_error_without_requerying_a_replacement():
    form=Form([' ', ' 数据版本已变化 ']);page=Page(form)
    with pytest.raises(AssertionError,match='^数据版本已变化$'):
        submit_form(page,'#preferences-form')
    assert page.lookups==['#preferences-form']
    assert form.calls.count('click')==1


@pytest.mark.parametrize('message', ['Submission did not finish within 10000 ms', 'Execution context was destroyed'])
def test_submit_does_not_turn_timeout_or_navigation_failure_into_success_or_retry(message):
    failure=RuntimeError(message);form=Form(failure=failure)
    with pytest.raises(RuntimeError) as raised:submit_form(Page(form),'#preferences-form')
    assert raised.value is failure
    assert form.calls.count('click')==1


def test_missing_original_form_is_not_submission_success():
    with pytest.raises(AssertionError,match='Submission form is missing'):
        submit_form(Page(None),'#preferences-form')
