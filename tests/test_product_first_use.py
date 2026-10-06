"""Pure L1 oracle tests; no browser, server, listener, or API request."""
import ast
import copy
import csv
import io
import json
from pathlib import Path
import unittest
import pytest
from scripts import product_first_use_audit as draft

ROOT = Path(__file__).resolve().parents[1] / 'scripts'

class PureFirstUseTests(unittest.TestCase):
    def template(self):
        return (','.join(draft.HEADERS) + '\n').encode('utf-8-sig')


    def test_handoff_accepts_full_scope_bound_original_query(self):
        query = '核查范围：2024-Q1，同比，毛利率、经营现金流。\n当前目标：' + draft.QUESTION
        self.assertEqual(draft.expect_handoff_query(query), query)
        extended = query.replace('毛利率、经营现金流。', '毛利率、经营现金流、经营现金收入比。')
        self.assertEqual(draft.expect_handoff_query(extended), extended)
        for changed in (draft.QUESTION, query.replace('2024-Q1', '2024-Q2', 1), query.replace('毛利率、经营现金流', '毛利率')):
            with self.subTest(changed=changed), self.assertRaises(AssertionError):
                draft.expect_handoff_query(changed)

    def test_l1_never_repairs_handoff_by_filling_plan_query(self):
        tree = ast.parse((ROOT / 'product_first_use_audit.py').read_text())
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'l1_new_user_report')
        fills = [n for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'fill']
        self.assertFalse(any(n.args and isinstance(n.args[0], ast.Constant) and '#plan-form' in str(n.args[0].value) for n in fills))

    def test_header_only_accepts_bom(self):
        self.assertEqual(draft.csv_headers(self.template()), draft.HEADERS)

    def test_template_rejects_prepopulated_values(self):
        with self.assertRaises(AssertionError):
            draft.csv_headers(self.template() + b'2024-Q1,10,8\n')


    def test_report_validator_does_not_equate_analysis_and_creation_dates(self):
        source = (ROOT / 'product_first_use_audit.py').read_text()
        fn = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == 'expect_report')
        assertions = [ast.get_source_segment(source, n) for n in ast.walk(fn) if isinstance(n, ast.Assert)]
        self.assertFalse(any("r['quality']['as_of'] == r['created_at']" in assertion for assertion in assertions))
        self.assertTrue(any("r['quality']['as_of'] == s['analysis_as_of']" in assertion for assertion in assertions))

    def test_template_rejects_unreviewed_header(self):
        with self.assertRaises(AssertionError):
            draft.csv_headers(b'period,revenue,cost\n')

    def test_edit_changes_only_target_cost_cell(self):
        rows = [list(csv.reader(io.StringIO(draft.synthetic_csv(self.template(), corrected=x).decode('utf-8-sig')))) for x in (False, True)]
        changes = [(i, j, a, b) for i, (left, right) in enumerate(zip(*rows)) for j, (a, b) in enumerate(zip(left, right)) if a != b]
        self.assertEqual(changes, [(1, 2, '9', '8')])
        self.assertEqual([r[4] for r in rows[1][1:]], ['', ''])
        self.assertEqual([r[0] for r in rows[1][1:]], list(draft.PERIODS))
        self.assertEqual([r[10] for r in rows[1][1:]], ['100', '110'])




    def test_integrity_validator_checks_hashes_anchors_and_nonempty_artifacts(self):
        valid = {'report_integrity': {'valid': True, 'format': 'studio'}, 'ledger': {'valid': True},
            'data_hash_valid': True, 'snapshot_hash_valid': True, 'report_hash_valid': True,
            'artifacts': [{'integrity_valid': True, 'event_anchor_valid': True}]}
        draft.expect_integrity(valid)
        for key in ('data_hash_valid', 'snapshot_hash_valid', 'report_hash_valid'):
            invalid = copy.deepcopy(valid); invalid[key] = False
            with self.assertRaises(AssertionError): draft.expect_integrity(invalid)
        invalid = copy.deepcopy(valid); invalid['artifacts'][0]['event_anchor_valid'] = False
        with self.assertRaises(AssertionError): draft.expect_integrity(invalid)
        invalid = copy.deepcopy(valid); invalid['artifacts'] = []
        with self.assertRaises(AssertionError): draft.expect_integrity(invalid)

    def test_markdown_reads_actual_json_fences_and_null(self):
        blocks = [{'current_period': '2024-Q1', 'cash_ratio': None, 'gross_margin': .2}, [{'path': 'periods/2024-Q1/cost', 'value': 80000, 'unit': 'CNY'}]]
        md = '\n\n'.join('```json\n' + json.dumps(x) + '\n```' for x in blocks)
        self.assertEqual(draft.markdown_json_blocks(md), blocks)
        with self.assertRaises(json.JSONDecodeError): draft.markdown_json_blocks('```json\nnot-json\n```')

    def test_canonical_hash_is_order_independent_and_preserves_null(self):
        self.assertEqual(draft.canonical_hash({'a': 1, 'b': None}), draft.canonical_hash({'b': None, 'a': 1}))
        self.assertNotEqual(draft.canonical_hash({'b': None}), draft.canonical_hash({'b': 0}))

    def test_import_has_no_browser_or_product_dependency(self):
        tree = ast.parse((ROOT / 'product_first_use_audit.py').read_text())
        names = [node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
        self.assertFalse(any(name and name.startswith(('playwright', 'server')) for name in names))
        source = (ROOT / 'product_first_use_audit.py').read_text()
        self.assertNotIn('.evaluate(', source)
        self.assertNotIn('.request.post(', source)
        self.assertNotIn('.launch(', source)
        self.assertNotIn('.set_content(', source)
        self.assertEqual(source.count('.goto('), 1)  # Initial authorized origin only.

if __name__ == '__main__':
    unittest.main(verbosity=2)


def report_contract():
    """Independent tiny schema fixture; never an application report or worker."""
    data = {'company': draft.COMPANY, 'currency': 'CNY', 'amount_unit': 'yuan',
        'input_amount_unit': 'wan', 'period_basis': 'standalone_quarter',
        'verification': 'unverified_user_input', 'source_kind': 'user_provided', 'source_url': '',
        'periods': [{'period': q, 'revenue': revenue, 'cost': cost, 'cash_flow': None,
            'sales_volume': volume, 'lithium_price': price} for q, revenue, cost, volume, price in
            [('2024-Q1', 100000, 80000, 100, 100000), ('2024-Q2', 120000, 100000, 110, 110000)]]}
    saved = {'id': 'pure-dataset', 'version': 1, 'content_hash': draft.canonical_hash(data), 'payload': data}
    query = '核查范围：2024-Q1，同比，毛利率、经营现金流、经营现金收入比。\n当前目标：' + draft.QUESTION
    snapshot = {'dataset': data, 'analysis_as_of': '2026-10-04', 'identity': {'id': 'pure-identity'}}
    result = {'dataset_id': saved['id'], 'query': query, 'dataset_version': 1,
        'dataset_hash': saved['content_hash'], 'snapshot_hash': draft.canonical_hash(snapshot),
        'analysis': {'current_period': '2024-Q1', 'metrics': {'cash_ratio': None, 'gross_margin': .2}},
        'research_scope': {'period': '2024-Q1'}, 'llm': {'state': 'not_requested', 'calls': [], 'review': {'claims': []}},
        'citations': [], 'quality': {'as_of': '2026-10-04', 'field_coverage': {'missing': ['cash_flow']}},
        'created_at': '2026-10-05T00:00:01Z', 'warnings': ['cash_flow missing'], 'limitations': ['No prior quarter'],
        'lineage': [{'id': 'gross_margin', 'formula': '(收入−成本)/收入', 'period': '2024-Q1', 'inputs': [
            {'path': 'periods/2024-Q1/revenue', 'value': 100000, 'unit': 'CNY'},
            {'path': 'periods/2024-Q1/cost', 'value': 80000, 'unit': 'CNY'}]},
            {'id': 'cash_ratio', 'value': None, 'status': 'missing', 'inputs': [{'value': None}]}]}
    run = {'id': 'pure-run', 'state': 'degraded', 'dataset_id': saved['id'], 'snapshot': snapshot, 'result': result}
    return run, saved, query


def test_independent_expected_values_allow_missing_and_utc_midnight():
    run, saved, query = report_contract()
    draft.expect_dataset(saved['payload'])
    draft.expect_report(run, saved, approved_query=query)


@pytest.mark.parametrize('change', ['zero-cash', 'zero-ratio', 'wrong-margin', 'q2', 'dropped-scope', 'changed-date', 'model-prose'])
def test_report_oracle_rejects_specific_false_outcomes(change):
    run, saved, query = report_contract()
    if change == 'zero-cash':
        run['result']['lineage'][1]['inputs'][0]['value'] = 0
    elif change == 'zero-ratio':
        run['result']['analysis']['metrics']['cash_ratio'] = 0
    elif change == 'wrong-margin':
        run['result']['analysis']['metrics']['gross_margin'] = .02
    elif change == 'q2':
        run['result']['analysis']['current_period'] = '2024-Q2'
    elif change == 'dropped-scope':
        run['result']['query'] = draft.QUESTION
    elif change == 'changed-date':
        run['result']['quality']['as_of'] = '2026-10-05'
    else:
        run['result']['llm']['review']['claims'] = ['invented expert opinion']
    with pytest.raises(AssertionError):
        draft.expect_report(run, saved, approved_query=query)


def test_normalized_dataset_rejects_cash_zero_and_quantity_money_scaling():
    _, saved, _ = report_contract()
    for key, value in [('cash_flow', 0), ('sales_volume', 1000000), ('lithium_price', 1000000000)]:
        changed = copy.deepcopy(saved['payload'])
        changed['periods'][0][key] = value
        with pytest.raises(AssertionError):
            draft.expect_dataset(changed)


def test_opened_exports_match_full_query_events_and_persisted_values():
    run, saved, query = report_contract()
    events = [{'type': 'completed', 'created_at': '2026-10-05T00:00:01Z'}]
    exported = {**run['result'], 'execution_events': events, 'export_context': {
        'run_id': run['id'], 'execution_state': run['state'], 'identity': run['snapshot']['identity'],
        'human_reviews_at_export': [], 'assessment_at_export': None}}
    md = '\n\n'.join(['数据哈希 ' + saved['content_hash'], '快照哈希 ' + run['result']['snapshot_hash'],
        '没有匹配证据；结构门禁与引用关联不等于事实核验', query.replace('\n', ' '),
        run['result']['created_at'], r'not\_requested'] +
        ['```json\n' + json.dumps(x, ensure_ascii=False, indent=2) + '\n```' for x in
         [run['result']['analysis'], run['result']['lineage'], events]]).encode()
    receipt = draft.expect_downloads(json.dumps(exported).encode(), md, run, saved, events, approved_query=query)
    assert receipt['parsed_markdown_json_blocks'] == 3
    exported['query'] = draft.QUESTION
    with pytest.raises(AssertionError, match='persisted field: query'):
        draft.expect_downloads(json.dumps(exported).encode(), md, run, saved, events, approved_query=query)
