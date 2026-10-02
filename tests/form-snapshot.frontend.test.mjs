/** File-selection-aware production guard checks; not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {unchangedInputGuard} from '../web/dist/saved-experiments.js';
const source=readFileSync(new URL('../web/form-snapshot.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {formSnapshot}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
function withForm(entries,fn){
 const original=globalThis.FormData;const form={entries};
 globalThis.FormData=class {constructor(form){this.entries=form.entries;}[Symbol.iterator](){return this.entries[Symbol.iterator]();}};
 try{return fn(form);}finally{globalThis.FormData=original;}
}
test('unchanged file selection remains stable across form reads',()=>withForm([['company','测试企业'],['file',new File(['first'],'report.csv',{lastModified:1000})]],form=>{
 assert.equal(formSnapshot(form),formSnapshot(form));
}));
test('replacement file invalidates an in-flight preview even with identical file metadata',()=>withForm([['company','测试企业'],['file',new File(['first'],'report.csv',{lastModified:1000})]],form=>{
 const guard=unchangedInputGuard(()=>true,()=>formSnapshot(form));assert.equal(guard(),true);
 form.entries[1][1]=new File(['other'],'report.csv',{lastModified:1000});
 assert.equal(guard(),false);
}));
test('an unselected file input does not change just because FormData creates a fresh empty file',()=>withForm([['file',new File([],'',{lastModified:1000})]],form=>{
 const before=formSnapshot(form);form.entries[0][1]=new File([],'',{lastModified:2000});assert.equal(formSnapshot(form),before);
}));
test('text fields and repeated choices remain part of the visible-input snapshot',()=>withForm([['company','甲企业'],['tags','a'],['tags','b']],form=>{
 const before=formSnapshot(form);form.entries[0][1]='乙企业';assert.notEqual(formSnapshot(form),before);
}));
test('upload-preview submission uses the file-aware reader before displaying its response',()=>{
 const app=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');
 const begin=app.indexOf("document.addEventListener('submit'");const end=app.indexOf('try{const {f,str,val,check,list}',begin);
 assert.match(app.slice(begin,end),/submittedCurrent=unchangedInputGuard\(interactionGuard\(\),\(\)=>form\.isConnected\?formSnapshot\(form\):null\)/);
});

const appJs=ts.transpileModule(readFileSync(new URL('../web/app.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const previewStart=appJs.indexOf("case 'import-file-form':"),previewEnd=appJs.indexOf("case '",previewStart+8);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const preview=new AsyncFunction('env',`const {form,state,str,f,workspace,submittedCurrent,showStage}=env;switch('import-file-form'){${appJs.slice(previewStart,previewEnd)}}`);
for(const replacement of [false,true])test(`production import preview ${replacement?'ignores a replaced file':'displays an unchanged file selection'} after a delayed response`,async()=>{
 const OriginalFormData=globalThis.FormData;
 globalThis.FormData=class {
  constructor(form){this.entries=form.entries.map(pair=>[...pair]);}
  [Symbol.iterator](){return this.entries[Symbol.iterator]();}
  set(key,value){this.entries=this.entries.filter(([k])=>k!==key);this.entries.push([key,value]);}
 };
 try{
  let resolve;const pending=new Promise(r=>{resolve=r;});let displayed=0;
  const form={isConnected:true,dataset:{targetVersions:'{}'},entries:[['file',new File(['first'],'report.csv',{lastModified:1000})]]};
  const current=unchangedInputGuard(()=>true,()=>form.isConnected?formSnapshot(form):null);
  const operation=preview({form,state:{datasets:[],cache:{}},str:()=>'',f:new FormData(form),workspace:()=>pending,submittedCurrent:current,showStage:async()=>{displayed++;}});
  if(replacement)form.entries[0][1]=new File(['other'],'report.csv',{lastModified:1000});
  resolve({id:'preview'});await operation;assert.equal(displayed,replacement?0:1);
 }finally{globalThis.FormData=OriginalFormData;}
});
