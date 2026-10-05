import test from 'node:test';
import assert from 'node:assert/strict';
import {gapPlanView,reflectionIssuesView} from '../web/dist/report-gaps.js';
import {mathResult,reflectionView} from '../web/dist/math-results.js';
import {adaptiveReport} from '../web/dist/views-orchestrator.js';

const visible=html=>html.split('<details>')[0];
function report(){
 const fields=['sales_volume','production_volume','gmps:lithium','gmps:unit_cost','gmps:sales_production','gmps:manufacturing','gmps:volatility'];
 const gaps={status:'needs_input',items:fields.map(field=>({field,action:'核对原始字段，不得将缺失当作零'})),findings:[{code:'MISSING_FIELDS',period:'2024-Q2',fields:['sales_volume','production_volume'],message:'该季度缺失字段保持空值；不会以零或行业均值填补'}],unavailable_rule_components:[{model:'gmps',id:'lithium',formula:'本期锂价/基期锂价-1'}]};
 return {model_version:'rules-3.0.0',citations:[],quality:{field_coverage:{period:'2024-Q2',missing:['sales_volume','production_volume']}},analysis:{model_version:'rules-3.0.0',current_period:'2024-Q2',baseline_period:'2023-Q2',series:[{period:'2024-Q2',cost:0,sales_volume:null,production_volume:null,lithium_price:null,manufacturing_cost:null,industry_volatility:null},{period:'2023-Q2',cost:20,sales_volume:0,lithium_price:null}]},adaptive:{nodes:[{id:'evidence',capability:'evidence'},{id:'gaps',capability:'gaps'}],mathematical_outputs:{gaps},reflection:{call_attempts:0,successful_calls:0,context_characters:0,rejected_claims:0,issues:[{node:'evidence',state:'missing',reason:null},{node:'gaps',state:'needs_input',reason:null}]}}};
}
test('8bd screenshot counterexample uses the actual report renderer and keeps original JSON intact',()=>{
 const r=report(),before=JSON.stringify(r),html=adaptiveReport(r),gaps=visible(mathResult('gaps',r.adaptive.mathematical_outputs.gaps,'yi',r)),issues=visible(reflectionView(r.adaptive.reflection,r));
 for(const word of ['销量','产量','毛利压力规则 · 锂价变化','单位销售成本变化','产销率','制造费用占比','行业波动率','已保存缺失期间：2024-Q2','当前期（2024-Q2）：锂价未提供','指定基期（2023-Q2）：锂价未提供','本期锂价/基期锂价-1','经营数据','新修订'])assert(gaps.includes(word),word);
 for(const key of r.adaptive.mathematical_outputs.gaps.items.map(p=>p.field))assert(!gaps.includes(key),key);
 for(const word of ['证据检索','缺口补全规划','缺少所需资料或输入','输入待核对或补充','引用为 0 条','证据资料','已列出 7 项待核对或补充事项','相关输入仍需核对或补充'])assert(issues.includes(word),word);
 for(const wrong of ['<td>evidence</td>','<td>missing</td>','<td>needs_input</td>','查看对应产物','执行失败'])assert(!issues.includes(wrong),wrong);
 assert(gaps.includes('营业成本 0 元'));assert(gaps.includes('销量 0（原填数量）'));assert(!gaps.includes('营业成本未提供'));
 assert(html.includes('引用为 0 条'));assert(html.includes('gmps:lithium'));assert(html.includes('完整已保存产物与计算依据'));assert.equal(JSON.stringify(r),before);
});
test('quarter findings name their saved fields and never replace a missing period with current context',()=>{
 const html=gapPlanView({items:[{field:'equity_begin',path:'periods/2020-Q1/equity_begin'}],findings:[{period:'2020-Q1',fields:['equity_begin','cash_flow'],message:'缺失'},{fields:['rd_expense'],message:'旧记录'}]},report());
 assert(html.includes('已保存缺失期间：2020-Q1'));assert(html.includes('涉及：期初净资产、经营现金流'));assert(html.includes('期间未记录'));assert(!html.includes('2024-Q2'));
});
test('legacy records cannot manufacture periods, definitions, reasons or a completed gap list',()=>{
 const html=gapPlanView({items:[{field:'sales_volume'},{field:'gmps:lithium'},{field:'dqi:profit'},{field:'comparison_baseline'}]});
 for(const value of ['缺失期间未记录','原计算定义未记录','输入对应关系未记录','比较口径：未记录或未知','具体补充说明未记录'])assert(html.includes(value),value);
 assert(!html.includes('2024'));assert(!html.includes('本期锂价/基期锂价-1'));
 for(const value of [undefined,null,{},'broken'])assert(gapPlanView({items:value}).includes('无法判断待补事项'));
 assert(gapPlanView({items:[]}).includes('没有列出缺失字段'));
 const issues=reflectionIssuesView({issues:[{node:'evidence',state:'missing'},{node:'gaps',state:'needs_input'}]});
 assert(issues.includes('未保存具体限制或原因'));assert(!issues.includes('引用为 0 条'));assert(!issues.includes('已列出'));
 assert(reflectionIssuesView({}).includes('无法确认'));assert(!reflectionIssuesView({}).includes('未记录结构执行问题'));
});
test('unknown keys stay explicitly unknown and all archived strings remain escaped',()=>{
 const html=gapPlanView({items:[{field:'gmps:new_rule',action:'<img src=x>'},{field:'gmps:lithium:old'},{field:'constructor'},{field:'<script>x'}],findings:[{period:'<svg>',message:'<iframe>',fields:['<b>']}],unavailable_rule_components:[{model:'gmps',id:'lithium',formula:'WRONG-FORMULA'}]});
 for(const key of ['gmps:new_rule','gmps:lithium:old','constructor'])assert(html.includes('未知字段或指标（原标识：'+key+'）'));
 assert(!html.includes('WRONG-FORMULA'));
 for(const tag of ['<img src=x>','<script>x','<svg>','<iframe>','<b>'])assert(!html.includes(tag));
 const issues=reflectionIssuesView({issues:[{node:'<img>',state:'future_state',reason:'<svg>'},{node:'constructor',state:'constructor'},{node:null,state:null}]});
 assert(issues.includes('未知节点（原标识：&lt;img&gt;）'));assert(issues.includes('未知状态（原标识：future_state）'));assert(issues.includes('节点未记录'));assert(!issues.includes('<svg>'));
});
test('saved reasons win; missing, blocked and unknown outcomes never become execution failures',()=>{
 const r=report();r.adaptive.reflection.issues=[{node:'evidence',state:'missing',reason:'冻结资料的日期不符合本次条件'},{node:'forecast',state:'blocked'},{node:'analyst',state:'unknown'},{node:'researcher',state:'failed',reason:'MODEL_HTTP_429'},{node:'revision_1',state:'failed'}];
 r.adaptive.nodes.push({id:'revision_1',capability:'revision'});r.adaptive.mathematical_outputs.forecast={status:'blocked',reason:'只有四个连续已结束季度'};
 const html=reflectionIssuesView(r.adaptive.reflection,r);
 for(const value of ['冻结资料的日期不符合本次条件','只有四个连续已结束季度','条件未满足','结果未确认','执行失败','已保存错误标识：MODEL_HTTP_429','解释修订者'])assert(html.includes(value));
 assert(!html.includes('引用为 0 条'));assert.equal((html.match(/执行失败/g)??[]).length,2);
});
test('contradictory or incomplete saved output cannot supply an invented reason',()=>{
 const r=report();r.adaptive.mathematical_outputs.gaps={status:'completed',items:[],reason:'全部补齐'};
 let html=reflectionIssuesView(r.adaptive.reflection,r);assert(html.includes('状态不一致'));assert(!html.includes('全部补齐'));assert(!html.includes('已列出'));
 r.citations=[{id:'existing'}];r.adaptive.mathematical_outputs.gaps={items:[{field:'sales_volume'}]};
 html=reflectionIssuesView(r.adaptive.reflection,r);assert(!html.includes('引用为 0 条'));assert(!html.includes('已列出'));assert(html.includes('未保存具体限制或原因'));
});
test('original rule versions and saved DQI metric selection bound input descriptions',()=>{
 const r=report();r.analysis.dqi={dimensions:[{id:'profit',metric:'net_margin',formula:'原保存公式'}]};
 r.analysis.series[0].net_profit=null;r.analysis.series[0].revenue=100;
 const input={items:[{field:'dqi:profit'}]};let html=gapPlanView(input,r);
 assert(html.includes('经营质量规则 · 盈利质量'));assert(html.includes('原保存公式'));assert(html.includes('净利润未提供'));assert(!html.includes('期初净资产'));
 r.analysis.model_version='unknown-old';html=gapPlanView(input,r);assert(html.includes('版本不适用'));assert(!html.includes('净利润未提供'));
 r.analysis.model_version='rules-3.0.0';delete r.analysis.dqi.dimensions[0].metric;assert(gapPlanView(input,r).includes('输入对应关系未记录'));
});
test('absent archived inputs stay unrecorded and explicit null stays missing',()=>{
 const r=report();delete r.analysis.series[0].lithium_price;
 const html=gapPlanView({items:[{field:'gmps:lithium'}]},r);
 assert(html.includes('当前期（2024-Q2）：锂价未记录'));assert(html.includes('指定基期（2023-Q2）：锂价未提供'));
 delete r.analysis.baseline_period;assert(gapPlanView({items:[{field:'gmps:lithium'}]},r).includes('指定基期（期间未记录）：该期输入未记录'));
});
test('needs_input with complete numeric inputs and zero denominators does not invent missing data',()=>{
 const r=report();r.adaptive.mathematical_outputs.gaps={status:'needs_input',items:[{field:'gmps:sales_production',action:'核对产销率输入'}],unavailable_rule_components:[{model:'gmps',id:'sales_production',formula:'销量/产量'}]};
 r.analysis.series[0]={period:'2024-Q2',sales_volume:10,production_volume:0};r.quality.field_coverage.missing=[];
 r.adaptive.reflection.issues=[{node:'gaps',state:'needs_input'}];
 const gaps=gapPlanView(r.adaptive.mathematical_outputs.gaps,r),issues=reflectionIssuesView(r.adaptive.reflection,r);
 assert(gaps.includes('销量 10（原填数量）'));assert(gaps.includes('产量 0（原填数量）'));
 assert(issues.includes('相关输入仍需核对或补充'));assert(!issues.includes('资料尚未补齐'));assert(!issues.includes('输入缺失'));assert(!issues.includes('执行失败'));
});
test('saved small nonzero inputs never round into zero in the gap explanation',()=>{
 const r=report();r.analysis.series[0].industry_volatility=1e-10;
 const html=gapPlanView({items:[{field:'gmps:volatility'}]},r);
 assert(html.includes('行业波动率 1e-10（比值）'));assert(!html.includes('行业波动率 0（比值）'));
});
