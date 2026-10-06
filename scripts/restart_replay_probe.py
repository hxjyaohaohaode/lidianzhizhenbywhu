"""Isolated synthetic HTTP acceptance; no provider connection and no production data."""
import sys, json, tempfile, copy, concurrent.futures, argparse
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import httpx
from scripts.full_chain_check import ProductServer, require, register, plan, approve, wait_run
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,required=True,help='JSON report destination; uses only isolated temporary business data')
args=parser.parse_args()
args.output.parent.mkdir(parents=True,exist_ok=True)
checks=[]
def record(name): checks.append(name);print('PASS',name,flush=True)
def body(stage):return {'version':stage['version'],'fingerprint':stage['payload']['fingerprint']}
def imported(c,**kwargs):
    csv='period,revenue,cost,net_profit,cash_flow\n'+''.join(f'{2023+i//4}-Q{i%4+1},{100+i*5},70,10,12\n' for i in range(12))
    return require(c.post('/api/workspace/imports/file',data={'company':'Explicit synthetic restart fixture',**kwargs},files={'file':('synthetic.csv',csv.encode(),'text/csv')}),201)
report={'synthetic_only':True,'real_external_supplier_calls':0,'transport':'real loopback HTTP to actual Uvicorn + SQLite','checks':checks}
try:
 with tempfile.TemporaryDirectory(prefix='lidian-additional-acceptance-') as td:
  srv=ProductServer(Path(td)/'product');srv.start()
  try:
   with httpx.Client(base_url=srv.base,trust_env=False,timeout=15) as c:
    register(c)
    stage=imported(c)
    srv.stop(hard=True);srv.start()
    assert require(c.get('/api/datasets'))['items']==[]
    d=require(c.post('/api/workspace/imports/'+stage['id']+'/commit',json=body(stage)),201)
    srv.stop(hard=True);srv.start()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
     saved=list(pool.map(lambda _:require(c.post('/api/workspace/imports/'+stage['id']+'/commit',json=body(stage)),201),range(4)))
    assert all(x['id']==d['id'] and x['version']==1 for x in saved)
    assert len(require(c.get('/api/datasets'))['items'])==1
    revisions=require(c.get('/api/workspace/datasets/'+d['id']+'/revisions'))['items']
    assert len(revisions)==1
    record('Uncommitted preview survives SIGKILL without business write; committed import replay after restart/concurrent retries creates one dataset revision')
    stale=imported(c,target_id=d['id'],target_version=str(d['version']),merge_mode='merge')
    update=copy.deepcopy(d['payload']);update.pop('verification',None);update.pop('input_amount_unit',None);update.update(version=d['version'],notes='Explicit synthetic manual correction')
    revised=require(c.put('/api/datasets/'+d['id'],json=update))
    srv.stop(hard=True);srv.start()
    assert c.post('/api/workspace/imports/'+stale['id']+'/commit',json=body(stale)).status_code==409
    d=require(c.get('/api/datasets/'+d['id']));assert d['version']==revised['version']
    record('Preview made stale by a concurrent dataset revision remains rejected after SIGKILL/restart without overwriting correction')
    run=wait_run(c,approve(c,plan(c,d))['id']);assert run['result']
    action_body={'request_id':'restart-action-fixture','title':'Synthetic report follow-up','acceptance':'Verify isolated fixture provenance','dataset_id':d['id'],'source_ref':{'kind':'report','run_id':run['id']}}
    action=require(c.post('/api/workspace/actions',json=action_body),201)
    watch_body={'request_id':'restart-watch-fixture','title':'Synthetic watch','dataset_id':d['id'],'metric':'gross_margin','operator':'lt','threshold':.99,'stale_after_days':1460,'source_ref':{'kind':'action','action_id':action['id'],'action_version':action['version'],'action_hash':action['object_hash']}}
    watch=require(c.post('/api/services/watches',json=watch_body),201)
    initial=require(c.get('/api/services/tracking'))
    alerts=[x for x in initial['alerts'] if x['payload']['rule_id']==watch['id']];assert len(alerts)==1
    srv.stop(hard=True);srv.start()
    assert require(c.post('/api/workspace/actions',json=action_body),201)['id']==action['id']
    assert require(c.post('/api/services/watches',json=watch_body),201)['id']==watch['id']
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
     readings=list(pool.map(lambda _:require(c.get('/api/services/tracking')),range(8)))
    assert all([x['id'] for x in t['alerts'] if x['payload']['rule_id']==watch['id']]==[alerts[0]['id']] for t in readings)
    audit=require(c.get('/api/workspace/runs/'+run['id']+'/audit'));assert audit['ledger']['valid'] and audit['report_hash_valid']
    assert require(c.get('/api/runs/'+run['id']))['result']==run['result']
    record('Report→action→watch survives SIGKILL; POST replay and concurrent tracking reads keep original IDs and one alert; report ledger/hash stay intact')
    actions=require(c.get('/api/workspace/actions'))['items'];assert len(actions)==1
    active=require(c.put('/api/workspace/actions/'+action['id']+'/status',json={'version':action['version'],'status':'in_progress'}))
    assert c.put('/api/workspace/actions/'+action['id']+'/status',json={'version':action['version'],'status':'done','note':'Stale replay must not complete'}).status_code==409
    srv.stop(hard=True);srv.start()
    assert require(c.get('/api/workspace/actions'))['items'][0]['version']==active['version']
    assert require(c.get('/api/workspace/actions'))['items'][0]['payload']['status']=='in_progress'
    record('Stale action completion returns 409 and remains uncommitted after restart')
  finally:srv.stop()
 report['passed']=True
except Exception as e:
 report.update(passed=False,error=repr(e));raise
finally:args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
