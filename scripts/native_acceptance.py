"""Create an isolated local server, then run native browser business flows.

A browser policy denial is a failure. This script never changes browser policy,
never injects a transport bridge, and never points at a live production database.
"""
from pathlib import Path
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import httpx

ROOT=Path(__file__).resolve().parents[1]
def main():
    out=ROOT/'evidence';out.mkdir(exist_ok=True)
    with socket.socket() as sock:
        try:sock.bind(('127.0.0.1',8000))
        except OSError:raise SystemExit('原生验收需要隔离的8000端口；不会终止已占用该端口的服务。')
    with tempfile.TemporaryDirectory(prefix='lidian-native-') as tmp:
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
                result=subprocess.run([sys.executable,'scripts/service_browser_check.py','--native'],cwd=ROOT,env=env,timeout=300,capture_output=True,text=True,encoding='utf-8',errors='replace')
                (out/'native-service-browser.log').write_text(result.stdout+result.stderr,encoding='utf-8')
                (out/'native-service-command.json').write_text(json.dumps({'exit_code':result.returncode,'command':['python','scripts/service_browser_check.py','--native'],'bridge':False,'isolated':True,'policy_changed':False},indent=2),encoding='utf-8')
                print(result.stdout+result.stderr);return result.returncode
            finally:
                server.terminate()
                try:server.wait(timeout=10)
                except subprocess.TimeoutExpired:server.kill();server.wait()
if __name__=='__main__':raise SystemExit(main())
