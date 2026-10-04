/** Financial presentation contracts; native task evidence is collected separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
globalThis.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const {messageView,chatAction,resetCopilot,copilotShell,mountCopilot,rememberDraft}=await import('../web/dist/copilot-ui.js');
globalThis.setInterval=interval;
const {state}=await import('../web/dist/state.js');
const {notice}=await import('../web/dist/components.js');
const {reportCompareForm,reportSelectionDetails,reportComparisonView}=await import('../web/dist/views-analysis.js');

function forecast(metric,value,unit='wan'){
 state.user={preferences:{amount_unit:unit}};
 return messageView({id:'synthetic',payload:{question:'核对已保存预测',response:{cards:[{kind:'forecast',title:'透明基线回测',data:{status:'completed',metric,selected_label:'上一季度',forecast:[{period:'2025-Q1',value}]}}]}}});
}
for(const [metric,label] of [['revenue','营业收入'],['cost','营业成本'],['cash_flow','经营现金流']])
 for(const [unit,display,name] of [['yuan','100,000','元'],['wan','10','万元'],['yi','0.001','亿元']])
  test(`assistant ${metric} exposes its metric and ${unit} scale`,()=>{
   const html=forecast(metric,100000,unit).split('<details>')[0];
   assert(html.includes(label));assert(html.includes(name));assert(html.includes(`<td>${display}</td>`));
  });
for(const [value,shown] of [[.2,'20%'],[0,'0%'],[-.2,'-20%'],[null,'—']])
 test(`assistant gross margin ${value} is a percentage with missing distinct from zero`,()=>{
  const html=forecast('gross_margin',value).split('<details>')[0];
  assert(html.includes('毛利率'));assert(html.includes(`<td>${shown}</td>`));assert(!html.includes('万元'));
 });
test('negative cash flow retains its sign and amount unit',()=>{
 const html=forecast('cash_flow',-100000).split('<details>')[0];
 assert(html.includes('经营现金流'));assert(html.includes('万元'));assert(html.includes('<td>-10</td>'));
});
test('legacy missing forecast metric discloses missing unit instead of assuming a monetary value',()=>{
 const html=forecast(undefined,.2).split('<details>')[0];
 assert(html.includes('指标未记录'));assert(!html.includes('<td>0.2</td>'));
});
test('blocked forecast shows its actual missing-input reason and cannot surface leftover values',()=>{
 const data={status:'blocked',reason:'至少需要6个连续且已结束季度',metric:'gross_margin',forecast:[{period:'2025-Q1',value:.2}]};
 const html=messageView({id:'blocked',payload:{question:'预测毛利率',response:{cards:[{kind:'forecast',title:'透明基线回测',data}]}}}).split('<details>')[0];
 assert(html.includes(data.reason));assert(!html.includes('2025-Q1'));assert(!html.includes('<td>20%</td>'));
});
test('same-minute reports remain identifiable by original data revision and saved question',()=>{
 state.cache={reports:[{id:'new-report-222',title:'相同报告标题',query:'同一季度核查',current_period:'2024-Q4',dataset_version:2,created_at:'2026-10-04T18:39:10Z'},{id:'old-report-111',title:'相同报告标题',query:'同一季度核查',current_period:'2024-Q4',dataset_version:1,created_at:'2026-10-04T18:39:08Z'}]};
 const html=reportCompareForm();assert(html.includes('数据修订 2'));assert(html.includes('数据修订 1'));assert(html.includes('同一季度核查'));
 const labels=[...html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map(m=>m[1]);assert.notEqual(labels[0],labels[1]);
 const summary=reportSelectionDetails('old-report-111','new-report-222');assert(summary.includes('2024-Q4'));assert(summary.includes('old-report-111'));assert(summary.includes('new-report-222'));
 const times=[...summary.matchAll(/<td>生成时间<\/td><td>([^<]+)<\/td>/g)].map(m=>m[1]);assert.equal(times.length,2);assert(times[0].endsWith(':08'));assert(times[1].endsWith(':10'));assert.notEqual(times[0],times[1]);
});
const comparison=(metric,before,after,delta)=>({left:'old',right:'new',left_period:'2024-Q4',right_period:'2024-Q4',same_period:true,same_rule_version:true,warning:'同季度输入修订',changes:[{metric,before,after,delta}],input_diff:[]});
for(const metric of ['gross_margin','net_margin','roe','cash_ratio','leverage','rd_ratio','revenue_growth'])test(`${metric} compares frozen percentages using percentage-point differences`,()=>{
 const r=comparison(metric,.2,.25,.05),frozen=structuredClone(r),html=reportComparisonView(r);
 assert(html.includes('<td>20%</td>'));assert(html.includes('<td>25%</td>'));assert(html.includes('<td>+5 个百分点</td>'));assert.deepEqual(r,frozen);
});
for(const metric of ['inventory_turnover','asset_turnover','sales_production_ratio'])test(`${metric} comparisons preserve multiples instead of percentages`,()=>{
 const html=reportComparisonView(comparison(metric,4,3.75,-.25));
 assert(html.includes('<td>4 倍</td>'));assert(html.includes('<td>3.75 倍</td>'));assert(html.includes('<td>-0.25 倍</td>'));
});
test('margin-change itself already uses percentage points; zero and missing remain distinct',()=>{
 let html=reportComparisonView(comparison('margin_change',0,.05,.05));assert(html.includes('<td>0 个百分点</td>'));assert(html.includes('<td>5 个百分点</td>'));assert(html.includes('<td>+5 个百分点</td>'));
 html=reportComparisonView(comparison('gross_margin',null,0,null));assert.equal((html.match(/<td>—<\/td>/g)||[]).length,2);assert(html.includes('<td>0%</td>'));
});
test('comparison text escapes saved content and separately discloses changed rules',()=>{
 const r={...comparison('gross_margin',.2,.25,.05),same_rule_version:false,warning:'<script>注入</script>',left_period:'<img>'};
 const html=reportComparisonView(r);assert(!html.includes('<script>'));assert(!html.includes('<img>'));assert(html.includes('规则版本不同'));assert(html.includes('冻结数值'));
 state.cache={reports:[{id:'x',query:'<svg>私有问题',current_period:'<script>',dataset_version:1}]};const details=reportSelectionDetails('x','missing');assert(!details.includes('<svg>'));assert(!details.includes('<script>'));assert(details.includes('请选择当前范围内'));
});

const app=ts.transpileModule(readFileSync(new URL('../web/app.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const start=app.indexOf("case 'report-compare-form':"),end=app.indexOf("case '",start+8);
assert(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const submitComparison=new AsyncFunction('env',`const {str,workspace,submittedCurrent,document,reportComparisonView,notice}=env;switch('report-compare-form'){${app.slice(start,end)}}`);
for(const current of [true,false])test(`actual comparison submit ${current?'renders frozen point differences':'does not overwrite a replaced comparison'}`,async()=>{
 const movements=[];const node={innerHTML:'newer view',style:{},closest:()=>({querySelector:()=>({getBoundingClientRect:()=>({height:72})})}),scrollIntoView:options=>movements.push(['scroll',options]),focus:options=>movements.push(['focus',options])};let reads=0;
 await submitComparison({str:key=>key==='left'?'old':'new',workspace:async()=>{reads++;return comparison('gross_margin',.2,.25,.05)},submittedCurrent:()=>current,document:{querySelector:()=>node},reportComparisonView,notice});
 assert.equal(reads,current?1:0);assert.deepEqual(movements,current? [['scroll',{block:'start',behavior:'auto'}],['focus',{preventScroll:true}]]:[]);if(current){assert.equal(node.style.scrollMarginTop,'84px');assert(node.innerHTML.includes('+5 个百分点'));assert(node.innerHTML.includes('data-report-left="old"'));assert(node.innerHTML.includes('data-report-right="new"'));}else assert.equal(node.innerHTML,'newer view');
});
test('selection changes during comparison never publish a late result under new inputs',async()=>{
 const node={innerHTML:'old values'};let current=true;
 await submitComparison({str:key=>key==='left'?'old':'new',workspace:async()=>{current=false;node.innerHTML='selection changed';return comparison('gross_margin',.2,.25,.05)},submittedCurrent:()=>current,document:{querySelector:()=>node},reportComparisonView,notice});
 assert.equal(node.innerHTML,'selection changed');
});
test('failed repeat comparison clears old values and does not leave a false loading state',async()=>{
 const node={innerHTML:'obsolete 5%'};
 await assert.rejects(submitComparison({str:key=>key==='left'?'old':'new',workspace:async()=>{throw Error('read failed')},submittedCurrent:()=>true,document:{querySelector:()=>node},reportComparisonView,notice}),/read failed/);
 assert(node.innerHTML.includes('本次比较未完成'));assert(!node.innerHTML.includes('obsolete'));assert(!node.innerHTML.includes('正在读取'));
});
test('an older read failure is discarded after the report selection changes',async()=>{
 const node={innerHTML:'old values'};let current=true;
 await submitComparison({str:key=>key==='left'?'old':'new',workspace:async()=>{current=false;node.innerHTML='selection changed';throw Error('failure belongs to former selection')},submittedCurrent:()=>current,document:{querySelector:()=>node},reportComparisonView,notice});
 assert.equal(node.innerHTML,'selection changed');
});
const changeStart=app.indexOf("if (el.closest('#report-compare-form')"),changeEnd=app.indexOf("if (el.id === 'plan-experiment')",changeStart);
assert(changeStart>=0&&changeEnd>changeStart);
const changeComparison=new Function('el','reportSelectionDetails','notice',app.slice(changeStart,changeEnd));
test('actual select-change branch updates readable sources and invalidates old comparison immediately',()=>{
 state.cache={reports:[{id:'a',query:'基准问题',current_period:'2024-Q4',dataset_version:1},{id:'b',query:'已更换问题',current_period:'2025-Q1',dataset_version:2}]};
 const details={innerHTML:''},result={innerHTML:'old 5%'},error={textContent:'previous selection error'};
 const form={querySelector:s=>s==='[name="left"]'?{value:'a'}:s==='[name="right"]'?{value:'b'}:s==='.form-error'?error:details,parentElement:{querySelector:()=>result}};
 changeComparison({name:'right',closest:()=>form},reportSelectionDetails,notice);
 assert(details.innerHTML.includes('已更换问题'));assert(details.innerHTML.includes('2025-Q1'));assert(result.innerHTML.includes('重新查看差异'));assert(!result.innerHTML.includes('old 5%'));assert.equal(error.textContent,'');
});
test('same report selection gives an error before a comparison read',async()=>{
 let reads=0;await assert.rejects(submitComparison({str:()=> 'same',workspace:async()=>{reads++},submittedCurrent:()=>true,document:{},reportComparisonView}),/两份不同/);assert.equal(reads,0);
});
test('forecast jump moves only its current message region, preserves the composer and does not read or write',async()=>{
 const previousDocument=globalThis.document,previousFetch=globalThis.fetch;let calls=0,focused=0;
 const card={getBoundingClientRect:()=>({top:800}),focus:options=>{assert.deepEqual(options,{preventScroll:true});focused++;}};
 const row={dataset:{message:'message-a'},querySelector:()=>card};
 const host={innerHTML:'',scrollTop:30,scrollHeight:1200,clientHeight:400,getBoundingClientRect:()=>({top:300}),querySelectorAll:selector=>selector==='.chat-turn'?[row]:[]};
 const composer={value:'继续输入的未发送草稿'};
 try{
  globalThis.document={...previousDocument,querySelector:selector=>selector==='#assistant-answer'?host:selector==='#assistant-query'?composer:null};
  Object.assign(state,{user:{id:'owner',preferences:{amount_unit:'wan'}},active:'dataset-a',identity:'',datasets:[{id:'dataset-a',version:1,payload:{company:'合成企业'}}],identities:[]});
  resetCopilot();copilotShell();rememberDraft(composer.value);
  const savedMessage={id:'message-a',payload:{question:'预测毛利率',response:{cards:[{kind:'forecast',title:'透明基线回测',data:{metric:'gross_margin',forecast:[{period:'2025-Q1',value:.2}]}}]}}};
  const savedThread={thread:{id:'thread-a',version:1,payload:{}},context:{writable:true},messages:[savedMessage],proposals:[],runs:[]};
  globalThis.fetch=async url=>{calls++;return new Response(JSON.stringify(url.includes('/threads?')?{items:[{id:'thread-a'}]}:savedThread),{headers:{'Content-Type':'application/json'}})};
  await mountCopilot();const reads=calls;
  assert(host.innerHTML.includes('data-x-action="chat-forecast"'));
  await chatAction('chat-forecast',{dataset:{message:'message-a'}});
  assert.equal(host.scrollTop,530);assert.equal(focused,1);assert.equal(calls,reads);assert.equal(composer.value,'继续输入的未发送草稿');
  state.identity='new-identity';await chatAction('chat-forecast',{dataset:{message:'message-a'}});
  assert.equal(host.scrollTop,530);assert.equal(focused,1);assert.equal(calls,reads);
 }finally{resetCopilot();globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});

const chatSource=ts.transpileModule(readFileSync(new URL('../web/copilot-ui.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const detailStart=chatSource.indexOf('function detailState('),detailEnd=chatSource.indexOf('export function alignChatBlock(',detailStart);
assert(detailStart>=0&&detailEnd>detailStart);
const collectDetails=new Function(chatSource.slice(detailStart,detailEnd)+';return detailState;')();
test('result-locating buttons never overwrite the message’s opened-detail state',()=>{
 const message={dataset:{message:'message-a'},querySelectorAll:()=>[{open:true},{open:false}]};
 const nestedButton={dataset:{message:'message-a'},querySelectorAll:()=>[]};
 const host={querySelectorAll:selector=>selector.includes('.chat-turn')?[message]:[message,nestedButton]};
 assert.deepEqual(collectDetails(host).get('message-a'),[0]);
});

// Whole-task discoverability: a frozen delta must be visible before a long table.
test('comparison leads with changed numerical facts and binds readable sources by actual response IDs',()=>{
 state.cache={reports:[{id:'new',query:'实际新问题',current_period:'2024-Q4',dataset_version:2,created_at:'2026-10-04T18:39:10Z'},{id:'old',query:'实际旧问题',current_period:'2024-Q4',dataset_version:1,created_at:'2026-10-04T18:39:08Z'}]};
 const r={...comparison('gross_margin',.2,.25,.05),changes:[{metric:'leverage',before:.3,after:.3,delta:0},{metric:'gross_margin',before:.2,after:.25,delta:.05},{metric:'roe',before:null,after:.1,delta:null}]};
 const frozen=structuredClone(r),html=reportComparisonView(r);
 assert.match(html,/<li[^>]*data-change-metric="gross_margin"[^>]*>[^]*?20%[^]*?25%[^]*?\+5 个百分点/);
 assert(!html.includes('data-change-metric="leverage"'));assert(!html.includes('data-change-metric="roe"'));
 assert(html.indexOf('data-change-metric="gross_margin"')<html.indexOf('<table'));
 assert(html.includes('实际旧问题'));assert(html.includes('实际新问题'));assert(html.includes('数据修订 1'));assert(html.includes('数据修订 2'));assert.deepEqual(r,frozen);
 assert.match(reportCompareForm(),/id="report-comparison"[^>]*role="region"[^>]*aria-label="报告差异结果"[^>]*tabindex="-1"/);
});
test('zero and unavailable deltas do not manufacture a change summary',()=>{
 state.cache={reports:[]};
 let html=reportComparisonView(comparison('gross_margin',.2,.2,0));assert(html.includes('可比较指标没有数值变化'));
 html=reportComparisonView(comparison('gross_margin',null,.2,null));assert(html.includes('没有可计算的数值差异'));assert(!html.includes('data-change-metric='));
 assert(html.includes('来源摘要未加载')); // A missing list entry is not invented from current data.
});
test('a newer comparison finishes before an older response without old values or focus stealing',async()=>{
 let releaseOld,currentOld=true;const events=[];
 const older={innerHTML:'',style:{},closest:()=>null,scrollIntoView:()=>events.push('old-scroll'),focus:()=>events.push('old-focus')};
 const newer={innerHTML:'',style:{},closest:()=>null,scrollIntoView:()=>events.push('new-scroll'),focus:()=>events.push('new-focus')};
 const base={reportComparisonView,notice};
 const pending=submitComparison({...base,str:key=>key==='left'?'old':'new',workspace:()=>new Promise(resolve=>{releaseOld=resolve}),submittedCurrent:()=>currentOld,document:{querySelector:()=>older}});
 currentOld=false;
 await submitComparison({...base,str:key=>key==='left'?'new':'old',workspace:async()=>({...comparison('gross_margin',.25,.2,-.05),left:'new',right:'old'}),submittedCurrent:()=>true,document:{querySelector:()=>newer}});
 const displayed=newer.innerHTML;assert(displayed.includes('-5 个百分点'));assert(displayed.includes('data-report-left="new"'));
 releaseOld(comparison('gross_margin',.2,.25,.05));await pending;
 assert.equal(newer.innerHTML,displayed);assert.deepEqual(events,['new-scroll','new-focus']);assert(!older.innerHTML.includes('+5 个百分点'));
});
