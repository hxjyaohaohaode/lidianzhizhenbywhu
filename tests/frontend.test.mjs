/** Pure rendering and transport contracts; no browser or provider emulation claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {esc,num,pct,amount,safeLink,textarea,input,select,jsonView,lineChart,nodeFlow,metricValue} from '../web/dist/components.js';
import {api,setCsrf,ApiError} from '../web/dist/api.js';

test('HTML metacharacters and untrusted closing tags are escaped',()=>{assert.equal(esc(`<x a="b">'&`),'&lt;x a=&quot;b&quot;&gt;&#39;&amp;');assert(!textarea('a','</textarea><img src=x>').includes('</textarea><img'));assert(!input('x','" onfocus="alert(1)').includes('" onfocus="'));assert(!jsonView({x:'</pre><script>'}).includes('<script>'));});
test('empty values stay absent; real zero and negatives survive',()=>{for(const v of [null,undefined,NaN,Infinity,'0'])assert.equal(num(v),'—');assert.equal(num(0),'0');assert.equal(pct(0),'0%');assert.equal(pct(-.2),'-20%');assert.equal(amount(100000,'wan'),'10');assert.equal(metricValue('asset_turnover',2),'2');});
for (const link of ['javascript:alert(1)','data:text/html,x','http://example.com','not a url','//example.com'])test('unsafe link is text: '+link,()=>assert(!safeLink(link,'source').includes('<a ')));
test('HTTPS links have isolation and label escaping',()=>{const s=safeLink('https://example.com/a','<script>x');assert(s.includes('noopener noreferrer'));assert(s.includes('&lt;script&gt;'));});
test('option names and values cannot break attributes',()=>{const s=select('x',[{value:'" onclick=x',label:'<img src=x>'}]);assert(!s.includes('<img'));assert(!s.includes('value="" onclick'));});
test('time gaps and missing fields break lines, not interpolate fictitious quarters',()=>{let g=lineChart([{period:'2025-Q1',revenue:10},{period:'2025-Q3',revenue:20}],[{id:'revenue',name:'收入'}]);assert.match(g,/<path d="M[^\"]+M/);assert(!g.includes('NaN'));g=lineChart([{period:'2025-Q1',revenue:10},{period:'2025-Q2',revenue:null},{period:'2025-Q3',revenue:20}],[{id:'revenue',name:'收入'}]);assert.match(g,/<path d="M[^\"]+M/);});
test('zero and missing series differ',()=>{assert(lineChart([{period:'2025-Q1',revenue:0}],[{id:'revenue',name:'r'}]).includes('<circle'));assert(!lineChart([{period:'2025-Q1',revenue:null}],[{id:'revenue',name:'r'}]).includes('<circle'));});
test('chart labels and data periods remain text',()=>{const s=lineChart([{period:'2025-Q1',revenue:1}],[{id:'revenue',name:'<script>bad'}]);assert(!s.includes('<script>'));});
test('node status follows actual events and disabled config, not elapsed fake progress',()=>{const nodes=[{id:'quality',name:'数据',engine:'deterministic'},{id:'expert',name:'模型',engine:'optional_llm',enabled:false}];let s=nodeFlow(nodes);assert(s.includes('agent-node pending')&&s.includes('agent-node skip'));s=nodeFlow(nodes,[{type:'step_started',payload:{node:'quality'}}]);assert(s.includes('agent-node live'));s=nodeFlow(nodes,[{type:'step_completed',payload:{node:'quality'}}]);assert(s.includes('agent-node complete'));});
test('API CSRF, JSON, cookie policy and no automatic retry',async()=>{const old=globalThis.fetch;let calls=0;try{setCsrf('test-nonsecret');globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'/api/test');assert.equal(init.headers['X-CSRF-Token'],'test-nonsecret');assert.equal(init.credentials,'same-origin');return new Response(JSON.stringify({error:{message:'version conflict',code:'VERSION_CONFLICT'},request_id:'r'}),{status:409,headers:{'Content-Type':'application/json'}});};await assert.rejects(api('/test','POST',{x:1}),e=>e instanceof ApiError&&e.code==='VERSION_CONFLICT');assert.equal(calls,1);}finally{globalThis.fetch=old;setCsrf('');}});
test('non JSON responses are explicit errors, never a fabricated success',async()=>{const old=globalThis.fetch;try{globalThis.fetch=async()=>new Response('<html/>',{status:200,headers:{'Content-Type':'text/html'}});await assert.rejects(api('/t'),e=>e instanceof ApiError&&e.code==='NON_JSON');}finally{globalThis.fetch=old;}});
test('every literal UI action has a click handler',()=>{const files=['app','components','pages','views-analysis','views-data','views-studio','views-orchestrator'];const all=files.map(x=>readFileSync(new URL('../web/'+x+'.ts',import.meta.url),'utf8')).join('\n');const app=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');const actions=new Set([...all.matchAll(/data-action="([a-z-]+)"/g)].map(m=>m[1]));for(const a of actions)assert(app.includes("case '"+a+"':"),'unhandled action '+a);});
test('every literal form has a submit handler',()=>{const all=['app','pages','views-analysis','views-data','views-studio','views-orchestrator'].map(x=>readFileSync(new URL('../web/'+x+'.ts',import.meta.url),'utf8')).join('\n');const app=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');for(const m of all.matchAll(/<form id="([a-z-]+)"/g))assert(app.includes("case '"+m[1]+"':"),'unhandled form '+m[1]);});

test('failed model outcomes do not display a completed expert check mark',()=>{const s=nodeFlow([{id:'expert',engine:'optional_llm',name:'模型'}],[{type:'step_completed',payload:{node:'expert',outcome:'failed'}}],'degraded');assert(s.includes('agent-node stopped'));assert(!s.includes('node-status">✓'));});
test('cancelled or interrupted run never leaves node apparently running',()=>{const nodes=[{id:'first',name:'a'},{id:'next',name:'b'}];for(const state of ['cancelled','interrupted','failed']){const s=nodeFlow(nodes,[{type:'step_started',payload:{node:'first'}}],state);assert(!s.includes('agent-node live'));assert(s.includes('agent-node stopped'));assert(s.includes('agent-node not-reached'));}});

import {graphLayout,graphCanvas,adaptiveOptions} from '../web/dist/views-orchestrator.js';
test('adaptive graph rejects duplicate identities, unknown dependencies, and cycles',()=>{for(const n of [[{id:'a'},{id:'a'}],[{id:'a',depends_on:['b']}],[{id:'a',depends_on:['b']},{id:'b',depends_on:['a']}]])assert.throws(()=>graphLayout(n));});
test('DAG layout respects branched prerequisites instead of a decorative sequence',()=>{const nodes=[{id:'a'},{id:'b',depends_on:['a']},{id:'c',depends_on:['a']},{id:'d',depends_on:['b','c']}];assert.deepEqual(graphLayout(nodes),[['a'],['b','c'],['d']]);});
test('dynamic graph escapes untrusted labels and IDs; keyboard access is real',()=>{const html=graphCanvas([{id:'<x>',name:'<script>boom',engine:'deterministic'}]);assert(!html.includes('<script>'));assert(html.includes('tabindex="0"'));assert(html.includes('&lt;x&gt;'));});
test('timing events cannot erase a completed node or fabricate active work',()=>{const nodes=[{id:'quality',name:'输入核验',engine:'deterministic'}];let html=graphCanvas(nodes,[{type:'step_completed',payload:{node:'quality'}},{type:'node_timing',payload:{node:'quality',duration_ms:10}}],'succeeded');assert(html.includes('dag-node done'));assert(!html.includes('dag-node running'));html=graphCanvas(nodes,[{type:'step_started',payload:{node:'quality'}}],'paused');assert(html.includes('dag-node attention'));});
test('wide parallel layers never receive negative node coordinates',()=>{const html=graphCanvas(Array.from({length:9},(_,i)=>({id:'n'+i,name:'n'+i})));assert(!html.includes('translate(-'));});
test('future actual states are not rendered as imaginary percentage completion',()=>{const html=graphCanvas([{id:'x',name:'待执行'}],[],'queued');assert(html.includes('dag-node waiting'));assert(!html.includes('%'));});
test('late response from a previous login is rejected before it can populate state',async()=>{const old=globalThis.fetch;let resolve;try{setCsrf('generation-one');globalThis.fetch=()=>new Promise(r=>{resolve=r;});const pending=api('/sensitive');setCsrf('generation-two');resolve(new Response('{"old_account":"private"}',{headers:{'Content-Type':'application/json'}}));await assert.rejects(pending,e=>e.code==='STALE_SESSION');}finally{globalThis.fetch=old;setCsrf('');}});
test('explicit model roles and fallback are optional, not silently selected',()=>{const html=adaptiveOptions({providers:[{id:'qwen',configured:true}]});assert(html.includes('name="fallback_provider"'));assert(html.includes('不跨模型降级'));for(const name of ['route_analyst','route_researcher','route_challenger','route_planner','route_revision','forecast_metric','forecast_horizon'])assert(html.includes('name="'+name+'"'));assert(!html.includes('name="model_planning" checked'));});
test('brand animation references the exact original assets, has exit and failure paths',()=>{const code=readFileSync(new URL('../web/brand.ts',import.meta.url),'utf8');for(const value of ['brand/logo.png','brand/loading-video.mp4','data-intro-skip',"addEventListener('error'", "addEventListener('cancel'",'6500',"dataset.motion==='reduce'"])assert(code.includes(value));});
test('live monitor uses only reads, never retries workflow submission',()=>{const code=readFileSync(new URL('../web/live.ts',import.meta.url),'utf8');assert(code.includes('EventSource'));assert(code.includes('12000'));assert(!code.includes("'POST'"));assert(code.includes('dispose()'));});

import {RunLive} from '../web/dist/live.js';
function liveHarness(){
  const old={fetch:globalThis.fetch,document:globalThis.document,EventSource:globalThis.EventSource};
  const handlers=new Map();let closed=0;
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  globalThis.EventSource=class{addEventListener(name,fn){handlers.set(name,fn);}close(){closed++;}};
  return {handlers,closed:()=>closed,restore:()=>Object.assign(globalThis,old)};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('SSE terminal event racing an in-flight read is coalesced, never lost',async()=>{
  const h=liveHarness();const pending=[];let calls=0,done=0;const seen=[];
  const monitor=new RunLive('r',x=>seen.push(x.state),()=>done++,()=>{});
  try{
    globalThis.fetch=(url)=>{calls++;if(calls<=2)return new Promise(resolve=>pending.push({url,resolve}));return Promise.resolve(new Response(JSON.stringify(url.includes('/runtime')?{state:'succeeded'}:{items:[]}),{headers:{'Content-Type':'application/json'}}));};
    monitor.start();h.handlers.get('end')();
    for(const p of pending)p.resolve(new Response(JSON.stringify(p.url.includes('/runtime')?{state:'running'}:{items:[]}),{headers:{'Content-Type':'application/json'}}));
    await tick();await tick();assert.equal(calls,4);assert.equal(done,1);assert.deepEqual(seen,['running','succeeded']);
  }finally{monitor.dispose();h.restore();}
});
test('failed read closes the stream and schedules bounded read-only recovery',async()=>{
  const h=liveHarness();const messages=[];const monitor=new RunLive('r',()=>{},()=>{},x=>messages.push(x));
  try{globalThis.fetch=async()=>{throw Error('network dropped');};monitor.start();await tick();await tick();assert(h.closed()>0);assert(monitor.timer);assert(messages.some(x=>x.includes('重试间隔')));}finally{monitor.dispose();h.restore();}
});
test('disposal while response is pending suppresses late UI mutations',async()=>{
  const h=liveHarness();const pending=[];let writes=0;const monitor=new RunLive('r',()=>writes++,()=>writes++,()=>{});
  try{globalThis.fetch=(url)=>new Promise(resolve=>pending.push({url,resolve}));monitor.start();monitor.dispose();for(const p of pending)p.resolve(new Response(JSON.stringify(p.url.includes('/runtime')?{state:'succeeded'}:{items:[]}),{headers:{'Content-Type':'application/json'}}));await tick();await tick();assert.equal(writes,0);}finally{monitor.dispose();h.restore();}
});

import {runNeedsReconcile} from '../web/dist/views-orchestrator.js';
test('separate run and runtime reads straddling completion force a coherent report fetch',()=>{
 for(const state of ['succeeded','degraded','failed','cancelled','interrupted']){
  assert(runNeedsReconcile({state:'running'},{state,run_state:state}));
  assert(!runNeedsReconcile({state},{state,run_state:state}));
 }
 assert(runNeedsReconcile({state:'queued'},{state:'paused',run_state:'interrupted'}));
 assert(!runNeedsReconcile({state:'running'},{state:'running',run_state:'running'}));
});
