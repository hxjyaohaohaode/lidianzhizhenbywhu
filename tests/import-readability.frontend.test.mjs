/** Render contracts only; real preview/return/confirm pixels are audited separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {stageView} from '../web/dist/views-data.js';

const row=(period,values={})=>({period,revenue:100000,cost:90000,cash_flow:null,net_profit:0,assets:500000,liabilities:200000,inventory:20000,equity_begin:300000,equity_end:300000,sales_volume:100,production_volume:120,manufacturing_cost:2000,rd_expense:3000,lithium_price:100000,industry_volatility:.15,...values});
function stage(periods=[row('2024-Q1')],unit='wan',basis='standalone_quarter'){
 return {id:'isolated-preview',payload:{dataset:{company:'核对企业',name:'尚未保存',amount_unit:'yuan',input_amount_unit:unit,period_basis:'standalone_quarter',periods,notes:'产销量单位由原口径注明'},quality:{closed_quarters:periods.length,warning_count:0,field_coverage:{present:7,total:8,period:periods.at(-1)?.period},findings:[]},diff:[],import_context:{mode:'new',filename:'用户文件.csv',input_amount_unit:unit,input_basis:basis,added:periods.map(p=>p.period),replaced:[],retained:[],removed:[],normalizations:[]}}};
}
function quarter(html,period){const marker=`data-preview-period="${period}"`;const start=html.indexOf(marker);assert(start>=0,`Missing readable quarter ${period}`);const end=html.indexOf('data-preview-period=',start+marker.length);return html.slice(start,end<0?html.indexOf('查看标准化后的完整数据',start):end);}
function cells(html,field){const m=html.match(new RegExp(`<tr[^>]*data-preview-field="${field}"[^>]*>([\\s\\S]*?)</tr>`));assert(m,`Missing human field ${field}`);return [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x=>x[1].replace(/<[^>]*>/g,'').trim());}

test('new file preview exposes quarter, Chinese amounts and missing inputs before technical JSON',()=>{
 const html=stageView(stage()),q=quarter(html,'2024-Q1');
 assert(html.indexOf('逐季度核对将保存的数据')<html.indexOf('查看标准化后的完整数据'));
 assert.deepEqual(cells(q,'revenue'),['营业收入','10','万元']);assert.deepEqual(cells(q,'cost'),['营业成本','9','万元']);
 assert.deepEqual(cells(q,'cash_flow'),['经营现金流','未提供','万元']);assert.deepEqual(cells(q,'net_profit'),['净利润','0','万元']);
 assert(html.includes('尚未写入财务库'));assert(html.includes('data-action="stage-back"'));assert(html.includes('data-action="commit-stage"'));
});
test('corrected preview copies saved normalized values and keeps each quarter separate',()=>{
 const s=stage([row('2024-Q1',{cost:80000}),row('2024-Q2',{revenue:120000,cost:100000,cash_flow:0})]),before=structuredClone(s),html=stageView(s);
 assert.deepEqual(cells(quarter(html,'2024-Q1'),'cost'),['营业成本','8','万元']);assert.deepEqual(cells(quarter(html,'2024-Q1'),'cash_flow'),['经营现金流','未提供','万元']);
 assert.deepEqual(cells(quarter(html,'2024-Q2'),'cost'),['营业成本','10','万元']);assert.deepEqual(cells(quarter(html,'2024-Q2'),'cash_flow'),['经营现金流','0','万元']);assert.deepEqual(s,before);
});
test('amount display preserves cents across original units without scaling quantities or prices',()=>{
 for(const [unit,value,label] of [['yuan','0.01','元'],['wan','0.000001','万元'],['yi','0.0000000001','亿元']]){
  const q=quarter(stageView(stage([row('2024-Q1',{net_profit:.01})],unit)),'2024-Q1');
  assert.deepEqual(cells(q,'net_profit'),['净利润',value,label]);assert.deepEqual(cells(q,'sales_volume'),['销量（统一单位）','100','原填数量']);assert.deepEqual(cells(q,'production_volume'),['产量（相同单位）','120','原填数量']);assert.deepEqual(cells(q,'lithium_price'),['锂价 / 元每吨','100,000','元/吨']);assert.deepEqual(cells(q,'industry_volatility'),['行业波动率 / 比值','0.15','比值']);
 }
});
test('cumulative input preview explicitly names normalized single quarters without inventing original rows',()=>{
 const html=stageView(stage([row('2024-Q1'),row('2024-Q2',{revenue:20000,cost:10000})],'wan','year_to_date'));
 assert(html.includes('年初累计已转为单季度'));assert(html.includes('下表显示将保存的单季度值'));assert.deepEqual(cells(quarter(html,'2024-Q2'),'revenue'),['营业收入','2','万元']);
});
test('pre-save value review never hides supported tiny nonzero or negative values as zero',()=>{
 const q=quarter(stageView(stage([row('2024-Q1',{net_profit:.0001,cash_flow:-12500,industry_volatility:1e-17})])),'2024-Q1');
 assert.deepEqual(cells(q,'net_profit'),['净利润','0.00000001','万元']);assert.deepEqual(cells(q,'cash_flow'),['经营现金流','-1.25','万元']);assert.deepEqual(cells(q,'industry_volatility'),['行业波动率 / 比值','0.00000000000000001','比值']);
 const smallest=quarter(stageView(stage([row('2024-Q1',{net_profit:Number.MIN_VALUE})],'yi')),'2024-Q1');assert.deepEqual(cells(smallest,'net_profit'),['净利润','5e-332','亿元']);
 const cents=quarter(stageView(stage([row('2024-Q1',{net_profit:.29,assets:999999999999999.9})])),'2024-Q1');assert.deepEqual(cells(cents,'net_profit'),['净利润','0.000029','万元']);assert.deepEqual(cells(cents,'assets'),['总资产','99,999,999,999.99999','万元']);
});
test('missing original-unit metadata uses the actual stored yuan contract',()=>{
 const s=stage();delete s.payload.import_context;delete s.payload.dataset.input_amount_unit;assert.deepEqual(cells(quarter(stageView(s),'2024-Q1'),'revenue'),['营业收入','100,000','元']);
});
test('all actual fields remain readable and unsafe labels or notes remain escaped',()=>{
 const s=stage();s.payload.dataset.notes='<img src=x onerror=alert(1)>';s.payload.dataset.periods[0].period='<script>季度';const html=stageView(s);
 assert(!html.includes('<img src=x'));assert(!html.includes('<script>季度'));assert(html.includes('&lt;img'));assert.equal((html.match(/data-preview-field=/g)||[]).length,15);assert(html.includes('产销与补充指标'));assert(html.includes('口径备注'));
});
