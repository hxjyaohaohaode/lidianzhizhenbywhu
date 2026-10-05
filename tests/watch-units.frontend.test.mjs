/** Actual production handlers with DOM/API doubles; native CI evidence is separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
const listeners=new Map();
globalThis.document={addEventListener(type,fn){listeners.set(type,fn)},querySelector(){return null},querySelectorAll(){return []}};
globalThis.window={addEventListener(){}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const {setupExperience}=await import('../web/dist/experience.js');
const {resetCopilot,reviewProposal,copilotShell,mountCopilot,copilotSubmit,chatAction}=await import('../web/dist/copilot-ui.js');
const {watchForm,trackingPage}=await import('../web/dist/views-services.js');
const {watchMetrics,watchValue,watchInputValue,parseWatchThreshold,watchThresholdField,watchThresholdRequest}=await import('../web/dist/watch-units.js');
const {state}=await import('../web/dist/state.js');
const {invalidateContext}=await import('../web/dist/api.js');
const {invalidateInteractions,interactionGuard}=await import('../web/dist/interactions.js');
globalThis.setInterval=interval;
const NativeFormData=globalThis.FormData;
globalThis.FormData=class extends NativeFormData{constructor(form){super();for(const [key,value] of form?.fields??[])this.set(key,value)}};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const ratioMetrics=['gross_margin','cash_ratio','leverage','revenue_growth'];
for(const metric of Object.keys(watchMetrics))test(`${metric} preserves units, signs, precision and canonical roundtrips`,()=>{
 const ratio=ratioMetrics.includes(metric);
 for(const value of [0,.15,.2,.29,-.29,1.25,-1.25,12345.67,1e-9,-1e-9,Number.MIN_VALUE,-Number.MIN_VALUE,1e15,-1e15,.12345678901234568]){
  const text=watchInputValue(metric,value),label=watchValue(metric,value);
  assert.equal(parseWatchThreshold(metric,text),value,`${metric}: ${text}`);
  assert(label.endsWith(ratio?'%':' 元（人民币）'));
  if(value)assert.notEqual(text,'0');
 }
 assert.equal(watchInputValue(metric,.29),ratio?'29':'0.29');
 assert.equal(watchValue(metric,null),'—');assert.equal(watchValue(metric,NaN),'—');
 assert.equal(watchValue(metric,Infinity),'—');
});
test('percentage inputs keep the existing canonical range, never clamp to 0–100%',()=>{
 assert.equal(parseWatchThreshold('gross_margin','-125'),-1.25);
 assert.equal(parseWatchThreshold('revenue_growth','250'),2.5);
 assert.equal(parseWatchThreshold('gross_margin','1e17'),1e15);
 assert.equal(parseWatchThreshold('cash_flow','-1e15'),-1e15);
 assert.equal(parseWatchThreshold('gross_margin','1.'),.01);
 for(const [metric,value] of [['gross_margin','1e18'],['gross_margin','-1e18'],['cash_flow','1000000000000001'],['gross_margin','1e-324'],['cash_flow','1e-999'],['gross_margin','1e999']])assert.throws(()=>parseWatchThreshold(metric,value));
 for(const value of ['', ' ', '0x10','Infinity','NaN','20%','1,234','abc'])assert.throws(()=>parseWatchThreshold('gross_margin',value));
 assert.throws(()=>parseWatchThreshold('net_margin','20'),/支持/);
 assert.equal(watchValue('unknown',.2),'—');
});
function form(kind='watch',values={},dataset={}){
 const fields=new Map(Object.entries({title:'合成毛利跟踪',dataset_id:'d',metric:'gross_margin',operator:'lt',threshold:'15',stale_after_days:'180',active:'on',request_id:'watch-request',source_ref:JSON.stringify({kind:'dataset',dataset_version:1,dataset_hash:'a'.repeat(64)}),...values}));
 const error={textContent:''},label={textContent:''},hint={textContent:''},button={disabled:false};
 const threshold={dataset:{watchMetric:fields.get('metric')},get value(){return fields.get('threshold')},set value(v){fields.set('threshold',v)}};
 const row={dataset:{serviceForm:kind,...dataset},fields,threshold,error,label,hint,button,isConnected:true,reportValidity(){return true},setAttribute(){},removeAttribute(){},querySelectorAll(){return [button]},querySelector(selector){if(selector==='[name="threshold"]')return threshold;if(selector==='.form-error')return error;if(selector==='[data-watch-threshold-label]')return label;if(selector==='[data-watch-threshold-hint]')return hint;const name=selector.match(/name="([^"]+)"/)?.[1];return name?{get value(){return fields.get(name)},set value(v){fields.set(name,v)}}:null}};
 return row;
}
function setup(overrides={}){
 invalidateInteractions();invalidateContext();resetCopilot();
 Object.assign(state,{user:{id:'owner',preferences:{role:'enterprise',amount_unit:'wan'}},identity:'',active:'d',datasets:[{id:'d',version:2,content_hash:'a'.repeat(64),payload:{company:'合成企业',name:'合成季度'}}],identities:[],cache:{},route:'tracking',dirty:false});
 const observed={dialogs:[],inspectors:[],toasts:[],close:0,render:0};
 document.querySelector=selector=>selector==='#modal'?{close(){observed.close++}}:null;
 setupExperience({dialog:(title,html)=>observed.dialogs.push({title,html}),inspect:(title,html)=>observed.inspectors.push({title,html}),toast:(message,error)=>observed.toasts.push({message,error}),navigate(){},render:async()=>{observed.render++},refresh:async valid=>!valid||valid(),reset(){},...overrides});
 observed.submit=f=>listeners.get('submit')({target:f,preventDefault(){},stopImmediatePropagation(){}});
 observed.change=(f,metric)=>{f.fields.set('metric',metric);return listeners.get('change')({target:{name:'metric',value:metric,closest:()=>f}})};
 observed.click=(action,id)=>listeners.get('click')({target:{closest:()=>({dataset:{xAction:action,id},setAttribute(){},removeAttribute(){}})},preventDefault(){},stopImmediatePropagation(){}});
 return observed;
}
test('create/edit forms show percent numbers and yuan regardless of global display preference',()=>{
 setup();const blank=watchForm();assert.match(blank,/阈值（%）/);assert.match(blank,/name="threshold" value=""/);assert(!blank.includes('20%填0.2'));
 const original={id:'w',version:4,payload:{title:'负数比例',dataset_id:'d',metric:'gross_margin',threshold:-1.25}};
 const before=structuredClone(original),edit=watchForm(original);assert.match(edit,/name="threshold" value="-125"/);assert.match(edit,/data-version="4"/);assert.deepEqual(original,before);
 const money=watchForm({...original,payload:{...original.payload,metric:'cash_flow',threshold:15000.25}});assert.match(money,/阈值（人民币元）/);assert.match(money,/name="threshold" value="15000.25"/);assert.match(money,/不随万元或亿元展示偏好换算/);
 assert.equal((blank.match(/<option value="(?:gross_margin|cash_ratio|leverage|revenue_growth|cash_flow|revenue)"/g)||[]).length,6);
});
for(const kind of ['watch','proposal'])test(`${kind} metric change clears the old unit; empty submit writes nothing`,async()=>{
 const old=fetch,h=setup(),f=form(kind,{},kind==='proposal'?{kind:'watch'}:{});let writes=0;
 try{
  globalThis.fetch=async()=>{writes++;return json({id:'w',version:1})};
  await h.change(f,'cash_flow');assert.equal(f.threshold.value,'');assert.equal(f.label.textContent,'阈值（人民币元）');assert.match(f.hint.textContent,/毛利率.*经营现金流.*旧阈值已清空/);assert.match(f.hint.textContent,/不随万元或亿元/);assert.equal(state.dirty,true);assert.equal(writes,0);
  assert.throws(()=>watchThresholdRequest(f,'cash_flow',f.threshold.value));
  if(kind==='watch'){await h.submit(f);assert.equal(writes,0);assert.equal(h.close,0);assert.match(f.error.textContent,/有效阈值/);assert.equal(h.toasts.length,0)}
  f.threshold.value='15000.25';assert.equal(watchThresholdRequest(f,'cash_flow',f.threshold.value),15000.25);
  await h.change(f,'gross_margin');assert.equal(f.threshold.value,'');assert.equal(f.label.textContent,'阈值（%）');
  f.threshold.value='25';await h.change(f,'revenue_growth');assert.equal(f.threshold.value,'');assert.match(f.hint.textContent,/收入增速/);
  f.threshold.value='25';await h.change(f,'revenue_growth');assert.equal(f.threshold.value,'25');
  assert.throws(()=>watchThresholdRequest(f,'revenue','25'),/指标已变化/);
 }finally{globalThis.fetch=old}
});
for(const [metric,input,canonical] of [['gross_margin','15',.15],['gross_margin','-125',-1.25],['cash_flow','15000.25',15000.25],['revenue','0.00000001',1e-8]])test(`actual watch submit ${metric}/${input} sends canonical ${canonical}`,async()=>{
 const old=fetch,h=setup(),f=form('watch',{metric,threshold:input},{id:'watch-a',version:'4'}),calls=[];
 try{globalThis.fetch=async(url,init)=>{calls.push({url,method:init.method,body:JSON.parse(init.body)});return json({id:'watch-a',version:5})};await h.submit(f);assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/services/watches/watch-a');assert.equal(calls[0].body.threshold,canonical);assert.equal(calls[0].body.version,4);assert.equal(f.dataset.version,'5');assert.equal(h.close,1);assert.equal(h.toasts.length,1)}finally{globalThis.fetch=old}
});
test('tracking cards, historical alerts and proposal review format frozen values without rewriting them',async()=>{
 const old=fetch,h=setup();const rule={id:'w',version:3,payload:{title:'毛利规则',dataset_id:'d',metric:'gross_margin',operator:'lt',threshold:.25,active:true}},alert={id:'alert-a',version:1,payload:{title:'历史毛利提醒',dataset_id:'d',metric:'gross_margin',operator:'lt',threshold:.25,value:.2,period:'2026-Q3',dataset_version:1,dataset_hash:'frozen'}};
 const result={schedule:'本地检查',evaluations:[{rule_id:'w',state:'triggered',value:.2,reason:'已按用户阈值核对',period:'2026-Q3'}],rules:[rule],alerts:[alert]},before=structuredClone(result);
 try{
  globalThis.fetch=async()=>json(result);const html=await trackingPage();assert.match(html,/<strong>25%<\/strong>/);assert.match(html,/当前值 20%/);assert.match(html,/历史阈值：低于 25%/);assert.match(html,/毛利率：20% · 2026-Q3/);assert.match(html,/ratio_fraction/);assert.match(html,/&quot;threshold&quot;: 0.25/);
  await h.click('alert-investigate','alert-a');let detail=h.inspectors.at(-1).html;assert.match(detail,/<td>20%<\/td>/);assert.match(detail,/<td>低于 25%<\/td>/);assert.match(detail,/2026-Q3/);assert.match(detail,/当前数据为修订 2/);assert.match(detail,/历史提醒不按新数据重算/);
  await h.click('alert-action','alert-a');const action=h.dialogs.at(-1).html;assert.match(action,/当时毛利率 20%，阈值 低于 25%/);assert.match(action,/数据修订 1/);assert.match(action,/alert-a/);
  const p={id:'p',version:1,payload:{kind:'watch',status:'draft',title:'比例提案',text:'合成审阅',binding:{dataset_version:1},fingerprint:'fingerprint',preview:rule.payload}};await reviewProposal(p);detail=h.dialogs.at(-1).html;assert.match(detail,/将要创建的跟踪规则/);assert.match(detail,/<td>25%<\/td>/);assert(detail.indexOf('25%')<detail.indexOf('技术原始值'));assert.match(detail,/data-fingerprint="fingerprint"/);assert.deepEqual(result,before);
  rule.payload.metric='cash_flow';rule.payload.threshold=15000.25;result.evaluations[0].value=12345.67;alert.payload.metric='cash_flow';alert.payload.threshold=15000.25;alert.payload.value=12345.67;const money=await trackingPage();assert.match(money,/15000.25 元（人民币）/);assert.match(money,/12345.67 元（人民币）/);assert(!money.includes('1.234567'));
 }finally{globalThis.fetch=old}
});
test('historical assistant transfer retains percent units and explicit current-revision boundary',async()=>{
 const old=fetch,calls=[],h=setup({navigateRendered:async()=>{invalidateInteractions();return interactionGuard()}});
 state.cache.tracking={alerts:[{id:'a',payload:{title:'毛利提醒',metric:'gross_margin',operator:'lt',value:.2,threshold:.25,period:'2026-Q3',dataset_version:1,dataset_id:'d'}}]};
 try{globalThis.fetch=async(url,init)=>{calls.push({url,body:init.body?JSON.parse(init.body):null});if(url.includes('/threads?'))return json({items:[]});if(url==='/api/services/threads')return json({id:'t',version:1,payload:{identity_id:'',dataset_id:'d'}});if(url.endsWith('/messages'))return json({id:'m'});return json({thread:{id:'t',version:2,payload:{}},messages:[],proposals:[],runs:[]})};await h.click('alert-current-investigate','a');const texts=calls.filter(c=>c.url.endsWith('/messages'));assert.equal(texts.length,1);assert.match(texts[0].body.text,/当时值 20%、阈值 低于 25%/);assert.match(texts[0].body.text,/明确使用当前保存的修订/);assert.match(texts[0].body.text,/2026-Q3，数据修订 1/)}finally{globalThis.fetch=old;resetCopilot()}
});
for(const [metric,input,canonical] of [['gross_margin','25',.25],['cash_flow','15000.25',15000.25]])test(`actual ${metric} proposal form and submission uses same unit contract`,async()=>{
 const old=fetch,h=setup(),calls=[];copilotShell();
 const thread={thread:{id:'t',version:1,payload:{identity_id:'',dataset_id:'d'}},context:{writable:true},messages:[],proposals:[],runs:[]};
 try{
  globalThis.fetch=async(url,init)=>{if(init.method==='POST'){calls.push(JSON.parse(init.body));return json({id:'p',version:1,payload:{kind:'watch',status:'draft',title:'合成提案',text:'核查毛利',binding:{dataset_version:2},fingerprint:'x',preview:{metric,operator:'lt',threshold:canonical}}})}return json(url.includes('/threads?')?{items:[{id:'t'}]}:thread)};
  await mountCopilot();await chatAction('chat-propose',{dataset:{kind:'watch'}});assert.match(h.dialogs.at(-1).html,/阈值（%）/);assert.match(h.dialogs.at(-1).html,/20 表示 20%/);
  const f=form('proposal',{metric,threshold:input,text:'核查毛利指标的变化'},{thread:'t',kind:'watch',key:'proposal-key'});await copilotSubmit(f,new FormData(f));assert.equal(calls.length,1);assert.equal(calls[0].threshold,canonical);assert.equal(calls[0].metric,metric);assert.match(h.dialogs.at(-1).html,metric==='gross_margin'?/25%/:/15000.25 元（人民币）/);
 }finally{globalThis.fetch=old;resetCopilot()}
});
test('changing metric during a pending create keeps the new unit draft and renews only its next-create token',async()=>{
 const old=fetch,h=setup(),f=form(),calls=[];let finish;
 try{
  globalThis.fetch=(url,init)=>{calls.push(JSON.parse(init.body));return new Promise(resolve=>finish=resolve)};
  const pending=h.submit(f);await turn();assert.equal(calls[0].threshold,.15);
  await h.change(f,'cash_flow');f.threshold.value='15000.25';
  finish(json({id:'w',version:1}));await pending;
  assert.equal(f.threshold.value,'15000.25');assert.equal(f.threshold.dataset.watchMetric,'cash_flow');assert.equal(h.close,0);assert.equal(state.dirty,true);assert.notEqual(f.fields.get('request_id'),'watch-request');assert.match(h.toasts[0].message,/上一版规则已保存/);assert.equal(calls.length,1);
 }finally{globalThis.fetch=old}
});
test('unit-aware save failure keeps the editor open and never announces success',async()=>{
 const old=fetch,h=setup(),f=form('watch',{metric:'cash_flow',threshold:'15000.25'},{id:'w',version:'2'});
 try{globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'VERSION_CONFLICT',message:'规则版本已变化'}}),{status:409,headers:{'Content-Type':'application/json'}});await h.submit(f);assert.equal(h.close,0);assert.equal(h.toasts.length,0);assert.match(f.error.textContent,/规则版本已变化/);assert.equal(f.threshold.value,'15000.25');assert.equal(f.dataset.version,'2');assert.equal(f.button.disabled,false)}finally{globalThis.fetch=old}
});
