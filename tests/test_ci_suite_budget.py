"""Measured aggregate room must never loosen individual/product failure gates."""
from pathlib import Path
import re
import pytest
from scripts.verify import check_timeout


@pytest.mark.parametrize('name', ['python-compile','typecheck','build','frontend-tests','source-guard','full-chain-http'])
def test_other_verification_stages_keep_their_original_budget(name):
    assert check_timeout(name)==240


def test_backend_budget_does_not_change_whole_test_watchdog_or_failures():
    assert check_timeout('pytest')==1500
    source=(Path(__file__).parents[1]/'scripts/verify.py').read_text()
    shard_source=(Path(__file__).parents[1]/'scripts/pytest_shards.py').read_text()
    assert "test_timeout=120" in shard_source and "MAX_SECONDS = 1500" in shard_source
    assert "timeout=check_timeout(name)" in source
    assert "return 0 if report['all_executed_checks_pass'] else 1" in source
    assert "'all_executed_checks_pass':all(r['exit_code']==0 for r in results)" in source


def test_only_regression_job_envelope_expands_and_all_later_stages_remain():
    root=Path(__file__).parents[1]
    ci=(root/'.github/workflows/ci.yml').read_text()
    regression=re.search(r'^  regression:\n(.*?)(?=^  [a-z][a-z-]*:)',ci,re.M|re.S).group(1)
    assert 'timeout-minutes: 35' in regression
    for command in ['python scripts/verify.py --full-chain','python scripts/native_acceptance.py','python scripts/bootstrap.py --yes --no-browser']:
        assert command in regression
    assert 'fail-fast: false' in regression and 'os: [ubuntu-latest, windows-latest]' in regression
    rest=ci.replace(regression,'')
    assert 'timeout-minutes: 35' not in rest
    assert all(int(value)<=15 for value in re.findall(r'timeout-minutes: (\d+)',rest))
    native=(root/'scripts/native_acceptance.py').read_text()
    assert 'timeout=300' in native
