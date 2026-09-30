import test from 'node:test';
import assert from 'node:assert/strict';
import {mathResult,reflectionView} from '../web/dist/math-results.js';
test('scenario Agent result exposes actual values and approved assumptions without opening JSON',()=>{
 const html=mathResult('sensitivity',{status:'completed',approved_assumptions:{price_change:.12,cost_change:.03,volume_change:.05,fixed_cost_share:.3,note:'实际批准的假设'},baseline:{revenue:100000,cost:70000,gross_profit:30000,gross_margin:.3},result:{revenue:120000,cost:80000,gross_profit:40000,gross_margin:1/3},delta_gross_profit:10000,break_even_volume_multiplier:null,sensitivity:[],limitations:[]},'wan');
 const visible=html.split('<details>')[0];assert(visible.includes('实际批准的假设'));assert(visible.includes('33.33%'));assert(visible.includes('无法给出可用倍数'));assert(visible.includes('机械计算'));assert(!visible.includes('undefined'));
});
test('blocked forecast explains missing input and never draws invented predictions',()=>{
 const html=mathResult('forecast',{status:'blocked',reason:'不足六个已结束季度'});assert(html.includes('不足六个已结束季度'));assert(!html.includes('class="chart"'));assert(!html.includes('点估计'));
});
test('forecast table preserves missing error band and supplies readable backtest',()=>{
 const html=mathResult('forecast',{status:'completed',metric:'gross_margin',selected:'last',selected_label:'上一季度',history:[{period:'2025-Q1',value:.3}],forecast:[{period:'2025-Q2',value:.31,lower:null,upper:null}],backtests:[{method:'last',label:'上一季度',mae:.02,rmse:.03,wape:.04,folds:[{}]}],limitations:['不是置信区间']});assert(html.includes('31%'));assert(html.includes('校准不足 / 多步未提供'));assert(html.includes('相同滚动起点回测'));assert(html.includes('百分点'));assert(html.includes('不是置信区间'));
});
test('every tool prose and data value is escaped and zero stays distinct from missing',()=>{
 const html=mathResult('gaps',{items:[{field:'<script>bad',action:'<img src=x>'}],findings:[{period:'2025-Q1',message:'<svg onload=bad>'}]});assert(!html.includes('<script>bad'));assert(!html.includes('<img src=x>'));assert(!html.includes('<svg onload=bad>'));
 const reflect=reflectionView({call_attempts:0,successful_calls:0,context_characters:0,rejected_claims:0,issues:[],success_criteria:'<img>'});assert(reflect.includes('<td>0</td>'));assert(!reflect.includes('<img>'));assert(reflect.includes('不表示研究结论已被证明'));
});

import {citationCard} from '../web/dist/components.js';
test('readable citation keeps signed search-summary origin after display URL changes',()=>{
 const html=citationCard({title:'已修订展示标题',url:'https://example.com/corrected',original_source_url:'https://example.com/original',source_kind:'search_snippet',verification:'search_snippet_unverified',retrieved_at:'2026-01-01T00:00:00Z',fetched_at:null,review_state:'accepted',excerpt:'隔离测试摘要',id:'test:0',content_hash:'hash',start:0,end:6});
 const visible=html.split('<details>')[0];
 for(const expected of ['搜索摘要（非全文）','搜索摘要，未经独立核验','人工已审阅','https://example.com/original','https://example.com/corrected','2026-01-01T00:00:00Z','原始采集来源'])assert(visible.includes(expected));
 assert(visible.includes('公开原文获取：未记录'));
});
test('citation provenance cannot introduce markup or executable source links',()=>{
 const html=citationCard({source_kind:'<img src=x>',verification:'<script>bad',original_source_url:'javascript:alert(1)',retrieved_at:'<svg onload=bad>',excerpt:'<iframe>',url:'javascript:bad'});
 assert(!html.includes('<img src=x>'));assert(!html.includes('<script>bad'));assert(!html.includes('<svg onload'));assert(!html.includes('<iframe>'));assert(!html.includes('href="javascript:'));assert(html.includes('来源类型未记录'));
});
