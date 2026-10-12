/** Frozen compiled production import branch + showStage, explicit DOM/I/O doubles.
 * Native counterexample: import preview inherited deep file-form scroll.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
const showStage=section('async function showStage(', 'function rawDataset(');
const branch=section("case 'import-file-form':", "case 'evidence-form':");
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const run=new AsyncFunction('env',`const {state,form,str,f,workspace,submittedCurrent,modal,dialog,stageView}=env;${showStage}\nswitch('import-file-form'){${branch}}`);
function fixture(){
 let resolve,reject,current=true;const pending=new Promise((yes,no)=>{resolve=yes;reject=no});
 const values={target_id:'',company:'Synthetic test company',amount_unit:'yuan',basis:'standalone_quarter',merge_mode:'merge'};
 const modal={scrollTop:620,title:'import-form'},state={datasets:[],identity:'identity',active:'dataset',cache:{}};
 const calls=[];const env={state,modal,form:{dataset:{targetVersions:'{}'}},str:key=>values[key]??'',f:{set(){}},workspace:()=>pending,submittedCurrent:()=>current,stageView:()=>'<p>preview</p>',dialog(title){calls.push(title);modal.title=title;}};
 return {env,modal,state,calls,resolve,reject,invalidate(){current=false}};
}
test('accepted deep import form opens preview at top after rendering',async()=>{
 const h=fixture();const job=run(h.env);assert.equal(h.modal.scrollTop,620);h.resolve({id:'synthetic-stage'});await job;
 assert.equal(h.modal.scrollTop,0);assert.equal(h.modal.title,'保存前核对');assert.equal(h.state.cache.stage.id,'synthetic-stage');assert.equal(h.calls.length,1);
});
test('validation error keeps form scroll, context and draft for correction',async()=>{
 const h=fixture();const job=run(h.env);h.reject(Error('SAMPLE_DISABLED'));await assert.rejects(job,/SAMPLE_DISABLED/);
 assert.equal(h.modal.scrollTop,620);assert.equal(h.modal.title,'import-form');assert.equal(h.state.cache.stage,undefined);assert.equal(h.state.cache.importDraft.company,'Synthetic test company');assert.equal(h.state.identity,'identity');assert.equal(h.calls.length,0);
});
for(const kind of ['dismissed','new input'])test(`late preview after ${kind} cannot reopen or reset newer content`,async()=>{
 const h=fixture();const job=run(h.env);h.invalidate();h.modal.title=kind;h.modal.scrollTop=880;h.resolve({id:'late-stage'});await job;
 assert.equal(h.modal.scrollTop,880);assert.equal(h.modal.title,kind);assert.equal(h.state.cache.stage,undefined);assert.equal(h.calls.length,0);
});
