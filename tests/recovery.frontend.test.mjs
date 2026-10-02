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
