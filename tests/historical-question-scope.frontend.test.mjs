/** Compiled UI over genuine old API fixture results; DOM/API bridge, not browser proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reportReadout,historicalQuestionWarning} from '../web/dist/report-readout.js';
import {runPage} from '../web/dist/views-studio.js';
import {state} from '../web/dist/state.js';
import {esc} from '../web/dist/components.js';

globalThis.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const chat=await import('../web/dist/copilot-ui.js');globalThis.setInterval=interval;
const fixtures=['percentage-execution-scope-80defc9.json','bare-percentage-scope-80defc9.json'].map(name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8')));
const warning=question=>({status:'unsupported_operation',question,notice:question.includes('增长')||question.includes('growth')||question.includes('涨幅')?'当前问答仅支持收入增长率；其他指标的增长率、百分比变化或涨跌幅不能用原始金额、原比率或比较差额替代，请单独提问已支持的指标。':'当前问答不支持将该金额指标直接作为百分比；百分比需要明确分母与比率口径，不能用原始金额替代。请明确已支持的比率指标，或单独询问金额。',history_notice:'已保存的指标值和原答复仅供历史查阅，不能作为该问题所要求百分比的答案；原记录未改写，未重新计算。'});
const decode=raw=>Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,['payload','snapshot','result'].includes(k)&&typeof v==='string'?JSON.parse(v):v]));
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

for(const fixture of fixtures)for(const [key,c] of Object.entries(fixture.cases).filter(([key])=>key.endsWith('completed'))){
 test('old '+key+' reads as retained history with an operation warning above its amount',()=>{
  const run=decode(fixture.tables.runs.find(r=>r.id===c.run_id)),before=structuredClone(run.result);
  const html=reportReadout(run.result,warning(run.payload.query));
  assert(html.includes('data-historical-question-warning'));
  assert(html.includes('原问题：'+esc(run.payload.query)));
  assert(html.includes('未回答原问题的百分比要求'));
  assert(html.includes('当时记录的指标'));
  assert(html.includes('原记录未改写，未重新计算'));
  assert(html.includes('下载仍为原始导出，不包含本页提示'));
  assert(html.includes('data-route="agents"'));
  assert(html.indexOf('data-historical-question-warning')<html.indexOf('data-report-readout'));
  assert(!html.includes('<h2>本次问题的回答</h2>'));
  for(const f of run.result.readout.facts)assert(html.includes(esc(f.label)));
  assert.deepEqual(run.result,before);
 });
}

test('warning text is escaped and absent modern fields do not create a warning',()=>{
 const unsafe=historicalQuestionWarning({...warning('<img src=x onerror=bad()>'),notice:'<script>bad()</script>'});
 assert(!unsafe.includes('<img')&&!unsafe.includes('<script>'));assert(unsafe.includes('&lt;img'));
 const older=JSON.parse(readFileSync(new URL('./fixtures/legacy-first-use-report-00310c1d.json',import.meta.url),'utf8'));
 assert(!reportReadout(older).includes('data-historical-question-warning'));
 assert(reportReadout(older).includes('当时未记录'));
});

test('actual run page wires the audit warning but corruption still masks all normal results',async()=>{
 const fixture=fixtures[0],run=decode(fixture.tables.runs.find(r=>r.id===fixture.cases.legacy_completed.run_id));
 const audit={run,ledger:{valid:true},data_hash_valid:true,snapshot_hash_valid:true,report_hash_valid:true,artifacts:[],trace:[],source_impact:null,report_integrity:{valid:true,format:'studio',failures:[]},question_compatibility:warning(run.payload.query)};
 const oldFetch=globalThis.fetch;
 Object.assign(state,{user:{id:'owner',preferences:{amount_unit:'yuan'}},identity:'',cache:{}});
 globalThis.fetch=async url=>response(url.endsWith('/audit')?audit:url.endsWith('/reviews')?{items:[]}:run);
 try{
  const html=await runPage(run.id);
  assert(html.includes('data-historical-question-warning'));
  assert(html.includes('记录一致性通过'));
  assert(html.includes('未回答原问题的百分比要求'));
  audit.report_integrity={valid:false,failures:['report_hash']};audit.report_hash_valid=false;
  const corrupt=await runPage(run.id);
  assert(corrupt.includes('data-report-unverified'));
  assert(corrupt.includes('data-report-export-unavailable'));
  assert(!corrupt.includes('data-historical-question-warning'));
  assert(!corrupt.includes('data-report-readout'));
 }finally{globalThis.fetch=oldFetch;}
});

for(const fixture of fixtures)test('saved original answer and failed percentage trace remain visibly historical '+fixture.cases[Object.keys(fixture.cases)[0]].plan_id,async()=>{
 const raw=fixture.tables.copilot_messages.find(m=>!JSON.parse(m.payload).question.includes('成本金额'));
 const message=decode(raw);message.question_compatibility=warning(message.payload.question);
 const before=structuredClone(message.payload),thread=decode(fixture.tables.workspace_objects.find(r=>r.id===raw.thread_id));
 const dataset=decode(fixture.tables.datasets[0]);
 const loaded={thread,messages:[message],proposals:[],runs:[],context:{writable:true}};
 const oldFetch=globalThis.fetch,calls=[];chat.resetCopilot();
 Object.assign(state,{user:{id:'owner',preferences:{role:'enterprise'}},identity:'',active:dataset.id,datasets:[dataset],identities:[]});
 globalThis.fetch=async(url,init)=>{
  calls.push({url,init});
  if(url.includes('/trace?'))return response({error:{code:'TRACE_QUESTION_UNSUPPORTED',message:message.question_compatibility.notice}},409);
  if(url.includes('/threads?'))return response({items:[thread]});
  if(url==='/api/services/threads/'+thread.id)return response(loaded);
  throw Error('Unexpected request '+url);
 };
 try{
  chat.copilotShell();await chat.mountCopilot();
  let html=chat.messageView(message);
  assert(html.includes(esc(message.payload.response.answer)));
  assert(html.includes('data-historical-question-warning'));
  assert(!html.includes('data-x-action="chat-trace"'));
  assert(html.includes('无法按原问题复核'));
  assert(html.indexOf('data-historical-question-warning')<html.indexOf('research-answer'));
  await assert.rejects(chat.chatAction('chat-trace',{dataset:{message:message.id}}),/不能用原始金额/);
  html=chat.messageView(message);
  assert(html.includes(esc(message.payload.response.answer)));
  assert(html.includes('原记录未改写'));
  assert(!html.includes('读取时的数据修订'));
  assert(calls.some(c=>c.url.includes('/trace?')&&c.init.method==='GET'));
  assert.deepEqual(message.payload,before);
 }finally{globalThis.fetch=oldFetch;chat.resetCopilot();}
});
