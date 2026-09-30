/** Client unit tests; DOM/process flows are independently exercised by browser scripts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const listeners=new Map();
globalThis.innerWidth=1440;
globalThis.window={innerWidth:1440,addEventListener(){}};
globalThis.document={addEventListener(type,fn){listeners.set(type,fn)},querySelector(){return null},querySelectorAll(){return []}};
globalThis.sessionStorage={getItem(){return null},setItem(){}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const layout=await import('../web/dist/layout.js');
const views=await import('../web/dist/views-services.js');
const chat=await import('../web/dist/copilot-ui.js');
globalThis.setInterval=interval;
const {state}=await import('../web/dist/state.js');
const {api,ApiError,invalidateContext}=await import('../web/dist/api.js');

test('layout width clamps malformed and extreme persisted values without squeezing work to zero',()=>{
 for(const v of [NaN,Infinity,-100,0,9000]){const s=layout.normalizeLayout({width:v},1200);assert(s.width>=320&&s.width<=560);}
 assert.equal(layout.normalizeLayout({collapsed:true,assistant:true,width:440},1440).width,440);
 assert.equal(layout.normalizeLayout({collapsed:true,assistant:false},1440).collapsed,true);
 assert.equal(layout.normalizeLayout({collapsed:1,assistant:'true'},1440).assistant,false);
});
test('private connection editor never echoes a server-side secret or ciphertext',()=>{
 const html=views.connectionForm({id:'u_test',version:2,name:'<script>name',host:'public.example',path:'/v1/chat/completions',model:'x',cipher:'DO_NOT_RENDER',api_key:'DO_NOT_RENDER'});
 assert(!html.includes('DO_NOT_RENDER'));assert(!html.includes('<script>'));assert(html.includes('autocomplete="current-password"'));
});
test('identity and watch forms escape hostile attributes and preserve their expected contracts',()=>{
 state.datasets=[];state.identities=[];state.identity='';state.active='';
 const html=views.identityForm({id:'x',version:1,payload:{name:'\"><img src=x>',objective:'</textarea><script>x',perspective:'operator',depth:'balanced',output_style:'structured',dataset_ids:[],allow_external:false,max_calls:3,include_shared_memory:false}});
 assert(!html.includes('<img src=x>'));assert(!html.includes('</textarea><script>'));assert(html.includes('name="allow_external"'));
 const watch=views.watchForm();assert(watch.includes('data-service-form="watch"'));assert(watch.includes('name="threshold"'));
});
test('assistant turns render actual receipts, not execute untrusted prompts or evidence',()=>{
 const html=chat.messageView({id:'message',created_at:'2026-01-01',payload:{question:'<script>alert(1)</script>',response:{answer:'<img src=x>',facts:[],cards:[],citations:[],warnings:['<svg onload=x>'],receipts:[{tool:'</details><script>x',milliseconds:1,state:'completed',output_hash:'hash'}],context:{note:'<script>bad'},external_calls:0,actions:[]}}});
 assert(!html.includes('<script>'));assert(!html.includes('<img src=x>'));assert(!html.includes('<svg onload=x>'));assert(html.includes('hash'));
});
test('changing work identity invalidates a pending response instead of updating the new context',async()=>{
 const original=globalThis.fetch;let respond;
 try{globalThis.fetch=()=>new Promise(resolve=>respond=resolve);const result=api('/services/threads');invalidateContext();respond(new Response('{"items":[{"id":"old"}]}',{headers:{'Content-Type':'application/json'}}));await assert.rejects(result,e=>e instanceof ApiError&&e.code==='STALE_SESSION');}finally{globalThis.fetch=original;}
});
test('every explicit new service form is routed to its real handler',()=>{
 const source=['views-services','copilot-ui','experience'].map(name=>readFileSync(new URL('../web/'+name+'.ts',import.meta.url),'utf8')).join('\n');
 const handlers=readFileSync(new URL('../web/experience.ts',import.meta.url),'utf8')+readFileSync(new URL('../web/copilot-ui.ts',import.meta.url),'utf8');
 for(const name of ['identity','connection','watch','alert-ack','proposal','confirm-proposal'])assert(handlers.includes("'"+name+"'"),'missing form '+name);
 assert(!source.includes('setTimeout(()=>{void sendCopilot'));assert(source.includes('if(e!==epoch||target!==contextKey)return'));
});
test('no chat persistence contains raw business drafts in browser storage',()=>{
 const source=readFileSync(new URL('../web/copilot-ui.ts',import.meta.url),'utf8');
 assert(!source.includes('localStorage'));assert(!source.includes('sessionStorage'));assert(source.includes('remembered.clear();drafts.clear()'));
});
test('layout collapse does not replace the main form and has a reduced motion alternative',()=>{
 const source=readFileSync(new URL('../web/layout.ts',import.meta.url),'utf8');
 assert(!source.includes('innerHTML'));assert(!source.includes('replaceChildren'));assert(source.includes('aria-expanded'));
 const css=readFileSync(new URL('../web/workbench.css',import.meta.url),'utf8');assert(css.includes('prefers-reduced-motion'));assert(css.includes('minmax(0,1fr)'));
});
test('current rail CSS overrides legacy desktop visibility and explicitly hides closed mobile drawers',()=>{
 const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 const legacy=readFileSync(new URL('../web/styles.css',import.meta.url),'utf8');
 const css=readFileSync(new URL('../web/workbench.css',import.meta.url),'utf8');
 // Both sheets really ship. Equal-specificity base rules in the later workbench
 // sheet must override the legacy <=1240px visibility:hidden drawer rule.
 assert(html.indexOf('/assets/styles.css')<html.indexOf('/assets/workbench.css'));
 assert.match(legacy,/@media\(max-width:1240px\)[\s\S]*?\.assistant-rail\{[^}]*visibility:hidden/);
 const desktop=css.match(/\.assistant-rail\{([^}]+)\}/)?.[1];assert(desktop);
 assert.match(desktop,/(?:^|;)visibility:visible(?:;|$)/);
 const mobile=css.slice(css.indexOf('@media(max-width:900px)'));
 assert.match(mobile,/\.assistant-rail,\.workspace-shell\[data-assistant=hidden\]>\.assistant-rail\{[^}]*visibility:hidden/);
 assert.match(mobile,/\.assistant-rail\.open\{[^}]*visibility:visible/);
 assert.match(css,/\.sidebar\{[^}]*visibility:visible/);
 assert.match(mobile,/\.sidebar,\.workspace-shell\[data-nav=compact\] \.sidebar\{[^}]*visibility:hidden/);
 assert.match(mobile,/\.sidebar\.open\{[^}]*visibility:visible/);
});

const {invalidateInteractions}=await import('../web/dist/interactions.js');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function thread(version=1,id='thread-a'){return {thread:{id,version,payload:{}},messages:[],proposals:[],runs:[],context:{writable:true}};}
function initChat(){chat.resetCopilot();Object.assign(state,{user:{id:'owner',preferences:{role:'enterprise'}},identity:'',active:'',datasets:[],identities:[]});chat.copilotShell();}
function chatHooks(){const shown=[];chat.configureCopilot({dialog:(...args)=>shown.push(args),inspect:(...args)=>shown.push(args),toast(){},navigate(){},render:async()=>{},refresh:async()=>{},reset(){}});return shown;}

test('sending during initial history read waits for that thread rather than creating a second one',async()=>{
 const old=globalThis.fetch;initChat();let resolveList;const calls=[];
 try{globalThis.fetch=async(url,init)=>{calls.push({url,...init});if(url.includes('/threads?'))return new Promise(resolve=>resolveList=resolve);if(init.method==='POST')return json({accepted:true});return json(thread(calls.filter(x=>x.method==='POST').length?2:1));};
 const mounting=chat.mountCopilot(),sending=chat.sendCopilot('核对真实现金流');assert.equal(calls.length,1);resolveList(json({items:[{id:'thread-a'}]}));await Promise.all([mounting,sending]);
 assert.equal(calls.filter(x=>x.url==='/api/services/threads'&&x.method==='POST').length,0);assert.equal(calls.filter(x=>x.url.endsWith('/messages')).length,1);assert.equal(chat.currentThread().thread.version,2);
 }finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('out-of-order thread reads cannot roll back a newer version',async()=>{
 const old=globalThis.fetch;initChat();const reads=[];
 try{globalThis.fetch=async url=>json(url.includes('/threads?')?{items:[{id:'thread-a'}]}:thread());await chat.mountCopilot();globalThis.fetch=()=>new Promise(resolve=>reads.push(resolve));
 const first=chat.reloadThread(),second=chat.reloadThread();reads[1](json(thread(3)));await second;reads[0](json(thread(2)));await first;assert.equal(chat.currentThread().thread.version,3);
 }finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('draft typed during a send survives successful completion, while original sent draft clears',async()=>{
 const old=globalThis.fetch;initChat();let sent;
 try{globalThis.fetch=async url=>json(url.includes('/threads?')?{items:[{id:'thread-a'}]}:thread());await chat.mountCopilot();globalThis.fetch=async(url,init)=>init.method==='POST'?new Promise(resolve=>sent=resolve):json(thread(2));
 const sending=chat.sendCopilot('第一个研究问题');await turn();chat.rememberDraft('还没有发送的新问题');sent(json({accepted:true}));await sending;assert(chat.copilotShell().includes('还没有发送的新问题'));
 const sendingAgain=chat.sendCopilot('还没有发送的新问题');await turn();sent(json({accepted:true}));await sendingAgain;assert(!chat.copilotShell().includes('>还没有发送的新问题</textarea>'));
 }finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('new conversation discards late history and creates only when a question is sent',async()=>{
 const old=globalThis.fetch;initChat();let list;const calls=[];
 try{globalThis.fetch=(url,init)=>{calls.push({url,...init});return new Promise(resolve=>list=resolve);};const pending=chat.mountCopilot();await chat.chatAction('chat-new',{dataset:{}});list(json({items:[{id:'old-thread'}]}));await pending;assert.equal(chat.currentThread(),null);assert.equal(calls.length,1);
 globalThis.fetch=async(url,init)=>{calls.push({url,...init});if(url==='/api/services/threads')return json({id:'new-thread',version:1});return json(init.method==='POST'?{}:thread(2,'new-thread'));};await chat.sendCopilot('新会话的研究问题');assert.equal(chat.currentThread().thread.id,'new-thread');assert.equal(calls.filter(x=>x.url==='/api/services/threads').length,1);
 }finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('uncertain thread creation keeps its idempotency key for explicit retry, never auto retries',async()=>{
 const old=globalThis.fetch;initChat();const keys=[];
 try{await chat.chatAction('chat-new',{dataset:{}});globalThis.fetch=async(url,init)=>{if(url==='/api/services/threads'){keys.push(JSON.parse(init.body).request_id);if(keys.length===1)throw Error('connection lost');return json({id:'thread-a',version:1});}return json(init.method==='POST'?{}:thread(2));};
 await assert.rejects(chat.sendCopilot('同一个研究问题'));assert.equal(keys.length,1);await chat.sendCopilot('同一个研究问题');assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert(keys[0].length>=8);
 }finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('dismissed proposal review and newer navigation suppress late dialog resurrection',async()=>{
 const old=globalThis.fetch;initChat();const shown=chatHooks();let resolve;
 try{globalThis.fetch=()=>new Promise(r=>resolve=r);const pending=chat.reviewProposal({id:'p',version:1,payload:{status:'draft',kind:'research',title:'计划',text:'核查',binding:{dataset_version:1},plan_id:'plan',fingerprint:'x'}});
 invalidateInteractions();resolve(json({payload:{}}));await pending;assert.equal(shown.length,0);
 }finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('a newer proposal action wins even when an earlier response arrives last',async()=>{
 const old=globalThis.fetch;initChat();const shown=chatHooks(),pending=[];
 try{globalThis.fetch=()=>new Promise(r=>pending.push(r));const first=chat.chatAction('chat-detail',{dataset:{id:'first'}}),second=chat.chatAction('chat-detail',{dataset:{id:'second'}});pending[1](json({title:'second'}));await second;pending[0](json({title:'first'}));await first;assert.equal(shown.length,1);assert(shown[0][1].includes('second'));
 }finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('context change during conflict reconciliation never adopts the old private thread',async()=>{
 const old=globalThis.fetch;initChat();let reconcile;
 try{globalThis.fetch=async url=>json(url.includes('/threads?')?{items:[{id:'thread-a'}]}:thread());await chat.mountCopilot();globalThis.fetch=async(url,init)=>init.method==='POST'?new Response(JSON.stringify({error:{code:'VERSION_CONFLICT',message:'changed'}}),{status:409,headers:{'Content-Type':'application/json'}}):new Promise(resolve=>reconcile=resolve);
 const sending=chat.sendCopilot('核查当前数据');await turn();state.identity='other';chat.copilotShell();reconcile(json(thread(99)));await sending;assert.equal(chat.currentThread(),null);
 }finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('proposal form belongs to the thread that produced it and cannot submit into a newer thread',async()=>{
 const old=globalThis.fetch;initChat();let calls=0;try{globalThis.fetch=async()=>{calls++;return json({});};await assert.rejects(chat.copilotSubmit({dataset:{thread:'stale',serviceForm:'proposal'}},new FormData()),/会话已切换/);assert.equal(calls,0);}finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('grounded answer renders source formulas, comparison units, and verifiable next steps as escaped text',()=>{
 const html=chat.messageView({id:'m',created_at:'2026-01-01',payload:{question:'核查',response:{answer:'第一行\n第二行',receipts:[],facts:[{id:'gross_margin',label:'毛利率',value:.2,display_value:'20.00%',period:'2025-Q4',dataset_version:2,formula:'(收入-成本)/收入 <script>',inputs:[{path:'revenue',value:100,unit:'元'}],comparison:{kind:'previous',period:'2025-Q3',change:.02,change_unit:'ratio_points'},source_url:'https://example.com/report'}],research_brief:{matched_document_count:0,causal_claims_supported:false,missing_metric_ids:['cash_flow']},next_steps:[{title:'补充来源',reason:'缺少证据',route:'evidence',acceptance:'原文可追溯 <img>'}],external_calls:0}}});
 assert(html.includes('20.00%'));assert(html.includes('+2 个百分点'));assert(html.includes('怎样算核查完成'));assert(html.includes('noopener noreferrer'));assert(!html.includes('<script>'));assert(!html.includes('<img>'));
});

function layoutHarness(){
 const previous={document:globalThis.document,location:globalThis.location,innerWidth:globalThis.innerWidth};
 const classes=()=>{const values=new Set();return {add:(...a)=>a.forEach(x=>values.add(x)),remove:(...a)=>a.forEach(x=>values.delete(x)),contains:x=>values.has(x),toggle:(x,on)=>{on=on??!values.has(x);on?values.add(x):values.delete(x);return on;}};};
 const node=id=>({id,dataset:{},attributes:{},classList:classes(),style:{setProperty(){}},isConnected:true,inert:false,hidden:false,setAttribute(k,v){this.attributes[k]=v;},focus(){globalThis.document.activeElement=this;}});
 const nodes=Object.fromEntries(['shell','sidebar','rail','main','back','menu','assistant','resize','firstNav','firstChat'].map(id=>[id,node(id)]));
 const selectors={'.workspace-shell':nodes.shell,'#sidebar':nodes.sidebar,'#assistant-rail':nodes.rail,'.main-shell':nodes.main,'#drawer-backdrop':nodes.back,'#assistant-resize':nodes.resize};
 const opened=()=>[nodes.sidebar,nodes.rail].filter(n=>n.classList.contains('open'));
 globalThis.location={hash:'#brief'};globalThis.innerWidth=390;
 globalThis.document={body:{classList:classes()},activeElement:nodes.menu,querySelector(selector){if(selector==='.sidebar.open,.assistant-rail.open')return opened()[0]??null;if(selector.startsWith('#sidebar button'))return nodes.firstNav;if(selector.startsWith('#assistant-rail button'))return nodes.firstChat;return selectors[selector]??null;},querySelectorAll(selector){if(selector==='.sidebar.open,.assistant-rail.open')return opened();if(selector==='[data-action="menu"]')return [nodes.menu];if(selector==='[data-action="show-assistant"]')return [nodes.assistant];return [];}};
 return {nodes,restore(){Object.assign(globalThis,previous);}};
}
test('closed mobile drawers are inert, open drawer isolates work, and close restores focus',()=>{
 const h=layoutHarness();try{layout.clearLayout();layout.applyLayout();assert(h.nodes.sidebar.inert);assert(h.nodes.rail.inert);assert(!h.nodes.main.inert);
 layout.toggleNav(true);assert(!h.nodes.sidebar.inert);assert(h.nodes.main.inert);assert(!h.nodes.back.hidden);assert.equal(h.nodes.menu.attributes['aria-expanded'],'true');assert.equal(document.activeElement,h.nodes.firstNav);
 layout.closeDrawers();assert(h.nodes.sidebar.inert);assert(!h.nodes.main.inert);assert(h.nodes.back.hidden);assert.equal(document.activeElement,h.nodes.menu);assert.equal(h.nodes.menu.attributes['aria-expanded'],'false');
 }finally{h.restore();}
});
test('resizing from mobile to desktop removes drawer modality without replacing work content',()=>{
 const h=layoutHarness();try{layout.clearLayout();layout.toggleAssistant(true);assert(h.nodes.main.inert);assert.equal(h.nodes.assistant.attributes['aria-expanded'],'true');innerWidth=1440;layout.applyLayout();assert(!h.nodes.main.inert);assert(!h.nodes.rail.inert);assert(!h.nodes.sidebar.inert);assert(h.nodes.back.hidden);assert(!document.body.classList.contains('drawer-active'));}finally{h.restore();}
});
test('service and archive destructive controls carry the last displayed version',()=>{
 const app=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8'),experience=readFileSync(new URL('../web/experience.ts',import.meta.url),'utf8');
 for(const route of ['datasets','evidence','memories','conversations','templates'])assert(app.includes("'/"+route+"/'+id+'?version='"));
 for(const route of ['identities','watches','alerts'])assert(experience.includes("'/services/"+route+"/'+id+'?version='"));
 assert(experience.includes("'/remove','POST',{password:str('password'),version}"));
});

const {agentsPage}=await import('../web/dist/views-studio.js');
const {viewApi,invalidateView}=await import('../web/dist/api.js');
test('older page read is discarded without invalidating an independent assistant read',async()=>{
 const old=globalThis.fetch,requests=[];try{globalThis.fetch=()=>new Promise(resolve=>requests.push(resolve));const page=viewApi('/datasets'),assistant=api('/services/threads');invalidateView();requests[0](json({items:[]}));requests[1](json({items:[]}));await assert.rejects(page,e=>e.code==='STALE_VIEW');assert.deepEqual(await assistant,{items:[]});}finally{globalThis.fetch=old;}
});
test('Agent form inherits identity scope, depth, budget and conversation boundaries',async()=>{
 const old=globalThis.fetch;initChat();Object.assign(state,{identity:'analyst-a',active:'allowed',datasets:[{id:'allowed',payload:{company:'许可企业',name:'年度报表'}},{id:'other',payload:{company:'范围之外企业',name:'其他报表'}}],identities:[{id:'analyst-a',payload:{dataset_ids:['allowed'],allow_external:false,max_calls:2,depth:'deep'}}]});
 try{globalThis.fetch=async url=>json(url.endsWith('/catalog')?{providers:[{id:'test',model:'local-test',configured:true}],capabilities:[]}:url.endsWith('/conversations')?{items:[{id:'scope-match',payload:{title:'当前身份会话',company:'许可企业',identity_id:'analyst-a'}},{id:'scope-other',payload:{title:'其他身份私有会话',company:'许可企业',identity_id:'analyst-b'}}]}:{items:[],total:0});const html=await agentsPage();assert(html.includes('许可企业'));assert(!html.includes('范围之外企业'));assert(html.includes('当前身份会话'));assert(!html.includes('其他身份私有会话'));assert.match(html,/id="use-llm" type="checkbox" disabled/);assert.match(html,/<option value="deep" selected>/);const budget=html.match(/<select name="max_calls"[^>]*>(.*?)<\/select>/s)?.[1];assert(budget);assert(!budget.includes('value="3"'));assert.match(budget,/<option value="2" selected>/);
 }finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('archived read-only assistant history never dispatches a new question',async()=>{
 const old=globalThis.fetch;initChat();let writes=0;try{globalThis.fetch=async(url,init)=>{if(init.method==='POST')writes++;return json(url.includes('/threads?')?{items:[{id:'thread-a'}]}:{...thread(),context:{writable:false,unavailable_reason:'身份已移除，仅供查阅'}});};await chat.mountCopilot();await assert.rejects(chat.sendCopilot('不能发送的新问题'),/仅供查阅/);assert.equal(writes,0);}finally{globalThis.fetch=old;chat.resetCopilot();}
});
test('watch end date remains optional and expired evaluations are distinct from safe readings',()=>{
 state.datasets=[];state.identities=[];state.identity='';const html=views.watchForm({id:'w',version:2,payload:{expires_at:'2026-12-31'}});assert(html.includes('name="expires_at"'));assert(html.includes('value="2026-12-31"'));assert(html.includes('含截止日'));const source=readFileSync(new URL('../web/views-services.ts',import.meta.url),'utf8');assert(source.includes("expired:'已到期'"));assert(source.includes("incomplete:'季度未结束'"));
});
