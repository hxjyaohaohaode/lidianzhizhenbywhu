/** Controlled production submit/observer regressions; not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {finishMutation,interactionGuard,invalidateInteractions} from '../web/dist/interactions.js';
import {contextGuard,invalidateContext,ApiError} from '../web/dist/api.js';
import {unchangedInputGuard} from '../web/dist/saved-experiments.js';

const source=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');
const submitStart=source.indexOf("document.addEventListener('submit',");
const submitEnd=source.indexOf("\ndocument.addEventListener('click',",submitStart);
const refreshStart=source.indexOf('async function refreshData(');
const refreshEnd=source.indexOf('async function render(',refreshStart);
const themeStart=source.indexOf('function theme()');
const themeEnd=source.indexOf('function dialog(',themeStart);
assert(submitStart>=0&&submitEnd>submitStart&&refreshStart>=0&&themeStart>=0);
const js=ts.transpileModule(source.slice(themeStart,themeEnd)+source.slice(refreshStart,refreshEnd)+source.slice(submitStart,submitEnd),
 {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const createHandler=new Function('env',`
 const {document,HTMLFormElement,state,api,read,formSnapshot,render,toast,modal,inspector,
   finishMutation,interactionGuard,contextGuard,unchangedInputGuard,ApiError,scopedDatasets,setCsrf,
   showSyncNotice,resetAuth}=env;
 const split=v=>v.split(/[,，\\n]/).map(x=>x.trim()).filter(Boolean);
 let syncPending=false;
 ${js}
 return {theme};
`);
const acceptance=readFileSync(new URL('../scripts/service_browser_check.py',import.meta.url),'utf8');
const completionSource=acceptance.match(/FORM_COMPLETION = r"""([^]*?)"""/)[1];

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function observerHarness(){
 const observers=new Set(),timers=new Map();let timerId=0;
 class MutationObserver {
  constructor(callback){this.callback=callback;}
  observe(form,options){assert.deepEqual(options,{attributes:true,attributeFilter:['data-submitting','data-pending']});this.form=form;observers.add(this);}
  disconnect(){observers.delete(this);}
 }
 const changed=form=>{for(const observer of observers)if(observer.form===form)queueMicrotask(()=>{if(observers.has(observer))observer.callback();});};
 class HTMLFormElement {
  constructor(){
   this.id='preferences-form';this.isConnected=true;this.button={disabled:false};this.error={textContent:'',isConnected:true};
   this.values={name:'验收用户',role:'enterprise',theme:'dark',amount_unit:'wan',risk_appetite:'medium',horizon:'medium',memory_enabled:true,interests:'',watchlist:''};
   this.dataset=new Proxy({}, {set:(target,key,value)=>{target[key]=value;changed(this);return true;},deleteProperty:(target,key)=>{delete target[key];changed(this);return true;}});
  }
  reportValidity(){return true;}
  querySelector(selector){return selector==='.form-error'?this.error:this.button;}
  querySelectorAll(selector){assert.equal(selector,'.form-error');return [this.error];}
 }
 const wait=new Function('MutationObserver','setTimeout','clearTimeout','return ('+completionSource+');')(
  MutationObserver,(callback,ms)=>{assert.equal(ms,10000);timers.set(++timerId,callback);return timerId;},id=>timers.delete(id));
 return {HTMLFormElement,wait:form=>wait(form,10000),expire:()=>{for(const callback of [...timers.values()])callback();},
  active:()=>({observers:observers.size,timers:timers.size})};
}
function fixture(){
 invalidateContext();invalidateInteractions();
 const harness=observerHarness(),form=new harness.HTMLFormElement();
 const write=deferred(),refresh=deferred(),refreshEntered=deferred(),calls={writes:0,reads:0,renders:0,toasts:[]};
 const saved={id:'owner',version:2,preferences:{theme:'dark'}};
 const state={user:{id:'owner',version:1,preferences:{theme:'light'}},dirty:true,datasets:[],identities:[],identity:'',active:''};
 const document={documentElement:{dataset:{theme:'light'}},addEventListener:(name,handler)=>{assert.equal(name,'submit');document.submit=handler;}};
 let application;
 const env={document,HTMLFormElement:harness.HTMLFormElement,state,finishMutation,interactionGuard,contextGuard,unchangedInputGuard,ApiError,
  scopedDatasets:()=>[],setCsrf:()=>{},showSyncNotice:()=>{},resetAuth:()=>assert.fail('Unexpected reset'),
  formSnapshot:f=>JSON.stringify(f.values),read:f=>({str:key=>String(f.values[key]??''),check:key=>!!f.values[key]}),
  modal:{open:false},inspector:{open:false},toast:(...args)=>calls.toasts.push(args),
  api:async(path,method,body)=>{
   if(method==='PUT'){assert.equal(path,'/preferences');assert.equal(body.theme,'dark');assert.equal(body.version,1);calls.writes++;return write.promise;}
   assert(['/datasets','/capabilities','/services/identities','/auth/me'].includes(path));
   calls.reads++;if(calls.reads===4)refreshEntered.resolve();await refresh.promise;
   return path==='/auth/me'?{user:saved,csrf:'test-token'}:{items:[]};
  },
  render:async()=>{calls.renders++;application.theme();form.isConnected=false;},
 };
 application=createHandler(env);
 return {harness,form,write,refresh,refreshEntered,calls,saved,state,document,
  submit:()=>document.submit({target:form,preventDefault(){}})};
}

test('theme acceptance stays pending through delayed PUT and all refresh reads, then observes dark',async()=>{
 const f=fixture(),operation=f.submit();let finished=false;
 const completion=f.harness.wait(f.form).then(errors=>{finished=true;return errors;});
 await tick();assert.equal(finished,false);assert.equal(f.form.button.disabled,true);
 assert.equal(f.document.documentElement.dataset.theme,'light');assert.equal(f.calls.reads,0);
 f.write.resolve({user:f.saved});await f.refreshEntered.promise;await tick();
 assert.equal(finished,false);assert.equal(f.document.documentElement.dataset.theme,'light');assert.equal(f.calls.renders,0);
 f.refresh.resolve();await operation;assert.deepEqual(await completion,['']);
 assert.equal(f.document.documentElement.dataset.theme,'dark');assert.equal(f.form.isConnected,false);
 assert.equal(f.calls.writes,1);assert.equal(f.calls.reads,4);assert.equal(f.calls.renders,1);
 assert.deepEqual(f.harness.active(),{observers:0,timers:0});
});

test('failed preference PUT completes with its original error, leaves light theme and never retries',async()=>{
 const f=fixture(),operation=f.submit(),completion=f.harness.wait(f.form);
 f.write.reject(new ApiError('数据版本已变化',409,'VERSION_CONFLICT','test-only'));
 await operation;assert.deepEqual(await completion,['数据版本已变化']);
 assert.equal(f.document.documentElement.dataset.theme,'light');assert.equal(f.form.button.disabled,false);
 assert.equal(f.calls.writes,1);assert.equal(f.calls.reads,0);assert.equal(f.calls.renders,0);
 assert.deepEqual(f.harness.active(),{observers:0,timers:0});
});

test('known saved preference with failed refresh is completed recovery, not fabricated dark or a retry',async()=>{
 const f=fixture(),operation=f.submit(),completion=f.harness.wait(f.form);
 f.write.resolve({user:f.saved});await f.refreshEntered.promise;f.refresh.reject(new Error('offline'));
 await operation;assert.deepEqual(await completion,['']);
 assert.equal(f.document.documentElement.dataset.theme,'light');assert.equal(f.form.dataset.saved,'true');
 assert.equal(f.form.button.disabled,true);assert.equal(f.calls.writes,1);assert.equal(f.calls.renders,0);
 assert.match(f.calls.toasts[0][0],/个人偏好已保存.*同步读取未完成.*无需重复提交/);
});

test('navigation and an idle replacement cannot complete the original pending preference save',async()=>{
 const f=fixture(),operation=f.submit();let finished=false;
 const completion=f.harness.wait(f.form).then(errors=>{finished=true;return errors;});
 invalidateInteractions();f.form.isConnected=false;const replacement=new f.harness.HTMLFormElement();
 assert.equal(replacement.dataset.submitting,undefined);await tick();assert.equal(finished,false);
 f.write.resolve({user:f.saved});await operation;await completion;
 assert.equal(f.document.documentElement.dataset.theme,'light');assert.equal(f.calls.reads,0);assert.equal(f.calls.renders,0);
 assert.equal(f.calls.writes,1);assert.deepEqual(f.harness.active(),{observers:0,timers:0});
});

test('detached service form preserves its own failure instead of an idle replacement error snapshot',async()=>{
 const h=observerHarness(),original=new h.HTMLFormElement();original.dataset.pending='true';
 let finished=false;const completion=h.wait(original).then(errors=>{finished=true;return errors;});
 original.isConnected=false;const replacement=new h.HTMLFormElement();await tick();assert.equal(finished,false);
 original.error.textContent='原提交失败';delete original.dataset.pending;
 assert.deepEqual(await completion,['原提交失败']);assert.equal(replacement.error.textContent,'');
 assert.deepEqual(h.active(),{observers:0,timers:0});
});

test('already completed form is observed immediately with no timer or observer leak',async()=>{
 const h=observerHarness(),form=new h.HTMLFormElement();form.dataset.submitting='false';
 assert.deepEqual(await h.wait(form),['']);assert.deepEqual(h.active(),{observers:0,timers:0});
});

test('stuck original form fails at the existing bound and cleans the observer, never declaring success',async()=>{
 const h=observerHarness(),form=new h.HTMLFormElement();form.dataset.submitting='true';form.isConnected=false;
 const completion=h.wait(form),rejected=assert.rejects(completion,/within 10000 ms; submitting=true, pending=undefined, connected=false/);
 h.expire();await rejected;assert.equal(form.dataset.submitting,'true');assert.deepEqual(h.active(),{observers:0,timers:0});
});
