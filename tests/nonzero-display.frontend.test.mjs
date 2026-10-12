/** Presentation only: persisted values and historical exports stay unchanged. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {num,pct,amount} from '../web/dist/components.js';
import {readoutValue,reportReadout} from '../web/dist/report-readout.js';

for(const sign of [1,-1]){
 for(const value of [1e-8,1e-100,Number.MIN_VALUE]){
  test(`nonzero scalar keeps magnitude and sign: ${sign*value}`,()=>{
   const input=sign*value,shown=num(input);
   assert.match(shown,/e-/);assert.equal(Number(shown),input);
  });
 }
 test(`tiny percentage and amount remain nonzero: ${sign}`,()=>{
  const value=sign*1e-8;
  assert.equal(pct(value),`${sign<0?'-':''}1e-6%`);
  assert.equal(readoutValue(value,'ratio','yuan'),pct(value));
  assert.equal(readoutValue(value,'ratio_points','yuan'),`${sign<0?'-':''}1e-6 个百分点`);
  assert.equal(readoutValue(value,'times','yuan'),`${sign<0?'-':''}1e-8 倍`);
  for(const [unit,power] of [['yuan',0],['wan',4],['yi',8]]){
   const shown=amount(value,unit);assert.notEqual(Number(shown),0);
   assert.equal(Number(shown),value/10**power);
  }
 });
 test(`unit conversion underflow and overflow use correctly shifted decimal exponent: ${sign}`,()=>{
  const prefix=sign<0?'-':'';
  assert.equal(amount(sign*Number.MIN_VALUE,'wan'),`${prefix}5e-328`);
  assert.equal(amount(sign*Number.MIN_VALUE,'yi'),`${prefix}5e-332`);
  assert.equal(pct(sign*1e308),`${prefix}1e+310%`);
  assert.equal(readoutValue(sign*1e308,'ratio_points','yuan'),`${prefix}1e+310 个百分点`);
  assert.equal(readoutValue(sign*Number.MIN_VALUE,'ratio_points','yuan'),`${prefix}5e-322 个百分点`);
 });
}

test('zero, negative zero, invalid and ordinary values preserve existing formatting',()=>{
 for(const v of [null,undefined,'0',NaN,Infinity,-Infinity,{},true]){
  assert.equal(num(v),'—');assert.equal(pct(v),'—');assert.equal(amount(v),'—');
 }
 assert.equal(num(0),'0');assert.equal(num(-0),'-0');
 assert.equal(pct(0),'0%');assert.equal(pct(-0),'-0%');
 assert.equal(pct(.2),'20%');assert.equal(pct(-.2),'-20%');
 assert.equal(num(1234.567),'1,234.57');assert.equal(num(.005),'0.01');
 assert.equal(amount(100000,'wan'),'10');assert.equal(amount(.01,'yi'),'0.0000000001');
 assert.equal(amount(100000,'unrecognized'),'10');
 assert.equal(readoutValue(null,'ratio','yuan'),'不可计算');
 assert.equal(readoutValue(null,'CNY','yuan'),'未提供');
});

test('rendered frozen report keeps nonzero disclosure without mutating source data',()=>{
 const report={query:'毛利率',readout:{amount_unit:'yuan',facts:[{period:'2026-Q1',label:'毛利率',id:'gross_margin',value:1e-8,unit:'ratio',inputs:[],formula:'已保存公式'}],input_source:{},next_steps:[]}};
 const before=JSON.stringify(report);const html=reportReadout(report);
 assert(html.includes('<strong>1e-6%</strong>'));assert.equal(JSON.stringify(report),before);
});

test('legacy balance zero presentation stays visible with frozen nonzero annotation and unchanged exports contract',()=>{
 const fact={period:'2026-Q1',id:'assets',label:'总资产',value:.004,unit:'CNY',formula:'原公式',inputs:[{field:'assets',value:.004,unit:'CNY'}]};
 const report={query:'总资产',readout:{amount_unit:'yi',facts:[fact],input_source:{},next_steps:[]}};
 const before=JSON.stringify(report),html=reportReadout(report);
 assert.equal((html.match(/0 亿元（冻结原值非零：4e-11 亿元）/g)||[]).length,2);
 assert.equal(JSON.stringify(report),before);
 fact.display_value='当时冻结的显示';fact.inputs[0].display_value='当时冻结的输入显示';
 const saved=reportReadout(report);assert(saved.includes('当时冻结的显示'));assert(saved.includes('当时冻结的输入显示'));
 assert(!saved.includes('冻结原值非零'));
});

test('comparison percentage-point differences use the same nonzero and overflow-safe display',async()=>{
 const {reportComparisonView}=await import('../web/dist/views-analysis.js');
 for(const [value,shown] of [[1e308,'+1e+310'],[-1e308,'-1e+310'],[1e-8,'+1e-6'],[-1e-8,'-1e-6']]){
  const record={left:'old',right:'new',left_period:'2026-Q1',right_period:'2026-Q1',same_period:true,same_rule_version:true,changes:[{metric:'gross_margin',before:0,after:value,delta:value}],input_diff:[]};
  const before=JSON.stringify(record),html=reportComparisonView(record);
  assert(html.includes(`<td>${shown} 个百分点</td>`));assert.equal(JSON.stringify(record),before);
 }
});
