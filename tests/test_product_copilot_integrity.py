"""Pure adverse contracts and temporary SQLite fixtures; no native UI/API calls."""
from copy import deepcopy
import importlib
import json
from pathlib import Path
import socket
import sqlite3
import subprocess
from types import SimpleNamespace

import pytest

from scripts import product_copilot_integrity as scenario
from scripts import native_integrity_faults as faults
from scripts.product_browser_audit import Probe
from scripts.product_first_use_audit import HarnessContractError, canonical_hash
from test_product_report_export import fixture


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def test_import_is_pure_and_local_entry_rejected_before_probe_access(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('A pure script contract cannot start a process or socket.')
    monkeypatch.setattr(socket, 'socket', forbidden)
    monkeypatch.setattr(subprocess, 'Popen', forbidden)
    importlib.reload(scenario)
    monkeypatch.delenv('GITHUB_ACTIONS', raising=False)
    with pytest.raises(HarnessContractError, match='Local browser execution is restricted'):
        scenario.copilot_report_integrity(SimpleNamespace(), repository_root=tmp_path,
            data_dir=tmp_path, expected_web_tree='a'*40, expected_server_tree='b'*40)
    p = SimpleNamespace(base_url='http://127.0.0.1:8000', get=forbidden)
    with pytest.raises(RuntimeError, match='GitHub runner only'):
        faults.read_copilot_records(p, data_dir=tmp_path, run_id='unused', proposal_id='unused')
    with pytest.raises(RuntimeError, match='GitHub runner only'):
        faults.inject_copilot_report_result(p, data_dir=tmp_path, run_id='unused', proposal_id='unused', expected_records={})
    assert list(tmp_path.iterdir()) == []


def saved_result():
    return fixture()[0]['result']


def test_one_fault_changes_exactly_one_scalar_and_nothing_else():
    result = saved_result()
    raw = encode(result)
    after = faults.damaged_copilot_result(raw)
    expected = deepcopy(result)
    expected['readout']['facts'][0]['value'] = faults.COPILOT_BAD_VALUE
    assert after == encode(expected)
    assert result['analysis']['metrics']['gross_margin'] == result['lineage'][0]['value'] == .2
    original_fact = encode(result['readout']['facts'][0])
    changed_fact = encode(expected['readout']['facts'][0])
    start = raw.index(original_fact, raw.index('"readout":'))
    assert after == raw[:start] + changed_fact + raw[start + len(original_fact):]


@pytest.mark.parametrize('damage', ['already_bad', 'wrong_metric', 'wrong_unit', 'duplicate', 'other_value', 'noncanonical', 'malformed'])
def test_scalar_fixture_rejects_unviewed_or_ambiguous_original(damage):
    result = saved_result()
    if damage == 'already_bad': result['readout']['facts'][0]['value'] = faults.COPILOT_BAD_VALUE
    elif damage == 'wrong_metric': result['readout']['facts'][0]['id'] = 'cost'
    elif damage == 'wrong_unit': result['readout']['facts'][0]['unit'] = 'CNY'
    elif damage == 'duplicate': result['readout']['facts'].append(deepcopy(result['readout']['facts'][0]))
    elif damage == 'other_value': result['readout']['facts'][0]['value'] = .25
    raw = '{malformed' if damage == 'malformed' else json.dumps(result, indent=2) if damage == 'noncanonical' else encode(result)
    with pytest.raises((RuntimeError, ValueError)):
        faults.damaged_copilot_result(raw)


def test_raw_reader_recipe_uses_visible_search_and_exact_download_without_offsets():
    source = Path(scenario.__file__).read_text()
    reader = source[source.index('def _read_raw('):source.index('def _observe_blocked(')]
    assert "query.fill('毛利率')" in reader
    assert "name='查找', exact=True" in reader and "name='下一处', exact=True" in reader
    assert 'download_visible(p, button' in reader and "downloaded == raw.encode('utf-8')" in reader
    for forbidden in ('createRange', 'target.start', '_RAW_GEOMETRY', 'scrollLeft', 'mouse.wheel'):
        assert forbidden not in reader


def card_fixture():
    run, *_ = fixture()
    proposal = {'id': 'proposal', 'payload': {'text': run['payload']['query']}}
    card = {'id': run['id'], 'proposal_id': proposal['id'], 'query': run['payload']['query'],
            'state': run['state'], 'dataset_version': 1, 'result': deepcopy(run['result']),
            'report_integrity': {'valid': True, 'format': 'studio', 'failures': []},
            'report_hash_valid': True, 'report_availability': {'status': 'available', 'notice': ''},
            'unverified_report': None, 'source_impact': {'state': 'current'}}
    return {'runs': [card], 'proposals': [proposal]}, proposal, run


def blocked_fixture():
    thread, proposal, run = card_fixture()
    raw = faults.damaged_copilot_result(encode(run['result']))
    card = thread['runs'][0]
    card.update(result=None, question_compatibility=None, report_hash_valid=False,
        report_integrity={'valid': False, 'format': 'studio', 'failures': ['report_hash']},
        report_availability={'status': 'unavailable', 'notice': '完整性异常'},
        source_impact={'state': 'unavailable', 'reasons': [{'code': 'report_integrity_failed'}]},
        unverified_report={'raw': raw, 'notice': '未核验的已保存报告原文，仅供排查；不是可用结论。'})
    return thread, proposal, run, raw


def test_api_oracles_keep_genuine_frozen_result_and_exact_damaged_raw_separate():
    thread, proposal, run = card_fixture()
    scenario.expect_card_api(thread, proposal, run, available=True)
    thread, proposal, run, raw = blocked_fixture()
    scenario.expect_card_api(thread, proposal, run, available=False, raw=raw)


@pytest.mark.parametrize('mutation', [
    lambda c: c.update(result=saved_result()),
    lambda c: c.update(report_hash_valid=True),
    lambda c: c['report_integrity'].update(valid=True),
    lambda c: c['report_integrity'].update(failures=['artifact_hash']),
    lambda c: c['report_availability'].update(status='available'),
    lambda c: c['unverified_report'].update(raw='repaired'),
    lambda c: c.update(query='another question'),
    lambda c: c['source_impact'].update(state='current'),
    lambda c: c.update(question_compatibility={'status': 'unsupported_operation'}),
])
def test_masked_card_oracle_rejects_leaks_wrong_fault_or_repaired_history(mutation):
    thread, proposal, run, raw = blocked_fixture()
    mutation(thread['runs'][0])
    with pytest.raises(AssertionError):
        scenario.expect_card_api(thread, proposal, run, available=False, raw=raw)


def sqlite_fixture(tmp_path, monkeypatch):
    # Only this isolated unit test replaces the runner-location predicate. It
    # creates no browser/server/listener, never sets GITHUB_ACTIONS and invokes
    # no application API. The real entry denial is checked separately above.
    monkeypatch.setattr('scripts.product_browser_audit.require_isolated_runner', lambda *_: None)
    monkeypatch.setenv('DATA_DIR', str(tmp_path))
    directory = tmp_path/'receipts'; directory.mkdir()
    p = Probe(None, 'http://127.0.0.1:8000', directory, None)
    p.artifact_kinds = (*p.artifact_kinds, 'fault-injection')
    p.get = lambda path: {'user': {'id': 'owner'}} if path == '/api/auth/me' else {
        'report_integrity': {'valid': True, 'format': 'studio', 'failures': []}, 'report_hash_valid': True}
    raw = encode(saved_result())
    with sqlite3.connect(tmp_path/'lidian.sqlite3') as db:
        db.executescript('''
            CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT);
            CREATE TABLE runs(id TEXT PRIMARY KEY,user_id TEXT,dataset_id TEXT,state TEXT,result TEXT,snapshot TEXT,payload TEXT,updated_at TEXT);
            CREATE TABLE workspace_objects(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,payload TEXT,version INT);
            CREATE TABLE datasets(id TEXT PRIMARY KEY,user_id TEXT,payload TEXT,version INT,content_hash TEXT);
            CREATE TABLE agent_artifacts(id TEXT,run_id TEXT,node TEXT,payload TEXT,content_hash TEXT);
            CREATE TABLE run_events(seq INT,run_id TEXT,payload TEXT);
            CREATE TABLE event_integrity(event_seq INT,run_id TEXT,entry_hash TEXT);
            INSERT INTO users VALUES('owner','synthetic@test.example');
        ''')
        db.execute('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', ('run','owner','dataset','succeeded',raw,'{"scope":"frozen"}','{"query":"original"}','frozen-time'))
        db.execute('INSERT INTO workspace_objects VALUES(?,?,?,?,?)', ('proposal','owner','assistant_proposal',encode({'kind':'research','status':'executed','result':{'run_id':'run'},'plan_id':'plan'}),2))
        db.execute('INSERT INTO workspace_objects VALUES(?,?,?,?,?)', ('plan','owner','plan','{"run_id":"run"}',2))
        db.execute('INSERT INTO datasets VALUES(?,?,?,?,?)', ('dataset','owner','{"original":true}',1,'original-hash'))
        db.execute('INSERT INTO agent_artifacts VALUES(?,?,?,?,?)', ('artifact','run','report',raw,faults.sha(raw)))
        db.execute('INSERT INTO run_events VALUES(?,?,?)', (1,'run','{"type":"succeeded"}'))
        db.execute('INSERT INTO event_integrity VALUES(?,?,?)', (1,'run','original-ledger'))
    original = faults.read_copilot_records(p, data_dir=tmp_path, run_id='run', proposal_id='proposal')
    return p, original


def inject(p, tmp_path, original):
    return faults.inject_copilot_report_result(p, data_dir=tmp_path, run_id='run', proposal_id='proposal', expected_records=original)


def current(p, tmp_path):
    return faults.read_copilot_records(p, data_dir=tmp_path, run_id='run', proposal_id='proposal')


def test_exact_fixture_preserves_full_proposal_plan_dataset_and_audit_bytes(tmp_path, monkeypatch):
    p, before = sqlite_fixture(tmp_path, monkeypatch)
    receipt = inject(p, tmp_path, before)
    assert receipt['original_records'] == before
    after = current(p, tmp_path)
    expected = deepcopy(before)
    expected['run']['result'] = faults.damaged_copilot_result(before['run']['result'])
    assert after == expected == receipt['damaged_records']
    assert not receipt['restored'] and not receipt['ui_mutation_claimed']
    assert receipt['before_sha256'] == faults.sha(before['run']['result'])
    assert receipt['after_sha256'] == faults.sha(after['run']['result'])
    assert len(p.artifacts) == 1 and p.artifacts[0]['kind'] == 'fault-injection'
    assert json.loads((p.directory/p.artifacts[0]['file']).read_text()) == receipt
    with pytest.raises(RuntimeError, match='exactly one'): inject(p, tmp_path, before)
    assert current(p, tmp_path) == after


@pytest.mark.parametrize('field', ['result','snapshot','payload','updated_at','proposal','artifact','dataset','ledger'])
def test_changed_viewed_record_refuses_fault_without_additional_writes(tmp_path, monkeypatch, field):
    p, original = sqlite_fixture(tmp_path, monkeypatch)
    with sqlite3.connect(tmp_path/'lidian.sqlite3') as db:
        if field in ('result','snapshot','payload','updated_at'):
            db.execute('UPDATE runs SET '+field+'=?', ('changed',))
        elif field == 'proposal': db.execute('UPDATE workspace_objects SET version=3 WHERE id="proposal"')
        elif field == 'artifact': db.execute('UPDATE agent_artifacts SET content_hash="changed"')
        elif field == 'dataset': db.execute('UPDATE datasets SET version=2')
        else: db.execute('UPDATE event_integrity SET entry_hash="changed"')
    before = current(p, tmp_path)
    with pytest.raises(RuntimeError, match='changed after healthy'): inject(p, tmp_path, original)
    assert current(p, tmp_path) == before and p.artifacts == []


@pytest.mark.parametrize('damage', ['owner','email','proposal_binding','plan_binding','state','artifact_hash','artifact_payload','missing_artifact'])
def test_fixture_rejects_ineligible_or_unanchored_target(tmp_path, monkeypatch, damage):
    p, original = sqlite_fixture(tmp_path, monkeypatch)
    with sqlite3.connect(tmp_path/'lidian.sqlite3') as db:
        if damage == 'owner': db.execute('UPDATE runs SET user_id="foreign"')
        elif damage == 'email': db.execute('UPDATE users SET email="real@example.com"')
        elif damage == 'proposal_binding': db.execute('UPDATE workspace_objects SET payload=? WHERE id="proposal"', (encode({'kind':'research','status':'executed','result':{'run_id':'other'},'plan_id':'plan'}),))
        elif damage == 'plan_binding': db.execute('UPDATE workspace_objects SET payload=\'{"run_id":"other"}\' WHERE id="plan"')
        elif damage == 'state': db.execute('UPDATE runs SET state="running"')
        elif damage == 'artifact_hash': db.execute('UPDATE agent_artifacts SET content_hash="changed"')
        elif damage == 'artifact_payload': db.execute('UPDATE agent_artifacts SET payload="changed"')
        else: db.execute('DELETE FROM agent_artifacts')
    if damage.startswith('artifact') or damage == 'missing_artifact':
        original = current(p, tmp_path)
    with pytest.raises(RuntimeError): inject(p, tmp_path, original)
    assert p.artifacts == []


def test_receipt_failure_rolls_back_uncommitted_fault_without_restoring_history(tmp_path, monkeypatch):
    p, before = sqlite_fixture(tmp_path, monkeypatch)
    def reject(*args, **kwargs): raise RuntimeError('synthetic packaging failure')
    monkeypatch.setattr(p, 'record_artifact', reject)
    with pytest.raises(RuntimeError, match='packaging failure'): inject(p, tmp_path, before)
    assert current(p, tmp_path) == before and p.observations.get('database_faults') is None


def test_contract_preserves_runner_registration_and_forbids_runtime_shortcuts():
    text = Path(scenario.__file__).read_text()
    for forbidden in ('force=True', 'route.fulfill', 'set_content(', 'request.post(', 'request.put(', '.restore(', 'sync_playwright(', 'Popen('):
        assert forbidden not in text
    assert 'require_native_contract(p,' in text and 'p.page.reload(' in text
    assert 'observe_text_by_normal_scroll' in text and 'data-unverified-report-raw' in text
    assert 'expect_fault_audit(healthy_audit, damaged_audit)' in text
