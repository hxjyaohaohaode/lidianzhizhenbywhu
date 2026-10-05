/** Execute the production delegated click listener; native handoff is audited separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contextGuard} from '../web/dist/api.js';
import {continuationGuard} from '../web/dist/interactions.js';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../web/app.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const start=source.indexOf("document.addEventListener('click',"),end=source.indexOf("document.addEventListener('input',",start);
assert(start>=0&&end>start);
const bind=new Function('env',`const {document,state,routes,safeToLeave,scopedDatasets,invalidateContext,contextGuard,invalidateInteractions,interactionGuard,continuationGuard,navigate,toast,HTMLButtonElement}=env;${source.slice(start,end)}`);
const original='核查范围：2023-Q2，同比，经营现金流。\n当前目标：2023-Q2经营现金流是多少';
function harness({confirm=true,allowed=true,active='old',route='agents',action='assistant-route'}={}){
 let handler;const calls={confirm:0,context:0,navigation:[],errors:[]};
 const state={active,query:'2024-Q4营业收入是多少',dirty:true,cache:{old:'preserve until accepted'}};
 class Button{constructor(){this.dataset={action,route,datasetId:'source',query:original};this.disabled=false;}setAttribute(){}removeAttribute(){}}
 const button=new Button();
 bind({document:{addEventListener:(_type,fn)=>handler=fn},state,routes:{agents:{}},safeToLeave:()=>{calls.confirm++;return confirm},scopedDatasets:()=>allowed?[{id:'source'}]:[],invalidateContext:()=>calls.context++,contextGuard,continuationGuard,invalidateInteractions(){},interactionGuard:()=>()=>true,navigate:(...args)=>calls.navigation.push(args),toast:message=>calls.errors.push(message),HTMLButtonElement:Button});
 return {state,calls,button,click:()=>handler({target:{closest:()=>button},preventDefault(){}})};
}
test('original scoped question reaches the specialized handler before generic navigation',async()=>{
 const h=harness();await h.click();assert.equal(h.state.query,original);assert.equal(h.state.active,'source');assert.deepEqual(h.state.cache,{});assert.equal(h.calls.context,1);assert.equal(h.calls.confirm,1);assert.deepEqual(h.calls.navigation,[['agents',true]]);assert.deepEqual(h.calls.errors,[]);
});
test('cancelling an unsaved draft warning keeps the prior question, enterprise and cache',async()=>{
 const h=harness({confirm:false}),before=structuredClone(h.state);await h.click();assert.deepEqual(h.state,before);assert.equal(h.calls.context,0);assert.deepEqual(h.calls.navigation,[]);
});
test('revoked enterprise scope cannot change context or navigate',async()=>{
 const h=harness({allowed:false}),before=structuredClone(h.state);await h.click();assert.deepEqual(h.state,before);assert.equal(h.calls.context,0);assert.equal(h.calls.confirm,0);assert.deepEqual(h.calls.navigation,[]);assert.match(h.calls.errors[0],/当前身份范围/);
});
test('same-enterprise transfer retains its cache and does not invalidate account context',async()=>{
 const h=harness({active:'source'});await h.click();assert.equal(h.state.query,original);assert.equal(h.calls.context,0);assert.deepEqual(h.state.cache,{old:'preserve until accepted'});
});
test('unknown inherited route names cannot become handoff targets',async()=>{
 const h=harness({route:'constructor'}),before=structuredClone(h.state);await h.click();assert.deepEqual(h.state,before);assert.deepEqual(h.calls.navigation,[]);assert.match(h.calls.errors[0],/目标工作区不可用/);
});
test('ordinary route buttons do not copy assistant fields or override their normal navigation',async()=>{
 const h=harness({action:undefined});delete h.button.dataset.action;await h.click();assert.equal(h.state.query,'2024-Q4营业收入是多少');assert.equal(h.state.active,'old');assert.deepEqual(h.calls.navigation,[['agents']]);
});
test('pending transfer cannot run a duplicate delegated action',async()=>{
 const h=harness();h.button.dataset.pending='true';await h.click();assert.equal(h.calls.confirm,0);assert.deepEqual(h.calls.navigation,[]);
});
