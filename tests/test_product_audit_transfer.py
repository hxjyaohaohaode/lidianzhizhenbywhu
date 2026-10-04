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
