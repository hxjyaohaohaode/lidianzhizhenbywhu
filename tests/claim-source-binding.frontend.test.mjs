import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceForm,formSource} from '../web/dist/business-source.js';
const hash='a'.repeat(64);
const viewed={kind:'report',run_id:'report',claim_id:'claim',claim_review_version:2,claim_review_hash:hash};
const submit=(ref,historical=false)=>{const fd=new FormData();fd.set('source_ref',JSON.stringify(ref));if(historical)fd.set('allow_historical','on');return formSource(fd).source_ref;};

test('claim form retains the viewed review hash even if a newer catalog exists',()=>{
 const html=sourceForm(viewed), encoded=html.match(/name="source_ref" value="([^"]+)"/)[1];
 const frozen=JSON.parse(encoded.replaceAll('&quot;','"').replaceAll('&amp;','&'));
 const current={...viewed,claim_review_version:3,claim_review_hash:'b'.repeat(64)};
 assert.equal(current.claim_review_version,3);
 assert.deepEqual(submit(frozen),{...viewed,allow_historical:false});
 assert.deepEqual(submit(frozen,true),{...viewed,allow_historical:true});
});

test('explicit no-review view keeps both zero revision and null fingerprint',()=>{
 const ref={...viewed,claim_review_version:0,claim_review_hash:null};
 assert.deepEqual(submit(ref),{...ref,allow_historical:false});
});

test('missing or malformed claim bindings cannot be repaired by historical consent',()=>{
 for(const key of ['claim_review_version','claim_review_hash']){
  const ref={...viewed};delete ref[key];assert.throws(()=>submit(ref,true),/重新打开来源/);
 }
 for(const patch of [{claim_review_version:null},{claim_review_version:true},{claim_review_version:'2'},
  {claim_review_version:-1},{claim_review_version:Number.MAX_SAFE_INTEGER+1},{claim_review_hash:null},
  {claim_review_hash:'wrong'},{claim_review_version:0}]){
  assert.throws(()=>submit({...viewed,...patch},true),/重新打开来源/);
 }
 const absent={...viewed,claim_review_version:0};delete absent.claim_review_hash;
 assert.throws(()=>submit(absent),/重新打开来源/);
});

test('ordinary report sources remain valid without claim-review bindings',()=>{
 assert.deepEqual(submit({kind:'report',run_id:'report'}),{kind:'report',run_id:'report',allow_historical:false});
});
