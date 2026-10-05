/** Production assessment rendering/submission, with explicit DOM/transport doubles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessmentForm} from '../web/dist/views-orchestrator.js';

const notice='已有人工审阅记录无法核验，不能作为新的回放授权或策略依据；可保存非授权反馈或撤回原同意，原报告与已保存验收依据保持不变。';
const context={hash:'a'.repeat(64),available:false,unavailable:[{id:'synthetic-review',version:2}],notice,items:[],related_actions:[]};
const old={version:3,payload:{verdict:'useful',note:'原始人工验收依据',expected_capabilities:['quant'],consent_replay:true},feedback_context:{state:'changed',available:false,message:notice}};
const consent=html=>html.match(/<input[^>]*name="consent_replay"[^>]*>/)?.[0];

for(const prior of [null,old])test(`unavailable review ${prior?'with previous consent':'before first assessment'} shows its reason and permits nonconsenting save`,()=>{
 const before=JSON.stringify([prior,context]);const html=assessmentForm(prior,context);
 assert(html.includes(notice));assert.equal(html.split(notice).length-1,1);
 assert.match(consent(html),/disabled/);assert.doesNotMatch(consent(html),/checked/);
 assert.match(html,/<button[^>]*type="submit"[^>]*>保存验收反馈/);
 assert(!html.includes('人工接受：'));assert(!html.includes('undefined'));
 assert.equal(JSON.stringify([prior,context]),before);
});

test('healthy prior consent and ordinary changed context preserve existing checkbox behavior',()=>{
 assert.match(consent(assessmentForm({...old,feedback_context:{state:'current'}},{hash:context.hash,items:[]})),/checked/);
 assert.doesNotMatch(consent(assessmentForm({...old,feedback_context:{state:'current'}},{hash:context.hash,items:[]})),/disabled/);
 assert.doesNotMatch(consent(assessmentForm(old,{hash:context.hash,items:[]})),/checked|disabled/);
});

test('unavailable explanation remains literal text',()=>{
 const html=assessmentForm(null,{...context,notice:'<script>unsafe()</script> 无法核验'});
 assert(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));assert(!html.includes('<script>'));
});

test('production assessment submit sends the unchecked disabled control as explicit withdrawal with the actual revision',async()=>{
 const source=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');
 const start=source.indexOf("case 'assessment-form':"),end=source.indexOf("case '",start+6);
 const branch=source.slice(start,end);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const calls=[];const workspace=async(path,method,body)=>calls.push({path,method,body});
 // Standard FormData omits disabled and unchecked checkboxes. The real branch
 // receives that absence through its existing checkbox reader.
 const values=new Map([['verdict','useful'],['note',old.payload.note]]);
 const submit=new AsyncFunction('workspace','state','form','str','list','check',
  `let changed=false;switch('assessment-form'){${branch}}return changed;`);
 assert.equal(await submit(workspace,{cache:{run:{id:'synthetic-run'}}},
  {dataset:{version:'3',reviewContextHash:context.hash}},key=>values.get(key),()=>['quant'],key=>values.has(key)),true);
 assert.deepEqual(calls,[{path:'/runs/synthetic-run/assessment',method:'POST',body:{
  review_context_hash:context.hash,version:3,verdict:'useful',note:old.payload.note,expected_capabilities:['quant'],consent_replay:false}}]);
});
