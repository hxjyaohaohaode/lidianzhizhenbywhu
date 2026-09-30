/** Present archived tool outputs without recalculating business values. */
import type {Json} from './api.js';
import {esc,num,pct,amount,unitName,table,notice,jsonView,lineChart,metricNames,badge} from './components.js';
const names:Record<string,string>={forecast:'时间序列预测与回测',sensitivity:'情景与敏感性',counterevidence:'支持与反向证据对照',gaps:'数据缺口与补充计划'};
export function mathResult(kind:string,r:Json,unit='wan'){
 const title=names[kind]??kind;let content='';
 if(['blocked','failed','unknown','unavailable'].includes(r.status)){
  content=notice(r.reason??'该能力没有产生可用结果，请核对输入与执行记录。','warm');
 }else if(kind==='forecast'){
  const ratio=r.metric==='gross_margin',scale=ratio?.01:({yuan:1,wan:1e4,yi:1e8} as Record<string,number>)[unit]??1e4;
  const value=(v:unknown)=>ratio?pct(v):amount(v,unit);
  const series=[...(r.history??[]).map((p:Json)=>({period:p.period,actual:p.value})),...(r.forecast??[]).map((p:Json)=>({period:p.period,prediction:p.value}))];
  content=`<p><strong>${esc(metricNames[r.metric]??r.metric)}</strong> · ${esc(r.selected_label??'未选择方法')} · ${badge('统计基线，非因果预测','warm')}</p>`+
   lineChart(series,[{id:'actual',name:'已保存实际值'},{id:'prediction',name:'未来基线'}],ratio?'%':unitName(unit),scale)+
   table(['季度','点估计','单步经验误差带'],(r.forecast??[]).map((p:Json)=>[esc(p.period),value(p.value),p.lower==null||p.upper==null?'校准不足 / 多步未提供':value(p.lower)+' — '+value(p.upper)]))+
   `<h4>相同滚动起点回测</h4><p class="micro">${esc(r.selection??'')} MAE / RMSE单位：${ratio?'百分点':unitName(unit)}</p>`+
   table(['方法','MAE','RMSE','WAPE','验证折数'],(r.backtests??[]).map((b:Json)=>[esc(b.label)+(b.method===r.selected?' '+badge('本次选择'):''),num(b.mae/scale),num(b.rmse/scale),pct(b.wape),num(b.folds?.length,0)]));
  const hold=r.locked_holdout;
  if(hold?.status==='completed')content+=`<p class="micro">锁定方法保留检验：${esc(hold.holdout_start)}至${esc(hold.holdout_end)}，方法 ${esc(hold.method)}，MAE ${num(hold.mae/scale)}；最近值基线 ${num(hold.last_value_mae/scale)}。${esc(hold.note)}</p>`;
  else if(hold)content+=notice(hold.note??'样本不足，未作独立保留检验。','warm');
  if(r.excluded_periods?.length)content+=notice('未结束季度已排除：'+r.excluded_periods.join('、'),'warm');
 }else if(kind==='sensitivity'){
  const a=r.approved_assumptions??r.assumptions??{},base=r.baseline??{},out=r.result??{};
  content=notice('情景是明确假设的机械计算，不是预测或因果证明。')+
   table(['已批准参数','变化 / 比例'],[['售价变化',pct(a.price_change)],['单位变动成本变化',pct(a.cost_change??a.unit_variable_cost_change)],['销量变化',pct(a.volume_change)],['固定成本占比',pct(a.fixed_cost_share)]])+ (a.note?`<p><strong>假设依据：</strong>${esc(a.note)}</p>`:'')+
   table(['指标','基准','情景'],[['营业收入（'+unitName(unit)+'）',amount(base.revenue,unit),amount(out.revenue,unit)],['营业成本（'+unitName(unit)+'）',amount(base.cost,unit),amount(out.cost,unit)],['毛利额（'+unitName(unit)+'）',amount(base.gross_profit,unit),amount(out.gross_profit,unit)],['毛利率',pct(base.gross_margin),pct(out.gross_margin)]])+
   `<p>毛利额变化：<strong>${amount(r.delta_gross_profit,unit)} ${unitName(unit)}</strong>；盈亏平衡销量：${r.break_even_volume_multiplier==null?'单位贡献非正，无法给出可用倍数':num(r.break_even_volume_multiplier)+' × 基准销量'}</p><h4>单参数敏感性</h4>`+
   table(['参数','−5个百分点毛利额','当前毛利额','+5个百分点毛利额'],(r.sensitivity??[]).map((s:Json)=>[esc(s.label),amount(s.minus_five_pp,unit),amount(s.center,unit),amount(s.plus_five_pp,unit)]))+
   `<p class="micro">单位：${unitName(unit)}，其他假设保持不变</p><p class="micro">${esc(r.formula??'')}</p>`;
  if(r.grid?.length)content+=`<details><summary>售价 × 变动成本敏感性网格</summary>${table(['售价变化','单位变动成本变化','毛利率'],r.grid.map((p:Json)=>[pct(p.price_change),pct(p.cost_change),pct(p.gross_margin)]))}</details>`;
 }else if(kind==='counterevidence'){
  content=notice(r.limitation??'标签对照不是语义矛盾认证。')+table(['人工标注立场','引用 ID'],[['supports','支持'],['contradicts','反向'],['context','背景']].map(([key,label])=>[label,(r.groups?.[key]??[]).map(esc).join('<br>')||'没有对应资料']));
 }else if(kind==='gaps'){
  content=r.items?.length?table(['缺失字段','待补充工作'],r.items.map((p:Json)=>[esc(metricNames[p.field]??p.field),esc(p.action)])):notice('本节点没有列出缺失字段，不代表全部业务事实已核验。');
  if(r.findings?.length)content+=table(['季度','需核对事项'],r.findings.map((p:Json)=>[esc(p.period),esc(p.message)]));
 }
 return `<article class="subpanel math-result" data-math-kind="${esc(kind)}"><h3>${esc(title)}</h3>${content}${(r.limitations??[]).map((s:string)=>`<p class="micro">${esc(s)}</p>`).join('')}<details><summary>完整已保存产物与计算依据</summary>${jsonView(r)}</details></article>`;
}
export function reflectionView(r:Json){if(!r)return notice('本报告没有保存自主复盘记录。');return `<h3>执行复盘与未达成条件</h3>${table(['项目','实际记录'],[['外部调用尝试',num(r.call_attempts,0)],['成功调用',num(r.successful_calls,0)],['外发字符',num(r.context_characters,0)],['结构门禁拦截',num(r.rejected_claims,0)]])}${r.issues?.length?table(['节点','状态','限制 / 原因'],r.issues.map((i:Json)=>[esc(i.node),esc(i.state),esc(i.reason??'查看对应产物')])):notice('未记录结构执行问题；这不表示研究结论已被证明。')}<p><strong>你的验收标准：</strong>${esc(r.success_criteria||'未填写')}</p><p class="micro">${esc(r.criteria_verification??'仍需人工验收')}</p><details><summary>完整复盘记录</summary>${jsonView(r)}</details>`;}

/** Values are persisted server-resolved references, never parsed from model prose. */
export function claimMathReferences(claim:Json){
 const refs=claim.tool_references??[];
 if(!refs.length)return '';
 return `<details class="claim-math-references"><summary>数学依据 · ${refs.length} 项</summary><p class="micro">以下数值来自本次专家实际收到的已保存产物；情景依赖已批准假设，统计基线不是因果证明。</p>${table(['依据','期间','已保存数值','产物定位'],refs.map((ref:Json)=>[esc(ref.label),esc(ref.period??'未提供'),ref.unit==='ratio'?pct(ref.value):num(ref.value,4)+' '+esc(({yuan:'元',multiple:'× 基准销量'} as Record<string,string>)[ref.unit]??ref.unit),`<code>${esc(ref.id)}</code><br><small>SHA256 ${esc(ref.output_hash)}</small>`]))}</details>`;
}
