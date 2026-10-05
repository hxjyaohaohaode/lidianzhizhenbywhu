/** Rendered HTML and late-read contracts; real seven-plan clicks run in native CI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {agentsPage,plansPage} from '../web/dist/views-studio.js';
import {state} from '../web/dist/state.js';
import {invalidateView,invalidateContext} from '../web/dist/api.js';
const row=(n,status='draft')=>({id:'p'+n,created_at:'2026-10-05T00:00:00Z',updated_at:'2026-10-05T01:00:00Z',payload:{status,request:{query:'原始研究问题 '+n}}});
function setup(){Object.assign(state,{user:{id:'owner',preferences:{}},identity:'scope',identities:[],active:'dataset',datasets:[],cache:{}});}
async function withFetch(response,fn){const old=globalThis.fetch;const paths=[];globalThis.fetch=async(path)=>{paths.push(path);return new Response(JSON.stringify(typeof response==='function'?response(path):response),{headers:{'content-type':'application/json'}});};try{return await fn(paths);}finally{globalThis.fetch=old;}}
test('history preserves scope and exposes the seventh saved plan with explicit pagination',async()=>{
 setup();
 await withFetch({items:Array.from({length:6},(_,n)=>row(n)),total:7,has_more:true,scope:{label:'当前研究身份'}},async(paths)=>{
  const html=await agentsPage('plans');
  assert.deepEqual(paths,['/api/workspace/plans?identity_id=scope&dataset_id=dataset&limit=6&offset=0']);
  assert(html.includes('1–6 / 7 份')&&html.includes('agents:plans-1')&&!html.includes('上一页'));
  assert.equal((html.match(/data-route="agents:plan-p/g)||[]).length,6);
  assert(html.includes('当前研究身份')&&html.includes('不会执行任务或更新原授权'));
 });
 await withFetch({items:[row(6,'cancelled')],total:7,has_more:false,scope:{label:'当前研究身份'}},async(paths)=>{
  const html=await plansPage('1');
  assert(paths[0].endsWith('&limit=6&offset=6'));
  assert(html.includes('7–7 / 7 份')&&html.includes('agents:plan-p6')&&html.includes('agents:plans-0'));
  assert(!html.includes('下一页')&&!html.includes('execute-plan-form'));
 });
});
test('empty or deleted last page remains navigable and escapes saved queries and labels',async()=>{
 setup();
 await withFetch({items:[],total:3,has_more:false,scope:{label:'<script>scope</script>'}},async()=>{
  const html=await plansPage('1');assert(html.includes('返回第一页')&&html.includes('当前范围共 3 份'));
  assert(!html.includes('<script>')&&html.includes('&lt;script&gt;'));
 });
 await withFetch({items:[{...row(1),payload:{status:'draft',request:{query:'<img src=x onerror=evil>'}}}],total:1,has_more:false,scope:{label:'默认'}},async()=>{
  assert(!(await plansPage()).includes('<img src=x'));
 });
});
test('invalid routes fail before read, and page 166 can expose the final four of 1000',async()=>{
 setup();await withFetch({items:[],total:1000,has_more:false,scope:{label:'默认'}},async(paths)=>{
  for(const page of ['-1','1.5','167','999','01','x','0&identity_id=other'])await assert.rejects(plansPage(page),/页码无效/);
  assert.deepEqual(paths,[]);await plansPage('166');assert(paths[0].endsWith('&offset=996'));
 });
});
for(const [name,invalidate] of [['page',invalidateView],['identity',invalidateContext]])test('late '+name+' history read cannot overwrite the new cache',async()=>{
 setup();const old=globalThis.fetch;let resolve;globalThis.fetch=()=>new Promise(r=>{resolve=r;});
 try{const pending=plansPage();invalidate();state.cache.plans=['newer-scope'];resolve(new Response(JSON.stringify({items:[row(1)],total:1,has_more:false,scope:{label:'旧范围'}}),{headers:{'content-type':'application/json'}}));await assert.rejects(pending,/迟到|旧页面/);assert.deepEqual(state.cache.plans,['newer-scope']);}finally{globalThis.fetch=old;}
});
