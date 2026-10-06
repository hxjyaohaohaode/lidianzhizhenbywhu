/** Production renderers with an explicit transport double; no browser claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mathResult} from '../web/dist/math-results.js';
import {evolutionPage} from '../web/dist/views-orchestrator.js';
import {state} from '../web/dist/state.js';
import {invalidateContext,invalidateView} from '../web/dist/api.js';

test('unmet counterevidence shows the actual gap alongside preserved human-label groups',()=>{
 const output={status:'missing',reason:'没有人工标注为反向的资料，反向证据要求尚未满足',limitation:'人工反向标签不证明有效反证、逻辑矛盾或事实正确性',groups:{supports:['support-a'],contradicts:[],context:['background-a']}};
 const before=structuredClone(output),html=mathResult('counterevidence',output).split('<details>')[0];
 for(const expected of [output.reason,output.limitation,'support-a','background-a','没有对应资料'])assert(html.includes(expected));
 assert.deepEqual(output,before);
});

test('counterevidence gap reasons and saved group IDs cannot inject markup',()=>{
 const html=mathResult('counterevidence',{status:'missing',reason:'<img src=x>',limitation:'<script>bad</script>',groups:{supports:['<iframe>'],contradicts:[],context:[]}});
 for(const tag of ['<img src=x>','<script>bad</script>','<iframe>'])assert(!html.includes(tag));
});

async function renderEvolution(current,reason='本地回放实现版本已变化，当前使用内置规划规则'){
 invalidateContext();invalidateView();
 Object.assign(state,{user:{id:'isolated-owner'},route:'learning',id:'',cache:{}});
 const evaluation={id:'saved-evaluation',version:1,created_at:'2026-10-05T10:00:00Z',payload:{eligible:true,candidate_id:'saved-candidate',unique_inputs:3,scenario_cases:3,improvements:['a','b','c'],regressions:[],blockers:[]},implementation_context:{current,message:current?'':'旧规则下的历史结果，本地回放或数学实现版本已变化；须重新回放后再决定是否激活'}};
 const data={active:{payload:{spec:null,history:[],invalidation_reason:reason}},candidates:[],evaluations:[evaluation],assessments:[],observations:{observed_runs:3,consented_cases:3,structural_rejections:0}};
 const before=structuredClone(data),previous=globalThis.fetch;
 globalThis.fetch=async url=>{assert.equal(url,'/api/workspace/evolution');return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});};
 try{return {html:await evolutionPage(),data,before};}finally{globalThis.fetch=previous;}
}

test('old eligible evaluation remains historical without an activation button or payload rewrite',async()=>{
 const {html,data,before}=await renderEvolution(false);
 assert(html.includes('历史结果 · 须重新回放'));
 assert(html.includes('旧规则下的历史结果'));
 assert(html.includes('本地回放实现版本已变化，当前使用内置规划规则'));
 assert(!html.includes('data-action="strategy-activate"'));
 assert(html.includes('data-action="evaluation-detail"'));
 assert(html.includes('3 项改善'));
 assert.deepEqual(data,before);
 assert.deepEqual(state.cache.evolution.evaluations[0].payload,before.evaluations[0].payload);
});

test('current saved success keeps explicit activation and escaped invalidation text',async()=>{
 const {html}=await renderEvolution(true,'<img src=x onerror=bad>');
 assert(html.includes('data-action="strategy-activate"'));
 assert(!html.includes('旧规则下的历史结果'));
 assert(!html.includes('<img src=x onerror=bad>'));
 assert(html.includes('&lt;img'));
});
