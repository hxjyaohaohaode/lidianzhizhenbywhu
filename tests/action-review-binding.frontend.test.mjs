/** Compiled form serialization and submit branch; not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {actionDetail} from '../web/dist/views-analysis.js';
import {state} from '../web/dist/state.js';

const app=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
const start=app.indexOf("case 'action-transition-form':"),end=app.indexOf("case '",start+6);
assert(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const submit=new AsyncFunction('env',`const {form,workspace,str,list}=env;let changed=false;switch('action-transition-form'){${app.slice(start,end)}}return changed;`);
const hash='a'.repeat(64),reviewHash='b'.repeat(64);
const action={id:'action',version:4,payload:{company:'测试企业',title:'核对原始资料',status:'in_progress',history:[],changes:[],acceptance:'核对并记录结论'}};
const evidence=(id,overrides={})=>({id,version:1,content_hash:hash,review_version:2,review_hash:reviewHash,
 eligible:true,payload:{title:'已查看的原始资料'},review:{company:'测试企业',status:'accepted',note:'原审阅说明',stance:'supports'},...overrides});
function formFor(docs){
 state.identities=[];const html=actionDetail(action,docs);
 const encoded=html.match(/data-evidence-refs="([^"]*)"/)[1];
 return {html,dataset:{id:action.id,version:String(action.version),evidenceRefs:encoded.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&')}};
}
async function transmitted(form,ids){
 const calls=[];assert(await submit({form,workspace:async(...args)=>calls.push(args),str:k=>k==='status'?'done':'人工核对原文及审阅',list:()=>ids}));
 assert.equal(calls.length,1);assert.equal(calls[0][0],'/actions/action/status');assert.equal(calls[0][1],'PUT');
 return calls[0][2];
}

test('rendered selection sends the exact viewed review hash through production submit code',async()=>{
 const docs=[evidence('chosen'),evidence('unchecked'),evidence('foreign',{review:{company:'其他企业'}}),evidence('excluded',{eligible:false})];
 const form=formFor(docs),refs=JSON.parse(form.dataset.evidenceRefs);
 assert.deepEqual(refs.map(r=>r.id),['chosen','unchecked']);
 assert.deepEqual(refs[0],{id:'chosen',version:1,content_hash:hash,review_version:2,review_hash:reviewHash});
 const body=await transmitted(form,['chosen']);
 assert.deepEqual(body.evidence_refs,[refs[0]]);assert.deepEqual(body.evidence_ids,['chosen']);assert.equal(body.version,4);
});

test('a later catalog cannot overwrite the hash frozen in an already viewed action form',async()=>{
 const doc=evidence('chosen'),oldForm=formFor([doc]);
 doc.review_hash='c'.repeat(64);doc.review.note='尚未在旧窗口查看的新说明';doc.review.stance='context';
 const newForm=formFor([doc]);
 assert.equal((await transmitted(oldForm,['chosen'])).evidence_refs[0].review_hash,reviewHash);
 assert.equal((await transmitted(newForm,['chosen'])).evidence_refs[0].review_hash,'c'.repeat(64));
});

test('legacy missing hash is never fabricated and archived evidence remains readable',async()=>{
 const doc=evidence('chosen');delete doc.review_hash;
 const body=await transmitted(formFor([doc]),['chosen']);
 assert(!Object.hasOwn(body.evidence_refs[0],'review_hash'));
 const historical=structuredClone(action);historical.payload.history=[{status:'done',note:'原始验收结论',evidence_ids:['gone'],evidence_snapshots:[{id:'gone',title:'已删除的历史原文',version:1,review_version:1,content_hash:hash,text:'原始冻结内容',review:{note:'原始冻结审阅'}}]}];
 const before=structuredClone(historical),html=actionDetail(historical,[]);
 for(const text of ['原始验收结论','已删除的历史原文','原始冻结内容','原始冻结审阅'])assert(html.includes(text));
 assert.deepEqual(historical,before);
});
