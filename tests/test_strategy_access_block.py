"""A declared external access hold never becomes a passing native result."""
import json
from pathlib import Path
import re
import pytest
from scripts import prepare_evidence, record_strategy_access_block as block


def current():
    return {'GITHUB_SHA': 'a' * 40, 'GITHUB_EVENT_NAME': 'pull_request',
            'GITHUB_RUN_ID': '200', 'GITHUB_RUN_ATTEMPT': '1',
            'GITHUB_JOB': 'product-strategy-consent', 'RUNNER_OS': 'Linux'}


@pytest.mark.parametrize('event', ['push', 'pull_request', 'workflow_dispatch'])
def test_current_block_and_original_denial_have_distinct_bound_identities(tmp_path, event):
    context = current(); context['GITHUB_EVENT_NAME'] = event
    value = block.write_blocked(tmp_path, context, commit='a' * 40, tree='b' * 40)
    saved = json.loads((tmp_path / 'product-strategy-consent-access-blocked.json').read_text())
    assert saved == value and saved['status'] == 'blocked' and saved['exit_code'] == 1
    assert all(saved[k] is False for k in ('complete', 'all_checks_passed', 'native_started', 'browser_download_attempted'))
    assert saved['current_run']['checked_out_commit'] == 'a' * 40
    assert saved['current_run']['tree'] == 'b' * 40
    assert saved['current_run']['GITHUB_RUN_ID'] == '200'
    assert saved['current_run']['GITHUB_EVENT_NAME'] == event
    assert saved['original_denial']['head_commit'] == '80477de95cb4d38b96c1a31c3686ac3233c55504'
    assert saved['original_denial']['run_id'] == '37426800700'
    assert saved['original_denial']['download_status'] == 403


@pytest.mark.parametrize('key,value', [('GITHUB_JOB', 'regression'), ('RUNNER_OS', 'Windows'),
                                      ('GITHUB_SHA', 'c' * 40), ('GITHUB_RUN_ID', '')])
def test_unrelated_or_unbound_invocation_cannot_emit_l9_block(tmp_path, key, value):
    context = current(); context[key] = value
    with pytest.raises(ValueError):
        block.write_blocked(tmp_path, context, commit='a' * 40, tree='b' * 40)
    assert not list(tmp_path.iterdir())


def test_recorder_only_reads_git_and_returns_failure_without_native_work(tmp_path, monkeypatch):
    # Unit fixture for the receipt writer, never a browser/runtime admission.
    monkeypatch.setattr(block, 'ROOT', tmp_path)
    monkeypatch.setenv('GITHUB_ACTIONS', 'true')
    for key, value in current().items(): monkeypatch.setenv(key, value)
    calls = []
    def git(command, **kwargs):
        calls.append(command)
        assert command[:2] == ['git', 'rev-parse'] and kwargs['timeout'] == 5
        return ('a' if command[2] == 'HEAD' else 'b') * 40
    monkeypatch.setattr(block.subprocess, 'check_output', git)
    assert block.main() == 1
    assert calls == [['git', 'rev-parse', 'HEAD'], ['git', 'rev-parse', 'HEAD^{tree}']]
    assert list((tmp_path / 'evidence').iterdir()) == [tmp_path / 'evidence/product-strategy-consent-access-blocked.json']


def test_new_attempt_removes_old_access_hold_without_erasing_history(tmp_path):
    e = tmp_path / 'evidence'; e.mkdir()
    old = e / 'product-strategy-consent-access-blocked.json'; old.write_text('old hold')
    history = e / 'history'; history.mkdir(); (history / 'original-denial.json').write_text('original')
    receipt = prepare_evidence.prepare(tmp_path)
    assert old.name in receipt['cleared_outputs'] and not old.exists()
    assert (history / 'original-denial.json').read_text() == 'original'


def test_only_named_linux_strategy_branch_is_held_and_cannot_silently_pass():
    text = (Path(__file__).parents[1] / '.github/workflows/ci.yml').read_text()
    section = re.search(r'^  product-strategy-consent:\n(.*?)(?=^  product-report-history:)', text, re.M | re.S).group(1)
    assert 'os: [ubuntu-latest, windows-latest]' in section
    assert "if: matrix.os == 'ubuntu-latest'\n        run: python scripts/record_strategy_access_block.py" in section
    steps = re.split(r'(?m)^      - ', section)
    for command in ('python -m pip install -r requirements-dev.txt',
                    'python -m playwright install --with-deps chromium',
                    'python scripts/native_acceptance.py --product-strategy-consent'):
        matching = [step for step in steps if command in step]
        assert len(matching) == 1 and "if: matrix.os != 'ubuntu-latest'" in matching[0]
    pack = [step for step in steps if 'python scripts/pack_product_audit.py --suite strategy-consent' in step]
    assert len(pack) == 1 and "if: always() && matrix.os != 'ubuntu-latest'" in pack[0]
    upload = [step for step in steps if 'name: product-strategy-consent-${{ matrix.os }}-summary' in step]
    assert len(upload) == 1 and 'if: always()' in upload[0]
    assert 'evidence/product-strategy-consent-access-blocked.json' in upload[0]
    assert 'continue-on-error' not in section
    assert 'record_strategy_access_block.py' not in text.replace(section, '')
