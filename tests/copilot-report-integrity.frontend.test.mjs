/** Production compiled card/paint paths over genuine report bytes and isolated API states. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {state} from '../web/dist/state.js';
import {esc} from '../web/dist/components.js';

globalThis.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const chat=await import('../web/dist/copilot-ui.js');globalThis.setInterval=interval;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/percentage-execution-scope-80defc9.json',import.meta.url),'utf8'));
const saved=fixture.tables.runs.find(r=>r.id===fixture.cases.legacy_completed.run_id);
const result=JSON.parse(saved.result),query=JSON.parse(saved.payload).query;
const proposal={id:'proposal',payload:{kind:'research',status:'executed',title:'核查原问题',text:query,result:{route:'agents:run-'+saved.id}}};
const available={id:saved.id,proposal_id:proposal.id,state:'succeeded',query,result,report_availability:{status:'available',notice:''},report_integrity:{valid:true,format:'studio',failures:[]},report_hash_valid:true,source_impact:{state:'current',reasons:[]},dataset_version:1,current_dataset_version:1};
const corrupt={...available,result:null,report_availability:{status:'unavailable',notice:'报告完整性校验未通过；已暂停展示主答案、数学结果与衍生入口。原记录保留。'},report_integrity:{valid:false,format:'studio',failures:['report_hash']},report_hash_valid:false,source_impact:{state:'unavailable',reasons:[{code:'report_integrity_failed',message:'冻结报告校验失败'}]},unverified_report:{raw:'{"amount":987654321,"injection":"<img src=x onerror=bad()>"}',notice:'未核验的已保存报告原文，仅供排查；不是可用结论。'}};
const visible=html=>html.replace(/<details\b[\s\S]*?<\/details>/g,'');
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const thread=runs=>({thread:{id:'thread',version:2,payload:{identity_id:'',dataset_id:'dataset'}},messages:[],proposals:[proposal],runs,context:{writable:true}});

function init(){Object.assign(state,{user:{id:'owner',preferences:{role:'enterprise',amount_unit:'wan'}},identity:'',active:'dataset',datasets:[{id:'dataset',version:1,payload:{company:'隔离企业'}}],identities:[]});}

test('corrupt saved amount is only escaped raw history, never a normal report or derived math route',()=>{
 init();const before=structuredClone(corrupt),html=chat.proposalCard(proposal,[corrupt]),shown=visible(html);
 assert(html.includes('data-copilot-report-unavailable'));
 assert(html.includes('data-unverified-report-raw'));
 assert(shown.includes('原问题：'+esc(query))&&shown.includes('原记录保留'));
 assert(!html.includes('data-report-readout')&&!html.includes('chat-run-result')&&!html.includes('chat-math-results'));
 assert(!shown.includes('987654321')&&!shown.includes('98,765.4321'));
 assert(!shown.includes('仍是原始冻结内容')&&!shown.includes('本次问题的回答'));
 assert(!html.includes('data-route="lab:')&&!html.includes('data-route="compare:'));
 assert(!html.includes('<img'));assert(html.includes('&lt;img'));
 assert(shown.includes('data-route="agents"'));
 assert.deepEqual(corrupt,before);
});

for(const kind of ['missing verdict','invalid verdict','missing availability','inconsistent availability'])test('card refuses normal result when '+kind,()=>{
 init();const run=structuredClone(available);
 if(kind==='missing verdict')delete run.report_integrity;
 else if(kind==='invalid verdict')run.report_integrity.valid=false;
 else if(kind==='missing availability')delete run.report_availability;
 else run.report_availability.status='unavailable';
 const html=chat.proposalCard(proposal,[run]);
 assert(html.includes('data-copilot-report-unavailable'));
 assert(!html.includes('data-report-readout')&&!html.includes('chat-run-result'));
});

test('healthy historical result and changed present-day sources retain normal reading with a separate warning',()=>{
 init();const run={...available,source_impact:{state:'changed',reasons:[{code:'dataset_changed',message:'企业数据已有新修订'}]}};
 const before=structuredClone(run),html=chat.proposalCard(proposal,[run]);
 assert(html.includes('data-report-readout'));assert(html.includes('企业数据已有新修订'));
 assert(!html.includes('data-copilot-report-unavailable'));assert.deepEqual(run,before);
 const partial=chat.proposalCard(proposal,[{...run,report_hash_valid:null,report_integrity:{valid:true,format:'legacy',failures:[]}}]);
 assert(partial.includes('没有完整输出的独立散列证据'));assert(partial.includes('data-report-readout'));
});

for(const state of ['queued','running','failed','cancelled','interrupted'])test('legitimate '+state+' without a report is not labelled corrupt',()=>{
 init();const pending=['queued','running'].includes(state),run={...available,state,result:null,report_integrity:{valid:false,failures:['report_missing']},report_availability:{status:pending?'pending':'no_report',notice:pending?'报告尚未生成，完成后再核验与展示。':'本次执行没有保存报告，未生成替代结果。'},source_impact:null};
 const html=chat.proposalCard(proposal,[run]);
 assert(!html.includes('data-copilot-report-unavailable')&&!html.includes('data-report-readout'));
 assert(html.includes(run.report_availability.notice));assert(!html.includes('仍是原始冻结内容'));
});

async function harness(){
 const oldFetch=globalThis.fetch,oldQuery=document.querySelector;chat.resetCopilot();init();
 const host={innerHTML:'',scrollTop:0,scrollHeight:0,clientHeight:0,querySelectorAll(){return []}};
 document.querySelector=selector=>selector==='#assistant-answer'?host:null;
 globalThis.fetch=async url=>response(url.includes('/threads?')?{items:[{id:'thread'}]}:thread([available]));
 chat.copilotShell();await chat.mountCopilot();
 return {host,restore(){globalThis.fetch=oldFetch;document.querySelector=oldQuery;chat.resetCopilot();}};
}

test('actual remount replaces healthy cached report with mask and a late healthy read cannot revive it',async()=>{
 const h=await harness();try{
  assert(h.host.innerHTML.includes('data-report-readout'));
  const pending=[];globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));
  const older=chat.mountCopilot(),newer=chat.reloadThread();
  pending[1](response(thread([corrupt])));await newer;
  assert(h.host.innerHTML.includes('data-copilot-report-unavailable'));
  pending[0](response(thread([available])));await older;
  assert(h.host.innerHTML.includes('data-copilot-report-unavailable'));
  assert(!h.host.innerHTML.includes('data-report-readout'));
 }finally{h.restore();}
});

test('changing identity discards a late report read without repainting either result or raw history',async()=>{
 const h=await harness();let resolve;try{
  globalThis.fetch=()=>new Promise(r=>resolve=r);
  const late=chat.mountCopilot();state.identity='other-identity';chat.copilotShell();h.host.innerHTML='new identity';
  resolve(response(thread([corrupt])));await late;
  assert.equal(chat.currentThread(),null);assert.equal(h.host.innerHTML,'new identity');
 }finally{h.restore();}
});

test('one masked report does not hide a healthy neighboring proposal in the production paint path',async()=>{
 const h=await harness();try{
  const neighbor={...proposal,id:'neighbor',payload:{...proposal.payload,title:'健康相邻报告'}};
  globalThis.fetch=async()=>response({...thread([corrupt,{...available,id:'healthy',proposal_id:neighbor.id}]),proposals:[proposal,neighbor]});
  await chat.reloadThread();
  assert(h.host.innerHTML.includes('data-copilot-report-unavailable'));
  assert(h.host.innerHTML.includes('健康相邻报告')&&h.host.innerHTML.includes('data-report-readout'));
  assert.equal((h.host.innerHTML.match(/data-report-readout/g)||[]).length,1);
 }finally{h.restore();}
});
