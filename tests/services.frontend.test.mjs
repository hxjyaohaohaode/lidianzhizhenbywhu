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
