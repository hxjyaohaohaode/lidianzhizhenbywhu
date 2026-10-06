"""Actual offline API → compiled source rows; geometry doubles are not native UI."""
from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

from conftest import Actor
from in_process_oracle import offline_test_client
from server.app import make_app
from server.config import Settings
from scripts.recorded_balance_reading import expect_source_row, read_source_row
from scripts.service_browser_check import assert_copilot_trace_binding
from scripts.product_readout_oracles import _TEXT_GEOMETRY
from test_copilot_message_trace import trace
from test_product_report_gap_reading import CompiledHTML
from test_services import ok, thread, message

ROOT = Path(__file__).resolve().parents[1]


def nodes_with_class(root, tag, name):
    return [n for n in root.descendants(tag) if name in n.attrs.get('class', '').split()]


@pytest.fixture(scope='module')
def rendered_sources(tmp_path_factory):
    with offline_test_client(lambda providers: make_app(Settings(
        data_dir=tmp_path_factory.mktemp('balance-source-reader'), origin='http://testserver'),
        providers=providers, worker_enabled=False)) as (client, providers, network):
        actor = Actor(client)
        cases = []
        for name, assets, liabilities in [('ordinary', 500000., 200000.), ('zero', 0., 0.), ('subcent', .004, .001)]:
            payload = {'company': '原字段阅读合成企业 ' + name, 'name': '隔离原始单位测试',
                'amount_unit': 'yuan', 'currency': 'CNY', 'source_kind': 'user_provided',
                'periods': [{'period': period, 'revenue': 100000., 'cost': 60000.,
                    'assets': a, 'liabilities': l} for period, a, l in [
                        ('2024-Q1', 450000., 180000.), ('2024-Q2', assets, liabilities), ('2024-Q3', 900000., 333000.)]]}
            dataset = ok(actor.post('/datasets', json=payload), 201)
            current = thread(actor, dataset)
            m = ok(message(actor, current, text='2024-Q2总资产、总负债和资产负债率分别是多少'), 201)['message']
            traced = ok(trace(actor, current, m))
            assert m['payload']['response']['external_calls'] == traced['external_calls'] == 0
            assert [f['id'] for f in m['payload']['response']['facts']] == ['leverage', 'assets', 'liabilities']
            assert traced['source_message_id'] == m['id'] and traced['source_thread_id'] == current['id']
            assert_copilot_trace_binding(m, traced, dataset, message_id=m['id'], thread_id=current['id'])
            data = {'message': m, 'trace': traced}
            rendered = subprocess.run(['node', '--input-type=module', '-e', """
                import fs from 'node:fs';
                import assert from 'node:assert/strict';
                globalThis.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
                const original=setInterval;globalThis.setInterval=()=>0;
                const {messageView}=await import('./web/dist/copilot-ui.js');globalThis.setInterval=original;
                const {assistantView}=await import('./web/dist/assistant.js');
                const data=JSON.parse(fs.readFileSync(0,'utf8')),before=JSON.stringify(data);
                const html={service:messageView(data.message),trace:assistantView(data.message.payload.question,data.trace)};
                assert.equal(JSON.stringify(data),before);
                process.stdout.write(JSON.stringify(html));
            """], cwd=ROOT, input=json.dumps(data, ensure_ascii=False), text=True, capture_output=True, check=True)
            html = json.loads(rendered.stdout)
            for renderer, class_name, response in [('service', 'fact-tile', m['payload']['response']),
                                                  ('trace', 'assistant-fact', traced)]:
                tree = CompiledHTML(html[renderer]).root
                tiles = nodes_with_class(tree, 'article', class_name)
                assert len(tiles) == 3
                for position, key, raw in [(1, 'assets', assets), (2, 'liabilities', liabilities)]:
                    tile = tiles[position]
                    basis, = tile.direct('details')
                    assert 'open' not in basis.attrs  # Parsing HTML is not a visibility assertion.
                    row, = (basis.direct('div') if renderer == 'service' else basis.direct('ul')[0].direct('li'))
                    code, = row.direct('code'); amount, = row.direct('span')
                    assert code.text() == f'periods/2024-Q2/{key}'
                    assert Decimal(amount.text().removesuffix(' 元').replace(',', '')) == Decimal(str(raw))
                    fact = response['facts'][position]
                    bound = expect_source_row(code.text(), amount.text(), fact, dataset, period='2024-Q2', key=key)
                    assert bound['raw_CNY'] == raw and 'CNY' not in row.text()
                    cases.append({'name': name, 'renderer': renderer, 'path': code.text(), 'amount': amount.text(),
                                  'fact': deepcopy(fact), 'dataset': deepcopy(dataset), 'message_id': m['id'],
                                  'message': deepcopy(m), 'trace_response': deepcopy(traced)})
            assert ok(actor.get('/datasets/' + dataset['id'])) == dataset
            saved = ok(actor.get('/services/threads/' + current['id']))
            assert next(row for row in saved['messages'] if row['id'] == m['id'])['payload'] == m['payload']
        assert providers.calls == network == []
        yield cases


def test_actual_api_cny_is_read_as_explicit_yuan_in_both_compiled_renderers(rendered_sources):
    assert len(rendered_sources) == 12
    for case in rendered_sources:
        expect_source_row(case['path'], case['amount'], case['fact'], case['dataset'],
                          period='2024-Q2', key=case['fact']['id'])


@pytest.mark.parametrize('damage', ['source_message_id', 'source_thread_id', 'dataset', 'version', 'hash',
    'scope_period', 'question_period', 'comparison', 'topics', 'missing_fact', 'fact_version', 'external_call'])
def test_this_trace_response_cannot_borrow_saved_message_or_another_revision_metadata(rendered_sources, damage):
    case = deepcopy(rendered_sources[0]); traced = case['trace_response']
    if damage in ('source_message_id', 'source_thread_id'): traced[damage] = 'different'
    elif damage == 'dataset': traced['scope']['dataset_id'] = 'different'
    elif damage == 'version': traced['scope']['dataset_version'] += 1
    elif damage == 'hash': traced['scope']['input_hash'] = '0' * 64
    elif damage == 'scope_period': traced['scope']['period'] = '2024-Q3'
    elif damage == 'question_period': traced['question_scope']['period'] = '2024-Q3'
    elif damage == 'comparison': traced['question_scope']['comparison'] = 'previous'
    elif damage == 'topics': traced['question_scope']['topics'].reverse()
    elif damage == 'missing_fact': traced['facts'].pop()
    elif damage == 'fact_version': traced['facts'][1]['dataset_version'] += 1
    elif damage == 'external_call': traced['external_calls'] = 1
    with pytest.raises(AssertionError):
        assert_copilot_trace_binding(case['message'], traced, case['dataset'],
            message_id=case['message_id'], thread_id=case['message']['thread_id'])


@pytest.mark.parametrize('path,amount', [
    ('periods/2024-Q1/assets', '500,000 元'), ('periods/2024-Q2/liabilities', '500,000 元'),
    ('periods/2024-Q2/assets/wrong', '500,000 元'), ('periods/2024-Q2/assets', '499,999 元'),
    ('periods/2024-Q2/assets', '0 元'), ('periods/2024-Q2/assets', '50 万元'),
    ('periods/2024-Q2/assets', '0.005 亿元'), ('periods/2024-Q2/assets', '500,000 USD'),
    ('periods/2024-Q2/assets', '500,000%'), ('periods/2024-Q2/assets', '500,000'),
    ('periods/2024-Q2/assets', '500,00 元'), ('periods/2024-Q2/assets', '500,000 元以及错误尾注'),
])
def test_whole_source_row_oracle_rejects_wrong_path_number_unit_or_incomplete_text(rendered_sources, path, amount):
    case = rendered_sources[0]
    with pytest.raises(AssertionError):
        expect_source_row(path, amount, case['fact'], case['dataset'], period='2024-Q2', key='assets')


@pytest.mark.parametrize('damage', ['value', 'unit', 'period', 'dataset_id', 'version', 'hash',
                                   'input_path', 'input_unit', 'input_value', 'dataset_currency', 'dataset_unit'])
def test_original_api_source_contract_is_not_weakened(rendered_sources, damage):
    case = deepcopy(rendered_sources[0]); fact, dataset = case['fact'], case['dataset']
    if damage == 'value': fact['value'] = 50.
    elif damage == 'unit': fact['unit'] = 'USD'
    elif damage == 'period': fact['period'] = '2024-Q3'
    elif damage == 'dataset_id': fact['dataset_id'] = 'different'
    elif damage == 'version': fact['dataset_version'] += 1
    elif damage == 'hash': fact['input_hash'] = '0' * 64
    elif damage == 'input_path': fact['inputs'][0]['path'] = 'periods/2024-Q3/assets'
    elif damage == 'input_unit': fact['inputs'][0]['unit'] = 'wan'
    elif damage == 'input_value': fact['inputs'][0]['value'] = 50.
    elif damage == 'dataset_currency': dataset['payload']['currency'] = 'USD'
    elif damage == 'dataset_unit': dataset['payload']['amount_unit'] = 'wan'
    with pytest.raises(AssertionError):
        expect_source_row(case['path'], case['amount'], fact, dataset, period='2024-Q2', key='assets')


def test_producer_display_strings_do_not_define_the_expected_original_amount(rendered_sources):
    case = deepcopy(rendered_sources[0]); fact = case['fact']
    fact.update(display_value='wrong', source_display_value='wrong', input_display_values={case['path']: 'wrong'})
    bound = expect_source_row(case['path'], '500000 人民币元', fact, case['dataset'], period='2024-Q2', key='assets')
    assert bound['raw_CNY'] == 500000
    with pytest.raises(AssertionError):
        expect_source_row(case['path'], '0 元', fact, case['dataset'], period='2024-Q2', key='assets')


def reader_double(case, *, damage=None):
    """Clipped row physics only. No real browser or pixel pass is represented."""
    moved = 0
    frames, wheels, events, ranges = [], [], [], []
    class Text:
        def __init__(self, text): self.text = text
        def count(self): return 1
        def inner_text(self): return self.text
    class Row:
        def count(self): return 1
        def is_visible(self): return damage != 'closed'
        def locator(self, selector):
            if selector == ':scope > code': return Text(case['path'])
            if selector == ':scope > span': return Text(case['amount'])
            assert selector == 'svg, pre, details:not([open]), [hidden]'
            return SimpleNamespace(count=lambda: int(damage == 'hidden_child'))
        def inner_text(self): return case['path'] + '\n' + case['amount']
        def text_content(self): return case['path'] + case['amount']
        def scroll_into_view_if_needed(self): pass
        def evaluate(self, script, text):
            assert script == _TEXT_GEOMETRY and text == self.text_content()
            ranges.append(text)
            top, bottom = 860 - moved, 940 - moved
            return {'found': damage != 'missing_range', 'visible': top >= 377 and bottom <= 888,
                'left': 720, 'right': 1000, 'top': top, 'bottom': bottom,
                'clip': {'left': 322, 'right': 1424, 'top': 377, 'bottom': 888},
                'root': {'left': 720, 'right': 1000, 'top': max(top, 377), 'bottom': min(bottom, 888)}}
    def wheel(dx, dy):
        nonlocal moved
        wheels.append((dx, dy))
        if damage != 'stalled': moved += dy
    def settle(script):
        assert script == '() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    page = SimpleNamespace(mouse=SimpleNamespace(move=lambda x, y: None, wheel=wheel), evaluate=settle)
    def screenshot(name, *, full_page):
        assert full_page is False and moved > 0
        frames.append(name)
    observations = {}
    def run():
        read_source_row(page, Row(), case['fact'], case['dataset'], period='2024-Q2', key='assets',
            renderer=case['renderer'], message_id=case['message_id'], screenshot=screenshot,
            observations=observations, emit=lambda kind, **values: events.append(kind))
    return run, observations, frames, wheels, events, ranges


def test_source_path_full_amount_and_yuan_must_enter_actual_ancestor_clip_before_snapshot(rendered_sources):
    case = rendered_sources[0]
    run, observations, frames, wheels, events, ranges = reader_double(case)
    run()
    assert wheels == [(0, 280)]
    assert frames == ['ui-current-recorded-balance-source-service-assets-reader-1.png']
    record, = observations['recorded_balance_sources']
    assert record['message_id'] == case['message_id'] and record['reading_index'] == 0
    assert record['path'] == case['path'] and record['raw_CNY'] == 500000
    read, = observations['complete_text_groups']
    assert read['required'] == [case['path'], case['amount']]
    assert read['text'] == case['path'] + case['amount'] and set(ranges) == {read['text']}
    assert read['geometry']['visible'] and read['geometry']['clip']['bottom'] == 888
    assert read['screenshot'] == frames[0] and read['manual_pixel_review'] == 'pending'
    assert events == ['balance_source_read_started', 'balance_source_read_completed']


@pytest.mark.parametrize('damage', ['closed', 'hidden_child', 'missing_range', 'stalled'])
def test_present_dom_text_cannot_pass_a_closed_clipped_or_unmoved_source_row(rendered_sources, damage):
    run, observations, frames, wheels, events, _ = reader_double(rendered_sources[0], damage=damage)
    with pytest.raises(AssertionError): run()
    assert not observations.get('recorded_balance_sources') and not observations.get('complete_text_groups')
    assert not frames and 'balance_source_read_completed' not in events
    if damage == 'stalled': assert wheels == [(0, 280)] * 12
