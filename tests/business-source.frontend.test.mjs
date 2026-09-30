import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePanel,sourceForm,formSource,acceptanceEvidence} from '../web/dist/business-source.js';
import {actionForm,actionDetail} from '../web/dist/views-analysis.js';
import {watchForm} from '../web/dist/views-services.js';
import {assessmentForm} from '../web/dist/views-orchestrator.js';
import {state} from '../web/dist/state.js';
const hash='a'.repeat(64);
function setup(){state.user={name:'研究员',preferences:{amount_unit:'yuan'}};state.identities=[];state.identity='';state.active='first';state.datasets=[{id:'first',version:2,content_hash:hash,payload:{company:'第一企业',name:'数据一'}},{id:'second',version:4,content_hash:'b'.repeat(64),payload:{company:'第二企业',name:'数据二'}}];}

test('historical source form requires explicit acknowledgement and never invents one',()=>{
 const ref={kind:'report',run_id:'old-report'};const html=sourceForm(ref);
 assert(html.includes('name="allow_historical"'));assert(!html.includes('checked'));
 const f=new FormData();f.set('source_ref',JSON.stringify(ref));assert.deepEqual(formSource(f),{source_ref:{...ref,allow_historical:false}});
 f.set('allow_historical','on');assert.equal(formSource(f).source_ref.allow_historical,true);
});
test('watch source follows selected dataset from frozen form options, not globally active dataset',()=>{
 setup();const html=watchForm();assert(html.includes('name="source_datasets"'));
 const f=new FormData();f.set('source_datasets',JSON.stringify({first:{version:2,hash},second:{version:4,hash:'b'.repeat(64)}}));f.set('dataset_id','second');
 assert.deepEqual(formSource(f),{source_ref:{kind:'dataset',dataset_version:4,dataset_hash:'b'.repeat(64)}});
 f.set('dataset_id','unlisted');assert.throws(()=>formSource(f),/来源范围/);
});
test('report watch locks its dataset and preserves explicit provenance without retargeting',()=>{
 setup();const html=watchForm(null,{title:'历史报告跟踪',dataset_id:'second',source_ref:{kind:'report',run_id:'r'}});
 assert(html.includes('disabled'));assert(html.includes('name="dataset_id" value="second" type="hidden"'));
 assert(html.includes('name="allow_historical"'));assert(!html.includes('source_datasets'));
});
test('action from a nonactive dataset uses its own company and frozen data context',()=>{
 setup();const html=actionForm({dataset_id:'second',title:'核查'});
 assert(html.includes('value="第二企业"'));assert(!html.includes('value="第一企业"'));
 assert(html.includes('&quot;dataset_version&quot;:4'));
});
test('unavailable report preserves historical values but omits a dead navigation link',()=>{
 const html=sourcePanel({payload:{provenance:{dataset_version:1,dataset_hash:hash,company:'<script>',run_id:'gone',captured_at:'2026-01-01'}},source_impact:{state:'unavailable',reasons:[{code:'report_removed',message:'报告已删除'}],current:{version:3}}});
 assert(html.includes('原始数据修订 1'));assert(html.includes('当前数据修订 3'));assert(!html.includes('data-route="agents:run-gone"'));assert(!html.includes('<script>'));
 assert(sourcePanel({payload:{}}).includes('不能推定'));
});
test('acceptance snapshot shows bounded original text and explicit truncation even after live source deletion',()=>{
 const html=acceptanceEvidence({evidence_snapshots:[{id:'deleted',title:'原始证据',version:1,review_version:2,content_hash:hash,text:'<img src=x>',text_length:15000,text_truncated:true,review:{note:'当时审阅'}}]});
 assert(html.includes('15000'));assert(html.includes('前 12,000'));assert(html.includes('原始证据'));assert(!html.includes('<img src=x>'));
});
test('changed claim reviews require a fresh unchecked replay consent and show human dispute separately',()=>{
 const html=assessmentForm({version:2,payload:{verdict:'useful',note:'历史反馈',consent_replay:true},feedback_context:{state:'changed',message:'复核意见已变化'}},{hash,items:[{payload:{verdict:'rejected',note:'<img>依据不足'}}]});
 assert(html.includes('复核意见已变化'));assert(html.includes('这不表示接受模型解释'));assert(!html.includes('name="consent_replay" checked'));assert(html.includes('data-review-context-hash="'+hash+'"'));assert(!html.includes('<img>'));
});

import {renewSavedDraft} from '../web/dist/interactions.js';
test('known-success create can rotate a changed draft token, while same draft and disconnected form keep it',()=>{
 let key='old',draft='changed';assert(renewSavedDraft('original',()=>draft,()=>key='new'));assert.equal(key,'new');
 key='old';assert(!renewSavedDraft('original',()=>null,()=>key='new'));assert.equal(key,'old');
 assert(!renewSavedDraft('original',()=> 'original',()=>key='new'));assert.equal(key,'old');
});

import {continueInsightDraft} from '../web/dist/business-source.js';
test('known-created insight action keeps the newer draft as an explicit versioned edit with required reason',()=>{
 const inserted=[],button={textContent:''},fields={title:'新标题',acceptance:'用户尚未提交的新标准'};
 const form={id:'action-form',dataset:{sourceKey:'insight-a'},insertAdjacentHTML:(where,html)=>inserted.push(html),querySelector:s=>s==='.form-footer'?{insertAdjacentHTML:(where,html)=>inserted.push(html)}:button,fields};
 assert(continueInsightDraft(form,{id:'created-a',version:1,payload:{status:'open'}}));assert.equal(form.id,'action-edit-form');assert.equal(form.dataset.id,'created-a');assert.equal(form.dataset.version,'1');
 assert.equal(form.fields.acceptance,'用户尚未提交的新标准');assert.equal(button.textContent,'保存此行动的修改');assert(inserted.some(h=>h.includes('name="note"')&&h.includes('required')));assert(inserted.some(h=>h.includes('同一行动')));
 const normal={dataset:{}};assert(!continueInsightDraft(normal,{id:'normal',payload:{status:'open'}}));
});

test('frozen excerpts and source hashes have readable multiline and narrow-screen wrapping',async()=>{
 const {readFileSync}=await import('node:fs');const css=readFileSync(new URL('../web/workbench.css',import.meta.url),'utf8');
 assert.match(css,/\.preserve-lines\{[^}]*white-space:pre-wrap[^}]*overflow-wrap:anywhere/);
 assert.match(css,/\.business-source p,\.timeline-entry small\{overflow-wrap:anywhere/);
});
