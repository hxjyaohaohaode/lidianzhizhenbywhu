"""Execute checks, record commands and exit codes; never fabricate a success marker."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,os,platform,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser();p.add_argument('--tsc',help='Path to TypeScript tsc.js');p.add_argument('--full-chain',action='store_true',help='Run isolated real HTTP/SSE/restart/backup chain (no external suppliers)');a=p.parse_args();os.chdir(ROOT)
    out=ROOT/'evidence';out.mkdir(exist_ok=True);tsc=a.tsc or str(ROOT/'node_modules/typescript/bin/tsc')
    tc=['node',tsc,'--noEmit','-p','tsconfig.json'] if Path(tsc).is_file() else ['tsc','--noEmit','-p','tsconfig.json']
    build=[x for x in tc if x!='--noEmit']
    commands=[('python-compile',[sys.executable,'-m','compileall','-q','server','scripts']),('typecheck',tc),('build',build),('pytest',[sys.executable,'-m','pytest','-q','--junitxml=evidence/pytest.xml']),('frontend-tests',['node','--test','tests/frontend.test.mjs','tests/services.frontend.test.mjs']),('source-guard',[sys.executable,'scripts/source_guard.py'])];results=[]
    if a.full_chain:commands.append(('full-chain-http',[sys.executable,'scripts/full_chain_check.py']))
    for name,cmd in commands:
        t=time.monotonic()
        try:
            result=subprocess.run(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',env={**os.environ,'PYTHONIOENCODING':'utf-8'},timeout=240);code=result.returncode;text=result.stdout
        except (OSError,subprocess.TimeoutExpired) as e:code=1;text=type(e).__name__+': '+str(e)
        (out/(name+'.log')).write_text(text,encoding='utf-8');results.append({'check':name,'command':cmd,'exit_code':code,'seconds':round(time.monotonic()-t,3)});print(name,':','PASS' if code==0 else 'FAIL',flush=True)
        if code:print(text[-20000:],flush=True)
    report={'executed_at':datetime.now(timezone.utc).isoformat(),'python':sys.version,'platform':platform.platform(),'checks':results,'all_executed_checks_pass':all(r['exit_code']==0 for r in results),'not_exercised_by_this_command':['Live model API credentials','Live public sources','Public HTTPS deployment','Long-duration production load','Native browser navigation/Cookie/CSP integration','Cross-device browser compatibility','Future dependency advisories','Optional patched PDF integration']}
    (out/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');return 0 if report['all_executed_checks_pass'] else 1
if __name__=='__main__':raise SystemExit(main())
