/** Deterministic selection/parameter-lock/UI race regressions; not native E2E. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {experimentProblem,experimentSelection,experimentProvenance,syncExperimentControls,selectedExperimentRequest,unchangedInputGuard} from '../web/dist/saved-experiments.js';
import {interactionGuard,invalidateInteractions} from '../web/dist/interactions.js';
import {mathResult} from '../web/dist/math-results.js';
const ds={id:'dataset-a',version:3,content_hash:'a'.repeat(64)};
const row={id:'experiment-a',version:2,experiment_hash:'b'.repeat(64),payload:{dataset_id:ds.id,dataset_version:3,dataset_hash:ds.content_hash,target_period:'2026-Q2',analysis_as_of:'2026-09-30',request:{kind:'scenario',name:'已保存实验',assumptions:'明确填写并批准的假设'}}};
function dom(value=row.id){
 const fields=Object.fromEntries(['with_scenario','scenario_price','scenario_cost','scenario_volume','scenario_fixed','scenario_note','forecast','forecast_metric','forecast_horizon'].map(k=>[k,{disabled:false,value:'preserved-'+k}]));
 const select={value};const details={innerHTML:''};
 const form={querySelector(selector){return selector==='#plan-experiment'?select:selector==='#selected-experiment-details'?details:fields[selector.match(/name="(.*?)"/)?.[1]];}};
 return {root:{querySelector(){return form;}},fields,select,details};
}
test('selection transfers exact server-issued version/hash and does not guess current assumptions',()=>{
 assert.deepEqual(selectedExperimentRequest(row,ds.id,[ds]),{id:row.id,version:2,hash:row.experiment_hash});
 for(const [r,id,data] of [[null,ds.id,[ds]],[row,'other',[ds]],[row,ds.id,[]],[row,ds.id,[{...ds,version:4}]],[row,ds.id,[{...ds,content_hash:'tampered'}]]])assert.throws(()=>selectedExperimentRequest(r,id,data));
 assert(experimentProblem({...row,payload:{...row.payload,analysis_as_of:null,request:{...row.payload.request,kind:'forecast'}}},[ds]).includes('计算日期'));
});
test('selected scenario locks only its own inputs and clears without erasing user values',()=>{
 const f=dom();syncExperimentControls(f.root,[row],[ds]);
 assert.equal(f.fields.scenario_note.disabled,true);assert.equal(f.fields.with_scenario.disabled,true);
 assert.equal(f.fields.forecast.disabled,false);assert(f.details.innerHTML.includes(row.payload.request.assumptions));
 f.select.value='';syncExperimentControls(f.root,[row],[ds]);
 assert(Object.values(f.fields).every(x=>!x.disabled));assert.equal(f.fields.scenario_price.value,'preserved-scenario_price');assert.equal(f.details.innerHTML,'');
});
test('selected forecast locks metric/horizon while retaining separate custom scenario',()=>{
 const f=dom();syncExperimentControls(f.root,[{...row,payload:{...row.payload,request:{...row.payload.request,kind:'forecast'}}}],[ds]);
 assert.equal(f.fields.forecast.disabled,true);assert.equal(f.fields.forecast_metric.disabled,true);assert.equal(f.fields.forecast_horizon.disabled,true);assert.equal(f.fields.with_scenario.disabled,false);
});
test('saved plan/report provenance is visible, escaped and legacy-safe',()=>{
 assert.equal(experimentProvenance(null),'');
 const p={id:row.id,version:row.version,hash:row.experiment_hash,name:'<script>name</script>',assumptions:'<img src=x>',target_period:'2026-Q2',analysis_as_of:'2026-09-30'};
 const html=experimentProvenance(p);assert(!html.includes('<script>'));assert(!html.includes('<img src=x>'));assert(html.includes(row.experiment_hash));assert(html.includes('2026-Q2'));
 const report=mathResult('sensitivity',{status:'completed',experiment:p,limitations:[]});assert(report.includes(row.experiment_hash));
 const options=experimentSelection([{...row,payload:{...row.payload,request:{...row.payload.request,name:'<svg onload=x>'}}}],row.id);assert(options.includes('selected'));assert(!options.includes('<svg onload=x>'));
});
for(const reason of ['new navigation','new inputs','closed form'])test(`delayed create/approval cannot steal ${reason}`,async()=>{
 invalidateInteractions();let value='original';let apply=0;let resolve;
 const pending=new Promise(r=>resolve=r);const valid=unchangedInputGuard(interactionGuard(),()=>value);
 const completed=pending.then(()=>{if(valid())apply++;});
 if(reason==='new navigation')invalidateInteractions();else value=reason==='closed form'?null:'newer';
 resolve();await completed;assert.equal(apply,0);
});
test('unchanged approved response applies once and form writes remain double-submit protected',async()=>{
 invalidateInteractions();const valid=unchangedInputGuard(interactionGuard(),()=>'same');assert(valid());
 const code=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');
 assert(code.includes("if(form.dataset.submitting==='true')return"));
 for(const name of ['plan-form','experiment-form','execute-plan-form']){
  const segment=code.split("case '"+name+"':")[1].split("case '")[0];
  assert(segment.includes('unchangedInputGuard'));assert(segment.includes('if(sameContext())'));assert.match(segment,/if\(current\(\)\)(?:navigate|\{form.dataset.saved='true';navigate)/);
 }
 assert(code.includes("if(el.id==='plan-experiment')syncExperimentControls"));
 assert(code.includes('syncExperimentControls(main,state.cache.planExperiments??[],scopedDatasets())'));
});
