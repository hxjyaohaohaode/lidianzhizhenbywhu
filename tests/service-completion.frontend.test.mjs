/** Executed service-form event harness. These are DOM/API doubles, not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
const listeners=new Map();
globalThis.document={addEventListener(type,fn){listeners.set(type,fn)},querySelector(){return null},querySelectorAll(){return []}};
globalThis.window={addEventListener(){}};
const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
const {setupExperience}=await import('../web/dist/experience.js');
const {resetCopilot}=await import('../web/dist/copilot-ui.js');
const {state}=await import('../web/dist/state.js');
const {invalidateContext}=await import('../web/dist/api.js');
const {invalidateInteractions,interactionGuard}=await import('../web/dist/interactions.js');
globalThis.setInterval=interval;
const NativeFormData=globalThis.FormData;
globalThis.FormData=class extends NativeFormData{constructor(form){super();for(const [k,v] of form?.fields??[])this.append(k,v);}};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function form(type,fields={},dataset={}){
 const error={textContent:'',isConnected:true},button={disabled:false};
 const row={dataset:{serviceForm:type,...dataset},isConnected:true,fields:new Map(Object.entries(fields)),error,button,
  reportValidity(){return true},setAttribute(){},removeAttribute(){},querySelectorAll(){return [button]},
  querySelector(selector){if(selector==='.form-error')return error;const name=selector.match(/name="([^"]+)"/)?.[1];if(name)return {get value(){return row.fields.get(name)},set value(value){row.fields.set(name,value)}};return null;}};
 return row;
}
function setup(overrides={}){
 invalidateInteractions();invalidateContext();resetCopilot();
 Object.assign(state,{user:{id:'owner',preferences:{role:'enterprise'}},identity:'',active:'d',datasets:[{id:'d',version:1,payload:{company:'测试企业',name:'报表'}}],identities:[],cache:{},dirty:true,route:'services'});
 const h={close:0,render:0,reset:0,toasts:[],published:0};
 document.querySelector=selector=>selector==='#modal'?{close(){h.close++}}:null;
 setupExperience({dialog(){},inspect(){},navigate(){},render:async()=>{h.render++;invalidateInteractions()},refresh:async valid=>{if(valid&&!valid())return false;h.published++;return true},reset(){h.reset++},toast(message,error){h.toasts.push({message,error})},...overrides});
 h.submit=target=>listeners.get('submit')({target,preventDefault(){},stopImmediatePropagation(){}});
 h.click=(action,id)=>{const el={dataset:{xAction:action,id},setAttribute(){},removeAttribute(){},closest(){return this}};return listeners.get('click')({target:el,preventDefault(){},stopImmediatePropagation(){}})};
 return h;
}
const identityFields={name:'原身份',perspective:'operator',depth:'balanced',output_style:'actionable',max_calls:'0'};

test('confirmed service save survives refresh failure with a visible saved notice',async()=>{
 const old=fetch;let writes=0;const h=setup({refresh:async()=>{throw new Error('refresh failed')}}),f=form('identity',identityFields);
 try{globalThis.fetch=async()=>{writes++;return response({id:'identity-a',version:1})};await h.submit(f);
  assert.equal(writes,1);assert.equal(h.close,1);assert.equal(state.dirty,false);assert.equal(f.error.textContent,'');assert.match(h.toasts[0].message,/已保存.*同步读取未完成/);assert.equal(h.reset,0);
 }finally{globalThis.fetch=old;}
});
test('staged service refresh preserves an edited draft and does not publish or dismiss it',async()=>{
 const old=fetch,read=deferred();let guard;const h=setup({refresh:async valid=>{guard=valid;await read.promise;if(!valid())return false;h.published++;return true}}),f=form('watch',{title:'原规则',dataset_id:'d',metric:'gross_margin',operator:'lt',threshold:'20',stale_after_days:'180',active:'on'},{id:'watch-a',version:'1'});
 try{globalThis.fetch=async()=>response({id:'watch-a',version:2});const pending=h.submit(f);await turn();assert.equal(h.close,0);f.fields.set('title','新规则草稿');state.dirty=true;assert.equal(guard(),false);read.resolve();await pending;
  assert.equal(h.published,0);assert.equal(h.close,0);assert.equal(h.render,0);assert.equal(f.fields.get('title'),'新规则草稿');assert.equal(f.dataset.version,'2');assert.equal(state.dirty,true);assert.match(h.toasts[0].message,/已保存.*保留/);
 }finally{globalThis.fetch=old;}
});
test('a newer dialog during service refresh is never closed or overwritten',async()=>{
 const old=fetch,read=deferred();const h=setup({refresh:async valid=>{await read.promise;if(!valid())return false;h.published++;return true}}),f=form('alert-ack',{note:'核对过的说明'},{id:'alert-a',version:'1'});
 try{globalThis.fetch=async()=>response({id:'alert-a',version:2});const pending=h.submit(f);await turn();invalidateInteractions();f.isConnected=false;state.dirty=true;read.resolve();await pending;
  assert.equal(h.published,0);assert.equal(h.close,0);assert.equal(h.render,0);assert.equal(state.dirty,true);assert.equal(f.dataset.version,'2');
 }finally{globalThis.fetch=old;}
});
test('old-account service refresh failure cannot notify or reset a newer account',async()=>{
 const old=fetch,read=deferred();const h=setup({refresh:async()=>read.promise}),f=form('identity',identityFields);
 try{globalThis.fetch=async()=>response({id:'identity-a',version:1});const pending=h.submit(f);await turn();invalidateContext();state.user={id:'new-owner'};invalidateInteractions();f.isConnected=false;read.reject(new Error('old account expired'));await pending;
  assert.equal(h.reset,0);assert.equal(h.close,0);assert.equal(h.toasts.length,0);assert.equal(state.user.id,'new-owner');assert.equal(f.error.textContent,'');
 }finally{globalThis.fetch=old;}
});
test('rejected service write retains the current form and does not announce success',async()=>{
 const old=fetch;const h=setup(),f=form('identity',identityFields);
 try{globalThis.fetch=async()=>response({error:{code:'VERSION_CONFLICT',message:'记录已改变'}},409);await h.submit(f);assert.equal(h.close,0);assert.equal(h.published,0);assert.equal(state.dirty,true);assert.match(f.error.textContent,/记录已改变/);assert.equal(h.toasts.length,0);assert.equal(f.button.disabled,false);
 }finally{globalThis.fetch=old;}
});
test('confirmed connection creation binds retained newer edits to the saved id and version',async()=>{
 const old=fetch,write=deferred(),calls=[];const h=setup(),f=form('connection',{name:'旧名称',base_url:'https://provider.example/v1',model:'model-a',api_key:'synthetic-test-only',password:'synthetic-test-only'});
 try{globalThis.fetch=(url,init)=>{calls.push({url,method:init.method,body:JSON.parse(init.body)});return calls.length===1?write.promise:Promise.resolve(response({id:'connection-a',version:2}))};const pending=h.submit(f);f.fields.set('name','新名称');write.resolve(response({id:'connection-a',version:1}));await pending;
  assert.equal(h.close,0);assert.equal(f.dataset.id,'connection-a');assert.equal(f.dataset.version,'1');assert.equal(f.fields.get('name'),'新名称');await h.submit(f);assert.equal(calls[1].url,'/api/services/connections/connection-a');assert.equal(calls[1].method,'PUT');assert.equal(calls[1].body.version,1);assert.equal(calls[1].body.name,'新名称');
 }finally{globalThis.fetch=old;}
});
test('confirmed alert acknowledgement advances the retained note draft version',async()=>{
 const old=fetch,write=deferred();const h=setup(),f=form('alert-ack',{note:'已提交的旧说明'},{id:'alert-a',version:'1'});
 try{globalThis.fetch=()=>write.promise;const pending=h.submit(f);f.fields.set('note','用户继续编辑的新说明');write.resolve(response({id:'alert-a',version:2}));await pending;
  assert.equal(f.dataset.version,'2');assert.equal(f.fields.get('note'),'用户继续编辑的新说明');assert.equal(h.close,0);assert.match(h.toasts[0].message,/已保存.*保留/);
 }finally{globalThis.fetch=old;}
});
test('confirmed one-time removal cannot be resubmitted from a retained form',async()=>{
 const old=fetch,write=deferred();let calls=0;const h=setup(),f=form('remove-connection',{password:'synthetic-test-only'},{id:'connection-a',version:'1'});
 try{globalThis.fetch=()=>{calls++;return write.promise};const pending=h.submit(f);f.fields.set('password','new-synthetic-test-only');write.resolve(response({ok:true}));await pending;await h.submit(f);
  assert.equal(calls,1);assert.equal(f.dataset.completed,'true');assert.equal(f.button.disabled,true);assert.match(h.toasts.at(-1).message,/无需重复提交/);
 }finally{globalThis.fetch=old;}
});
test('repeated pending service submit dispatches only one mutation',async()=>{
 const old=fetch,write=deferred();let calls=0;const h=setup(),f=form('identity',identityFields);
 try{globalThis.fetch=()=>{calls++;return write.promise};const pending=h.submit(f);await h.submit(f);assert.equal(calls,1);write.resolve(response({id:'identity-a',version:1}));await pending;assert.equal(h.render,1);
 }finally{globalThis.fetch=old;}
});
function alertState(){state.dirty=false;state.route='tracking';state.cache.tracking={alerts:[{id:'alert-a',payload:{dataset_id:'d',title:'毛利提醒',metric:'gross_margin',period:'2025-Q4',dataset_version:1,value:.1,threshold:.2}}]};}
function chatTransport(calls,{mount}={}){let first=true;return async(url,init)=>{calls.push({url,method:init.method,body:init.body?JSON.parse(init.body):null});if(url.includes('/threads?')){if(first&&mount){first=false;await mount.promise}return response({items:[]})};if(url==='/api/services/threads'&&init.method==='POST')return response({id:'thread-a',version:1,payload:{identity_id:'',dataset_id:'d'}});if(url.endsWith('/messages'))return response({id:'message-a'});return response({thread:{id:'thread-a',version:2,payload:{identity_id:'',dataset_id:'d'}},messages:[],proposals:[],runs:[]});};}
test('alert current-revision handoff survives its own navigation render and submits the historical context once',async()=>{
 const old=fetch,calls=[];let renders=0;const h=setup({navigate(){throw new Error('must not use separate hash navigation')},render:async()=>{throw new Error('must not double-render')},navigateRendered:async path=>{assert.equal(path,'copilot');invalidateInteractions();renders++;state.route=path;const valid=interactionGuard();await turn();return valid()?valid:null}});alertState();
 try{globalThis.fetch=chatTransport(calls);await h.click('alert-current-investigate','alert-a');const writes=calls.filter(c=>c.url.endsWith('/messages'));assert.equal(renders,1);assert.equal(writes.length,1);assert.match(writes[0].body.text,/历史提醒 alert-a.*2025-Q4.*明确使用当前保存的修订/);assert.equal(h.toasts.length,0);
 }finally{globalThis.fetch=old;resetCopilot();}
});
test('cancelled alert handoff preserves the dirty page and does not navigate or send',async()=>{
 const oldFetch=fetch,oldConfirm=globalThis.confirm;let navigations=0;const h=setup({navigateRendered:async()=>{navigations++;return interactionGuard()}});alertState();state.dirty=true;
 try{globalThis.confirm=()=>false;globalThis.fetch=async()=>{throw new Error('must not request')};await h.click('alert-current-investigate','alert-a');assert.equal(navigations,0);assert.equal(state.dirty,true);assert.equal(state.route,'tracking');
 }finally{globalThis.fetch=oldFetch;globalThis.confirm=oldConfirm;}
});
test('a newer route or dialog during alert navigation prevents delayed handoff',async()=>{
 const old=fetch,render=deferred(),calls=[];const h=setup({navigateRendered:async()=>{invalidateInteractions();const valid=interactionGuard();await render.promise;return valid()?valid:null}});alertState();
 try{globalThis.fetch=chatTransport(calls);const pending=h.click('alert-current-investigate','alert-a');invalidateInteractions();state.route='actions';state.dirty=true;render.resolve();await pending;assert.equal(calls.length,0);assert.equal(state.route,'actions');assert.equal(state.dirty,true);
 }finally{globalThis.fetch=old;resetCopilot();}
});
test('new interaction while alert assistant context loads prevents the old question from being sent',async()=>{
 const old=fetch,mount=deferred(),calls=[];const h=setup({navigateRendered:async()=>{invalidateInteractions();return interactionGuard()}});alertState();
 try{globalThis.fetch=chatTransport(calls,{mount});const pending=h.click('alert-current-investigate','alert-a');await turn();assert(calls.some(c=>c.url.includes('/threads?')));invalidateInteractions();state.route='actions';mount.resolve();await pending;assert.equal(calls.filter(c=>c.method==='POST').length,0);
 }finally{globalThis.fetch=old;resetCopilot();}
});
test('identity switch during alert navigation never dispatches into the new identity',async()=>{
 const old=fetch,render=deferred(),calls=[];const h=setup({navigateRendered:async()=>{await render.promise;return ()=>true}});alertState();
 try{globalThis.fetch=chatTransport(calls);const pending=h.click('alert-current-investigate','alert-a');invalidateContext();state.identity='another-identity';render.resolve();await pending;assert.equal(calls.length,0);assert.equal(state.identity,'another-identity');
 }finally{globalThis.fetch=old;resetCopilot();}
});
for(const failRefresh of [false,true])test(`new watch draft edited during ${failRefresh?'failed':'superseded'} refresh receives a fresh create token`,async()=>{
 const old=fetch,read=deferred();const h=setup({refresh:async valid=>{await read.promise;if(failRefresh)throw new Error('read failed');return valid()}}),f=form('watch',{source_ref:JSON.stringify({kind:'dataset',dataset_version:1,dataset_hash:'a'.repeat(64)}),request_id:'original-request-key',title:'原规则',dataset_id:'d',metric:'gross_margin',operator:'lt',threshold:'20',stale_after_days:'180',active:'on'});
 try{globalThis.fetch=async()=>response({id:'watch-a',version:1});const pending=h.submit(f);await turn();f.fields.set('threshold','30');read.resolve();await pending;assert.notEqual(f.fields.get('request_id'),'original-request-key');assert.equal(f.fields.get('threshold'),'30');assert.equal(h.close,0);assert.equal(state.dirty,true);assert.equal(h.toasts.length,1);assert.match(h.toasts[0].message,/已保存/);
 }finally{globalThis.fetch=old;}
});
test('unknown watch write outcome keeps original request token for explicit retry',async()=>{
 const old=fetch,write=deferred();const h=setup(),f=form('watch',{source_ref:JSON.stringify({kind:'dataset',dataset_version:1,dataset_hash:'a'.repeat(64)}),request_id:'original-request-key',title:'原规则',dataset_id:'d',metric:'gross_margin',operator:'lt',threshold:'20',stale_after_days:'180',active:'on'});
 try{globalThis.fetch=()=>write.promise;const pending=h.submit(f);f.fields.set('threshold','30');write.reject(new Error('unknown transport outcome'));await pending;assert.equal(f.fields.get('request_id'),'original-request-key');assert.equal(h.close,0);assert.equal(h.toasts.length,0);assert.match(f.error.textContent,/无法连接服务/);
 }finally{globalThis.fetch=old;}
});
test('new interaction while an alert handoff creates its thread prevents the later message dispatch',async()=>{
 const old=fetch,creation=deferred(),calls=[];const h=setup({navigateRendered:async()=>{invalidateInteractions();return interactionGuard()}});alertState();
 try{const normal=chatTransport(calls);globalThis.fetch=(url,init)=>url==='/api/services/threads'&&init.method==='POST'?(calls.push({url,method:init.method}),creation.promise):normal(url,init);const pending=h.click('alert-current-investigate','alert-a');await turn();assert(calls.some(c=>c.url==='/api/services/threads'&&c.method==='POST'));invalidateInteractions();state.route='actions';creation.resolve(response({id:'thread-a',version:1,payload:{identity_id:'',dataset_id:'d'}}));await pending;assert.equal(calls.filter(c=>c.url.endsWith('/messages')).length,0);
 }finally{globalThis.fetch=old;resetCopilot();}
});
