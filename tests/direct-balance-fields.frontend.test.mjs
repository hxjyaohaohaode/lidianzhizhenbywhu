/** Compiled renderer/form contracts. No native browser execution is claimed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as components from '../web/dist/components.js';
import {adaptiveOptions} from '../web/dist/views-orchestrator.js';
import {reportReadout} from '../web/dist/report-readout.js';
import {researchInputRequest,scopedResearchInputs,researchInputFields} from '../web/dist/copilot-research-inputs.js';
import {serviceForm} from '../web/dist/views-services.js';
globalThis.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const {messageView}=await import('../web/dist/copilot-ui.js');globalThis.setInterval=interval;
const {assistantView}=await import('../web/dist/assistant.js');
const displays={yuan:'2,500,000.01 元',wan:'250.000001 万元',yi:'0.0250000001 亿元'};
function fact(unit='wan',value=2500000.01){return {id:'assets',label:'总资产',period:'2024-Q4',value,
 unit:'CNY',period_basis:'quarter_end_stock',dataset_id:'recorded-data',dataset_version:3,input_hash:'saved-hash',
 display_amount_unit:unit,display_value:value===null?'未提供':value===0?'0 '+components.unitName(unit):displays[unit],
 formula:'已保存的季度期末存量（标准化为人民币元；累计转单季不差分）',
 inputs:[{path:'periods/2024-Q4/assets',field:'assets',value,unit:'CNY'}],trend:[{period:'2024-Q4',value}],
 comparison:{kind:'year_over_year',period:'2023-Q4',operation:'difference',value:1000000,
 change:value===null?null:value-1000000,change_unit:'CNY',reason:value===null?'本期或基期指标输入不足，不能计算变化':''}};}
const renderers={legacy:facts=>assistantView('总资产与总负债',{answer:'按原字段核查',facts}),
 service:facts=>messageView({id:'balance',created_at:'2026-10-05',payload:{question:'总资产与总负债',response:{answer:'按原字段核查',facts}}})};
for(const [name,render] of Object.entries(renderers)){
 for(const unit of Object.keys(displays))test(`${name} presents stock values and comparison in frozen ${unit} preference`,()=>{
  const f=fact(unit),before=structuredClone(f),html=render([f]);
  assert(html.includes(displays[unit]));assert(html.includes('2024-Q4'));assert(html.includes('同比 · 2023-Q4'));
  assert(html.includes('periods/2024-Q4/assets'));assert(html.includes('期末存量'));assert(!html.includes('%'));
  assert(html.includes(components.amount(1500000.01,unit)+' '+components.unitName(unit)));
  assert.deepEqual(f,before);
 });
 test(`${name} keeps zero distinct from absent balances and keeps ratio units`,()=>{
  const f=fact('wan',0),missing={...fact('wan',null),id:'liabilities',label:'总负债'};
  const html=render([f,missing,{id:'leverage',label:'资产负债率',value:.2,display_value:'20.00%',period:'2024-Q4',dataset_version:3}]);
  assert(html.includes('0 万元'));assert(html.includes('未提供'));assert(html.includes('20'));
  assert(html.includes('%'));assert(html.includes('不能计算变化'));assert(!html.includes('总资产</span><strong>0%'));
 });
 test(`${name} uses frozen subcent displays for the fact, source, trend and difference`,()=>{
  const f=fact('wan',.004);Object.assign(f,{display_value:'0.0000004 万元',source_display_value:'0.004 元',
   trend:[{period:'2024-Q4',value:.004,display_value:'0.0000004 万元'}]});
  Object.assign(f.comparison,{value:.003,change:.001,display_change:'0.0000001 万元'});
  const before=structuredClone(f),html=render([f]);
  assert(html.includes('<strong>0.0000004 万元</strong>'));assert(html.includes('0.004 元'));
  assert(html.includes('+0.0000001 万元'));assert(!html.includes('<strong>0 万元</strong>'));
  // Count the two visible fact/trend values; the quality disclosure also preserves the full raw response.
  if(name==='legacy')assert.equal((html.match(/<strong>0\.0000004 万元<\/strong>/g)||[]).length,2);
  assert.deepEqual(f,before);
 });
 test(`${name} shows nonzero balance inputs in a mixed ratio fact`,()=>{
  const ratio={id:'leverage',label:'资产负债率',value:.25,display_value:'25.00%',period:'2024-Q4',dataset_version:2,
   formula:'负债/资产',inputs:[{path:'periods/2024-Q4/liabilities',value:.001,unit:'CNY'},
    {path:'periods/2024-Q4/assets',value:.004,unit:'CNY'}],
   input_display_values:{'periods/2024-Q4/liabilities':'0.001 元','periods/2024-Q4/assets':'0.004 元'}};
  const before=structuredClone(ratio),html=render([ratio]);assert(html.includes('0.001 元'));assert(html.includes('0.004 元'));
  assert(!html.includes('>0 CNY<'));assert.deepEqual(ratio,before);
 });
}
test('frozen report answers totals in money and preserves sources without mutating history',()=>{
 const f=fact('wan'),r={query:'2024-Q4总资产',dataset_version:3,dataset_hash:'saved-hash',readout:{scope_recorded:true,
  amount_unit:'wan',period:'2024-Q4',facts:[{...f,reason:''}],notice:'原输入未经核验',
  input_source:{file:{name:'recorded-balances.csv',sha256:'file-hash'},input_amount_unit:'wan',
   input_basis:'standalone_quarter',notice:'仅保存文件指纹'},next_steps:[]}};
 const before=structuredClone(r),html=reportReadout(r);
 for(const expected of ['250.000001 万元','总资产','期末存量','recorded-balances.csv','file-hash','saved-hash'])assert(html.includes(expected),expected);
 assert.deepEqual(r,before);
});
test('new report reads precise saved stock presentation while leaving historical fallback unchanged',()=>{
 const f={...fact('yi',.004),display_value:'0.00000000004 亿元',reason:'',
  inputs:[{path:'periods/2024-Q4/assets',field:'assets',value:.004,unit:'CNY',display_value:'0.00000000004 亿元'}]};
 const r={query:'总资产',readout:{scope_recorded:true,amount_unit:'yi',period:'2024-Q4',facts:[f],input_source:{},next_steps:[]}};
 const before=structuredClone(r),html=reportReadout(r);
 assert.equal((html.match(/0\.00000000004 亿元/g)||[]).length,2);assert.deepEqual(r,before);
 // A report that did not record the new presentation keeps the original reader
 // formatting; no current preference or source is backfilled into it.
 const old=structuredClone(r);delete old.readout.facts[0].display_value;delete old.readout.facts[0].inputs[0].display_value;
 assert(reportReadout(old).includes('0 亿元'));assert.equal(old.readout.facts[0].value,.004);
});
function inputTag(html,name){const tag=[...html.matchAll(/<input\b[^>]*>/g)].map(m=>m[0]).find(tag=>tag.includes(`name="${name}"`));assert(tag,name);return tag;}
test('compiled main planning form leaves forecast off and local recovery on',()=>{
 const html=adaptiveOptions({providers:[]});assert(!/\bchecked\b/.test(inputTag(html,'forecast')));
 assert(/\bchecked\b/.test(inputTag(html,'local_recovery')));
});
test('compiled source-message proposal form keeps the stock question and submits forecast false',async()=>{
 const source=readFileSync(new URL('../web/dist/copilot-ui.js',import.meta.url),'utf8');
 const start=source.indexOf('async function proposalForm('),end=source.indexOf('export async function reviewProposal(',start);
 assert(start>=0&&end>start);let html;
 const dataset={id:'data',version:1,content_hash:'a'.repeat(64),payload:{company:'合成企业'}};
 const scope={identity:'',active:'data'},question='2024-Q4总资产与总负债';
 const current={context:{writable:true},thread:{payload:{identity_id:'',dataset_id:'data'}},messages:[{id:'source',payload:{question}}]};
 const env={...components,current,state:scope,draft:'unrelated draft',threadId:'thread',ensureThread:async()=>{},
  activeIdentity:()=>null,scopedDatasets:()=>[dataset],api:async()=>({items:[]}),workspace:async()=>({items:[]}),
  currentComparisonRead:fn=>fn(),scopedResearchInputs,researchInputFields,serviceForm,token:()=> 'new-form',
  interactionGuard:()=>()=>true,hooks:{dialog(_title,body){html=body;}}};
 const create=new Function('env',`const {${Object.keys(env).join(',')}}=env;let researchForm;${source.slice(start,end)};return proposalForm;`)(env);
 await create('research','source',()=>true);
 assert(html.includes(question));assert(!html.includes('unrelated draft'));
 assert(!/\bchecked\b/.test(inputTag(html,'forecast')));assert(!/\bchecked\b/.test(inputTag(html,'use_llm')));
 const fd=new FormData();fd.set('text',question);fd.set('forecast_metric','revenue');fd.set('horizon','2');
 const catalog=scopedResearchInputs('',dataset.id,{items:[]},{items:[]},[dataset]);
 assert.equal(researchInputRequest(fd,catalog,'',dataset.id,[dataset]).forecast.forecast,false);
 // Explicitly selected forecast remains the user's choice; the server returns
 // an actionable blocker. Unchecking it uses this same production submit path.
 fd.set('forecast','on');assert.equal(researchInputRequest(fd,catalog,'',dataset.id,[dataset]).forecast.forecast,true);
 fd.delete('forecast');assert.equal(researchInputRequest(fd,catalog,'',dataset.id,[dataset]).forecast.forecast,false);
});
