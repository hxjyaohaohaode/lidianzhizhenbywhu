/** Compiled production page renderers with isolated fetch doubles, not native UI evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {agentsPage} from '../web/dist/views-studio.js';
import {state} from '../web/dist/state.js';
import {invalidateContext,invalidateView} from '../web/dist/api.js';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const node={id:'quality',name:'冻结数据核验节点',engine:'deterministic',depends_on:[]};
const creationPaths=['/api/workspace/orchestration/catalog','/api/workspace/plans?identity_id=scope&dataset_id=dataset','/api/workspace/templates','/api/conversations','/api/workspace/experiments?identity_id=scope','/api/workspace/comparisons?identity_id=scope'];
const runPaths=['/api/workspace/runs/run/audit','/api/workspace/runs/run/reviews'];
function setup(kind='adaptive'){
 invalidateContext();invalidateView();
 Object.assign(state,{user:{id:'owner',preferences:{amount_unit:'wan'}},identity:'scope',identities:[],active:'dataset',datasets:[{id:'dataset',version:1,content_hash:'a'.repeat(64),payload:{company:'隔离合成企业',name:'测试数据'}}],cache:{},query:'本次明确的研究问题',dirty:false});
 const plan={id:'plan',version:7,payload:{status:'draft',request:{query:'冻结的审批问题'},snapshot:{dataset:{company:'隔离合成企业',periods:[{period:'2026-Q2'}]},citations:[],memory:[]},nodes:[node],max_calls:0,context:{},quality:{findings:[],closed_quarters:1,warning_count:0,field_coverage:{present:1,total:1,period:'2026-Q2'}},packing:{characters:0,limit:2000,dropped:[],included_memory_ids:[]},excluded_memory:[],blockers:[],fingerprint:'frozen-plan-fingerprint',bindings:{dataset_version:1}}};
 const run={id:'run',state:'running',created_at:'2026-10-05',payload:{query:'冻结的运行问题'},snapshot:{dataset:{company:'隔离合成企业'},citations:[],memory:[],...(kind==='legacy'?{}:{studio:{nodes:[node],...(kind==='adaptive'?{adaptive:{}}:{})}})},result:null};
 const audit={run,ledger:{valid:true},data_hash_valid:true,snapshot_hash_valid:true,report_hash_valid:null,artifacts:[],trace:[{seq:1,type:'step_started',payload:{node:'quality'},created_at:'2026-10-05'}]};
 const runtime={state:'running',run_state:'running',graph:{payload:{nodes:[node],envelope:{max_calls:0}}},usage:{attempts:0,characters:0},control:{run_id:'run'},checkpoints:[]};
 const catalog={capabilities:[{...node,name:'当前目录核验节点'}],providers:[]};
 const responses={
  [creationPaths[0]]:catalog,[creationPaths[1]]:{items:[],total:0},[creationPaths[2]]:{items:[]},[creationPaths[3]]:{items:[{id:'conversation',payload:{identity_id:'scope',title:'当前身份会话'}}]},[creationPaths[4]]:{items:[]},[creationPaths[5]]:{items:[]},
  '/api/workspace/plans/plan':plan,[runPaths[0]]:audit,[runPaths[1]]:{items:[]},'/api/workspace/runs/run/runtime':runtime,
 };
 return {plan,run,audit,runtime,catalog,responses};
}
async function withFetch(fixture,body,read=(path)=>json(fixture.responses[path])){
 const old=globalThis.fetch,paths=[];
 globalThis.fetch=(path,options)=>{paths.push(path);assert.equal(options.method,'GET','Rendering must never submit or retry writes');assert(path in fixture.responses,'Unexpected route: '+path);return Promise.resolve(read(path));};
 try{return await body(paths);}finally{globalThis.fetch=old;}
}

test('plan detail reads only its frozen plan and retains approval version, fingerprint and nodes',async()=>{
 const f=setup();await withFetch(f,async paths=>{
  const html=await agentsPage('plan-plan');assert.deepEqual(paths,['/api/workspace/plans/plan']);
  for(const text of ['冻结的审批问题','冻结数据核验节点','frozen-plan-fingerprint','execute-plan-form','data-version="7"','本计划不会调用外部模型'])assert(html.includes(text),text);
  assert.deepEqual(state.cache.plan,f.plan);assert.deepEqual(state.cache.nodes,[node]);assert.equal(state.cache.audit,null);
 });
});
for(const kind of ['adaptive','saved','legacy'])test(kind+' run detail reads only its required sources and retains actual audit events',async()=>{
 const f=setup(kind);state.cache.agents=[{...node,name:'不可复用的旧目录'}];
 await withFetch(f,async paths=>{
  const html=await agentsPage('run-run');assert.deepEqual(paths,[...runPaths,...(kind==='adaptive'?['/api/workspace/runs/run/runtime']:kind==='legacy'?[creationPaths[0]]:[])]);
  assert(html.includes('冻结的运行问题')&&html.includes('step_started')&&html.includes('报告校验待完成'));
  assert(html.includes(kind==='legacy'?'当前目录核验节点':'冻结数据核验节点'));assert(!html.includes('不可复用的旧目录'));
  assert.deepEqual(state.cache.audit,f.audit);assert.equal(state.cache.runtime?.state,kind==='adaptive'?'running':undefined);
 });
});
test('an explicitly saved empty graph does not borrow current catalog nodes',async()=>{
 const f=setup('saved');f.run.snapshot.studio.nodes=[];
 await withFetch(f,async paths=>{const html=await agentsPage('run-run');assert.deepEqual(paths,runPaths);assert.deepEqual(state.cache.nodes,[]);assert(!html.includes('当前目录核验节点'));});
});
test('terminal runtime still reconciles a stale run and audit before rendering completion',async()=>{
 const f=setup();Object.assign(f.runtime,{state:'failed',run_state:'failed'});let reads=0;
 await withFetch(f,async paths=>{
  const html=await agentsPage('run-run');assert.deepEqual(paths,[...runPaths,'/api/workspace/runs/run/runtime',runPaths[0]]);
  assert.equal(state.cache.run.state,'failed');assert(html.includes('明确的执行失败')&&!html.includes('正在等待真实执行结果'));
 },path=>json(path===runPaths[0]&&++reads===2?{...f.audit,run:{...f.run,state:'failed',error:'明确的执行失败'}}:f.responses[path]));
});
test('creation rereads all six inputs and renders current templates, history, scope and conversation choices',async()=>{
 const f=setup();await withFetch(f,async paths=>{
  const first=await agentsPage();assert.deepEqual(paths,creationPaths);assert(first.includes('plan-form')&&first.includes('当前身份会话')&&first.includes(state.query));
  f.responses[creationPaths[2]].items=[{id:'new-template',version:2,payload:{name:'后来保存的新模板'}}];
  f.responses[creationPaths[1]]={items:[{id:'later-plan',payload:{status:'draft',request:{query:'后来保存的问题'}}}],total:1};
  const second=await agentsPage();assert.deepEqual(paths,[...creationPaths,...creationPaths]);assert(second.includes('后来保存的新模板')&&second.includes('后来保存的问题'));
  assert.deepEqual(state.cache.planExperiments,[]);assert.deepEqual(state.cache.planComparisons,[]);
 });
});
for(const route of ['experiment-missing','comparison-missing:dataset'])test(route+' still validates against all current creation sources',async()=>{
 const f=setup();await withFetch(f,async paths=>{await assert.rejects(agentsPage(route),/实验不在|企业对照已删除/);assert.deepEqual(paths,creationPaths);});
});
test('a saved experiment entry still reads fresh inputs and preserves its selected dataset and quarter',async()=>{
 const f=setup();f.responses[creationPaths[4]].items=[{id:'experiment',version:2,experiment_hash:'b'.repeat(64),payload:{dataset_id:'dataset',dataset_version:1,dataset_hash:'a'.repeat(64),target_period:'2026-Q2',request:{kind:'scenario',name:'明确保存的情景',assumptions:'明确输入的原假设'}}}];
 await withFetch(f,async paths=>{const html=await agentsPage('experiment-experiment');assert.deepEqual(paths,creationPaths);assert(html.includes('<option value="experiment" selected>'));assert(html.includes('<option value="dataset" selected>'));assert(html.includes('2026-Q2经营研判'));assert.equal(state.cache.planExperiments[0].version,2);});
});
test('legacy graph catalog failure stays explicit instead of borrowing the previous page graph',async()=>{
 const f=setup('legacy');state.cache.agents=[{...node,name:'旧目录'}];
 await withFetch(f,async paths=>{await assert.rejects(agentsPage('run-run'),error=>error.status===503);assert.deepEqual(paths,[...runPaths,creationPaths[0]]);},path=>path===creationPaths[0]?json({error:{code:'UNAVAILABLE',message:'目录读取失败'}},503):json(f.responses[path]));
});
for(const [route,failing] of [['plan-plan','/api/workspace/plans/plan'],['run-run',runPaths[0]],['run-run','/api/workspace/runs/run/runtime'],['',creationPaths[5]]])test('required failure stays explicit with no retries: '+route+' '+failing,async()=>{
 const f=setup();await withFetch(f,async paths=>{
  await assert.rejects(agentsPage(route),error=>error.code==='RATE_LIMITED'&&error.status===429);assert.equal(paths.filter(p=>p===failing).length,1);
 },path=>path===failing?json({error:{code:'RATE_LIMITED',message:'请求过于频繁'}},429):json(f.responses[path]));
});
for(const [label,invalidate] of [['navigation',invalidateView],['identity',invalidateContext]])for(const [route,late,kind] of [['plan-plan','/api/workspace/plans/plan','adaptive'],['run-run',runPaths[0],'adaptive'],['run-run','/api/workspace/runs/run/runtime','adaptive'],['run-run',creationPaths[0],'legacy'],['',creationPaths[5],'adaptive']])test('late '+label+' '+route+' '+late+' cannot overwrite new page caches or input',async()=>{
 const f=setup(kind),pending=deferred();await withFetch(f,async()=>{
  const task=agentsPage(route);await new Promise(resolve=>setImmediate(resolve));invalidate();
  const newer={plan:{id:'new-plan'},run:{id:'new-run'},nodes:['new-nodes'],audit:{trace:['new-events']},planExperiments:['new-experiment'],planComparisons:['new-comparison']};state.cache=structuredClone(newer);state.query='仍在编辑的新问题';state.dirty=true;
  pending.resolve(json(f.responses[late]));await assert.rejects(task,/迟到|旧页面/);assert.deepEqual(state.cache,newer);assert.equal(state.query,'仍在编辑的新问题');assert(state.dirty);
 },path=>path===late?pending.promise:json(f.responses[path]));
});
