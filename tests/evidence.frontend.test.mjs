/** Pure rendering contracts, not a native-browser claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceScope,evidenceMetadataForm,reviewEvidenceForm} from '../web/dist/views-data.js';

test('company evidence capture does not default to global consent',()=>{
 const html=evidenceScope('甲企业');
 assert.match(html,/value="甲企业"/);
 assert.match(html,/name="global_scope" type="checkbox" >/);
 assert(!html.includes(' checked'));
 assert.match(evidenceScope('',true),/type="checkbox" checked/);
});
test('evidence metadata editor escapes fields and carries optimistic version',()=>{
 const html=evidenceMetadataForm({id:'abc',version:7,payload:{title:'<script>unsafe</script>',source_url:'https://example.com',published_at:'2025-01-01'}});
 assert.match(html,/data-version="7"/);assert(!html.includes('<script>'));
 assert(!html.includes('name="verification"'));assert(!html.includes('name="text"'));
});
test('review form preserves explicit global choice and company scope',()=>{
 const html=reviewEvidenceForm({id:'abc',review_version:2,payload:{title:'title'},review:{company:'甲企业',global_scope:false,status:'unreviewed',tags:[],stance:'context'}});
 assert.match(html,/data-version="2"/);assert(!html.includes('type="checkbox" checked'));
});
