"""Bind the three L13 synthetic CSV inputs to the current report and archive."""
from copy import deepcopy
import hashlib
from io import BytesIO
import json
import zipfile

import pytest

from scripts.pack_product_audit import package


MODE = 'product-strategy-success'
SCENARIO = 'L13-strategy-success'
FILES = tuple(f'strategy-success-input-{index}.csv' for index in range(1, 4))


def digest(blob):
    return hashlib.sha256(blob).hexdigest()


def fixture(tmp_path, *, count=3, passed=True):
    evidence = tmp_path / 'evidence'
    directory = evidence / MODE / SCENARIO
    directory.mkdir(parents=True)
    artifacts, inputs = [], []
    for index, name in enumerate(FILES[:count], 1):
        blob = f'contract-only synthetic CSV {index}\n'.encode()
        (directory / name).write_bytes(blob)
        artifacts.append({'file': name, 'kind': 'synthetic-input', 'sha256': digest(blob), 'bytes': len(blob)})
        inputs.append({'file': name, 'csv_sha256': digest(blob), 'dataset_id': f'contract-only-dataset-{index}'})
    report = {'suite': 'strategy-success', 'all_checks_passed': passed, 'scenarios': [{
        'id': SCENARIO, 'status': 'passed' if passed else 'failed', 'artifacts': artifacts,
        'observations': {'fixture': {'synthetic': True, 'inputs': inputs}}}]}
    write_report(evidence, report)
    return evidence, directory, report


def write_report(evidence, report):
    (evidence / (MODE + '-audit.json')).write_text(json.dumps(report))


def test_three_input_success_packages_only_current_claimed_bytes_losslessly(tmp_path):
    evidence, directory, report = fixture(tmp_path)
    (directory / 'synthetic-financial-input.csv').write_bytes(b'unrelated prior fixture')
    (directory / 'strategy-success-input-4.csv').write_bytes(b'not current evidence')
    manifest = package(evidence, suite='strategy-success', part_bytes=1024)
    expected = {MODE + '-audit.json', *(f'{MODE}/{SCENARIO}/{name}' for name in FILES)}
    assert manifest['suite'] == 'strategy-success' and manifest['audit_passed'] is True
    assert set(manifest['files']) == expected
    output = evidence / (MODE + '-transfer')
    blob = b''.join((output / f"part-{part['number']:02d}" / part['file']).read_bytes()
        for part in manifest['parts'])
    assert digest(blob) == manifest['archive_sha256']
    with zipfile.ZipFile(BytesIO(blob)) as archive:
        assert set(archive.namelist()) == expected
        for name in expected:
            assert digest(archive.read(name)) == manifest['files'][name]['sha256']
    for item in report['scenarios'][0]['observations']['fixture']['inputs']:
        assert manifest['files'][f'{MODE}/{SCENARIO}/' + item['file']]['sha256'] == item['csv_sha256']


@pytest.mark.parametrize('count', [0, 1, 2])
@pytest.mark.parametrize('observation_written', [False, True])
def test_failed_steps_preserve_already_created_evidence_without_demanding_future_inputs(tmp_path, count, observation_written):
    evidence, directory, report = fixture(tmp_path, count=count, passed=False)
    row = report['scenarios'][0]
    if not observation_written:
        row['observations'] = {}
    image = b'contract-only pixels from failed step'
    (directory / 'failed.png').write_bytes(image)
    row['screenshots'] = [{'file': 'failed.png', 'sha256': digest(image)}]
    write_report(evidence, report)
    manifest = package(evidence, suite='strategy-success')
    assert manifest['audit_passed'] is False
    assert set(manifest['files']) == {MODE + '-audit.json', f'{MODE}/{SCENARIO}/failed.png',
        *(f'{MODE}/{SCENARIO}/{name}' for name in FILES[:count])}


def test_failure_between_artifact_and_observation_keeps_both_completed_and_pending_evidence(tmp_path):
    evidence, _, report = fixture(tmp_path, count=2, passed=False)
    report['scenarios'][0]['observations']['fixture']['inputs'].pop()
    write_report(evidence, report)
    manifest = package(evidence, suite='strategy-success')
    assert len(manifest['files']) == 3 and manifest['audit_passed'] is False


@pytest.mark.parametrize('count', [0, 1, 2])
def test_success_requires_all_three_observed_and_declared_inputs(tmp_path, count):
    evidence, _, report = fixture(tmp_path, count=count)
    # Even an aggregate red report cannot call its L13 scenario passed without
    # preserving the complete three-input evidence contract.
    report['all_checks_passed'] = False
    write_report(evidence, report)
    with pytest.raises(ValueError, match='all configured fixture CSV inputs'):
        package(evidence, suite='strategy-success')
    assert not (evidence / (MODE + '-transfer')).exists()


@pytest.mark.parametrize('damage', [
    'missing_observation', 'missing_fixture', 'non_object_fixture', 'not_synthetic',
    'missing_inputs', 'non_list_inputs', 'non_object_input', 'duplicate_input',
    'unknown_input', 'missing_input_name', 'missing_input_hash', 'bad_input_hash',
    'different_observed_hash', 'swap_observed_hashes', 'missing_artifact', 'duplicate_artifact',
    'wrong_artifact_kind', 'renamed_artifact', 'unknown_synthetic_artifact',
    'missing_file', 'changed_file', 'bad_byte_length', 'missing_scenario', 'duplicate_scenario',
    'wrong_scenario', 'green_aggregate_failed_scenario',
])
def test_success_rejects_unbound_missing_replaced_or_ambiguous_input_evidence(tmp_path, damage):
    evidence, directory, report = fixture(tmp_path)
    row = report['scenarios'][0]
    observed = row['observations']['fixture']
    artifact = row['artifacts'][0]
    if damage == 'missing_observation': row['observations'] = {}
    elif damage == 'missing_fixture': row['observations'].pop('fixture')
    elif damage == 'non_object_fixture': row['observations']['fixture'] = []
    elif damage == 'not_synthetic': observed['synthetic'] = False
    elif damage == 'missing_inputs': observed.pop('inputs')
    elif damage == 'non_list_inputs': observed['inputs'] = {}
    elif damage == 'non_object_input': observed['inputs'][0] = FILES[0]
    elif damage == 'duplicate_input': observed['inputs'].append(deepcopy(observed['inputs'][0]))
    elif damage == 'unknown_input': observed['inputs'][0]['file'] = 'strategy-success-input-4.csv'
    elif damage == 'missing_input_name': observed['inputs'][0].pop('file')
    elif damage == 'missing_input_hash': observed['inputs'][0].pop('csv_sha256')
    elif damage == 'bad_input_hash': observed['inputs'][0]['csv_sha256'] = 'not-a-hash'
    elif damage == 'different_observed_hash': observed['inputs'][0]['csv_sha256'] = '0' * 64
    elif damage == 'swap_observed_hashes':
        observed['inputs'][0]['csv_sha256'], observed['inputs'][1]['csv_sha256'] = (
            observed['inputs'][1]['csv_sha256'], observed['inputs'][0]['csv_sha256'])
    elif damage == 'missing_artifact': row['artifacts'].pop(0)
    elif damage == 'duplicate_artifact': row['artifacts'].append(deepcopy(artifact))
    elif damage == 'wrong_artifact_kind': artifact['kind'] = 'download'
    elif damage == 'renamed_artifact':
        (directory / artifact['file']).rename(directory / 'different.csv')
        artifact['file'] = 'different.csv'
    elif damage == 'unknown_synthetic_artifact':
        extra = dict(artifact, file='extra-input.csv')
        (directory / extra['file']).write_bytes((directory / artifact['file']).read_bytes())
        row['artifacts'].append(extra)
    elif damage == 'missing_file': (directory / artifact['file']).unlink()
    elif damage == 'changed_file': (directory / artifact['file']).write_bytes(b'changed bytes')
    elif damage == 'bad_byte_length': artifact['bytes'] += 1
    elif damage == 'missing_scenario': report['scenarios'] = []
    elif damage == 'duplicate_scenario': report['scenarios'].append(deepcopy(row))
    elif damage == 'wrong_scenario': row['id'] = 'L9-strategy-consent'
    elif damage == 'green_aggregate_failed_scenario': row['status'] = 'failed'
    else: raise AssertionError(damage)
    write_report(evidence, report)
    with pytest.raises(ValueError):
        package(evidence, suite='strategy-success')
    assert not (evidence / (MODE + '-transfer')).exists()


@pytest.mark.parametrize('damage', ['wrong_hash', 'missing_record', 'unknown_name', 'changed_bytes'])
def test_failure_does_not_waive_hash_binding_for_inputs_already_observed(tmp_path, damage):
    evidence, directory, report = fixture(tmp_path, count=1, passed=False)
    row = report['scenarios'][0]
    if damage == 'wrong_hash': row['observations']['fixture']['inputs'][0]['csv_sha256'] = '0' * 64
    elif damage == 'missing_record': row['artifacts'] = []
    elif damage == 'unknown_name': row['observations']['fixture']['inputs'][0]['file'] = 'unknown.csv'
    else: (directory / FILES[0]).write_bytes(b'changed after observation')
    write_report(evidence, report)
    with pytest.raises(ValueError):
        package(evidence, suite='strategy-success')
