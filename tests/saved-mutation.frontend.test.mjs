/** Executes the production post-save branch; not native browser acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {finishMutation,interactionGuard,invalidateInteractions} from '../web/dist/interactions.js';
import {contextGuard,invalidateContext,ApiError} from '../web/dist/api.js';
const source=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');
const start=source.indexOf('if(changed&&submittedContext())');
const end=source.indexOf('\n }catch(e)',start);
assert(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const execute=new AsyncFunction('env',`
 const {submittedContext,submittedCurrent,finishMutation,refreshData,state,modal,inspector,render,toast,form,showSyncNotice,ApiError,resetAuth}=env;
 let syncPending=false;const changed=true,savedDraftMessage='';
 await (async()=>{${source.slice(start,end)}})();
 return {syncPending};
`);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(){
 invalidateContext();invalidateInteractions();
 const wait=deferred(),entered=deferred(),state={dirty:true,route:'memory',datasets:['old']};
 const calls={reads:0,renders:0,resets:0,notices:0,toasts:[]};
 const modal={open:true,close(){this.open=false;}},inspector={open:false,close(){this.open=false;}};
 const form={dataset:{},isConnected:true};
 const env={state,form,modal,inspector,ApiError,finishMutation,submittedContext:contextGuard(),submittedCurrent:interactionGuard(),
  refreshData:async valid=>{calls.reads++;entered.resolve();const data=await wait.promise;if(!valid())return false;state.datasets=data;return true;},
  render:async()=>{calls.renders++;},toast:(...args)=>calls.toasts.push(args),showSyncNotice:()=>calls.notices++,
  resetAuth:()=>{calls.resets++;invalidateContext();state.route='login';}};
 return {env,state,form,modal,calls,wait,entered,run:()=>execute(env)};
}
test('a confirmed create followed by refresh failure remains a saved result and blocks resubmission',async()=>{
 const f=fixture(),p=f.run();await f.entered.promise;f.wait.reject(new Error('offline'));
 assert.deepEqual(await p,{syncPending:true});assert.equal(f.calls.reads,1);assert.equal(f.calls.renders,0);
 assert.equal(f.modal.open,false);assert.equal(f.state.dirty,false);assert.equal(f.form.dataset.saved,'true');
 assert.match(f.calls.toasts[0][0],/已保存.*同步读取未完成.*无需重复提交/);
 assert.equal(f.calls.notices,1);
});
test('a newer draft survives a saved mutation whose refresh fails',async()=>{
 const f=fixture(),p=f.run();await f.entered.promise;invalidateInteractions();f.state.route='actions';
 f.wait.reject(new Error('offline'));assert.deepEqual(await p,{syncPending:true});
 assert.equal(f.modal.open,true);assert.equal(f.state.dirty,true);assert.equal(f.form.dataset.saved,undefined);
 assert.equal(f.state.route,'actions');assert.equal(f.calls.renders,0);
});
for(const failed of [false,true])test(`late ${failed?'failed':'successful'} refresh cannot publish or notify in a replacement account`,async()=>{
 const f=fixture(),p=f.run();await f.entered.promise;invalidateContext();f.state.route='brief';f.state.datasets=['new-account'];
 if(failed)f.wait.reject(new ApiError('old session',401,'UNAUTHORIZED',''));else f.wait.resolve(['old-account']);
 assert.deepEqual(await p,{syncPending:false});assert.deepEqual(f.state.datasets,['new-account']);
 assert.equal(f.modal.open,true);assert.equal(f.state.dirty,true);assert.equal(f.calls.resets,0);
 assert.equal(f.calls.renders,0);assert.deepEqual(f.calls.toasts,[]);assert.equal(f.calls.notices,0);
});
test('current expired authentication after known save reports saved and requires login',async()=>{
 const f=fixture(),p=f.run();await f.entered.promise;f.wait.reject(new ApiError('expired',401,'UNAUTHORIZED',''));
 assert.deepEqual(await p,{syncPending:false});assert.equal(f.calls.resets,1);
 assert.match(f.calls.toasts[0][0],/已保存.*登录已失效/);assert.equal(f.calls.renders,0);
});
test('successful current post-save refresh renders once and clears only the submitted draft',async()=>{
 const f=fixture(),p=f.run();await f.entered.promise;assert.equal(f.modal.open,true);f.wait.resolve(['saved']);
 assert.deepEqual(await p,{syncPending:false});assert.deepEqual(f.state.datasets,['saved']);
 assert.equal(f.modal.open,false);assert.equal(f.state.dirty,false);assert.equal(f.calls.renders,1);
 assert.deepEqual(f.calls.toasts,[['已保存。']]);
});
test('confirmed saved forms cannot submit again or be reenabled by final cleanup',()=>{
 assert.match(source,/if\(form\.dataset\.saved==='true'\)/);
 assert.match(source,/submit\.disabled=form\.dataset\.saved==='true'/);
});

const restoreStart=source.indexOf("case 'restore-revision':"),restoreEnd=source.indexOf("case '",restoreStart+6);
const executeRestore=new AsyncFunction('env',`
 const {workspace,state,el,activeDataset,contextGuard,valid,finishMutation,refreshData,modal,render,toast,showSyncNotice,ApiError,resetAuth}=env;
 const confirm=()=>true;let syncPending=false;
 switch('restore-revision'){${source.slice(restoreStart,restoreEnd)}}
 return {syncPending};
`);
function restoreFixture(){
 const f=fixture(),write=deferred();f.state.active='source';
 Object.assign(f.env,{el:{dataset:{revision:'1'}},activeDataset:()=>({version:4}),contextGuard,valid:interactionGuard(),workspace:()=>write.promise});
 return {...f,write,run:()=>executeRestore(f.env)};
}
test('completed restore does not close or clear a newer draft opened while write was pending',async()=>{
 const f=restoreFixture(),p=f.run();invalidateInteractions();f.state.route='memory';f.write.resolve({version:5});
 assert.deepEqual(await p,{syncPending:true});assert.equal(f.calls.reads,0);assert.equal(f.calls.renders,0);
 assert.equal(f.modal.open,true);assert.equal(f.state.dirty,true);assert.match(f.calls.toasts[0][0],/已恢复.*保留/);
});
test('restore refresh is fenced from later navigation and account replacement',async()=>{
 const f=restoreFixture(),p=f.run();f.write.resolve({version:5});await f.entered.promise;
 invalidateInteractions();invalidateContext();f.state.datasets=['replacement'];f.wait.resolve(['old-restored']);
 assert.deepEqual(await p,{syncPending:false});assert.deepEqual(f.state.datasets,['replacement']);assert.equal(f.calls.renders,0);
 assert.equal(f.modal.open,true);assert.equal(f.state.dirty,true);assert.deepEqual(f.calls.toasts,[]);
});
test('failed restore preserves draft and never claims success or starts refresh',async()=>{
 const f=restoreFixture(),p=f.run();f.write.reject(new Error('version conflict'));
 await assert.rejects(p,/version conflict/);assert.equal(f.calls.reads,0);assert.deepEqual(f.calls.toasts,[]);
 assert.equal(f.modal.open,true);assert.equal(f.state.dirty,true);
});
test('known restored revision with refresh failure reports recovery rather than another write',async()=>{
 const f=restoreFixture(),p=f.run();f.write.resolve({version:5});await f.entered.promise;f.wait.reject(new Error('offline'));
 assert.deepEqual(await p,{syncPending:true});assert.equal(f.calls.reads,1);assert.equal(f.calls.renders,0);
 assert.equal(f.modal.open,false);assert.equal(f.state.dirty,false);assert.match(f.calls.toasts[0][0],/已恢复.*无需重复恢复/);
});

test('preference success names the saved settings and cannot look like a later plan success',async()=>{
 const f=fixture();f.form.id='preferences-form';const p=f.run();await f.entered.promise;f.wait.resolve(['saved']);await p;
 assert.deepEqual(f.calls.toasts,[['个人偏好已保存。']]);
});

for(const [id,subject] of [['evidence-form','证据资料'],['document-form','证据资料'],['search-evidence-form','证据资料'],['fetch-evidence-form','证据资料'],['evidence-review-form','资料审阅'],['evidence-metadata-form','资料信息']]){
 test(id+' success remains scoped to its saved object after a later page opens',async()=>{
  const f=fixture();f.form.id=id;const p=f.run();await f.entered.promise;f.wait.resolve(['saved']);await p;
  f.state.route='data';f.state.dirty=true;
  assert.deepEqual(f.calls.toasts,[[subject+'已保存。']]);
  assert.equal(f.state.dirty,true);
 });
}
test('late evidence save names the old object and retains the newer draft',async()=>{
 const f=fixture();f.form.id='evidence-form';const p=f.run();await f.entered.promise;
 invalidateInteractions();f.state.route='data';f.wait.resolve(['saved']);await p;
 assert.equal(f.state.dirty,true);assert.equal(f.calls.renders,0);
 assert.match(f.calls.toasts[0][0],/^证据资料已保存；保留你当前的页面和输入/);
});
