"""Execute checks, record commands and exit codes; never fabricate a success marker."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,os,platform,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[1]
def clear_pytest_outputs(out):
    # Also applies to direct local verify.py runs without prepare_evidence.py.
    # Never let a killed/failed-to-launch pytest inherit an older complete XML
    # or journal. Historical directories and other reports are not touched.
    for name in ('pytest.xml','pytest-progress.jsonl','pytest-progress.stacks.log'):
        path=out/name
        if path.is_file() or path.is_symlink():path.unlink()

def execute_check(cmd,timeout):
    try:
        result=subprocess.run(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',env={**os.environ,'PYTHONIOENCODING':'utf-8'},timeout=timeout)
        return result.returncode,result.stdout
    except subprocess.TimeoutExpired as exc:
        # TimeoutExpired can contain bytes even with text=True. Preserve partial
        # output so a slow runner remains distinguishable from a hung case.
        chunks=[]
        for output in (exc.stdout,exc.stderr):
            if output:chunks.append(output.decode('utf-8',errors='replace') if isinstance(output,bytes) else output)
        chunks.append(f'TimeoutExpired: check exceeded its bounded {timeout}s budget. {exc}')
        return 1,'\n'.join(chunks)
    except OSError as exc:return 1,type(exc).__name__+': '+str(exc)

def main():
    p=argparse.ArgumentParser();p.add_argument('--tsc',help='Path to TypeScript tsc.js');p.add_argument('--full-chain',action='store_true',help='Run isolated real HTTP/SSE/restart/backup chain (no external suppliers)');a=p.parse_args();os.chdir(ROOT)
    out=ROOT/'evidence';out.mkdir(exist_ok=True);tsc=a.tsc or str(ROOT/'node_modules/typescript/bin/tsc')
    tc=['node',tsc,'--noEmit','-p','tsconfig.json'] if Path(tsc).is_file() else ['tsc','--noEmit','-p','tsconfig.json']
    build=[x for x in tc if x!='--noEmit']
    commands=[('python-compile',[sys.executable,'-m','compileall','-q','server','scripts']),('typecheck',tc),('build',build),('pytest',[sys.executable,'-m','pytest','-q','-p','no:faulthandler','-p','scripts.pytest_diagnostics','--diagnostics-output=evidence/pytest-progress.jsonl','--diagnostics-test-timeout=120','--durations=20','--junitxml=evidence/pytest.xml']),('frontend-tests',['node','--test',*sorted(str(path.relative_to(ROOT)) for path in (ROOT/'tests').glob('*.test.mjs'))]),('source-guard',[sys.executable,'scripts/source_guard.py'])];results=[]
    if a.full_chain:commands.append(('full-chain-http',[sys.executable,'scripts/full_chain_check.py']))
    for name,cmd in commands:
        t=time.monotonic()
        # Since the 654-test checkpoint, the suite grew to 1422 with the same
        # 600s cap (see docs/CI_EXECUTION_BOUNDS_20261002.md).
        # Windows completed in 506s; a slower attempt reached 1245 in 600s
        # (~685s projected). Keep finite 900s/20min suite/job limits and an
        # independent 120s whole-test hard watchdog; never relax security costs.
        timeout=900 if name=='pytest' else 240
        try:
            if name=='pytest':clear_pytest_outputs(out)
            code,text=execute_check(cmd,timeout)
        except OSError as exc:
            # Failure to establish a fresh evidence boundary is a failed stage;
            # do not run pytest and risk reusing an older success report.
            code,text=1,'Evidence preparation failed: '+type(exc).__name__+': '+str(exc)
        (out/(name+'.log')).write_text(text,encoding='utf-8');results.append({'check':name,'command':cmd,'exit_code':code,'seconds':round(time.monotonic()-t,3),'timeout_seconds':timeout});print(name,':','PASS' if code==0 else 'FAIL',flush=True)
        if code:print(text[-20000:],flush=True)
    report={'executed_at':datetime.now(timezone.utc).isoformat(),'python':sys.version,'platform':platform.platform(),'checks':results,'all_executed_checks_pass':all(r['exit_code']==0 for r in results),'not_exercised_by_this_command':['Live model API credentials','Live public sources','Public HTTPS deployment','Long-duration production load','Native browser navigation/Cookie/CSP integration','Cross-device browser compatibility','Future dependency advisories','Optional patched PDF integration']}
    (out/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');return 0 if report['all_executed_checks_pass'] else 1
if __name__=='__main__':raise SystemExit(main())
