"""Create an isolated local server, then run browser business flows.

A browser policy denial is a failure. Native mode never changes browser policy
or injects a transport bridge. Optional --bridge is separately labeled and
never points at a live production database.
"""
from pathlib import Path
import argparse
import atexit
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
import httpx
try:
    from scripts.acceptance_diagnostics import EventJournal
    from scripts.product_audit_config import audit_suite
except ModuleNotFoundError:
    from acceptance_diagnostics import EventJournal
    from product_audit_config import audit_suite

ROOT=Path(__file__).resolve().parents[1]


def observe_server_exit(server, journal, cleanup_requested):
    """Record when wait() observes exit, not an invented OS exit timestamp."""
    code = server.wait()
    journal.emit('server_exit_observed', exit_code=code,
        cleanup_requested=cleanup_requested.is_set())


def partial_output(exc):
    return ''.join(value.decode('utf-8', errors='replace') if isinstance(value, bytes)
        else value for value in (exc.stdout, exc.stderr) if value)


def product_browser_options(suite, expected_web_tree, expected_server_tree):
    audit_suite(suite)  # Validate the suite before constructing a subprocess.
    options=['--suite',suite]
    for flag,value in (('--expected-web-tree',expected_web_tree),('--expected-server-tree',expected_server_tree)):
        if value:options.extend([flag,value])
    return options


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
    parser=argparse.ArgumentParser()
    mode_args=parser.add_mutually_exclusive_group()
    mode_args.add_argument('--bridge',action='store_true',help='Run separately labeled DOM/API bridge acceptance')
    mode_args.add_argument('--product-audit',action='store_true',help='Run independent native user-outcome probes on the authorized CI runner')
    mode_args.add_argument('--product-first-use',action='store_true',help='Run only L1 first-use outcomes in a separate native CI audit')
    mode_args.add_argument('--product-integrity',action='store_true',help='Run native rejection/recovery tasks with explicit isolated database faults')
    mode_args.add_argument('--product-comparison-integrity',action='store_true',help='Run the separate native comparison-receipt rejection/reconstruction task')
    mode_args.add_argument('--product-source-integrity',action='store_true',help='Run separate source withdrawal and verified revision recovery tasks')
    mode_args.add_argument('--product-tracking-integrity',action='store_true',help='Run separate existing-watch source rejection and revision recovery task')
    mode_args.add_argument('--product-plan-history',action='store_true',help='Run the real seven-plan history retrieval journey')
    parser.add_argument('--expected-web-tree')
    parser.add_argument('--expected-server-tree')
    args=parser.parse_args()
    product_mode=args.product_audit or args.product_first_use or args.product_integrity or args.product_comparison_integrity or args.product_source_integrity or args.product_tracking_integrity or args.product_plan_history
    suite='plan-history' if args.product_plan_history else 'tracking-integrity' if args.product_tracking_integrity else 'source-integrity' if args.product_source_integrity else 'comparison-integrity' if args.product_comparison_integrity else 'integrity' if args.product_integrity else 'first-use' if args.product_first_use else 'contract'
    configuration=audit_suite(suite)
    if not product_mode and (args.expected_web_tree or args.expected_server_tree):
        parser.error('Expected application trees apply only to product audit modes')
    mode=configuration['mode'] if product_mode else 'bridge' if args.bridge else 'native'
    out=ROOT/'evidence';out.mkdir(exist_ok=True)
    journal=EventJournal(out/(mode+'-process-events.jsonl'))
    atexit.register(journal.close)
    journal.emit('acceptance_started',mode=mode)
    report=out/(configuration['report'] if product_mode else 'service-browser-check.json' if args.bridge else 'native-service-browser.json')
    attempt={'attempted_at':datetime.now(timezone.utc).isoformat(),
        'mode':mode,'all_checks_passed':False,'native_network_e2e':False,
        'status':'not_completed','checks':[],'count':0,'screenshots':[],
        'policy_modified':False,'note':'本次执行尚未完成；不继承旧验收成功或历史截图。'}
    if product_mode:attempt['suite']=suite
    report.write_text(json.dumps(attempt,ensure_ascii=False,indent=2),encoding='utf-8')
    if product_mode and os.getenv('GITHUB_ACTIONS')!='true':
        journal.emit('product_audit_blocked',reason='authorized_ci_runner_required');journal.close()
        raise SystemExit('独立原生产品审计仅在已授权的 GitHub runner 执行；没有启动本地服务或浏览器。')
    with socket.socket() as sock:
        try:sock.bind(('127.0.0.1',8000))
        except OSError:
            journal.emit('port_unavailable');journal.close()
            raise SystemExit('原生验收需要隔离的8000端口；不会终止已占用该端口的服务。')
    with WindowsSafeTemporaryDirectory(prefix='lidian-native-') as tmp:
        env={k:v for k,v in os.environ.items() if not k.endswith('_API_KEY') and k not in ('APP_ENV','REGISTRATION_CODE')}
        env.update(DATA_DIR=tmp,APP_ORIGIN='http://127.0.0.1:8000',PYTHONUTF8='1')
        with open(out/(mode+'-server.log' if product_mode else 'native-server.log'),'w',encoding='utf-8') as log:
            journal.emit('server_spawn_requested')
            server=subprocess.Popen([sys.executable,'-m','uvicorn','server.app:app','--host','127.0.0.1','--port','8000','--log-level','warning'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
            journal.emit('server_spawned',pid=server.pid)
            cleanup_requested=threading.Event()
            observer=threading.Thread(target=observe_server_exit,args=(server,journal,cleanup_requested),daemon=True)
            observer.start()
            try:
                for index in range(100):
                    try:
                        with httpx.Client(trust_env=False,timeout=1) as c:
                            health=c.get('http://127.0.0.1:8000/api/health')
                            journal.emit('startup_health_response',attempt=index+1,status=health.status_code)
                            if health.status_code==200:break
                    except httpx.HTTPError as exc:
                        journal.emit('startup_health_failed',attempt=index+1,error_type=type(exc).__name__)
                    if server.poll() is not None:raise RuntimeError('隔离服务启动失败')
                    time.sleep(.1)
                browser_script='scripts/product_browser_audit.py' if product_mode else 'scripts/service_browser_check.py'
                options=[] if args.bridge or product_mode else ['--native']
                if product_mode:
                    options=product_browser_options(suite,args.expected_web_tree,args.expected_server_tree)
                command=[sys.executable,browser_script,*options]
                journal.emit('browser_command_started',server_exit_code=server.poll(),timeout_seconds=300)
                result=subprocess.run(command,cwd=ROOT,env=env,timeout=300,capture_output=True,text=True,encoding='utf-8',errors='replace')
                journal.emit('browser_command_finished',exit_code=result.returncode,server_exit_code=server.poll())
                (out/(mode+'-service-browser.log')).write_text(result.stdout+result.stderr,encoding='utf-8')
                (out/(mode+'-service-command.json')).write_text(json.dumps({'exit_code':result.returncode,'command':['python',browser_script,*options],'bridge':args.bridge,'isolated':True,'policy_changed':False},indent=2),encoding='utf-8')
                current=json.loads(report.read_text(encoding='utf-8'))
                current.update(attempted_at=attempt['attempted_at'],exit_code=result.returncode)
                if result.returncode and current.get('status')=='not_completed':
                    current.update(status='failed_before_browser_checks',note='浏览器启动或服务访问未完成；详见本次命令日志。历史截图不代表当前界面。')
                report.write_text(json.dumps(current,ensure_ascii=False,indent=2),encoding='utf-8')
                print(result.stdout+result.stderr);return result.returncode
            except subprocess.TimeoutExpired as exc:
                journal.emit('browser_command_timeout',timeout_seconds=300,server_exit_code=server.poll())
                (out/(mode+'-service-browser.log')).write_text(partial_output(exc),encoding='utf-8')
                current=json.loads(report.read_text(encoding='utf-8'))
                current.update(status='browser_command_timeout',all_checks_passed=False,native_network_e2e=False,
                    note='浏览器命令超过原有300秒上限；保留部分输出与诊断事件，不重试请求。')
                report.write_text(json.dumps(current,ensure_ascii=False,indent=2),encoding='utf-8')
                raise
            except Exception as exc:
                journal.emit('acceptance_exception',error_type=type(exc).__name__,server_exit_code=server.poll())
                raise
            finally:
                journal.emit('server_cleanup_requested',exit_code_before_cleanup=server.poll())
                cleanup_requested.set()
                server.terminate()
                try:server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    journal.emit('server_kill_requested');server.kill();server.wait()
                observer.join(timeout=1)
                journal.emit('cleanup_completed',exit_code=server.returncode,observer_finished=not observer.is_alive())
                journal.close()
if __name__=='__main__':raise SystemExit(main())
