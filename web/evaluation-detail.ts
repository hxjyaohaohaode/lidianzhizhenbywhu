import type {Json} from './api.js';
import {badge,esc,jsonView,notice,routeButton,table} from './components.js';

const capabilityNames:Record<string,string>={quality:'数据核验',quant:'量化计算',evidence:'证据检索',counterevidence:'反向对照',forecast:'预测回测',sensitivity:'情景计算',comparison:'企业对照',gaps:'缺口清单'};
const record=(value:Json):Json=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const list=(value:Json):Json[]=>Array.isArray(value)?value:[];
const strings=(value:Json):string[]=>list(value).filter((x:Json)=>typeof x==='string');
const text=(value:Json,fallback='未记录'):string=>typeof value==='string'&&value.trim()?value:fallback;
const count=(value:Json):string=>Number.isSafeInteger(value)&&value>=0?String(value):'未记录';
const hash=(value:Json):boolean=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);

function applicability(evaluation:Json,evolution:Json){
 const p=record(evaluation.payload),context=record(evaluation.implementation_context),reasons:string[]=[];
 if(context.current!==true)reasons.push(text(context.message,context.current===false?'这是历史实现下的回放，须重新回放后再决定是否激活':'当前回放实现适用性未记录，不能确认可激活'));
 if(Array.isArray(evolution.candidates)){
  const candidate=evolution.candidates.find((c:Json)=>c?.id===p.candidate_id);
  if(!candidate)reasons.push('候选已不在当前列表，不能沿用此回放激活');
  else if(candidate.version!==p.candidate_version)reasons.push('候选版本已变化，须重新回放');
 }
 if(Object.hasOwn(evolution,'active')&&p.active_version!== (evolution.active?.version??0))reasons.push('当前策略基线版本已变化，须重新回放');
 return {current:context.current===true,reasons};
}

function execution(output:Json,present:boolean){
 if(!present)return '未记录实际执行';
 const names:Record<string,string>={completed:'已执行 · 完成',needs_input:'已执行 · 需要补充输入',missing:'已执行 · 缺少所需资料',blocked:'已执行 · 输入条件未满足',unavailable:'已执行 · 输入不可用',failed:'已执行 · 失败',unknown:'已执行 · 结果未确认',skipped:'已跳过'};
 return names[output.status]??'已记录执行产物 · 状态未记录';
}

function requirementCell(side:Json,capability:string,historical:boolean){
 const computations=record(side.computations),present=Object.hasOwn(computations,capability),output=record(computations[capability]);
 const covered=strings(side.covered).includes(capability),missing=strings(side.missing).includes(capability);
 const conflict=covered&&(missing||(['missing','blocked','unavailable','failed','unknown','skipped'].includes(output.status))||(output.status==='needs_input'&&capability!=='gaps'));
 const incomplete=covered&&(!present||!['completed','needs_input'].includes(output.status));
 const satisfied=conflict?'记录不一致，无法确认满足':covered?(historical?'历史规则记为满足':incomplete?'保存记录记为满足，执行依据不足':'满足已标注要求'):missing?'未满足':'满足情况未记录';
 const planned=Array.isArray(side.planned_capabilities)?(side.planned_capabilities.includes(capability)?'已计划':'未计划'):'计划情况未记录';
 let basis=text(output.reason,'');
 if(!basis){
  if(!present)basis=planned==='未计划'?'未计划此能力，也未记录本地执行产物':'没有保存此能力的本地执行产物';
  else if(conflict)basis='执行状态与覆盖记录冲突，请核对原报告并重新回放';
  else if(covered&&capability==='gaps'&&output.status==='needs_input')basis='已产出待补输入清单；满足的是缺口清单要求，所缺资料仍未补齐';
  else if(incomplete)basis='覆盖记录存在，但没有保存可确认的执行状态';
  else if(covered)basis='本地执行产物与保存的人工需求覆盖记录';
  else if(output.status==='completed')basis='已记录完成，但没有满足此要求的覆盖记录';
  else basis='此回放未保存具体缺口说明，请查看原报告';
 }
 return `<p>${esc(planned)}</p><p>${esc(execution(output,present))}</p><p>${badge(satisfied,conflict||missing||incomplete?'warm':covered&&!historical?'good':'neutral')}</p><p class="micro">依据 / 缺口：${esc(basis)}</p>`;
}

function evidenceGroups(side:Json){
 const computations=record(side.computations),output=record(computations.counterevidence),groups=record(output.group_counts);
 const rows=[['supports','支持资料'],['contradicts','反向资料'],['context','背景资料']];
 return rows.map(([key,label])=>`<p>${label}：${count(groups[key])}${count(groups[key])==='未记录'?'':' 条'}${groups[key]===0?'（未提供此类资料）':''}</p>`).join('')+
  (!Object.hasOwn(computations,'counterevidence')?'<p class="micro">未记录反向分组执行，不能据此推断资料数量</p>':'')+
  (typeof output.reason==='string'&&output.reason?`<p class="micro">${esc(output.reason)}</p>`:'');
}

function compareHash(actual:Json,reference:Json){
 if(!hash(actual)||!hash(reference))return '无法核对（摘要缺失或格式无效）';
 return actual===reference?'与原报告一致':'与原报告不一致';
}

function consistency(c:Json){
 const b=record(c.baseline),candidate=record(c.candidate);
 const comparisonRecorded=Object.hasOwn(c,'reference_comparison_hash')&&Object.hasOwn(b,'comparison_hash')&&Object.hasOwn(candidate,'comparison_hash')&&Object.hasOwn(b,'comparison_provenance')&&Object.hasOwn(candidate,'comparison_provenance');
 const noComparison=comparisonRecorded&&c.reference_comparison_hash===null&&b.comparison_hash===null&&candidate.comparison_hash===null&&b.comparison_provenance===null&&candidate.comparison_provenance===null;
 const comparison=(side:Json)=>noComparison?'原任务未选企业对照（不适用）':compareHash(side.comparison_hash,c.reference_comparison_hash);
 return `<h4>与原报告的计算一致性</h4>${table(['核对项','基线','候选'],[
  ['数学结果',esc(compareHash(b.math_hash,c.reference_math_hash)),esc(compareHash(candidate.math_hash,c.reference_math_hash))],
  ['已选企业对照',esc(comparison(b)),esc(comparison(candidate))]
 ])}<p class="micro">一致性只核对保存的结果摘要；缺少摘要不能当作相等，也不证明原始资料或结论正确。</p>`;
}

function replayCase(value:Json,index:number,historical:boolean){
 const c=record(value),source=record(c.source),b=record(c.baseline),candidate=record(c.candidate),expected=strings(c.expected);
 const partition=c.partition==='development'?'开发组':c.partition==='holdout'?'保留组':'分组未记录';
 const report=typeof c.run_id==='string'&&c.run_id?routeButton('查看原报告与验收','agents:run-'+c.run_id):'<span class="micro">原报告入口未记录</span>';
 const revision=Number.isSafeInteger(source.dataset_version)&&source.dataset_version>0?'第 '+source.dataset_version+' 次修订':'未记录';
 const limits=[b,candidate].map(s=>text(record(record(s.computations).counterevidence).limitation,'')).filter(Boolean);
 const limit='人工标签只表示资料被怎样分类；分组运行不等于满足反向要求，标签不证明有效反证或事实正确性。';
 return `<article class="panel" data-replay-case="${index}"><div class="row-between"><h3>案例 ${index+1}</h3>${badge(partition,c.partition==='holdout'?'warm':'neutral')}</div><p data-replay-query>原问题：${esc(text(source.query))}</p><p class="micro">企业：${esc(text(source.company))}<br>目标季度：${esc(text(source.target_period))}<br>原数据修订：${esc(revision)}</p>${report}
  <h4>按人工预期能力逐项对照</h4>${expected.length?table(['人工预期能力','基线','候选'],expected.map(cap=>[esc(capabilityNames[cap]??cap),requirementCell(b,cap,historical),requirementCell(candidate,cap,historical)])):notice('此评估未记录人工预期能力，不能补推验收要求。','warm')}
  <h4>人工标注的资料分组</h4>${table(['基线','候选'],[[evidenceGroups(b),evidenceGroups(candidate)]])}${notice(limit)}${limits.length?`<p class="micro">本次执行的限制：${esc(Array.from(new Set(limits)).join('；'))}</p>`:''}
  ${consistency(c)}<details><summary>本例技术依据：输入摘要、执行节点数与完整记录</summary><p class="micro">基线 ${count(b.node_count)} 个节点 / 候选 ${count(candidate.node_count)} 个节点。节点减少须在相同需求覆盖下理解。</p>${jsonView(c)}</details></article>`;
}

/** Read-only rendering of the saved replay and the current overview projection. */
export function evaluationDetail(value:Json,evolutionValue:Json={}){
 const evaluation=record(value),p=record(evaluation.payload),evolution=record(evolutionValue),cases=list(p.cases);
 if(!Object.keys(p).length)return notice('当前回放记录已不可用，请返回策略实验室刷新后查看。','warm');
 const applicabilityState=applicability(evaluation,evolution),blockers=strings(p.blockers),passed=p.eligible===true;
 const currentReasons=applicabilityState.reasons;
 const title=currentReasons.length?'不可按此记录直接激活':passed?'可进入激活复核（尚未激活）':p.eligible===false?'保存时未达到激活门槛':'保存时的门槛结果未记录';
 const savedResult=passed?'已保存回放的门槛结果：通过':p.eligible===false?'已保存回放的门槛结果：未通过':'已保存回放的门槛结果：未记录';
 const taskCount=count(p.scenario_cases??(Array.isArray(p.cases)?p.cases.length:undefined));
 return `<section class="panel" data-evaluation-summary><h3>${savedResult}</h3><p>${title}</p><p><strong>${count(p.unique_inputs)}</strong> 份不同财务输入 / <strong>${taskCount}</strong> 个验收任务</p><p class="micro">按财务内容去重；同一输入的重复报告或多个任务不算独立输入。</p>
  ${blockers.length?`<h4>保存时的门槛原因</h4><ul>${blockers.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:notice(passed?'已保存的本地门槛全部通过；这不代表当前激活授权已确认。':'此评估未记录具体门槛原因，请查看完整记录。',passed?'neutral':'warm')}
  ${currentReasons.map(reason=>notice(reason,'warm')).join('')}
  ${applicabilityState.current?notice('回放实现版本适用；这只说明本地实现版本，不表示当前来源、回放同意或策略基线仍有效。'):''}
  ${notice('实际激活仍须明确确认，并由服务端重新核对当前案例、来源、回放同意、候选和基线。此详情仅供阅读。')}
  <p class="micro">开发组 / 保留组按相同输入内容分组，不是独立外部验证。本地需求覆盖也不代表模型事实准确率。</p></section>
  ${cases.map((c,index)=>replayCase(c,index,!applicabilityState.current)).join('')||notice('没有保存逐例结果。','warm')}
  <details><summary>完整评估 JSON 与技术摘要</summary>${jsonView(p)}</details>`;
}
