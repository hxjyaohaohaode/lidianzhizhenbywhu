/** Isolated production renderers/listeners with explicit DOM/transport doubles, not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runPage,claimReviewForm,claimReviewState} from '../web/dist/views-studio.js';
import {reportsPage} from '../web/dist/views-analysis.js';
import {state} from '../web/dist/state.js';
import {workspace,ApiError,contextGuard,invalidateContext,invalidateView} from '../web/dist/api.js';
import {invalidateInteractions,interactionGuard,continuationGuard,finishMutation} from '../web/dist/interactions.js';
import {unchangedInputGuard} from '../web/dist/saved-experiments.js';
import {esc,button,icon} from '../web/dist/components.js';

const review={id:'synthetic-review',version:7,payload:{run_id:'synthetic-run',claim_id:'claim-a',verdict:'accepted',note:'原先保存的合成核对依据'}};
const unavailable={id:review.id,version:review.version,claim_id:'claim-a',association:'natural_key',target_claim_id:'claim-a',reason_code:'invalid_payload',can_rereview:true,reason:'已有审阅记录无法核验；原结论与依据不可用，可明确提交新的人工复核'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixtures(){
 const analysis={metrics:{gross_margin:.2,cash_ratio:.3,leverage:.4},series:[],current_period:'2025-Q4',gmps:{method:'local',score:null,coverage:0,dimensions:[]},dqi:{method:'local',score:null,coverage:0,dimensions:[]}};
 const run={id:'synthetic-run',state:'succeeded',created_at:'2026-10-01',payload:{query:'核对合成毛利率'},snapshot:{dataset:{company:'隔离合成企业'},citations:[],memory:[]},result:{title:'冻结原报告',analysis,findings:['原报告保存的确定性结论'],warnings:[],llm:{state:'completed',review:{claims:[{id:'claim-a',text:'原先冻结的模型解释',metric_ids:['gross_margin']}],rejected_claims:0}}}};
 const audit={ledger:{valid:true},data_hash_valid:true,snapshot_hash_valid:true,report_hash_valid:true,artifacts:[],trace:[],source_impact:{state:'current',reasons:[]},report_integrity:{valid:true,failures:[]}};
 return {run,audit};
}
function reset(reviews={items:[],unavailable:[structuredClone(unavailable)]}){
 invalidateContext();invalidateView();invalidateInteractions();
 const fixture=fixtures();Object.assign(state,{user:{id:'synthetic-owner',preferences:{amount_unit:'wan'}},identity:'',route:'agents',id:'run-'+fixture.run.id,cache:{run:fixture.run,reviews:reviews.items,unavailableReviews:reviews.unavailable??[]},dirty:false});return fixture;
}
function withFetch(fn){const old=globalThis.fetch;globalThis.fetch=fn;return ()=>globalThis.fetch=old;}
async function render(run,audit,reviews){
 const restore=withFetch(async url=>{if(url==='/api/workspace/orchestration/catalog')return json({capabilities:[]});assert(['/api/workspace/runs/'+run.id+'/audit','/api/workspace/runs/'+run.id+'/reviews'].includes(url));return json(url.endsWith('/audit')?{...audit,run}:reviews);});
 try{return await runPage(run.id);}finally{restore();}
}

test('healthy review and never-reviewed forms retain their existing user data and zero version meaning',async()=>{
 const {run,audit}=reset({items:[review]});const frozen=structuredClone(run);
 const html=await render(run,audit,{items:[review]});assert(html.includes('人工审阅：accepted'));assert(!html.includes('已有审阅记录无法核验'));assert.deepEqual(state.cache.unavailableReviews,[]);
 const form=claimReviewForm('claim-a');assert(form.includes('data-version="7"'));assert(form.includes('value="accepted" selected'));assert(form.includes(review.payload.note));
 state.cache.reviews=[];const fresh=claimReviewForm('claim-a');assert(fresh.includes('data-version="0"'));assert(fresh.includes('value="needs_evidence" selected'));assert(!fresh.includes(review.payload.note));assert.deepEqual(run,frozen);
});
test('unavailable review remains visible beside the readable frozen claim and opens a blank explicit new assessment',async()=>{
 const {run,audit}=reset();audit.source_impact={state:'unavailable',reasons:[{code:'claim_review_unavailable',message:'当前人工审阅记录无法校验'}]};const frozen=structuredClone(run);
 const html=await render(run,audit,{items:[],unavailable:[unavailable]});
 for(const text of ['原报告保存的确定性结论','原先冻结的模型解释','已有审阅记录无法核验','重新人工复核','当前适用性需复核'])assert(html.includes(text));
 assert(!html.includes('尚待人工复核'));assert(html.includes('export?format=md'));assert(!html.includes('data-report-export-unavailable'));
 const form=claimReviewForm('claim-a');for(const text of ['data-version="7"','data-run-id="synthetic-run"','请选择新的复核结论','不会恢复旧结论或依据','不会改写冻结报告','明确记录新的人工复核'])assert(form.includes(text));
 assert(form.includes('<option value="" selected>'));assert.match(form,/<textarea[^>]*name="note"[^>]*><\/textarea>/);assert(!form.includes(review.payload.note));assert.deepEqual(run,frozen);
});
test('a bad claim does not invent or hide a different healthy review',async()=>{
 const healthy={...review,id:'review-b',payload:{...review.payload,claim_id:'claim-b'}};const {run,audit}=reset({items:[healthy],unavailable:[unavailable]});
 run.result.llm.review.claims.push({id:'claim-b',text:'另一条健康审阅的解释'});const html=await render(run,audit,{items:[healthy],unavailable:[unavailable]});
 assert(html.includes('人工审阅：accepted'));assert.equal(claimReviewState('claim-b').unavailable,undefined);assert(claimReviewForm('claim-b').includes(healthy.payload.note));
});
for(const association of ['unverified','raw-unusable'])test('blocked '+association+' review does not offer an impossible version-zero form',async()=>{
 const bad={...unavailable,claim_id:association==='unverified'?null:'claim-a',association,can_rereview:false,reason:'关联或原始内容不可核验，请核对可信记录'};const {run,audit}=reset({items:[],unavailable:[bad]});
 const html=await render(run,audit,{items:[],unavailable:[bad]});assert(html.includes('disabled aria-disabled="true"'));assert(html.includes('原先冻结的模型解释'));assert(!html.includes('尚待人工复核'));
 const form=claimReviewForm('claim-a');assert(!form.includes('<form'));assert(form.includes('当前操作已停用'));assert(!form.includes('data-version="0"'));
});
test('unavailable reasons and healthy notes remain HTML escaped',async()=>{
 const bad={...unavailable,reason:'<img src=x onerror=alert(1)>'};const {run,audit}=reset({items:[],unavailable:[bad]});const html=await render(run,audit,{items:[],unavailable:[bad]});assert(html.includes('&lt;img'));assert(!html.includes('<img src=x'));
 state.cache.unavailableReviews=[];state.cache.reviews=[{...review,payload:{...review.payload,note:'</textarea><script>bad()</script>'}}];const form=claimReviewForm('claim-a');assert(!form.includes('<script>'));assert(form.includes('&lt;/textarea&gt;'));
});

// The original compiled listeners and dialog function execute against a small,
// explicit form/dialog implementation. No browser runtime or visual claims.
const app=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
function harness(){
 const listeners={},document={addEventListener:(name,fn)=>listeners[name]=fn};
 const submit={disabled:false},error={textContent:'',isConnected:true};
 class Form{constructor(){this.id='claim-review-form';this.dataset={id:'claim-a',runId:'synthetic-run',version:'7'};this.values={verdict:'needs_evidence',note:'重新核对后明确提交的新依据'};this.isConnected=true;this.valid=true;}reportValidity(){return this.valid&&Boolean(this.values.verdict)&&this.values.note.trim().length>=5;}querySelector(selector){return selector==='.form-error'?error:submit;}}
 class Data extends FormData{constructor(form){super();for(const [k,v]of Object.entries(form?.values??{}))this.set(k,v);}}
 class Button{constructor(){this.dataset={action:'review-claim',id:'claim-a'};this.disabled=false;}setAttribute(){}removeAttribute(){}}
 const modal={innerHTML:'',open:false,closed:0,classList:{toggle(){}},showModal(){this.open=true;},close(){this.open=false;this.closed++;}},inspector={open:false,close(){this.open=false;}},toasts=[],renders=[],refreshes=[];
 const values={document,state,HTMLFormElement:Form,HTMLButtonElement:Button,FormData:Data,esc,button,icon,invalidateInteractions,claimReviewState,claimReviewForm,contextGuard,interactionGuard,continuationGuard,unchangedInputGuard,finishMutation,workspace,ApiError,modal,inspector,toast:t=>toasts.push(t),read:form=>{const f=new Data(form);return {f,str:k=>String(f.get(k)??'').trim(),check:k=>f.has(k)};},formSnapshot:form=>JSON.stringify([...new Data(form)]),refreshData:async valid=>{refreshes.push('read');return valid();},render:async()=>renders.push('render'),showSyncNotice:()=>{}};
 const dialogSource=app.slice(app.indexOf('function dialog('),app.indexOf('function inspect('));
 const submitSource=app.slice(app.indexOf("document.addEventListener('submit',"),app.indexOf("document.addEventListener('click',"));
 const clickSource=app.slice(app.indexOf("document.addEventListener('click',"),app.indexOf("document.addEventListener('input',"));
 new Function(...Object.keys(values),'let syncPending=false;'+dialogSource+submitSource+clickSource)(...Object.values(values));
 const form=new Form(),target=new Button();return {form,submit,error,modal,toasts,renders,refreshes,target,open:()=>listeners.click({target:{closest:()=>target},preventDefault(){}}),save:()=>listeners.submit({target:form,preventDefault(){}})};
}
test('production review click shows the actual unavailable version and no previous verdict',async()=>{
 reset();const h=harness();await h.open();assert(h.modal.open);assert(h.modal.innerHTML.includes('data-version="7"'));assert(h.modal.innerHTML.includes('<option value="" selected>'));assert(!h.modal.innerHTML.includes(review.payload.note));
});
test('production submit uses the actual reviewed version, validates new input and dispatches only once',async()=>{
 reset();const h=harness();await h.open();const calls=[],pending=deferred();const restore=withFetch((url,options)=>{calls.push({url,body:JSON.parse(options.body)});return pending.promise;});
 try{
  h.form.values.verdict='';h.form.values.note='';await h.save();assert.equal(calls.length,0);
  h.form.values={verdict:'needs_evidence',note:'新的明确人工核对依据'};state.dirty=true;const save=h.save();assert(h.submit.disabled);await h.save();assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{url:'/api/workspace/runs/synthetic-run/reviews',body:{claim_id:'claim-a',version:7,verdict:'needs_evidence',note:'新的明确人工核对依据'}});
  pending.resolve(json({...review,version:8}));await save;assert.equal(h.modal.closed,1);assert.deepEqual(h.renders,['render']);assert.equal(state.dirty,false);
 }finally{restore();}
});
for(const change of ['run','version','blocked'])test('production submit rejects changed '+change+' binding before writing',async()=>{
 reset();const h=harness();await h.open();if(change==='run')state.cache.run.id='different-run';if(change==='version')state.cache.unavailableReviews[0].version=8;if(change==='blocked')state.cache.unavailableReviews[0].can_rereview=false;
 let calls=0;const restore=withFetch(async()=>{calls++;return json({});});try{await h.save();assert.equal(calls,0);assert(h.error.textContent.includes('关联或版本已改变'));assert.equal(h.modal.closed,0);}finally{restore();}
});
test('production version-conflict boundary preserves explicit new input and does not retry',async()=>{
 reset();const h=harness();await h.open();const original={...h.form.values};let calls=0;const restore=withFetch(async()=>{calls++;return json({error:{code:'VERSION_CONFLICT',message:'记录已改变；请刷新'}},409);});
 try{await h.save();assert.equal(calls,1);assert(h.error.textContent.includes('记录已改变'));assert.deepEqual(h.form.values,original);assert.equal(h.modal.closed,0);assert.equal(h.submit.disabled,false);assert.deepEqual(h.renders,[]);}finally{restore();}
});
for(const change of ['navigation','dismiss','replacement','edit'])test('a saved review does not overwrite newer '+change+' state',async()=>{
 reset();const h=harness();await h.open();const pending=deferred();let calls=0;const restore=withFetch(()=>{calls++;return pending.promise;});
 try{const save=h.save();if(change==='edit')h.form.values.note='用户后来继续输入的新依据';else invalidateInteractions();if(change==='navigation'){state.route='reports';state.id='';}if(change==='dismiss'){h.modal.open=false;h.form.isConnected=false;}if(change==='replacement')h.modal.innerHTML='用户新打开的窗口';state.dirty=true;
  pending.resolve(json({...review,version:8}));await save;assert.equal(calls,1);assert.equal(h.modal.closed,0);assert.deepEqual(h.renders,[]);assert(state.dirty);if(change==='replacement')assert.equal(h.modal.innerHTML,'用户新打开的窗口');
 }finally{restore();}
});
test('late conflict after dialog replacement does not alter the replacement error or send a stale toast',async()=>{
 reset();const h=harness();await h.open();const pending=deferred(),restore=withFetch(()=>pending.promise);
 try{const save=h.save();invalidateInteractions();h.error.textContent='新窗口的说明';pending.resolve(json({error:{code:'VERSION_CONFLICT',message:'旧提交冲突'}},409));await save;assert.equal(h.error.textContent,'新窗口的说明');assert.deepEqual(h.toasts,[]);}finally{restore();}
});

for(const kind of ['healthy','changed-source','unavailable-review','legacy-partial','bad-report','bad-artifact','bad-ledger'])test('report detail export boundary: '+kind,async()=>{
 const {run,audit}=reset({items:[]});
 if(kind==='changed-source')audit.source_impact={state:'changed',reasons:[{code:'memory_withdrawn',message:'当前记忆停用'}]};
 if(kind==='unavailable-review')audit.source_impact={state:'unavailable',reasons:[{code:'claim_review_unavailable',message:'当前审阅不可核验'}]};
 if(kind==='legacy-partial'){audit.report_integrity.format='legacy';audit.report_hash_valid=null;}
 if(kind==='bad-report')audit.report_integrity={valid:false,failures:['report_hash']};
 if(kind==='bad-artifact')audit.artifacts=[{integrity_valid:false,event_anchor_valid:true}];
 if(kind==='bad-ledger')audit.ledger.valid=false;
 const html=await render(run,audit,{items:[]}),blocked=kind.startsWith('bad-');
 assert.equal(html.includes('data-report-export-unavailable'),blocked);assert.equal(html.includes('/api/runs/synthetic-run/export?format=md" download'),!blocked);assert.equal(html.includes('/api/runs/synthetic-run/export?format=json" download'),!blocked);assert(html.includes('原报告保存的确定性结论'));if(blocked)assert(html.includes('新建研判'));
});
for(const kind of ['healthy','changed-source','unavailable-review','legacy-partial','bad-report'])test('report list export boundary: '+kind,async()=>{
 reset({items:[]});const row={id:'synthetic-run',title:'冻结原报告',query:'合成问题',state:'succeeded',created_at:'2026-10-01',source_impact:{state:'current',reasons:[]}};
 if(kind==='changed-source')row.source_impact={state:'changed',reasons:[{code:'memory_withdrawn',message:'当前记忆停用'}]};
 if(kind==='unavailable-review')row.source_impact={state:'unavailable',reasons:[{code:'claim_review_unavailable',message:'当前审阅不可核验'}]};
 if(kind==='legacy-partial')row.source_impact={state:'unknown',reasons:[{code:'legacy_unknown',message:'旧记录部分校验'}]};
 if(kind==='bad-report')row.source_impact={state:'unavailable',reasons:[{code:'report_integrity_failed',message:'冻结报告完整性异常'}]};
 const restore=withFetch(async url=>{assert(url.startsWith('/api/workspace/reports'));return json({items:[row]});});
 try{const html=await reportsPage(),blocked=kind==='bad-report';assert.equal(html.includes('data-report-export-unavailable'),blocked);assert.equal(html.includes('/api/runs/synthetic-run/export?format=md" download'),!blocked);assert.equal(html.includes('/api/runs/synthetic-run/export?format=json" download'),!blocked);assert(html.includes('data-route="agents:run-synthetic-run"'));}finally{restore();}
});


test('healthy A keeps its own verdict, version and POST path while conflicting B is blocked',async()=>{
 const bad={...unavailable,id:'bad-b',version:11,claim_id:null,target_claim_id:'claim-b',association:'unverified',reason_code:'ambiguous_association',can_rereview:false,reason:'第二条的保存绑定冲突，请核对可信记录'};
 const {run,audit}=reset({items:[review],unavailable:[bad]});run.result.llm.review.claims.push({id:'claim-b',text:'第二条冻结解释'});
 const html=await render(run,audit,{items:[review],unavailable:[bad]});assert(html.includes('人工审阅：accepted'));assert.match(html,/data-id="claim-b" disabled/);assert(!/data-id="claim-a" disabled/.test(html));
 assert.equal(claimReviewState('claim-a').version,7);assert.equal(claimReviewState('claim-a').unavailable,undefined);assert(claimReviewForm('claim-a').includes(review.payload.note));assert(!claimReviewForm('claim-b').includes('<form'));
 const h=harness();await h.open();const calls=[],restore=withFetch(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return json({...review,version:8});});
 try{await h.save();assert.equal(calls.length,1);assert.equal(calls[0].body.version,7);assert.equal(calls[0].body.claim_id,'claim-a');assert.equal(calls[0].url,'/api/workspace/runs/synthetic-run/reviews');}finally{restore();}
});
test('an unlocated bad record does not mask a healthy exact review slot',()=>{
 reset({items:[review],unavailable:[{...unavailable,claim_id:null,target_claim_id:null,association:'unverified',can_rereview:false}]});
 assert.equal(claimReviewState('claim-a').unavailable,undefined);assert(claimReviewForm('claim-a').includes(review.payload.note));assert(!claimReviewForm('claim-other').includes('<form'));
});
test('raw unreadable content blocks new slots that the unchanged POST capacity check cannot safely create',()=>{
 reset({items:[],unavailable:[{...unavailable,reason_code:'malformed_json',can_rereview:false}]});
 assert(!claimReviewForm('claim-new').includes('<form'));
});

test('B conflict naming unreviewed A blocks A as a candidate without claiming a trusted prior verdict',async()=>{
 const bad={...unavailable,id:'bad-b',version:11,claim_id:null,target_claim_id:'claim-b',candidate_claim_ids:['claim-a'],association:'unverified',reason_code:'ambiguous_association',can_rereview:false,reason:'保存键与载荷指向不同解释，请核对可信记录'};
 const {run,audit}=reset({items:[],unavailable:[bad]});run.result.llm.review.claims.push({id:'claim-b',text:'第二条冻结解释'},{id:'claim-c',text:'第三条无关解释'});
 const html=await render(run,audit,{items:[],unavailable:[bad]});assert.match(html,/data-id="claim-a" disabled/);assert.match(html,/data-id="claim-b" disabled/);assert(!/data-id="claim-c" disabled/.test(html));
 assert(claimReviewState('claim-a').blocked);assert(!claimReviewForm('claim-a').includes('<form'));assert(!claimReviewForm('claim-b').includes('<form'));assert(claimReviewForm('claim-c').includes('data-version="0"'));
 const h=harness();h.form.dataset.version='0';let calls=0;const restore=withFetch(async()=>{calls++;return json({});});try{await h.save();assert.equal(calls,0);}finally{restore();}
 state.cache.unavailableReviews=[{...bad,target_claim_id:null}];assert(claimReviewState('claim-a').blocked);assert(claimReviewForm('claim-c').includes('data-version="0"'));
 state.cache.reviews=[review];assert.equal(claimReviewState('claim-a').unavailable,undefined);assert.equal(claimReviewState('claim-a').version,7);assert(claimReviewForm('claim-a').includes(review.payload.note));
});
test('a capped healthy review stays readable, with no re-review form or false corruption message',async()=>{
 const capped={...review,version:Number.MAX_SAFE_INTEGER};const readOnly={id:capped.id,version:capped.version,claim_id:'claim-a',reason_code:'version_limit',reason:'审阅版本计数已达上限；已有结论与依据仍可查看，当前记录只读，不能再次提交复核'};
 const {run,audit}=reset({items:[capped]});const html=await render(run,audit,{items:[capped],read_only:[readOnly]});
 assert(html.includes('人工审阅：accepted'));assert(html.includes('版本计数已达上限'));assert(html.includes('查看已有审阅'));assert(!html.includes('已有审阅记录无法核验'));assert(html.includes('/export?format=md'));
 const form=claimReviewForm('claim-a');assert(form.includes(capped.payload.note));assert(form.includes('accepted'));assert(!form.includes('<form'));assert(!form.includes('不可核验'));assert(!form.includes('版本 0'));
 const h=harness();await h.open();assert(h.modal.innerHTML.includes(capped.payload.note));assert(!h.modal.innerHTML.includes('<form'));h.form.dataset.version=String(Number.MAX_SAFE_INTEGER);
 let calls=0;const restore=withFetch(async()=>{calls++;return json({});});try{await h.save();assert.equal(calls,0);assert(h.error.textContent.includes('版本计数已达上限'));}finally{restore();}
});
test('safe-integer cap remains read-only even if an older cached response omitted limit metadata',()=>{
 reset({items:[{...review,version:Number.MAX_SAFE_INTEGER}]});assert(claimReviewState('claim-a').readOnly);assert(!claimReviewForm('claim-a').includes('<form'));assert(claimReviewForm('claim-a').includes(review.payload.note));
});

function addReadout(run){
 run.result.query=run.payload.query;run.result.dataset_version=1;
 run.result.readout={amount_unit:'wan',notice:'合成的冻结问题结果',scope_recorded:true,period:'2025-Q4',facts:[{period:'2025-Q4',label:'毛利率',value:.2,unit:'ratio',inputs:[],formula:'(revenue-cost)/revenue'}],next_steps:[],input_source:{status:'unrecorded',source_kind:'structured_input',input_amount_unit:'wan',input_basis:'standalone_quarter',notice:'隔离合成输入记录'}};
 return run;
}
test('known-corrupt report values are only available as collapsed unverified raw data, never main answers or actions',async()=>{
 const {run,audit}=reset({items:[]});addReadout(run);run.result.readout.facts[0].value=9876.5432;run.result.analysis.metrics.gross_margin=9876.5432;run.result.findings=['987654.32% 被篡改的结论'];
 audit.report_integrity={valid:false,failures:['report_hash']};audit.report_hash_valid=false;audit.source_impact={state:'unavailable',reasons:[{code:'report_integrity_failed',message:'冻结报告校验失败'}]};const before=structuredClone(run);
 const html=await render(run,audit,{items:[]});assert(html.includes('data-report-unverified'));assert(html.includes('data-report-export-unavailable'));assert(html.includes(run.payload.query));assert(html.includes('未核验的已保存报告原文'));assert(html.includes('9876.5432'));
 const raw=html.match(/<details data-unverified-report-raw>[\s\S]*?<\/details>/);assert(raw);assert(!raw[0].includes(' open'));const main=html.replace(raw[0],'');
 for(const text of ['987654.32%','987,654.32%','data-report-readout','可核验的计算结论','经营变化','action-from-report','watch-from-report','指标血缘','以下报告与计算仍是原始冻结内容'])assert(!main.includes(text),text);
 assert.deepEqual(run,before);assert.deepEqual(state.cache.run,before);
});
for(const kind of ['healthy','changed-source','legacy-partial'])test('verified '+kind+' report keeps question-level answers, charts and follow-through',async()=>{
 const {run,audit}=reset({items:[]});addReadout(run);
 if(kind==='changed-source')audit.source_impact={state:'changed',reasons:[{code:'memory_withdrawn',message:'当前记忆已停用'}]};
 if(kind==='legacy-partial'){audit.report_integrity.format='legacy';audit.report_hash_valid=null;}
 const html=await render(run,audit,{items:[]});assert(!html.includes('data-report-unverified'));assert(html.includes('data-report-readout'));assert(html.includes('20%'));assert(html.includes('可核验的计算结论'));assert(html.includes('经营变化'));assert(html.includes('action-from-report'));assert(html.includes('watch-from-report'));assert(html.includes('/export?format=md'));
});
test('a known malformed saved result is not passed to the normal report or rules renderers',async()=>{
 const {run,audit}=reset({items:[]});run.result={readout:{facts:'broken'},analysis:null};audit.report_integrity={valid:false,failures:['report_shape']};
 const html=await render(run,audit,{items:[]});assert(html.includes('data-report-unverified'));assert(html.includes('未核验的已保存报告原文'));assert(!html.includes('data-report-readout'));assert(!html.includes('action-from-report'));
});
