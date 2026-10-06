/** Production renderers with isolated inputs; DOM/API bridge, not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const {messageView}=await import('../web/dist/copilot-ui.js');globalThis.setInterval=interval;
const {assistantView}=await import('../web/dist/assistant.js');
const {metricComparison}=await import('../web/dist/metric-comparison.js');

const growth=(value=.20625,patch={})=>({id:'revenue_growth',label:'收入增速',value,period:'2026-Q2',dataset_version:1,
 formula:'本期收入 ÷ 指定同/环比基期收入 − 1；基期收入必须大于0',inputs:[],trend:[],
 comparison:{kind:'year_over_year',period:'2025-Q2',operation:'growth_rate',value:null,change:value,change_unit:'ratio',
 status:'available',reason:'',baseline_input:{metric:'revenue',period:'2025-Q2',value:16000000,unit:'CNY'},...patch}});
const renderers={
 copilot(facts){return messageView({id:'growth-test',created_at:'2026-10-02',payload:{question:'收入同比',response:{answer:'按保存输入核查',facts}}});},
 legacy(facts){return assistantView('收入同比',{answer:'按保存输入核查',facts});},
};

for(const [name,render] of Object.entries(renderers)){
 test(`${name} renders available growth as percent and keeps source revenue in yuan`,()=>{
  const fact=growth(),before=structuredClone(fact),html=render([fact]);
  assert(html.includes('同比 · 2025-Q2'));assert(html.includes('收入增速 +20.63 %'));
  assert(html.includes('基期收入 16,000,000 元'));
  assert(!html.includes('缺少可比基期'));assert(!html.includes('个百分点'));
  assert.deepEqual(fact,before);
 });
 test(`${name} renders quarter-over-quarter separately from ratio-point changes`,()=>{
  const html=render([growth(.05,{kind:'previous',period:'2025-Q2'}),
   {id:'gross_margin',label:'毛利率',value:.3,period:'2025-Q3',dataset_version:1,comparison:{kind:'previous',period:'2025-Q2',value:.2,change:.1,change_unit:'ratio_points'}},
   {id:'cash_flow',label:'经营现金流',value:-200,period:'2025-Q3',dataset_version:1,comparison:{kind:'previous',period:'2025-Q2',value:-100,change:-100,change_unit:'CNY'}}]);
  assert(html.includes('环比 · 2025-Q2'));assert(html.includes('收入增速 +5 %'));
  assert(html.includes('+10 个百分点'));assert(html.includes('-100 元'));
  assert(!html.includes('缺少可比基期'));
 });
 for(const [value,display] of [[0,'0 %'],[-.5,'-50 %'],[-1,'-100 %']])
  test(`${name} renders valid zero or declining growth ${value}`,()=>{
   const html=render([growth(value)]);assert(html.includes(`收入增速 ${display}`));
   assert(!html.includes('缺少'));assert(!html.includes('个百分点'));
  });
 for(const [status,reason,base] of [
  ['missing_baseline','缺少指定基期收入，不能计算收入增速',null],
  ['invalid_baseline','基期收入必须大于0，不能计算收入增速',0],
  ['invalid_baseline','基期收入必须大于0，不能计算收入增速',-1],
 ])test(`${name} shows exact unavailable growth reason for ${status} ${base}`,()=>{
  const html=render([growth(null,{status,reason,baseline_input:{value:base,unit:'CNY'}})]);
  assert(html.includes('同比 · 2025-Q2'));assert(html.includes(reason));
  assert(!html.includes('收入增速 +'));assert(!html.includes('个百分点'));
  if(base!=null)assert(html.includes(`基期收入 ${base} 元`));
 });
 test(`${name} handles historical growth metadata without mutating saved output`,()=>{
  const fact=growth();fact.comparison={kind:'year_over_year',period:'2025-Q2',value:null,change:null,change_unit:'ratio_points'};
  const before=structuredClone(fact),html=render([fact]);
  assert(html.includes('收入增速 +20.63 %'));assert(!html.includes('缺少可比基期'));assert(!html.includes('个百分点'));
  assert.deepEqual(fact,before);
 });
 test(`${name} handles missing current ordinary metrics without claiming the baseline is absent`,()=>{
  const html=render([{id:'cash_flow',label:'经营现金流',value:null,period:'2025-Q3',dataset_version:1,
   comparison:{kind:'previous',period:'2025-Q2',value:100,change:null,change_unit:'CNY',reason:'本期或基期指标输入不足，不能计算变化'}}]);
  assert(html.includes('本期或基期指标输入不足'));assert(!html.includes('缺少可比基期'));
 });
}

test('comparison renderer escapes metadata and does not derive growth from an amount',()=>{
 const fact=growth(null,{period:'<img src=x onerror=alert(1)>',reason:'<script>bad()</script>',value:12345,change:12345});
 const html=metricComparison(fact);
 assert(html.includes('&lt;script&gt;'));assert(html.includes('&lt;img'));
 assert(!html.includes('<script>'));assert(!html.includes('<img'));assert(!html.includes('1,234,500'));
});
