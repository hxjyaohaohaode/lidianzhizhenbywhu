"""Single-process launcher; never silently installs dependencies or changes the host environment."""
from pathlib import Path
import argparse
import os
import sys
ROOT=Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser(description='启动锂电智诊');p.add_argument('--host',default='127.0.0.1');p.add_argument('--port',type=int,default=8000);a=p.parse_args()
    os.chdir(ROOT);sys.path.insert(0,str(ROOT))
    if not (ROOT/'web/dist/app.js').is_file():raise SystemExit('缺少前端构建产物；先运行npm ci与npm run build。发布ZIP已包含。')
    if a.host not in ('127.0.0.1','localhost','::1') and os.getenv('APP_ENV')!='production':raise SystemExit('开发模式禁止外网绑定。请先配置生产HTTPS入口和注册邀请码。')
    if not os.getenv('APP_ORIGIN'):os.environ['APP_ORIGIN']=f'http://127.0.0.1:{a.port}'
    try:import uvicorn
    except ImportError:raise SystemExit('缺少依赖：使用同一虚拟环境的python -m pip install -r requirements.txt')
    print(f'锂电智诊：http://127.0.0.1:{a.port}；按Ctrl+C停止。',flush=True)
    uvicorn.run('server.app:app',host=a.host,port=a.port,workers=1,proxy_headers=False,access_log=False,log_level='warning')
if __name__=='__main__':main()
