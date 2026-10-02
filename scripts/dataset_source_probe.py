"""Real isolated Uvicorn/restart source-binding acceptance; no external suppliers."""
from __future__ import annotations
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import httpx
from scripts.full_chain_check import ProductServer, register, require


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();checks=[]
    report={'executed_at':datetime.now(timezone.utc).isoformat(),'synthetic_only':True,
            'external_supplier_calls':0,'transport':'real loopback HTTP, Uvicorn, SQLite and hard restart','checks':checks}
    def record(text):checks.append(text);print('PASS',text,flush=True)
    try:
        with tempfile.TemporaryDirectory(prefix='lidian-dataset-binding-') as directory:
            server=ProductServer(Path(directory)/'product');server.start()
            try:
                with httpx.Client(base_url=server.base,trust_env=False,timeout=15) as client, httpx.Client(base_url=server.base,trust_env=False,timeout=15) as other:
                    register(client);register(other)
                    fixture=json.loads((Path(__file__).resolve().parents[1]/'tests/fixtures/synthetic-financial.json').read_text())
                    fixture['source_kind']='user_provided'
                    d=require(client.post('/api/datasets',json=fixture),201)
                    ref={'kind':'dataset','dataset_version':d['version'],'dataset_hash':d['content_hash']}
                    saved=[]
                    for kind,path in [('action','/api/workspace/actions'),('watch','/api/services/watches')]:
                        body={'title':'Explicit synthetic viewed-revision fixture','dataset_id':d['id'],'request_id':'http-source-'+kind,'source_ref':ref}
                        body.update({'acceptance':'Verify the exact synthetic financial revision'} if kind=='action' else {'metric':'revenue','operator':'lt','threshold':-1e15})
                        for missing in (None,{'kind':'dataset'},{'kind':'dataset','dataset_version':d['version']},{'kind':'dataset','dataset_hash':d['content_hash']}):
                            require(client.post(path,json={**body,'source_ref':missing}),422)
                        require(other.post(path,json=body),404)
                        row=require(client.post(path,json=body),201)
                        assert row['payload']['provenance']['dataset_hash']==d['content_hash']
                        saved.append((path,body,row))
                    record('Both HTTP create routes reject missing/partial and cross-owner refs; exact viewed revision succeeds')
                    update=deepcopy(d['payload']);update.pop('verification',None);update.pop('input_amount_unit',None)
                    update['version']=d['version'];update['periods'][-1]['revenue']+=10
                    current=require(client.put('/api/datasets/'+d['id'],json=update));assert current['version']==2
                    for path,body,row in saved:
                        require(client.post(path,json={**body,'request_id':body['request_id']+'-new'}),409)
                        require(client.post(path,json={**body,'request_id':body['request_id']+'-old','source_ref':{**ref,'allow_historical':True}}),409)
                        assert require(client.post(path,json=body),201)['payload']==row['payload']
                    record('Stale direct revision stays 409 even with historical acknowledgement; exact request retry preserves old payload')
                    server.stop(hard=True);server.start()
                    for path,body,row in saved:
                        replay=require(client.post(path,json=body),201)
                        assert replay['id']==row['id'] and replay['payload']==row['payload'] and replay['source_impact']['state']=='changed'
                    assert len(require(client.get('/api/workspace/actions'))['items'])==1
                    tracking=require(client.get('/api/services/tracking'));assert len(tracking['rules'])==1
                    watch=tracking['rules'][0];keys=('title','identity_id','dataset_id','metric','operator','threshold','active','stale_after_days','expires_at')
                    edit={key:watch['payload'][key] for key in keys};edit.update(version=watch['version'],active=False)
                    revised=require(client.put('/api/services/watches/'+watch['id'],json=edit))
                    assert revised['payload']['provenance']==watch['payload']['provenance']
                    record('Hard restart preserves immutable bindings and exactly one object per request; versioned source-omitting watch edit succeeds')
            finally:server.stop()
        report['passed']=True
    except BaseException as error:
        report['passed']=False;report['error']=type(error).__name__+': '+str(error);raise
    finally:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()
