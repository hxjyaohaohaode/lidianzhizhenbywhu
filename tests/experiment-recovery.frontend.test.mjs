/** Compiled production submit listener/API with a named in-memory loss transport.
 * Server semantics are separately checked with TestClient; this is not native UI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {api,workspace,ApiError,contextGuard,invalidateContext} from '../web/dist/api.js';
import {state,scopedDatasets} from '../web/dist/state.js';
import {saveExperiment,experimentRecoveryPanel,forgetExperimentAttempt,experimentAttemptManager} from '../web/dist/experiment-recovery.js';
import {unchangedInputGuard} from '../web/dist/saved-experiments.js';
import {interactionGuard,invalidateInteractions,continuationGuard} from '../web/dist/interactions.js';
import {formSnapshot} from '../web/dist/form-snapshot.js';
import {notice,routeButton} from '../web/dist/components.js';

const source=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
const listener=source.slice(source.indexOf("document.addEventListener('submit'"),source.indexOf("document.addEventListener('click'"));
const clickListener=source.slice(source.indexOf("document.addEventListener('click'"),source.indexOf("document.addEventListener('input'"));
const read=source.slice(source.indexOf('function read(form)'),source.indexOf('async function showStage('));
let submit,click,calls,records,storage,navigations,toasts,dialogs,fault,hold;
class Form {
 constructor(extra={},retry=''){
  this.id=retry?'experiment-retry-'+retry:'experiment-form';this.dataset={owner:state.user.id,identity:state.identity,active:state.active,...(retry?{experimentRetry:'true',requestId:retry}:{})};
  this.fields=new Map(Object.entries(retry?{}:{dataset_id:'dataset-a',target_period:'',name:'隔离实验',kind:'scenario',assumptions:'清楚列明的测试假设',price_change:'5',cost_change:'2',volume_change:'3',fixed_cost_share:'20',...extra}));
  this.isConnected=true;this.error={textContent:'',isConnected:true};this.button={disabled:false};this.innerHTML='';
 }
 reportValidity(){return true;}
 querySelector(s){if(s==='.form-error')return this.error;if(s==='button[type="submit"],button:not([type])')return this.button;throw Error(s);}
}
class FormDataStub {
 constructor(form){this.fields=new Map(form.fields);}get(k){return this.fields.get(k)??null;}has(k){return this.fields.has(k);}getAll(k){return this.has(k)?[this.get(k)]:[];}[Symbol.iterator](){return this.fields[Symbol.iterator]();}
}
class Button {
 constructor(action,id='',holder=null){this.dataset={action,id};this.holder=holder;this.disabled=false;}
 closest(selector){return selector==='[data-action],[data-route]'?this:this.holder;}
 setAttribute(){}removeAttribute(){}
}
function installListener(save=saveExperiment){
 new Function('env',`const {document,state,workspace,api,ApiError,contextGuard,unchangedInputGuard,interactionGuard,formSnapshot,scopedDatasets,navigate,toast,saveExperiment,notice,routeButton}=env;${read}\n${listener}`)({document:{addEventListener:(_,fn)=>submit=fn},state,workspace,api,ApiError,contextGuard,unchangedInputGuard,interactionGuard,formSnapshot,scopedDatasets,saveExperiment:save,notice,routeButton,navigate:(path)=>navigations.push(path),toast:(...args)=>toasts.push(args)});
}
function installClickListener(){
 new Function('env',`const {document,state,contextGuard,interactionGuard,continuationGuard,experimentAttemptManager,forgetExperimentAttempt,toast,dialog}=env;${clickListener}`)({document:{addEventListener:(_,fn)=>click=fn},state,contextGuard,interactionGuard,continuationGuard,experimentAttemptManager,forgetExperimentAttempt,toast:(...args)=>toasts.push(args),dialog:(title,html)=>dialogs.push({title,html})});
}
test.beforeEach(()=>{
 Object.assign(state,{user:{id:'owner-a'},identity:'identity-a',identities:[],active:'dataset-a',datasets:[{id:'dataset-a',version:1,content_hash:'a'.repeat(64),payload:{company:'测试企业'}}],cache:{},dirty:true});
 invalidateContext();invalidateInteractions();calls=[];records=new Map();storage=new Map();navigations=[];toasts=[];dialogs=[];fault=null;hold=null;
 globalThis.FormData=FormDataStub;globalThis.HTMLFormElement=Form;globalThis.HTMLButtonElement=Button;globalThis.confirm=()=>true;
 globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 // Named stub commits a keyed request, then drops only its response.
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body),owner=state.user.id;calls.push({url,body:structuredClone(body),owner});
  const key=owner+':'+body.request_id;
  let result=records.get(key);
  if(!result){result={id:'experiment-'+records.size,version:1,payload:{creation_request_id:body.request_id,dataset_id:body.dataset_id,request:structuredClone(body)}};records.set(key,result);}
  if(hold)await hold;
  if(fault){const mode=fault;fault=null;const e=new Error('CommittedResponseLossTransport');if(mode==='abort')e.name='AbortError';throw e;}
  return {ok:true,status:201,headers:{get:()=> 'application/json'},json:async()=>structuredClone(result)};
 };
 installListener();installClickListener();
});
const invoke=form=>submit({target:form,preventDefault(){}});
const attempts=()=>JSON.parse([...storage.values()][0]??'[]');

for(const kind of ['scenario','forecast'])for(const loss of ['network','abort'])test(`${kind}: manual retry after committed ${loss} reuses exact request and confirms once`,async()=>{
 const f=new Form(kind==='forecast'?{kind,metric:'cash_flow',horizon:'3'}:{});fault=loss;
 await invoke(f);assert.equal(records.size,1);assert.equal(calls.length,1);assert.equal(navigations.length,0);assert.equal(f.button.disabled,false);
 assert.match(f.error.textContent,/保存结果尚未确认/);assert.equal(attempts().length,1);
 await invoke(f);assert.deepEqual(calls[0],calls[1]);assert.equal(records.size,1);assert.deepEqual(navigations,['lab:experiment-0']);assert.equal(attempts().length,0);
 await invoke(f);assert.equal(calls.length,2); // confirmed old form is inert
});

test('unknown changed draft then original draft retain separate stable keys',async()=>{
 const f=new Form();fault='network';await invoke(f);const original=structuredClone(calls[0].body);
 f.fields.set('name','后来的草稿');fault='network';await invoke(f);const changed=structuredClone(calls[1].body);
 assert.notEqual(original.request_id,changed.request_id);assert.equal(attempts().length,2);
 f.fields.set('name','隔离实验');await invoke(f);assert.deepEqual(calls[2].body,original);assert.equal(records.size,2);
 assert.equal(attempts()[0].request.request_id,changed.request_id);
});

test('changed inputs while pending remain and can explicitly create a later new experiment',async()=>{
 let release;hold=new Promise(resolve=>release=resolve);const f=new Form();const pending=invoke(f);
 assert.equal(calls.length,1);await invoke(f);assert.equal(calls.length,1);assert.equal(f.button.disabled,true);
 f.fields.set('name','保存中修改的新草稿');release();await pending;hold=null;
 assert.equal(navigations.length,0);assert.equal(f.fields.get('name'),'保存中修改的新草稿');assert.equal(f.button.disabled,false);assert.equal(attempts().length,0);assert.match(toasts[0][0],/保留/);
 await invoke(f);assert.equal(records.size,2);assert.notEqual(calls[0].body.request_id,calls[1].body.request_id);
});

test('reload exposes frozen original details and only explicit recovery submits original revision',async()=>{
 const f=new Form();fault='network';await invoke(f);const original=structuredClone(calls[0].body);
 state.datasets[0].version=2;state.datasets[0].content_hash='b'.repeat(64);
 const fresh=await import('../web/dist/experiment-recovery.js?reload=1');
 const html=fresh.experimentRecoveryPanel([]);assert.match(html,/原数据 v1/);assert(html.includes('a'.repeat(64)));assert.match(html,/售价 5%/);assert.match(html,/清楚列明的测试假设/);assert.equal(calls.length,1);
 installListener(fresh.saveExperiment);const retry=new Form({},original.request_id),draft=new Form({name:'刷新后写下的新草稿'});
 await invoke(retry);assert.deepEqual(calls[1].body,original);assert.equal(records.size,1);assert.equal(navigations.length,0);assert.match(retry.innerHTML,/原提交已确认保存/);assert.equal(draft.fields.get('name'),'刷新后写下的新草稿');
 const later=new Form();await invoke(later);assert.equal(records.size,2);assert.equal(calls[2].body.dataset_version,2);assert.notEqual(calls[2].body.request_id,original.request_id);
});

for(const change of ['owner','identity','active'])test(`pending outcome and recovery do not leak across changed ${change}`,async()=>{
 let release;hold=new Promise(resolve=>release=resolve);const f=new Form(),pending=invoke(f);
 if(change==='owner')state.user={id:'owner-b'};else if(change==='identity')state.identity='identity-b';else state.active='dataset-b';
 invalidateContext();release();await pending;hold=null;
 assert.equal(navigations.length,0);assert.equal(toasts.length,0);assert.equal(f.error.textContent,'');const panel=experimentRecoveryPanel([]);assert(!panel.includes('data-experiment-retry'));assert(!panel.includes('隔离实验'));assert.equal(attempts().length,1);
 await invoke(f);assert.equal(calls.length,1);assert.match(f.error.textContent,/范围已变化/);
});

test('after unknown save changed current scope cannot send retained original request',async()=>{
 const f=new Form();fault='network';await invoke(f);const id=attempts()[0].request.request_id;
 state.identity='identity-b';const retry=new Form({},id);await invoke(retry);
 assert.equal(calls.length,1);assert.match(retry.error.textContent,/不属于当前范围/);
});

test('storage refusal fails before POST and bounded receipts are never silently evicted',async()=>{
 globalThis.sessionStorage.setItem=()=>{throw new Error('blocked');};const f=new Form();await invoke(f);
 assert.equal(calls.length,0);assert.match(f.error.textContent,/尚未提交/);
 globalThis.sessionStorage.setItem=(k,v)=>storage.set(k,v);
 for(let i=0;i<20;i++){f.fields.set('name','未确认'+i);fault='network';await invoke(f);}
 assert.equal(attempts().length,20);const first=attempts()[0].request.request_id;
 f.fields.set('name','第二十一条');await invoke(f);assert.equal(calls.length,20);assert.match(f.error.textContent,/未确认的实验提交过多/);assert.equal(attempts()[0].request.request_id,first);
 forgetExperimentAttempt(first);await invoke(f);assert.equal(calls.length,21);
});

test('oversize and corrupt receipts fail closed before a write',async()=>{
 const f=new Form();f.fields.set('assumptions','汉'.repeat(60000));await invoke(f);assert.equal(calls.length,0);assert.match(f.error.textContent,/尚未提交/);
 storage.set('lidian:experiment-attempts:v1:owner-a','{"broken":true}');f.fields.set('assumptions','有效但仍不能提交');await invoke(f);assert.equal(calls.length,0);assert.match(f.error.textContent,/尚未提交/);
});

test('a new owner has independent receipt capacity and cannot display the old owner attempt',async()=>{
 const f=new Form();fault='network';await invoke(f);const original=attempts()[0];
 state.user={id:'owner-b'};invalidateContext();assert.equal(experimentRecoveryPanel([]),'');
 const second=new Form();fault='network';await invoke(second);assert.equal(calls.length,2);assert.notEqual(calls[1].body.request_id,original.request.request_id);
 const html=experimentRecoveryPanel([]);assert(!html.includes(original.request.request_id));assert(html.includes(calls[1].body.request_id));
 state.user={id:'owner-a'};invalidateContext();assert(experimentRecoveryPanel([]).includes(original.request.request_id));
});

test('known server rejection is shown truthfully and retains the earlier uncertain key',async()=>{
 const f=new Form();fault='network';await invoke(f);const original=attempts()[0].request.request_id;
 globalThis.fetch=async()=>({ok:false,status:409,headers:{get:()=> 'application/json'},json:async()=>({error:{code:'EXPERIMENT_REMOVED',message:'原实验已被清理，不会重新创建'}})});
 await invoke(f);assert.match(f.error.textContent,/已被清理/);assert.equal(attempts()[0].request.request_id,original);
 const html=experimentRecoveryPanel([]);assert.match(html,/最近一次请求被拒绝/);assert.match(html,/原实验已被清理/);assert.equal(navigations.length,0);
});

test('twenty unavailable-scope receipts remain explicitly manageable without any replay',async()=>{
 const f=new Form();
 for(let i=0;i<20;i++){f.fields.set('name','原范围未确认'+i);fault='network';await invoke(f);}
 const original=attempts()[0],recordCount=records.size;
 state.identity='new-identity';state.active='new-dataset';state.datasets=[{id:'new-dataset',version:1,content_hash:'b'.repeat(64),payload:{company:'新企业'}}];invalidateContext();
 const panel=experimentRecoveryPanel([]);assert.match(panel,/manage-experiment-requests/);assert(!panel.includes('原范围未确认'));assert(!panel.includes('data-experiment-retry'));
 await click({target:new Button('manage-experiment-requests')});assert.equal(dialogs.length,1);const manager=dialogs[0].html;assert.match(manager,/原范围未确认0/);assert.match(manager,/原数据 v1/);assert.match(manager,/原服务身份已不可用/);assert.match(manager,/原企业已不可用/);assert(!manager.includes('type="submit"'));assert(!manager.includes('data-experiment-retry'));
 assert.throws(()=>forgetExperimentAttempt(original.request.request_id),/不属于当前管理范围/);
 const holder={dataset:{experimentManagement:'true',owner:'owner-a'},remove(){this.removed=true;}};
 await click({target:new Button('forget-experiment-request',original.request.request_id,holder)});assert.equal(holder.removed,true);assert.equal(calls.length,20);assert.equal(records.size,recordCount);assert.equal(attempts().length,19);
 const next=new Form({dataset_id:'new-dataset'});await invoke(next);assert.equal(calls.length,21);assert.equal(records.size,recordCount+1);
});

test('receipt manager cannot cross accounts or end an in-flight request',async()=>{
 let release;hold=new Promise(resolve=>release=resolve);const f=new Form(),work=invoke(f);const id=attempts()[0].request.request_id;
 assert.throws(()=>forgetExperimentAttempt(id,'owner-a'),/仍在提交/);assert.equal(attempts().length,1);
 fault='network';release();await work;hold=null;
 state.user={id:'owner-b'};invalidateContext();assert(!experimentAttemptManager().includes(id));assert.throws(()=>forgetExperimentAttempt(id,'owner-a'),/账户已变化/);
 state.user={id:'owner-a'};state.datasets=[];invalidateContext();forgetExperimentAttempt(id,'owner-a');assert.equal(attempts().length,0);assert.equal(records.size,1);assert.equal(calls.length,1);
});

test('integrity rejection keeps the uncertain receipt and never presents recovered success',async()=>{
 const f=new Form();fault='network';await invoke(f);const id=attempts()[0].request.request_id;
 globalThis.fetch=async()=>({ok:false,status:409,headers:{get:()=> 'application/json'},json:async()=>({error:{code:'EXPERIMENT_INTEGRITY',message:'原实验的创建凭据、冻结输入或结果无法核验'}})});
 await invoke(f);assert.match(f.error.textContent,/无法核验/);assert.equal(attempts()[0].request.request_id,id);assert.equal(navigations.length,0);assert.equal(f.dataset.saved,undefined);assert.equal(f.button.disabled,false);
});
