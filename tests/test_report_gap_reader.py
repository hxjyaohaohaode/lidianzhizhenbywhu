"""Real local worker -> existing report renderer; no browser or supplier calls."""
import json
import subprocess
from pathlib import Path
import pytest

from test_workspace_api import execute, plan
from test_business_provenance import ok
from test_report_export_integrity import frozen_tables, original_export_bytes, assert_exports

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('zero_volumes', [False, True])
def test_saved_gap_reader_matches_real_outputs_without_changing_exports(actor, example, zero_volumes):
    # Same missing-input shape observed in the 8bd native screenshot. These are
    # isolated synthetic test inputs, never runtime company data.
    for period in example['periods']:
        if zero_volumes:
            period['sales_volume'] = period['production_volume'] = 0
        else:
            for key in ('sales_volume', 'production_volume', 'lithium_price', 'manufacturing_cost', 'industry_volatility'):
                period[key] = None
    example['source_kind'] = 'user_provided'
    dataset = ok(actor.post('/datasets', json=example), 201)
    run = execute(actor, plan(actor, dataset, execution={}))
    report = run['result']
    gaps = report['adaptive']['mathematical_outputs']['gaps']
    assert {p['field'] for p in gaps['items']} == ({'gmps:unit_cost', 'gmps:sales_production'} if zero_volumes else {
        'sales_volume', 'production_volume', 'gmps:lithium', 'gmps:unit_cost',
        'gmps:sales_production', 'gmps:manufacturing', 'gmps:volatility'})
    assert [(i['node'], i['state'], i['reason']) for i in report['adaptive']['reflection']['issues']] == [
        ('evidence', 'missing', None), ('gaps', 'needs_input', None)]
    store = actor.client.app.state.store
    exports, tables, changes = original_export_bytes(store, run), frozen_tables(store), store.db.total_changes
    result = subprocess.run(['node', '--input-type=module', '-e', """
        import fs from 'node:fs';
        import assert from 'node:assert/strict';
        import {adaptiveReport} from './web/dist/views-orchestrator.js';
        const report=JSON.parse(fs.readFileSync(0,'utf8')),before=JSON.stringify(report);
        const html=adaptiveReport(report);
        assert.equal(JSON.stringify(report),before);
        process.stdout.write(html);
    """], cwd=ROOT, input=json.dumps(report, ensure_ascii=False), text=True, capture_output=True, check=True)
    html = result.stdout
    for expected in (f'已列出 {2 if zero_volumes else 7} 项待核对或补充事项', '引用为 0 条', '输入待核对或补充', '缺少所需资料或输入',
                     '相关输入仍需核对或补充', '经营数据', '证据资料'):
        assert expected in html
    if zero_volumes:
        assert report['quality']['field_coverage']['missing'] == []
        assert '销量 0（原填数量）' in html and '产量 0（原填数量）' in html
        assert '资料尚未补齐' not in html and '销量未提供' not in html
    else:
        for expected in ('当前期（2026-Q3）：锂价未提供', '指定基期（2025-Q3）：锂价未提供',
                         '已保存缺失期间：2026-Q3', '涉及：销量、产量'):
            assert expected in html
    assert '<td>evidence</td>' not in html and '<td>needs_input</td>' not in html
    assert '查看对应产物' not in html
    assert_exports(actor, run, exports)
    assert frozen_tables(store) == tables and store.db.total_changes == changes
    assert store.owned('runs', actor.user['id'], run['id']) == run
