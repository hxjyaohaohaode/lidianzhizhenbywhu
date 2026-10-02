/** Execute production edit branches with isolated I/O; not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function branch(file,label){
 const source=ts.transpileModule(readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const start=source.indexOf(`case '${label}':`),end=source.indexOf("case '",start+8);
 assert(start>=0&&end>start);
 return source.slice(start,end);
}
function deferred(){let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {resolve,reject,promise};}
function runner(file,label){return new AsyncFunction('env',`
 const {form,api,workspace,str,check,split,state,submittedContext,fd}=env;
 const id=form.dataset.id??'',version=Number(form.dataset.version??0);let changed=false;
 switch('${label}'){${branch(file,label)}}return changed;
`);}
const cases=[
 ['evidence-metadata-form','app.ts','/evidence/item/metadata'],
 ['evidence-review-form','app.ts','/evidence/item/review'],
 ['memory-form','app.ts','/memories/item'],
 ['identity','experience.ts','/services/identities/item'],
];
function fixture(){
 const pending=deferred(),calls=[];let current=true;
 const form={dataset:{id:'item',version:'4'},isConnected:true,draft:'submitted'};
 const request=async(...args)=>{calls.push(args);return pending.promise;};
 const env={form,api:request,workspace:request,str:()=>form.draft,check:()=>false,split:v=>[v],state:{identity:'identity',cache:{memories:[{id:'item',payload:{identity_id:'identity'}}]}},submittedContext:()=>current,fd:{getAll:()=>[],has:()=>false}};
 return {pending,calls,form,env,invalidate:()=>{current=false;}};
}
for(const [label,file,path] of cases){
 const run=runner(file,label);
 test(`${label}: a successful older save advances the preserved draft's next version`,async()=>{
  const f=fixture();const operation=run(f.env);f.form.draft='newer unsaved input';f.pending.resolve({id:'item',version:5});await operation;
  assert.equal(f.calls[0][0],path);assert.equal(f.calls[0][2].version,4);
  assert.equal(f.form.draft,'newer unsaved input');assert.equal(f.form.dataset.version,'5');
  const next=[];f.env.api=f.env.workspace=async(...args)=>{next.push(args);return {id:'item',version:6};};await run(f.env);
  assert.equal(next[0][2].version,5);assert.equal(f.form.dataset.version,'6');
 });
 for(const stopped of ['context changed','form replaced'])test(`${label}: ${stopped} prevents stale revision publication`,async()=>{
  const f=fixture();const operation=run(f.env);if(stopped==='context changed')f.invalidate();else f.form.isConnected=false;
  f.pending.resolve({id:'item',version:5});await operation;assert.equal(f.form.dataset.version,'4');
 });
 test(`${label}: unknown write outcome keeps the old version`,async()=>{
  const f=fixture();const operation=run(f.env);const rejected=assert.rejects(operation,/connection interrupted/);f.pending.reject(new Error('connection interrupted'));await rejected;
  assert.equal(f.form.dataset.version,'4');
 });
}
test('identity creation continues the same confirmed object after the user edits in flight',async()=>{
 const f=fixture();f.form.dataset.id='';f.form.dataset.version='0';const run=runner('experience.ts','identity');
 const operation=run(f.env);f.form.draft='newer identity objective';f.pending.resolve({id:'created-identity',version:1});await operation;
 assert.equal(f.calls[0][1],'POST');assert.equal(f.form.dataset.id,'created-identity');assert.equal(f.form.dataset.version,'1');
 const next=[];f.env.api=async(...args)=>{next.push(args);return {id:'created-identity',version:2};};await run(f.env);
 assert.equal(next[0][0],'/services/identities/created-identity');assert.equal(next[0][1],'PUT');assert.equal(next[0][2].version,1);
});
