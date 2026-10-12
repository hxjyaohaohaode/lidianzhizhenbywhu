"""Isolated native same-host TLS/proxy acceptance, never a browser bypass.

The caller supplies a trusted nginx binary. A temporary self-signed certificate
is explicitly trusted by only this test client; system trust is never changed.
All accounts, API credentials and financial inputs are synthetic. No live model
or public-source calls are made. Does not install systemd or alter host networks.
"""
from __future__ import annotations
import argparse,hashlib,json,os,shutil,socket,sqlite3,ssl,subprocess,sys,tempfile,time,uuid
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))
from scripts.owned_process import OwnedProcess
from scripts.source_identity import collect_source_identity
from scripts.backup import backup
from server.security import COOKIE


def port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]


def identity(root, owned, deadline, phase):
    paths=sorted((ROOT/'server').rglob('*.py'))+[
        ROOT/'scripts/start.py',Path(__file__).resolve(),ROOT/'scripts/owned_process.py',
        ROOT/'scripts/source_identity.py',ROOT/'deploy/native-vm/nginx.conf.example',
        ROOT/'tests/fixtures/synthetic-financial.json']
    return collect_source_identity(ROOT,paths,scratch_root=root,
        register_process=lambda descriptor,process:owned.append(process),
        process_deadline=deadline-2,work_deadline=deadline-12,cleanup_reserve=8,phase=phase)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--nginx',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    nginx=Path(args.nginx).resolve();out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
    if not nginx.is_file():raise SystemExit('Supply an existing trusted nginx binary.')
    report={'passed':False,'transport':'actual local TLS -> nginx -> launcher/Uvicorn -> SQLite',
        'native_browser':False,'real_external_supplier_calls':0,'systemd_installed':False,'machine_reboot_tested':False,
        'synthetic_only':True,'checks':[],'processes':[],'started_at':time.time()}
    destination=out/'tls-proxy.json';destination.write_text(json.dumps(report,indent=2))
    root=Path(tempfile.mkdtemp(prefix='lidian-tls-'));old_umask=os.umask(0o077);deadline=time.monotonic()+120;owned=[];seen=set()
    baseport=port();tlsport=port();base=f'https://127.0.0.1:{tlsport}';data=root/'data'
    def record(name):report['checks'].append(name);print('PASS',name,flush=True)
    def guard():
        if time.monotonic()>deadline-12:raise TimeoutError('TLS stage aggregate work deadline exhausted')
    def stop(process):
        if process is None:return
        result=process.cancel()
        if process.guardian_pid not in seen:report['processes'].append(result.as_dict());seen.add(process.guardian_pid)
        if not result.cleanup_confirmed:raise RuntimeError('owned process cleanup unconfirmed; retain private temporary root')
    def launch(command,name,env):
        guard();process=OwnedProcess(command,cwd=ROOT,env=env,stdout_path=root/(name+'.log'),temp_root=root,deadline=deadline-2,cleanup_reserve=8);owned.append(process);return process
    env={k:v for k,v in os.environ.items() if k in ('PATH','LANG','LC_ALL','TMPDIR','TZ','SYSTEMROOT','WINDIR')}
    env.update(APP_ENV='production',APP_ORIGIN=base,DATA_DIR=str(data),REGISTRATION_CODE='SYNTHETIC-TLS-INVITE-ONLY',SERVER_AI_ENABLED='false',PYTHONPATH=str(ROOT),PYTHONDONTWRITEBYTECODE='1',PYTHONPYCACHEPREFIX=str(root/'pycache'),FORWARDED_ALLOW_IPS='*')
    def app(name='app',**changes):
        return launch([sys.executable,'scripts/start.py','--host','127.0.0.1','--port',str(baseport),'--trusted-local-proxy'],name,{**env,**changes})
    def client(address='127.0.0.2',verify=None):
        return httpx.Client(base_url=base,transport=httpx.HTTPTransport(local_address=address,verify=context if verify is None else verify),trust_env=False,timeout=8)
    def ready():
        for _ in range(100):
            guard()
            try:
                with client('127.0.0.8') as c:
                    if c.get('/api/health').status_code==200:return
            except httpx.HTTPError:pass
            time.sleep(.05)
        raise TimeoutError('TLS application startup')
    def expect(response,code=200):
        assert response.status_code==code,(response.status_code,str(response.request.url),response.text[:300])
        return response.json()
    def register(c):
        result=expect(c.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@tls.test','password':'SYNTHETIC-TLS-PASSWORD','name':'TLS合成验收','invitation':env['REGISTRATION_CODE']}),201)
        c.headers['X-CSRF-Token']=result['csrf'];return result
    active=None
    try:
        source=identity(root,owned,deadline,'before');report['source']=source
        (root/'logs').mkdir();(root/'body').mkdir()
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(root/'key.pem'),'-out',str(root/'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
        context=ssl.create_default_context(cafile=str(root/'cert.pem'))
        template=(ROOT/'deploy/native-vm/nginx.conf.example').read_text().replace('listen 443 ssl',f'listen 127.0.0.1:{tlsport} ssl').replace('lidian.example.invalid','127.0.0.1').replace('/etc/lidian/tls/fullchain.pem',str(root/'cert.pem')).replace('/etc/lidian/tls/privkey.pem',str(root/'key.pem')).replace('127.0.0.1:8000',f'127.0.0.1:{baseport}')
        (root/'nginx.conf').write_text(f'daemon off;\npid {root}/nginx.pid;\nerror_log {root}/nginx-error.log;\nevents {{ worker_connections 128; }}\nhttp {{ access_log off; client_body_temp_path {root}/body;\n'+template+'\n}\n')
        active=app();proxy=launch([str(nginx),'-p',str(root),'-c',str(root/'nginx.conf')],'nginx',env);ready()
        with client() as a,client('127.0.0.3') as b:
            health=a.get('/api/health');expect(health);record('explicit temporary CA trust establishes verified TLS')
            try:
                with client('127.0.0.9',ssl.create_default_context()) as untrusted:untrusted.get('/api/health')
            except httpx.ConnectError:record('default trust rejects the temporary certificate')
            else:raise AssertionError('self-signed certificate unexpectedly system-trusted')
            assert a.get('/api/health',headers={'Host':'wrong.example'}).status_code==400;record('nginx rejects unconfigured Host')
            with socket.create_connection(('127.0.0.1',tlsport),timeout=5) as raw:
                with context.wrap_socket(raw,server_hostname='127.0.0.1') as tls:
                    tls.sendall(f'GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{tlsport}\r\nHost: evil.test\r\nConnection: close\r\n\r\n'.encode());assert b' 400 ' in tls.recv(8192).split(b'\r\n',1)[0]
            record('duplicate Host rejected over actual TLS wire')
            assert health.headers['strict-transport-security']=='max-age=31536000';record('production HSTS survives proxy')
            assert hashlib.sha256(a.get('/images/logo.png').content).digest()==hashlib.sha256((ROOT/'web/brand/logo.png').read_bytes()).digest();record('original logo bytes preserved over TLS')
            video=a.get('/loading-video.mp4',headers={'Range':'bytes=0-4095'});assert video.status_code==206 and video.content==(ROOT/'web/brand/loading-video.mp4').read_bytes()[:4096];record('original video range bytes preserved')
            owner=register(a);other=register(b)
            cookie=next(iter(a.cookies.jar));assert cookie.secure and cookie.has_nonstandard_attr('HttpOnly') and cookie.get_nonstandard_attr('SameSite').lower()=='strict';record('TLS authentication sets Secure HttpOnly SameSite cookie')
            assert expect(a.get('/api/auth/me'))['user']['id']==owner['user']['id'];record('real secure cookie authenticates after proxy')
            value=json.loads((ROOT/'tests/fixtures/synthetic-financial.json').read_text());value['source_kind']='user_provided'
            dataset=expect(a.post('/api/datasets',json=value),201);record('synthetic dataset created through TLS')
            padded=json.dumps(value).encode()+b' '*(1_950_000-len(json.dumps(value).encode()))
            expect(a.post('/api/import/dataset',data={'company':'TLS合成导入'},files={'file':('synthetic.json',padded,'application/json')}),201);record('near-limit multipart upload reaches application')
            r=a.post('/api/memories',content=b'x'*2_050_000,headers={'Content-Type':'application/json'});assert r.status_code==413 and r.json()['error']['code']=='BODY_TOO_LARGE';record('application upload limit has application error source')
            before=len(expect(a.get('/api/datasets'))['items']);r=a.post('/api/memories',content=b'x'*2_160_000);assert r.status_code==413 and 'application/json' not in r.headers.get('content-type','');assert len(expect(a.get('/api/datasets'))['items'])==before;record('nginx upload limit has proxy error source and no write')
            assert b.get('/api/datasets/'+dataset['id']).status_code==404;record('cross-account object remains inaccessible')
            for headers in ({'Origin':'https://evil.test'},{'X-CSRF-Token':'wrong'},{'Sec-Fetch-Site':'cross-site'}):assert a.post('/api/memories',json={'text':'合成拒绝写入'},headers=headers).status_code==403
            record('Origin CSRF and cross-site writes remain rejected')
            conversation=expect(a.post('/api/conversations',json={'title':'TLS合成会话'}),201)
            run=expect(a.post('/api/runs',json={'dataset_id':dataset['id'],'session_id':conversation['id'],'query':'分析毛利率和现金流风险','use_llm':False},headers={'Idempotency-Key':uuid.uuid4().hex}),202)
            for _ in range(100):
                guard();current=expect(a.get('/api/runs/'+run['id']))
                if current['state'] not in ('queued','running'):break
                time.sleep(.05)
            assert current['state'] not in ('queued','running');record('local computation reaches terminal state through TLS')
            events=expect(a.get('/api/runs/'+run['id']+'/trace'))['items'];assert events
            stream=a.get('/api/runs/'+run['id']+'/events',headers={'Last-Event-ID':str(events[0]['seq'])});assert stream.status_code==200 and 'event: end' in stream.text
            ids=[int(line[4:]) for line in stream.text.splitlines() if line.startswith('id: ')];assert ids==[e['seq'] for e in events[1:]];record('SSE replay honors Last-Event-ID without proxy buffering')
            assert b.get('/api/runs/'+run['id']+'/events').status_code==404;record('cross-account SSE remains inaccessible')
            with sqlite3.connect(data/'lidian.sqlite3') as db:db.execute("UPDATE runs SET state='running' WHERE id=?",(run['id'],));db.commit()
            started=time.monotonic()
            with a.stream('GET','/api/runs/'+run['id']+'/events') as response:
                lines=response.iter_lines();assert next(lines).startswith('id:');assert time.monotonic()-started<2
                expect(a.post('/api/auth/logout'));assert any(line=='event: auth_expired' for line in lines)
            record('unbuffered live SSE terminates when the same session logs out')
            assert a.get('/api/auth/me').status_code==401;record('logout revokes real cookie authorization')
            owner=expect(a.post('/api/auth/login',json={'email':owner['user']['email'],'password':'SYNTHETIC-TLS-PASSWORD'}));a.headers['X-CSRF-Token']=owner['csrf']
            connection=expect(a.post('/api/services/connections',json={'name':'TLS合成连接，不外呼','base_url':'https://models.test.example/v1','model':'fixture-model','api_key':'SYNTHETIC-NOT-A-REAL-KEY','password':'SYNTHETIC-TLS-PASSWORD'}),201);record('private synthetic connection saved with no supplier call')
            assert data.stat().st_mode&0o777==0o700
            for name in ('lidian.sqlite3','lidian.sqlite3-wal','lidian.sqlite3-shm','credentials.key','server.lock'):assert (data/name).stat().st_mode&0o777==0o600,name
            record('single-process data directory and key files have restrictive permissions')
            alternate=port();second=launch([sys.executable,'scripts/start.py','--host','127.0.0.1','--port',str(alternate),'--trusted-local-proxy'],'duplicate-app',env)
            result=second.wait();assert result.returncode!=0 and result.cleanup_confirmed
            assert '同一数据库只允许一个服务进程' in (root/'duplicate-app.log').read_text();record('second process fails closed on the same data directory')
            readonly=root/'readonly-data';readonly.mkdir(mode=0o500)
            try:
                locked=launch([sys.executable,'scripts/start.py','--host','127.0.0.1','--port',str(port()),'--trusted-local-proxy'],'readonly-app',{**env,'DATA_DIR':str(readonly)})
                result=locked.wait();assert result.returncode!=0 and result.cleanup_confirmed
                assert not (readonly/'lidian.sqlite3').exists();record('unwritable data directory refuses startup without an empty database')
            finally:readonly.chmod(0o700)
            for address in ('127.0.0.20','127.0.0.21'):
                with client(address) as c:
                    results=[c.get('/api/auth/me',headers={'X-Forwarded-For':f'203.0.113.{i}'}).status_code for i in range(31 if address.endswith('20') else 1)]
                assert results==([401]*30+[429] if address.endswith('20') else [401])
            record('proxy overwrites spoofed XFF and distinct source IP buckets remain isolated')
            with httpx.Client(base_url=f'http://127.0.0.1:{baseport}',transport=httpx.HTTPTransport(local_address='127.0.0.22'),trust_env=False,timeout=5) as direct:
                results=[direct.get('/api/auth/me',headers={'Host':f'127.0.0.1:{tlsport}','X-Forwarded-For':f'203.0.113.{i}'}).status_code for i in range(31)]
            assert results==[401]*30+[429];record('non-allowlisted direct peer cannot forge forwarded client IP')
            receipt=backup(data/'lidian.sqlite3',root/'snapshot.sqlite3',include_key=True);assert receipt['key_included'] and receipt['private_connection_count']==1;record('online backup validates database and matching private key')
            stop(active);active=app('restart');ready()
            assert expect(a.get('/api/datasets/'+dataset['id']))['content_hash']==dataset['content_hash'];record('hard process restart preserves authenticated dataset revision')
            assert expect(a.get('/api/runs/'+run['id']))['state']=='interrupted';record('inflight synthetic task becomes interrupted without automatic replay')
            stop(active);restored=root/'restored';restored.mkdir(mode=0o700)
            shutil.copyfile(root/'snapshot.sqlite3',restored/'lidian.sqlite3');shutil.copyfile(root/'snapshot.sqlite3.credentials.key',restored/'credentials.key')
            env['DATA_DIR']=str(restored);active=app('restored');ready()
            assert expect(a.get('/api/datasets/'+dataset['id']))['content_hash']==dataset['content_hash'];record('empty-directory restore preserves real session and dataset hash')
            assert backup(restored/'lidian.sqlite3',root/'restored-check.sqlite3',include_key=True)['key_included'];record('restored backup verifies every private credential cipher')
            stop(active);key=(restored/'credentials.key').read_bytes();(restored/'credentials.key').unlink()
            try:backup(restored/'lidian.sqlite3',root/'missing-key.sqlite3',include_key=True)
            except ValueError:pass
            else:raise AssertionError('missing key backup accepted')
            assert not (root/'missing-key.sqlite3').exists() and not (restored/'credentials.key').exists();record('missing key backup fails closed without partial files or replacement key')
            active=app('missing-key');ready()
            count=len(expect(a.get('/api/runs'))['items'])
            r=a.post('/api/workspace/plans',json={'dataset_id':dataset['id'],'query':'核验现金流','provider':connection['id'],'use_llm':True,'max_calls':1})
            assert r.status_code in (500,503) and len(expect(a.get('/api/runs'))['items'])==count;record('missing private key blocks planning despite healthy database endpoint')
            stop(active);assert not (restored/'credentials.key').exists()
            from cryptography.fernet import Fernet
            (restored/'credentials.key').write_bytes(Fernet.generate_key());active=app('wrong-key');ready()
            r=a.post('/api/workspace/plans',json={'dataset_id':dataset['id'],'query':'核验现金流','provider':connection['id'],'use_llm':True,'max_calls':1})
            assert r.status_code in (500,503) and len(expect(a.get('/api/runs'))['items'])==count;record('wrong private key blocks planning and creates no run')
            stop(active);(restored/'credentials.key').write_bytes(key)
        report['source_after']=identity(root,owned,deadline,'after')
        report['source_unchanged']=report['source_after']==source
        assert report['source_unchanged'];record('runtime and proxy source bytes unchanged throughout acceptance')
        report['passed']=True
    except BaseException as exc:
        report['error']={'type':type(exc).__name__,'message':str(exc)[:1500]};print('FAIL',type(exc).__name__,str(exc)[:400],flush=True)
    finally:
        for process in reversed(owned):
            try:stop(process)
            except Exception as exc:report['passed']=False;report['cleanup_error']=type(exc).__name__
        report['cleanup_confirmed']=all(p.get('cleanup_confirmed') for p in report['processes']) and len(report['processes'])==len(owned)
        report['finished_at']=time.time();report['count']=len(report['checks']);report['nginx_binary_sha256']=hashlib.sha256(nginx.read_bytes()).hexdigest()
        for path in root.glob('*.log'):shutil.copyfile(path,out/path.name)
        if report['cleanup_confirmed']:shutil.rmtree(root)
        else:report['retained_private_temporary_root']=str(root);report['passed']=False
        os.umask(old_umask);destination.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
