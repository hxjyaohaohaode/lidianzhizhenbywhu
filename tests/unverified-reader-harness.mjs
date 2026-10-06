/** Explicit DOM doubles driving the production delegated listeners, not a browser. */
import assert from 'node:assert/strict';
import {state} from '../web/dist/state.js';
const listeners={};
const decode=s=>s.replace(/&(amp|lt|gt|quot|#39|#13|#10);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'",'#13':'\r','#10':'\n'}[key]));
export const text=html=>decode(html.replace(/<[^>]*>/g,''));
globalThis.document={addEventListener(name,fn){(listeners[name]??=[]).push(fn);},querySelector(){return null;},querySelectorAll(){return [];},createElement(){return {click(){}};}};
export const reader=await import('../web/dist/unverified-reader.js');
export function init(){Object.assign(state,{user:{id:'owner',preferences:{amount_unit:'wan'}},identity:'',active:'dataset',datasets:[],cache:{},dirty:false});}
export function harness(raw,id='bad-run'){
 const html=reader.unverifiedReader(raw,id),dataset={};
 for(const [attr,key] of [['raw-text','rawText'],['reader-scope','readerScope'],['reader-run','readerRun']])dataset[key]=decode(html.match(new RegExp('data-'+attr+'="([^"]*)"'))?.[1]??'');
 const nodes=new Map();let scrolls=0;
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',hidden:false,disabled:selector.includes('previous')||selector.includes('next'),value:'',querySelector:()=>({scrollIntoView(){scrolls++;}})});return nodes.get(selector);};
 const root={dataset,isConnected:true,querySelector:node};
 const input=node('[data-raw-query]');input.dataset={rawQuery:''};input.matches=s=>s==='[data-raw-query]';input.closest=s=>s==='[data-unverified-report-raw]'?root:null;
 const dispatch=(name,target,extra={})=>{for(const fn of listeners[name]??[])fn({target,preventDefault(){},...extra});};
 return {html,root,node,input,get scrolls(){return scrolls;},
  search(query,keyboard=false){input.value=query;dispatch('input',input);if(keyboard)dispatch('keydown',input,{key:'Enter'});else this.click('find');},
  click(action){const button=node('[data-raw-action="'+action+'"]');button.dataset={rawAction:action};button.hasAttribute=name=>name==='disabled'&&button.disabled;button.closest=s=>s==='[data-raw-action]'?button:s==='[data-unverified-report-raw]'?root:null;dispatch('click',button);},
  status(){return node('[data-raw-status]').textContent;},excerpt(){return text(node('[data-raw-excerpt]').innerHTML);}};
}
export async function downloaded(h){
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL,timer=globalThis.setTimeout,element=document.createElement;let blob,filename,clicked=0;
 URL.createObjectURL=value=>{blob=value;return 'blob:synthetic';};URL.revokeObjectURL=()=>{};globalThis.setTimeout=fn=>{fn();return 0;};
 document.createElement=tag=>{assert.equal(tag,'a');return {set download(value){filename=value;},click(){clicked++;}};};
 try{h.click('download');return {bytes:blob?Buffer.from(await blob.arrayBuffer()):null,filename,clicked};}
 finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.setTimeout=timer;document.createElement=element;}
}
