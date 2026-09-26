"""Create an isolated local server, then run browser business flows.

A browser policy denial is a failure. Native mode never changes browser policy
or injects a transport bridge. Optional --bridge is separately labeled and
never points at a live production database.
"""
from pathlib import Path
import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import httpx

ROOT=Path(__file__).resolve().parents[1]

class WindowsSafeTemporaryDirectory(tempfile.TemporaryDirectory):
    def cleanup(self):
        # Windows can release the stopped server's SQLite file shortly after
        # wait() returns. Fail if it remains locked after a bounded retry.
        for attempt in range(10):
            try:
                return super().cleanup()
            except PermissionError:
                if attempt==9:raise
                time.sleep(.2)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--bridge',action='store_true',help='Run separately labeled DOM/API bridge acceptance');args=parser.parse_args()
    mode='bridge' if args.bridge else 'native'
    out=ROOT/'evidence';out.mkdir(exist_ok=True)
    with socket.socket() as sock:
        try:sock.bind(('127.0.0.1',8000))
        except OSError:raise SystemExit('原生验收需要隔离的8000端口；不会终止已占用该端口的服务。')
    with WindowsSafeTemporaryDirectory(prefix='lidian-native-') as tmp:
        env={k:v for k,v in os.environ.items() if not k.endswith('_API_KEY') and k not in ('APP_ENV','REGISTRATION_CODE')}
        env.update(DATA_DIR=tmp,APP_ORIGIN='http://127.0.0.1:8000',PYTHONUTF8='1')
        with open(out/'native-server.log','w',encoding='utf-8') as log:
            server=subprocess.Popen([sys.executable,'-m','uvicorn','server.app:app','--host','127.0.0.1','--port','8000','--log-level','warning'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
            try:
                for _ in range(100):
                    try:
                        with httpx.Client(trust_env=False,timeout=1) as c:
                            if c.get('http://127.0.0.1:8000/api/health').status_code==200:break
                    except httpx.HTTPError:pass
                    if server.poll() is not None:raise RuntimeError('隔离服务启动失败')
                    time.sleep(.1)
                command=[sys.executable,'scripts/service_browser_check.py']+([] if args.bridge else ['--native'])
                result=subprocess.run(command,cwd=ROOT,env=env,timeout=300,capture_output=True,text=True,encoding='utf-8',errors='replace')
                (out/(mode+'-service-browser.log')).write_text(result.stdout+result.stderr,encoding='utf-8')
                (out/(mode+'-service-command.json')).write_text(json.dumps({'exit_code':result.returncode,'command':['python','scripts/service_browser_check.py']+([] if args.bridge else ['--native']),'bridge':args.bridge,'isolated':True,'policy_changed':False},indent=2),encoding='utf-8')
                print(result.stdout+result.stderr);return result.returncode
            finally:
                server.terminate()
                try:server.wait(timeout=10)
                except subprocess.TimeoutExpired:server.kill();server.wait()
if __name__=='__main__':raise SystemExit(main())
