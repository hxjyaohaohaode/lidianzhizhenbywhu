/** Scoped saved-input selection and DOM/API bridge contracts; not native-browser E2E. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {scopedResearchInputs,researchInputFields,syncResearchInputControls,researchInputRequest,researchApprovalInputs,researchRunOutputs} from '../web/dist/copilot-research-inputs.js';
import {invalidateInteractions} from '../web/dist/interactions.js';

const ds={id:'dataset-a',version:3,content_hash:'a'.repeat(64),payload:{company:'主企业'}};
const peer={id:'dataset-b',version:2,content_hash:'b'.repeat(64),payload:{company:'对照企业'}};
const datasets=[ds,peer];
const experiment={id:'saved-forecast',version:2,experiment_hash:'c'.repeat(64),payload:{company:'主企业',dataset_id:ds.id,dataset_version:ds.version,dataset_hash:ds.content_hash,target_period:'2026-Q2',analysis_as_of:'2026-09-30',request:{kind:'forecast',name:'冻结现金预测',assumptions:'按已保存现金流假设复用',metric:'cash_flow',horizon:4}}};
const scenario={...experiment,id:'saved-scenario',experiment_hash:'d'.repeat(64),payload:{...experiment.payload,request:{kind:'scenario',name:'售价情景',assumptions:'经确认的售价敏感性假设',price_change:.1,cost_change:.05,volume_change:0,fixed_cost_share:.2}}};
const comparison={id:'saved-comparison',version:4,comparison_hash:'e'.repeat(64),source_impact:{state:'current',reasons:[]},payload:{identity_id:'identity-a',name:'冻结双企业对照',period:'2026-Q2',comparison:'previous',analysis_as_of:'2026-09-30',period_basis:'standalone_quarter',comparability_note:'仅同季度口径对照，未认定业务可比',members:datasets.map(d=>({id:d.id,version:d.version,hash:d.content_hash,company:d.payload.company}))}};
const catalog=(experiments=[experiment,scenario],comparisons=[comparison])=>scopedResearchInputs('identity-a',ds.id,{items:experiments},{items:comparisons},datasets);
const data=(values={})=>{const fd=new FormData();for(const [k,v] of Object.entries(values))fd.set(k,String(v));return fd;};
const visible=html=>html.replace(/<details\b[\s\S]*?<\/details>/g,'');
const frozen={...experiment,hash:experiment.experiment_hash};
const frozenComparison={...comparison,hash:comparison.comparison_hash};
function inputForm(values={}){
 const defaults={text:'核查2026年第二季度经营变化',mode:'operational',depth:'deep',provider:'',acceptance:'核对冻结输入与可比范围',max_calls:'0',experiment_id:'',comparison_artifact_id:'',forecast_metric:'revenue',horizon:'2'};
 const fields=new Map(Object.entries({...defaults,...values}));
 const nodes=Object.fromEntries([...fields].map(([name,value])=>[name,{name,value,disabled:false,dataset:{}}]));
 nodes.forecast={name:'forecast',value:'on',checked:!!values.forecast,disabled:false,dataset:{}};
 const details=Object.fromEntries(['copilot-experiment-details','copilot-comparison-details','copilot-input-conflicts'].map(id=>[id,{innerHTML:''}]));
 const form={isConnected:true,dataset:{},fields,nodes,details,querySelector(selector){return details[selector.slice(1)]??nodes[selector.match(/name="(.*?)"/)?.[1]]??null;}};
 for(const n of Object.values(nodes))n.form=form;
 return form;
}

test('catalog is explicit identity/dataset scoped, includes peer names only within allowed datasets, and never auto-selects',()=>{
 const outsideExperiment={...experiment,id:'other',payload:{...experiment.payload,dataset_id:peer.id,request:{...experiment.payload.request,name:'其他企业实验'}}};
 const otherIdentity={...comparison,id:'private',payload:{...comparison.payload,identity_id:'identity-b',name:'其他身份私有比较'}};
 const noPrimary={...comparison,id:'no-primary',payload:{...comparison.payload,members:[comparison.payload.members[1]]}};
 const scoped=scopedResearchInputs('identity-a',ds.id,{items:[experiment,outsideExperiment]},{items:[comparison,otherIdentity,noPrimary]},datasets);
 assert.deepEqual(scoped.experiments.map(x=>x.id),[experiment.id]);assert.deepEqual(scoped.comparisons.map(x=>x.id),[comparison.id]);
 assert.equal(scopedResearchInputs('identity-a',ds.id,{items:[experiment]},{items:[comparison]},[ds]).comparisons.length,0);
 const html=researchInputFields(scoped);assert.equal((html.match(/value="" selected/g)||[]).length,2);assert(!html.includes('value="saved-forecast" selected'));assert(!html.includes('其他企业实验'));assert(!html.includes('其他身份私有比较'));
 assert.equal(scopedResearchInputs('',ds.id,{items:[]},{items:[comparison]},datasets).comparisons.length,0);
});

test('saved forecast reference uses the server hash and omits all frozen execution fields even from conflicting FormData',()=>{
 const selected=researchInputRequest(data({experiment_id:experiment.id,comparison_artifact_id:comparison.id,forecast:'on',forecast_metric:'gross_margin',horizon:1}),catalog(),'identity-a',ds.id,datasets);
 assert.deepEqual(selected.references,{experiment:{id:experiment.id,version:2,hash:experiment.experiment_hash},comparison_artifact:{id:comparison.id,version:4,hash:comparison.comparison_hash}});
 assert.deepEqual(selected.forecast,{});
 const none=researchInputRequest(data({forecast:'on',forecast_metric:'revenue',horizon:2}),catalog(),'identity-a',ds.id,datasets);
 assert.deepEqual(none.references,{});assert.deepEqual(none.forecast,{forecast:true,forecast_metric:'revenue',horizon:2});
 const withScenario=researchInputRequest(data({experiment_id:scenario.id,forecast:'on',forecast_metric:'revenue',horizon:3}),catalog(),'identity-a',ds.id,datasets);
 assert.equal(withScenario.forecast.horizon,3);assert.equal(withScenario.references.experiment.id,scenario.id);
});

for(const [name,values,input,identity,datasetId,live] of [
 ['different current identity',{experiment_id:experiment.id},catalog(),'identity-b',ds.id,datasets],
 ['different current enterprise',{experiment_id:experiment.id},catalog(),'identity-a',peer.id,datasets],
 ['revoked peer scope',{comparison_artifact_id:comparison.id},catalog(),'identity-a',ds.id,[ds]],
 ['unknown experiment',{experiment_id:'not-listed'},catalog(),'identity-a',ds.id,datasets],
 ['unknown comparison',{comparison_artifact_id:'not-listed'},catalog(),'identity-a',ds.id,datasets],
 ['revised primary',{experiment_id:experiment.id},catalog(),'identity-a',ds.id,[{...ds,version:4},peer]],
 ['revised peer',{comparison_artifact_id:comparison.id},catalog(),'identity-a',ds.id,[ds,{...peer,content_hash:'f'.repeat(64)}]],
 ['missing experiment hash',{experiment_id:experiment.id},catalog([{...experiment,experiment_hash:undefined}]),'identity-a',ds.id,datasets],
 ['missing comparison hash',{comparison_artifact_id:comparison.id},catalog([experiment],[{...comparison,comparison_hash:undefined}]),'identity-a',ds.id,datasets],
 ['different saved periods',{experiment_id:experiment.id,comparison_artifact_id:comparison.id},catalog([{...experiment,payload:{...experiment.payload,target_period:'2026-Q1'}}]),'identity-a',ds.id,datasets],
 ['different saved dates',{experiment_id:experiment.id,comparison_artifact_id:comparison.id},catalog([{...experiment,payload:{...experiment.payload,analysis_as_of:'2026-09-29'}}]),'identity-a',ds.id,datasets],
])test(`selection rejects ${name} before creating a proposal`,()=>{assert.throws(()=>researchInputRequest(data(values),input,identity,datasetId,live));});

test('forecast selection locks saved values, reveals frozen scope, and deselecting restores untouched local edits',()=>{
 const form=inputForm({experiment_id:experiment.id,comparison_artifact_id:comparison.id,forecast_metric:'gross_margin',horizon:'3'});
 syncResearchInputControls(form,catalog(),datasets);
 assert(form.nodes.forecast.disabled);assert(form.nodes.forecast.checked);assert.equal(form.nodes.forecast_metric.value,'cash_flow');assert.equal(form.nodes.horizon.value,'4');
 for(const text of ['冻结现金预测','2026-Q2','原始实验 v2','按已保存现金流假设复用','4 个季度'])assert(visible(form.details['copilot-experiment-details'].innerHTML).includes(text),text);
 for(const text of ['主企业','对照企业','2026-Q2','可比性说明','全部 2 份'])assert(visible(form.details['copilot-comparison-details'].innerHTML).includes(text),text);
 form.nodes.experiment_id.value=scenario.id;syncResearchInputControls(form,catalog(),datasets);
 assert(!form.nodes.forecast.disabled);assert(!form.nodes.forecast.checked);assert.equal(form.nodes.forecast_metric.value,'gross_margin');assert.equal(form.nodes.horizon.value,'3');
 form.nodes.experiment_id.value=experiment.id;syncResearchInputControls(form,catalog(),datasets);form.nodes.experiment_id.value='';syncResearchInputControls(form,catalog(),datasets);
 assert.equal(form.nodes.forecast_metric.value,'gross_margin');assert.equal(form.nodes.horizon.value,'3');assert.equal(form.details['copilot-experiment-details'].innerHTML,'');
});

test('approval discloses actual target and baseline plus all frozen names, assumptions and versions without expanding JSON',()=>{
 const html=visible(researchApprovalInputs({snapshot:{research_scope:{period:'2026-Q2',notice:'明确限定共同季度'},comparison:'previous',experiment:frozen,comparison_artifact:frozenComparison}}));
 for(const text of ['目标季度','2026-Q2','比较基期','上一季度','冻结现金预测','原始实验 v2','按已保存现金流假设复用','冻结双企业对照','冻结对照记录 v4','主企业','对照企业','全部 2 份','不会隐去其他成员'])assert(html.includes(text),text);
 assert(!html.includes('undefined'));assert(!researchApprovalInputs({}).includes('undefined'));
 const unsafe={...frozen,payload:{...frozen.payload,request:{...frozen.payload.request,name:'<script>unsafe</script>',assumptions:'<img src=x>'}}};
 const safe=researchApprovalInputs({snapshot:{experiment:unsafe}});assert(!safe.includes('<script>'));assert(!safe.includes('<img src=x>'));
});

test('same-thread outputs render only archived numerical results, explicit blocked states and source routes',()=>{
 const result={experiment:{id:scenario.id,version:2,name:'保存情景',assumptions:'已冻结假设',target_period:'2026-Q2'},comparison_artifact:frozenComparison,adaptive:{mathematical_outputs:{sensitivity:{status:'completed',approved_assumptions:{price_change:.1,note:'已批准情景'},baseline:{revenue:100000,cost:70000,gross_profit:30000,gross_margin:.3},result:{revenue:120000,cost:80000,gross_profit:40000,gross_margin:1/3},delta_gross_profit:10000},comparison:{status:'completed',period:'2026-Q2',items:[{company:'主企业',analysis:{metrics:{gross_margin:.3,cash_ratio:.25}}},{company:'对照企业',analysis:{metrics:{gross_margin:.4,cash_ratio:.35}}}]},forecast:{status:'blocked',reason:'未达到样本门槛'}}}};
 const html=researchRunOutputs(result,'wan'),shown=visible(html);
 for(const text of ['33.33%','30%','40%','25%','35%','未达到样本门槛','主企业','对照企业','未补造缺失结果'])assert(shown.includes(text),text);
 assert(html.includes('data-route="lab:saved-scenario"'));assert(html.includes('data-route="compare:saved-comparison"'));assert(!html.includes('未来基线'));
 assert.equal(researchRunOutputs({findings:[]}), '');assert.equal(researchRunOutputs(null),'');
});

const listeners=new Map();
globalThis.document={addEventListener(type,fn){listeners.set(type,fn)},querySelector(){return null},querySelectorAll(){return []}};
const oldInterval=globalThis.setInterval;globalThis.setInterval=()=>0;
const chat=await import('../web/dist/copilot-ui.js');globalThis.setInterval=oldInterval;
const {state}=await import('../web/dist/state.js');
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const thread=(version=1)=>({thread:{id:'thread-a',version,payload:{identity_id:'identity-a',dataset_id:ds.id}},messages:[],proposals:[],runs:[],context:{writable:true}});
const plan=()=>({payload:{snapshot:{research_scope:{period:'2026-Q2'},comparison:'previous',experiment:frozen,comparison_artifact:frozenComparison},context:{},nodes:[],blockers:[],max_calls:0,packing:{characters:0,dropped:[]}}});
const proposal=()=>({id:'proposal-a',version:1,payload:{status:'draft',kind:'research',text:'核查2026年第二季度',title:'保存研判',binding:{dataset_version:3},plan_id:'plan-a',fingerprint:'f'.repeat(64)}});
async function harness(){
 const oldFetch=globalThis.fetch,NativeFormData=globalThis.FormData,oldQuery=globalThis.document.querySelector;
 chat.resetCopilot();invalidateInteractions();Object.assign(state,{user:{id:'owner',preferences:{role:'enterprise'}},identity:'identity-a',active:ds.id,datasets,identities:[{id:'identity-a',payload:{dataset_ids:datasets.map(d=>d.id),max_calls:0,depth:'deep'}}],dirty:false});chat.copilotShell();
 const shown=[],toasts=[],calls=[];let form;
 chat.configureCopilot({dialog(title,html){invalidateInteractions();if(form)form.isConnected=false;shown.push({title,html});if(html.includes('data-service-form="proposal"')){form=inputForm();form.dataset={thread:'thread-a',serviceForm:'proposal',kind:'research',key:html.match(/data-key="([^"]+)"/)[1],researchInputs:html.match(/data-research-inputs="([^"]+)"/)[1],message:''};}},inspect(){},toast(text){toasts.push(text)},navigate(){},render:async()=>{},refresh:async()=>{},reset(){}});
 const normal=async(url,init)=>{calls.push({url,init});if(url.includes('/threads?'))return response({items:[{id:'thread-a'}]});if(url==='/api/services/threads/thread-a')return response(thread());if(url.includes('/experiments?'))return response({items:[experiment,scenario]});if(url.includes('/comparisons?'))return response({items:[comparison]});if(url.includes('/connections'))return response({items:[]});if(url.includes('/workspace/plans/'))return response(plan());if(url.endsWith('/proposals'))return response(proposal());throw new Error('Unexpected test URL '+url);};
 globalThis.fetch=normal;await chat.mountCopilot();
 globalThis.FormData=class extends NativeFormData{constructor(source){super();if(source)for(const [name,node] of Object.entries(source.nodes))if(!node.disabled&&(name!=='forecast'||node.checked))this.set(name,node.value);}};
 return {shown,toasts,calls,normal,get form(){return form},async open(){await chat.chatAction('chat-propose',{dataset:{kind:'research'}});return form;},restore(){globalThis.fetch=oldFetch;globalThis.FormData=NativeFormData;document.querySelector=oldQuery;chat.resetCopilot();invalidateInteractions();}};
}

test('assistant proposal flow reads explicit scope, submits exact refs and shows visible approval before execution',async()=>{
 const h=await harness();try{
  const form=await h.open();assert(h.calls.some(c=>c.url==='/api/workspace/experiments?identity_id=identity-a&dataset_id=dataset-a'));assert(h.calls.some(c=>c.url==='/api/workspace/comparisons?identity_id=identity-a&dataset_id=dataset-a'));
  form.nodes.experiment_id.value=experiment.id;form.nodes.comparison_artifact_id.value=comparison.id;
  listeners.get('change')({target:{id:'copilot-experiment',form}});assert(form.nodes.horizon.disabled);
  await chat.copilotSubmit(form,new FormData(form));
  const post=h.calls.find(c=>c.url.endsWith('/proposals')),body=JSON.parse(post.init.body);assert.deepEqual(body.experiment,{id:experiment.id,version:2,hash:experiment.experiment_hash});assert.deepEqual(body.comparison_artifact,{id:comparison.id,version:4,hash:comparison.comparison_hash});
  for(const key of ['forecast','forecast_metric','horizon'])assert(!Object.hasOwn(body.execution,key));assert.equal(body.execution.depth,'deep');assert.equal(body.use_llm,false);assert(!h.calls.some(c=>c.url.endsWith('/confirm')));
  assert.equal(h.shown.length,2);assert(visible(h.shown[1].html).includes('对照企业'));assert(visible(h.shown[1].html).includes('上一季度'));
 }finally{h.restore();}
});

for(const cause of ['dismiss','navigation','identity','dataset','new thread','newer proposal'])test(`late saved-input lists cannot reopen or replace a form after ${cause}`,async()=>{
 const h=await harness();let resolveExperiments;try{
  let delayed=true;globalThis.fetch=(url,init)=>url.includes('/experiments?')&&delayed?new Promise(resolve=>resolveExperiments=resolve):h.normal(url,init);
  const pending=h.open();await turn();
  if(cause==='identity')state.identity='identity-b';else if(cause==='dataset')state.active=peer.id;else if(cause==='new thread')await chat.chatAction('chat-new',{dataset:{}});else if(cause==='newer proposal'){delayed=false;await h.open();}else invalidateInteractions();
  resolveExperiments(response({items:[{...experiment,payload:{...experiment.payload,request:{...experiment.payload.request,name:'迟到的旧列表'}}}]}));await pending;
  assert.equal(h.shown.length,cause==='newer proposal'?1:0);if(h.shown.length)assert(!h.shown[0].html.includes('迟到的旧列表'));
 }finally{h.restore();}
});

test('catalog read failure does not open a partially populated or auto-selected proposal',async()=>{
 const h=await harness();try{globalThis.fetch=(url,init)=>url.includes('/comparisons?')?Promise.reject(new Error('offline')):h.normal(url,init);await assert.rejects(h.open());assert.equal(h.shown.length,0);assert(!h.calls.some(c=>c.init.method==='POST'));}finally{h.restore();}
});

for(const cause of ['dismiss','identity','dataset','revoked peer'])test(`previously displayed research form cannot post after ${cause}`,async()=>{
 const h=await harness();try{const form=await h.open();form.nodes.comparison_artifact_id.value=comparison.id;const count=h.calls.length;
  if(cause==='dismiss')invalidateInteractions();else if(cause==='identity')state.identity='identity-b';else if(cause==='dataset')state.active=peer.id;else state.identities[0].payload.dataset_ids=[ds.id];
  await assert.rejects(chat.copilotSubmit(form,new FormData(form)));assert.equal(h.calls.length,count);
 }finally{h.restore();}
});

test('dirty research selection is retained after earlier save and gets a new idempotency key on explicit retry',async()=>{
 const h=await harness();let resolve;try{
  const form=await h.open();form.nodes.experiment_id.value=experiment.id;listeners.get('change')({target:{id:'copilot-experiment',form}});const oldKey=form.dataset.key;
  globalThis.fetch=(url,init)=>url.endsWith('/proposals')?new Promise(r=>resolve=r):h.normal(url,init);
  const saving=chat.copilotSubmit(form,new FormData(form));form.nodes.experiment_id.value=scenario.id;listeners.get('change')({target:{id:'copilot-experiment',form}});form.nodes.text.value='刚修改的研究问题与新假设';
  resolve(response(proposal()));await saving;
  assert.equal(h.shown.length,1);assert.equal(form.nodes.experiment_id.value,scenario.id);assert.equal(form.nodes.text.value,'刚修改的研究问题与新假设');assert(state.dirty);assert.notEqual(form.dataset.key,oldKey);assert(h.toasts.some(t=>t.includes('保留你的新草稿')));
  globalThis.fetch=h.normal;await chat.copilotSubmit(form,new FormData(form));const posted=h.calls.find(c=>c.url.endsWith('/proposals'));const body=JSON.parse(posted.init.body);assert.equal(body.request_id,form.dataset.key);assert.equal(body.experiment.id,scenario.id);assert.equal(body.text,'刚修改的研究问题与新假设');assert.equal(h.shown.length,2);
 }finally{h.restore();}
});

for(const cause of ['new selection','dismiss'])test(`late approval-plan read cannot replace ${cause}`,async()=>{
 const h=await harness();let resolve;try{const form=await h.open();form.nodes.experiment_id.value=experiment.id;globalThis.fetch=(url,init)=>url.includes('/workspace/plans/')?new Promise(r=>resolve=r):h.normal(url,init);
  const saving=chat.copilotSubmit(form,new FormData(form));await turn();if(cause==='dismiss')invalidateInteractions();else form.nodes.experiment_id.value=scenario.id;
  resolve(response(plan()));await saving;assert.equal(h.shown.length,1);if(cause==='new selection'){assert.equal(form.nodes.experiment_id.value,scenario.id);assert(state.dirty);}
 }finally{h.restore();}
});

test('same-thread persisted cards expose changed peer scope without recalculating or hiding saved results',async()=>{
 const h=await harness();try{
  const host={innerHTML:'',scrollTop:0,scrollHeight:0,clientHeight:0,querySelectorAll(){return []}};document.querySelector=selector=>selector==='#assistant-answer'?host:null;
  globalThis.fetch=async()=>response({...thread(2),proposals:[{...proposal(),payload:{...proposal().payload,status:'executed'}}],runs:[{id:'run-a',proposal_id:'proposal-a',state:'succeeded',report_integrity:{valid:true},report_availability:{status:'available'},dataset_version:3,current_dataset_version:3,source_impact:{state:'changed',reasons:[{code:'comparison_member_changed',message:'对照企业的财务输入已修订'}]},result:{findings:['原始冻结发现'],llm:{state:'not_requested',review:{claims:[]}},adaptive:{mathematical_outputs:{forecast:{status:'blocked',reason:'原始样本不足'}}},comparison_artifact:frozenComparison}}]});
  await chat.reloadThread();assert(host.innerHTML.includes('对照企业的财务输入已修订'));assert(host.innerHTML.includes('原始冻结发现'));assert(host.innerHTML.includes('原始样本不足'));assert(host.innerHTML.includes('data-route="agents:run-run-a"'));assert(!host.innerHTML.includes('未来基线'));
 }finally{h.restore();}
});

for(const question of ['那同比呢','继续展开'])test(`source-backed short follow-up ${question} can reach server scope resolution without HTML length rejection`,async()=>{
 const h=await harness();try{chat.currentThread().messages.push({id:'short-source',payload:{question}});await chat.chatAction('chat-propose',{dataset:{kind:'research',message:'short-source'}});const html=h.shown[0].html;
  assert.match(html,new RegExp('name="text"[^>]*minlength="1"[^>]*>'+question));assert.match(html,/name="acceptance"[^>]*maxlength="1000"/);
  assert(html.includes('data-message="short-source"'));assert(!html.includes('name="include_thread_history" checked'));
 }finally{h.restore();}
});
test('a new research question keeps the normal minimum and a mismatched loaded thread cannot fetch saved inputs',async()=>{
 const h=await harness();try{await h.open();assert.match(h.shown[0].html,/name="text"[^>]*minlength="5"/);chat.currentThread().thread.payload.identity_id='identity-b';const count=h.calls.length;await assert.rejects(h.open(),/历史会话与当前身份或企业不一致/);assert.equal(h.calls.length,count);}finally{h.restore();}
});


test('legacy scenario without recorded target discloses missing provenance rather than guessing a period conflict',()=>{
 const legacy={...scenario,payload:{...scenario.payload,target_period:undefined}};const inputs=catalog([legacy]);
 const fields=researchInputFields(inputs);assert(fields.includes('原始目标季度未记录'));assert(!fields.includes('undefined'));
 const approval=visible(researchApprovalInputs({snapshot:{experiment:{...legacy,hash:legacy.experiment_hash}}}));assert(approval.includes('原始目标季度未记录'));assert(!approval.includes('undefined'));
 const form=inputForm({experiment_id:legacy.id,comparison_artifact_id:comparison.id});syncResearchInputControls(form,inputs,datasets);
 assert(form.details['copilot-input-conflicts'].innerHTML.includes('旧实验摘要未记录目标季度，请重新保存实验后再与对照组合使用'));
 assert(!form.details['copilot-input-conflicts'].innerHTML.includes('共同季度不一致'));
 assert.throws(()=>researchInputRequest(data({experiment_id:legacy.id,comparison_artifact_id:comparison.id}),inputs,'identity-a',ds.id,datasets),/旧实验摘要未记录目标季度/);
});

test('remount rechecks same-version peer source impact instead of treating a completed thread cache as current',async()=>{
 const h=await harness();let resolve;try{
  const archived={findings:['冻结研究结果'],llm:{state:'not_requested',review:{claims:[]}},comparison_artifact:frozenComparison};
  const initial={...thread(),proposals:[{...proposal(),payload:{...proposal().payload,status:'executed'}}],runs:[{id:'run-a',proposal_id:'proposal-a',state:'succeeded',report_integrity:{valid:true},report_availability:{status:'available'},dataset_version:3,current_dataset_version:3,source_impact:{state:'current',reasons:[]},result:archived}]};
  globalThis.fetch=async()=>response(initial);await chat.reloadThread();
  const host={innerHTML:'',scrollTop:0,scrollHeight:0,clientHeight:0,querySelectorAll(){return []}},composer={value:''},label={textContent:''};
  document.querySelector=selector=>({'#assistant-answer':host,'#assistant-query':composer,'#copilot-composer-status':label}[selector]??null);
  let reads=0;globalThis.fetch=(url,init)=>{assert.equal(url,'/api/services/threads/thread-a');assert.equal(init.method,'GET');reads++;return new Promise(r=>resolve=r);};
  const pending=chat.mountCopilot();assert.equal(reads,1,'a completed cached thread must be revalidated');assert(label.textContent.includes('复核'));
  const sameRead=chat.mountCopilot();assert.equal(reads,1,'concurrent mounts share the in-flight read');chat.rememberDraft('复核期间刚输入的未发送问题');
  resolve(response({...initial,runs:[{...initial.runs[0],source_impact:{state:'changed',reasons:[{code:'comparison_member_changed',message:'对照企业的财务输入已修订'}]}}]}));await Promise.all([pending,sameRead]);
  assert(host.innerHTML.includes('对照企业的财务输入已修订'));assert.equal(composer.value,'复核期间刚输入的未发送问题');assert.deepEqual(chat.currentThread().runs[0].result,archived);assert(!label.textContent.includes('复核'));
 }finally{h.restore();}
});

test('late remount cannot roll back a newer source read or overwrite a changed identity',async()=>{
 const h=await harness();try{
  const pending=[];globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));const mounting=chat.mountCopilot();assert.equal(pending.length,1);
  const newer=chat.reloadThread();pending[1](response({...thread(3),source_marker:'newer-source'}));await newer;pending[0](response({...thread(1),source_marker:'older-source'}));await mounting;assert.equal(chat.currentThread().source_marker,'newer-source');
  const last=chat.mountCopilot();assert.equal(pending.length,3);state.identity='identity-b';chat.copilotShell();pending[2](response({...thread(4),source_marker:'old-identity'}));await last;assert.equal(chat.currentThread(),null);
 }finally{h.restore();}
});

test('sending during remount waits for renewed writability and never posts into newly archived scope',async()=>{
 const h=await harness();let resolve;try{
  let posts=0;globalThis.fetch=(url,init)=>{if(init.method==='POST')posts++;return new Promise(r=>resolve=r);};
  const mounting=chat.mountCopilot(),sending=chat.sendCopilot('复核当前输入');
  assert.equal(posts,0);resolve(response({...thread(),context:{writable:false,unavailable_reason:'当前身份范围已撤销'}}));await mounting;await assert.rejects(sending,/范围已撤销/);assert.equal(posts,0);
 }finally{h.restore();}
});


test('deleting the current thread during remount clears its busy state and rejects the late read',async()=>{
 const h=await harness(),oldConfirm=globalThis.confirm;let resolve;try{
  globalThis.confirm=()=>true;
  const host={innerHTML:'',scrollTop:0,scrollHeight:0,clientHeight:0,querySelectorAll(){return []}},button={disabled:false,setAttribute(){}},label={textContent:''};
  document.querySelector=selector=>({'#assistant-answer':host,'#assistant-form button[type="submit"]':button,'#copilot-composer-status':label}[selector]??null);
  globalThis.fetch=(url,init)=>init.method==='DELETE'?Promise.resolve(response({deleted:true})):new Promise(r=>resolve=r);
  const mounting=chat.mountCopilot();assert(button.disabled);assert(label.textContent.includes('复核'));
  await chat.chatAction('chat-delete',{dataset:{id:'thread-a',version:'1'}});
  assert.equal(chat.currentThread(),null);assert(!button.disabled);assert(!label.textContent.includes('复核'));
  resolve(response({...thread(9),source_marker:'deleted-thread-late-read'}));await mounting;
  assert.equal(chat.currentThread(),null);assert(!button.disabled);assert(!host.innerHTML.includes('deleted-thread-late-read'));
  let created=0,sent=0;globalThis.fetch=async(url,init)=>{if(url.includes('/threads?'))return response({items:[]});if(url==='/api/services/threads'){created++;return response({id:'thread-new',version:1,payload:{identity_id:'identity-a',dataset_id:ds.id}});}if(url.endsWith('/messages')){sent++;return response({accepted:true});}return response({...thread(2),thread:{...thread(2).thread,id:'thread-new'}});};
  await chat.sendCopilot('删除后继续新的研究问题');assert.equal(created,1);assert.equal(sent,1);assert.equal(chat.currentThread().thread.id,'thread-new');assert(!button.disabled);
 }finally{globalThis.confirm=oldConfirm;h.restore();}
});

const {removeSavedComparison,comparisonRemovalTarget}=await import('../web/dist/saved-comparisons.js');
test('confirmed comparison cleanup clears only the active proposal reference and keeps text, forecast, and archived results',async()=>{
 const h=await harness();try{const form=await h.open();form.nodes.comparison_artifact_id.value=comparison.id;form.nodes.experiment_id.value=experiment.id;listeners.get('change')({target:{id:'copilot-comparison',form}});const text=form.nodes.text.value,forecast=form.nodes.horizon.value;const select=form.nodes.comparison_artifact_id;select.options=[{value:''},{value:comparison.id}].map(o=>({...o,remove(){select.options=select.options.filter(x=>x!==this);}}));document.querySelector=s=>s==='form[data-research-inputs]'?form:null;
 const historical={comparison_artifact:structuredClone(frozenComparison)};chat.currentThread().runs.push({id:'historical',result:historical});const frozen=JSON.stringify(historical);state.cache={comparison};globalThis.fetch=async()=>response({deleted:true});const t=comparisonRemovalTarget(comparison.id,comparison.version,state.identity);await removeSavedComparison(t,()=>chat.forgetCopilotComparison(t));assert.equal(select.value,'');assert.equal(form.nodes.text.value,text);assert.equal(form.nodes.horizon.value,forecast);assert(form.nodes.horizon.disabled);assert(form.details['copilot-comparison-details'].innerHTML.includes('已取消该引用'));assert.equal(JSON.stringify(chat.currentThread().runs[0].result),frozen);
 const stale=new FormData(form);stale.set('comparison_artifact_id',comparison.id);await assert.rejects(chat.copilotSubmit(form,stale),/所选企业对照不在/);
 }finally{h.restore();}
});
test('deleted comparison does not reappear in a late assistant catalog batch',async()=>{
 const h=await harness();let resolve;try{state.cache={comparison};let experimentReads=0,comparisonReads=0;globalThis.fetch=(url,init)=>{if(init.method==='DELETE')return Promise.resolve(response({deleted:true}));if(url.includes('/experiments?')&&++experimentReads===1)return new Promise(r=>resolve=r);if(url.includes('/comparisons?'))return Promise.resolve(response({items:++comparisonReads===1?[comparison]:[]}));return h.normal(url,init);};const opening=h.open();await turn();await removeSavedComparison(comparisonRemovalTarget(comparison.id,comparison.version,state.identity));resolve(response({items:[experiment]}));await opening;assert.equal(comparisonReads,2);assert.equal(h.shown.length,1);assert(!h.shown[0].html.includes('value="'+comparison.id+'"'));
 }finally{h.restore();}
});
