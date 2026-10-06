"""Real protected API -> compiled reader/listeners; no browser or providers."""
import json
from pathlib import Path
import subprocess

import pytest

from conftest import Actor
from test_services import ok, thread, proposal
from test_copilot_research_inputs import execute_proposal

ROOT = Path(__file__).resolve().parents[1]
RAWS = [
    '\r\n{"label":"毛利率","value":900719925474099312345,"decimal":-0.0000e+07,"escaped":"\\r\\n\\u6bdb\\\"","emoji":"🔬","html":"<img src=x onerror=bad()>"}\r\n',
    '{\r\n"label":"毛利率","value":987654321, "broken":"\\uNOPE',
    'not JSON at all 毛利率 987654321\r\n',
    '"毛利率 JSON string root"',
    '',
]


@pytest.mark.parametrize('raw', RAWS)
def test_exact_raw_from_owned_snapshot_through_compiled_reader_and_download(actor, raw):
    dataset = actor.dataset()
    t = thread(actor, dataset)
    p = ok(proposal(actor, t, text='核查毛利率', use_llm=False, max_calls=0), 201)
    run = execute_proposal(actor, p)
    foreign = Actor(actor.client)
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE runs SET result=? WHERE id=?', (raw, run['id']))
    before = '\n'.join(store.db.iterdump())
    changes = store.db.total_changes
    response = actor.get('/services/threads/' + t['id'])
    loaded = ok(response)
    card = next(r for r in loaded['runs'] if r['id'] == run['id'])
    audit = ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    reviews = ok(actor.get('/workspace/runs/' + run['id'] + '/reviews'))
    runtime = None if 'report_record_unreadable' in audit['report_integrity']['failures'] else ok(actor.get('/workspace/runs/' + run['id'] + '/runtime'))
    p = ok(actor.get('/services/proposals/' + p['id']))
    assert card['result'] is None and card['report_availability']['status'] == 'unavailable'
    assert card['unverified_report']['raw'] == audit['unverified_report']['raw'] == raw
    assert not audit['report_integrity']['valid']
    assert run['result']['llm']['calls'] == []
    assert foreign.get('/workspace/runs/' + run['id'] + '/audit').status_code == 404
    assert foreign.get('/workspace/runs/' + run['id'] + '/reviews').status_code == 404
    assert foreign.get('/services/threads/' + t['id']).status_code == 404
    for format in ('md', 'json'):
        blocked = actor.get('/runs/' + run['id'] + '/export?format=' + format)
        assert blocked.status_code == 409
    result = subprocess.run(['node', '--input-type=module', '-e', '''
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      import {state} from './web/dist/state.js';
      import {reader,init,harness,downloaded} from './tests/unverified-reader-harness.mjs';
      globalThis.setInterval=()=>0;
      const {proposalCard}=await import('./web/dist/copilot-ui.js');
      const {runPage}=await import('./web/dist/views-studio.js');
      const data=JSON.parse(fs.readFileSync(0,'utf8'));init();
      globalThis.fetch=async(url,options)=>{assert.equal(options.method,'GET');return new Response(JSON.stringify(url.endsWith('/audit')?data.audit:url.endsWith('/reviews')?data.reviews:url.endsWith('/runtime')?data.runtime:{capabilities:[]}),{headers:{'content-type':'application/json'}});};
      const html=await runPage(data.card.id),chat=proposalCard(data.proposal,[data.card]);
      for(const shown of [html,chat]){
        assert(shown.includes('data-unverified-report-raw'));assert(shown.includes('data-raw-query'));
        assert(shown.includes('下载未核验原始文本'));assert(!shown.includes('/export?format='));
        assert(!shown.includes('data-report-readout'));assert(!shown.includes('data-action="action-from-report"'));
      }
      const h=harness(data.card.unverified_report.raw,data.card.id);h.search('毛利率',true);
      if(data.raw.includes('毛利率'))assert(h.excerpt().includes('毛利率'));else assert(h.status().includes('未找到'));
      const downloadedRaw=await downloaded(h);assert.deepEqual(downloadedRaw.bytes,Buffer.from(data.raw,'utf8'));
      assert.equal(state.dirty,false);process.stdout.write(JSON.stringify({bytes:downloadedRaw.bytes.length,raw:downloadedRaw.bytes.toString('base64')}));
    '''], cwd=ROOT, input=json.dumps({'raw': raw, 'card': card, 'audit': audit, 'reviews': reviews, 'runtime': runtime, 'proposal': p}),
        text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    import base64
    assert base64.b64decode(json.loads(result.stdout)['raw']) == raw.encode('utf-8')
    assert '\n'.join(store.db.iterdump()) == before
    assert store.db.total_changes == changes


def test_nontext_saved_result_never_claims_reserialized_original(actor):
    dataset = actor.dataset(); t = thread(actor, dataset)
    p = ok(proposal(actor, t, text='核查毛利率', use_llm=False, max_calls=0), 201)
    run = execute_proposal(actor, p)
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute('UPDATE runs SET result=? WHERE id=?', (b'not guaranteed original UTF-8\xff', run['id']))
    changes = store.db.total_changes
    card = ok(actor.get('/services/threads/' + t['id']))['runs'][0]
    audit = ok(actor.get('/workspace/runs/' + run['id'] + '/audit'))
    for response in (card, audit):
        assert response['unverified_report']['raw'] is None
        assert '无法提供原字节' in response['unverified_report']['notice']
        assert response['report_integrity']['valid'] is False
    assert store.db.total_changes == changes
