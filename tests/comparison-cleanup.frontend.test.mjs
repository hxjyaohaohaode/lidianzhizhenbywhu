/** Synthetic renderer/transport and production-handler bridge tests, not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {comparisonRemovalTarget,comparisonDeleteForm,savedComparisonList,savedComparisonPage,comparisonIndex,removeSavedComparison,refreshComparisonReferences,currentComparisonRead,syncComparisonControls,comparisonHistoryDeleteButton} from '../web/dist/saved-comparisons.js';
import {servicesPage} from '../web/dist/views-services.js';
import {agentsPage} from '../web/dist/views-studio.js';
import {state} from '../web/dist/state.js';
import {ApiError,contextGuard,invalidateContext,invalidateView} from '../web/dist/api.js';
import {interactionGuard,invalidateInteractions} from '../web/dist/interactions.js';
import {unchangedInputGuard} from '../web/dist/saved-experiments.js';
const datasets=['a','b'].map(id=>({id,version:1,content_hash:id.repeat(64),payload:{company:'合成企业'+id}}));
const row={id:'comparison/a&b',version:3,comparison_hash:'c'.repeat(64),created_at:'2026-10-01',source_impact:{state:'current'},payload:{identity_id:'identity & a',name:'合成已保存对照',period:'2026-Q2',comparison:'previous',members:datasets.map(d=>({id:d.id,version:d.version,hash:d.content_hash,company:d.payload.company})),result:{items:[]}}};
const other={...row,id:'comparison-other',payload:{...row.payload,name:'另一份原有对照'}};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const failure=(status=409,code='VERSION_CONFLICT')=>json({error:{message:'合成核对失败',code}},status);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function reset(){invalidateContext();invalidateView();invalidateInteractions();Object.assign(state,{user:{id:'synthetic-owner',preferences:{role:'enterprise'}},identity:row.payload.identity_id,active:'a',route:'compare',id:'',datasets:structuredClone(datasets),identities:[{id:row.payload.identity_id,payload:{dataset_ids:['a','b'],max_calls:0}}],cache:{comparison:structuredClone(row),comparisons:structuredClone([row,other]),planComparisons:structuredClone([row,other]),plans:[{id:'approved',payload:{status:'approved',snapshot:{comparison_artifact:row}}}],run:{result:{comparison_artifact:row}}},dirty:false});}
const target=()=>comparisonRemovalTarget(row.id,row.version,state.identity);
function withFetch(fn){const original=globalThis.fetch;globalThis.fetch=fn;return ()=>globalThis.fetch=original;}

test('cleanup is available for stale or current rows and discloses exact permanent scope safely',async()=>{
 reset();const malicious={...row,payload:{...row.payload,name:'<img src=x onerror=x>'}};
 const html=comparisonDeleteForm({...target(),name:malicious.payload.name});
 for(const text of ['2026-Q2','v3','对象 ID','删除后不可恢复','后续外发将停止','冻结内容','当前草稿','账户的对照记录容量','name="confirm_delete" required','data-action="close-modal"'])assert(html.includes(text),text);
 assert(!html.includes('<img src=x'));assert(html.includes('&lt;img'));
 for(const state of ['current','unavailable']){const list=savedComparisonList([{...malicious,source_impact:{state}}]);assert(list.includes('data-action="delete-comparison"'));assert(list.includes('data-version="3"'));assert(!list.includes('<img src=x'));}
 const restore=withFetch(async()=>json(row));try{const detail=await savedComparisonPage(row.id);assert(detail.includes('data-action="delete-comparison"'));assert(detail.includes('data-comparison-detail='));}finally{restore();}
});
test('the displayed version and identity are mandatory before dispatch, including default identity',()=>{
 reset();for(const [id,version,identity] of [[row.id,2,state.identity],[row.id,0,state.identity],[row.id,NaN,state.identity],[row.id,3,'other'],['missing',3,state.identity]])assert.throws(()=>comparisonRemovalTarget(id,version,identity));
 state.identity='';state.cache={comparison:{...row,payload:{...row.payload,identity_id:''}}};assert.equal(comparisonRemovalTarget(row.id,3,'').identityId,'');
});
test('confirmed delete sends one encoded exact-version DELETE and prunes only live caches',async()=>{
 reset();state.dirty=true;const history=JSON.stringify({plans:state.cache.plans,run:state.cache.run});let calls=0,applied=0;const t=target();const restore=withFetch(async(url,init)=>{calls++;const parsed=new URL(url,'https://synthetic.invalid');assert.equal(parsed.pathname,'/api/workspace/comparisons/comparison%2Fa%26b');assert.equal(parsed.searchParams.get('identity_id'),t.identityId);assert.equal(parsed.searchParams.get('version'),'3');assert.equal(init.method,'DELETE');return json({deleted:true});});
 try{assert.equal(await removeSavedComparison(t,()=>applied++),true);assert.equal(calls,1);assert.equal(applied,1);assert.equal(state.cache.comparison,undefined);for(const key of ['comparisons','planComparisons'])assert.deepEqual(state.cache[key].map(r=>r.id),[other.id]);assert.equal(JSON.stringify({plans:state.cache.plans,run:state.cache.run}),history);assert(state.dirty);}finally{restore();}
});
for(const kind of ['403','404','409','500','network','unknown-success'])test('failed or uncertain '+kind+' preserves all objects and releases the pending lock without retry',async()=>{
 reset();const before=JSON.stringify(state.cache),t=target();let calls=0,applied=0;const restore=withFetch(async()=>{calls++;if(kind==='network')throw new Error('offline');return kind==='unknown-success'?json({notice:'unconfirmed'}):failure(Number(kind));});
 try{await assert.rejects(removeSavedComparison(t,()=>applied++));assert.equal(calls,1);assert.equal(applied,0);assert.equal(JSON.stringify(state.cache),before);await assert.rejects(removeSavedComparison(t));assert.equal(calls,2,'only this explicit retry sends a second DELETE');}finally{restore();}
});
test('two independently rendered controls for the same object cannot dispatch twice',async()=>{
 reset();const wait=deferred(),t=target();let calls=0;const restore=withFetch(()=>{calls++;return wait.promise;});try{const first=removeSavedComparison(t);assert.equal(await removeSavedComparison({...t}),false);assert.equal(calls,1);wait.resolve(json({deleted:true}));assert.equal(await first,true);}finally{restore();}
});
for(const change of ['identity','account','logout'])test('late success after '+change+' never removes or publishes into the new scope',async()=>{
 reset();const wait=deferred(),t=target();let applied=0;const restore=withFetch(()=>wait.promise);try{const pending=removeSavedComparison(t,()=>applied++);invalidateContext();if(change==='identity')state.identity='other';else state.user=change==='logout'?null:{id:'another-owner'};state.cache={comparison:{id:'new-private'},comparisons:[{id:'new-private'}]};const later=JSON.stringify(state.cache);wait.resolve(json({deleted:true}));assert.equal(await pending,false);assert.equal(applied,0);assert.equal(JSON.stringify(state.cache),later);}finally{restore();}
});
for(const outcome of ['missing','still-present','read-failed','another-context'])test('dataset switch rechecks discarded outcome without another DELETE: '+outcome,async()=>{
 reset();const wait=deferred(),check=deferred(),t=target();const calls=[];let applied=0;const restore=withFetch((url,init)=>{calls.push(init.method);return init.method==='DELETE'?wait.promise:check.promise;});try{const pending=removeSavedComparison(t,()=>applied++);invalidateContext();invalidateInteractions();state.active='b';state.route='agents';state.dirty=true;wait.resolve(json({deleted:true}));await tick();assert.deepEqual(calls,['DELETE','GET']);if(outcome==='another-context'){invalidateContext();state.identity='new-identity';state.cache={comparisons:[other]};}
 check.resolve(outcome==='still-present'?json(row):outcome==='read-failed'?failure(500):failure(404,'NOT_FOUND'));assert.equal(await pending,outcome==='missing');assert.equal(applied,outcome==='missing'?1:0);assert.equal(state.route,'agents');assert.equal(state.active,'b');assert(state.dirty);if(outcome==='missing')assert(!state.cache.comparisons.some(r=>r.id===row.id));else if(outcome!=='another-context')assert(state.cache.comparisons.some(r=>r.id===row.id));}finally{restore();}
});

test('a pre-removal list GET finishing later is re-read before cache or markup is published',async()=>{
 reset();const wait=deferred();let reads=0;const restore=withFetch((url,init)=>init.method==='DELETE'?Promise.resolve(json({deleted:true})):(++reads===1?wait.promise:Promise.resolve(json({items:[other]}))));try{const pending=comparisonIndex();await removeSavedComparison(target());wait.resolve(json({items:[row,other]}));const html=await pending;assert.equal(reads,2);assert(!html.includes('合成已保存对照'));assert.deepEqual(state.cache.comparisons.map(r=>r.id),[other.id]);}finally{restore();}
});
test('a pre-removal detail GET is not revived when its re-read confirms absence',async()=>{
 reset();const wait=deferred();let reads=0;const restore=withFetch((url,init)=>init.method==='DELETE'?Promise.resolve(json({deleted:true})):(++reads===1?wait.promise:Promise.resolve(failure(404,'NOT_FOUND'))));try{const pending=savedComparisonPage(row.id);await removeSavedComparison(target());wait.resolve(json(row));await assert.rejects(pending,e=>e instanceof ApiError&&e.status===404);assert.equal(state.cache.comparison,undefined);assert.equal(reads,2);}finally{restore();}
});
test('Agent batch waits for all reads before considering comparisons current',async()=>{
 reset();const wait=deferred();let catalogReads=0,comparisonReads=0;const restore=withFetch(async(url,init)=>{if(init.method==='DELETE')return json({deleted:true});if(url.includes('/catalog'))return ++catalogReads===1?wait.promise:json({providers:[],capabilities:[]});if(url.includes('/comparisons?'))return json({items:++comparisonReads===1?[row,other]:[other]});return json({items:[],total:0});});try{const pending=agentsPage();await tick();await removeSavedComparison(target());wait.resolve(json({providers:[],capabilities:[]}));const html=await pending;assert.equal(comparisonReads,2);assert(!html.includes('合成已保存对照'));assert.deepEqual(state.cache.planComparisons.map(r=>r.id),[other.id]);}finally{restore();}
});
function selector(value){const select={value,options:[]};select.options=['',row.id,other.id].map(value=>({value,remove(){select.options=select.options.filter(o=>o!==this);}}));return select;}
test('targeted DOM cleanup restores the original mode and preserves other choices and drafts',()=>{
 reset();const select=selector(row.id),mode={value:'year_over_year',disabled:false,dataset:{}},details={innerHTML:''},text={value:'新草稿保持不变'},removed=[];const list=[row,other].map(r=>({dataset:{comparisonRecord:r.id},remove(){removed.push(r.id)}}));const form={querySelector:s=>({'#plan-comparison':select,'[name="comparison"]':mode,'#selected-comparison-details':details}[s]??null)};const root={querySelector:s=>({'#plan-form':form,'#plan-comparison':select,'#selected-comparison-details':details}[s]??null),querySelectorAll:s=>s==='[data-comparison-record]'?list:[]};syncComparisonControls(root,[row,other],datasets,state.identity);assert(mode.disabled);state.cache.planComparisons=[other];refreshComparisonReferences(root,target());assert.equal(select.value,'');assert.equal(mode.value,'year_over_year');assert.equal(mode.disabled,false);assert(details.innerHTML.includes('已取消'));assert.deepEqual(removed,[row.id]);assert.equal(text.value,'新草稿保持不变');assert.deepEqual(select.options.map(o=>o.value),['',other.id]);
 select.value=other.id;refreshComparisonReferences(root,target());assert.equal(select.value,other.id);
});

// Run the real compiled submit/input listeners with a small DOM bridge, rather
// than testing a handwritten copy of the cleanup handler.
const app=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
function handlerHarness(){
 const listeners={};const document={addEventListener:(name,fn)=>listeners[name]=fn};const submit={disabled:false};const error={textContent:'',isConnected:true};
 class Form{constructor(){this.id='comparison-delete-form';this.dataset={id:row.id,version:'3',identityId:row.payload.identity_id};this.isConnected=true;this.confirmed=true;}reportValidity(){return this.confirmed;}querySelector(s){return s==='.form-error'?error:submit;}}
 class Data extends FormData{constructor(form){super();if(form?.confirmed)this.set('confirm_delete','on');}}
 const read=form=>{const f=new Data(form);return {f,str:k=>String(f.get(k)??''),check:k=>f.has(k)};};
 const modal={open:true,closed:0,close(){this.open=false;this.closed++;}},toasts=[],routes=[],refreshes=[];
 const values={document,state,HTMLFormElement:Form,FormData:Data,read,contextGuard,interactionGuard,unchangedInputGuard,comparisonRemovalTarget,removeSavedComparison,refreshComparisonReferences:()=>refreshes.push('plan'),forgetCopilotComparison:()=>refreshes.push('copilot'),modal,toast:t=>toasts.push(t),navigate:r=>routes.push(r),ApiError};
 const source=app.slice(app.indexOf("document.addEventListener('submit',"),app.indexOf("document.addEventListener('click',"));
 new Function(...Object.keys(values),source)(...Object.values(values));
 const input=app.slice(app.indexOf("document.addEventListener('input',"),app.indexOf("document.addEventListener('change',"));new Function('document','state',input)(document,state);
 const form=new Form();return {form,submit,error,modal,toasts,routes,refreshes,input:el=>listeners.input({target:el}),submitForm:()=>listeners.submit({target:form,preventDefault(){}})};
}
test('production handler requires confirmation and leaves all business dirty state untouched',async()=>{
 reset();const h=handlerHarness();let calls=0;const restore=withFetch(async()=>{calls++;return json({deleted:true});});try{h.form.confirmed=false;await h.submitForm();assert.equal(calls,0);h.input({id:'',closest:()=>h.form});assert.equal(state.dirty,false,'confirmation checkbox is not a business draft');state.dirty=true;h.form.confirmed=true;await h.submitForm();assert.equal(calls,1);assert(state.dirty,'background save-form edits retain navigation protection');assert.equal(h.modal.closed,1);assert.deepEqual(h.refreshes,['plan','copilot']);assert.equal(h.submit.disabled,false);}finally{restore();}
});
for(const change of ['navigation','dismiss','new-dialog','edit-confirmation'])test('production completion does not close or navigate after '+change,async()=>{
 reset();state.route='compare';state.id=row.id;const h=handlerHarness(),wait=deferred();const restore=withFetch(()=>wait.promise);try{const pending=h.submitForm();assert(h.submit.disabled);await h.submitForm();if(change==='edit-confirmation')h.form.confirmed=false;else invalidateInteractions();if(change==='navigation'){state.route='agents';state.id='';}state.dirty=true;wait.resolve(json({deleted:true}));await pending;assert.equal(h.modal.closed,0);assert.deepEqual(h.routes,[]);assert(state.dirty);assert.equal(h.toasts.length,1);assert.equal(h.submit.disabled,false);}finally{restore();}
});
test('production error boundary keeps the confirmed object and form for explicit correction',async()=>{
 reset();const h=handlerHarness();const restore=withFetch(async()=>failure());try{await h.submitForm();assert(h.error.textContent.includes('合成核对失败'));assert.equal(h.modal.closed,0);assert.equal(h.submit.disabled,false);assert.equal(h.form.dataset.submitting,'false');assert(state.cache.comparison);assert.deepEqual(h.refreshes,[]);}finally{restore();}
});
test('a late failure does not write into a replacement dialog',async()=>{
 reset();const h=handlerHarness(),wait=deferred();const restore=withFetch(()=>wait.promise);try{const pending=h.submitForm();invalidateInteractions();h.error.textContent='新的窗口内容';wait.resolve(failure());await pending;assert.equal(h.error.textContent,'新的窗口内容');assert.deepEqual(h.toasts,[]);assert(state.cache.comparison);}finally{restore();}
});

function historyReset(){reset();state.identity='live-identity';state.cache.serviceHistoryOwner=state.user.id;state.cache.serviceHistory={scope:'account_owned_orphan_history',read_only:true,items:[{...structuredClone(row),kind:'comparison',identity_id:row.payload.identity_id,history_reason:'原身份已删除'}, {...structuredClone(other),kind:'action',identity_id:row.payload.identity_id,history_reason:'只读行动历史'}],has_more:true,next_offset:100};}
const historyTarget=()=>comparisonRemovalTarget(row.id,row.version,row.payload.identity_id,'history');
test('history cleanup requires an owner-bound loaded comparison and cannot restore editing or target other kinds',()=>{
 historyReset();const t=historyTarget();assert.equal(t.source,'history');assert.equal(t.identityId,row.payload.identity_id);assert.notEqual(t.identityId,state.identity);assert.throws(()=>comparisonRemovalTarget(row.id,3,row.payload.identity_id));assert.throws(()=>comparisonRemovalTarget(other.id,3,row.payload.identity_id,'history'));assert.throws(()=>comparisonRemovalTarget(row.id,2,row.payload.identity_id,'history'));assert.throws(()=>comparisonRemovalTarget(row.id,3,state.identity,'history'));
 const html=comparisonDeleteForm(t);assert(html.includes('不恢复历史身份的执行或编辑权限'));assert(html.includes('data-source="history"'));assert(html.includes('原服务身份'));assert(html.includes('当前账户的失效范围历史'));assert(!html.includes('当前列表仅显示本身份'));assert.equal(comparisonHistoryDeleteButton({kind:'action'}),'');assert.equal(comparisonHistoryDeleteButton({kind:'assistant_thread'}),'');
 state.cache.serviceHistoryOwner='another-owner';assert.throws(historyTarget);state.cache.serviceHistoryOwner=state.user.id;state.cache.serviceHistory.items=[];assert.throws(historyTarget);
});
test('production history submit uses original identity/version while preserving the active identity and independent history',async()=>{
 historyReset();const h=handlerHarness();h.form.dataset.source='history';const originalIdentity=state.identity,archived=JSON.stringify(state.cache.plans),untouched=JSON.stringify(state.cache.serviceHistory.items[1]);let calls=0;const restore=withFetch(async(url,init)=>{calls++;const query=new URL(url,'https://synthetic.invalid').searchParams;assert.equal(query.get('identity_id'),row.payload.identity_id);assert.equal(query.get('version'),'3');assert.equal(init.method,'DELETE');return json({deleted:true});});try{await h.submitForm();assert.equal(calls,1);assert.equal(state.identity,originalIdentity);assert.equal(state.cache.serviceHistory.items.length,1);assert.equal(JSON.stringify(state.cache.serviceHistory.items[0]),untouched);assert.equal(state.cache.serviceHistory.next_offset,99);assert(state.cache.serviceHistory.read_only);assert.equal(JSON.stringify(state.cache.plans),archived);assert.equal(h.modal.closed,1);assert.deepEqual(h.routes,[]);}finally{restore();}
});
test('history DOM update removes only target row, fixes pagination and leaves a newer inspector intact',()=>{
 historyReset();const t=historyTarget();let removed=0;const more={dataset:{offset:'100'}},targetDetail={dataset:{comparisonHistoryDetail:row.id},innerHTML:'original'},newDetail={dataset:{comparisonHistoryDetail:other.id},innerHTML:'new inspector'},marker={dataset:{historyComparison:row.id},closest:()=>({remove(){removed++;}})};state.cache.serviceHistory.items.shift();state.cache.serviceHistory.next_offset=99;const root={querySelector:()=>null,querySelectorAll:s=>({'[data-history-comparison]':[marker],'[data-x-action="history-more"]':[more],'[data-comparison-history-detail]':[targetDetail,newDetail]}[s]??[])};refreshComparisonReferences(root,t);assert.equal(removed,1);assert.equal(more.dataset.offset,'99');assert(targetDetail.innerHTML.includes('已永久清理'));assert.equal(newDetail.innerHTML,'new inspector');
});
test('history cleanup failure leaves archived row and pagination untouched',async()=>{
 historyReset();const before=JSON.stringify(state.cache.serviceHistory);const restore=withFetch(async()=>failure(409));try{await assert.rejects(removeSavedComparison(historyTarget()));assert.equal(JSON.stringify(state.cache.serviceHistory),before);}finally{restore();}
});
test('late owner history GET cannot revive a removed comparison after another services batch read finishes',async()=>{
 historyReset();const wait=deferred();let historyReads=0,securityReads=0;const initial=structuredClone(state.cache.serviceHistory);const restore=withFetch(async(url,init)=>{if(init.method==='DELETE')return json({deleted:true});if(url.includes('/history'))return json({...initial,items:++historyReads===1?initial.items:initial.items.slice(1)});if(url.includes('/security'))return ++securityReads===1?wait.promise:json({sessions:[],checks:[]});return json({items:[],boundary:'boundary'});});try{const pending=servicesPage();await tick();await removeSavedComparison(historyTarget());wait.resolve(json({sessions:[],checks:[]}));const html=await pending;assert.equal(historyReads,2);assert(!html.includes('合成已保存对照'));assert.equal(state.cache.serviceHistoryOwner,state.user.id);assert(!state.cache.serviceHistory.items.some(r=>r.id===row.id));}finally{restore();}
});

let experienceModule;
async function historyHarness(){
 const originalDocument=globalThis.document,originalInterval=globalThis.setInterval;const listeners={};globalThis.document={addEventListener:(name,fn)=>listeners[name]=fn,querySelector:()=>null,querySelectorAll:()=>[]};globalThis.setInterval=()=>0;
 try{experienceModule??=await import('../web/dist/experience.js');}finally{globalThis.setInterval=originalInterval;}
 const inspected=[];experienceModule.setupExperience({inspect(title,html){invalidateInteractions();inspected.push({title,html});},dialog(){throw new Error('history review must not implicitly open an edit form');},toast(){},navigate(){throw new Error('history review must not navigate');},render:async()=>{},refresh:async()=>{},reset(){}});
 return {inspected,click(action,id,offset){const el={dataset:{xAction:action,id,offset},setAttribute(){},removeAttribute(){}};return listeners.click({target:{closest:()=>el},preventDefault(){},stopImmediatePropagation(){}});},restore(){globalThis.document=originalDocument;}};
}
test('history inspector offers the dedicated cleanup only for comparisons and keeps other types read-only',async()=>{
 historyReset();const h=await historyHarness();try{await h.click('history-detail',row.id);assert(h.inspected[0].html.includes('data-action="delete-comparison"'));assert(h.inspected[0].html.includes('data-source="history"'));assert(!h.inspected[0].html.includes('comparison-transfer-form'));assert(!h.inspected[0].html.includes('name="external_consent"'));await h.click('history-detail',other.id);assert(!h.inspected[1].html.includes('data-action="delete-comparison"'));assert(!h.inspected[1].html.includes('data-action="action-edit"'));}finally{h.restore();}
});
test('production historical pagination re-reads its adjusted offset and cannot reintroduce a removed original',async()=>{
 historyReset();const h=await historyHarness(),wait=deferred(),offsets=[];const next={...other,id:'next-history',kind:'action',identity_id:row.payload.identity_id,history_reason:'下一页历史'};const restore=withFetch((url,init)=>{if(init.method==='DELETE')return Promise.resolve(json({deleted:true}));offsets.push(new URL(url,'https://synthetic.invalid').searchParams.get('offset'));return offsets.length===1?wait.promise:Promise.resolve(json({scope:'account_owned_orphan_history',items:[next],has_more:false,next_offset:null,read_only:true}));});try{const pending=h.click('history-more','',100);await removeSavedComparison(historyTarget());wait.resolve(json({items:[{...row,kind:'comparison'}],has_more:false,next_offset:null}));await pending;assert.deepEqual(offsets,['100','99']);assert.equal(h.inspected.length,1);assert(!h.inspected[0].html.includes('合成已保存对照'));assert.deepEqual(state.cache.serviceHistory.items.map(r=>r.id),[other.id,next.id]);assert.equal(state.cache.serviceHistoryOwner,state.user.id);}finally{restore();h.restore();}
});
