/** Read the supplied finding and binding only; never infer from current workspace data. */
import type {Json} from './api.js';
import {esc,jsonView} from './components.js';

const record=(v:Json):Json=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const text=(v:Json,fallback:string):string=>typeof v==='string'&&v.trim()?v:fallback;
const fields:Record<string,string>={period:'季度',revenue:'营业收入',cost:'营业成本',cash_flow:'经营现金流',net_profit:'净利润',assets:'总资产',liabilities:'总负债',inventory:'库存金额',equity_begin:'期初净资产',equity_end:'期末净资产',sales_volume:'销量',production_volume:'产量',manufacturing_cost:'制造费用',rd_expense:'研发费用',lithium_price:'锂价',industry_volatility:'行业波动率',source_url:'原始来源地址',source_kind:'来源类型'};
const knownCodes=new Set(['OPEN_QUARTER','TIME_GAP','ZERO_REVENUE','NEGATIVE_GROSS_PROFIT','NEGATIVE_CASH_FLOW','BALANCE_MISMATCH','RD_OVER_REVENUE','ORDER_OF_MAGNITUDE','MISSING_FIELDS','MISSING_SOURCE','SYNTHETIC_DATA']);
const boundary='未列出提示不表示全部输入完整、全部指标可计算或来源已核实。';
const nextStep='到“经营数据”先核对本卡记录的企业，再逐项核对对应季度与原报表；如需补充或更正，保存新修订后重新提问，或主动点击“按当前输入复核”。来源问题到“证据资料”补充并审阅。旧消息与旧报告不会自动改写。';

function fieldName(v:Json){
 const key=text(v,'');
 return key?(Object.hasOwn(fields,key)?fields[key]:'未知字段（原标识：'+key+'）'):v==null||v===''?'字段未记录':'字段记录不可读';
}
function findingView(value:Json){
 const f=record(value),names=Array.isArray(f.fields)&&f.fields.length?f.fields.map(fieldName).join('、'):'涉及字段未记录';
 const message=text(f.message,text(f.title,'原提示未记录，请展开原始记录核对。'));
 const code=text(f.code,'');
 return `<div class="assistant-check preserve-lines" data-quality-finding><p><strong>${esc(text(f.period,'期间未记录'))} · ${esc(names)}</strong><br>${esc(message)}</p>${code&&!knownCodes.has(code)?`<small>未知提示标识：${esc(code)}</small>`:''}</div>`;
}
function sourceView(value:Json){
 return value==='user_declared_not_verified'?'来源由用户声明，尚未独立核验':typeof value==='string'&&value.trim()?'来源状态含义未确认（原标识：'+value+'）':'来源状态未记录';
}
function revision(value:Json){return Number.isSafeInteger(value)&&value>0?String(value):'未记录';}
function binding(company:Json,version:Json,period:Json,source:Json,label:string){
 return `<p class="micro preserve-lines" data-quality-binding>${esc(label)}：${esc(text(company,'企业名称未记录'))} · 数据修订 ${revision(version)} · 问题目标季度 ${esc(text(period,'未记录'))}<br>${esc(sourceView(source))}</p>`;
}
function guidance(){return `<p class="micro preserve-lines">按每条提示列出的季度核对，不要将全部提示归到问题目标季度。</p><p class="micro preserve-lines" data-quality-next>${nextStep}</p>`;}

export function savedQualityView(value:Json,context:Json={},scope:Json={}){
 const q=record(value),c=record(context),s=record(scope),rows=Array.isArray(q.findings)?q.findings:null;
 let content=rows?`<p class="micro" data-quality-count>先显示 ${Math.min(6,rows.length)}/${rows.length} 项（本消息共保存 ${rows.length} 项）</p>`:'<p>本消息未保存可读取的质量清单，无法判断待核查事项。</p>';
 if(rows?.length){
  content+=rows.slice(0,6).map(findingView).join('');
  if(rows.length>6)content+=`<details data-quality-remaining><summary>展开其余已保存 ${rows.length-6} 项</summary>${rows.slice(6).map(findingView).join('')}</details>`;
 }else if(rows)content+='<p>本条消息未列出质量提示。</p>';
 return `<div data-quality-reader="saved">${binding(s.company,c.dataset_version,record(c.question_scope).period,q.source_state,'原消息输入')}${content}<p class="micro">${boundary}</p>${guidance()}<details data-quality-raw><summary>完整质量检查（原始记录）</summary>${jsonView(value)}</details></div>`;
}

export function currentQualityView(value:Json){
 const result=record(value),scope=record(result.scope),rows=Array.isArray(result.quality)?result.quality:null,total=result.quality_total;
 const validTotal=Number.isSafeInteger(total)&&total>=0;
 let count=rows?`本次复核显示 ${rows.length} 项；总数未记录`:'本次复核没有可读取的质量清单，无法判断待核查事项。';
 if(rows&&validTotal)count=total>=rows.length?`本次复核显示 ${rows.length} 项，共 ${total} 项`:`本次复核显示 ${rows.length} 项；结果记载的总数 ${total} 与条目数不一致`;
 let content=`<p class="micro" data-quality-count>${esc(count)}</p>`;
 if(rows?.length)content+=rows.map(findingView).join('');
 else if(rows)content+='<p>本次复核未列出质量提示。</p>';
 if(rows&&validTotal&&total>rows.length)content+=`<p class="micro">其余 ${total-rows.length} 项未包含在本次复核结果中。</p>`;
 return `<section class="assistant-section" data-quality-reader="current"><h3>输入核查</h3>${binding(scope.company,scope.dataset_version,scope.period,scope.source_state,'本次复核输入')}${content}<p class="micro">${boundary}</p>${guidance()}<details data-quality-raw><summary>本次复核原始响应</summary>${jsonView(value)}</details></section>`;
}
