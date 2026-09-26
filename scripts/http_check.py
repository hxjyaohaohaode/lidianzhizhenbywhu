"""Actual loopback HTTP smoke/limited read-load and safe backup check.
Creates an explicitly named synthetic test account. Never target public/production data.
"""
from __future__ import annotations
import concurrent.futures,json,time,uuid,statistics,subprocess,sys,tempfile,sqlite3
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[1]

def main():
    out=ROOT/'evidence';out.mkdir(exist_ok=True)
    checks=[];timings=[]
    with httpx.Client(base_url='http://127.0.0.1:8000',timeout=20,trust_env=False) as client:
        for url in ('/','/assets/styles.css','/assets/dist/app.js','/api/docs','/api/openapi.json'):
            r=client.get(url)
            # The product static mount maps /assets/app.js rather than source-folder paths.
            if url=='/assets/dist/app.js' and r.status_code==404:r=client.get('/assets/app.js')
            assert r.status_code==200,(url,r.status_code);checks.append({'endpoint':str(r.request.url),'status':r.status_code,'bytes':len(r.content)})
        email=f'http-{uuid.uuid4().hex}@test.example';password='Synthetic-HTTP-acceptance-2026'
        r=client.post('/api/auth/register',json={'email':email,'password':password,'name':'隔离HTTP验收账户'});r.raise_for_status();csrf=r.json()['csrf'];headers={'X-CSRF-Token':csrf}
        assert client.get('/api/workspace/brief').json()['counts']['datasets']==0
        def request(_):
            start=time.perf_counter();r=client.get('/api/workspace/brief');assert r.status_code==200;r.json();return round((time.perf_counter()-start)*1000,3)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:timings=list(pool.map(request,range(32)))
        exported=client.get('/api/workspace/export');exported.raise_for_status();assert 'auth_sessions' not in exported.json()
        r=client.request('DELETE','/api/account',json={'email':email,'password':password},headers=headers);r.raise_for_status()
        assert client.get('/api/workspace/brief').status_code==401
    backup={}
    with tempfile.TemporaryDirectory() as directory:
        source=Path(directory)/'source.sqlite3';target=Path(directory)/'copy.sqlite3'
        with sqlite3.connect(source) as db:db.execute('CREATE TABLE example(value TEXT)');db.execute("INSERT INTO example VALUES('synthetic backup probe')");db.commit()
        cmd=[sys.executable,str(ROOT/'scripts/backup.py'),'--source',str(source),'--output',str(target)]
        r=subprocess.run(cmd,capture_output=True,text=True);assert r.returncode==0,r.stderr
        with sqlite3.connect(target) as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert db.execute('SELECT value FROM example').fetchone()[0]=='synthetic backup probe'
        r2=subprocess.run(cmd,capture_output=True,text=True);assert r2.returncode!=0
        backup={'copy_integrity':'ok','refuses_overwrite':True,'scope':'synthetic SQLite backup only; not a production disaster recovery certification'}
    values=sorted(timings);result={'passed':True,'http_smoke':checks,'reads':len(timings),'read_concurrency':4,'median_ms':round(statistics.median(timings),3),'p95_ms':values[int(.95*len(values))],'max_ms':max(values),'individual_ms':timings,'backup':backup,'scope':'loopback API, tiny empty workspace, no network or long-duration SLO claim'}
    (out/'http-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
