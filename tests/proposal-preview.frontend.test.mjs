/** Frozen proposal-plan UI contract; native rendering is checked separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {planPage} from '../web/dist/views-studio.js';
import {state} from '../web/dist/state.js';

test('proposal preview has no ordinary execute form and points back to assistant confirmation',async()=>{
 const previous=globalThis.fetch;
 Object.assign(state,{user:{id:'owner',preferences:{}},identity:'',active:'dataset',cache:{}});
 const plan={id:'preview',version:1,payload:{status:'proposal_preview',proposal_id:'proposal',request:{query:'检查现金流'},snapshot:{dataset:{company:'测试企业',periods:[{period:'2025-Q4'}]},citations:[],memory:[]},max_calls:0,packing:{characters:1200,limit:10000,dropped:[],included_memory_ids:[]},nodes:[],context:{},quality:{closed_quarters:4,field_coverage:{present:3,total:3},warning_count:0,findings:[]},excluded_memory:[],blockers:[],fingerprint:'f'.repeat(64),bindings:{}}};
 globalThis.fetch=async()=>new Response(JSON.stringify(plan),{headers:{'content-type':'application/json'}});
 try{
  const html=await planPage(plan.id);
  assert(html.includes('提案预览')&&html.includes('只读预览'));
  assert(html.includes('data-route="copilot"'));
  assert(!html.includes('execute-plan-form')&&!html.includes('name="external_consent"'));
  plan.payload.status='draft';delete plan.payload.proposal_id;
  assert((await planPage(plan.id)).includes('execute-plan-form'));
  plan.payload.status='dispatched';plan.payload.run_id='confirmed-run';
  const dispatched=await planPage(plan.id);
  assert(dispatched.includes('agents:run-confirmed-run')&&!dispatched.includes('execute-plan-form'));
 }finally{globalThis.fetch=previous;}
});
