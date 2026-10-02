/** Real copilot handlers with a DOM/API bridge; not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const chat=await import('../web/dist/copilot-ui.js');globalThis.setInterval=interval;
const {state}=await import('../web/dist/state.js');
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const message={id:'message-one',created_at:'2026-10-02',payload:{question:'继续看现金流',response:{answer:'原始已保存回答',context:{question_scope:{period:'2025-Q2',comparison:'previous',topics:['cash_flow','cash_ratio']}},facts:[],receipts:[],cards:[],citations:[],warnings:[],actions:[]}}};
const trace=(value=2240000,version=1)=>({source_message_id:message.id,source_thread_id:'thread-one',answer:'按原始范围复核',facts:[{id:'cash_flow',label:'经营现金流',value,period:'2025-Q2',dataset_version:version,inputs:[],trend:[]}],scope:{company:'测试企业',dataset_id:'dataset-one',period:'2025-Q2',dataset_version:version},question_scope:message.payload.response.context.question_scope,external_calls:0});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function harness(){
 const oldFetch=globalThis.fetch;chat.resetCopilot();
 Object.assign(state,{user:{id:'owner',preferences:{role:'enterprise'}},identity:'identity-one',active:'dataset-one',datasets:[{id:'dataset-one',version:1,payload:{company:'测试企业'}}],identities:[{id:'identity-one',payload:{dataset_ids:['dataset-one']}}]});
 const calls=[];
 const loaded={thread:{id:'thread-one',version:2,payload:{identity_id:state.identity,dataset_id:state.active}},messages:[message],proposals:[],runs:[],context:{writable:true}};
 const normal=async(url,init)=>{calls.push({url,init});if(url.includes('/trace?'))return response(trace());if(url.includes('/threads?'))return response({items:[{id:'thread-one'}]});if(url==='/api/services/threads/thread-one')return response(loaded);throw Error('Unexpected URL '+url);};
 globalThis.fetch=normal;chat.copilotShell();await chat.mountCopilot();
 return {calls,loaded,normal,restore(){globalThis.fetch=oldFetch;chat.resetCopilot();}};
}

test('trace uses persisted message IDs and explicit current selectors, never a raw query or client scope',async()=>{
 const h=await harness();try{
  await chat.chatAction('chat-trace',{dataset:{message:message.id}});
  const call=h.calls.find(c=>c.url.includes('/trace?'));
  assert.equal(call.url,'/api/services/threads/thread-one/messages/message-one/trace?identity_id=identity-one&dataset_id=dataset-one');
  assert.equal(call.init.method,'GET');assert.equal(call.init.body,undefined);
  assert(!h.calls.some(c=>c.url==='/api/workspace/assistant'));
  const html=chat.messageView(message);
  assert(html.includes('原始已保存回答'));assert(html.includes('2025-Q2'));assert(html.includes('2,240,000'));
  assert(html.includes('保留原问题的季度、基期与指标'));assert(html.includes('读取时的数据修订 1'));
  assert(html.includes('重新按当前修订复核'));
 }finally{h.restore();}
});

test('a later explicit recheck uses fresh data and supersedes a late older read',async()=>{
 const h=await harness();let resolve;try{
  let count=0;globalThis.fetch=(url,init)=>url.includes('/trace?')?(++count===1?new Promise(r=>resolve=r):Promise.resolve(response(trace(3333333,3)))):h.normal(url,init);
  const old=chat.chatAction('chat-trace',{dataset:{message:message.id}});await tick();
  await chat.chatAction('chat-trace',{dataset:{message:message.id}});
  resolve(response(trace(1111111,1)));await old;
  const html=chat.messageView(message);assert(html.includes('3,333,333'));assert(!html.includes('1,111,111'));assert(html.includes('读取时的数据修订 3'));
 }finally{h.restore();}
});

for(const change of ['new thread','dataset','identity'])test(`late trace does not survive ${change}`,async()=>{
 const h=await harness();let resolve;try{
  globalThis.fetch=(url,init)=>url.includes('/trace?')?new Promise(r=>resolve=r):h.normal(url,init);
  const pending=chat.chatAction('chat-trace',{dataset:{message:message.id}});await tick();
  if(change==='new thread')await chat.chatAction('chat-new',{dataset:{}});
  else{state[change==='dataset'?'active':'identity']='different';chat.copilotShell();}
  resolve(response(trace(7777777)));await pending;
  assert(!chat.messageView(message).includes('7,777,777'));
 }finally{h.restore();}
});

test('revoked current scope and failed rechecks leave historical output intact',async()=>{
 const h=await harness();try{
  h.loaded.context.writable=false;h.loaded.context.unavailable_reason='原范围已撤销';await chat.mountCopilot();
  await assert.rejects(chat.chatAction('chat-trace',{dataset:{message:message.id}}),/原范围已撤销/);
  assert(!h.calls.some(c=>c.url.includes('/trace?')));
  h.loaded.context.writable=true;await chat.mountCopilot();
  globalThis.fetch=(url,init)=>url.includes('/trace?')?Promise.resolve(response({error:{code:'TRACE_PERIOD_UNAVAILABLE',message:'原季度已删除'}},409)):h.normal(url,init);
  await assert.rejects(chat.chatAction('chat-trace',{dataset:{message:message.id}}),/原季度已删除/);
  const html=chat.messageView(message);assert(html.includes('原始已保存回答'));assert(!html.includes('按原始范围复核'));
 }finally{h.restore();}
});
