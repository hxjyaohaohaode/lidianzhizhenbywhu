/** Combined production app click/input/change, service submit and copilot state machine.
 * Regression found by independent base/c587 comparison: ordinary edits invalidated
 * the displayed research form's lifetime guard. Explicit DOM/transport doubles,
 * not native browser or live service evidence. Original failing evidence is retained.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as components from '../web/dist/components.js';
import {contextGuard,invalidateContext,setCsrf} from '../web/dist/api.js';
import {interactionGuard,continuationGuard,invalidateInputs,invalidateInteractions} from '../web/dist/interactions.js';
const listeners=new Map();
globalThis.document={addEventListener(name,fn,capture=false){const list=listeners.get(name)??[];list.push({fn,capture});listeners.set(name,list);},querySelector(){return null;},querySelectorAll(){return [];}};
globalThis.window={addEventListener(){}};
const oldInterval=globalThis.setInterval;globalThis.setInterval=()=>0;
const chat=await import('../web/dist/copilot-ui.js'),{setupExperience}=await import('../web/dist/experience.js'),{state}=await import('../web/dist/state.js');
globalThis.setInterval=oldInterval;
const copilotListeners=new Map([...listeners].map(([name,list])=>[name,[...list]]));
const app=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
const dialogStart=app.indexOf('function dialog('),dialogEnd=app.indexOf('function download(',dialogStart);
const clickStart=app.indexOf("document.addEventListener('click',"),clickEnd=app.indexOf('for (const overlay',clickStart);
assert(dialogStart>=0&&dialogEnd>dialogStart&&clickStart>=0&&clickEnd>clickStart);
const source=app.slice(dialogStart,dialogEnd)+app.slice(clickStart,clickEnd);
const dispatch=async(name,target)=>{const event={target,stopped:false,preventDefault(){},stopImmediatePropagation(){this.stopped=true;}};for(const {fn}of [...listeners.get(name)??[]].sort((a,b)=>Number(b.capture)-Number(a.capture))){await fn(event);if(event.stopped)break;}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const dataset={id:'dataset-a',version:3,content_hash:'a'.repeat(64),payload:{company:'主企业'}};
const peer={id:'dataset-b',version:2,content_hash:'b'.repeat(64),payload:{company:'对照企业'}};
const experiment={id:'saved-forecast',version:2,experiment_hash:'c'.repeat(64),payload:{company:'主企业',dataset_id:dataset.id,dataset_version:3,dataset_hash:dataset.content_hash,target_period:'2026-Q2',analysis_as_of:'2026-09-30',request:{kind:'forecast',name:'冻结现金预测',assumptions:'经确认假设',metric:'cash_flow',horizon:4}}};
const thread=()=>({thread:{id:'thread-a',version:1,payload:{identity_id:'identity-a',dataset_id:dataset.id}},messages:[],proposals:[],runs:[],context:{writable:true}});
const proposal=()=>({id:'proposal-a',version:1,payload:{status:'draft',kind:'research',text:'核查第二季度',title:'保存研判',binding:{dataset_version:3},plan_id:'plan-a',fingerprint:'f'.repeat(64)}});
const plan=()=>({payload:{snapshot:{research_scope:{period:'2026-Q2'},comparison:'previous'},context:{},nodes:[],blockers:[],max_calls:0,packing:{characters:0,dropped:[]}}});
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function newForm(html){
 const form={id:'',isConnected:true,dataset:{thread:'thread-a',serviceForm:'proposal',kind:'research',key:html.match(/data-key="([^"]+)"/)[1],researchInputs:html.match(/data-research-inputs="([^"]+)"/)[1],message:''},nodes:{},error:{textContent:'',isConnected:true},submit:{disabled:false},reportValidity(){return true;},setAttribute(){},removeAttribute(){},querySelectorAll(){return [this.submit];},querySelector(selector){if(selector==='.form-error')return this.error;if(selector.startsWith('#'))return this.details[selector.slice(1)]??null;return this.nodes[selector.match(/name="(.*?)"/)?.[1]]??null;}};
 const values={text:'核查第二季度经营变化',mode:'operational',depth:'balanced',provider:'',acceptance:'核对输入与可比范围',max_calls:'0',experiment_id:'',comparison_artifact_id:'',forecast_metric:'revenue',horizon:'2',forecast:'on'};
 for(const [name,value]of Object.entries(values))form.nodes[name]={name,value,disabled:false,checked:false,dataset:{},form,id:name==='experiment_id'?'copilot-experiment':'',closest:selector=>selector==='form'?form:null};
 form.details=Object.fromEntries(['copilot-experiment-details','copilot-comparison-details','copilot-input-conflicts'].map(id=>[id,{innerHTML:''}]));return form;
}
async function harness(){
 const oldFetch=globalThis.fetch,NativeFormData=globalThis.FormData,oldQuery=document.querySelector;
 listeners.clear();for(const [name,list]of copilotListeners)listeners.set(name,[...list]);
 chat.resetCopilot();invalidateContext();invalidateInteractions();setCsrf('lifecycle-test');
 Object.assign(state,{user:{id:'owner',preferences:{role:'enterprise'}},identity:'identity-a',active:dataset.id,datasets:[dataset,peer],identities:[{id:'identity-a',payload:{dataset_ids:[dataset.id,peer.id],max_calls:0,depth:'balanced'}}],dirty:false});chat.copilotShell();
 const shown=[],toasts=[],calls=[];let form;
 const modal={open:false,classList:{toggle(){}},showModal(){this.open=true;},close(){this.open=false;},set innerHTML(html){this.html=html;if(form)form.isConnected=false;shown.push(html);if(html.includes('data-service-form="proposal"'))form=newForm(html);},get innerHTML(){return this.html;}};
 const inspector={open:false,showModal(){this.open=true;},close(){this.open=false;}};
 class Button{constructor(dataset){this.dataset=dataset;this.disabled=false;}setAttribute(){}removeAttribute(){}closest(selector){return selector==='[data-x-action]'?this.dataset.xAction?this:null:selector==='[data-action],[data-route]'?this.dataset.action?this:null:null;}}
 const env={...components,document,state,modal,inspector,HTMLButtonElement:Button,contextGuard,interactionGuard,continuationGuard,invalidateInteractions,invalidateInputs,toast:text=>toasts.push(text)};
 const controls=new Function(...Object.keys(env),source+'return {dialog,inspect};')(...Object.values(env));
 setupExperience({dialog:controls.dialog,inspect:controls.inspect,toast:text=>toasts.push(text),navigate(){},render:async()=>{},refresh:async()=>true,reset(){}});
 document.querySelector=selector=>selector==='#modal'?modal:null;
 globalThis.FormData=class extends NativeFormData{constructor(target){super();if(target)for(const [name,node]of Object.entries(target.nodes))if(!node.disabled&&(!['forecast','use_llm','include_thread_history','model_planning'].includes(name)||node.checked))this.set(name,node.value);}};
 const normal=async(url,init)=>{calls.push({url,method:init.method,headers:init.headers,body:init.body?JSON.parse(init.body):null});if(url.includes('/threads?'))return response({items:[{id:'thread-a'}]});if(url==='/api/services/threads/thread-a')return response(thread());if(url.includes('/experiments?'))return response({items:[experiment]});if(url.includes('/comparisons?'))return response({items:[]});if(url.includes('/connections'))return response({items:[]});if(url.includes('/workspace/plans/'))return response(plan());if(url.endsWith('/proposals'))return response(proposal());throw new Error('Unexpected URL '+url);};
 globalThis.fetch=normal;await chat.mountCopilot();
 return {calls,shown,toasts,modal,normal,get form(){return form;},open:async()=>{await dispatch('click',new Button({xAction:'chat-propose',kind:'research'}));assert(form);return form;},close:()=>dispatch('click',new Button({action:'close-modal'})),submit:target=>dispatch('submit',target),edit:async(target,name,value,event='input')=>{target.nodes[name].value=value;await dispatch(event,target.nodes[name]);},restore(){globalThis.fetch=oldFetch;globalThis.FormData=NativeFormData;document.querySelector=oldQuery;chat.resetCopilot();invalidateInteractions();}};
}
const posts=h=>h.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/proposals'));
const approval=h=>h.shown.some(html=>html.includes('核对后确认'));
const run=(name,fn)=>test(name,{timeout:5000},async()=>{const h=await harness();try{await fn(h);}finally{h.restore();}});
for(const edit of ['untouched','edit-question','change-depth','select-experiment-input-and-change','select-experiment-change-only'])run(`research proposal accepts ${edit} through combined production listeners`,async h=>{
 const form=await h.open();
 if(edit==='edit-question')await h.edit(form,'text','改为核查现金流与毛利变化');
 if(edit==='change-depth')await h.edit(form,'depth','deep','change');
 if(edit.startsWith('select-experiment')){if(edit.endsWith('input-and-change'))await h.edit(form,'experiment_id',experiment.id);await h.edit(form,'experiment_id',experiment.id,'change');assert.equal(form.nodes.horizon.disabled,true);assert.match(form.details['copilot-experiment-details'].innerHTML,/冻结现金预测/);}
 await h.submit(form);assert.equal(form.error.textContent,'');assert.equal(posts(h).length,1);assert.equal(posts(h)[0].headers['X-CSRF-Token'],'lifecycle-test');assert(approval(h));
 const body=posts(h)[0].body;if(edit==='edit-question')assert.equal(body.text,'改为核查现金流与毛利变化');if(edit==='change-depth')assert.equal(body.execution.depth,'deep');if(edit.startsWith('select-experiment'))assert.deepEqual(body.experiment,{id:experiment.id,version:2,hash:experiment.experiment_hash});
 assert(!h.calls.some(c=>c.url.endsWith('/confirm')),'Creating a proposal is not execution approval');
});
run('closed research proposal cannot submit; reopened edited proposal owns a fresh lifetime',async h=>{
 const old=await h.open();await h.edit(old,'text','关闭前修改的研究目标');await h.close();assert.equal(h.modal.open,false);await h.submit(old);assert.equal(posts(h).length,0);assert.match(old.error.textContent,/窗口或范围已变化/);
 const form=await h.open();assert.notEqual(form.dataset.researchInputs,old.dataset.researchInputs);await h.edit(form,'text','重新打开后明确的新研究目标');await h.submit(form);assert.equal(posts(h).length,1);assert.equal(posts(h)[0].body.text,'重新打开后明确的新研究目标');assert(approval(h));
});
run('an earlier still-referenced form cannot submit after a replacement dialog opens',async h=>{
 const old=await h.open();const form=await h.open();await h.edit(old,'text','旧窗口延迟的修改');await h.submit(old);assert.equal(posts(h).length,0);assert.match(h.toasts.join('\n'),/窗口或范围已变化/);assert.equal(form.error.textContent,'');await h.edit(form,'depth','deep','change');await h.submit(form);assert.equal(posts(h).length,1);assert.equal(form.error.textContent,'');
});
run('edits during a sent proposal retain the new draft and can explicitly create the next proposal',async h=>{
 const form=await h.open();await h.edit(form,'text','最初提交的研究目标');const originalKey=form.dataset.key,pendingWrite=deferred();
 globalThis.fetch=async(url,init)=>{if(init.method==='POST'&&url.endsWith('/proposals')){h.calls.push({url,method:init.method,body:JSON.parse(init.body)});return pendingWrite.promise;}return h.normal(url,init);};
 const saving=h.submit(form);await tick();assert.equal(posts(h).length,1);await h.submit(form);assert.equal(posts(h).length,1);
 await h.edit(form,'text','请求途中另写的新研究目标');await h.edit(form,'experiment_id',experiment.id);await h.edit(form,'experiment_id',experiment.id,'change');pendingWrite.resolve(response(proposal()));await saving;
 assert.equal(form.isConnected,true);assert.equal(form.nodes.text.value,'请求途中另写的新研究目标');assert.equal(form.nodes.horizon.disabled,true);assert.equal(approval(h),false);assert.equal(state.dirty,true);assert.notEqual(form.dataset.key,originalKey);assert.match(h.toasts.join('\n'),/上一版提案已保存/);
 globalThis.fetch=h.normal;await h.submit(form);assert.equal(posts(h).length,2);assert.equal(posts(h)[1].body.text,'请求途中另写的新研究目标');assert.equal(posts(h)[1].body.experiment.id,experiment.id);assert(approval(h));
});
run('draft edits during pending research catalog loading preserve the current editable dialog',async h=>{
 const form=await h.open(),catalog=deferred();globalThis.fetch=(url,init)=>url.includes('/experiments?')?catalog.promise:h.normal(url,init);
 const pending=h.open();await tick();await h.edit(form,'text','列表请求期间保留的新草稿');catalog.resolve(response({items:[experiment]}));await pending;
 assert.equal(h.form,form);assert.equal(form.isConnected,true);assert.equal(form.nodes.text.value,'列表请求期间保留的新草稿');assert.equal(h.shown.length,1);assert.equal(posts(h).length,0);
});
test('draft changes invalidate continuations without expiring editable dialog ownership',()=>{
 invalidateInteractions();const owner=interactionGuard(),pending=continuationGuard();invalidateInputs();assert.equal(owner(),true);assert.equal(pending(),false);const next=continuationGuard();assert.equal(next(),true);invalidateInteractions();assert.equal(owner(),false);assert.equal(next(),false);
});
