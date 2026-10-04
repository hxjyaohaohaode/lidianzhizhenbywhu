"""Package only this audit report's evidence into bounded, lossless transfers.

Each fragment is uploaded as its own artifact and stays below the receiver's
32 MiB ZIP limit. Reassemble in manifest order, then verify the whole archive
and every file hash before inspecting the screenshots, traces and videos.
Never truncate, recompress images, or treat packaging success as UI success.
"""
from pathlib import Path
import hashlib
import json
import re
import zipfile

PART_BYTES = 24 * 1024 * 1024
MAX_PARTS = 16
ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def package(evidence, *, part_bytes=PART_BYTES, max_parts=MAX_PARTS):
    evidence = Path(evidence).resolve()
    report_path = evidence / 'product-browser-audit.json'
    report = json.loads(report_path.read_text(encoding='utf-8'))
    audit = evidence / 'product-audit'
    selected = {}

    def include(path, expected=None, optional=False):
        path = Path(path)
        if not path.resolve().is_relative_to(evidence) or path.is_symlink():
            raise ValueError('Evidence path escapes the current output directory')
        if optional and not path.exists():
            return
        if not path.is_file():
            raise ValueError('Expected current evidence file is missing: ' + str(path.relative_to(evidence)))
        actual = sha256(path)
        if expected is not None and actual != expected:
            raise ValueError('Evidence hash mismatch: ' + str(path.relative_to(evidence)))
        selected[path.relative_to(evidence).as_posix()] = {'bytes': path.stat().st_size, 'sha256': actual}

    include(report_path)
    for name in ('run-context.json', 'product-audit-service-command.json',
                 'product-audit-service-browser.log', 'product-audit-server.log',
                 'product-audit-process-events.jsonl'):
        include(evidence / name, optional=True)
    for row in report.get('scenarios', []):
        code = row['id']
        if not re.fullmatch(r'[A-Za-z0-9-]+', code):
            raise ValueError('Invalid scenario identifier')
        directory = audit / code
        for screenshot in row.get('screenshots', []):
            include(directory / screenshot['file'], screenshot['sha256'])
        for kind in ('trace', 'video', 'diagnostic_journal'):
            item = row.get(kind)
            if item:
                include(audit / item['file'], item['sha256'])
        # The current root report already embeds each scenario and its steps.
        # Do not sweep auxiliary JSON that may belong to an earlier attempt.
        fixture_hash = row.get('observations', {}).get('fixture', {}).get('csv_sha256')
        if fixture_hash:
            include(directory / 'synthetic-financial-input.csv', fixture_hash)

    if not 1 <= part_bytes <= PART_BYTES or not 1 <= max_parts <= MAX_PARTS:
        raise ValueError('Transfer bounds cannot exceed the declared safe limits')
    output = evidence / 'product-audit-transfer'
    output.mkdir(exist_ok=False)  # Never silently reuse a prior run's fragments.
    archive = output / 'current-evidence.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as target:
        for name in sorted(selected):
            target.write(evidence / name, name)
    archive_size = archive.stat().st_size
    required = (archive_size + part_bytes - 1) // part_bytes
    if required > max_parts:
        raise ValueError(f'Current evidence needs {required} fragments, exceeds explicit {max_parts} limit; no evidence was truncated')
    manifest = {'format': 'lidian-native-audit-fragments-v1', 'part_bytes_limit': part_bytes,
                'archive_bytes': archive_size, 'archive_sha256': sha256(archive),
                'source_report_sha256': sha256(report_path), 'audit_passed': report.get('all_checks_passed') is True,
                'runner': report.get('runner', {}), 'git': report.get('git', {}),
                'files': selected, 'parts': []}
    with archive.open('rb') as source:
        for number in range(1, required + 1):
            directory = output / f'part-{number:02d}'
            directory.mkdir()
            part = directory / f'part-{number:02d}.bin'
            part.write_bytes(source.read(part_bytes))
            manifest['parts'].append({'number': number, 'file': part.name,
                                      'bytes': part.stat().st_size, 'sha256': sha256(part)})
        assert source.read(1) == b''
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if len(text.encode('utf-8')) > 1024 * 1024:
        raise ValueError('Transfer manifest exceeds the explicit 1 MiB metadata bound')
    (output / 'manifest.json').write_text(text, encoding='utf-8')
    for part in manifest['parts']:
        (output / f"part-{part['number']:02d}" / 'manifest.json').write_text(text, encoding='utf-8')
    return manifest


def main():
    evidence = ROOT / 'evidence'
    status_path = evidence / 'product-audit-transfer-status.json'
    status = {'status': 'running', 'complete': False}
    status_path.write_text(json.dumps(status), encoding='utf-8')
    try:
        result = package(evidence)
        status.update(status='completed', complete=True, parts=len(result['parts']),
                      archive_bytes=result['archive_bytes'], archive_sha256=result['archive_sha256'],
                      audit_passed=result['audit_passed'])
        print(json.dumps(status))
    except Exception as exc:
        status.update(status='failed', error_type=type(exc).__name__, error=str(exc))
        raise
    finally:
        status_path.write_text(json.dumps(status, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
