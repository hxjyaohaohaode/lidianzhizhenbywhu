import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {state} from '../web/dist/state.js';
import {reader,init,harness,downloaded,text} from './unverified-reader-harness.mjs';

const raw='\r\n{ "large":900719925474099312345, "ratio":-0.0000e+07, "label":"毛利率", "value":987654321, "escaped":"\\r\\n\\u6bdb\\\"", "html":"<img src=x onerror=bad()>", "emoji":"🔬" }\r\n';
test('HTML transport and actual download preserve raw UTF-8, CRLF, spelling, escapes, and large integers',async()=>{
 init();const h=harness(raw);assert.equal(JSON.parse(h.root.dataset.rawText),raw);
 const full=h.html.match(/data-raw-content[^>]*>([\s\S]*?)<\/pre>/)[1];assert.equal(text(full),raw);
 assert(!h.html.includes('<img'));assert(h.html.includes('&lt;img'));
 h.search('毛利率',true);assert.match(h.status(),/第 1 \/ 1 处/);assert(h.excerpt().includes('900719925474099312345'));assert(h.excerpt().includes('987654321'));
 const download=await downloaded(h);assert.deepEqual(download.bytes,Buffer.from(raw,'utf8'));assert.equal(download.filename,'unverified-saved-report-bad-run.txt');assert.equal(download.clicked,1);
 assert.equal(state.dirty,false);
});
test('visible literal search visits original-order matches, expands context and handles no result safely',()=>{
 init();const h=harness('prefix'.repeat(100)+'毛利率'+'.'.repeat(600)+'987654321 毛利率 tail');
 h.search('毛利率');assert.match(h.status(),/第 1 \/ 2 处/);assert(!h.excerpt().includes('987654321'));
 for(let i=0;i<3;i++)h.click('later');assert(h.excerpt().includes('987654321'));
 h.click('next');assert.match(h.status(),/第 2 \/ 2 处/);h.click('next');assert.match(h.status(),/第 1 \/ 2 处/);h.click('previous');assert.match(h.status(),/第 2 \/ 2 处/);
 h.search('<script>');assert.match(h.status(),/未找到/);assert.equal(h.node('[data-raw-match]').hidden,true);assert.equal(h.node('[data-raw-action="next"]').disabled,true);
 h.search('');assert.match(h.status(),/请输入/);assert.equal(state.dirty,false);
});
test('a 23k-character single line is found through the visible keyword control without target coordinates',async()=>{
 init();const long='{"context":"'+('真实未核验上下文'.repeat(3000))+'","fact":{"id":"gross_margin","label":"毛利率","value":987654321}}';
 const h=harness(long);h.search('毛利率');
 for(const token of ['"id":"gross_margin"','"label":"毛利率"','"value":987654321'])assert(h.excerpt().includes(token));
 assert.deepEqual((await downloaded(h)).bytes,Buffer.from(long));
 assert.equal(h.scrolls,1);assert(long.length>23000);
});
test('malformed JSON and unknown types are distinguished without inventing original text',async()=>{
 init();const invalid='{\r\n"毛利率":900719925474099312345, "x":"\\uNOPE';
 const h=harness(invalid);h.search('毛利率');assert(h.excerpt().includes('900719925474099312345'));
 assert.deepEqual((await downloaded(h)).bytes,Buffer.from(invalid));
 for(const raw of [null,{},[],123,undefined,'\ud800']){const html=reader.unverifiedReader(raw,'run');assert.match(html,/无法提供原字节/);assert(!html.includes('data-raw-action'));assert.equal(reader.rawTextBytes(raw),null);}
});
test('context boundaries preserve complete Unicode characters instead of displaying half a surrogate pair',()=>{
 init();const raw='prefix🔬'+'.'.repeat(239)+'毛利率'+'.'.repeat(239)+'🔬suffix',h=harness(raw);
 h.search('毛利率');assert(h.excerpt().startsWith('…\n🔬'));assert(h.excerpt().endsWith('🔬\n…'));
 assert.notEqual(reader.rawTextBytes(h.excerpt()),null);
 assert.deepEqual(reader.rawMatches(raw,'\ud83d'),[]);
});
test('two reports, closing/reopening, replaced context and detached readers cannot mix text or touch actual drafts',async()=>{
 init();const old=harness('旧原文 毛利率 987654321','old'),fresh=harness('新原文 毛利率 0.2','new');
 const draft={value:'用户刚修改但未提交的真实行动草稿'},cache={draft};state.cache=cache;state.query='保留新研究问题';state.dirty=true;
 old.search('毛利率');fresh.search('毛利率');assert(old.excerpt().includes('987654321'));assert(!fresh.excerpt().includes('987654321'));
 old.click('next');assert((await downloaded(old)).bytes.equals(Buffer.from('旧原文 毛利率 987654321')));
 for(const kind of ['owner','identity','dataset','detached']){
  const h=harness('待屏蔽 毛利率');if(kind==='owner')state.user={id:'other'};else if(kind==='identity')state.identity='other';else if(kind==='dataset')state.active='other';else h.root.isConnected=false;
  h.search('毛利率');assert.equal(h.status(),'');assert.equal((await downloaded(h)).clicked,0);
  Object.assign(state,{user:{id:'owner',preferences:{}},identity:'',active:'dataset'});
 }
 assert.equal(state.cache,cache);assert.equal(draft.value,'用户刚修改但未提交的真实行动草稿');assert.equal(state.query,'保留新研究问题');assert.equal(state.dirty,true);
});
test('actual compiled app input and change listeners leave searches clean and retain a real edited form',async()=>{
 const source=readFileSync(new URL('../web/dist/app.js',import.meta.url),'utf8');
 const start=source.indexOf("document.addEventListener('input',"),end=source.indexOf('for (const overlay of',start);assert(start>0&&end>start);
 const listeners={},document={addEventListener:(type,fn)=>listeners[type]=fn};let invalidations=0;
 new Function('document','state','invalidateInputs',source.slice(start,end))(document,state,()=>invalidations++);
 init();const search={dataset:{rawQuery:''},closest:selector=>selector==='[data-unverified-report-raw]'?{}:null};
 await listeners.input({target:search});await listeners.change({target:search});assert.equal(state.dirty,false);assert.equal(invalidations,0);
 const form={id:'action-edit-form'},draft={id:'',name:'title',value:'真实修改',closest:selector=>selector==='form'?form:null};
 await listeners.input({target:draft});assert.equal(state.dirty,true);assert.equal(invalidations,1);
 await listeners.input({target:search});await listeners.change({target:search});assert.equal(state.dirty,true);assert.equal(draft.value,'真实修改');assert.equal(invalidations,1);
});
test('a late current-thread repaint keeps the newest reader input only for identical raw bytes and context',()=>{
 init();const current=harness('旧坏原文 毛利率 987654321','old');
 current.search('毛利率');current.input.value='刚输入还没查找的关键词';
 current.root.contains=el=>el===current.input;let focused=0;current.input.focus=()=>focused++;
 document.activeElement=current.input;
 const saved=reader.keepUnverifiedReaders({querySelectorAll:()=>[current.root]});
 for(const [kind,matches] of [['same',true],['bytes',false],['run',false],['scope',false]]){
  const next=harness(kind==='bytes'?'另一原文':JSON.parse(current.root.dataset.rawText),kind==='run'?'new':'old');
  if(kind==='scope')next.root.dataset.readerScope='foreign';let replaced;
  next.root.replaceWith=root=>{replaced=root;};
  reader.restoreUnverifiedReaders({querySelectorAll:()=>[next.root]},saved);
  assert.equal(replaced,matches?current.root:undefined);
 }
 assert.equal(current.input.value,'刚输入还没查找的关键词');assert.equal(focused,1);
 assert(current.excerpt().includes('987654321'));document.activeElement=null;
});
