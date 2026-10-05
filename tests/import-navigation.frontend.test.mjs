/** Deterministic asynchronous interaction regressions; not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {finishMutation,interactionGuard,invalidateInteractions} from '../web/dist/interactions.js';

function deferred(){
 let resolve,reject;
 const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});
 return {promise,resolve,reject};
}
function fixture(){
 invalidateInteractions();
 const valid=interactionGuard();
 const pending=deferred();
 const ui={route:'data',active:'original',dirty:true,modal:'import-preview',datasets:['original'],user:'owner',csrf:'old'};
 let refreshes=0,applies=0;
 const refresh=async current=>{
  refreshes++;
  assert.equal(current,valid,'the captured guard must reach the atomic refresh');
  const snapshot=await pending.promise;
  if(!current())return false;
  Object.assign(ui,snapshot);
  return true;
 };
 const apply=()=>{applies++;ui.active='saved';ui.dirty=false;ui.modal=null;ui.route='data';};
 return {valid,pending,ui,refresh,apply,counts:()=>({refreshes,applies})};
}

test('import completion keeps preview, selection and dirty state until refresh finishes',async()=>{
 const f=fixture();
 const before={...f.ui};
 const completion=finishMutation(f.valid,f.refresh,f.apply);
 assert.deepEqual(f.ui,before);
 assert.deepEqual(f.counts(),{refreshes:1,applies:0});
 f.pending.resolve({datasets:['original','saved'],csrf:'fresh'});
 assert.equal(await completion,true);
 assert.deepEqual(f.ui,{route:'data',active:'saved',dirty:false,modal:null,datasets:['original','saved'],user:'owner',csrf:'fresh'});
 assert.deepEqual(f.counts(),{refreshes:1,applies:1});
});

test('navigation during delayed import refresh cannot steal route or selection',async()=>{
 const f=fixture();
 const completion=finishMutation(f.valid,f.refresh,f.apply);
 invalidateInteractions();
 Object.assign(f.ui,{route:'copilot',active:'new-selection',dirty:true,modal:null});
 const afterNavigation={...f.ui};
 f.pending.resolve({datasets:['stale-saved'],csrf:'stale'});
 assert.equal(await completion,false);
 assert.deepEqual(f.ui,afterNavigation);
 assert.deepEqual(f.counts(),{refreshes:1,applies:0});
});

for(const action of ['dismiss preview','open replacement dialog']){
 test(`${action} during delayed import refresh survives completion`,async()=>{
  const f=fixture();
  const completion=finishMutation(f.valid,f.refresh,f.apply);
  invalidateInteractions();
  f.ui.modal=action==='dismiss preview'?null:'new-dialog';
  f.ui.dirty=true;
  const afterAction={...f.ui};
  f.pending.resolve({datasets:['stale-saved']});
  assert.equal(await completion,false);
  assert.deepEqual(f.ui,afterAction);
  assert.deepEqual(f.counts(),{refreshes:1,applies:0});
 });
}

test('already abandoned import completion does not begin refresh or apply',async()=>{
 const f=fixture();
 const before={...f.ui};
 invalidateInteractions();
 assert.equal(await finishMutation(f.valid,f.refresh,f.apply),false);
 assert.deepEqual(f.ui,before);
 assert.deepEqual(f.counts(),{refreshes:0,applies:0});
});

test('guard is rechecked after refresh even when refresh reports success',async()=>{
 invalidateInteractions();
 const valid=interactionGuard();
 let applies=0;
 const result=await finishMutation(valid,async current=>{
  assert.equal(current,valid);
  invalidateInteractions();
  return true;
 },()=>{applies++;});
 assert.equal(result,false);
 assert.equal(applies,0);
});

test('refresh returning false cannot finalize a still-current import',async()=>{
 invalidateInteractions();
 const valid=interactionGuard();
 let applies=0;
 assert.equal(await finishMutation(valid,async()=>false,()=>{applies++;}),false);
 assert.equal(valid(),true);
 assert.equal(applies,0);
});

test('auth guard invalidation during refresh does not restore old account data or CSRF',async()=>{
 invalidateInteractions();
 const interactionValid=interactionGuard();
 let authEpoch=1;
 const startedAuth=authEpoch;
 const valid=()=>interactionValid()&&startedAuth===authEpoch;
 const pending=deferred();
 const ui={user:'original-owner',datasets:['original'],csrf:'original-token',route:'data'};
 let applies=0;
 const completion=finishMutation(valid,async current=>{
  const staleSnapshot=await pending.promise;
  if(!current())return false;
  Object.assign(ui,staleSnapshot);
  return true;
 },()=>{applies++;ui.route='data';});
 authEpoch++;
 Object.assign(ui,{user:null,datasets:[],csrf:'',route:'login'});
 pending.resolve({user:'original-owner',datasets:['saved'],csrf:'stale-token'});
 assert.equal(await completion,false);
 assert.deepEqual(ui,{user:null,datasets:[],csrf:'',route:'login'});
 assert.equal(applies,0);
});

test('refresh failure propagates without closing preview or pretending finalization succeeded',async()=>{
 const f=fixture();
 const before={...f.ui};
 const failure=new Error('refresh failed after the server saved');
 const completion=finishMutation(f.valid,f.refresh,f.apply);
 const rejected=assert.rejects(completion,error=>error===failure);
 f.pending.reject(failure);
 await rejected;
 assert.deepEqual(f.ui,before);
 assert.deepEqual(f.counts(),{refreshes:1,applies:0});
});

test('older import finishing after a newer interaction cannot overwrite its successful state',async()=>{
 const old=fixture();
 const oldCompletion=finishMutation(old.valid,old.refresh,old.apply);
 invalidateInteractions();
 const newerValid=interactionGuard();
 assert.equal(await finishMutation(newerValid,async()=>true,()=>{
  Object.assign(old.ui,{route:'copilot',active:'newer-saved',dirty:false,modal:null,datasets:['newer-saved']});
 }),true);
 const newerState={...old.ui};
 old.pending.resolve({datasets:['older-saved']});
 assert.equal(await oldCompletion,false);
 assert.deepEqual(old.ui,newerState);
});

test('production import handler routes its UI completion through the tested guard',()=>{
 const source=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');
 const start=source.indexOf("case 'commit-stage':");
 assert.notEqual(start,-1);
 const end=source.indexOf("case '",start+6);
 const handler=source.slice(start,end);
 const guarded=handler.indexOf('finishMutation(');
 assert.notEqual(guarded,-1,'import completion must use the executable guarded helper');
 const beforeGuard=handler.slice(0,guarded);
 assert(!/state\.active\s*=|state\.dirty\s*=|modal\.close\(|navigate\(/.test(beforeGuard),'no UI finalization may precede guarded refresh');
 assert.match(source,/case 'close-modal':invalidateInteractions\(\)/);
 assert.match(source,/function resetAuth\(\)\{invalidateInteractions\(\)/);
 assert.match(source,/function navigate\([^]*?invalidateInteractions\(\)/);
});

test('production import refresh stages auth and workspace responses before guarded publication',()=>{
 const source=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');
 const start=source.indexOf('async function refreshData(');
 const end=source.indexOf('async function render(',start);
 assert(start>=0&&end>start);
 const refresh=source.slice(start,end);
 const publish=refresh.indexOf('state.datasets=');
 const guarded=refresh.lastIndexOf('if(!valid())return false;',publish);
 assert(guarded>=0&&guarded<publish,'guard must be checked before workspace publication');
 assert(refresh.indexOf('if(!valid())return false;')<refresh.indexOf('Promise.all'),'invalid continuation must stop before dispatching reads');
 assert(refresh.indexOf("api('/auth/me')")<guarded,'authentication response must be staged before publication');
 assert(!/\bawait\b/.test(refresh.slice(publish)),'publishing datasets, account and CSRF must be atomic');
 assert.match(refresh,/return true;/);
});

import {contextGuard,invalidateContext,ApiError} from '../web/dist/api.js';
const appSource=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
const commitStart=appSource.indexOf("case 'commit-stage':");
const commitEnd=appSource.indexOf("case '",commitStart+6);
const commitBranch=appSource.slice(commitStart,commitEnd);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
// Execute the production switch branch with controlled I/O. This exercises its
// saved flag, catch/finally, context notices and guard composition without a DOM.
const executeCommit=new AsyncFunction('env',`
 const {state,el,workspace,valid,contextGuard,finishMutation,refreshData,modal,navigate,showSyncNotice,toast,ApiError,resetAuth}=env;
 let syncPending=false;
 try{switch('commit-stage'){${commitBranch}}}
 catch(e){toast(e instanceof Error?e.message:'操作失败',true);}
 return {syncPending};
`);
function handlerFixture(){
 invalidateInteractions();invalidateContext();
 const pending=deferred(),entered=deferred();
 const calls={writes:[],notices:0,toasts:[],closes:0,navigations:[],refreshes:0,scrolls:0,focuses:0};
 const state={cache:{stage:{id:'stage',version:7,payload:{fingerprint:'fingerprint'}}},active:'original',dirty:true,route:'data',datasets:['original']};
 const el={textContent:'确认保存',attributes:new Map(),setAttribute(key,value){this.attributes.set(key,value);},removeAttribute(key){this.attributes.delete(key);}};
 const errorGroup={style:{},scrollIntoView(){calls.scrolls++;}};
 const feedback={textContent:'',isConnected:true,parentElement:errorGroup,focus(){calls.focuses++;}};
 const modal={open:true,close(){calls.closes++;this.open=false;},querySelector(selector){
  if(selector==='[data-import-stage-error]')return feedback;
  if(selector==='.dialog-head')return {getBoundingClientRect:()=>({height:72})};
  throw new Error('Unexpected selector: '+selector);
 }};
 const env={state,el,modal,ApiError,resetAuth:()=>{invalidateContext();state.route='login';},valid:interactionGuard(),contextGuard,finishMutation,
  workspace:async(...args)=>{calls.writes.push(args);return {id:'saved'};},
  refreshData:async valid=>{calls.refreshes++;entered.resolve();const data=await pending.promise;if(!valid())return false;state.datasets=data;return true;},
  navigate:(route,force)=>{calls.navigations.push([route,force]);state.route=route;},
  showSyncNotice:()=>{calls.notices++;},toast:(...args)=>{calls.toasts.push(args);}
 };
 return {pending,entered,calls,state,el,modal,feedback,errorGroup,env,run:()=>executeCommit(env)};
}

test('production commit keeps controls pending then applies current synchronized completion once',async()=>{
 const f=handlerFixture(),completion=f.run();
 await f.entered.promise;
 assert.equal(f.modal.open,true);assert.equal(f.state.dirty,true);assert.equal(f.state.active,'original');
 assert(f.el.attributes.has('disabled'));assert.match(f.el.textContent,/同步/);
 f.pending.resolve(['saved']);
 assert.deepEqual(await completion,{syncPending:false});
 assert.equal(f.state.active,'saved');assert.equal(f.state.dirty,false);assert.equal(f.modal.open,false);
 assert.deepEqual(f.calls.navigations,[['data',true]]);assert.equal(f.calls.toasts.length,1);
 assert.deepEqual(f.calls.writes,[['/imports/stage/commit','POST',{version:7,fingerprint:'fingerprint'}]]);
 assert.equal(f.el.textContent,'确认保存');assert.equal(f.el.attributes.has('disabled'),false);
});

test('production commit preserves a newer route and draft while announcing the saved write',async()=>{
 const f=handlerFixture(),completion=f.run();
 await f.entered.promise;
 invalidateInteractions();
 Object.assign(f.state,{route:'copilot',active:'other',dirty:true});
 f.modal.open=true;
 f.pending.resolve(['saved']);
 assert.deepEqual(await completion,{syncPending:true});
 assert.equal(f.state.route,'copilot');assert.equal(f.state.active,'other');assert.equal(f.state.dirty,true);
 assert.deepEqual(f.state.datasets,['original']);assert.equal(f.modal.open,true);
 assert.equal(f.calls.closes,0);assert.deepEqual(f.calls.navigations,[]);
 assert.equal(f.calls.notices,1);assert.match(f.calls.toasts[0][0],/数据已保存.*保留/);
});

for(const newerInteraction of [false,true]){
 test(`production saved-but-sync-failed reports recovery without duplicate write${newerInteraction?' or stealing newer draft':''}`,async()=>{
  const f=handlerFixture(),completion=f.run();
  await f.entered.promise;
  if(newerInteraction){invalidateInteractions();Object.assign(f.state,{route:'copilot',active:'other',dirty:true});}
  f.pending.reject(new Error('auth/read unavailable'));
  assert.deepEqual(await completion,{syncPending:true});
  assert.equal(f.calls.writes.length,1);assert.equal(f.calls.refreshes,1);assert.deepEqual(f.calls.navigations,[]);
  assert.equal(f.calls.notices,1);assert.equal(f.calls.toasts.length,1);
  assert.match(f.calls.toasts[0][0],/数据已保存.*同步读取未完成.*无需重复导入/);
  assert.equal(f.calls.toasts[0][1],true);
  assert.equal(f.modal.open,newerInteraction);assert.equal(f.state.dirty,newerInteraction);
  if(newerInteraction){assert.equal(f.state.route,'copilot');assert.equal(f.state.active,'other');}
  assert.equal(f.el.textContent,'确认保存');assert.equal(f.el.attributes.has('disabled'),false);
 });
}

for(const replacement of ['logout','account-switch'])for(const failed of [false,true]){
 test(`production ${replacement} suppresses stale saved notices and state after ${failed?'failed':'successful'} refresh`,async()=>{
  const f=handlerFixture(),completion=f.run();
  await f.entered.promise;
  invalidateContext();
  Object.assign(f.state,{route:replacement==='logout'?'login':'brief',active:'replacement',dirty:true,datasets:['replacement-account']});
  if(failed)f.pending.reject(new Error('stale account response'));
  else f.pending.resolve(['old-account-data']);
  assert.deepEqual(await completion,{syncPending:false});
  assert.equal(f.calls.writes.length,1);assert.equal(f.calls.notices,0);assert.deepEqual(f.calls.toasts,[]);
  assert.deepEqual(f.calls.navigations,[]);assert.equal(f.calls.closes,0);assert.equal(f.modal.open,true);
  assert.equal(f.state.active,'replacement');assert.equal(f.state.dirty,true);
  assert.deepEqual(f.state.datasets,['replacement-account']);
  assert.equal(f.el.textContent,'确认保存');assert.equal(f.el.attributes.has('disabled'),false);
 });
}

test('production rejected preview puts its error in the current modal without a hidden global toast',async()=>{
 const f=handlerFixture();
 const failure=new ApiError('预览完整性校验失败；未写入数据，请返回重新预览',409,'PREVIEW_INTEGRITY','');
 f.env.workspace=async()=>{throw failure;};
 assert.deepEqual(await f.run(),{syncPending:false});
 assert.equal(f.feedback.textContent,failure.message);
 assert.equal(f.calls.scrolls,1);assert.equal(f.calls.focuses,1);
 assert.equal(f.errorGroup.style.scrollMarginTop,'84px');
 assert.equal(f.calls.refreshes,0);assert.equal(f.calls.notices,0);assert.deepEqual(f.calls.toasts,[]);
 assert.equal(f.modal.open,true);assert.equal(f.state.dirty,true);assert.equal(f.state.active,'original');
 assert.equal(f.el.textContent,'确认保存');assert.equal(f.el.attributes.has('disabled'),false);
});

test('production preview retry clears only its previous error before successful completion',async()=>{
 const f=handlerFixture();f.feedback.textContent='上一轮明确拒绝';
 const completion=f.run();await f.entered.promise;
 assert.equal(f.feedback.textContent,'');
 f.pending.resolve(['saved']);await completion;
 assert.equal(f.calls.toasts.length,1);assert.match(f.calls.toasts[0][0],/已保存标准化/);
 assert.equal(f.calls.toasts[0][1],undefined);
});

test('production uncertain write outcome remains explicit inside the preview without automatic retry',async()=>{
 const f=handlerFixture(),message='请求超时。写入可能已被服务端接收，请刷新状态后确认；不会自动重复提交。';let writes=0;
 f.env.workspace=async()=>{writes++;throw new Error(message);};
 await f.run();assert.equal(writes,1);assert.equal(f.feedback.textContent,message);
 assert.equal(f.calls.refreshes,0);assert.equal(f.state.dirty,true);assert.equal(f.modal.open,true);
 assert.deepEqual(f.calls.toasts,[]);
});

test('late rejected preview cannot change a newer dialog or escape to the global click-error boundary',async()=>{
 const f=handlerFixture(),request=deferred(),failure=new ApiError('原预览已拒绝；未写入',409,'PREVIEW_INTEGRITY','');
 f.env.workspace=()=>request.promise;const completion=f.run();
 invalidateInteractions();f.feedback.isConnected=false;f.feedback.textContent='new dialog message';
 request.reject(failure);await completion;
 assert.equal(f.feedback.textContent,'new dialog message');assert.equal(f.calls.focuses,0);assert.equal(f.calls.scrolls,0);
 assert.deepEqual(f.calls.toasts,[]);
});

for(const failure of [new Error('network unavailable'),new ApiError('request timeout',408,'PREVIEW_INTEGRITY',''),new ApiError('non-JSON gateway',404,'NON_JSON',''),new ApiError('server failure',500,'ERROR','')]){
test(`late uncertain preview (${failure instanceof ApiError?failure.code+failure.status:'network'}) preserves a labelled old-result warning`,async()=>{
 const f=handlerFixture(),request=deferred();f.env.workspace=()=>request.promise;const completion=f.run();
 invalidateInteractions();f.feedback.isConnected=false;f.feedback.textContent='new dialog message';
 request.reject(failure);await completion;
 assert.equal(f.feedback.textContent,'new dialog message');assert.equal(f.calls.focuses,0);assert.equal(f.calls.scrolls,0);
 assert.equal(f.calls.toasts.length,1);assert.match(f.calls.toasts[0][0],/上一份数据预览.*未能确认.*不要重复导入/);
 assert.equal(f.calls.notices,0);assert.equal(f.calls.refreshes,0);assert.equal(f.state.dirty,true);
});
}

test('production saved commit followed by current-session 401 resets auth with an explicit saved notice',async()=>{
 const f=handlerFixture(),completion=f.run();
 await f.entered.promise;
 f.pending.reject(new ApiError('session expired',401,'UNAUTHORIZED','request'));
 assert.deepEqual(await completion,{syncPending:false});
 assert.equal(f.state.route,'login');assert.equal(f.calls.writes.length,1);
 assert.equal(f.calls.notices,0);assert.deepEqual(f.calls.navigations,[]);
 assert.equal(f.calls.toasts.length,1);assert.match(f.calls.toasts[0][0],/数据已保存.*登录已失效/);
 assert.equal(f.calls.toasts[0][1],true);
 assert.equal(f.el.textContent,'确认保存');assert.equal(f.el.attributes.has('disabled'),false);
});

test('production old-session 401 after account switch cannot reset the new session or show old saved notice',async()=>{
 const f=handlerFixture(),completion=f.run();
 await f.entered.promise;
 invalidateContext();f.state.route='copilot';
 f.pending.reject(new ApiError('old session expired',401,'UNAUTHORIZED','request'));
 assert.deepEqual(await completion,{syncPending:false});
 assert.equal(f.state.route,'copilot');assert.equal(f.calls.notices,0);assert.deepEqual(f.calls.toasts,[]);
 assert.deepEqual(f.calls.navigations,[]);assert.equal(f.calls.closes,0);
});
