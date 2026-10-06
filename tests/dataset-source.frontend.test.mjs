/** Rendered form contracts and production submit branches with I/O doubles, not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {actionForm} from '../web/dist/views-analysis.js';
import {watchThresholdRequest} from '../web/dist/watch-units.js';
import {watchForm} from '../web/dist/views-services.js';
import {formSource} from '../web/dist/business-source.js';
import {state} from '../web/dist/state.js';
const hash='a'.repeat(64),otherHash='b'.repeat(64);
function setup(){Object.assign(state,{user:{name:'测试研究员'},identity:'',identities:[],active:'viewed',datasets:[{id:'viewed',version:2,content_hash:hash,payload:{company:'原企业'}},{id:'other',version:3,content_hash:otherHash,payload:{company:'其他企业'}}]});}
function hidden(html,name){const tag=[...html.matchAll(/<input\b[^>]*>/g)].map(x=>x[0]).find(x=>x.includes(`name="${name}"`));assert(tag);return tag.match(/value="([^"]*)"/)[1].replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');}
function fromHtml(html,name){const fd=new FormData();fd.set(name,hidden(html,name));return fd;}
function branch(file,label){const js=ts.transpileModule(readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;const begin=js.indexOf(`case '${label}':`),end=js.indexOf("case '",begin+8);assert(begin>=0&&end>begin);return js.slice(begin,end);}
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const submitAction=new AsyncFunction('env',`const {form,f,str,workspace,formSource}=env;const submittedContext=()=>false;let changed=false,savedDraftMessage='';switch('action-form'){${branch('app.ts','action-form')}}return changed;`);
const submitWatch=new AsyncFunction('env',`const {form,fd,str,api,formSource,state,watchThresholdRequest}=env;const id=form.dataset.id??'',version=Number(form.dataset.version??0),submittedContext=()=>false;let savedWatchCreate=false;switch('watch'){${branch('experience.ts','watch')}}return savedWatchCreate;`);

test('rendered manual action keeps its viewed revision across a later global dataset refresh',async()=>{
 setup();const f=fromHtml(actionForm(),'source_ref');const form={dataset:{datasetId:'viewed',identityId:'',requestId:'frozen-request'},isConnected:true};
 state.datasets[0]={...state.datasets[0],version:9,content_hash:otherHash};const calls=[];
 assert(await submitAction({form,f,str:()=>'',formSource,workspace:async(...args)=>{calls.push(args);return {id:'new-action'};}}));
 assert.equal(calls[0][0],'/actions');assert.equal(calls[0][1],'POST');assert.equal(calls[0][2].dataset_id,'viewed');
 assert.deepEqual(calls[0][2].source_ref,{kind:'dataset',dataset_version:2,dataset_hash:hash,allow_historical:false});
});
test('rendered watch picker submits the selected frozen revision and preserves an older open draft',async()=>{
 setup();const fd=fromHtml(watchForm(),'source_datasets');fd.set('dataset_id','other');fd.set('metric','gross_margin');fd.set('threshold','15');state.datasets=[];const calls=[];
 assert(await submitWatch({watchThresholdRequest,form:{dataset:{},querySelector:()=>null},fd,str:k=>String(fd.get(k)??''),state,formSource,api:async(...args)=>{calls.push(args);return {id:'watch'};}}));
 assert.equal(calls[0][2].threshold,.15);assert.equal(calls[0][0],'/services/watches');assert.equal(calls[0][2].dataset_id,'other');
 assert.deepEqual(calls[0][2].source_ref,{kind:'dataset',dataset_version:3,dataset_hash:otherHash});
});
for(const ref of [null,{kind:'dataset'},{kind:'dataset',dataset_version:2},{kind:'dataset',dataset_hash:hash},{kind:'dataset',dataset_version:'2',dataset_hash:hash},{kind:'dataset',dataset_version:true,dataset_hash:hash}])test('action and watch creation block incomplete source before any API call: '+JSON.stringify(ref),async()=>{
 const fd=new FormData();fd.set('dataset_id','viewed');if(ref)fd.set('source_ref',JSON.stringify(ref));let calls=0;
 const io=async()=>{calls++;return {};};
 await assert.rejects(submitAction({form:{dataset:{datasetId:'viewed'}},f:fd,str:()=>'',workspace:io,formSource}),/请刷新并重新打开表单/);
 await assert.rejects(submitWatch({watchThresholdRequest,form:{dataset:{},querySelector:()=>null},fd,str:k=>String(fd.get(k)??''),api:io,formSource,state}),/请刷新并重新打开表单/);
 assert.equal(calls,0);
});
test('incomplete picker entries cannot silently omit undefined hashes during JSON transport',()=>{
 for(const ref of [{},{version:1},{hash},{version:0,hash},{version:1,hash:'invalid'}]){const fd=new FormData();fd.set('dataset_id','viewed');fd.set('source_datasets',JSON.stringify({viewed:ref}));assert.throws(()=>formSource(fd,'viewed'),/版本或指纹缺失/);}
});
test('dataset-less manual action and versioned watch update remain valid without a new source ref',async()=>{
 const calls=[],io=async(...args)=>{calls.push(args);return {version:3};},fd=new FormData();fd.set('dataset_id','viewed');fd.set('metric','gross_margin');fd.set('threshold','15');
 await submitAction({form:{dataset:{datasetId:''}},f:new FormData(),str:()=>'',workspace:io,formSource});
 await submitWatch({watchThresholdRequest,form:{dataset:{id:'original-watch',version:'2'},querySelector:()=>null},fd,str:k=>String(fd.get(k)??''),api:io,formSource,state});
 assert.equal(calls[0][2].dataset_id,'');assert(!('source_ref' in calls[0][2]));
 assert.equal(calls[1][0],'/services/watches/original-watch');assert.equal(calls[1][1],'PUT');assert.equal(calls[1][2].version,2);assert(!('source_ref' in calls[1][2]));
});
