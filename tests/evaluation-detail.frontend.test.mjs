/** Isolated saved replay fixtures; compiled rendering and click contracts only.
 * No business records, provider calls, HTTP listener, or native browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contextGuard} from '../web/dist/api.js';
import {evaluationDetail} from '../web/dist/evaluation-detail.js';
import {interactionGuard,invalidateInteractions,continuationGuard} from '../web/dist/interactions.js';
import {button,esc,icon} from '../web/dist/components.js';

const H='a'.repeat(64),OTHER='b'.repeat(64);
const visible=html=>html.replace(/<details>[\s\S]*?<\/details>/g,'');
const occurrences=(html,value)=>html.split(value).length-1;
function fixture(){
 const side={planned_capabilities:['quality','quant','counterevidence','gaps'],covered:['quality','quant','gaps'],missing:['counterevidence'],
  math_hash:H,comparison_hash:null,comparison_provenance:null,node_count:7,
  computations:{quality:{status:'completed',output_hash:H},quant:{status:'completed',output_hash:H},
   counterevidence:{status:'missing',reason:'缺少人工标注的反向资料',limitation:'只执行保存资料的本地分组',group_counts:{supports:2,contradicts:0,context:1},output_hash:H},
   gaps:{status:'needs_input',output_hash:H}}};
 const one={run_id:'synthetic-run-a',partition:'development',source:{query:'为什么毛利率下降？',company:'隔离合成甲公司',target_period:'2026-Q1',dataset_version:3,dataset_hash:H},
  expected:['quality','quant','counterevidence','gaps'],baseline:structuredClone(side),candidate:structuredClone(side),reference_math_hash:H,reference_comparison_hash:null};
 const two=structuredClone(one);two.run_id='synthetic-run-b';two.partition='holdout';two.source.query='本季度反向资料是否齐备？';two.source.company='隔离合成乙公司';
 const evaluation={id:'synthetic-evaluation',payload:{candidate_id:'synthetic-candidate',candidate_version:2,active_version:0,unique_inputs:1,scenario_cases:2,eligible:false,
  blockers:['至少需要3份不同财务输入且明确授权的已完成人工验收案例','保留组仍有未覆盖的人工预期能力'],cases:[one,two]},
  implementation_context:{current:true,message:'本地回放实现版本适用'}};
 const overview={candidates:[{id:'synthetic-candidate',version:2}],active:null,evaluations:[evaluation]};
 return {evaluation,overview,one,two};
}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('saved gate summary distinguishes one financial input from two tasks and exposes concrete blockers',()=>{
 const {evaluation,overview}=fixture();const html=visible(evaluationDetail(evaluation,overview));
 for(const item of ['已保存回放的门槛结果：未通过','<strong>1</strong> 份不同财务输入 / <strong>2</strong> 个验收任务',...evaluation.payload.blockers,
  '不表示当前来源、回放同意或策略基线仍有效','实际激活仍须明确确认','开发组','保留组'])assert(html.includes(item),item);
 assert(!html.includes('data-action="strategy-activate"'));assert(!html.includes('<form'));assert(!html.includes(H));
});
test('each saved task shows its original question, company, quarter, revision and report route',()=>{
 const {evaluation,overview}=fixture();const html=visible(evaluationDetail(evaluation,overview));
 for(const item of ['原问题：为什么毛利率下降？','原问题：本季度反向资料是否齐备？','隔离合成甲公司','隔离合成乙公司','目标季度：2026-Q1','原数据修订：第 3 次修订','data-route="agents:run-synthetic-run-a"','data-route="agents:run-synthetic-run-b"'])assert(html.includes(item),item);
 assert.equal(occurrences(html,'data-replay-case='),2);assert.equal(occurrences(html,'按人工预期能力逐项对照'),2);
});
test('capability rows separate plan, actual execution and coverage with the missing-input reason',()=>{
 const {evaluation,overview,one}=fixture();evaluation.payload.cases=[one];
 one.baseline.planned_capabilities=one.baseline.planned_capabilities.filter(x=>x!=='counterevidence');delete one.baseline.computations.counterevidence;
 const html=visible(evaluationDetail(evaluation,overview));
 for(const item of ['人工预期能力','基线','候选','数据核验','量化计算','反向对照','缺口清单','未计划','未记录实际执行','已计划','已执行 · 缺少所需资料','未满足','缺少人工标注的反向资料','已执行 · 需要补充输入','满足的是缺口清单要求，所缺资料仍未补齐'])assert(html.includes(item),item);
 assert(html.includes('未计划此能力，也未记录本地执行产物'));
});
test('counterevidence quantities distinguish zero from absent and labels never claim effective refutation',()=>{
 const {evaluation,overview,one}=fixture();evaluation.payload.cases=[one];delete one.baseline.computations.counterevidence;
 const html=visible(evaluationDetail(evaluation,overview));
 for(const item of ['支持资料：2 条','反向资料：0 条（未提供此类资料）','背景资料：1 条','反向资料：未记录','未记录反向分组执行','标签不证明有效反证或事实正确性','本次执行的限制：只执行保存资料的本地分组'])assert(html.includes(item),item);
});
test('a covered local counterevidence result shows nonzero opposing material without claiming factual validation',()=>{
 const {evaluation,overview,one}=fixture();evaluation.payload.cases=[one];one.expected=['counterevidence'];
 one.candidate.covered=['counterevidence'];one.candidate.missing=[];
 Object.assign(one.candidate.computations.counterevidence,{status:'completed',reason:'已纳入人工标注的反向资料',group_counts:{supports:0,contradicts:2,context:1}});
 const html=visible(evaluationDetail(evaluation,overview));
 for(const item of ['支持资料：0 条（未提供此类资料）','反向资料：2 条','已执行 · 完成','满足已标注要求','已纳入人工标注的反向资料','标签不证明有效反证或事实正确性'])assert(html.includes(item),item);
});
test('matching math and explicit unselected comparison are readable without opening the hash record',()=>{
 const {evaluation,overview,one}=fixture();evaluation.payload.cases=[one];const full=evaluationDetail(evaluation,overview),html=visible(full);
 assert.equal(occurrences(html,'与原报告一致'),2);assert.equal(occurrences(html,'原任务未选企业对照（不适用）'),2);
 assert(!html.includes(H));assert(full.includes(H));assert(!full.includes('<details open'));assert(full.includes('完整评估 JSON 与技术摘要'));
});
test('selected comparison has independent baseline and candidate agreement checks',()=>{
 const {evaluation,overview,one}=fixture();evaluation.payload.cases=[one];one.reference_comparison_hash=H;
 one.baseline.comparison_hash=H;one.candidate.comparison_hash=OTHER;
 one.baseline.comparison_provenance={id:'synthetic-comparison',hash:H};one.candidate.comparison_provenance={id:'synthetic-comparison',hash:H};
 one.candidate.math_hash=OTHER;const html=visible(evaluationDetail(evaluation,overview));
 assert.equal(occurrences(html,'与原报告一致'),2);assert.equal(occurrences(html,'与原报告不一致'),2);assert(!html.includes('不适用'));
});
test('missing or malformed hashes never compare equal, including undefined and null pairs',()=>{
 for(const invalid of [undefined,null,'','not-a-hash','abc']){
  const {evaluation,overview,one}=fixture();evaluation.payload.cases=[one];one.reference_math_hash=invalid;one.baseline.math_hash=invalid;one.candidate.math_hash=invalid;
  delete one.reference_comparison_hash;delete one.baseline.comparison_hash;delete one.candidate.comparison_hash;
  const html=visible(evaluationDetail(evaluation,overview));assert.equal(occurrences(html,'无法核对（摘要缺失或格式无效）'),4);assert(!html.includes('与原报告一致'));assert(!html.includes('不适用'));
 }
});
test('comparison is not marked unselected if any frozen comparison selection remains',()=>{
 const {evaluation,overview,one}=fixture();evaluation.payload.cases=[one];one.candidate.comparison_provenance={id:'synthetic-comparison'};
 const html=visible(evaluationDetail(evaluation,overview));assert(!html.includes('不适用'));assert.equal(occurrences(html,'无法核对（摘要缺失或格式无效）'),2);
});
test('old records keep historical coverage without fabricated source, execution or authorization',()=>{
 const {evaluation,overview,one}=fixture();evaluation.payload.cases=[one];delete evaluation.implementation_context;delete one.source;delete one.baseline.planned_capabilities;delete one.baseline.computations;
 const html=visible(evaluationDetail(evaluation,overview));
 for(const item of ['当前回放实现适用性未记录','原问题：未记录','企业：未记录','目标季度：未记录','原数据修订：未记录','计划情况未记录','未记录实际执行','历史规则记为满足'])assert(html.includes(item),item);
 assert(!html.includes('满足已标注要求'));assert(!html.includes('可进入激活复核'));assert(!html.includes('第 0 次'));
});
test('explicit historical implementation and changed current versions cannot suggest direct activation',()=>{
 const {evaluation,overview}=fixture();evaluation.payload.eligible=true;evaluation.payload.blockers=[];evaluation.implementation_context={current:false,message:'这是历史回放实现，须重新回放'};
 overview.candidates[0].version=3;overview.active={version:4};const html=visible(evaluationDetail(evaluation,overview));
 for(const item of ['已保存回放的门槛结果：通过','不可按此记录直接激活','这是历史回放实现，须重新回放','候选版本已变化','当前策略基线版本已变化'])assert(html.includes(item),item);
 assert(!html.includes('可进入激活复核'));
});
test('saved pass and current implementation only permit a server activation recheck, never a new control',()=>{
 const {evaluation,overview}=fixture();evaluation.payload.eligible=true;evaluation.payload.blockers=[];const html=visible(evaluationDetail(evaluation,overview));
 for(const item of ['已保存回放的门槛结果：通过','可进入激活复核（尚未激活）','这不代表当前激活授权已确认','回放实现版本适用','服务端重新核对当前案例、来源、回放同意、候选和基线'])assert(html.includes(item),item);
 assert(!html.includes('data-action='));
});
test('inconsistent and incomplete execution cannot appear as a verified current satisfaction',()=>{
 const {evaluation,overview,one}=fixture();evaluation.payload.cases=[one];one.expected=['quant','counterevidence'];
 one.baseline.covered=['quant','counterevidence'];one.baseline.computations.quant={};one.candidate.covered=['counterevidence'];
 const html=visible(evaluationDetail(evaluation,overview));assert(html.includes('保存记录记为满足，执行依据不足'));assert(html.includes('记录不一致，无法确认满足'));assert(!html.includes('满足已标注要求'));
});
test('missing payload and malformed optional saved fields are honest and render without throwing',()=>{
 for(const value of [null,undefined,[],{payload:null}])assert(evaluationDetail(value).includes('当前回放记录已不可用'));
 const html=visible(evaluationDetail({payload:{cases:[{expected:null,source:[],baseline:null,candidate:[]}],blockers:null,unique_inputs:-1,scenario_cases:'3'}}));
 for(const item of ['门槛结果：未记录','未记录人工预期能力','原报告入口未记录','<strong>未记录</strong> 份不同财务输入'])assert(html.includes(item),item);
 assert(!html.includes('undefined'));assert(!html.includes('NaN'));
});
test('all saved prose, routes and full JSON are escaped and rendering neither mutates nor fetches',()=>{
 const {evaluation,overview,one}=fixture();const attack='</p><img src=x onerror="bad()"><script>bad()</script>';
 evaluation.payload.blockers=[attack];evaluation.implementation_context={current:false,message:attack};
 Object.assign(one.source,{query:attack,company:attack,target_period:attack,dataset_hash:attack});one.run_id='x" onclick="bad()';one.expected=[attack];
 one.candidate.computations.counterevidence.reason=attack;one.candidate.computations.counterevidence.limitation=attack;
 const before=JSON.stringify({evaluation,overview});freeze(evaluation);freeze(overview);const old=globalThis.fetch;globalThis.fetch=()=>assert.fail('Read-only renderer made a request');
 try{const html=evaluationDetail(evaluation,overview);assert(html.includes('&lt;img'));assert(html.includes('&quot;'));assert(!html.includes('<script>'));assert(!html.includes('<img src=x'));assert(!html.includes('" onclick="bad()'));assert.equal(JSON.stringify({evaluation,overview}),before);}finally{globalThis.fetch=old;}
});

test('actual detail click opens the saved readable inspector with no request and tolerates stale selection',async()=>{
 const app=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
 const start=app.indexOf("document.addEventListener('click',"),end=app.indexOf("document.addEventListener('input',",start);
 const inspectStart=app.indexOf('function inspect('),inspectEnd=app.indexOf('function download(',inspectStart);
 const {evaluation,overview}=fixture(),listeners={},state={cache:{evolution:overview}},toasts=[];
 class Button{constructor(id){this.dataset={action:'evaluation-detail',id};this.disabled=false;}closest(){return this;}setAttribute(){}removeAttribute(){}}
 const inspector={innerHTML:'',open:false,showModal(){this.open=true;}},document={addEventListener:(name,handler)=>listeners[name]=handler};
 const env={document,state,HTMLButtonElement:Button,inspector,evaluationDetail,contextGuard,interactionGuard,invalidateInteractions,continuationGuard,esc,icon,button,toast:t=>toasts.push(t)};
 new Function(...Object.keys(env),app.slice(inspectStart,inspectEnd)+app.slice(start,end))(...Object.values(env));
 const old=globalThis.fetch;globalThis.fetch=()=>assert.fail('Opening saved detail made a request');
 try{await listeners.click({target:new Button(evaluation.id)});assert.equal(inspector.open,true);assert(inspector.innerHTML.includes('原问题：为什么毛利率下降？'));assert(inspector.innerHTML.includes('逐例回放与门槛依据'));
  await listeners.click({target:new Button('deleted-evaluation')});assert(inspector.innerHTML.includes('当前回放记录已不可用'));assert.deepEqual(toasts,[]);
 }finally{globalThis.fetch=old;}
});
