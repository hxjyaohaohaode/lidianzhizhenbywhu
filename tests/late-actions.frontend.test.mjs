/** Complete compiled production listeners and render/navigation/refresh/archive continuations.
 * Explicit DOM, view and transport doubles only: no browser, server, socket or provider.
 * A render executes the real shell replacement and disconnects the old input node.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {api,workspace,ApiError,setCsrf,contextGuard,invalidateContext,invalidateView} from '../web/dist/api.js';
import {interactionGuard,invalidateInteractions,continuationGuard,invalidateInputs,finishMutation} from '../web/dist/interactions.js';
import * as components from '../web/dist/components.js';

const app=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
const experience=readFileSync(new URL('../web/dist/experience.js',import.meta.url),'utf8');
function section(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);assert(a>=0&&b>a,`${start} -> ${end}`);return text.slice(a,b);}
const serviceSource=section(experience,"document.addEventListener('click',","document.addEventListener('submit',");
const source=[
 section(app,'function theme()', 'function download('),
 section(app,'function safeToLeave()', '// Used after'),
 section(app,'function shell()', 'async function bootstrap('),
 section(app,'async function bootstrap(', 'async function refreshData('),
 section(app,'async function refreshData(', 'function resetAuth('),
 section(app,"document.addEventListener('click',", "document.querySelector('.skip-link')"),
 section(app,"window.addEventListener('hashchange',", "window.addEventListener('beforeunload',"),
 section(app,'async function showArchive(', 'setInterval('),
 section(app,'setupExperience({', 'restoreMotion('),
].join('\n');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const response=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
const success=()=>response({ok:true});
const failure=()=>response({error:{message:'旧动作版本冲突',code:'VERSION_CONFLICT'}},409);
const dataset={id:'dataset-old',version:9,payload:{company:'测试企业',name:'测试数据',periods:[]}};
const user={id:'owner-old',name:'测试用户',version:5,preferences:{theme:'light',role:'enterprise'}};
const dataHTML='<form id="dataset-editor"><input id="draft" name="company" value="已保存值"></form>';
const actionRoutes={'delete-dataset':'data','delete-evidence':'evidence','toggle-memory':'memory','delete-memory':'memory','pause-run':'agents:run-old','resume-run':'agents:run-old','delete-strategy':'evolution','delete-evaluation':'evolution','cancel-plan':'agents:plan-old','cancel-run':'agents:run-old','delete-template':'agents','delete-conversation':'ops','archive-delete':'settings','refresh':'ops','sync-refresh':'ops','data-quality':'data','data-lineage':'data','data-revisions':'data','assessment-dialog':'agents:run-old','node-details':'agents:run-old','archive-dialog':'settings','action-detail':'actions','restore-revision':'data','strategy-propose':'evolution','identity-delete':'services','watch-toggle':'tracking','watch-delete':'tracking','alert-archive':'tracking'};
const serviceActions=new Set(['identity-delete','watch-toggle','watch-delete','alert-archive']);

function harness(action,{holdRefresh=false,holdArchive=false,holdRead=false,syncPending=false,confirmResult=true,bootstrapRetry=false,initialRoute,viewReadPath}={}){
 invalidateContext();invalidateInteractions();setCsrf('late-actions-test-csrf');
 const write=deferred(),writeStarted=deferred(),preflight=deferred(),preflightStarted=deferred(),refresh=deferred(),refreshStarted=deferred(),archive=deferred(),archiveStarted=deferred(),read=deferred(),readStarted=deferred();
 const calls={requests:[],renders:0,toasts:[],notices:0,confirms:0,dialogs:0,resets:0};
 const startRoute=initialRoute??actionRoutes[action];
 const state={user:structuredClone(user),datasets:[structuredClone(dataset)],identities:[],identity:action==='identity-delete'?'record-old':'',active:dataset.id,dirty:false,route:startRoute.split(':')[0],id:startRoute.split(':').slice(1).join(':'),cache:{memories:[{id:'record-old',version:8,payload:{text:'旧记忆',approved:false}}],run:{id:'record-old'},actions:[{id:'record-old'}],nodes:[{id:'record-old',label:'节点',purpose:'说明',engine:'local'}],evolution:{active:{version:7}}}};
 class Node{
  constructor(id=''){this.id=id;this.dataset={};this.open=false;this.disabled=false;this.isConnected=true;this.textContent='';this._html='';this.attributes={};this.events={};this.classList={toggle(){}};}
  set innerHTML(html){
   this._html=html;if(this.field)this.field.isConnected=false;
   const form={id:'dataset-editor',rows:[],scrollIntoView(){},contains(row){return this.rows.includes(row);}};
   const row=()=>({remove(){form.rows.splice(form.rows.indexOf(this),1);}});form.rows.push(row());
   const rows={insertAdjacentHTML(){form.rows.push(row());}};
   form.querySelector=selector=>selector==='#period-rows'?rows:null;form.querySelectorAll=()=>form.rows;
   this.field=html.includes('id="draft"')?{id:'draft',name:'company',value:'已保存值',isConnected:true,focus(){},closest:selector=>selector==='form'?form:null}:null;
   form.elements={namedItem:name=>name==='query'?this.field:null};this.form=this.field?form:null;
   if(this.id==='modal')calls.dialogs++;
   if(this.id==='app'){if(main){main.isConnected=false;if(main.field)main.field.isConnected=false;}main=new Node('main');calls.renders++;}
  }
  get innerHTML(){return this._html;}
  querySelector(selector){return selector==='#draft'?this.field:null;}
  querySelectorAll(){return [];}
  showModal(){this.open=true;}close(){this.open=false;}
  setAttribute(k,v){this.attributes[k]=v;if(k==='disabled')this.disabled=true;}
  removeAttribute(k){delete this.attributes[k];if(k==='disabled')this.disabled=false;}
  addEventListener(name,fn){this.events[name]=fn;}
  insertAdjacentHTML(){}replaceChildren(){this.innerHTML='';}
 }
 class Button extends Node{constructor(dataset,form,row){super();this.dataset={...dataset};this.form=form;this.row=row;}closest(selector){if(selector==='form')return this.form??this;if(selector==='[data-period-row]')return this.row??this;return this;}}
 let main=new Node('main');main.innerHTML=dataHTML;
 const root=new Node('app'),modal=new Node('modal'),inspector=new Node('inspector');
 const listeners={},windowListeners={};let productionHooks;
 const document={documentElement:{dataset:{}},title:'',addEventListener:(name,fn)=>listeners[name]=fn,querySelector:selector=>({'#app':root,'#main':main,'#modal':modal,'#inspector':inspector,'#plan-form':main.form,'#plan-form [name="query"]':main.field}[selector]??null),querySelectorAll:()=>[]};
 const confirm=()=>{calls.confirms++;return confirmResult;};
 const window={confirm,addEventListener:(name,fn)=>windowListeners[name]=fn};
 let hash='#'+startRoute;const location={get hash(){return hash;},set hash(v){hash=v.startsWith('#')?v:'#'+v;}};
 const noop=()=>{},view=async()=>dataHTML;
 const readView=async()=>{if(viewReadPath)await api(viewReadPath);return dataHTML;};
 const routes=Object.fromEntries(['brief','copilot','services','tracking','agents','data','evidence','lab','compare','reports','actions','memory','ops','settings','evolution'].map(id=>[id,{label:id,icon:'database',section:'工作区'}]));
 const env={...components,document,root,modal,inspector,window,location,state,routes,roleNames:{enterprise:'企业分析'},HTMLButtonElement:Button,
  api,workspace,ApiError,setCsrf,contextGuard,invalidateContext,invalidateView,interactionGuard,invalidateInteractions,continuationGuard,invalidateInputs,finishMutation,
  confirm,history:{replaceState:noop},scopedDatasets:()=>state.datasets,activeDataset:()=>state.datasets.find(d=>d.id===state.active),activeIdentity:()=>null,
  setupExperience:hooks=>{productionHooks=hooks;},restoreIdentity:noop,navigateRendered:noop,periodRow:()=>'<div data-period-row></div>',
  loadLayout:noop,applyLayout:noop,closeDrawers:noop,assistantShell:()=>'',mountCopilot:async()=>{},setupLive:noop,appearancePanel:()=>'',workflowGuide:()=>'',
  syncExperimentControls:noop,syncComparisonControls:noop,
  briefPage:view,copilotPage:view,servicesPage:view,trackingPage:view,agentsPage:readView,dataPage:view,evidencePage:view,labPage:view,comparePage:view,reportsPage:readView,actionsPage:view,memoryPage:view,opsPage:view,settingsPage:view,evolutionPage:view,
  datasetEditor:()=>dataHTML,strategyForm:()=>dataHTML,qualityPanel:()=>'<p>质量信息</p>',revisionHistory:()=>'<p>修订信息</p>',assessmentForm:()=>'<p>验收信息</p>',actionDetail:()=>'<p>行动详情</p>',
  toast:(...args)=>calls.toasts.push(args),showSyncNotice:()=>calls.notices++,auth:()=>{root.innerHTML='<main>登录</main>';},resetAuth:()=>{calls.resets++;invalidateContext();state.user=null;}
 };
 const control=new Function(...Object.keys(env),`let live=null,renderEpoch=0,currentHash="",signingUp=false,syncPending=${syncPending};`+source+'return {render,refreshData,dialog,inspect,readSync:()=>syncPending};')(...Object.values(env));
 const oldFetch=globalThis.fetch;
 globalThis.fetch=(url,options)=>{
  calls.requests.push({url,method:options.method,headers:options.headers,body:options.body===undefined?null:JSON.parse(options.body)});
  if(options.method!=='GET'){writeStarted.resolve();return write.promise;}
  if(bootstrapRetry&&url==='/api/auth/me')return Promise.resolve(response({user:structuredClone(user),csrf:'bootstrap-installed-test-csrf'}));
  if(url.endsWith('/runtime')){preflightStarted.resolve();return preflight.promise;}
  if(url==='/api/workspace/archive'){archiveStarted.resolve();return holdArchive?archive.promise:Promise.resolve(response({notice:'测试归档',collections:{}}));}
  if(['/api/datasets','/api/capabilities','/api/services/identities','/api/auth/me'].includes(url)){
   refreshStarted.resolve();const value=url==='/api/auth/me'?{user:{...structuredClone(user),version:6},csrf:'late-actions-test-csrf'}:url==='/api/datasets'?{items:[{...structuredClone(dataset),version:10}]}:{items:[]};
   return holdRefresh?refresh.promise.then(result=>result instanceof Response?result.clone():response(value)):Promise.resolve(response(value));
  }
  readStarted.resolve();return holdRead?read.promise:Promise.resolve(response({items:[],review_context:{},control:{version:4},trace:[],artifacts:[]}));
 };
 const appClick=listeners.click;
 const click=target=>appClick({target,preventDefault(){}});
 let button=new Button({action,id:'record-old',version:'8',kind:'plan',revision:'2'}),doClick=()=>click(button);
 if(serviceActions.has(action)){
  state.cache.tracking={rules:[{id:'record-old',version:8,payload:{title:'跟踪',identity_id:'',dataset_id:dataset.id,metric:'gross_margin',operator:'lt',threshold:.2,stale_after_days:180,expires_at:null,active:false}}]};
  const hooks=productionHooks;assert.equal(typeof hooks.requestRefresh,'function');
  const serviceEnv={...env,hooks};new Function(...Object.keys(serviceEnv),serviceSource)(...Object.values(serviceEnv));
  const listener=listeners.click;button=new Button({xAction:action,id:'record-old',version:'8'});
  doClick=()=>listener({target:button,preventDefault(){},stopImmediatePropagation(){}});
 }
 const edit=async(field,event='input')=>{field.value='新的未保存草稿';await listeners[event]({target:field});return field;};
 return {state,calls,write,writeStarted,preflight,preflightStarted,refresh,refreshStarted,archive,archiveStarted,read,readStarted,button,modal,inspector,control,
  get main(){return main;},get draft(){return main.field;},get hash(){return location.hash;},restore:()=>globalThis.fetch=oldFetch,
  click:doClick,action:a=>click(new Button({action:a})),allowRefresh:()=>{holdRefresh=false;},allowRead:()=>{holdRead=false;},
  async programmaticEdit(action){
   state.cache.templates=[{id:'template-old',payload:{query:'程序填入的草稿',mode:'balanced',success_criteria:'可核对'}}];
   const form=main.form,field=main.field;await click(new Button({action,id:'template-old',query:'程序填入的草稿'},form,form.rows[0]));return {form,field};
  },
  async transition(kind){
   if(kind==='navigation'){await click(new Button({route:state.route==='data'?'memory':'data'}));windowListeners.hashchange();await tick();return edit(main.field);}
   if(kind==='new-dialog'){await click(new Button({action:'new-dataset'}));return edit(modal.field);}
   if(kind==='input'||kind==='change')return edit(main.field,kind);
   if(kind==='close'){await click(new Button({action:'close-modal'}));return null;}
   if(kind==='escape'){modal.events.cancel();modal.close();return null;}
   if(kind==='context'){invalidateContext();invalidateInteractions();state.user={...structuredClone(user),id:'owner-new'};state.identity='identity-new';state.datasets=[{...structuredClone(dataset),id:'dataset-new',version:77}];return null;}
   throw new Error('Unknown transition '+kind);
  },
  async startWrite(){const pending=doClick();if(['pause-run','resume-run'].includes(action)){await preflightStarted.promise;preflight.resolve(response({control:{version:4}}));}await writeStarted.promise;return {pending};},
 };
}
const writes=h=>h.calls.requests.filter(r=>r.method!=='GET');
const reads=h=>h.calls.requests.filter(r=>r.method==='GET');
const rateMessage='请求过于频繁，本次请求已被暂时拒绝。请等待 2 秒后再手动重试；期间其他请求可能占用可用名额。';
const rateFailure=()=>response({error:{code:'RATE_LIMITED',message:rateMessage,retry_after_seconds:2},request_id:'rate-test'},429,{'Retry-After':'2'});
const register=(name,fn)=>test(name,{timeout:5000},fn);
const withHarness=(action,options,fn)=>async()=>{const h=harness(action,options);try{await fn(h);}finally{h.restore();}};
function assertDraft(h,draft){assert.equal(draft.isConnected,true);assert.equal(draft.value,'新的未保存草稿');assert.equal(h.state.dirty,true);}
function assertLateError(h){assert.equal(h.calls.toasts.length,1);assert.match(h.calls.toasts[0][0],/^先前的.+未确认完成：/);assert.equal(h.calls.toasts[0][1],true);assert.doesNotMatch(h.calls.toasts[0][0],/已保存|已删除|已完成/);}
function assertReleased(h){assert.equal(h.button.dataset.pending,undefined);assert.equal(h.button.attributes['aria-busy'],undefined);}
function assertSavedNotice(h){assert.equal(h.control.readSync(),true);assert.match(h.calls.toasts.map(t=>t[0]).join('\n'),/已.*(?:完成|删除|保存|暂停|继续|取消|更新|恢复|批准|撤回).*|已完成/);assert.match(h.calls.toasts.map(t=>t[0]).join('\n'),/保留|同步|刷新|核对/);}

for(const [route,path] of [['agents:run-original','/workspace/runs/original/reviews'],['reports:20','/workspace/reports?offset=20&limit=20']])register(`429: complete production render retains ${route} and manual reread uses GET only`,withHarness('refresh',{initialRoute:route,viewReadPath:path,holdRead:true},async h=>{
 const pending=h.control.render();await h.readStarted.promise;h.read.resolve(rateFailure());await pending;
 assert.equal(h.hash,'#'+route);assert.equal(h.state.id,route.split(':')[1]);
 assert(h.main.innerHTML.includes('读取未完成'));assert(h.main.innerHTML.includes(rateMessage));
 assert(h.main.innerHTML.includes('data-action="refresh"'));assert(h.main.innerHTML.includes('重新读取'));
 assert.equal(reads(h).length,1);assert.equal(writes(h).length,0);assert.equal(h.calls.resets,0);
 await tick();assert.equal(h.calls.requests.length,1,'429 never schedules a transport replay');
 h.allowRead();await h.click();
 assert.equal(h.hash,'#'+route);assert.equal(h.state.id,route.split(':')[1]);
 assert.equal(writes(h).length,0);assert.equal(reads(h).length,6);
 assert.deepEqual(reads(h).map(r=>r.url),['/api'+path,'/api/datasets','/api/capabilities','/api/services/identities','/api/auth/me','/api'+path]);
 assert.equal(h.main.innerHTML,dataHTML);assert(!h.main.innerHTML.includes('读取未完成'));assertReleased(h);
}));

register('429: earlier render rejection cannot replace a newer page or draft',withHarness('refresh',{initialRoute:'agents:run-original',viewReadPath:'/workspace/runs/original/reviews',holdRead:true},async h=>{
 const pending=h.control.render();await h.readStarted.promise;const draft=await h.transition('navigation'),html=h.main.innerHTML,renders=h.calls.renders;
 h.read.resolve(rateFailure());await pending;
 assert.equal(h.hash,'#data');assert.equal(h.main.innerHTML,html);assert.equal(h.calls.renders,renders);assertDraft(h,draft);
 assert.equal(h.calls.requests.length,1);assert.equal(writes(h).length,0);assert.deepEqual(h.calls.toasts,[]);
}));

for(const action of ['refresh','sync-refresh'])for(const transition of ['current','navigation','new-dialog','input','change','context'])register(`${action}: 429 preserves current or newer draft after ${transition}`,withHarness(action,{holdRefresh:true,syncPending:true},async h=>{
 const original=h.draft;original.value='未保存原草稿';h.state.dirty=true;
 const pending=h.click();await h.refreshStarted.promise;const draft=transition==='current'?original:await h.transition(transition),renders=h.calls.renders,metadata=h.state.datasets,owner=h.state.user;
 h.refresh.resolve(rateFailure());await pending;await tick();
 assert.equal(writes(h).length,0);assert.equal(reads(h).length,4);assert.equal(h.calls.renders,renders);
 assert.equal(h.state.datasets,metadata);assert.equal(h.state.user,owner);assert.equal(h.control.readSync(),true);assert.equal(h.calls.resets,0);
 if(transition==='current'){assert.equal(original.isConnected,true);assert.equal(original.value,'未保存原草稿');assert.equal(h.state.dirty,true);}
 else if(draft)assertDraft(h,draft);
 if(transition==='context')assert.deepEqual(h.calls.toasts,[]);else assert(h.calls.toasts[0][0].includes(rateMessage));
 assertReleased(h);
}));

for(const [action,method] of [['strategy-propose','POST'],['toggle-memory','PUT'],['delete-memory','DELETE']])for(const transition of ['current','input','navigation','context'])register(`${method}: 429 is refused once and never becomes saved success after ${transition}`,withHarness(action,{},async h=>{
 const {pending}=await h.startWrite();await h.click();const draft=transition==='current'?null:await h.transition(transition),renders=h.calls.renders;
 h.write.resolve(rateFailure());await pending;await tick();
 assert.equal(writes(h).length,1);assert.equal(writes(h)[0].method,method);assert.equal(h.calls.renders,renders);assert.equal(h.control.readSync(),false);
 if(draft)assertDraft(h,draft);
 if(transition==='context')assert.deepEqual(h.calls.toasts,[]);else{assert(h.calls.toasts[0][0].includes(rateMessage));assert.doesNotMatch(h.calls.toasts[0][0],/已保存|已删除|已完成/);}
 assertReleased(h);
}));
const expectedWrites={
 'delete-dataset':['DELETE','/api/datasets/record-old?version=8',null],
 'delete-evidence':['DELETE','/api/evidence/record-old?version=8',null],
 'toggle-memory':['PUT','/api/memories/record-old',{text:'旧记忆',approved:true,version:8}],
 'delete-memory':['DELETE','/api/memories/record-old?version=8',null],
 'pause-run':['POST','/api/workspace/runs/record-old/control',{version:4,action:'pause'}],
 'resume-run':['POST','/api/workspace/runs/record-old/control',{version:4,action:'resume'}],
 'delete-strategy':['DELETE','/api/workspace/strategies/record-old?version=8',null],
 'delete-evaluation':['DELETE','/api/workspace/strategy-evaluations/record-old?version=8',null],
 'cancel-plan':['POST','/api/workspace/plans/record-old/cancel?version=8',{}],
 'cancel-run':['POST','/api/runs/record-old/cancel',{}],
 'delete-template':['DELETE','/api/workspace/templates/record-old?version=8',null],
 'delete-conversation':['DELETE','/api/conversations/record-old?version=8',null],
 'identity-delete':['DELETE','/api/services/identities/record-old?version=8',null],
};
for(const action of Object.keys(expectedWrites)){
 register(`${action}: current success preserves transport, version, CSRF and duplicate suppression`,withHarness(action,{},async h=>{
  const {pending}=await h.startWrite();await h.click();h.write.resolve(success());await pending;
  assert.equal(writes(h).length,1);const request=writes(h)[0];assert.deepEqual([request.method,request.url,request.body],expectedWrites[action]);
  assert.equal(request.headers['X-CSRF-Token'],'late-actions-test-csrf');assert.equal(h.calls.renders,1);assert.equal(h.control.readSync(),false);assertReleased(h);
  if(action==='identity-delete')assert.equal(h.state.identity,'');
 }));
 for(const transition of ['navigation','new-dialog','input','change','context'])for(const failed of [false,true])register(`${action}: ${failed?'rejected':'confirmed'} write after ${transition} preserves ownership`,withHarness(action,{},async h=>{
  const {pending}=await h.startWrite();const draft=await h.transition(transition),renders=h.calls.renders,readCount=reads(h).length,html=h.modal.innerHTML,owner=h.state.user,metadata=h.state.datasets,identity=h.state.identity;
  h.write.resolve(failed?failure():success());await pending;
  assert.equal(writes(h).length,1);assert.equal(h.calls.renders,renders);assert.equal(reads(h).length,readCount);assert.equal(h.state.user,owner);assert.equal(h.state.datasets,metadata);assert.equal(h.state.identity,identity);assert.equal(h.calls.resets,0);assertReleased(h);
  if(draft)assertDraft(h,draft);if(transition==='new-dialog'){assert.equal(h.modal.open,true);assert.equal(h.modal.innerHTML,html);}
  if(transition==='context'){assert.deepEqual(h.calls.toasts,[]);assert.equal(h.control.readSync(),false);}else if(failed){assertLateError(h);assert.match(h.calls.toasts[0][0],/旧动作版本冲突/);assert.equal(h.control.readSync(),false);}else assertSavedNotice(h);
 }));
 for(const network of [false,true])register(`${action}: current ${network?'unknown network outcome':'version rejection'} is never claimed saved or retried`,withHarness(action,{},async h=>{
  const {pending}=await h.startWrite();if(network)h.write.reject(new TypeError('isolated transport failure'));else h.write.resolve(failure());await pending;
  assert.equal(writes(h).length,1);assert.equal(h.calls.renders,0);assert.equal(h.control.readSync(),false);assert.equal(h.calls.toasts.length,1);assert.equal(h.calls.toasts[0][1],true);
  assert.doesNotMatch(h.calls.toasts[0][0],/已保存|已删除|已完成/);assertReleased(h);
 }));
}

for(const action of ['pause-run','resume-run'])for(const transition of ['navigation','new-dialog','input','change','context'])register(`${action}: ${transition} during runtime pre-read prevents control dispatch`,withHarness(action,{},async h=>{
 const pending=h.click();await h.preflightStarted.promise;await h.click();const draft=await h.transition(transition),renders=h.calls.renders;
 h.preflight.resolve(response({control:{version:4}}));h.write.resolve(success());await pending;
 assert.equal(writes(h).length,0);assert.equal(h.calls.requests.filter(r=>r.url.endsWith('/runtime')).length,1);assert.equal(h.calls.renders,renders);assert.deepEqual(h.calls.toasts,[]);assert.equal(h.control.readSync(),false);if(draft)assertDraft(h,draft);assertReleased(h);
}));

for(const action of ['delete-dataset','identity-delete'])for(const transition of ['navigation','new-dialog','input','change','context'])for(const failed of [false,true])register(`${action}: ${failed?'failed':'successful'} staged refresh after ${transition} cannot publish`,withHarness(action,{holdRefresh:true},async h=>{
 const {pending}=await h.startWrite();h.write.resolve(success());await h.refreshStarted.promise;const draft=await h.transition(transition),renders=h.calls.renders,metadata=h.state.datasets,owner=h.state.user;
 if(failed)h.refresh.reject(new TypeError('isolated refresh failure'));else h.refresh.resolve();await pending;
 assert.equal(writes(h).length,1);assert.equal(h.calls.renders,renders);assert.equal(h.state.datasets,metadata);assert.equal(h.state.user,owner);assert.equal(h.calls.resets,0);if(draft)assertDraft(h,draft);assertReleased(h);
 if(transition==='context'){assert.deepEqual(h.calls.toasts,[]);assert.equal(h.control.readSync(),false);}else assertSavedNotice(h);
}));
for(const action of ['delete-dataset','identity-delete'])register(`${action}: known save survives a current refresh failure without repeating the write`,withHarness(action,{holdRefresh:true},async h=>{
 const {pending}=await h.startWrite();h.write.resolve(success());await h.refreshStarted.promise;h.refresh.reject(new Error('isolated refresh failure'));await pending;
 assert.equal(writes(h).length,1);assert.equal(h.calls.renders,0);assertSavedNotice(h);assert.match(h.calls.toasts[0][0],/无需重复|不会.*重复/);assertReleased(h);
 h.allowRefresh();await h.action('sync-refresh');assert.equal(writes(h).length,1);assert.equal(h.calls.renders,1);assert.equal(h.control.readSync(),false);assert.equal(h.state.datasets[0].version,10);
}));

register('archive-delete: current completion refreshes its archive and suppresses duplicate deletes',withHarness('archive-delete',{},async h=>{
 h.modal.open=true;const {pending}=await h.startWrite();await h.click();h.write.resolve(success());await pending;
 assert.equal(writes(h).length,1);assert.deepEqual([writes(h)[0].method,writes(h)[0].url],['DELETE','/api/workspace/archive/plan/record-old?version=8']);assert.equal(writes(h)[0].headers['X-CSRF-Token'],'late-actions-test-csrf');assert.equal(h.modal.open,true);assert.match(h.modal.innerHTML,/管理已保存记录/);assert.equal(h.control.readSync(),false);assertReleased(h);
}));
for(const transition of ['close','escape','navigation','new-dialog','input','change','context'])for(const failed of [false,true])register(`archive-delete: ${failed?'rejection':'confirmation'} after ${transition} cannot acquire a new dialog`,withHarness('archive-delete',{},async h=>{
 h.modal.open=true;h.modal.innerHTML='<p>旧归档</p>';const {pending}=await h.startWrite();const draft=await h.transition(transition),html=h.modal.innerHTML,open=h.modal.open,renders=h.calls.renders;
 h.write.resolve(failed?failure():success());await pending;assert.equal(writes(h).length,1);assert.equal(h.calls.requests.filter(r=>r.url==='/api/workspace/archive').length,0);assert.equal(h.modal.innerHTML,html);assert.equal(h.modal.open,open);assert.equal(h.calls.renders,renders);if(draft)assertDraft(h,draft);assertReleased(h);
 if(transition==='context')assert.deepEqual(h.calls.toasts,[]);else if(failed)assertLateError(h);else assertSavedNotice(h);
}));
for(const transition of ['close','new-dialog','navigation','input','context'])register(`archive-delete: ${transition} during archive refresh preserves the new view`,withHarness('archive-delete',{holdArchive:true},async h=>{
 h.modal.open=true;const {pending}=await h.startWrite();h.write.resolve(success());await h.archiveStarted.promise;const draft=await h.transition(transition),html=h.modal.innerHTML,open=h.modal.open,renders=h.calls.renders;
 h.archive.resolve(response({notice:'旧归档响应',collections:{}}));await pending;assert.equal(h.modal.innerHTML,html);assert.equal(h.modal.open,open);assert.equal(h.calls.renders,renders);assert.equal(writes(h).length,1);if(draft)assertDraft(h,draft);
 if(transition==='context')assert.deepEqual(h.calls.toasts,[]);else assertSavedNotice(h);
}));
register('archive-delete: failed archive refresh keeps the confirmed deletion and allows manual recovery',withHarness('archive-delete',{holdArchive:true},async h=>{
 h.modal.open=true;h.modal.innerHTML='<p>旧归档</p>';const {pending}=await h.startWrite();h.write.resolve(success());await h.archiveStarted.promise;h.archive.reject(new Error('isolated archive failure'));await pending;
 assert.equal(writes(h).length,1);assert.equal(h.modal.open,true);assert.equal(h.modal.innerHTML,'<p>旧归档</p>');assert.equal(h.calls.renders,0);assertSavedNotice(h);assert.match(h.calls.toasts[0][0],/无需重复|不会.*重复/);assertReleased(h);
}));

for(const action of ['refresh','sync-refresh']){
 register(`${action}: current successful read publishes once and releases pending sync`,withHarness(action,{holdRefresh:true,syncPending:true},async h=>{
  const pending=h.click();await h.refreshStarted.promise;await h.click();h.refresh.resolve();await pending;assert.equal(writes(h).length,0);assert.equal(reads(h).length,4);assert.equal(h.state.datasets[0].version,10);assert.equal(h.state.user.version,6);assert.equal(h.calls.renders,1);assert.equal(h.control.readSync(),false);assertReleased(h);
 }));
 for(const transition of ['navigation','new-dialog','input','change','context'])for(const failed of [false,true])register(`${action}: ${failed?'failed':'successful'} late read after ${transition} preserves drafts and staged state`,withHarness(action,{holdRefresh:true,syncPending:true},async h=>{
  const pending=h.click();await h.refreshStarted.promise;const draft=await h.transition(transition),renders=h.calls.renders,metadata=h.state.datasets,owner=h.state.user;
  if(failed)h.refresh.reject(new TypeError('isolated refresh failure'));else h.refresh.resolve();await pending;
  assert.equal(writes(h).length,0);assert.equal(reads(h).length,4);assert.equal(h.calls.renders,renders);assert.equal(h.state.datasets,metadata);assert.equal(h.state.user,owner);assert.equal(h.calls.resets,0);assert.equal(h.control.readSync(),true);if(failed&&transition!=='context')assertLateError(h);else assert.deepEqual(h.calls.toasts,[]);if(draft)assertDraft(h,draft);assertReleased(h);
 }));
 register(`${action}: declined unsaved-input confirmation starts no request`,withHarness(action,{confirmResult:false,syncPending:true},async h=>{
  h.state.dirty=true;h.draft.value='保留未提交输入';await h.click();assert.equal(h.calls.requests.length,0);assert.equal(h.calls.renders,0);assert.equal(h.draft.value,'保留未提交输入');assert.equal(h.state.dirty,true);assert.equal(h.control.readSync(),true);assertReleased(h);
 }));
}

const readActions=['data-quality','data-lineage','data-revisions','assessment-dialog','node-details','archive-dialog','action-detail'];
for(const action of readActions)for(const transition of ['current','navigation','new-dialog','input','context'])for(const failed of [false,true])register(`${action}: ${failed?'failed':'successful'} adjacent detail read with ${transition}`,withHarness(action,{holdRead:true,holdArchive:true},async h=>{
 const pending=h.click();await (action==='archive-dialog'?h.archiveStarted.promise:h.readStarted.promise);const draft=transition==='current'?null:await h.transition(transition),html=h.modal.innerHTML,renders=h.calls.renders,open=h.modal.open;
 (action==='archive-dialog'?h.archive:h.read).resolve(failed?failure():response(action==='archive-dialog'?{notice:'归档',collections:{}}:{items:[],review_context:{},artifacts:[]}));await pending;
 assert.equal(writes(h).length,0);assert.equal(h.calls.renders,renders);assertReleased(h);
 if(transition==='current'){if(failed){assert.equal(h.modal.open,false);assert.equal(h.inspector.open,false);assert.equal(h.calls.toasts.length,1);}else assert(h.modal.open||h.inspector.open);}
 else{assert.equal(h.modal.innerHTML,html);assert.equal(h.modal.open,open);assert.equal(h.inspector.open,false);if(failed&&transition!=='context')assertLateError(h);else assert.deepEqual(h.calls.toasts,[]);if(draft)assertDraft(h,draft);}
}));

for(const action of ['watch-toggle','watch-delete','alert-archive'])for(const transition of ['current','navigation','new-dialog','input','context'])for(const failed of [false,true])register(`${action}: adjacent service ${failed?'rejection':'success'} with ${transition}`,withHarness(action,{},async h=>{
 const {pending}=await h.startWrite();await h.click();const draft=transition==='current'?null:await h.transition(transition),renders=h.calls.renders;h.write.resolve(failed?failure():success());await pending;
 assert.equal(writes(h).length,1);assert.equal(writes(h)[0].headers['X-CSRF-Token'],'late-actions-test-csrf');assert.equal(h.calls.renders-renders,transition==='current'&&!failed?1:0);assertReleased(h);if(draft)assertDraft(h,draft);
 if(transition==='context')assert.deepEqual(h.calls.toasts,[]);else if(transition!=='current'&&failed)assertLateError(h);
 if(action==='watch-toggle')assert.deepEqual(writes(h)[0].body,{title:'跟踪',identity_id:'',dataset_id:dataset.id,metric:'gross_margin',operator:'lt',threshold:.2,stale_after_days:180,expires_at:null,active:true,version:8});
 else assert.match(writes(h)[0].url,/\?version=8$/);
}));
for(const action of ['restore-revision','strategy-propose'])for(const transition of ['current','navigation','new-dialog','input','context'])register(`${action}: adjacent confirmed mutation with ${transition}`,withHarness(action,{},async h=>{
 const {pending}=await h.startWrite();const draft=transition==='current'?null:await h.transition(transition),renders=h.calls.renders;h.write.resolve(success());await pending;
 assert.equal(writes(h).length,1);assert.equal(h.calls.renders-renders,transition==='current'?1:0);assertReleased(h);if(draft)assertDraft(h,draft);
 if(transition==='context')assert.deepEqual(h.calls.toasts,[]);else if(transition!=='current')assertSavedNotice(h);
 if(action==='restore-revision')assert.deepEqual(writes(h)[0].body,{version:9,target_revision:2});
}));

register('finishMutation waits for the async completion before reporting applied',async()=>{
 const applied=deferred();let settled=false,finished=false;const pending=finishMutation(()=>true,async()=>true,async()=>{await applied.promise;finished=true;}).then(value=>{settled=true;return value;});
 await tick();assert.equal(settled,false);assert.equal(finished,false);applied.resolve();assert.equal(await pending,true);assert.equal(finished,true);
});
register('finishMutation propagates a failed async completion instead of claiming it applied',async()=>{
 await assert.rejects(finishMutation(()=>true,async()=>true,async()=>{throw new Error('completion failed');}),/completion failed/);
});

for(const edit of ['fill-query','apply-template','add-period','remove-period'])register(`delete-dataset: programmatic ${edit} edit owns its current draft`,withHarness('delete-dataset',{},async h=>{
 const {pending}=await h.startWrite();const {form,field}=await h.programmaticEdit(edit);const renders=h.calls.renders;
 assert.equal(h.state.dirty,true);h.write.resolve(success());await pending;
 assert.equal(h.calls.renders,renders);assert.equal(h.main.form,form);assert.equal(field.isConnected,true);assert.equal(h.state.dirty,true);assert.equal(writes(h).length,1);assertSavedNotice(h);
 if(edit==='fill-query'||edit==='apply-template')assert.equal(field.value,'程序填入的草稿');else assert.equal(form.rows.length,edit==='add-period'?2:0);
}));

for(const replaced of [false,true])register(`unauthenticated refresh: bootstrap metadata failure ${replaced?'after account replacement is silent':'after installing its own CSRF remains visible'}`,withHarness('refresh',{holdRefresh:true,bootstrapRetry:true},async h=>{
 h.state.user=null;const pending=h.click();await h.refreshStarted.promise;
 assert.equal(h.state.user.id,'owner-old');if(replaced)await h.transition('context');const owner=h.state.user,metadata=h.state.datasets;
 h.refresh.reject(new TypeError('isolated bootstrap metadata failure'));await pending;
 assert.equal(writes(h).length,0);assert.equal(h.calls.renders,0);assert.equal(h.calls.resets,0);assert.equal(h.state.user,owner);assert.equal(h.state.datasets,metadata);assertReleased(h);
 assert.deepEqual(reads(h).map(r=>r.url),['/api/auth/me','/api/datasets','/api/capabilities','/api/services/identities']);
 if(replaced)assert.deepEqual(h.calls.toasts,[]);else{assert.equal(h.calls.toasts.length,1);assert.match(h.calls.toasts[0][0],/^工作区刷新未确认完成：.*无法连接服务/);assert.equal(h.calls.toasts[0][1],true);}
}));
