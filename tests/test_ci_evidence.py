"""CI failures preserve diagnostics and never inherit old acceptance success."""
import importlib.util
from pathlib import Path
import subprocess
import json
import re

ROOT=Path(__file__).resolve().parents[1]


def module(name):
    spec=importlib.util.spec_from_file_location('ci_test_'+name,ROOT/'scripts'/f'{name}.py')
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


def test_timeout_retains_partial_test_output_without_retry(monkeypatch):
    verify=module('verify');calls=[]
    def timeout(cmd,**kwargs):
        calls.append(kwargs['timeout'])
        raise subprocess.TimeoutExpired(cmd,kwargs['timeout'],output=b'123 tests passed\n\xe4',stderr=b'worker diagnostic')
    monkeypatch.setattr(verify.subprocess,'run',timeout)
    code,text=verify.execute_check(['python','-m','pytest'],600)
    assert code==1 and calls==[600]
    assert '123 tests passed' in text and 'worker diagnostic' in text and '600s budget' in text


def configure_verify(monkeypatch, tmp_path, *, backend_code=0, cleanup=True):
    verify=module('verify');calls=[]
    monkeypatch.setattr(verify,'ROOT',tmp_path)
    monkeypatch.setattr(verify.sys,'argv',['verify.py','--full-chain'])
    monkeypatch.setattr(verify.os,'chdir',lambda _:None)
    monkeypatch.setattr(verify,'execute_check',lambda cmd,timeout:(calls.append((cmd,timeout)) or (0,'passed')))
    def backend(out,timeout,deadline):
        calls.append((['pytest'],timeout))
        verify.clear_pytest_outputs(out)
        return backend_code,'watchdog stack output' if backend_code else 'passed', {
            'invocation_id':'current-fixture','cleanup_confirmed':cleanup}
    monkeypatch.setattr(verify,'execute_pytest',backend)
    return verify,calls


def test_ci_timeout_budget_is_bounded_and_all_other_checks_remain(monkeypatch,tmp_path):
    verify,calls=configure_verify(monkeypatch,tmp_path)
    assert verify.main()==0
    assert len(calls)==7
    assert [timeout for cmd,timeout in calls if 'pytest' in cmd]==[1500]
    assert all(timeout==240 for cmd,timeout in calls if 'pytest' not in cmd)
    source=(ROOT/'scripts/pytest_shards.py').read_text()
    assert 'scripts.pytest_diagnostics' in source and 'no:faulthandler' in source
    assert 'test_timeout=120' in source
    report=json.loads((tmp_path/'evidence/verification.json').read_text())
    assert report['checks'][3]['aggregate']['path']=='pytest-shards.json'


def test_failed_pytest_is_not_retried_or_hidden_by_other_passing_stages(monkeypatch,tmp_path):
    verify,calls=configure_verify(monkeypatch,tmp_path,backend_code=1)
    from scripts.pytest_output_contract import OUTPUTS
    out=tmp_path/'evidence';out.mkdir()
    for name in OUTPUTS:(out/name).write_text('stale success')
    (out/'history').mkdir();(out/'history/pytest.xml').write_text('historical result')
    assert verify.main()==1
    assert len(calls)==7 and sum('pytest' in command for command,timeout in calls)==1
    report=json.loads((out/'verification.json').read_text())
    assert report['all_executed_checks_pass'] is False
    assert (out/'pytest.log').read_text()=='watchdog stack output'
    assert not (out/'pytest.xml').exists() and not (out/'pytest-shard-0.xml').exists()
    assert (out/'history/pytest.xml').read_text()=='historical result'


def test_failed_evidence_preparation_does_not_launch_pytest(monkeypatch,tmp_path):
    verify,calls=configure_verify(monkeypatch,tmp_path)
    def fail(out,timeout,deadline):raise PermissionError('isolated evidence cleanup failure')
    monkeypatch.setattr(verify,'execute_pytest',fail)
    assert verify.main()==1
    assert len(calls)==6 and not any('pytest' in command for command,timeout in calls)
    report=json.loads((tmp_path/'evidence/verification.json').read_text())
    assert report['all_executed_checks_pass'] is False
    assert 'Evidence preparation failed: PermissionError' in (tmp_path/'evidence/pytest.log').read_text()


def test_unconfirmed_descendant_cleanup_blocks_later_conflicting_stages(monkeypatch,tmp_path):
    verify,calls=configure_verify(monkeypatch,tmp_path,backend_code=1,cleanup=False)
    assert verify.main()==1
    assert len(calls)==4 and calls[-1][0]==['pytest']
    report=json.loads((tmp_path/'evidence/verification.json').read_text())
    assert report['all_executed_checks_pass'] is False
    assert not report['checks'][-1]['aggregate']['cleanup_confirmed']


def test_check_launch_error_remains_nonzero(monkeypatch):
    verify=module('verify')
    def fail(*args,**kwargs):raise OSError('isolated launch failure')
    monkeypatch.setattr(verify.subprocess,'run',fail)
    code,text=verify.execute_check(['unavailable-check'],900)
    assert code==1 and 'OSError: isolated launch failure' in text


def test_new_ci_attempt_clears_generated_outputs_but_preserves_history_and_data(tmp_path,monkeypatch):
    prepare=module('prepare_evidence');out=tmp_path/'evidence';out.mkdir()
    for name in ('native-service-browser.json','verification.json','ui-current-failure.png','pytest.log','pytest.xml','pytest-progress.jsonl','pytest-progress.stacks.log'):
        (out/name).write_text('stale success')
    (out/'history').mkdir();(out/'history'/'old.json').write_text('history')
    (out/'brand-integrity.json').write_text('brand')
    runtime=tmp_path/'.runtime';runtime.mkdir();(runtime/'business.db').write_text('private')
    monkeypatch.setenv('GITHUB_SHA','verified-fixture-sha')
    result=prepare.prepare(tmp_path)
    assert result['commit']=='verified-fixture-sha'
    assert result['cleared_outputs']==['native-service-browser.json','pytest-progress.jsonl','pytest-progress.stacks.log','pytest.log','pytest.xml','ui-current-failure.png','verification.json']
    assert (out/'brand-integrity.json').read_text()=='brand'
    assert (out/'history'/'old.json').read_text()=='history'
    assert (runtime/'business.db').read_text()=='private'
    assert (out/'run-context.json').exists()


def test_artifact_upload_does_not_include_unexecuted_baseline_reports():
    workflow=(ROOT/'.github/workflows/ci.yml').read_text()
    assert workflow.index('python scripts/prepare_evidence.py')<workflow.index('python scripts/verify.py')
    # Forbid the entire evidence tree, including block-scalar spelling, while
    # allowing explicitly bounded current-run fragment directories.
    assert not re.search(r'^\s*(?:path:\s*)?[\"\']?evidence/?[\"\']?\s*$', workflow, re.MULTILINE)
    assert 'evidence/run-context.json' in workflow and 'evidence/ui-current-*.png' in workflow
    assert 'evidence/pytest-progress.jsonl' not in workflow
    assert 'evidence/pytest-shards.json' in workflow and 'evidence/*.log' in workflow
    for name in ('pytest-collection.json','pytest-manifest.json','pytest-shard-0-progress.jsonl','pytest-shard-1-progress.jsonl'):
        assert 'evidence/'+name in workflow
    regression=workflow.split('  regression:',1)[1].split('\n  product-audit:',1)[0]
    assert 'timeout-minutes: 35' in regression
    assert 'evidence/brand-integrity.json' not in workflow  # Static reference, not a generated run report.
