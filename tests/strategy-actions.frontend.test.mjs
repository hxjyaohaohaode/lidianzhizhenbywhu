/** Production compiled click/navigation/input listeners with DOM and transport doubles.
 * These are event-contract checks, not native browser or live service evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {workspace,ApiError,contextGuard,invalidateContext} from '../web/dist/api.js';
import {interactionGuard,invalidateInteractions,continuationGuard,invalidateInputs} from '../web/dist/interactions.js';
import {strategyForm} from '../web/dist/views-orchestrator.js';
import {esc,button as htmlButton,icon} from '../web/dist/components.js';

const app=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
const clickStart=app.indexOf("document.addEventListener('click',");
const inputEnd=app.indexOf("document.addEventListener('change',",clickStart);
const navigateStart=app.indexOf('function navigate('),navigateEnd=app.indexOf('// Used after',navigateStart);
const dialogStart=app.indexOf('function dialog('),dialogEnd=app.indexOf('function inspect(',dialogStart);
assert(clickStart>=0&&inputEnd>clickStart&&navigateStart>=0&&navigateEnd>navigateStart);
const source=app.slice(dialogStart,dialogEnd)+app.slice(navigateStart,navigateEnd)+app.slice(clickStart,inputEnd);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function harness(action){
 invalidateContext();invalidateInteractions();
 const request=deferred(),preflight=deferred(),started=deferred(),listeners={},calls={writes:[],reads:[],renders:0,toasts:[],notices:0};
 const state={route:'evolution',dirty:false,cache:{evolution:{active:{version:7}}}};
 const draft={value:'',isConnected:true},modal={innerHTML:'',open:false,classList:{toggle(){}},showModal(){this.open=true;},close(){this.open=false;}},inspector={open:false,close(){this.open=false;}};
 class Button{constructor(dataset){this.dataset={...dataset};this.disabled=false;}closest(){return this;}setAttribute(){}removeAttribute(){}}
 const document={addEventListener:(name,fn)=>listeners[name]=fn};
 const location={hash:'#evolution'};
 const env={document,state,workspace,ApiError,contextGuard,interactionGuard,invalidateInteractions,continuationGuard,invalidateInputs,HTMLButtonElement:Button,strategyForm,esc,button:htmlButton,icon,
  modal,inspector,location,closeDrawers(){},safeToLeave:()=>true,confirm:()=>true,
  render:async()=>{invalidateInteractions();calls.renders++;draft.value='';draft.isConnected=false;state.route=location.hash.slice(1);},
  toast:(...args)=>calls.toasts.push(args),showSyncNotice:()=>calls.notices++};
 const inspect=new Function(...Object.keys(env),'let syncPending=false;'+source+'return ()=>syncPending;')(...Object.values(env));
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(options.method==='GET'){assert.equal(url,'/api/workspace/evolution');calls.reads.push(url);return preflight.promise;}
  calls.writes.push({url,body:JSON.parse(options.body)});started.resolve();return request.promise;
 };
 const button=new Button({action,id:'saved-candidate',evaluation:'saved-evaluation'});
 const click=target=>listeners.click({target,preventDefault(){}});
 return {request,preflight,started,calls,state,draft,modal,inspector,button,inspect,
  click:()=>click(button),restore:()=>globalThis.fetch=oldFetch,
  async moveToDraft(){await click(new Button({route:'data'}));state.route='data';draft.value='新的未保存经营数据';draft.isConnected=true;
   listeners.input({target:{id:'new-field',closest:()=>({id:'dataset-editor'})}});},
  async openNewDialog(){await click(new Button({action:'strategy-dialog'}));draft.value='新的候选草稿';
   listeners.input({target:{id:'new-field',closest:()=>({id:'strategy-form'})}});},
  async start(){const pending=click(button);if(action==='strategy-activate')preflight.resolve(json({active:{version:7}}));await started.promise;return {pending};}};
}
const actions=['strategy-propose','strategy-evaluate','strategy-activate','strategy-rollback'];
for(const action of actions){
 test(action+' late success preserves navigation and new draft, reports saved result without retry',async()=>{
  const f=harness(action);try{const {pending}=await f.start();await f.moveToDraft();f.request.resolve(json({id:'saved-result'}));await pending;
   assert.equal(f.calls.renders,0);assert.equal(f.draft.value,'新的未保存经营数据');assert.equal(f.state.dirty,true);
   assert.equal(f.inspect(),true);assert.equal(f.calls.notices,1);assert.match(f.calls.toasts[0][0],/策略.*已完成.*当前页面和输入/);
   assert.equal(f.calls.writes.length,1);assert.equal(f.button.dataset.pending,undefined);
  }finally{f.restore();}
 });
 test(action+' late failure belongs to the earlier strategy action and leaves the new draft untouched',async()=>{
  const f=harness(action);try{const {pending}=await f.start();await f.moveToDraft();f.request.resolve(json({error:{message:'来源已变化',code:'CONFLICT'}},409));await pending;
   assert.equal(f.calls.renders,0);assert.equal(f.draft.value,'新的未保存经营数据');assert.equal(f.state.dirty,true);
   assert.equal(f.inspect(),false);assert.match(f.calls.toasts[0][0],/先前的策略.*来源已变化/);
   assert.equal(f.calls.writes.length,1);assert.equal(f.button.dataset.pending,undefined);
  }finally{f.restore();}
 });
 test(action+' current success refreshes once, double click never repeats the write',async()=>{
  const f=harness(action);try{const {pending}=await f.start();await f.click();f.request.resolve(json({id:'saved-result'}));await pending;
   assert.equal(f.calls.renders,1);assert.equal(f.calls.writes.length,1);assert.equal(f.inspect(),false);assert.deepEqual(f.calls.toasts,[]);
   if(action==='strategy-activate')assert.deepEqual(f.calls.writes[0].body,{evaluation_id:'saved-evaluation',expected_active_version:7});
   if(action==='strategy-rollback')assert.deepEqual(f.calls.writes[0].body,{expected_active_version:7});
  }finally{f.restore();}
 });
 for(const failed of [false,true])test(action+' preserves a newer strategy dialog after '+(failed?'failure':'success'),async()=>{
  const f=harness(action);try{const {pending}=await f.start();await f.openNewDialog();const html=f.modal.innerHTML;
   f.request.resolve(json(failed?{error:{message:'先前写入失败'}}:{id:'saved-result'},failed?409:200));await pending;
   assert.equal(f.calls.renders,0);assert.equal(f.modal.open,true);assert.equal(f.modal.innerHTML,html);assert.equal(f.draft.value,'新的候选草稿');assert.equal(f.state.dirty,true);
   assert.equal(f.calls.writes.length,1);assert.match(f.calls.toasts[0][0],failed?/先前的策略.*先前写入失败/:/策略.*已完成/);
  }finally{f.restore();}
 });
 test(action+' current network failure reports uncertainty with no retry or saved-state claim',async()=>{
  const f=harness(action);try{const {pending}=await f.start();f.request.reject(new TypeError('isolated transport failure'));await pending;
   assert.equal(f.calls.renders,0);assert.equal(f.calls.writes.length,1);assert.equal(f.inspect(),false);assert.match(f.calls.toasts[0][0],/策略.*未确认完成.*不会自动重复提交/);
   assert.equal(f.button.dataset.pending,undefined);
  }finally{f.restore();}
 });
 for(const failed of [false,true])test(action+' ignores '+(failed?'failure':'success')+' from a replaced account',async()=>{
  const f=harness(action);try{const {pending}=await f.start();invalidateContext();invalidateInteractions();f.draft.value='另一账户的草稿';
   f.request.resolve(json(failed?{error:{message:'旧账户失败'}}:{id:'old-result'},failed?409:200));await pending;
   assert.equal(f.calls.renders,0);assert.equal(f.draft.value,'另一账户的草稿');assert.deepEqual(f.calls.toasts,[]);assert.equal(f.inspect(),false);
  }finally{f.restore();}
 });
}
test('activation navigation during its baseline read prevents a later write from that dismissed action',async()=>{
 const f=harness('strategy-activate');try{const pending=f.click();await f.moveToDraft();f.preflight.resolve(json({active:{version:8}}));
  // Release a write too so the unguarded implementation fails deterministically, without hanging.
  f.request.resolve(json({id:'unexpected-activation'}));await pending;
  assert.equal(f.calls.writes.length,0);assert.equal(f.calls.renders,0);assert.equal(f.draft.value,'新的未保存经营数据');
 }finally{f.restore();}
});
