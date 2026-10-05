"""L12 API/compiled-renderer and adverse reader contracts, never native UI."""
from copy import deepcopy
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

from conftest import Actor
from in_process_oracle import offline_test_client
from server.app import make_app
from server.config import Settings
from scripts import product_action_evidence_journey as journey
from scripts import product_report_gap_reading as reading
from scripts.product_readout_oracles import _TEXT_GEOMETRY
from test_report_export_integrity import frozen_tables, original_export_bytes, assert_exports

ROOT = Path(__file__).resolve().parents[1]


class Element:
    def __init__(self, tag, attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def text(self):
        return ''.join(c if isinstance(c, str) else c.text() + ('\n' if c.tag == 'p' else '') for c in self.children).strip()

    def direct(self, tag):
        return [c for c in self.children if isinstance(c, Element) and c.tag == tag]

    def descendants(self, tag):
        return [n for c in self.children if isinstance(c, Element) for n in ([c] if c.tag == tag else []) + c.descendants(tag)]


class CompiledHTML(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Element('root')
        self.stack = [self.root]
        self.feed(html)
        assert self.stack == [self.root]

    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in ('br', 'input', 'img', 'meta', 'link', 'hr'):
            self.stack.append(node)

    def handle_endtag(self, tag):
        assert self.stack[-1].tag == tag
        self.stack.pop()

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def table_cells(table):
    headers = table.direct('thead')[0].direct('tr')[0].direct('th')
    assert all(h.attrs['scope'] == 'col' for h in headers)
    return [h.text() for h in headers], [[c.text() for c in row.direct('td')]
        for row in table.direct('tbody')[0].direct('tr')]


@pytest.fixture(scope='module')
def actual_original_report(tmp_path_factory):
    """The original UI-default request and original file, before any evidence."""
    with offline_test_client(lambda providers: make_app(Settings(
        data_dir=tmp_path_factory.mktemp('l12-gap-report'), origin='http://testserver'),
        providers=providers, worker_enabled=False)) as (client, providers, attempts):
        actor = Actor(client)
        def ok(response, status=200):
            assert response.status_code == status, response.text
            return response.json()
        assert ok(actor.get('/workspace/evidence'))['items'] == []
        template = actor.get('/import/template')
        assert template.status_code == 200
        blob = journey.fixture_csv(template.content)
        staged = ok(actor.post('/workspace/imports/file', data={'company': journey.COMPANY,
            'amount_unit': 'yuan', 'basis': 'standalone_quarter', 'target_id': '',
            'target_version': '0', 'merge_mode': 'replace'}, files={
                'file': (journey.FILE_NAME, blob, 'text/csv')}), 201)
        assert ok(actor.get('/datasets'))['items'] == []
        dataset = ok(actor.post('/workspace/imports/' + staged['id'] + '/commit', json={
            'version': staged['version'], 'fingerprint': staged['payload']['fingerprint']}), 201)
        plan = ok(actor.post('/workspace/plans', json={'dataset_id': dataset['id'],
            'query': journey.QUESTION, 'mode': 'operational', 'comparison': 'year_over_year',
            'use_llm': False, 'include_memory': True, 'execution': {'depth': 'balanced',
                'parallelism': 2, 'model_planning': False, 'local_recovery': True,
                'max_revisions': 1, 'total_context_chars': 72000, 'forecast': False,
                'forecast_metric': 'revenue', 'horizon': 2, 'role_providers': {}, 'fallback_providers': []}}), 201)
        assert plan['payload']['max_calls'] == 0 and plan['payload']['snapshot']['citations'] == []
        queued = ok(actor.post('/workspace/plans/' + plan['id'] + '/execute', json={
            'version': plan['version'], 'fingerprint': plan['payload']['fingerprint'],
            'external_consent': False}), 202)
        run = actor.execute(queued)
        plan = ok(actor.get('/workspace/plans/' + plan['id']))
        report = run['result']
        assert run['snapshot']['dataset'] == dataset['payload']
        assert report['dataset_hash'] == dataset['content_hash']
        assert report['readout']['facts'][0]['period'] == '2024-Q1'
        assert report['readout']['facts'][0]['value'] == .2
        assert report['llm']['state'] == 'not_requested' and report['llm']['calls'] == []
        assert [row['period'] for row in dataset['payload']['periods']] == ['2024-Q1', '2024-Q2']
        reading.expect_original_gap_report(run)
        store = client.app.state.store
        before, changes = frozen_tables(store), store.db.total_changes
        exports = original_export_bytes(store, run)
        rendered = subprocess.run(['node', '--input-type=module', '-e', """
            import fs from 'node:fs';
            import assert from 'node:assert/strict';
            import {adaptiveReport} from './web/dist/views-orchestrator.js';
            const report=JSON.parse(fs.readFileSync(0,'utf8')),before=JSON.stringify(report);
            const html=adaptiveReport(report);
            assert.equal(JSON.stringify(report),before);
            process.stdout.write(html);
        """], cwd=ROOT, input=json.dumps(report, ensure_ascii=False), text=True, capture_output=True, check=True).stdout
        tree = CompiledHTML(rendered).root
        section, = tree.direct('section')
        assert section.attrs['class'] == 'panel adaptive-results'
        gaps, = [n for n in section.direct('article') if n.attrs.get('data-math-kind') == 'gaps']
        gap_table = gaps.direct('div')[0].direct('table')[0]
        issue_tables = [n.direct('table')[0] for n in section.direct('div') if n.direct('table')]
        assert len(issue_tables) == 2  # counters, then issues; matches native selector
        columns, rows = table_cells(gap_table)
        issue_columns, issues = table_cells(issue_tables[1])
        assert columns == reading.GAP_COLUMNS and issue_columns == reading.ISSUE_COLUMNS
        assert gaps.direct('h3')[0].text() == '数据缺口与补充计划'
        assert section.direct('h3')[0].text() == '执行复盘与未达成条件'
        assert [n.direct('span')[0].text() for n in gaps.direct('div') if 'notice' in n.attrs.get('class', '')] == [reading.GAP_GUIDANCE]
        for box, original in [(gaps, report['adaptive']['mathematical_outputs']['gaps']),
                              (section, report['adaptive']['reflection'])]:
            details, = box.direct('details')
            assert 'open' not in details.attrs and json.loads(details.direct('pre')[0].text()) == original
        reading.expect_gap_cells(rows, issues)
        assert_exports(actor, run, exports)
        assert ok(actor.get('/runs/' + run['id'])) == run
        assert ok(actor.get('/workspace/plans/' + plan['id'])) == plan
        assert ok(actor.get('/datasets'))['items'] == [dataset]
        assert ok(actor.get('/workspace/evidence'))['items'] == []
        assert frozen_tables(store) == before and store.db.total_changes == changes
        assert providers.calls == attempts == []
        yield SimpleNamespace(run=run, rows=rows, issues=issues)


def test_actual_l12_import_plan_worker_and_compiled_renderer_preserve_every_saved_table(actual_original_report):
    reading.expect_original_gap_report(actual_original_report.run)
    reading.expect_gap_cells(actual_original_report.rows, actual_original_report.issues)


@pytest.mark.parametrize('damage', ['supplied_baseline', 'wrong_current', 'invented_input', 'zero_instead_of_null',
    'formula_changed', 'wrong_quality_period', 'citation_present', 'snapshot_citation_present', 'empty_list',
    'wrong_node_state', 'reason_added', 'auto_imputed'])
def test_original_report_oracle_rejects_substituted_saved_contract(actual_original_report, damage):
    run = deepcopy(actual_original_report.run)
    r = run['result']; a = r['analysis']; g = r['adaptive']['mathematical_outputs']['gaps']
    if damage == 'supplied_baseline': a['baseline_period'] = '2023-Q1'
    elif damage == 'wrong_current': a['current_period'] = '2024-Q2'
    elif damage == 'invented_input': a['series'][0]['lithium_price'] = 1
    elif damage == 'zero_instead_of_null': a['series'][0]['assets'] = 0
    elif damage == 'formula_changed': next(d for d in a['gmps']['dimensions'] if d['id'] == 'lithium')['formula'] = '修改公式'
    elif damage == 'wrong_quality_period': r['quality']['field_coverage']['period'] = '2024-Q2'
    elif damage == 'citation_present': r['citations'] = [{'id': 'later-document'}]
    elif damage == 'snapshot_citation_present': run['snapshot']['citations'] = [{'id': 'later-document'}]
    elif damage == 'empty_list': g['items'] = []
    elif damage == 'wrong_node_state': r['adaptive']['reflection']['issues'][1]['state'] = 'completed'
    elif damage == 'reason_added': r['adaptive']['reflection']['issues'][0]['reason'] = '另一个保存原因'
    elif damage == 'auto_imputed': g['items'][0]['auto_imputed'] = True
    with pytest.raises(AssertionError): reading.expect_original_gap_report(run)


@pytest.mark.parametrize('damage', ['internal_field', 'internal_node', 'internal_state', 'wrong_period',
    'invented_baseline', 'lost_formula', 'lost_current', 'lost_baseline', 'lost_action', 'moved_row',
    'short_reason', 'all_missing_data', 'no_evidence_limit', 'one_citation', 'lost_row'])
def test_reader_oracle_rejects_shortened_or_false_main_content(actual_original_report, damage):
    rows, issues = deepcopy(actual_original_report.rows), deepcopy(actual_original_report.issues)
    if damage == 'internal_field': rows[0][0] = 'assets'
    elif damage == 'internal_node': issues[0][0] = 'evidence'
    elif damage == 'internal_state': issues[1][1] = 'needs_input'
    elif damage == 'wrong_period': rows[0][1] = '已保存缺失期间：2024-Q2'
    elif damage == 'invented_baseline': rows[10][1] = rows[10][1].replace('期间未记录', '2023-Q1')
    elif damage == 'lost_formula': rows[10][1] = '\n'.join(rows[10][1].splitlines()[1:])
    elif damage == 'lost_current': rows[10][1] = '\n'.join(x for x in rows[10][1].splitlines() if not x.startswith('当前期'))
    elif damage == 'lost_baseline': rows[10][1] = '\n'.join(rows[10][1].splitlines()[:-1])
    elif damage == 'lost_action': rows[23][2] = '补充即可'
    elif damage == 'moved_row': rows[0], rows[1] = rows[1], rows[0]
    elif damage == 'short_reason': issues[1][2] = '查看对应产物'
    elif damage == 'all_missing_data': issues[1][2] = issues[1][2].replace('相关输入仍需核对或补充', '资料尚未补齐')
    elif damage == 'no_evidence_limit': issues[0][2] = issues[0][2].split('；')[0]
    elif damage == 'one_citation': issues[0][2] = issues[0][2].replace('0 条', '1 条')
    elif damage == 'lost_row': rows.pop()
    with pytest.raises(AssertionError): reading.expect_gap_cells(rows, issues)


def table_reader_double(*, damage=None):
    """Read-only geometry adapter with an actual wheel-dependent inner clip."""
    moved = 0
    seen, wheels, screenshots = [], [], []
    class Collection:
        def __init__(self, nodes): self.nodes = nodes
        def all(self): return self.nodes
        def count(self): return len(self.nodes)
    class Cell:
        def __init__(self, value): self.value = value
        def count(self): return 1
        def is_visible(self): return True
        def inner_text(self): return self.value.replace('\n', '\n\n')
        def text_content(self): return self.value.replace('\n', '')
        def get_attribute(self, name): return 'row' if damage == 'bad_header_scope' else 'col'
        def locator(self, selector):
            assert selector == 'svg, pre, details:not([open]), [hidden]'
            return Collection([self] if damage == 'hidden' else [])
        def scroll_into_view_if_needed(self): pass
        def evaluate(self, script, text):
            assert script == _TEXT_GEOMETRY and text == self.text_content()
            seen.append(text)
            overflow = self.value == reading.ISSUE_ROWS[1][2]
            right = 630 - moved if overflow else 580
            # Outer viewport extends to 900, but inner table ends at 600.
            return {'found': damage != 'missing_range', 'visible': right <= 600,
                'left': 100 - moved if overflow else 100, 'right': right, 'top': 200, 'bottom': 550,
                'clip': {'left': 50, 'right': 600, 'top': 100, 'bottom': 700},
                'root': {'left': 50, 'right': 600, 'top': 150, 'bottom': 600}}
    class Row:
        def __init__(self, values): self.cells = [Cell(v) for v in values]
        def locator(self, selector):
            assert selector == 'td'
            return Collection(self.cells)
    class Table:
        def locator(self, selector):
            if selector == 'thead th': return Collection([Cell(v) for v in reading.ISSUE_COLUMNS])
            assert selector == 'tbody tr'
            return Collection([Row(values) for values in reading.ISSUE_ROWS])
    def wheel(dx, dy):
        nonlocal moved
        wheels.append((dx, dy))
        if damage != 'clipped_without_motion': moved += dx
    p = SimpleNamespace(observations={}, step=lambda label, action: action(),
        screenshot=lambda name: screenshots.append(name) or name,
        page=SimpleNamespace(mouse=SimpleNamespace(move=lambda x, y: None, wheel=wheel), evaluate=lambda script: None))
    return p, Table(), seen, wheels, screenshots


def test_complete_cells_keep_header_row_binding_and_original_ancestor_clipped_ranges():
    p, table, seen, wheels, screenshots = table_reader_double()
    reading._read_table(p, table, reading.ISSUE_COLUMNS, dict(enumerate(reading.ISSUE_ROWS)), '原报告复盘')
    record, = p.observations['report_gap_table_readings']
    assert len(record['cells']) == len(p.observations['complete_text_groups']) == 9
    assert record['cells'][-1] == {'row': 2, 'row_name': '缺口补全规划',
        'column': '限制 / 原因与下一步', 'value': reading.ISSUE_ROWS[1][2], 'reading_index': 8}
    assert wheels == [(30, 0)] and len(screenshots) == 2
    assert reading.ISSUE_ROWS[1][2] in seen
    assert all(r['geometry']['visible'] and r['geometry']['clip']['right'] == 600 and r['screenshot']
               for r in p.observations['complete_text_groups'])
    assert record['manual_pixel_review'] == 'pending'


@pytest.mark.parametrize('damage', ['bad_header_scope', 'hidden', 'missing_range', 'clipped_without_motion'])
def test_reader_refuses_hidden_full_reason_or_stalled_native_scroll(damage):
    p, table, _, wheels, _ = table_reader_double(damage=damage)
    with pytest.raises(AssertionError):
        reading._read_table(p, table, reading.ISSUE_COLUMNS, dict(enumerate(reading.ISSUE_ROWS)), '被遮挡的复盘')
    assert not p.observations.get('report_gap_table_readings')
    if damage == 'clipped_without_motion':
        assert len(wheels) == 12
        assert all(r['text'] != reading.ISSUE_ROWS[1][2] for r in p.observations['complete_text_groups'])
