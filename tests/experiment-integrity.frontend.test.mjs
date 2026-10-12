/** Compiled renderer + explicit synthetic transport; this is not native UI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {experimentPage,labPage} from '../web/dist/views-analysis.js';
import {state} from '../web/dist/state.js';
for(const payload of [null,{}, {request:{name:'<img src=x>',kind:'scenario'},result:{kind:'scenario',result:{revenue:12345}},snapshot:{synthetic:'unaltered'}}])test(`unverified archived shape ${JSON.stringify(payload)} never renders trusted results`,async()=>{
 state.user={id:'synthetic-owner',preferences:{amount_unit:'wan'}};state.datasets=[];state.identities=[];state.identity='';state.active='';state.cache={};
 globalThis.sessionStorage={getItem:()=>null};
 const row={id:'synthetic-experiment',version:1,payload,integrity:{valid:false,message:'Synthetic seal mismatch'}};
 globalThis.fetch=async url=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>url.includes('/experiments/')?row:{items:[row]}});
 const html=await experimentPage(row.id);
 assert.match(html,/实验记录无法核验/);assert.match(html,/导出未核验记录/);assert(!html.includes('交给 Agent 研判'));assert(!html.includes('data-experiment-source'));
 assert.deepEqual(state.cache.experiment,row);
 const catalog=await labPage();assert.match(catalog,/未核验记录/);assert(!catalog.includes('<img src=x>'));
});
