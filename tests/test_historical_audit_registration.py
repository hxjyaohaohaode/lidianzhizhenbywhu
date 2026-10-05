"""Separate old-history admission and lossless transfer; no browser execution."""
import hashlib
import json
from pathlib import Path
import zipfile

import pytest

from conftest import Actor
from scripts import native_historical_fixture as history
from scripts.pack_product_audit import package
from scripts.product_audit_config import AUDIT_SUITES, audit_artifact_kinds, audit_suite
from scripts.product_browser_audit import Probe, scenario_registry

ROOT = Path(__file__).resolve().parents[1]
SUITE = 'historical-warning'
SCENARIO = 'historical-cost-percentage-warning'


def capture(tmp_path, receipt, *, observed=True, status='passed'):
    evidence = tmp_path / 'evidence'
    configuration = audit_suite(SUITE)
    directory = evidence / configuration['mode'] / SCENARIO
    directory.mkdir(parents=True)
    path = directory / 'historical-preparation.json'
    path.write_text(json.dumps(receipt, ensure_ascii=False), encoding='utf-8')
    raw = path.read_bytes()
    row = {'id': SCENARIO, 'status': status, 'artifacts': [{'file': path.name,
        'kind': history.ARTIFACT_KIND, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}],
        'observations': {}}
    if observed:
        row['observations']['historical_preparation'] = {**receipt, 'commit_confirmed': True}
    report = {'suite': SUITE, 'all_checks_passed': status == 'passed', 'scenarios': [row]}
    report_path = evidence / configuration['report']
    report_path.write_text(json.dumps(report), encoding='utf-8')
    return evidence, directory, report_path, report


def receipt_stub():
    # Transfer-only control. The actual SQLite producer is exercised separately.
    return {'scope': history.SCOPE, 'receipt_phase': 'validated_before_commit',
            'transfer_test_only': True}


def test_only_historical_suite_admits_preparation_and_never_faults(tmp_path):
    for name in AUDIT_SUITES:
        kinds = audit_artifact_kinds(name)
        assert (history.ARTIFACT_KIND in kinds) == (name == SUITE)
    assert 'fault-injection' not in audit_artifact_kinds(SUITE)
    assert history.ARTIFACT_KIND not in audit_artifact_kinds('copilot-integrity')
    bound = scenario_registry(repository_root=ROOT, data_dir=tmp_path,
        expected_web_tree='a' * 40, expected_server_tree='b' * 40)[SCENARIO]
    assert bound.keywords['admission_scope'] == history.SCOPE
    assert bound.func.__module__ == 'scripts.product_historical_warning_journey'
    probe = Probe(None, 'unused-no-browser', tmp_path, None)
    path = tmp_path / 'historical-preparation.json'
    path.write_text('{}')
    with pytest.raises(ValueError, match='kind'):
        probe.record_artifact(path, kind=history.ARTIFACT_KIND)
    probe.artifact_kinds = audit_artifact_kinds(SUITE)
    probe.record_artifact(path, kind=history.ARTIFACT_KIND)
    assert probe.artifacts[0]['kind'] == history.ARTIFACT_KIND


@pytest.mark.parametrize('damage', ['other_scope', 'fault_admission', 'other_suite'])
def test_preparation_cannot_be_admitted_by_wrong_registration(monkeypatch, damage):
    configuration = {**audit_suite(SUITE)}
    name = SUITE
    if damage == 'other_scope': configuration['legacy_history_preparation'] = 'other'
    elif damage == 'fault_admission': configuration['database_fault_injection'] = True
    else: name = 'copilot-integrity'
    monkeypatch.setitem(AUDIT_SUITES, name, configuration)
    with pytest.raises(ValueError, match='separate exact suite'):
        audit_artifact_kinds(name)


def test_real_committed_history_receipt_transfers_original_precommit_bytes(factory, tmp_path):
    actor = Actor(factory())
    receipts = []
    observed = history._restore_closed_report(actor.client.app.state.store.db,
        owner_id=actor.user['id'], repository_root=ROOT, write_receipt=receipts.append,
        admission_scope=history.SCOPE)
    assert observed == {**receipts[0], 'commit_confirmed': True}
    assert 'commit_confirmed' not in receipts[0]
    evidence, directory, _, report = capture(tmp_path, receipts[0])
    assert report['scenarios'][0]['observations']['historical_preparation'] == observed
    original = (directory / 'historical-preparation.json').read_bytes()
    manifest = package(evidence, suite=SUITE)
    assert manifest['audit_passed'] is True
    with zipfile.ZipFile(evidence / 'product-historical-warning-transfer/current-evidence.zip') as archive:
        archived = archive.read('product-historical-warning/' + SCENARIO + '/historical-preparation.json')
    assert archived == original
    assert json.loads(archived)['selected_row_count'] == 49
    assert 'commit_confirmed' not in json.loads(archived)


@pytest.mark.parametrize('damage', ['missing_receipt', 'wrong_scope', 'wrong_name',
    'wrong_kind', 'changed_bytes', 'observed_changed', 'missing_observation', 'unconfirmed',
    'receipt_claims_commit', 'wrong_phase', 'numeric_confirmation'])
def test_completed_preparation_rejects_unbound_receipt(tmp_path, damage):
    receipt = receipt_stub()
    if damage == 'wrong_scope': receipt['scope'] = 'copilot-integrity'
    if damage == 'receipt_claims_commit': receipt['commit_confirmed'] = True
    if damage == 'wrong_phase': receipt['receipt_phase'] = 'unverified'
    evidence, directory, path, report = capture(tmp_path, receipt)
    row = report['scenarios'][0]
    if damage == 'missing_receipt': row['artifacts'] = []
    elif damage == 'wrong_name':
        (directory / 'historical-preparation.json').rename(directory / 'other.json')
        row['artifacts'][0]['file'] = 'other.json'
    elif damage == 'wrong_kind': row['artifacts'][0]['kind'] = 'fault-injection'
    elif damage == 'changed_bytes': (directory / 'historical-preparation.json').write_text('{}')
    elif damage == 'observed_changed': row['observations']['historical_preparation']['scope'] = 'other'
    elif damage == 'missing_observation': row['observations'] = {}
    elif damage == 'unconfirmed': row['observations']['historical_preparation']['commit_confirmed'] = False
    elif damage == 'numeric_confirmation': row['observations']['historical_preparation']['commit_confirmed'] = 1
    path.write_text(json.dumps(report))
    with pytest.raises(ValueError):
        package(evidence, suite=SUITE)
    assert not (evidence / 'product-historical-warning-transfer').exists()


@pytest.mark.parametrize('phase', ['before_preparation', 'unconfirmed_precommit', 'after_commit'])
def test_failed_journey_preserves_available_evidence_without_claiming_success(tmp_path, phase):
    evidence, _, path, report = capture(tmp_path, receipt_stub(),
        observed=phase == 'after_commit', status='failed')
    if phase == 'before_preparation': report['scenarios'][0]['artifacts'] = []
    path.write_text(json.dumps(report))
    manifest = package(evidence, suite=SUITE)
    assert manifest['audit_passed'] is False
    archived_receipts = [name for name in manifest['files'] if name.endswith('/historical-preparation.json')]
    assert len(archived_receipts) == (phase != 'before_preparation')
