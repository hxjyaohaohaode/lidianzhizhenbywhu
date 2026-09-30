"""CI failures preserve diagnostics and never inherit old acceptance success."""
import importlib.util
from pathlib import Path
import subprocess

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


def test_ci_timeout_budget_is_bounded_and_all_other_checks_remain(monkeypatch,tmp_path):
    verify=module('verify');calls=[]
    monkeypatch.setattr(verify,'ROOT',tmp_path)
    monkeypatch.setattr(verify.sys,'argv',['verify.py','--full-chain'])
    monkeypatch.setattr(verify.os,'chdir',lambda _:None)
    monkeypatch.setattr(verify,'execute_check',lambda cmd,timeout:(calls.append((cmd,timeout)) or (0,'passed')))
    assert verify.main()==0
    assert len(calls)==7
    assert [timeout for cmd,timeout in calls if 'pytest' in cmd]==[600]
    assert all(timeout==240 for cmd,timeout in calls if 'pytest' not in cmd)


def test_new_ci_attempt_clears_generated_outputs_but_preserves_history_and_data(tmp_path,monkeypatch):
    prepare=module('prepare_evidence');out=tmp_path/'evidence';out.mkdir()
    for name in ('native-service-browser.json','verification.json','ui-current-failure.png','pytest.log','pytest.xml'):
        (out/name).write_text('stale success')
    (out/'history').mkdir();(out/'history'/'old.json').write_text('history')
    (out/'brand-integrity.json').write_text('brand')
    runtime=tmp_path/'.runtime';runtime.mkdir();(runtime/'business.db').write_text('private')
    monkeypatch.setenv('GITHUB_SHA','verified-fixture-sha')
    result=prepare.prepare(tmp_path)
    assert result['commit']=='verified-fixture-sha'
    assert result['cleared_outputs']==['native-service-browser.json','pytest.log','pytest.xml','ui-current-failure.png','verification.json']
    assert (out/'brand-integrity.json').read_text()=='brand'
    assert (out/'history'/'old.json').read_text()=='history'
    assert (runtime/'business.db').read_text()=='private'
    assert (out/'run-context.json').exists()


def test_artifact_upload_does_not_include_unexecuted_baseline_reports():
    workflow=(ROOT/'.github/workflows/ci.yml').read_text()
    assert workflow.index('python scripts/prepare_evidence.py')<workflow.index('python scripts/verify.py')
    assert 'path: evidence/' not in workflow
    assert 'evidence/run-context.json' in workflow and 'evidence/ui-current-*.png' in workflow
    assert 'evidence/brand-integrity.json' not in workflow  # Static reference, not a generated run report.
