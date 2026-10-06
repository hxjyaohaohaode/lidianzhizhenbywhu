/** Compiled UI + production event listeners with DOM doubles; no native browser claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {actionDetail} from '../web/dist/views-analysis.js';
import {state} from '../web/dist/state.js';
import {workspace,ApiError,contextGuard,invalidateContext} from '../web/dist/api.js';
import {invalidateInteractions,interactionGuard,continuationGuard,finishMutation} from '../web/dist/interactions.js';
import {unchangedInputGuard} from '../web/dist/saved-experiments.js';
import {esc,button,icon} from '../web/dist/components.js';

const action={id:'a',version:3,payload:{title:'隔离行动',company:'测试企业',status:'in_progress',history:[],changes:[],acceptance:'核对原始资料并记录判断'}};
const evidence=(id,patch={})=>({id,version:4,content_hash:'a'.repeat(64),review_version:7,review_hash:'b'.repeat(64),eligible:true,
 payload:{title:'待选择资料 '+id,text:'原始第一段\n原始最后一段',source_url:'https://example.test/display',original_source_url:'https://example.test/original',published_at:'2026-10-01',source_kind:'user_provided',verification:'unverified'},
 review:{company:'测试企业',global_scope:false,status:'accepted',stance:'contradicts',note:'仅限成本口径\n不能用于利润判断',expires_at:'2027-01-01'},...patch});
const refs=docs=>docs.map(e=>Object.fromEntries(['id','version','content_hash','review_version','review_hash'].map(k=>[k,e[k]])));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function reset(){invalidateContext();invalidateInteractions();Object.assign(state,{user:{id:'owner'},identities:[],identity:'',active:'',route:'actions',id:'',dirty:false,cache:{actions:[structuredClone(action)]}});}
function withFetch(fn){const old=globalThis.fetch;globalThis.fetch=fn;return ()=>globalThis.fetch=old;}

test('each choice exposes the review snapshot, scope, stance, versions and separate source verification',()=>{
 reset();const doc=evidence('first'),before=structuredClone(doc),html=actionDetail(action,[doc]);
 for(const text of ['测试企业','反向 / 反驳证据','人工接受','2027-01-01','资料版本 4','审阅版本 7',doc.review.note,doc.payload.text,'https://example.test/display','https://example.test/original','未经独立核验','不代表系统已验证资料真实'])assert(html.includes(text),text);
 assert.match(html,/<details class="action-evidence-source"><summary>查看来源与完整已保存文本<\/summary>/);
 assert.match(html,/name="evidence_ids"[^>]*type="checkbox"/);assert(!html.includes(' checked'));
 assert(html.includes('role="region" tabindex="0"'));assert.deepEqual(doc,before);
 const encoded=html.match(/data-evidence-refs="([^"]+)"/)[1].replaceAll('&quot;','"');
 assert.deepEqual(JSON.parse(encoded),refs([doc]));
});

test('long review and source remain complete, escaped and reachable without additional controls or requests',()=>{
 reset();const doc=evidence('long');doc.review.note='说明开始\n'+'审'.repeat(1950)+'\n说明尾部<script>bad()</script>';doc.payload.text='文本开始\n'+'原'.repeat(119930)+'\n原文尾部<img src=x onerror=bad()>';
 const html=actionDetail(action,[doc]);assert(html.includes(esc(doc.review.note)));assert(html.includes(esc(doc.payload.text)));
 assert(!html.includes('<script>bad()'));assert(!html.includes('<img src=x'));
 assert(!html.includes('data-action="evidence-detail"'));assert.equal((html.match(/<form /g)||[]).length,1);
 const css=readFileSync(new URL('../web/workbench.css',import.meta.url),'utf8');assert.match(css,/\.action-evidence-note,\.action-evidence-text\{[^}]*max-height:[^}]*overflow:auto/);
});

test('mixed company and global evidence retain distinct notes while missing and unreviewed cases never claim acceptance',()=>{
 reset();const accepted=evidence('accepted'),unreviewed=evidence('unreviewed',{review:{company:'',global_scope:true,status:'unreviewed',stance:'context',note:''}});
 unreviewed.payload.source_kind='search_snippet';unreviewed.payload.verification='search_snippet_unverified';delete unreviewed.payload.original_source_url;
 const html=actionDetail(action,[accepted,unreviewed,evidence('foreign',{review:{company:'另一企业'}}),evidence('excluded',{eligible:false}),evidence('missing',{review:null})]);
 for(const text of ['通用资料 / 所有企业','背景资料','尚未审阅','尚未填写审阅依据','搜索摘要（非网页全文）','不是来源网页全文','原始采集地址：未单独记录；当前记录地址：'])assert(html.includes(text),text);
 assert.equal((html.match(/name="evidence_ids"/g)||[]).length,2);for(const id of ['foreign','excluded','missing'])assert(!html.includes('data-action-evidence="'+id+'"'));
});

test('source without a separately recorded origin stays useful without claiming the current URL is a frozen origin',()=>{
 reset();const doc=evidence('new');delete doc.payload.original_source_url;
 const html=actionDetail(action,[doc]);assert(html.includes('原始采集地址：未单独记录；当前记录地址：'));assert(html.includes('https://example.test/display'));
 doc.payload.original_source_url='';const legacy=actionDetail(action,[doc]);assert(legacy.includes('<p>原始采集地址：未记录</p>'));assert(!legacy.includes('原始采集地址：未单独记录'));
 doc.payload.original_source_url='https://example.test/captured';doc.payload.source_url='https://example.test/edited';
 const edited=actionDetail(action,[doc]);assert.match(edited,/<p>原始采集地址：<a href="https:\/\/example\.test\/captured"/);assert(edited.includes('https://example.test/edited'));
});

test('uploaded extracts and metadata versions do not claim original-file completeness or a changed text revision',()=>{
 reset();const doc=evidence('upload');doc.payload.source_kind='uploaded_document';doc.payload.text='仅保存的提取片段';
 const html=actionDetail(action,[doc]);for(const text of ['资料版本 4','完整已保存文本','可能不等于原文件全文','仅保存的提取片段','已保存文本指纹'])assert(html.includes(text),text);
 assert(!html.includes('原文版本 4'));assert(!html.includes('查看来源与完整原文'));
});

const app=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
function harness(docs=[evidence('one'),evidence('two')]){
 const listeners={},document={addEventListener:(name,fn)=>listeners[name]=fn};
 const submit={disabled:false},error={textContent:'',isConnected:true};
 class Form{constructor(){this.id='action-transition-form';this.dataset={id:action.id,version:String(action.version),evidenceRefs:JSON.stringify(refs(docs))};this.values={status:'done',note:'逐份核对后保留本次人工结论',evidence_ids:['one']};this.isConnected=true;}reportValidity(){return true;}querySelector(selector){return selector==='.form-error'?error:submit;}}
 class Data extends FormData{constructor(form){super();for(const [k,v]of Object.entries(form?.values??{}))for(const part of Array.isArray(v)?v:[v])this.append(k,part);}}
 class Button{constructor(actionName='action-detail'){this.dataset={action:actionName,id:action.id};this.disabled=false;}setAttribute(){}removeAttribute(){}}
 const inspector={innerHTML:'',open:false,closed:0,showModal(){this.open=true;},close(){this.open=false;this.closed++;}},modal={open:false,close(){this.open=false;}},toasts=[],renders=[];
 const values={document,state,HTMLFormElement:Form,HTMLButtonElement:Button,FormData:Data,esc,button,icon,invalidateInteractions,actionDetail,contextGuard,interactionGuard,continuationGuard,unchangedInputGuard,finishMutation,workspace,ApiError,modal,inspector,toast:t=>toasts.push(t),read:form=>{const f=new Data(form);return {f,str:k=>String(f.get(k)??'').trim(),list:k=>f.getAll(k).map(String)};},formSnapshot:form=>JSON.stringify([...new Data(form)]),refreshData:async valid=>valid(),render:async()=>renders.push('render'),showSyncNotice:()=>{}};
 const inspectSource=app.slice(app.indexOf('function inspect('),app.indexOf('function download('));
 const submitSource=app.slice(app.indexOf("document.addEventListener('submit',"),app.indexOf("document.addEventListener('click',"));
 const clickSource=app.slice(app.indexOf("document.addEventListener('click',"),app.indexOf("document.addEventListener('input',"));
 new Function(...Object.keys(values),'let syncPending=false;'+inspectSource+submitSource+clickSource)(...Object.values(values));
 const form=new Form();const click=target=>listeners.click({target:{closest:()=>target},preventDefault(){}});
 return {form,submit,error,inspector,modal,toasts,renders,click,open:()=>click(new Button()),close:()=>click(new Button('close-inspector')),save:()=>listeners.submit({target:form,preventDefault(){}})};
}

test('read detail disclosure dispatches no action and preserves note and mixed selection',async()=>{
 reset();const docs=[evidence('one'),evidence('two')],h=harness(docs),calls=[],restore=withFetch(async(url,options)=>{calls.push({url,options});return json({items:docs});});
 try{await h.open();h.form.values.evidence_ids=['two','one'];state.dirty=true;const before=structuredClone(h.form.values),html=h.inspector.innerHTML;
  await h.click(null);await h.click(null);assert.deepEqual(h.form.values,before);assert.equal(h.inspector.innerHTML,html);assert.equal(calls.length,1);assert.equal(calls[0].options.method,'GET');assert(state.dirty);
 }finally{restore();}
});

test('409 leaves the current draft, explicit selection and viewed hashes intact without retry or reselect',async()=>{
 reset();const docs=[evidence('one'),evidence('two')],h=harness(docs),calls=[],before=structuredClone(h.form.values),restore=withFetch(async(url,options)=>{calls.push(JSON.parse(options.body));return json({error:{code:'ACTION_EVIDENCE_CHANGED',message:'审阅已变化，请重新核对选择'}},409);});
 try{h.inspector.open=true;state.dirty=true;await h.save();assert.equal(calls.length,1);assert.deepEqual(calls[0].evidence_refs,refs([docs[0]]));assert.deepEqual(h.form.values,before);assert.equal(h.form.dataset.evidenceRefs,JSON.stringify(refs(docs)));assert.equal(h.inspector.closed,0);assert(h.error.textContent.includes('重新核对'));assert.equal(h.submit.disabled,false);assert.deepEqual(h.renders,[]);
 }finally{restore();}
});

for(const boundary of ['dismiss','navigate','newer-inspector'])test('late catalog cannot open over '+boundary,async()=>{
 reset();const h=harness(),wait=deferred(),restore=withFetch(()=>wait.promise);
 try{const opening=h.open();invalidateInteractions();if(boundary==='dismiss')await h.close();if(boundary==='navigate')state.route='evidence';if(boundary==='newer-inspector'){h.inspector.innerHTML='新窗口正在编辑';h.inspector.open=true;}
  wait.resolve(json({items:[evidence('late')]}));await opening;assert(!h.inspector.innerHTML.includes('待选择资料 late'));if(boundary==='newer-inspector')assert.equal(h.inspector.innerHTML,'新窗口正在编辑');else assert(!h.inspector.open);
 }finally{restore();}
});

for(const boundary of ['edit','dismiss','newer-inspector'])test('late successful transition preserves '+boundary+' and does not reselect',async()=>{
 reset();const h=harness(),wait=deferred(),calls=[],restore=withFetch(async(url,options)=>{calls.push(JSON.parse(options.body));return wait.promise;});
 try{h.inspector.open=true;state.dirty=true;const saving=h.save();await h.save();assert.equal(calls.length,1);
  if(boundary==='edit'){h.form.values.note='提交后继续补充的新记录';h.form.values.evidence_ids=['two'];}else{invalidateInteractions();if(boundary==='dismiss'){await h.close();h.form.isConnected=false;}else h.inspector.innerHTML='新窗口正在编辑';}
  wait.resolve(json({...action,version:4}));await saving;assert.deepEqual(h.renders,[]);assert(state.dirty);if(boundary==='edit'){assert.equal(h.form.values.note,'提交后继续补充的新记录');assert.deepEqual(h.form.values.evidence_ids,['two']);}if(boundary==='newer-inspector')assert.equal(h.inspector.innerHTML,'新窗口正在编辑');
 }finally{restore();}
});
