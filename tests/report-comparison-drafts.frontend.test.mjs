/** Actual compiled app listeners, form/readout renderers and API transport.
 * Explicit DOM and fetch doubles only; no browser, server, socket or provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {state} from '../web/dist/state.js';
import {api,workspace,ApiError,setCsrf,contextGuard,invalidateContext} from '../web/dist/api.js';
import {invalidateInteractions,interactionGuard,invalidateInputs,continuationGuard} from '../web/dist/interactions.js';
import {formSnapshot} from '../web/dist/form-snapshot.js';
import {unchangedInputGuard} from '../web/dist/saved-experiments.js';
import {reportCompareForm,reportSelectionDetails,reportComparisonView} from '../web/dist/views-analysis.js';
import * as components from '../web/dist/components.js';

const app=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
function section(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,`${start} -> ${end}`);return app.slice(a,b);}
const source=[
 section('function safeToLeave()', '// Used after'),
 section('function auth()', 'function assistantShell()'),
 section('function resetAuth()', 'async function showStage('),
 section("document.addEventListener('submit',", 'for (const overlay of'),
].join('\n');
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const comparison={left:'report-3',right:'report-1',left_period:'2024-Q1',right_period:'2024-Q1',same_period:true,same_rule_version:true,warning:'测试冻结结果',changes:[{metric:'gross_margin',before:.2,after:.2,delta:0}],input_diff:{}};

function harness({dirty=false,holdComparison=false}={}){
 invalidateContext();invalidateInteractions();setCsrf('synthetic-comparison-csrf');
 Object.assign(state,{user:{id:'test-owner',preferences:{}},identity:'',identities:[],active:'',datasets:[],route:'reports',id:'0',dirty,cache:{reports:[1,2,3].map(n=>({id:'report-'+n,query:'测试原问题 '+n,current_period:'2024-Q1',dataset_version:n,created_at:'2026-10-05T00:00:00Z'}))}});
 const calls={requests:[],confirms:[],toasts:[],focus:0,scroll:0};
 class Node{
  constructor(){this.dataset={};this.style={};this.innerHTML='';this.textContent='';this.isConnected=true;this.open=false;this.disabled=false;}
  close(){this.open=false;}replaceChildren(){this.innerHTML='';}
  setAttribute(){}removeAttribute(){}
 }
 class Button extends Node{
  constructor(action){super();this.dataset.action=action;}
  closest(selector){return selector==='[data-action],[data-route]'?this:null;}
 }
 class Form extends Node{
  constructor(id,values){super();this.id=id;this.fields=Object.fromEntries(Object.entries(values).map(([name,value])=>[name,{id:'',name,value,closest:selector=>selector==='form'||selector==='#'+id?this:null}]));this.submit=new Button();this.error=new Node();this.details=new Node();}
  reportValidity(){return true;}
  querySelector(selector){if(selector.startsWith('button'))return this.submit;if(selector==='.form-error')return this.error;if(selector==='#report-selection-details')return this.details;return this.fields[selector.match(/^\[name="([^"]+)"\]$/)?.[1]]??null;}
 }
 const root=new Node(),modal=new Node(),inspector=new Node(),notifications=new Node(),output=new Node();modal.open=true;
 output.closest=selector=>selector==='dialog'?modal:null;
 output.scrollIntoView=()=>calls.scroll++;output.focus=()=>calls.focus++;
 modal.querySelector=selector=>selector==='.dialog-head'?{getBoundingClientRect:()=>({height:40})}:null;
 const markup=reportCompareForm();
 assert.match(markup,/<form id="report-compare-form"/);
 const selections=Object.fromEntries([...markup.matchAll(/<select name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)].map(([,name,options])=>[name,options.match(/<option value="([^"]+)" selected/)?.[1]??options.match(/<option value="([^"]+)"/)?.[1]]));
 assert.deepEqual(selections,{left:'report-2',right:'report-1'});
 const form=new Form('report-compare-form',selections),draft=new Form('action-edit-form',{title:'真实未保存行动草稿'});
 form.parentElement={querySelector:selector=>selector==='#report-comparison'?output:null};
 const listeners={},document={addEventListener:(name,fn)=>listeners[name]=fn,querySelector:selector=>({'#report-comparison':output,'#notifications':notifications}[selector]??null)};
 const oldFetch=globalThis.fetch,OriginalFormData=globalThis.FormData;
 class Data extends OriginalFormData{constructor(form){super();if(form)for(const [name,field]of Object.entries(form.fields))this.append(name,field.value);}}
 globalThis.FormData=Data;
 let releaseComparison;
 const pendingComparison=new Promise(resolve=>releaseComparison=resolve);
 globalThis.fetch=(url,options)=>{
  calls.requests.push({url,method:options.method,body:options.body});
  if(url.startsWith('/api/workspace/reports/compare?'))return holdComparison?pendingComparison:Promise.resolve(json(comparison));
  assert.equal(url,'/api/auth/logout');assert.equal(options.method,'POST');return Promise.resolve(json({ok:true}));
 };
 const env={...components,state,document,root,modal,inspector,window:{confirm:message=>{calls.confirms.push(message);return false;}},location:{hash:'#reports'},
  api,workspace,ApiError,setCsrf,contextGuard,invalidateContext,invalidateInteractions,interactionGuard,invalidateInputs,continuationGuard,
  FormData:Data,HTMLFormElement:Form,HTMLButtonElement:Button,formSnapshot,unchangedInputGuard,reportSelectionDetails,reportComparisonView,
  resetCopilot(){},clearLayout(){},closeDrawers(){},render:async()=>{},toast:(...args)=>calls.toasts.push(args),showSyncNotice(){}};
 new Function(...Object.keys(env),'let live=null,renderEpoch=0,signingUp=false,syncPending=false;\n'+source)(...Object.values(env));
 return {form,draft,root,modal,output,calls,
  edit:async(type,field,value)=>{field.value=value;await listeners[type]({target:field});},
  click:action=>listeners.click({target:new Button(action),preventDefault(){}}),
  submit:()=>listeners.submit({target:form,preventDefault(){}}),
  release:()=>releaseComparison(json(comparison)),
  restore:()=>{globalThis.fetch=oldFetch;globalThis.FormData=OriginalFormData;},
 };
}

for(const event of ['input','change']){
 test(`read-only report ${event}, compare, close and logout sends one intended POST without discard`,async()=>{
  const h=harness();try{
   const pending=continuationGuard();await h.edit(event,h.form.fields.left,'report-3');assert.equal(pending(),false,'selection still invalidates pending input continuations');
   await h.submit();assert.match(h.output.innerHTML,/20%/);assert.match(h.output.innerHTML,/0 个百分点/);assert.equal(h.calls.focus,1);
   await h.click('close-modal');assert.equal(h.modal.open,false);
   await h.click('logout');
   assert.deepEqual(h.calls.confirms,[]);assert.deepEqual(h.calls.requests,[{url:'/api/workspace/reports/compare?left=report-3&right=report-1',method:'GET',body:undefined},{url:'/api/auth/logout',method:'POST',body:'{}'}]);
   assert.equal(state.dirty,false);assert.equal(state.user,null);assert.match(h.root.innerHTML,/id="auth-form"/);assert.deepEqual(h.calls.toasts,[]);
  }finally{h.restore();}
 });
 test(`read-only report ${event} preserves an existing editable draft underneath the modal`,async()=>{
  const h=harness({dirty:true});try{
   await h.edit(event,h.form.fields.left,'report-3');assert.equal(state.dirty,true);
   await h.submit();await h.click('close-modal');assert.equal(state.dirty,true);
   await h.click('logout');assert.equal(h.calls.confirms.length,1);assert.equal(state.dirty,true);assert.equal(h.draft.fields.title.value,'真实未保存行动草稿');assert(state.user);
   assert.equal(h.calls.requests.length,1);assert.equal(h.calls.requests[0].method,'GET');assert.deepEqual(h.calls.toasts,[]);
  }finally{h.restore();}
 });
 test(`real editable ${event} still prompts and cancelled logout retains input without POST`,async()=>{
  const h=harness();try{
   await h.edit(event,h.draft.fields.title,'用户继续输入的行动');assert.equal(state.dirty,true);
   await h.click('close-modal');await h.click('logout');
   assert.equal(h.calls.confirms.length,1);assert.equal(state.dirty,true);assert.equal(h.draft.fields.title.value,'用户继续输入的行动');assert.equal(h.draft.isConnected,true);assert(state.user);assert.deepEqual(h.calls.requests,[]);assert.deepEqual(h.calls.toasts,[]);
  }finally{h.restore();}
 });
 test(`late report response after a newer ${event} cannot paint old selected results`,async()=>{
  const h=harness({holdComparison:true});try{
   const submitted=h.submit();assert.equal(h.calls.requests.length,1);
   const pending=continuationGuard();await h.edit(event,h.form.fields.left,'report-3');assert.equal(pending(),false);
   const latest=h.output.innerHTML;h.release();await submitted;
   assert.equal(h.output.innerHTML,latest);assert.equal(h.form.fields.left.value,'report-3');assert.equal(h.calls.focus,0);assert.equal(h.calls.scroll,0);assert.equal(state.dirty,false);assert.equal(h.form.submit.disabled,false);assert.equal(h.calls.requests.length,1);assert.equal(h.calls.requests[0].method,'GET');assert.deepEqual(h.calls.toasts,[]);
  }finally{h.restore();}
 });
}
