/** Compiled production handlers, explicitly DOM/transport doubles, not native evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const chat=await import('../web/dist/copilot-ui.js');globalThis.setInterval=interval;
const {state}=await import('../web/dist/state.js');
const {invalidateInteractions,invalidateInputs}=await import('../web/dist/interactions.js');
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const page=(offset=0,count=100)=>({items:Array.from({length:count},(_,n)=>({id:'t'+(offset+n),version:1,updated_at:'2026-10-08',payload:{title:'Synthetic '+(offset+n)}})),has_more:offset===0,next_offset:offset===0?100:null});
function harness(){chat.resetCopilot();Object.assign(state,{user:{id:'owner',preferences:{role:'enterprise'}},identity:'lens',active:'',datasets:[],identities:[]});chat.copilotShell();const shown=[],calls=[];chat.configureCopilot({dialog(title,body){invalidateInteractions();shown.push(body)}});globalThis.fetch=async url=>{calls.push(url);return response(page(Number(new URL(url,'http://test').searchParams.get('offset'))))};return {shown,calls};}
const action=offset=>chat.chatAction('chat-history',{dataset:offset===undefined?{}:{offset:String(offset)}});

test('history pages 1–100 and 101–200, newer return, preserve draft and current conversation',async()=>{
 const h=harness();chat.rememberDraft('Synthetic unsent draft');const before=chat.currentThread();
 await action();assert.match(h.shown[0],/第 1–100 条研究会话/);assert.match(h.shown[0],/更早会话/);assert.doesNotMatch(h.shown[0],/较新会话/);
 await action(100);assert.match(h.shown[1],/第 101–200 条研究会话/);assert.match(h.shown[1],/较新会话/);assert.doesNotMatch(h.shown[1],/更早会话/);
 await action(0);assert.match(h.shown[2],/第 1–100/);assert.equal(chat.currentThread(),before);assert.match(chat.copilotShell(),/Synthetic unsent draft/);
 assert(h.calls.every(url=>url.includes('identity_id=lens')&&url.includes('dataset_id=')&&url.includes('limit=100')));
});
test('later empty page gives accurate copy and allows newer navigation',async()=>{
 const h=harness();globalThis.fetch=async()=>response({items:[],has_more:false});await action(100);
 assert.match(h.shown[0],/这一页已没有历史会话/);assert.match(h.shown[0],/较新会话/);assert.doesNotMatch(h.shown[0],/当前上下文没有历史会话/);
 await action();assert.match(h.shown[1],/当前上下文没有历史会话/);
});
for(const interrupt of ['dismiss','input','identity','newer'])test('pending history read cannot overwrite '+interrupt,async()=>{
 const h=harness();let release;globalThis.fetch=()=>new Promise(r=>release=r);const pending=action(100);
 if(interrupt==='dismiss')invalidateInteractions();
 if(interrupt==='input'){chat.rememberDraft('new input');invalidateInputs();}
 if(interrupt==='identity'){state.identity='different';chat.copilotShell();}
 if(interrupt==='newer'){globalThis.fetch=async()=>response(page());await action(0);}
 release(response(page(100)));await pending;
 assert.equal(h.shown.length,interrupt==='newer'?1:0);
 if(interrupt==='newer')assert.match(h.shown[0],/第 1–100/);
});
test('list error preserves draft and does not replace the existing dialog',async()=>{
 const h=harness();chat.rememberDraft('retain on error');await action();globalThis.fetch=async()=>{throw Error('synthetic network failure')};await assert.rejects(action(100),/无法连接服务/);assert.equal(h.shown.length,1);assert.match(chat.copilotShell(),/retain on error/);
});

// The native review caught retained scroll after closing a long page and reopening.
test('accepted history pages reset dialog scroll, cancelled Open preserves current page position',async()=>{
 const h=harness();const modal={scrollTop:9000};const query=document.querySelector;
 document.querySelector=selector=>selector==='#modal'?modal:null;
 try{
  await action(100);assert.equal(modal.scrollTop,0);
  modal.scrollTop=7500;chat.rememberDraft('keep draft');globalThis.confirm=()=>false;
  await chat.chatAction('chat-open',{dataset:{id:'older'}});assert.equal(modal.scrollTop,7500);
  await action();assert.equal(modal.scrollTop,0);assert.match(h.shown.at(-1),/第 1–100/);
  modal.scrollTop=3300;let release;globalThis.fetch=()=>new Promise(r=>release=r);const pending=action(100);invalidateInteractions();release(response(page(100)));await pending;assert.equal(modal.scrollTop,3300);
 }finally{document.querySelector=query;delete globalThis.confirm;}
});
