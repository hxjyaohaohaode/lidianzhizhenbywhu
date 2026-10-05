/** Production editor-control branches with two isolated forms; not native browser evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {invalidateInputs} from '../web/dist/interactions.js';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../web/app.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function branch(label){const start=source.indexOf(`case '${label}':`),end=source.indexOf("case '",start+8);assert(start>=0&&end>start);return source.slice(start,end);}
function editor(count){
 const form={rows:Array.from({length:count},()=>({})),expanded:false,additions:[]};
 form.querySelector=selector=>selector==='#period-rows'?{insertAdjacentHTML:(_where,html)=>{form.additions.push(html);form.rows.push({});}}:selector==='.editor-table'?{classList:{toggle:(_name,checked)=>{form.expanded=checked;}}}:null;
 form.querySelectorAll=()=>form.rows;form.contains=row=>form.rows.includes(row);return form;
}
test('add quarter targets the initiating modal editor and uses its own row count',async()=>{
 const background=editor(8),modal=editor(1),state={dirty:false};
 const document={querySelector:s=>background.querySelector(s),querySelectorAll:s=>background.querySelectorAll(s)};
 const el={closest:s=>s==='form'?modal:null};
 await new AsyncFunction('el','document','state','periodRow','invalidateInputs',`switch('add-period'){${branch('add-period')}}`)(el,document,state,(_p,index)=>'new-row-'+index,invalidateInputs);
 assert.deepEqual(background.additions,[]);assert.deepEqual(modal.additions,['new-row-1']);assert.equal(state.dirty,true);
});
test('remove quarter only affects the initiating editor',async()=>{
 const background=editor(2),modal=editor(2),state={dirty:false};const row=modal.rows[0];row.remove=()=>modal.rows.splice(modal.rows.indexOf(row),1);
 const el={closest:s=>s==='form'?modal:['tr','[data-period-row]'].includes(s)?row:null};
 await new AsyncFunction('el','state','invalidateInputs',`switch('remove-period'){${branch('remove-period')}}`)(el,state,invalidateInputs);
 assert.equal(background.rows.length,2);assert.equal(modal.rows.length,1);assert.equal(state.dirty,true);
});
test('supplemental fields expand the initiating editor rather than the background form',async()=>{
 const background=editor(8),modal=editor(1);const el={id:'extra-fields',checked:true,closest:s=>s==='form'?modal:null};
 const document={querySelector:s=>background.querySelector(s)};
 const start=source.indexOf("if (el.id === 'extra-fields')"),end=source.indexOf("if (el.id === 'use-llm')",start);assert(start>=0&&end>start);
 await new AsyncFunction('el','document',source.slice(start,end))(el,document);
 assert.equal(background.expanded,false);assert.equal(modal.expanded,true);
});

import {state} from '../web/dist/state.js';
import {field,input,select,notice,icon,button,formFooter} from '../web/dist/components.js';
import {periodRow,financialFields} from '../web/dist/views-data.js';
const dataSource=ts.transpileModule(readFileSync(new URL('../web/views-data.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const editorStart=dataSource.indexOf('export function datasetEditor('),editorEnd=dataSource.indexOf('export function qualityPanel(',editorStart);
const renderEditor=new Function('state','field','input','select','notice','icon','button','formFooter','periodRow','financialFields','esc',dataSource.slice(editorStart,editorEnd).replace('export function','function')+';return datasetEditor;')(state,field,input,select,notice,icon,button,formFooter,periodRow,financialFields,value=>String(value??''));
test('returning from a new-dataset preview keeps company editable while persisted ownership stays locked',()=>{
 state.user={preferences:{amount_unit:'yuan'}};
 const draft={id:'',version:0,payload:{company:'草稿企业',name:'新台账',periods:[]}};
 const draftHtml=renderEditor(draft),persistedHtml=renderEditor({...draft,id:'saved-dataset',version:1});
 assert(!draftHtml.match(/name="company"[^>]*readonly/));assert(persistedHtml.match(/name="company"[^>]*readonly/));
 assert(!draftHtml.includes('不能通过修订更换'));assert(persistedHtml.includes('不能通过修订更换'));
});
