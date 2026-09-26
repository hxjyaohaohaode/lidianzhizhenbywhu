"""Local first-run setup. Standard library only; never deletes a venv or installs globally."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
SUPPORTED={(3,11),(3,12),(3,13),(3,14)}


def probe(command: list[str]) -> dict | None:
    code='import sys,json;print(json.dumps({"executable":sys.executable,"version":list(sys.version_info[:3]),"prefix":sys.prefix,"base_prefix":sys.base_prefix}))'
    try:
        r=subprocess.run([*command,'-c',code],capture_output=True,text=True,timeout=15,encoding='utf-8',errors='replace')
        if r.returncode:
            return None
        value=json.loads(r.stdout.strip())
        return value if tuple(value['version'][:2]) in SUPPORTED and Path(value['executable']).is_file() else None
    except (OSError,ValueError,KeyError,subprocess.TimeoutExpired):
        return None


def candidates() -> list[list[str]]:
    result=[]
    if os.name=='nt':
        result += [['py','-'+v] for v in ('3.13','3.12','3.11','3.14')]
        base=Path(os.environ.get('LOCALAPPDATA',''))/'Programs'/'Python'
        result += [[str(base/('Python'+v)/'python.exe')] for v in ('313','312','311','314')]
    result += [[sys.executable],['python3.13'],['python3.12'],['python3.11'],['python3.14'],['python3'],['python']]
    return result


def select_python() -> str:
    for candidate in candidates():
        value=probe(candidate)
        if value:
            return value['executable']
    raise RuntimeError('没有找到能够实际启动的 Python 3.11–3.14。请安装官方 Python 3.13 后重新双击启动。')


def check_runtime(executable: Path,root:Path=ROOT) -> tuple[bool,str]:
    script='''import sys,importlib.metadata as m,pathlib,json
req=pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
errors=[]
for line in req.splitlines():
 line=line.strip()
 if not line or line.startswith('#'):continue
 name,version=line.split('==',1)
 try:installed=m.version(name)
 except m.PackageNotFoundError:errors.append(name+': missing');continue
 if installed!=version:errors.append(name+': installed '+installed+', required '+version)
for name in ('fastapi','uvicorn','pydantic','openpyxl','cryptography'):
 try:__import__(name)
 except Exception as e:errors.append(name+': '+type(e).__name__)
print(json.dumps(errors));sys.exit(bool(errors))'''
    r=subprocess.run([str(executable),'-c',script,str(root/'requirements.txt')],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=45)
    return r.returncode==0,r.stdout.strip() or r.stderr[-1000:]


class SetupLock:
    def __init__(self,path):self.path=path;self.file=None
    def __enter__(self):
        self.path.parent.mkdir(exist_ok=True,parents=True)
        try:
            # Windows byte-range locks also deny reads through a second handle.
            # Query file size instead of reading a possibly locked byte, and keep
            # initialization inside the same visible error boundary as locking.
            self.file=open(self.path,'a+b',buffering=0)
            if os.fstat(self.file.fileno()).st_size==0:self.file.write(b'1')
            self.file.seek(0)
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            if self.file:self.file.close()
            raise RuntimeError('已有安装或检查窗口在运行，或项目目录不可写。请先完成该窗口并核对目录权限，不要同时建立虚拟环境。') from None
        return self
    def __exit__(self,*args):
        if self.file:self.file.close()


def prepare(root:Path=ROOT,*,install=True,yes=False) -> Path:
    if not (root/'requirements.txt').is_file() or not (root/'server/app.py').is_file():
        raise RuntimeError('当前不是完整项目目录，缺少 requirements.txt 或 server/app.py。')
    if not (root/'web/dist/app.js').is_file():
        raise RuntimeError('缺少已编译前端；请使用完整发布包，或在开发环境执行 npm ci 和 npm run build。')
    venv=root/'.venv';exe=venv/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    with SetupLock(root/'.runtime/bootstrap.lock'):
        if venv.exists():
            info=probe([str(exe)])
            if not info or Path(info['prefix']).resolve()!=venv.resolve() or info['prefix']==info['base_prefix']:
                raise RuntimeError('项目 .venv 不可用或不属于此目录。没有删除它。请关闭程序后把 .venv 重命名为 .venv-backup，再重新启动；不要移动业务数据库。')
        else:
            base=select_python();print('使用已实际探测的解释器：'+base,flush=True)
            result=subprocess.run([base,'-m','venv',str(venv)],cwd=root,timeout=180)
            if result.returncode or not probe([str(exe)]):
                raise RuntimeError('虚拟环境创建失败；未继续安装或启动。保留失败目录供排查。')
        ready,detail=check_runtime(exe,root)
        if not ready:
            if not install:raise RuntimeError('环境依赖未就绪：'+detail)
            print('需要在本项目的 .venv 中安装/同步 requirements.txt 所列依赖。不会修改系统 Python。',flush=True)
            if not yes and input('允许从当前 pip 配置的软件源下载？[y/N] ').strip().lower() not in ('y','yes'):
                raise RuntimeError('没有获得依赖安装确认，停止启动。')
            cmd=[str(exe),'-m','pip','install','--disable-pip-version-check','--timeout','30','--retries','1','-r',str(root/'requirements.txt')]
            result=subprocess.run(cmd,cwd=root,timeout=1200)
            if result.returncode:raise RuntimeError('依赖安装失败，服务未启动。请检查网络和 pip 软件源配置后重试；不会跳过错误。')
            ready,detail=check_runtime(exe,root)
            if not ready:raise RuntimeError('安装后依赖仍未通过核对：'+detail)
        record={'python':probe([str(exe)]),'requirements_sha256':hashlib.sha256((root/'requirements.txt').read_bytes()).hexdigest(),'verified_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'platform':platform.platform(),'dependency_imports':'passed','external_provider_test':'not_run'}
        (root/'.runtime/setup-check.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    return exe


def main():
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8',errors='replace')
    p=argparse.ArgumentParser(description='锂电智诊项目级安装与启动检查')
    p.add_argument('--start',action='store_true');p.add_argument('--yes',action='store_true',help='明确同意安装当前项目依赖')
    p.add_argument('--no-install',action='store_true');p.add_argument('--port',type=int,default=8000);p.add_argument('--no-browser',action='store_true');a=p.parse_args()
    try:
        exe=prepare(install=not a.no_install,yes=a.yes)
        print('项目运行环境检查通过。',flush=True)
        if a.start:
            return subprocess.call([str(exe),str(ROOT/'scripts/start.py'),'--port',str(a.port),*(['--open-browser'] if not a.no_browser else [])],cwd=ROOT)
        return 0
    except (RuntimeError,OSError,subprocess.TimeoutExpired,KeyboardInterrupt) as exc:
        print('\n启动未完成：'+str(exc),file=sys.stderr,flush=True);return 1
if __name__=='__main__':raise SystemExit(main())
