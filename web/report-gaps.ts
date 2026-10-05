/** Read frozen report fields only. Never recalculate a rule or fill historical gaps. */
import type {Json} from './api.js';
import {esc,metricNames,notice,table} from './components.js';

const record=(v:Json):Json=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const list=(v:Json):Json[]=>Array.isArray(v)?v:[];
const text=(v:Json,fallback='未记录'):string=>typeof v==='string'&&v.trim()?v:fallback;
const fields:Record<string,string>={...metricNames,period:'季度',assets:'总资产',liabilities:'总负债',equity_begin:'期初净资产',equity_end:'期末净资产',inventory:'库存金额',sales_volume:'销量',production_volume:'产量',manufacturing_cost:'制造费用',rd_expense:'研发费用',lithium_price:'锂价',industry_volatility:'行业波动率',source_url:'原始来源地址',source_kind:'来源类型',comparison_baseline:'指定比较基期'};
const gmps:Record<string,string>={margin:'毛利率下降幅度',gap:'成本收入增速差',lithium:'锂价变化',unit_cost:'单位销售成本变化',inventory:'库存变化',sales_production:'产销率',manufacturing:'制造费用占比',volatility:'行业波动率',cash:'经营现金收入比',leverage:'资产负债率'};
const dqi:Record<string,string>={profit:'盈利质量',growth:'收入成长',cash:'现金质量',assets:'资产效率',rd:'研发强度',inventory:'库存效率'};
const capabilities:Record<string,string>={quality:'数据核验',quant:'量化建模',evidence:'证据检索',counterevidence:'反向证据对照',gaps:'缺口补全规划',forecast:'序列回测',sensitivity:'情景建模',comparison:'企业对照',context:'上下文装配',planner:'任务规划专家',analyst:'经营研究员',researcher:'证据研究员',challenger:'反证审阅员',revision:'解释修订者',review:'证据门禁',reflection:'执行复盘',report:'报告归档'};
const states:Record<string,string>={missing:'缺少所需资料或输入',needs_input:'输入待核对或补充',insufficient_data:'数据不足',blocked:'条件未满足',unavailable:'结果不可用',failed:'执行失败',unknown:'结果未确认',skipped:'已跳过',completed:'已完成'};
// These are input paths in rules-3.0.0, not new formulas or inferred missing values.
const gmpsInputs:Record<string,[string[],boolean]>={margin:[['revenue','cost'],true],gap:[['revenue','cost'],true],lithium:[['lithium_price'],true],unit_cost:[['cost','sales_volume'],true],inventory:[['inventory'],true],sales_production:[['sales_volume','production_volume'],false],manufacturing:[['manufacturing_cost','cost'],false],volatility:[['industry_volatility'],false],cash:[['cash_flow','revenue'],false],leverage:[['liabilities','assets'],false]};
const metricInputs:Record<string,string[]>={roe:['net_profit','equity_begin','equity_end'],net_margin:['net_profit','revenue'],revenue_growth:['revenue'],cash_ratio:['cash_flow','revenue'],asset_turnover:['revenue','assets'],rd_ratio:['rd_expense','revenue'],inventory_turnover:['cost','inventory']};

function fieldName(field:Json){
 const key=text(field,''),[model,id]=key.split(':');
 if(model==='gmps'&&Object.hasOwn(gmps,id)&&key===model+':'+id)return '毛利压力规则 · '+gmps[id];
 if(model==='dqi'&&Object.hasOwn(dqi,id)&&key===model+':'+id)return '经营质量规则 · '+dqi[id];
 return Object.hasOwn(fields,key)?fields[key]:key?'未知字段或指标（原标识：'+key+'）':'字段或指标未记录';
}
function periodName(period:Json){return text(period,'期间未记录');}
function savedInput(row:Json,key:string){
 if(!Object.hasOwn(row,key))return fields[key]+'未记录';
 if(row[key]===null)return fields[key]+'未提供';
 const v=row[key];if(typeof v!=='number'||!Number.isFinite(v))return fields[key]+'记录不可读';
 const unit=['sales_volume','production_volume'].includes(key)?'（原填数量）':key==='lithium_price'?' 元/吨':key==='industry_volatility'?'（比值）':' 元';
 // Preserve small nonzero inputs; rounding them to 0 would change the reader's
 // interpretation of a denominator or supplied volatility.
 return fields[key]+' '+String(v)+unit;
}
function ruleDetail(field:string,gaps:Json,report:Json){
 const [model,id]=field.split(':'),analysis=record(report.analysis);
 if(field!==model+':'+id)return ['原计算定义与输入对应关系未记录。'];
 const part=record(list(record(analysis[model]).dimensions).find(p=>p?.id===id));
 const unavailable=record(list(gaps.unavailable_rule_components).find(p=>p?.model===model&&p?.id===id));
 const definition=text(unavailable.formula,text(part.formula,'原计算定义未记录'));
 const lines=['已保存计算定义：'+definition];
 const known=model==='gmps'?Object.hasOwn(gmps,id):model==='dqi'&&Object.hasOwn(dqi,id);
 if(!known||field!==model+':'+id)return lines;
 const version=analysis.model_version??report.model_version;
 const inputs=model==='gmps'?gmpsInputs[id]:typeof part.metric==='string'&&Object.hasOwn(metricInputs,part.metric)?[metricInputs[part.metric],true] as [string[],boolean]:undefined;
 if(version!=='rules-3.0.0'||!inputs){lines.push('原规则的输入对应关系未记录或版本不适用，不能推断具体缺项。');return lines;}
 for(const [label,period] of [['当前期',analysis.current_period],...(inputs[1]?[['指定基期',analysis.baseline_period]]:[])]){
  const row=typeof period==='string'?list(analysis.series).find(p=>p?.period===period):undefined;
  lines.push(label+'（'+periodName(period)+'）：'+(row?inputs[0].map(key=>savedInput(record(row),key)).join('；'):'该期输入未记录'));
 }
 return lines;
}
function gapDetail(item:Json,gaps:Json,report:Json){
 const key=text(item.field,''),coverage=record(record(report.quality).field_coverage);
 if(key.startsWith('gmps:')||key.startsWith('dqi:'))return ruleDetail(key,gaps,report);
 if(key==='comparison_baseline'){
  const b=record(gaps.baseline_requirement),basis:Record<string,string>={previous:'环比（相邻季度）',year_over_year:'同比（上年同季）'};
  return ['当前期：'+periodName(b.current_period),'比较口径：'+(Object.hasOwn(basis,b.comparison)?basis[b.comparison]:'未记录或未知'),'指定基期对应季度未记录；请按原比较口径核对，不改用其他季度。'];
 }
 const path=typeof item.path==='string'?/^periods\/([^/]+)\/([^/]+)$/.exec(item.path):null;
 const periods=path&&path[2]===key?[path[1]]:list(coverage.missing).includes(key)&&typeof coverage.period==='string'?[coverage.period]:list(gaps.findings).filter(p=>p?.code==='MISSING_FIELDS'&&list(p.fields).includes(key)&&typeof p.period==='string').map(p=>p.period);
 return [periods.length?'已保存缺失期间：'+[...new Set(periods)].join('、'):'缺失期间未记录，不能从当前数据补推。'];
}
export function gapPlanView(value:Json,context:Json={}){
 const gaps=record(value),report=record(context);
 let content=Array.isArray(gaps.items)?gaps.items.length?table(['缺口项目','期间与原计算依据','待补充工作'],gaps.items.map((value:Json)=>{
  const p=record(value);return [esc(fieldName(p.field)),gapDetail(p,gaps,report).map(s=>`<p class="micro">${esc(s)}</p>`).join(''),esc(text(p.action,'具体补充说明未记录，请核对原始资料与计算依据。'))];
 })):notice('本节点没有列出缺失字段，不代表全部业务事实已核验。'):notice('本节点未保存可读取的缺口清单，无法判断待补事项。','warm');
 if(list(gaps.items).length)content+=notice('在“经营数据”核对原始资料、期间和单位，如需补充或更正，保存新修订后再生成新的研判报告。缺失不等于零；已保存的旧报告不会自动更新。');
 if(list(gaps.findings).length)content+=table(['季度','需核对事项'],gaps.findings.map((value:Json)=>{const p=record(value);return [esc(periodName(p.period)),esc(text(p.message))+(list(p.fields).length?`<p class="micro">涉及：${p.fields.map((f:Json)=>esc(fieldName(f))).join('、')}</p>`:'')];}));
 if(typeof gaps.limitation==='string')content+=`<p class="micro">${esc(gaps.limitation)}</p>`;
 return content;
}

export function reflectionIssuesView(value:Json,context:Json={}){
 const reflection=record(value),report=record(context),adaptive=record(report.adaptive);
 if(!Array.isArray(reflection.issues))return notice('未保存可读取的限制清单，无法确认是否存在未达成条件。','warm');
 if(!reflection.issues.length)return notice('未记录结构执行问题；这不表示研究结论已被证明。');
 return table(['节点','已保存状态','限制 / 原因与下一步'],reflection.issues.map((value:Json)=>{
  const i=record(value),key=text(i.node,''),node=record(list(adaptive.nodes).find(n=>n?.id===key));
  const capability=text(node.capability,key),name=Object.hasOwn(capabilities,capability)?capabilities[capability]:key?'未知节点（原标识：'+key+'）':'节点未记录';
  const status=Object.hasOwn(states,i.state)?states[i.state]:i.state?'未知状态（原标识：'+text(i.state)+'）':'状态未记录';
  const output=record(record(adaptive.mathematical_outputs)[key]);
  let reason=text(i.reason,'');
  if(!reason&&typeof output.status==='string'&&output.status!==i.state)reason='复盘状态与同节点产物状态不一致，具体原因无法确认，请核对原报告。';
  if(!reason&&output.status===i.state)reason=text(output.reason,'');
  if(!reason&&capability==='evidence'&&i.state==='missing'&&Array.isArray(report.citations)&&report.citations.length===0)reason='本次冻结报告的引用为 0 条。请在“证据资料”补充并审阅适用于本企业的资料，再生成新计划；这不表示外部没有相关资料。';
  if(!reason&&capability==='gaps'&&i.state==='needs_input'&&output.status==='needs_input'&&Array.isArray(output.items)&&output.items.length)reason='已列出 '+output.items.length+' 项待核对或补充事项：'+output.items.map((p:Json)=>fieldName(p?.field)).join('、')+'。请按上方缺口清单核对期间与输入，在“经营数据”保存新修订后重新研判；清单已生成，相关输入仍需核对或补充。';
  if(!reason)reason='未保存具体限制或原因，无法仅凭节点和状态判断。请核对原报告已保存产物。';
  if(/^[A-Za-z][A-Za-z0-9_]*$/.test(reason))reason='已保存错误标识：'+reason+'；具体原因未记录。';
  return [esc(name),esc(status),esc(reason)];
 }));
}
