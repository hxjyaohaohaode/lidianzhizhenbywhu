/** Real compiled report views and fetch transport; not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {reportsPage,loadReportComparisonSources,reportCompareForm} from '../web/dist/views-analysis.js';
import {state} from '../web/dist/state.js';
import {invalidateView,invalidateContext} from '../web/dist/api.js';
const row=n=>({id:'r'+n,title:'原报告 '+n,query:'2024-Q1 原始问题 '+n,current_period:'2024-Q1',dataset_version:1,state:'degraded',created_at:'2026-10-05T00:00:00Z',source_impact:{state:'current',reasons:[]}});
function setup(){Object.assign(state,{user:{id:'owner',preferences:{}},id:'',identity:'scope',active:'dataset',datasets:[],cache:{}});}
async function fetches(fn,run){const old=globalThis.fetch;const paths=[];globalThis.fetch=async path=>{paths.push(path);return new Response(JSON.stringify(await fn(path,paths.length)),{headers:{'content-type':'application/json'}});};try{return await run(paths);}finally{globalThis.fetch=old;}}
test('report pages keep scope, expose record201 and use URL pages for Back/reload',async()=>{
 setup();state.id='10';await fetches(()=>({items:[row(200)],total:201,limit:20,offset:200,has_more:false}),async paths=>{
  const html=await reportsPage(state.id||'0');assert.deepEqual(paths,['/api/workspace/reports?identity_id=scope&dataset_id=dataset&limit=20&offset=200']);
  assert(html.includes('201–201 / 201 份')&&html.includes('agents:run-r200')&&html.includes('reports:9')&&!html.includes('下一页'));
  assert(html.includes('report-compare-dialog'));assert.equal(state.cache.reports[0].id,'r200');
 });
});
test('first/empty pages retain next or recovery navigation and escape original questions',async()=>{
 setup();await fetches(()=>({items:[{...row(0),query:'<script>unsafe</script>'}],total:21,has_more:true}),async()=>{const html=await reportsPage(state.id||'0');assert(html.includes('reports:1')&&!html.includes('上一页')&&!html.includes('<script>unsafe'));});
 state.id='10';await fetches(()=>({items:[],total:20,has_more:false}),async()=>{const html=await reportsPage(state.id||'0');assert(html.includes('返回第一页')&&html.includes('本页无记录')&&html.includes('reports:9'));});
});
for(const id of ['-1','1.5','50','999','01','abc','0&identity_id=other'])test('invalid report route '+id+' never reads',async()=>{
 setup();state.id=id;await fetches(()=>{throw Error('unexpected read');},async paths=>{await assert.rejects(reportsPage(state.id||'0'),/页码无效/);assert.deepEqual(paths,[]);});
});
for(const [name,invalidate] of [['view',invalidateView],['context',invalidateContext]])test('late '+name+' report page keeps new cache',async()=>{
 setup();const old=globalThis.fetch;let release;globalThis.fetch=()=>new Promise(r=>release=r);
 try{const pending=reportsPage(state.id||'0');invalidate();state.cache.reports=['new'];release(new Response(JSON.stringify({items:[row(0)],total:1,has_more:false}),{headers:{'content-type':'application/json'}}));await assert.rejects(pending,/迟到|旧页面/);assert.deepEqual(state.cache.reports,['new']);}finally{globalThis.fetch=old;}
});
test('comparison loads all201 scoped summaries once and lets old record be selected',async()=>{
 setup();await fetches((path)=>{const offset=Number(new URL(path,'http://fixture').searchParams.get('offset'));return {items:Array.from({length:offset===0?200:1},(_,i)=>row(offset+i)),total:201,offset,limit:200,has_more:offset===0};},async paths=>{
  assert.equal(await loadReportComparisonSources(()=>true),true);
  assert.equal(paths.length,2);assert(paths[1].endsWith('limit=200&offset=200'));assert(paths.every(p=>p.includes('identity_id=scope&dataset_id=dataset')));
  assert.equal(state.cache.reports.length,201);const html=reportCompareForm();assert.equal((html.match(/value="r200"/g)||[]).length,2);assert(html.includes('2024-Q1 原始问题 200'));
 });
});
test('maximum1000 needs five bounded reads and never silently truncates',async()=>{
 setup();await fetches(path=>{const offset=Number(new URL(path,'http://fixture').searchParams.get('offset'));return {items:Array.from({length:200},(_,i)=>row(offset+i)),total:1000,offset,limit:200,has_more:offset<800};},async paths=>{
  assert.equal(await loadReportComparisonSources(()=>true),true);assert.equal(paths.length,5);assert.equal(state.cache.reports.length,1000);
 });
});
for(const damage of ['total_changed','duplicate','short_page','partial_final','over_capacity','bad_offset'])test('comparison rejects '+damage+' without publishing partial cache',async()=>{
 setup();state.cache.reports=['original'];await fetches((path,n)=>{
  const offset=(n-1)*200;const page={items:Array.from({length:n===1?200:1},(_,i)=>row(offset+i)),total:201,offset,limit:200,has_more:n===1};
  if(damage==='total_changed'&&n===2)page.total=202;
  if(damage==='duplicate'&&n===2)page.items=[row(0)];
  if(damage==='short_page'&&n===1)page.items.pop();
  if(damage==='partial_final'&&n===2)page.items=[];
  if(damage==='over_capacity')page.total=1001;
  if(damage==='bad_offset')page.offset=1;
  return page;
 },async()=>{await assert.rejects(loadReportComparisonSources(()=>true),/分页|变化|完整/);assert.deepEqual(state.cache.reports,['original']);});
});
test('leaving during first comparison read prevents any later batch or cache replacement',async()=>{
 setup();state.cache.reports=['original'];let active=true;
 await fetches(()=>{active=false;return {items:Array.from({length:200},(_,i)=>row(i)),total:201,offset:0,limit:200,has_more:true};},async paths=>{assert.equal(await loadReportComparisonSources(()=>active),false);assert.equal(paths.length,1);assert.deepEqual(state.cache.reports,['original']);});
});
