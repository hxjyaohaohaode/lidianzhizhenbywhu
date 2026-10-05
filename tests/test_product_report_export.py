"""Pure I9 contract checks; no browser, server, provider, or business writes."""
from copy import deepcopy
import hashlib
import importlib
import json
import socket
import subprocess
from types import SimpleNamespace

import pytest

from scripts import product_report_export as scenario
from scripts.product_first_use_audit import HarnessContractError, canonical_hash


def fixture(query=scenario.QUERY):
    file_bytes = b'isolated synthetic CSV'
    source_file = {'name': 'synthetic-financial-input.csv',
                   'sha256': hashlib.sha256(file_bytes).hexdigest(), 'bytes': len(file_bytes)}
    dataset = {'id': 'dataset', 'user_id': 'synthetic-owner', 'version': 1,
               'payload': {'company': 'synthetic', 'periods': [
                   {'period': '2024-Q4', 'revenue': 100000, 'cost': 80000}]}}
    dataset['content_hash'] = canonical_hash(dataset['payload'])
    source = {'status': 'recorded', 'dataset_id': dataset['id'], 'dataset_version': 1,
              'dataset_hash': dataset['content_hash'], 'period': '2024-Q4',
              'file': source_file, 'input_amount_unit': 'yuan',
              'input_basis': 'standalone_quarter', 'confirmed_at': 'synthetic-time',
              'receipt_hash': 'b' * 64}
    snapshot = {'dataset': deepcopy(dataset['payload']), 'dataset_version': 1,
                'dataset_hash': dataset['content_hash'], 'input_source': source,
                'identity': None, 'studio': {'plan_id': 'plan'}}
    fact = {'id': 'gross_margin', 'period': '2024-Q4', 'label': '毛利率', 'value': .2,
            'formula': '(收入−成本)/收入', 'unit': 'ratio', 'status': 'available', 'reason': '',
            'inputs': [{'path': 'periods/2024-Q4/revenue', 'value': 100000, 'unit': 'CNY'},
                       {'path': 'periods/2024-Q4/cost', 'value': 80000, 'unit': 'CNY'}]}
    result = {'query': query, 'dataset_id': dataset['id'], 'dataset_version': 1,
              'dataset_hash': dataset['content_hash'], 'snapshot_hash': canonical_hash(snapshot),
              'analysis': {'current_period': '2024-Q4', 'metrics': {'gross_margin': .2}},
              'research_scope': {'period': '2024-Q4'}, 'lineage': [deepcopy(fact)],
              'llm': {'state': 'not_requested', 'calls': [], 'review': {'claims': []}},
              'citations': [], 'readout': {'schema_version': 1, 'scope_recorded': True,
              'period': '2024-Q4', 'amount_unit': 'wan', 'facts': [deepcopy(fact)],
              'input_source': deepcopy(source)}}
    run = {'id': 'run', 'user_id': dataset['user_id'], 'dataset_id': dataset['id'],
           'state': 'succeeded', 'payload': {'query': query}, 'snapshot': snapshot, 'result': result}
    events = [{'seq': 1, 'type': 'succeeded', 'payload': {'report_ready': True}}]
    exported = {**deepcopy(result), 'execution_events': events,
                'export_context': {'run_id': run['id'], 'execution_state': run['state'],
                                   'identity': None, 'human_reviews_at_export': [], 'assessment_at_export': None}}
    md = ('## 本次问题的回答\n' + query + '\n2024-Q4 毛利率20% 营业收入 10 万元；营业成本 8 万元\n'
          '## 输入来源与保存范围\n| 数据修订 | 1 |\n' + source_file['name'] + ' ' + source_file['sha256'] + '\n' +
          dataset['content_hash'] + '\n用户提供，未经独立核验\n## 技术附录\n' + result['snapshot_hash'] +
          '\nnot\\_requested\n' + '\n'.join('```json\n' + json.dumps(value, ensure_ascii=False) + '\n```'
          for value in [result['analysis'], result['lineage'], events]))
    return run, dataset, source_file, events, exported, md


def check(values):
    run, dataset, source_file, events, exported, md = values
    return scenario.expect_export_bytes(json.dumps(exported).encode(), md.encode(), run,
                                        dataset, run['payload']['query'], source_file, events)


def test_import_has_no_runtime_process_or_socket_side_effect(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('Pure import must not start an external operation.')
    monkeypatch.setattr(socket, 'socket', forbidden)
    monkeypatch.setattr(subprocess, 'Popen', forbidden)
    importlib.reload(scenario)


def test_native_contract_blocks_before_probe_access_or_local_mutation(tmp_path, monkeypatch):
    monkeypatch.delenv('GITHUB_ACTIONS', raising=False)
    with pytest.raises(HarnessContractError, match='Local browser execution is restricted'):
        scenario.report_export_fresh_report(SimpleNamespace(), repository_root=tmp_path,
            data_dir=tmp_path, expected_web_tree='a' * 40, expected_server_tree='b' * 40)


@pytest.mark.parametrize('query', [scenario.QUERY, scenario.FRESH_QUERY])
def test_both_distinct_questions_require_same_frozen_business_values(query):
    checked = check(fixture(query))
    assert checked['json_bytes'] > 0 and checked['markdown_bytes'] > 0
    assert checked['parsed_markdown_json_blocks'] == 3


@pytest.mark.parametrize('mutate', [
    lambda run: run['result']['analysis']['metrics'].update(gross_margin=20),
    lambda run: run['result']['lineage'][0]['inputs'][1].update(value=75000),
    lambda run: run['result']['readout']['facts'][0].update(value=.25),
    lambda run: run['result']['readout']['facts'].append(deepcopy(run['result']['readout']['facts'][0])),
    lambda run: run['result']['readout']['input_source']['file'].update(name='later.csv'),
    lambda run: run['result'].update(query='2024-Q3毛利率是多少'),
    lambda run: run['result'].update(dataset_hash='0' * 64),
    lambda run: run['snapshot']['dataset']['periods'][0].update(revenue=200000),
    lambda run: run['result']['llm']['calls'].append({'provider': 'not-allowed'}),
])
def test_saved_report_oracle_rejects_wrong_values_or_provenance(mutate):
    run, dataset, source_file, *_ = fixture()
    mutate(run)
    with pytest.raises(AssertionError):
        scenario.expect_saved_report(run, dataset, scenario.QUERY, source_file)


@pytest.mark.parametrize('mutate', [
    lambda data: data['readout']['facts'][0].update(value=.25),
    lambda data: data['lineage'][0]['inputs'][1].update(value=75000),
    lambda data: data['export_context'].update(run_id='another-run'),
    lambda data: data.update(execution_events=[]),
    lambda data: data.update(dataset_version=2),
    lambda data: data.update(extra_frozen_result='invented'),
])
def test_json_download_oracle_rejects_changed_bytes(mutate):
    values = fixture()
    mutate(values[4])
    with pytest.raises(AssertionError):
        check(values)


@pytest.mark.parametrize(('before', 'after'), [
    ('毛利率20%', '毛利率0.2'),
    ('营业收入 10 万元', '营业收入 100000 万元'),
    ('营业成本 8 万元', '营业成本 7.5 万元'),
    ('| 数据修订 | 1 |', '| 数据修订 | 2 |'),
    ('## 本次问题的回答', '## 原始技术记录'),
    ('用户提供，未经独立核验', '所有事实已经核验'),
])
def test_markdown_download_requires_readable_correct_answer_and_source(before, after):
    values = list(fixture())
    values[5] = values[5].replace(before, after)
    with pytest.raises(AssertionError):
        check(values)


def test_bad_audit_requires_this_artifact_failure_and_unavailable_reason():
    audit = {'report_integrity': {'valid': False, 'failures': ['artifact_hash']},
             'source_impact': {'state': 'unavailable', 'reasons': [
                 {'code': 'report_integrity_failed', 'message': '冻结产物完整性校验失败'}]}}
    assert scenario.expect_bad_audit(audit) == '冻结产物完整性校验失败'
    for altered in [
        {**deepcopy(audit), 'report_integrity': {'valid': True, 'failures': []}},
        {**deepcopy(audit), 'source_impact': {'state': 'current', 'reasons': []}},
        {**deepcopy(audit), 'report_integrity': {'valid': False, 'failures': ['dataset_hash']}},
    ]:
        with pytest.raises(AssertionError):
            scenario.expect_bad_audit(altered)


def test_record_lookup_rejects_missing_and_ambiguous_history():
    row = {'id': 'old'}
    assert scenario.one([row, {'id': 'fresh'}], 'old') == row
    for rows in ([], [row, row]):
        with pytest.raises(AssertionError):
            scenario.one(rows, 'old')
