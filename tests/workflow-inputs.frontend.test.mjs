/** HTML/input contract checks only; native journeys run separately in CI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adaptiveOptions} from '../web/dist/views-orchestrator.js';
import {state,scopeQuery} from '../web/dist/state.js';

test('planning offers explicit strategy default without replacing explicit depth',()=>{
 const html=adaptiveOptions({providers:[]},'deep');
 assert.match(html,/value=""[^>]*>遵循已激活策略/);
 assert.match(html,/value="deep" selected/);
 const app=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');
 assert(app.includes("depth:str('depth')||null"));
});

test('local-only proposal permits zero external-call budget',()=>{
 const source=readFileSync(new URL('../web/copilot-ui.ts',import.meta.url),'utf8');
 assert.match(source,/input\('max_calls',Math\.min\(i\?\.payload\.max_calls\?\?3,3\),'type="number" min="0"/);
 assert(source.includes("depth:get('depth')||null"));
});

test('inactive math method fields are disabled and not parsed on submit',()=>{
 const view=readFileSync(new URL('../web/views-analysis.ts',import.meta.url),'utf8');
 const app=readFileSync(new URL('../web/app.ts',import.meta.url),'utf8');
 assert(view.includes('<fieldset id="forecast-fields" hidden disabled>'));
 assert(view.includes('<fieldset id="scenario-fields">'));
 assert(app.includes('fields.disabled=el.value!==kind'));
 assert(app.includes("if(payload.kind==='scenario')Object.assign(payload"));
});

test('scope query keeps explicit default identity distinct from omitted account-wide scope',()=>{
 state.identity='';state.active='';assert.equal(scopeQuery(),'?identity_id=&dataset_id=');
 state.identity='a&b';state.active='dataset';assert.equal(scopeQuery(),'?identity_id=a%26b&dataset_id=dataset');
});
