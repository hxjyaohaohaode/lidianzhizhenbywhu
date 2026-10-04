import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../web/dist/state.js';
import {qualityPanel,importForm} from '../web/dist/views-data.js';

test('preview distinguishes zero structural warnings from missing fields and unverified inputs',()=>{
 const html=qualityPanel({closed_quarters:2,warning_count:0,field_coverage:{present:7,total:8,period:'2024-Q2'},findings:[{period:'2024-Q1',severity:'info',message:'字段缺失',fields:['cash_flow']},{period:'2024-Q2',severity:'info',message:'字段缺失',fields:['cash_flow']}]});
 assert(html.includes('0 项结构警告'));assert(html.includes('2 项字段与来源提示'));assert(html.includes('未独立核验'));assert(!html.includes('0 项需核对'));assert(html.includes('经营现金流'));assert(html.includes('2024-Q1'));
});
test('returning to file selection retains metadata but requires choosing a file again',()=>{
 Object.assign(state,{identity:'',active:'',datasets:[],user:{preferences:{amount_unit:'yuan'}}});
 const html=importForm({identity_id:'',active_dataset:'',company:'原企业 & 未保存',amount_unit:'wan',basis:'year_to_date',merge_mode:'merge',target_id:'',target_versions:{}});
 assert(html.includes('原企业 &amp; 未保存'));assert.match(html,/<option value="wan" selected/);assert.match(html,/<option value="year_to_date" selected/);assert(html.includes('重新选择'));assert.match(html,/<input type="file"[^>]+required/);assert(!html.includes('type="file" value='));
});
const {reportReadout}=await import('../web/dist/report-readout.js');
const {readFileSync}=await import('node:fs');
test('actual older exported structure is labeled unrecorded instead of borrowing current sources',()=>{
 const legacy=JSON.parse(readFileSync(new URL('./fixtures/legacy-first-use-report-00310c1d.json',import.meta.url),'utf8'));
 const frozen=structuredClone(legacy);assert.equal(legacy.readout,undefined);
 const html=reportReadout(legacy);assert(html.includes('当时未记录'));assert.deepEqual(legacy,frozen);
});
test('frozen question answer displays cash amount missing and readable source without HTML execution',()=>{
 const r={query:'2024-Q1毛利率和经营现金流是多少',dataset_version:1,dataset_hash:'saved-hash',readout:{scope_recorded:true,amount_unit:'wan',period:'2024-Q1',notice:'未独立核验',facts:[{id:'gross_margin',label:'毛利率',period:'2024-Q1',value:.2,unit:'ratio',reason:'',formula:'(收入−成本)/收入',inputs:[{path:'periods/2024-Q1/revenue',value:100000,unit:'CNY'},{path:'periods/2024-Q1/cost',value:80000,unit:'CNY'}]},{id:'cash_flow',label:'经营现金流',period:'2024-Q1',value:null,unit:'CNY',reason:'经营现金流金额未提供，不能给出金额',formula:'原始输入',inputs:[{field:'cash_flow',value:null,unit:'CNY'}]}],input_source:{file:{name:'<img src=x>.csv',sha256:'file-sha'},input_amount_unit:'wan',input_basis:'standalone_quarter',notice:'未保存原文件'},next_steps:[{conditional:false,action:'补充2024-Q1经营现金流并保存新修订'}]}};
 const frozen=structuredClone(r),html=reportReadout(r);
 for(const expected of ['本次问题的回答','20%','营业收入','营业成本','10 万元','8 万元','经营现金流金额未提供','file-sha','单季度','下一步需要补充什么'])assert(html.includes(expected),expected);
 assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert.deepEqual(r,frozen);
});
test('a stale import target or changed identity never silently turns returned revision into a new dataset',()=>{
 Object.assign(state,{identity:'',active:'',datasets:[],user:{preferences:{amount_unit:'yuan'}}});
 assert.throws(()=>importForm({target_id:'lost'}),/原导入目标/);
 assert.throws(()=>importForm({identity_id:'different',active_dataset:''}),/上下文已变化/);
});
const {default:ts}=await import('typescript');
const appCode=ts.transpileModule(readFileSync(new URL('../web/app.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const begin=appCode.indexOf("case 'import-file-form':"),end=appCode.indexOf("case '",begin+8);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const importSubmit=new AsyncFunction('env',`const {state,form,f,str,workspace,submittedCurrent,showStage}=env;switch('import-file-form'){${appCode.slice(begin,end)}}`);
test('new import server replace mode does not overwrite the original return-to-edit selection',async()=>{
 const f=new FormData();for(const [k,v] of Object.entries({target_id:'',merge_mode:'merge',company:'用户原企业',amount_unit:'wan',basis:'year_to_date'}))f.set(k,v);
 const local={identity:'',active:'',datasets:[],cache:{}};let sent;
 await importSubmit({state:local,form:{dataset:{targetVersions:'{}'}},f,str:k=>String(f.get(k)??'').trim(),workspace:async(path,method,data)=>{sent=data.get('merge_mode');return{}},submittedCurrent:()=>true,showStage:async()=>{}});
 assert.equal(sent,'replace');assert.equal(local.cache.importDraft.merge_mode,'merge');assert.equal(local.cache.importDraft.company,'用户原企业');assert.equal(local.cache.importDraft.basis,'year_to_date');
});
