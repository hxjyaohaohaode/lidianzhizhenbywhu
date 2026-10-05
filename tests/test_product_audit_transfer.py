"""Transfer checks preserve original UI evidence and failure, without a browser."""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import zipfile

import pytest
from scripts.pack_product_audit import package


def digest(content):
    return hashlib.sha256(content).hexdigest()


def fixture(tmp_path):
    evidence = tmp_path / 'evidence'
    directory = evidence / 'product-audit' / 'F1-test'
    directory.mkdir(parents=True)
    image = bytes(range(256)) * 8
    (directory / '001-before.png').write_bytes(image)
    (directory / 'old-not-in-report.png').write_bytes(b'stale output must not be admitted')
    report = {'all_checks_passed': False, 'runner': {'GITHUB_RUN_ID': 'synthetic-run'},
              'scenarios': [{'id': 'F1-test', 'status': 'failed', 'screenshots': [
                  {'file': '001-before.png', 'sha256': digest(image)}]}]}
    (evidence / 'product-browser-audit.json').write_text(json.dumps(report))
    return evidence, directory, image


def test_split_evidence_reassembles_losslessly_and_keeps_failure(tmp_path):
    evidence, directory, image = fixture(tmp_path)
    manifest = package(evidence, part_bytes=1024)
    assert manifest['audit_passed'] is False
    assert len(manifest['parts']) > 1
    restored = bytearray()
    for part in manifest['parts']:
        base = evidence / 'product-audit-transfer' / f"part-{part['number']:02d}"
        content = (base / part['file']).read_bytes()
        assert len(content) == part['bytes'] <= 1024
        assert digest(content) == part['sha256']
        assert json.loads((base / 'manifest.json').read_text()) == manifest
        restored.extend(content)
    assert len(restored) == manifest['archive_bytes']
    assert digest(restored) == manifest['archive_sha256']
    with zipfile.ZipFile(BytesIO(restored)) as archive:
        assert archive.read('product-audit/F1-test/001-before.png') == image
        assert not any('old-not-in-report' in name for name in archive.namelist())
        for name in archive.namelist():
            assert digest(archive.read(name)) == manifest['files'][name]['sha256']
    with pytest.raises(FileExistsError):
        package(evidence, part_bytes=1024)  # A second attempt cannot inherit old fragments.


def test_changed_screenshot_is_not_packaged_as_verified_evidence(tmp_path):
    evidence, directory, _ = fixture(tmp_path)
    (directory / '001-before.png').write_bytes(b'changed after capture')
    with pytest.raises(ValueError, match='hash mismatch'):
        package(evidence)
    assert not (evidence / 'product-audit-transfer').exists()


def test_evidence_cannot_read_outside_its_output_directory(tmp_path):
    evidence, directory, _ = fixture(tmp_path)
    outside = tmp_path / 'outside.txt'
    outside.write_text('not an audit input')
    report_path = evidence / 'product-browser-audit.json'
    report = json.loads(report_path.read_text())
    report['scenarios'][0]['screenshots'][0]['file'] = str(outside)
    report_path.write_text(json.dumps(report))
    with pytest.raises(ValueError, match='escapes'):
        package(evidence)


def test_oversized_bundle_fails_without_partial_or_truncated_transfer(tmp_path):
    evidence, _, _ = fixture(tmp_path)
    with pytest.raises(ValueError, match='no evidence was truncated'):
        package(evidence, part_bytes=1024, max_parts=1)
    output = evidence / 'product-audit-transfer'
    assert (output / 'current-evidence.zip').is_file()
    assert not list(output.glob('part-*'))


def test_packaging_failure_gets_an_explicit_incomplete_receipt(tmp_path, monkeypatch):
    from scripts import pack_product_audit
    evidence, _, _ = fixture(tmp_path)
    monkeypatch.setattr(pack_product_audit, 'ROOT', tmp_path)
    def fail(*args, **kwargs):
        raise ValueError('isolated test: evidence exceeds capacity')
    monkeypatch.setattr(pack_product_audit, 'package', fail)
    with pytest.raises(ValueError, match='exceeds capacity'):
        pack_product_audit.main()
    receipt = json.loads((evidence / 'product-audit-transfer-status.json').read_text())
    assert receipt['status'] == 'failed' and receipt['complete'] is False
    assert 'exceeds capacity' in receipt['error']
    assert json.loads((evidence / 'product-browser-audit.json').read_text())['all_checks_passed'] is False


def first_use_fixture(tmp_path):
    evidence = tmp_path / 'evidence'
    directory = evidence / 'product-first-use/L1-first-use-report'
    directory.mkdir(parents=True)
    artifacts = []
    for name, kind in [('opened-header-only-template.csv', 'download'), ('L1-synthetic-first.csv', 'synthetic-input'),
        ('L1-synthetic-corrected.csv', 'synthetic-input'), ('opened-report.json', 'download'), ('opened-report.md', 'download')]:
        blob = ('contract-only bytes: ' + name).encode()
        (directory / name).write_bytes(blob)
        artifacts.append({'file': name, 'kind': kind, 'sha256': digest(blob), 'bytes': len(blob)})
    (directory / 'unreferenced-old.csv').write_text('must not sweep this file')
    (evidence / 'product-browser-audit.json').write_text('{"suite":"contract","secret":"unrelated"}')
    report = {'suite': 'first-use', 'all_checks_passed': False,
        'scenarios': [{'id': 'L1-first-use-report', 'status': 'failed', 'artifacts': artifacts}]}
    (evidence / 'product-first-use-audit.json').write_text(json.dumps(report))
    return evidence, directory, report


def test_only_current_report_hashed_downloads_and_csvs_are_transferred(tmp_path):
    evidence, directory, _ = first_use_fixture(tmp_path)
    manifest = package(evidence, suite='first-use', part_bytes=1024)
    assert manifest['suite'] == 'first-use' and manifest['audit_passed'] is False
    assert manifest['source_report_file'] == 'product-first-use-audit.json'
    assert digest((evidence / manifest['source_report_file']).read_bytes()) == manifest['source_report_sha256']
    assert len(manifest['files']) == 6  # report plus exactly five explicit artifacts
    assert 'product-browser-audit.json' not in manifest['files']
    assert not any('unreferenced' in file for file in manifest['files'])
    output = evidence / 'product-first-use-transfer'
    combined = b''.join((output / f"part-{p['number']:02}" / p['file']).read_bytes() for p in manifest['parts'])
    assert digest(combined) == manifest['archive_sha256']
    with zipfile.ZipFile(BytesIO(combined)) as archive:
        for name in manifest['files']:
            assert digest(archive.read(name)) == manifest['files'][name]['sha256']


@pytest.mark.parametrize('bad_field,bad_value,error', [('sha256', None, 'SHA256'), ('sha256', '0' * 64, 'hash mismatch'),
    ('file', '../other.csv', 'direct scenario'), ('file', 'C:\\unrelated.csv', 'direct scenario'),
    ('bytes', 1, 'length mismatch'), ('bytes', True, 'byte length'), ('kind', 'folder-sweep', 'kind')])
def test_bad_download_manifest_fails_closed_before_packaging(tmp_path, bad_field, bad_value, error):
    evidence, _, report = first_use_fixture(tmp_path)
    report['scenarios'][0]['artifacts'][0][bad_field] = bad_value
    (evidence / 'product-first-use-audit.json').write_text(json.dumps(report))
    with pytest.raises(ValueError, match=error):
        package(evidence, suite='first-use')
    assert not (evidence / 'product-first-use-transfer').exists()


def test_first_use_cannot_admit_a_contract_report(tmp_path):
    evidence, _, report = first_use_fixture(tmp_path)
    report['suite'] = 'contract'
    (evidence / 'product-first-use-audit.json').write_text(json.dumps(report))
    with pytest.raises(ValueError, match='different suite'):
        package(evidence, suite='first-use')


@pytest.mark.parametrize('linked_directory', [False, True])
def test_manifest_cannot_admit_symlink_files_or_directories(tmp_path, linked_directory):
    evidence, directory, report = first_use_fixture(tmp_path)
    name = report['scenarios'][0]['artifacts'][0]['file']
    if linked_directory:
        moved = evidence / 'unrelated-directory'
        directory.rename(moved)
        try:
            directory.symlink_to(moved, target_is_directory=True)
        except OSError:
            pytest.skip('Symlink creation unavailable on this test host')
    else:
        source = directory / name
        other = evidence / 'unrelated.csv'
        source.rename(other)
        try:
            source.symlink_to(other)
        except OSError:
            pytest.skip('Symlink creation unavailable on this test host')
    with pytest.raises(ValueError, match='escapes|symlink'):
        package(evidence, suite='first-use')
    assert not (evidence / 'product-first-use-transfer').exists()


def strategy_fixture(tmp_path):
    evidence = tmp_path / 'evidence'
    directory = evidence / 'product-strategy-consent/L9-strategy-consent'
    directory.mkdir(parents=True)
    filename = 'strategy-single-synthetic-input.csv'
    blob = b'contract-only synthetic CSV bytes\n'
    (directory / filename).write_bytes(blob)
    artifact = {'file': filename, 'kind': 'synthetic-input', 'sha256': digest(blob), 'bytes': len(blob)}
    report = {'suite': 'strategy-consent', 'all_checks_passed': False, 'scenarios': [{
        'id': 'L9-strategy-consent', 'status': 'failed', 'artifacts': [artifact],
        'observations': {'fixture': {'csv_sha256': digest(blob)}}}]}
    (evidence / 'product-strategy-consent-audit.json').write_text(json.dumps(report))
    return evidence, directory, report


def test_strategy_evidence_transfers_exact_declared_fixture_and_preserves_failure(tmp_path):
    evidence, directory, report = strategy_fixture(tmp_path)
    (directory / 'synthetic-financial-input.csv').write_bytes(b'unrelated legacy-named file')
    manifest = package(evidence, suite='strategy-consent', part_bytes=1024)
    expected = {'product-strategy-consent-audit.json',
                'product-strategy-consent/L9-strategy-consent/strategy-single-synthetic-input.csv'}
    assert manifest['suite'] == 'strategy-consent' and manifest['audit_passed'] is False
    assert set(manifest['files']) == expected
    output = evidence / 'product-strategy-consent-transfer'
    combined = b''.join((output / f"part-{part['number']:02d}" / part['file']).read_bytes()
                        for part in manifest['parts'])
    assert digest(combined) == manifest['archive_sha256']
    with zipfile.ZipFile(BytesIO(combined)) as archive:
        assert set(archive.namelist()) == expected
        for filename in expected:
            assert digest(archive.read(filename)) == manifest['files'][filename]['sha256']


@pytest.mark.parametrize('damage', ['missing_record', 'same_hash_other_name', 'wrong_kind',
    'missing_file', 'wrong_file_hash', 'wrong_report_hash', 'missing_report_hash', 'duplicate_record'])
def test_strategy_fixture_cannot_be_replaced_by_another_artifact_or_hash(tmp_path, damage):
    evidence, directory, report = strategy_fixture(tmp_path)
    row = report['scenarios'][0]
    artifact = row['artifacts'][0]
    path = directory / artifact['file']
    if damage == 'missing_record': row['artifacts'] = []
    elif damage == 'same_hash_other_name':
        path.rename(directory / 'different-input.csv')
        artifact['file'] = 'different-input.csv'
    elif damage == 'wrong_kind': artifact['kind'] = 'download'
    elif damage == 'missing_file': path.unlink()
    elif damage == 'wrong_file_hash': path.write_bytes(b'different current bytes')
    elif damage == 'wrong_report_hash': row['observations']['fixture']['csv_sha256'] = '0' * 64
    elif damage == 'missing_report_hash': row['observations']['fixture'].pop('csv_sha256')
    else: row['artifacts'].append(dict(artifact))
    (evidence / 'product-strategy-consent-audit.json').write_text(json.dumps(report))
    with pytest.raises(ValueError, match='fixture CSV|missing|hash mismatch|Duplicate'):
        package(evidence, suite='strategy-consent')
    assert not (evidence / 'product-strategy-consent-transfer').exists()


@pytest.mark.parametrize('csv_already_created', [False, True])
def test_early_strategy_failure_preserves_current_capture_before_fixture_observation(tmp_path, csv_already_created):
    evidence, directory, report = strategy_fixture(tmp_path)
    row = report['scenarios'][0]
    row['observations'] = {}
    if not csv_already_created:
        (directory / row['artifacts'][0]['file']).unlink()
        row['artifacts'] = []
    image = b'contract-only failed-step pixels'
    (directory / 'failed.png').write_bytes(image)
    row['screenshots'] = [{'file': 'failed.png', 'sha256': digest(image)}]
    (evidence / 'product-strategy-consent-audit.json').write_text(json.dumps(report))
    manifest = package(evidence, suite='strategy-consent')
    assert manifest['audit_passed'] is False
    assert 'product-strategy-consent/L9-strategy-consent/failed.png' in manifest['files']
    assert len(manifest['files']) == 2 + int(csv_already_created)


def test_successful_strategy_report_cannot_omit_its_fixture_observation(tmp_path):
    evidence, _, report = strategy_fixture(tmp_path)
    report['all_checks_passed'] = True
    report['scenarios'][0].update(status='passed', observations={})
    (evidence / 'product-strategy-consent-audit.json').write_text(json.dumps(report))
    with pytest.raises(ValueError, match='fixture CSV'):
        package(evidence, suite='strategy-consent')


@pytest.mark.parametrize('damage',[None,'missing_observation','wrong_hash','wrong_file'])
def test_late_action_suite_binds_its_actual_registered_csv_name_and_hash(tmp_path,damage):
    import hashlib
    from scripts.pack_product_audit import package
    evidence=tmp_path/'evidence';directory=evidence/'product-late-actions/L11-late-actions';directory.mkdir(parents=True)
    name='late-actions-synthetic-input.csv';blob=b'contract-only synthetic fixture bytes';h=hashlib.sha256(blob).hexdigest()
    file='another-input.csv' if damage=='wrong_file' else name
    (directory/file).write_bytes(blob)
    scenario={'id':'L11-late-actions','status':'passed','artifacts':[{'file':file,'kind':'synthetic-input','bytes':len(blob),'sha256':h}],
        'observations':{'fixture':{'synthetic':True,'csv_sha256':'0'*64 if damage=='wrong_hash' else h}}}
    if damage=='missing_observation':scenario['observations']={}
    report={'suite':'late-actions','all_checks_passed':False,'scenarios':[scenario]}
    (evidence/'product-late-actions-audit.json').write_text(json.dumps(report))
    if damage:
        with pytest.raises(ValueError,match='Configured fixture CSV'):
            package(evidence,suite='late-actions',part_bytes=1024)
    else:
        manifest=package(evidence,suite='late-actions',part_bytes=1024)
        assert manifest['audit_passed'] is False
        assert manifest['files']['product-late-actions/L11-late-actions/'+name]['sha256']==h
