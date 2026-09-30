/** Pure HTML contracts; not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../web/dist/state.js';
import {importForm,importSummary,stageView} from '../web/dist/views-data.js';
test('import offers explicit revision target and whole-row merge semantics',()=>{
 state.user={preferences:{amount_unit:'wan'}};state.datasets=[{id:'a',version:3,payload:{company:'测试企业',name:'<script>台账'}}];state.identities=[];state.identity='';state.active='a';
 const html=importForm();for(const term of ['name="target_id"','name="merge_mode"','新建独立数据集','v3','完整季度行替换','同年上一季度累计值'])assert(html.includes(term),term);
 assert(!html.includes('<script>台账'));
});
test('preview exposes removals, units and escaped transformations',()=>{
 const html=importSummary({target_id:'a',target_version:3,import_context:{mode:'replace',filename:'<img src=x>',input_amount_unit:'wan',input_basis:'year_to_date',added:['2025-Q3'],replaced:[],retained:[],removed:['2025-Q1'],normalizations:[{row:2,field:'revenue',source:'<script>',normalized:1234,rule:'移除千分位'}]}});
 assert(html.includes('v3 → v4'));assert(html.includes('万元'));assert(html.includes('删除上述历史季度'));assert(html.includes('累计值先转为单季度'));assert(!html.includes('<img src=x>'));assert(!html.includes('<script>'));
});
test('unchanged existing preview does not claim new dataset',()=>{
 const html=stageView({id:'stage',payload:{target_id:'a',dataset:{company:'企业',name:'台账',periods:[]},quality:{closed_quarters:0,field_coverage:{present:0,total:0},warning_count:0,findings:[]},diff:[]}});
 assert(html.includes('与当前数据没有字段差异'));assert(!html.includes('这是一份新的数据集'));
});
