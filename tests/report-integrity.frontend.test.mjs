/** Report badges use the shared verdict without treating pending evidence as corrupt. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runPage} from '../web/dist/views-studio.js';
import {state} from '../web/dist/state.js';
import {invalidateContext,invalidateView} from '../web/dist/api.js';

function fixtures(runState='running',withResult=false){
 const analysis={metrics:{},series:[],current_period:'2025-Q4',gmps:{method:'local',score:null,coverage:0,dimensions:[]},dqi:{method:'local',score:null,coverage:0,dimensions:[]}};
 const run={id:'test-run',state:runState,created_at:'2026-10-01',payload:{query:'测试报告校验'},snapshot:{dataset:{company:'隔离合成企业'},citations:[],memory:[]},result:withResult?{title:'冻结报告',analysis,findings:[],warnings:[],llm:{state:'not_requested',review:{claims:[],rejected_claims:0}}}:null};
 const audit={ledger:{valid:true},data_hash_valid:true,snapshot_hash_valid:withResult?true:null,report_hash_valid:withResult?true:null,artifacts:[],trace:[],source_impact:null,report_integrity:{valid:withResult,failures:withResult?[]:['report_missing','report_completion']}};
 return {run,audit};
}
async function render(run,audit){
 const previous=globalThis.fetch;
 Object.assign(state,{user:{id:'owner',preferences:{amount_unit:'wan'}},identity:'',cache:{}});
 globalThis.fetch=async url=>new Response(JSON.stringify(url.endsWith('/audit')?{...audit,run}:url.endsWith('/reviews')?{items:[]}:run),{headers:{'content-type':'application/json'}});
 try{return await runPage(run.id);}finally{globalThis.fetch=previous;}
}

for(const status of ['queued','running'])test('healthy '+status+' execution awaits report evidence without a corruption alarm',async()=>{
 const {run,audit}=fixtures(status);
 const html=await render(run,audit);
 assert(html.includes('报告校验待完成'));
 assert(!html.includes('记录一致性异常')&&!html.includes('记录一致性通过'));
 audit.ledger.valid=false;
 assert((await render(run,audit)).includes('记录一致性异常'));
});

test('unpublished final artifact is still pending while its independent anchor is being written',async()=>{
 const {run,audit}=fixtures('running');
 audit.artifacts=[{node:'report',integrity_valid:true,event_anchor_valid:false}];
 const html=await render(run,audit);
 assert(html.includes('报告校验待完成')&&!html.includes('记录一致性异常'));
});

test('missing terminal evidence overrides otherwise valid individual hashes',async()=>{
 const {run,audit}=fixtures('succeeded',true);
 assert((await render(run,audit)).includes('记录一致性通过'));
 audit.report_integrity={valid:false,failures:['report_completion']};
 const html=await render(run,audit);
 assert(html.includes('记录一致性异常')&&!html.includes('记录一致性通过'));
});

test('completed missing result is corrupt while failed no-report outcome is unavailable',async()=>{
 let {run,audit}=fixtures('succeeded');
 assert((await render(run,audit)).includes('记录一致性异常'));
 ({run,audit}=fixtures('failed'));
 const html=await render(run,audit);
 assert(html.includes('尚无可校验报告')&&!html.includes('记录一致性通过'));
});

test('old legacy output without a whole-result hash discloses partial verification',async()=>{
 const {run,audit}=fixtures('succeeded',true);
 audit.report_integrity.format='legacy';audit.report_hash_valid=null;
 const html=await render(run,audit);
 assert(html.includes('旧版记录：部分校验通过')&&html.includes('没有完整输出的独立散列证据'));
 assert(!html.includes('记录一致性通过'));
});

function adaptivePair(status,withResult){
 const pair=fixtures(status,withResult);
 pair.run.snapshot.studio={adaptive:{},nodes:[]};
 pair.audit.run=pair.run;
 return pair;
}
function runtime(state){return {state,run_state:state,graph:{payload:{nodes:[],envelope:{max_calls:0}}},usage:{attempts:0,characters:0},checkpoints:[],control:{run_id:'test-run'}};}
function response(value){return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});}

test('publication between page reads refreshes the bound report and audit instead of freezing a healthy answer',async()=>{
 const pending=adaptivePair('running',false),complete=adaptivePair('succeeded',true);
 const previous=globalThis.fetch,requests=[];let audits=0;
 Object.assign(state,{user:{id:'owner',preferences:{amount_unit:'wan'}},identity:'',cache:{}});
 globalThis.fetch=async(url,options)=>{
  requests.push([url,options.method]);
  // This is the actual failing ordering: an independent GET run would already
  // be terminal, while the first audit belongs to pre-publication state.
  if(url==='/api/runs/test-run')return response(complete.run);
  if(url.endsWith('/audit'))return response(++audits===1?pending.audit:complete.audit);
  if(url.endsWith('/runtime'))return response(runtime('succeeded'));
  if(url.endsWith('/reviews'))return response({items:[]});
  assert.fail(url);
 };
 try{
  const html=await runPage('test-run');
  assert(html.includes('冻结报告')&&html.includes('记录一致性通过'));
  assert(!html.includes('记录一致性异常')&&!html.includes('data-report-unverified'));
  assert(html.includes('data-action="action-from-report"')&&html.includes('/export?format=json'));
  assert.equal(audits,2);
  assert.deepEqual(state.cache.run,complete.run);
  assert.deepEqual(state.cache.audit.run,state.cache.run);
  assert(requests.every(([url,method])=>method==='GET'&&url!=='/api/runs/test-run'));
 }finally{globalThis.fetch=previous;}
});

test('a coherent unpublished response remains honestly pending until live completion refreshes it',async()=>{
 const pending=adaptivePair('running',false),complete=adaptivePair('succeeded',true);
 const previous=globalThis.fetch;let reads=0;
 Object.assign(state,{user:{id:'owner',preferences:{amount_unit:'wan'}},identity:'',cache:{}});
 globalThis.fetch=async url=>response(url.endsWith('/audit')?(++reads,pending.audit):url.endsWith('/runtime')?runtime('running'):url.endsWith('/reviews')?{items:[]}:complete.run);
 try{
  const html=await runPage('test-run');
  assert(html.includes('报告校验待完成')&&!html.includes('记录一致性异常'));
  assert(!html.includes('冻结报告')&&!html.includes('/export?format='));
  assert(!html.includes('data-action="action-from-report"'));
  assert.equal(reads,1);assert.equal(state.cache.run.result,null);
 }finally{globalThis.fetch=previous;}
});

test('a completed corrupt bound report stays blocked without retrying or writing',async()=>{
 const {run,audit}=adaptivePair('succeeded',true);
 audit.report_integrity={valid:false,failures:['report_completion']};
 const previous=globalThis.fetch,requests=[];let reads=0;
 Object.assign(state,{user:{id:'owner',preferences:{amount_unit:'wan'}},identity:'',cache:{}});
 globalThis.fetch=async(url,options)=>{requests.push(options.method);return response(url.endsWith('/audit')?(++reads,audit):url.endsWith('/runtime')?runtime('succeeded'):{items:[]});};
 try{
  const html=await runPage(run.id);
  assert(html.includes('记录一致性异常')&&html.includes('data-report-unverified'));
  assert(!html.includes('data-action="action-from-report"')&&!html.includes('/export?format='));
  assert.equal(reads,1);assert(requests.every(method=>method==='GET'));
 }finally{globalThis.fetch=previous;}
});

for(const [name,invalidate,code] of [['navigation',invalidateView,'STALE_VIEW'],['account or identity',invalidateContext,'STALE_SESSION']])test('late publication refresh cannot replace '+name+' state or drafts',async()=>{
 const pending=adaptivePair('running',false),complete=adaptivePair('succeeded',true);
 const previous=globalThis.fetch;let reads=0,release,refreshStarted;
 const refreshing=new Promise(resolve=>{refreshStarted=resolve;});
 const delayed=new Promise(resolve=>{release=resolve;});
 Object.assign(state,{user:{id:'owner',preferences:{amount_unit:'wan'}},identity:'',cache:{}});
 globalThis.fetch=async url=>{
  if(url.endsWith('/audit')){if(++reads===1)return response(pending.audit);refreshStarted();return delayed;}
  return response(url.endsWith('/runtime')?runtime('succeeded'):{items:[]});
 };
 try{
  const page=runPage('test-run');
  await refreshing;
  invalidate();
  const currentCache={current:'newer-page'};state.cache=currentCache;state.query='尚未提交的新问题';state.dirty=true;
  release(response(complete.audit));
  await assert.rejects(page,error=>error.code===code);
  assert.equal(state.cache,currentCache);assert.equal(state.query,'尚未提交的新问题');assert.equal(state.dirty,true);
 }finally{globalThis.fetch=previous;state.dirty=false;}
});

test('an unbound audit cannot silently certify an independently read report',async()=>{
 const {audit}=fixtures('succeeded',true),previous=globalThis.fetch;
 state.cache={current:'preserved'};
 globalThis.fetch=async url=>response(url.endsWith('/audit')?audit:{items:[]});
 try{await assert.rejects(runPage('test-run'),/报告与校验记录尚未同步/);assert.equal(state.cache.current,'preserved');}
 finally{globalThis.fetch=previous;}
});

test('live graph updates preserve the exported audit snapshot and refresh completion only without drafts',()=>{
 const {run,audit}=adaptivePair('running',false),snapshot=structuredClone(audit);
 const viewState={route:'agents',id:'run-test-run',user:{id:'owner'},dirty:true,cache:{run,audit,runtime:runtime('running')}};
 const app=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
 const start=app.indexOf('function setupLive()'),end=app.indexOf("document.addEventListener('keydown'",start);
 assert(start>=0&&end>start);
 let receive,done,renders=0;
 class FakeLive{constructor(id,onUpdate,onDone){assert.equal(id,run.id);receive=onUpdate;done=onDone;}start(){}}
 const document={activeElement:null,querySelectorAll:()=>[],querySelector:()=>null};
 new Function('state','document','RunLive','render','let live=null;'+app.slice(start,end)+'setupLive();')(
  viewState,document,FakeLive,()=>{renders++;});
 receive(runtime('succeeded'),[{seq:99,type:'succeeded',payload:{report_ready:true}}]);
 assert.deepEqual(viewState.cache.audit,snapshot);
 done();assert.equal(renders,0);assert.equal(viewState.dirty,true);
 viewState.dirty=false;done();assert.equal(renders,1);
});
