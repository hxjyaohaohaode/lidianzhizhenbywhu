"""Actual offline API → compiled report; doubles test reading, never native pixels."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

from conftest import Actor
from in_process_oracle import offline_test_client
from server.app import make_app
from server.config import Settings
from scripts.recorded_balance_reading import expect_report_rows, read_report_rows
from scripts.product_readout_oracles import _TEXT_GEOMETRY
from scripts.service_browser_check import assert_copilot_entity_binding
from test_copilot_research_inputs import execute_proposal
from test_product_report_gap_reading import CompiledHTML, Element, table_cells
from test_services import ok, thread, message, proposal

ROOT = Path(__file__).resolve().parents[1]
PERIOD = '2024-Q2'
QUESTION = PERIOD + '总资产、总负债和资产负债率分别是多少'


@pytest.fixture(scope='module')
def actual_report(tmp_path_factory):
    with offline_test_client(lambda providers: make_app(Settings(
        data_dir=tmp_path_factory.mktemp('balance-report-reader'), origin='http://testserver'),
        providers=providers, worker_enabled=False)) as (client, providers, network):
        actor = Actor(client)
        dataset = ok(actor.post('/datasets', json={'company': '原报告阅读隔离合成企业', 'name': '原报告阅读',
            'amount_unit': 'yuan', 'currency': 'CNY', 'source_kind': 'user_provided',
            'periods': [{'period': p, 'revenue': 100000, 'cost': 60000, 'assets': a, 'liabilities': l}
                for p, a, l in [('2024-Q1', 450000, 180000), (PERIOD, 500000, 200000),
                                ('2024-Q3', 900000, 333000)]]}), 201)
        current = thread(actor, dataset)
        m = ok(message(actor, current, text=QUESTION), 201)['message']
        p = ok(proposal(actor, current, text=QUESTION, source_message_id=m['id'],
            use_llm=False, max_calls=0, execution={'depth': 'balanced', 'forecast': False}), 201)
        plan = ok(actor.get('/workspace/plans/' + p['payload']['plan_id']))
        prior = {row['id'] for row in ok(actor.get('/runs'))['items']}
        run = execute_proposal(actor, p)
        saved = ok(actor.get('/services/proposals/' + p['id']))
        assert_copilot_entity_binding(m, saved, plan, run, message_id=m['id'], proposal_id=p['id'],
            thread_id=current['id'], dataset_id=dataset['id'], prior_run_ids=prior)
        rendered = subprocess.run(['node', '--input-type=module', '-e', """
            import fs from 'node:fs';
            import assert from 'node:assert/strict';
            import {reportReadout} from './web/dist/report-readout.js';
            const report=JSON.parse(fs.readFileSync(0,'utf8')),before=JSON.stringify(report);
            const html=reportReadout(report);
            assert.equal(JSON.stringify(report),before);
            process.stdout.write(html);
        """], cwd=ROOT, input=json.dumps(run['result'], ensure_ascii=False), text=True,
            capture_output=True, check=True).stdout
        section, = CompiledHTML(rendered).root.direct('section')
        question, = [n for n in section.direct('p') if n.attrs.get('class') == 'preserve-lines']
        table = section.direct('div')[0].direct('table')[0]
        columns, rows = table_cells(table)
        case = SimpleNamespace(message=m, proposal_id=p['id'], run=run, dataset=dataset,
            question=question.text(), columns=columns, rows=rows, section=section, table=table)
        check(case)
        assert 'forecast' not in run['result']['adaptive']['mathematical_outputs']
        assert ok(actor.get('/runs/' + run['id'])) == run
        assert ok(actor.get('/datasets/' + dataset['id'])) == dataset
        assert providers.calls == network == []
        yield case


def check(case):
    expect_report_rows(case.question, case.columns, case.rows, case.message,
        case.run, case.dataset, period=PERIOD)


def test_actual_saved_new_run_and_compiled_report_bind_original_question_and_three_whole_rows(actual_report):
    check(actual_report)
    assert [row[:3] for row in actual_report.rows] == [
        [PERIOD, '资产负债率', '40%'], [PERIOD, '总资产', '50 万元'], [PERIOD, '总负债', '20 万元']]


@pytest.mark.parametrize('damage', ['question', 'columns', 'missing', 'duplicate', 'reorder', 'quarter',
    'number', 'unit', 'raw_ratio', 'formula_tail', 'source_number', 'source_unit', 'extra_text',
    'saved_question', 'saved_period', 'saved_duplicate', 'saved_value', 'saved_unit', 'saved_input',
    'saved_hash', 'saved_version', 'dataset_id', 'snapshot', 'amount_unit'])
def test_complete_report_oracle_rejects_wrong_or_partial_visible_and_saved_facts(actual_report, damage):
    c = deepcopy(actual_report)
    if damage == 'question': c.question = '2024-Q3总资产、总负债和资产负债率分别是多少'
    elif damage == 'columns': c.columns[2] = '技术记录'
    elif damage == 'missing': c.rows.pop()
    elif damage == 'duplicate': c.rows.append(c.rows[-1])
    elif damage == 'reorder': c.rows.reverse()
    elif damage == 'quarter': c.rows[1][0] = '2024-Q3'
    elif damage == 'number': c.rows[1][2] = '500000 万元'
    elif damage == 'unit': c.rows[1][2] = '50 元'
    elif damage == 'raw_ratio': c.rows[0][2] = '0.4'
    elif damage == 'formula_tail': c.rows[2][3] = c.rows[2][3].splitlines()[0]
    elif damage == 'source_number': c.rows[0][3] = c.rows[0][3].replace('20 万元', '21 万元')
    elif damage == 'source_unit': c.rows[0][3] = c.rows[0][3].replace('万元', '元')
    elif damage == 'extra_text': c.rows[2][2] += '以及错误尾注'
    elif damage == 'saved_question': c.run['result']['query'] = '另一个问题'
    elif damage == 'saved_period': c.run['result']['readout']['facts'][2]['period'] = '2024-Q3'
    elif damage == 'saved_duplicate': c.run['result']['readout']['facts'].append(c.run['result']['readout']['facts'][-1])
    elif damage == 'saved_value': c.run['result']['readout']['facts'][0]['value'] = 40
    elif damage == 'saved_unit': c.run['result']['readout']['facts'][1]['unit'] = 'USD'
    elif damage == 'saved_input': c.run['result']['readout']['facts'][0]['inputs'][0]['path'] = 'periods/2024-Q3/liabilities'
    elif damage == 'saved_hash': c.run['result']['readout']['input_source']['dataset_hash'] = '0' * 64
    elif damage == 'saved_version': c.run['result']['dataset_version'] += 1
    elif damage == 'dataset_id': c.run['dataset_id'] = 'other'
    elif damage == 'snapshot': c.run['snapshot']['dataset']['periods'][1]['assets'] = 1
    elif damage == 'amount_unit': c.run['result']['readout']['amount_unit'] = 'yuan'
    with pytest.raises(AssertionError): check(c)


def test_producer_display_strings_cannot_supply_expected_reader_numbers(actual_report):
    c = deepcopy(actual_report)
    for fact in c.run['result']['readout']['facts']:
        fact['display_value'] = 'wrong'
        for value in fact['inputs']: value['display_value'] = 'wrong'
    check(c)
    c.rows[1][2] = 'wrong'
    with pytest.raises(AssertionError): check(c)


def reader_double(case, damage=None):
    """Use actual compiled nodes; synthetic clip physics is not a browser pass."""
    question = [n for n in case.section.direct('p') if n.attrs.get('class') == 'preserve-lines'][0]
    header = case.table.direct('thead')[0]
    rows = case.table.direct('tbody')[0].direct('tr')
    groups = [question, header, *rows]
    offset = 0
    frames, wheels, ranges, events = [], [], [], []

    def content(node):
        return ''.join(child if isinstance(child, str) else content(child) for child in node.children)

    class Locator:
        def __init__(self, nodes): self.nodes = nodes
        @property
        def first(self): return Locator(self.nodes[:1])
        def count(self): return len(self.nodes)
        def all(self): return [Locator([node]) for node in self.nodes]
        def all_text_contents(self): return [content(node) for node in self.nodes]
        def inner_text(self): return self.nodes[0].text()
        def text_content(self): return content(self.nodes[0])
        def is_visible(self): return damage != 'closed' or self.nodes[0] is not rows[-1]
        def locator(self, selector):
            if selector == ':scope > p.preserve-lines': return Locator([question])
            if selector == ':scope > .table-scroll > table': return Locator([case.table])
            if selector == 'tbody tr': return Locator(rows + rows[-1:] if damage == 'duplicate' else rows)
            if selector == 'thead': return Locator([header])
            if selector == 'thead th': return Locator(header.descendants('th'))
            if selector == 'td': return Locator(self.nodes[0].direct('td'))
            assert selector == 'svg, pre, details:not([open]), [hidden]'
            return Locator([Element('pre')] if damage == 'hidden_json' and self.nodes[0] is rows[-1] else [])
        def scroll_into_view_if_needed(self):
            nonlocal offset
            offset = groups.index(self.nodes[0]) * 140 - 70
        def evaluate(self, script, text):
            assert script == _TEXT_GEOMETRY and text == content(self.nodes[0]).strip()
            ranges.append(text)
            top = groups.index(self.nodes[0]) * 140 - offset
            bottom = top + 110
            return {'found': damage != 'missing_range', 'visible': top >= 100 and bottom <= 650,
                'left': 350, 'right': 1380, 'top': top, 'bottom': bottom,
                'clip': {'left': 320, 'right': 1424, 'top': 100, 'bottom': 650},
                'root': {'left': 350, 'right': 1380, 'top': max(top, 100), 'bottom': min(bottom, 650)}}

    def wheel(dx, dy):
        nonlocal offset
        wheels.append((dx, dy))
        if damage != 'stalled': offset += dy

    def settle(script):
        assert script == '() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'

    def screenshot(name, *, full_page):
        assert full_page is False
        frames.append(name)

    observations = {'complete_text_groups': [{'prior_source_record': True}]}
    page = SimpleNamespace(mouse=SimpleNamespace(move=lambda x, y: None, wheel=wheel), evaluate=settle)
    def read():
        read_report_rows(page, Locator([case.section]), case.message, case.run, case.dataset,
            period=PERIOD, proposal_id=case.proposal_id, screenshot=screenshot, observations=observations,
            emit=lambda kind, **values: events.append((kind, values)))
    return read, observations, frames, wheels, ranges, events, [content(node).strip() for node in groups]


def test_entire_question_headings_and_each_fact_enter_clip_before_original_frame(actual_report):
    read, observations, frames, wheels, ranges, events, texts = reader_double(actual_report)
    read()
    record, = observations['recorded_balance_reports']
    assert record['reading_indices'] == [1, 2, 3, 4, 5]
    assert record['message_id'] == actual_report.message['id'] and record['proposal_id'] == actual_report.proposal_id
    assert record['run_id'] == actual_report.run['id'] and record['plan_id'] == actual_report.run['snapshot']['studio']['plan_id']
    assert record['original_question'] == QUESTION and record['report_question'] == actual_report.question
    assert record['fact_rows'] == actual_report.rows
    readings = observations['complete_text_groups'][1:]
    assert [r['text'] for r in readings] == texts and set(ranges) == set(texts)
    assert all(r['geometry']['visible'] and r['screenshot'] in frames and r['manual_pixel_review'] == 'pending' for r in readings)
    assert frames and all(name.startswith('ui-current-recorded-balance-report-reader-') and name.endswith('.png') for name in frames)
    assert wheels and all(delta == (0, -280) for delta in wheels)
    assert [kind for kind, _ in events] == ['balance_report_read_started', 'balance_report_read_completed']


@pytest.mark.parametrize('damage', ['closed', 'hidden_json', 'missing_range', 'stalled', 'duplicate'])
def test_hidden_json_clipped_stalled_or_duplicate_rows_cannot_finish_report_reading(actual_report, damage):
    read, observations, frames, wheels, _, events, _ = reader_double(actual_report, damage)
    with pytest.raises(AssertionError): read()
    assert not observations.get('recorded_balance_reports')
    assert 'balance_report_read_completed' not in [kind for kind, _ in events]
    if damage == 'stalled': assert len(wheels) == 12 and not frames
