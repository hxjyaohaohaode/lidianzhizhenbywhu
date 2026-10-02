/** Report badges use the shared verdict without treating pending evidence as corrupt. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {runPage} from '../web/dist/views-studio.js';
import {state} from '../web/dist/state.js';

function fixtures(runState='running',withResult=false){
 const analysis={metrics:{},series:[],current_period:'2025-Q4',gmps:{method:'local',score:null,coverage:0,dimensions:[]},dqi:{method:'local',score:null,coverage:0,dimensions:[]}};
 const run={id:'test-run',state:runState,created_at:'2026-10-01',payload:{query:'测试报告校验'},snapshot:{dataset:{company:'隔离合成企业'},citations:[],memory:[]},result:withResult?{title:'冻结报告',analysis,findings:[],warnings:[],llm:{state:'not_requested',review:{claims:[],rejected_claims:0}}}:null};
 const audit={ledger:{valid:true},data_hash_valid:true,snapshot_hash_valid:withResult?true:null,report_hash_valid:withResult?true:null,artifacts:[],trace:[],source_impact:null,report_integrity:{valid:withResult,failures:withResult?[]:['report_missing','report_completion']}};
 return {run,audit};
}
async function render(run,audit){
 const previous=globalThis.fetch;
 Object.assign(state,{user:{id:'owner',preferences:{amount_unit:'wan'}},identity:'',cache:{}});
 globalThis.fetch=async url=>new Response(JSON.stringify(url.endsWith('/audit')?audit:url.endsWith('/reviews')?{items:[]}:run),{headers:{'content-type':'application/json'}});
 try{return await runPage(run.id);}finally{globalThis.fetch=previous;}
}

for(const status of ['queued','running'])test('healthy '+status+' execution awaits report evidence without a corruption alarm',async()=>{
 const {run,audit}=fixtures(status);
 const html=await render(run,audit);
 assert(html.includes('报告校验待完成'));
 assert(!html.includes('记录一致性异常')&&!html.includes('记录一致性通过'));
 audit.ledger.valid=false;
 assert((await render(run,audit)).includes('记录一致性异常'));
});

test('unpublished final artifact is still pending while its independent anchor is being written',async()=>{
 const {run,audit}=fixtures('running');
 audit.artifacts=[{node:'report',integrity_valid:true,event_anchor_valid:false}];
 const html=await render(run,audit);
 assert(html.includes('报告校验待完成')&&!html.includes('记录一致性异常'));
});

test('missing terminal evidence overrides otherwise valid individual hashes',async()=>{
 const {run,audit}=fixtures('succeeded',true);
 assert((await render(run,audit)).includes('记录一致性通过'));
 audit.report_integrity={valid:false,failures:['report_completion']};
 const html=await render(run,audit);
 assert(html.includes('记录一致性异常')&&!html.includes('记录一致性通过'));
});

test('completed missing result is corrupt while failed no-report outcome is unavailable',async()=>{
 let {run,audit}=fixtures('succeeded');
 assert((await render(run,audit)).includes('记录一致性异常'));
 ({run,audit}=fixtures('failed'));
 const html=await render(run,audit);
 assert(html.includes('尚无可校验报告')&&!html.includes('记录一致性通过'));
});

test('old legacy output without a whole-result hash discloses partial verification',async()=>{
 const {run,audit}=fixtures('succeeded',true);
 audit.report_integrity.format='legacy';audit.report_hash_valid=null;
 const html=await render(run,audit);
 assert(html.includes('旧版记录：部分校验通过')&&html.includes('没有完整输出的独立散列证据'));
 assert(!html.includes('记录一致性通过'));
});
