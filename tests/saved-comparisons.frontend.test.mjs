/** Synthetic renderer/transport/race regressions; not native-browser or provider evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {frozenComparisonMembers,displayedComparisonMembers,comparisonPreviewDraft,comparisonSaveForm,comparisonCreateRequest,comparisonProblem,comparisonArtifactView,comparisonResultView,comparisonReceiptView,comparisonSelection,selectedComparisonRequest,syncComparisonControls,savedComparisonPage,comparisonIndex} from '../web/dist/saved-comparisons.js';
import {sourcePanel} from '../web/dist/business-source.js';
import {state} from '../web/dist/state.js';
import {invalidateView,invalidateContext,ApiError} from '../web/dist/api.js';
import {interactionGuard,invalidateInteractions,renewSavedDraft} from '../web/dist/interactions.js';
import {unchangedInputGuard} from '../web/dist/saved-experiments.js';
import {agentsPage,planPage,runPage} from '../web/dist/views-studio.js';
import {mathResult} from '../web/dist/math-results.js';
const datasets=[{id:'a',version:2,content_hash:'a'.repeat(64),payload:{company:'合成主企业',name:'独立季度',periods:[{period:'2025-Q4'}]}},{id:'b',version:4,content_hash:'b'.repeat(64),payload:{company:'合成同行企业',name:'另一口径',periods:[{period:'2025-Q4'}]}}];
const members=datasets.map(d=>({id:d.id,version:d.version,hash:d.content_hash,company:d.payload.company}));
const result={period:'2025-Q4',warning:'同季度用户数据，不是行业排名',items:members.map(m=>({id:m.id,company:m.company,dataset_version:m.version,dataset_hash:m.hash,source_kind:'user_provided',analysis:{metrics:{gross_margin:.25,cash_ratio:null,leverage:.5,revenue_growth:-.02,net_margin:.05}}}))};
const row={id:'comparison-a',version:1,comparison_hash:'c'.repeat(64),created_at:'2026-09-30',source_impact:{state:'current',reasons:[]},payload:{identity_id:'i',name:'已明确保存的同行对照',comparison:'previous',period:'2025-Q4',period_basis:'standalone_quarter',analysis_as_of:'2026-09-30',comparability_note:'不同企业产品结构需要核对，不代表行业样本',members,result}};
const frozen={id:row.id,version:row.version,hash:row.comparison_hash,payload:row.payload};
function reset(){invalidateView();invalidateContext();invalidateInteractions();Object.assign(state,{identity:'i',active:'a',identities:[{id:'i',payload:{name:'合成研究视角',dataset_ids:['a','b'],allow_external:false,max_calls:1,depth:'balanced'}}],datasets:structuredClone(datasets),cache:{},query:'已有普通研究问题',user:{id:'owner',name:'研究员',preferences:{amount_unit:'wan'}}});}
function json(data){return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});}
function createData(draft=comparisonPreviewDraft(result,members,'previous','i')){const fd=new FormData();for(const [k,v] of Object.entries(draft))fd.set(k,k==='datasets'?JSON.stringify(v):String(v));fd.set('name','用户输入名称');fd.set('comparability_note','明确说明可比性条件及使用限制');return fd;}
function planResponse(){return {id:'plan-a',version:1,payload:{request:{query:'2025-Q4研究'},status:'draft',snapshot:{dataset:datasets[0].payload,research_scope:{period:'2025-Q4',notice:'按批准对照锁定季度'},citations:[],memory:[],comparison_artifact:frozen},max_calls:1,packing:{characters:1200,limit:10000,dropped:[],included_memory_ids:[]},nodes:[],context:{},consent_scope:['同行派生指标；不发送完整同行财务快照'],quality:{closed_quarters:4,field_coverage:{present:3,total:3},warning_count:0,findings:[]},excluded_memory:[],blockers:[],fingerprint:'f'.repeat(64),bindings:{}}};}

test('member bindings come only from explicit 2–8 current-scope selections',()=>{
 assert.deepEqual(frozenComparisonMembers(['b','a'],datasets),[members[1],members[0]].map(({company,...m})=>m));
 for(const ids of [[],['a'],['a','a'],['a','foreign'],Array(9).fill('a')])assert.throws(()=>frozenComparisonMembers(ids,datasets));
 assert.throws(()=>frozenComparisonMembers(['a','b'],[datasets[0],{...datasets[1],content_hash:'bad'}]));
});
test('displayed bindings are not silently replaced by a newer state cache',()=>{
 const fd=new FormData();fd.append('dataset_ids','a');fd.append('dataset_ids','b');fd.set('displayed_bindings',JSON.stringify(members));
 const later=[{...datasets[0],version:3,content_hash:'d'.repeat(64)},datasets[1]];
 assert.equal(displayedComparisonMembers(fd,later)[0].version,2);
 assert.throws(()=>comparisonPreviewDraft({...result,items:[{...result.items[0],dataset_version:3},result.items[1]]},displayedComparisonMembers(fd,later),'previous','i'),/已有变化/);
 assert.throws(()=>displayedComparisonMembers(fd,[datasets[0]]),/身份范围/);
});
test('preview/save freezes exact result membership, version, mode and quarter',()=>{
 const input=frozenComparisonMembers(['a','b'],datasets);const draft=comparisonPreviewDraft(result,input,'previous','i');input[0].version=99;
 assert.throws(()=>comparisonPreviewDraft(result,members,'constructor','i'));assert.equal(draft.datasets[0].version,2);assert.equal(draft.target_period,'2025-Q4');assert.equal(draft.comparison,'previous');
 for(const bad of [{...result,items:[result.items[0],result.items[0]]},{...result,items:result.items.slice(1)},{...result,items:[{...result.items[0],dataset_hash:'e'.repeat(64)},result.items[1]]}])assert.throws(()=>comparisonPreviewDraft(bad,members,'previous','i'));
 const body=comparisonCreateRequest(createData(draft),'i','retry-comparison-001');assert.equal(body.request_id,'retry-comparison-001');assert.deepEqual(body.datasets,draft.datasets);
 assert.throws(()=>comparisonCreateRequest(createData(draft),'other','retry-comparison-001'),/身份/);
 assert.throws(()=>comparisonCreateRequest(createData(draft),'i',''),/标识/);
});
test('save form keeps edited narrative and escapes all displayed source data',()=>{
 const html=comparisonSaveForm({...comparisonPreviewDraft(result,members,'previous','i'),name:'<script>name</script>',comparability_note:'<img src=x>可比性'});
 assert(html.includes('comparison-save-form')&&html.includes('data-request-id=')&&html.includes('name="datasets"'));
 assert(html.includes('&lt;script&gt;name&lt;/script&gt;')&&html.includes('&lt;img src=x&gt;'));
 assert(!html.includes('<script>')&&!html.includes('<img src=x>'));assert(html.includes('2025-Q4')&&html.includes('上一季度'));
});
test('artifact selection rejects stale, deleted, wrong identity and wrong primary member',()=>{
 assert.equal(comparisonProblem(row,datasets,'i'),'');assert.deepEqual(selectedComparisonRequest(row,'b',datasets,'i'),{id:row.id,version:1,hash:row.comparison_hash});
 for(const [r,data,identity,primary] of [[null,datasets,'i','a'],[row,datasets,'other','a'],[row,[datasets[0]],'i','a'],[row,[datasets[0],{...datasets[1],version:5}],'i','a'],[row,datasets,'i','outside'],[{...row,source_impact:{state:'unavailable',reasons:[{message:'同行已删除'}]}},datasets,'i','a']])assert.throws(()=>selectedComparisonRequest(r,primary,data,identity));
});
function controls(value=row.id){const selector={value},mode={value:'year_over_year',disabled:false,dataset:{}},detail={innerHTML:''};const form={querySelector(s){return s==='#plan-comparison'?selector:s==='[name="comparison"]'?mode:s==='#selected-comparison-details'?detail:null;}};return {root:{querySelector(){return form;}},selector,mode,detail};}
test('comparison mode locks explicitly and deselect restores untouched draft choice',()=>{
 const dom=controls();syncComparisonControls(dom.root,[row],datasets,'i');assert(dom.mode.disabled);assert.equal(dom.mode.value,'previous');assert(dom.detail.innerHTML.includes('合成同行企业'));
 assert(dom.detail.innerHTML.includes('下一步')&&dom.detail.innerHTML.includes('批准')&&dom.detail.innerHTML.includes('2025-Q4'));
 dom.selector.value='';syncComparisonControls(dom.root,[row],datasets,'i');assert.equal(dom.mode.disabled,false);assert.equal(dom.mode.value,'year_over_year');assert.equal(dom.detail.innerHTML,'');
 dom.selector.value='deleted';syncComparisonControls(dom.root,[row],datasets,'i');assert(dom.detail.innerHTML.includes('已删除'));
});
test('comparison views render frozen ratios and limits without inventing missing values',()=>{
 const safe=comparisonResultView(result);assert(safe.includes('25%')&&safe.includes('−')===false);assert(safe.includes('—'));assert(safe.includes('不是行业排名'));
 const artifact=comparisonArtifactView(frozen);for(const text of ['合成主企业','合成同行企业','2025-Q4','独立单季度',row.payload.comparability_note,row.comparison_hash,members[1].hash])assert(artifact.includes(text));
 const malicious={...frozen,payload:{...row.payload,name:'<svg onload=x>',comparability_note:'<script>bad</script>'}};
 assert(!comparisonArtifactView(malicious).includes('<script>'));assert(!comparisonArtifactView(malicious).includes('<svg onload=x>'));
 assert(comparisonSelection([row],row.id).includes('selected'));
 assert(mathResult('comparison',{...result,status:'completed',comparison_provenance:{...frozen,...row.payload}}).includes('共同季度企业对照'));
});
test('bounded receipt survives deleted report with five labeled ratios and independent hashes',()=>{
 const receipt={...frozen,projection_hash:'e'.repeat(64),payload:{...row.payload,summary_notice:'有界归档摘要，不包含完整成员快照',units:{net_margin:'ratio'}}};
 const html=comparisonReceiptView(receipt);assert(html.includes('净利率（%）')&&html.includes('5%'));assert(!html.includes('现金流（元）'));assert(html.includes(receipt.projection_hash)&&html.includes(receipt.hash));assert(html.includes('不包含完整成员快照'));
 const panel=sourcePanel({payload:{provenance:{run_id:'removed-run',comparison_reference:receipt}},source_impact:{state:'unavailable',reasons:[{code:'report_removed',message:'原报告已清理'}]}});
 assert(panel.includes('合成同行企业')&&panel.includes('25%'));assert(!panel.includes('data-route="agents:run-removed-run"'));
});
test('known-corrupt receipt is quarantined without rendering purported frozen numbers or losing the original report link',()=>{
 for(const reference of [{...frozen,projection_hash:'bad'}, {...frozen,payload:{...row.payload,members:'malformed'}}, {}, null]){
  const value={payload:{provenance:{run_id:'original-report',comparison_reference:reference}},source_impact:{state:'unavailable',reasons:[{code:'comparison_receipt_changed',message:'行动归档的对照摘要校验不一致'}]}};
  const before=structuredClone(value);const panel=sourcePanel(value);
  assert(panel.includes('归档对照摘要校验失败'));assert(panel.includes('停止展示其中的指标'));
  assert(!panel.includes('原始企业对照摘要'));assert(!panel.includes('25%'));
  assert(panel.includes('data-route="agents:run-original-report"'));assert.deepEqual(value,before);
 }
});
test('healthy historic receipts remain readable after peer updates or original comparison removal',()=>{
 for(const reason of ['comparison_member_changed','comparison_removed']){
  const panel=sourcePanel({payload:{provenance:{run_id:'original-report',comparison_reference:{...frozen,projection_hash:'e'.repeat(64)}}},source_impact:{state:reason==='comparison_removed'?'unavailable':'changed',reasons:[{code:reason,message:'来源已变化'}]}});
  assert(panel.includes('原始企业对照摘要'));assert(panel.includes('25%'));
  assert(!panel.includes('停止展示其中的指标'));assert(panel.includes('data-route="agents:run-original-report"'));
 }
});
test('saved detail exposes all original inputs but removes transfer controls when stale',async()=>{
 reset();const old=globalThis.fetch;let response=row;const requests=[];globalThis.fetch=async(url,init)=>{requests.push({url,method:init.method});return json(response);};
 try{const html=await savedComparisonPage(row.id);assert(html.includes('comparison-transfer-form')&&html.includes('name="primary_dataset_id"'));assert(html.includes('value=""'));assert(html.includes('合成同行企业'));
 response={...row,source_impact:{state:'changed',reasons:[{code:'comparison_member_changed',message:'同行财务输入已修订'}]}};
 const stale=await savedComparisonPage(row.id);assert(!stale.includes('<form id="comparison-transfer-form"'));assert(stale.includes('同行财务输入已修订')&&stale.includes('25%'));assert(requests.every(r=>r.method==='GET'&&r.url.includes('identity_id=i')));
 }finally{globalThis.fetch=old;}
});
test('late comparison reads never overwrite a newer page or identity cache',async()=>{
 for(const invalidate of [invalidateView,invalidateContext]){reset();const old=globalThis.fetch;let resolve;globalThis.fetch=()=>new Promise(r=>resolve=r);try{const pending=savedComparisonPage(row.id);invalidate();resolve(json(row));await assert.rejects(pending,ApiError);assert.equal(state.cache.comparison,undefined);}finally{globalThis.fetch=old;}}
});
test('comparison index is explicitly scoped by identity and active member',async()=>{
 reset();const old=globalThis.fetch;let path;globalThis.fetch=async url=>{path=url;return json({items:[row],has_more:false});};try{const html=await comparisonIndex();assert(path.includes('identity_id=i')&&path.includes('dataset_id=a'));assert(html.includes('data-route="compare:comparison-a"'));}finally{globalThis.fetch=old;}
});
test('Agent transfer chooses explicit primary, frozen quarter and all-company selection',async()=>{
 reset();const old=globalThis.fetch;globalThis.fetch=async url=>json(url.includes('/catalog')?{providers:[],capabilities:[]}:url.includes('/comparisons?')?{items:[row]}:{items:[],total:0});
 try{const html=await agentsPage('comparison-'+row.id+':b');assert(html.includes('id="plan-comparison"'));assert(html.includes('<option value="b" selected>'));assert(html.includes('2025-Q4经营研判'));assert(html.includes('<option value="comparison-a" selected>'));
 const normal=await agentsPage();assert(normal.includes('已有普通研究问题'));assert(normal.includes('<option value="a" selected>'));assert(!normal.includes('<option value="comparison-a" selected>'));
 await assert.rejects(agentsPage('comparison-missing:a'),/已删除/);
 }finally{globalThis.fetch=old;}
});
test('approval displays every peer before consent and report retains exportable frozen result',async()=>{
 reset();const old=globalThis.fetch;const plan=planResponse();
 const analysis={metrics:{gross_margin:.25,cash_ratio:null,leverage:.5},series:[],current_period:'2025-Q4',gmps:{method:'local',score:null,coverage:1,dimensions:[]},dqi:{method:'local',score:null,coverage:1,dimensions:[]}};
 const report={id:'run-a',state:'completed',payload:{query:'2025-Q4核查'},snapshot:{dataset:datasets[0].payload,citations:[],memory:[],comparison_artifact:frozen},result:{title:'冻结对照研判',analysis,lineage:[],findings:[],warnings:[],comparison_artifact:frozen,llm:{state:'not_requested',review:{claims:[],rejected_claims:0}}}};
 const audit={ledger:{valid:true},data_hash_valid:true,snapshot_hash_valid:true,report_hash_valid:true,artifacts:[],trace:[],source_impact:{state:'current'}};
 globalThis.fetch=async url=>json(url.includes('/plans/')?plan:url.endsWith('/audit')?{...audit,run:report}:url.endsWith('/reviews')?{items:[]}:report);
 try{const approval=await planPage(plan.id);assert(approval.includes('同行派生指标；不发送完整同行财务快照'));assert(approval.includes('data-comparison-stage="approval"'));assert(approval.includes('合成同行企业')&&approval.includes('comparison-a')&&approval.includes('name="external_consent" required'));
 const rendered=await runPage(report.id);assert(rendered.includes('data-comparison-stage="report"')&&rendered.includes('合成同行企业')&&rendered.includes('25%'));assert(rendered.includes('/api/runs/run-a/export?format=md')&&rendered.includes('/api/runs/run-a/export?format=json'));
 delete report.result.comparison_artifact;delete report.snapshot.comparison_artifact;const legacy=await runPage(report.id);assert(!legacy.includes('data-comparison-stage="report"'));
 }finally{globalThis.fetch=old;}
});
for(const reason of ['navigation','identity','edited draft','form closed'])test('late comparison save preserves '+reason,async()=>{
 reset();let draft='initial';let apply=0;let resolve;const pending=new Promise(r=>resolve=r);const context=interactionGuard();const current=unchangedInputGuard(context,()=>draft);const completed=pending.then(()=>{if(current())apply++;});
 if(reason==='navigation'||reason==='identity')invalidateInteractions();else draft=reason==='form closed'?null:'new user input';resolve();await completed;assert.equal(apply,0);
});
test('unknown create outcomes retain retry identity; only known success renews a newer draft',()=>{
 let token='original-request',draft='submitted';assert.equal(renewSavedDraft('submitted',()=>draft,()=>token='new-request'),false);assert.equal(token,'original-request');draft='newer';assert.equal(renewSavedDraft('submitted',()=>draft,()=>token='new-request'),true);assert.equal(token,'new-request');
 const app=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');const save=app.split("case 'comparison-save-form':")[1].split("case '")[0];assert(save.indexOf("await workspace('/comparisons'")<save.indexOf('renewSavedDraft'));assert(save.includes('unchangedInputGuard')&&save.includes('if(sameContext())')&&save.includes('if(current())navigate'));
 const preview=app.split("case 'compare-form':")[1].split("case '")[0];assert(preview.includes("'#comparison-save-form'"));assert(preview.includes('displayedComparisonMembers(f,scopedDatasets())'));assert(preview.includes('if(!current())'));
 const plan=app.split("case 'plan-form':")[1].split("case '")[0];assert(plan.includes('comparison_artifact:comparisonArtifact')&&plan.includes('selectedComparisonRequest'));
 const views=readFileSync(new URL('../web/saved-comparisons.ts',import.meta.url),'utf8');for(const m of views.matchAll(/<form id="([a-z-]+)"/g))assert(app.includes("case '"+m[1]+"':"));
 const history=readFileSync(new URL('../web/experience.ts',import.meta.url),'utf8');assert(history.includes("row.kind==='comparison'"));
});

test('save explains UTC revalidation while saved artifact date is visible outside JSON',()=>{
 const html=comparisonSaveForm(comparisonPreviewDraft(result,members,'previous','i'));
 assert(html.includes('当日 UTC')&&html.includes('不会替换所选输入版本或季度'));
 const artifact=comparisonArtifactView(frozen);
 assert(artifact.includes('<strong>计算核验日期（UTC）：</strong>2026-09-30'));
});
