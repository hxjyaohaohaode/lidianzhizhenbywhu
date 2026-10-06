/** Actual compiled readers with captured, isolated API data. DOM/API, not native browser QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedQualityView,currentQualityView} from '../web/dist/copilot-quality.js';
import {assistantView} from '../web/dist/assistant.js';
import {esc,jsonView} from '../web/dist/components.js';

globalThis.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const {messageView}=await import('../web/dist/copilot-ui.js');globalThis.setInterval=interval;
const {state}=await import('../web/dist/state.js');
const fixtures=new URL('./fixtures/copilot-quality/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',fixtures),'utf8'));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function fixture(name){const bytes=readFileSync(new URL(name+'-api.json',fixtures));assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.files[name+'-api.json']);return freeze(JSON.parse(bytes));}
const beforeRaw=html=>html.split('<details data-quality-raw>')[0];
const savedCard=html=>html.match(/<div data-quality-reader="saved">([\s\S]*?)<\/section>/)?.[1];
const currentCard=html=>html.match(/<section class="assistant-section" data-quality-reader="current">([\s\S]*?)<\/section>/)?.[1];
const rows=html=>(html.match(/data-quality-finding/g)??[]).length;

test('captured eleven findings show six original quarters and expand the other five without changing JSON',()=>{
 const f=fixture('missing'),m=f.message_post_response.message,before=JSON.stringify(f),q=m.payload.response.cards[0].data;
 Object.assign(state,{user:{preferences:{amount_unit:'yi'}},active:'unrelated',datasets:[{id:'unrelated',version:99,payload:{company:'不得混入的新企业'}}]});
 const html=messageView(m),card=savedCard(html),readable=beforeRaw(card),preview=readable.split('<details data-quality-remaining>')[0];
 assert(preview.includes('先显示 6/11 项'));assert.equal(rows(preview),6);assert.equal(rows(readable),11);
 assert(readable.includes('展开其余已保存 5 项'));
 for(const period of ['2022-Q1','2022-Q2','2022-Q3','2022-Q4','2023-Q1','2023-Q2'])assert(preview.includes(period+' · 销量、产量'));
 assert(!preview.includes('2023-Q3 · 销量'));
 for(const period of ['2023-Q3','2023-Q4','2024-Q1','2024-Q2'])assert(readable.includes(period+' · 销量、产量'));
 assert(readable.includes('2024-Q2 · 原始来源地址'));assert(readable.includes(q.findings[10].message));
 assert(readable.includes('原消息输入：'+f.dataset.payload.company));assert(readable.includes('数据修订 1'));assert(!readable.includes('不得混入的新企业'));assert(!readable.includes('99'));
 assert(readable.includes('来源由用户声明，尚未独立核验'));assert(!readable.includes('吨')&&!readable.includes('万元')&&!readable.includes('亿元'));
 assert(!readable.includes('MISSING_FIELDS')&&!readable.includes('MISSING_SOURCE'));assert(card.includes(jsonView(q)));assert.equal(JSON.stringify(f),before);
});

test('the actual current renderer uses only its five returned findings and own scope',()=>{
 const f=fixture('missing'),result=structuredClone(f.trace_response);result.scope.dataset_version=8;result.scope.company='本次复核企业';
 result.quality[0].message='本次读到的新提示';const before=JSON.stringify(result);
 const html=assistantView('当前输入复核',freeze(result)),card=currentCard(html),readable=beforeRaw(card);
 assert(readable.includes('本次复核显示 5 项，共 11 项'));assert.equal(rows(readable),5);assert(!readable.includes('接口')&&!readable.includes('MISSING_FIELDS'));
 assert(readable.includes('其余 6 项未包含在本次复核结果中'));assert(!readable.includes('展开其余'));
 assert(readable.includes('2022-Q1 · 销量、产量'));assert(readable.includes('本次读到的新提示'));
 assert(!readable.includes('2023-Q2 · 销量')&&!readable.includes('原始来源地址'));
 assert(readable.includes('本次复核输入：本次复核企业 · 数据修订 8'));assert(!readable.includes(f.dataset.payload.company));
 assert(card.includes(jsonView(result)));assert.equal(JSON.stringify(result),before);
 const stored=beforeRaw(savedCard(messageView(f.message_post_response.message)));assert(!stored.includes('本次读到的新提示'));assert(stored.includes('数据修订 1'));
});

for(const name of ['zero-revenue','zero-quantity'])test('captured '+name+' keeps zero, missing and source semantics',()=>{
 const f=fixture(name),before=JSON.stringify(f),message=f.message_post_response.message;
 const cards=[beforeRaw(savedCard(messageView(message))),beforeRaw(currentCard(assistantView(message.payload.question,f.trace_response)))];
 for(const card of cards){
  assert(card.includes('来源由用户声明，尚未独立核验'));
  assert(card.includes('未列出提示不表示全部输入完整、全部指标可计算或来源已核实'));
  if(name==='zero-revenue'){
   assert.equal(rows(card),1);assert(card.includes('2024-Q2 · 营业收入'));assert(card.includes('收入为零，相关比率不可计算'));
   assert(!card.includes('营业收入未提供'));assert(!card.includes('万元')&&!card.includes('0 元'));
  }else{assert.equal(rows(card),0);assert(card.includes('0/0 项')||card.includes('本次复核显示 0 项，共 0 项'));assert(card.includes('未列出质量提示'));}
 }
 assert.equal(JSON.stringify(f),before);
});

test('legacy rows retain unknown periods and fields and never borrow the last covered quarter',()=>{
 const q={findings:[{message:'原文A'},{period:' ',fields:[],message:'原文B'},{period:null,fields:['future_metric','constructor','__proto__'],code:'NEW_RULE',message:'未知规则原文'}],field_coverage:{period:'2099-Q4',missing:['revenue']}};
 const html=beforeRaw(savedQualityView(freeze(q),{dataset_version:2,question_scope:{period:'2088-Q1'}},{company:'原企业'}));
 assert.equal((html.match(/期间未记录/g)??[]).length,3);assert.equal((html.match(/涉及字段未记录/g)??[]).length,2);
 for(const key of ['future_metric','constructor','__proto__'])assert(html.includes('未知字段（原标识：'+key+'）'));
 assert(html.includes('未知提示标识：NEW_RULE'));assert(html.includes('未知规则原文'));assert(!html.includes('2099-Q4'));assert(!html.includes('营业收入'));
 assert(html.includes('来源状态未记录'));
});

test('absent or malformed lists are unreadable, never zero findings or a success result',()=>{
 for(const value of [undefined,null,{},'broken',0,false]){
  let html=beforeRaw(savedQualityView({findings:value}));assert(html.includes('无法判断待核查事项'));assert(!html.includes('0/0'));assert(!html.includes('本条消息未列出'));
  html=beforeRaw(currentQualityView({quality:value,quality_total:11}));assert(html.includes('无法判断待核查事项'));assert(!html.includes('0/11'));assert(!html.includes('本次响应未列出'));
 }
 for(const value of [undefined,null,'old payload',[],0])assert.doesNotThrow(()=>savedQualityView(value));
});

test('malformed entries remain visible positions without guessing their fields or messages',()=>{
 const q={findings:[null,0,'old row',[],{period:0,fields:[null,0,{},''],message:null},{fields:'revenue',message:0}],source_state:'future_state'};
 const html=beforeRaw(savedQualityView(freeze(q)));
 assert.equal(rows(html),6);assert(html.includes('6/6 项'));assert(html.includes('字段记录不可读'));assert(html.includes('原提示未记录'));
 assert(!html.includes('营业收入'));assert(html.includes('来源状态含义未确认（原标识：future_state）'));
});

test('missing, invalid and inconsistent current totals do not manufacture returned findings',()=>{
 const quality=[{period:'2024-Q2',fields:['cash_flow'],message:'原提示'}];
 for(const quality_total of [undefined,null,'11',-1,1.5,NaN,Infinity]){
  const html=beforeRaw(currentQualityView({quality,quality_total}));assert(html.includes('本次复核显示 1 项；总数未记录'));assert.equal(rows(html),1);
 }
 let html=beforeRaw(currentQualityView({quality,quality_total:0}));assert(html.includes('结果记载的总数 0 与条目数不一致'));assert(!html.includes('1/0'));
 html=beforeRaw(currentQualityView({quality:[],quality_total:11}));assert(html.includes('本次复核显示 0 项，共 11 项'));assert(html.includes('其余 11 项未包含在本次复核结果中'));assert.equal(rows(html),0);
});

test('all original text is escaped and long fields and messages remain complete and wrap',()=>{
 const field='<img src=x onerror="bad">'+('long_field_'.repeat(400)),message='  <script>原提示</script>\n'+('长提示'.repeat(400));
 const q=freeze({findings:[{period:'<svg>',fields:[field],message,code:'</small><iframe>'}],source_state:'<video>'});
 const html=savedQualityView(q,{dataset_version:'<x>',question_scope:{period:'<period>'}},{company:'<company>'}),readable=beforeRaw(html);
 for(const value of [field,message,'<svg>','</small><iframe>','<video>','<period>','<company>'])assert(readable.includes(esc(value)));
 for(const value of ['<img','<script>','<iframe>','<video>','<company>'])assert(!html.includes(value));
 assert(readable.includes('preserve-lines'));assert(html.includes(jsonView(q)));assert(!readable.includes('data-route')&&!readable.includes('data-action'));
});

test('known financial and source fields have labels without invented values or units',()=>{
 const fields=['period','revenue','cost','cash_flow','net_profit','assets','liabilities','inventory','equity_begin','equity_end','sales_volume','production_volume','manufacturing_cost','rd_expense','lithium_price','industry_volatility','source_url','source_kind'];
 const html=beforeRaw(savedQualityView({findings:[{period:'2024-Q2',fields,message:'逐项核对'}]}));
 for(const label of ['季度','营业收入','营业成本','经营现金流','净利润','总资产','总负债','库存金额','期初净资产','期末净资产','销量','产量','制造费用','研发费用','锂价','行业波动率','原始来源地址','来源类型'])assert(html.includes(label));
 assert(!html.includes('未知字段'));assert(!html.includes('元/吨')&&!html.includes('人民币元')&&!html.includes('统一单位'));
});

test('both readers explain the company, quarter and explicit revision recheck workflow without new navigation',()=>{
 for(const html of [savedQualityView({findings:[]}),currentQualityView({quality:[],quality_total:0})]){
  const readable=beforeRaw(html);
  for(const text of ['“经营数据”先核对本卡记录的企业','对应季度与原报表','保存新修订后重新提问','主动点击“按当前输入复核”','“证据资料”补充并审阅','旧消息与旧报告不会自动改写'])assert(readable.includes(text));
  assert(!readable.includes('data-route')&&!readable.includes('data-action')&&!readable.includes('<form'));
 }
});
