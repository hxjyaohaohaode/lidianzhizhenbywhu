"""Single-process launcher with explicit environment and local port diagnostics."""
from pathlib import Path
import argparse
import json
import os
import re
import socket
import sys
import threading
import time
from urllib.request import urlopen
ROOT=Path(__file__).resolve().parents[1]


def load_env(path:Path):
    """Read a simple KEY=value file. Never executes/interpolates or overrides the shell."""
    if not path.is_file():return
    seen=set()
    for number,line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(),1):
        line=line.strip()
        if not line or line.startswith('#'):continue
        if '=' not in line:raise ValueError(f'.env 第{number}行不是 KEY=value 格式；未显示配置值。')
        key,value=line.split('=',1);key=key.strip();value=value.strip()
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*',key) or key in seen:raise ValueError(f'.env 第{number}行键名无效或重复；未显示配置值。')
        if value.startswith(('"',"'")):
            if len(value)<2 or value[-1]!=value[0]:raise ValueError(f'.env 第{number}行引号不完整。')
            value=value[1:-1]
        if '\x00' in value:raise ValueError(f'.env 第{number}行含无效字符。')
        seen.add(key);os.environ.setdefault(key,value)


def port_available(host,port):
    family=socket.AF_INET6 if ':' in host else socket.AF_INET
    with socket.socket(family,socket.SOCK_STREAM) as sock:
        if os.name!='nt':sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        elif hasattr(socket,'SO_EXCLUSIVEADDRUSE'):sock.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
        try:sock.bind((host,port));return True
        except OSError:return False


def open_when_ready(url):
    for _ in range(40):
        try:
            with urlopen(url+'/api/health',timeout=1) as response:ready=json.load(response).get('application')=='lidian-workbench'
            if ready:
                import webbrowser
                webbrowser.open(url);return
        except Exception:pass
        time.sleep(.25)


def resolve_port(explicit=None):
    value = explicit if explicit is not None else os.getenv('PORT', '8000')
    try:
        port = int(value)
    except (ValueError, TypeError):
        raise ValueError('PORT/--port 必须是1–65535之间的整数；未显示配置值。') from None
    if not 1 <= port <= 65535:
        raise ValueError('端口必须在1–65535之间。')
    return port


def proxy_options(enabled, host):
    """Only a same-host trusted proxy may enable forwarded client addresses.

    This is deliberately not a container-bridge or arbitrary-CIDR interface.
    All other local callers must also be trusted; the proxy overwrites XFF.
    """
    if enabled:
        if os.getenv('APP_ENV')!='production' or host!='127.0.0.1':
            raise ValueError('可信本机代理模式仅允许生产环境并绑定127.0.0.1；不适用于容器网桥。')
        return {'proxy_headers':True,'forwarded_allow_ips':'127.0.0.1'}
    return {'proxy_headers':False}


def main():
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8',errors='replace')
    p=argparse.ArgumentParser(description='启动锂电智诊');p.add_argument('--host',default='127.0.0.1');p.add_argument('--port',type=int,default=None);p.add_argument('--open-browser',action='store_true');p.add_argument('--trusted-local-proxy',action='store_true',help='仅生产环境、127.0.0.1绑定且可信同机代理可用');a=p.parse_args()
    os.chdir(ROOT);sys.path.insert(0,str(ROOT))
    try:load_env(ROOT/'.env')
    except (ValueError,OSError) as exc:raise SystemExit(str(exc)) from None
    try:a.port=resolve_port(a.port)
    except ValueError as exc:raise SystemExit(str(exc)) from None
    if not (ROOT/'web/dist/app.js').is_file():raise SystemExit('缺少前端构建产物；先运行npm ci与npm run build。完整发布ZIP已包含。')
    if a.host not in ('127.0.0.1','localhost','::1') and os.getenv('APP_ENV')!='production':raise SystemExit('开发模式禁止外网绑定。请先配置生产HTTPS入口和注册邀请码。')
    host='127.0.0.1' if a.host=='localhost' else a.host
    try:proxy=proxy_options(a.trusted_local_proxy,host)
    except ValueError as exc:raise SystemExit(str(exc)) from None
    if not port_available(host,a.port):raise SystemExit(f'端口 {a.port} 已被占用。没有结束任何其他进程。关闭原服务窗口，或显式使用 --port 8001。')
    local_url=f'http://{"[::1]" if host=="::1" else "127.0.0.1"}:{a.port}'
    if not os.getenv('APP_ORIGIN'):os.environ['APP_ORIGIN']=local_url
    from server.config import Settings
    try:Settings().validate()
    except (ValueError,RuntimeError) as exc:raise SystemExit(str(exc)) from None
    try:import uvicorn
    except ImportError:raise SystemExit('缺少依赖：双击start-windows.cmd，或用当前虚拟环境执行 python -m pip install -r requirements.txt')
    print(f'锂电智诊：{local_url}；按Ctrl+C停止。日志不会输出API密钥。',flush=True)
    if a.open_browser and host in ('127.0.0.1','::1'):threading.Thread(target=open_when_ready,args=(local_url,),daemon=True).start()
    uvicorn.run('server.app:app',host=host,port=a.port,workers=1,access_log=False,log_level='warning',**proxy)
if __name__=='__main__':main()
