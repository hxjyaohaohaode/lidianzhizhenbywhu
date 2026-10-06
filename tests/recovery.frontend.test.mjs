/** Pure revision-history rendering; native browser verification stays separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {revisionHistory} from '../web/dist/views-data.js';
const row=(version,extra={})=>({version,created_at:'2026-09-30T19:00:00Z',content_hash:'test-hash',diff:[],integrity_valid:true,diff_available:true,...extra});
test('corrupt revision remains visible without differences or a restore control',()=>{
 const html=revisionHistory([row(1,{integrity_valid:false,diff:[{path:'BAD_UNTRUSTED_VALUE',before:2,after:3}]})]);
 assert(html.includes('修订 1'));assert(html.includes('完整性校验失败'));assert(html.includes('可信备份'));
 assert(!html.includes('BAD_UNTRUSTED_VALUE'));assert(!html.includes('data-action="restore-revision"'));
});
test('one corrupt revision does not hide usable history or imply a valid diff across a gap',()=>{
 const html=revisionHistory([row(1,{integrity_valid:false}),row(2,{diff_available:false}),row(3)]);
 assert.equal((html.match(/data-action="restore-revision"/g)||[]).length,2);
 assert(html.includes('data-revision="2"'));assert(html.includes('data-revision="3"'));
 assert(!html.includes('data-revision="1"'));assert(html.includes('相邻历史修订无法校验'));
});
test('verified history preserves escaped differences and import receipt metadata',()=>{
 const html=revisionHistory([row(1,{content_hash:'<script>hash',diff:[{path:'<img src=x>',before:'<iframe>',after:0}],import_receipt:{payload:{note:'<svg>'},content_hash:'<script>receipt'}})]);
 for(const markup of ['<script>','<img src=x>','<iframe>','<svg>'])assert(!html.includes(markup));
 assert(html.includes('<td>0</td>'));assert(html.includes('本次导入处理回执'));assert(html.includes('data-revision="1"'));
});

test('sound original snapshot shows every quarter, exact yuan values and missing inputs before restore',()=>{
 const v=row(1,{snapshot:{company:'原合成企业',name:'原表',source_url:'https://example.test/source',notes:'原始单位记录',periods:[{period:'2024-Q1',revenue:100000,cost:80000,cash_flow:null,sales_volume:7},{period:'2024-Q2',revenue:120000,cost:90000,cash_flow:0}]},import_receipt:{integrity_valid:true,payload:{import_context:{filename:'原始.csv',input_amount_unit:'wan',input_basis:'standalone_quarter',added:['2024-Q1','2024-Q2'],replaced:[]}},content_hash:'receipt'}});
 const html=revisionHistory([v]);
 for(const text of ['此修订保存的完整内容','原合成企业','2024-Q1','2024-Q2','100,000','80,000','未提供','<td>0</td>','<td>7</td>','原填数量','原始.csv','万元','人民币元','https://example.test/source'])assert(html.includes(text),text);
 assert(html.indexOf('此修订保存的完整内容')<html.indexOf('data-action="restore-revision"'));
 assert.equal((html.match(/data-revision-period=/g)||[]).length,2);
 const corrupt=revisionHistory([{...v,integrity_valid:false}]);assert(!corrupt.includes('100,000')&&!corrupt.includes('data-action="restore-revision"'));
});
test('bad receipt cannot display fabricated file metadata beside a sound revision',()=>{
 const html=revisionHistory([row(1,{snapshot:{company:'企业',name:'表',periods:[{period:'2024-Q1',revenue:1,cost:0}]},import_receipt:{integrity_valid:false,payload:{import_context:{filename:'FAKE_FILE'}}}})]);
 assert(html.includes('导入回执校验异常')&&!html.includes('FAKE_FILE'));
});
