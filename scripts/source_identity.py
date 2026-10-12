"""Fail-closed diagnostic identity for a checkout or an extracted release.

A release manifest verifies package bytes, not Git provenance or a publisher's
signature. Its commit/tree values remain explicitly *declared*, never Git HEAD.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import time
import unicodedata
from types import SimpleNamespace

from scripts.owned_process import OwnedProcess

MANIFEST = 'RELEASE_MANIFEST.json'
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
# Dependencies/data are installation state, not packaged application source.
RUNTIME_DIRS = {'.runtime', '.venv', 'venv', 'node_modules', '.pytest_cache', '.git'}
REPORT_SUFFIXES = {'.json', '.jsonl', '.log', '.xml', '.png', '.jpg', '.html'}


def guard(deadline):
    if time.monotonic() >= deadline:
        raise TimeoutError('source identity aggregate work deadline exhausted')


def digest_file(path, deadline):
    guard(deadline)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError('source must be a regular non-linked file: ' + str(path))
    size = 0
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            guard(deadline)
            size += len(chunk)
            digest.update(chunk)
    current = path.lstat()
    if (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns, current.st_ctime_ns) != (
            info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns):
        raise ValueError('source changed while hashing: ' + str(path))
    return size, digest.hexdigest()


def safe_relative(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value or '\x00' in value:
        raise ValueError('manifest path must be a canonical relative path')
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value or any(p in ('', '.', '..') for p in value.split('/')):
        raise ValueError('manifest path must be a canonical relative path: ' + value)
    if any(any(ord(c) < 32 or c in '<>"|?*' for c in p) or p.endswith(('.', ' '))
            or re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', p)
            for p in path.parts):
        raise ValueError('manifest path is not portable/safe: ' + value)
    if any(p.casefold() in RUNTIME_DIRS or p == '__pycache__' for p in path.parts):
        raise ValueError('manifest cannot declare installation/cache paths: ' + value)
    return path


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate manifest JSON key: ' + key)
        result[key] = value
    return result


def verify_manifest(root, manifest_path, deadline):
    guard(deadline)
    if manifest_path.is_symlink() or manifest_path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('manifest must be a bounded regular non-linked file')
    _, manifest_hash = digest_file(manifest_path, deadline)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'), object_pairs_hook=no_duplicate_keys)
    required = {'commit', 'tree', 'file_count', 'status', 'source_set_sha256', 'files'}
    if not isinstance(manifest, dict) or set(manifest) not in (required, required | {'artifacts'}):
        raise ValueError('invalid release manifest schema')
    if not all(isinstance(manifest[k], str) and HEX40.fullmatch(manifest[k]) for k in ('commit', 'tree')):
        raise ValueError('invalid manifest declared commit/tree')
    records = manifest['files']
    if (not isinstance(records, list) or not records or len(records) > 100000
            or type(manifest['file_count']) is not int or manifest['file_count'] != len(records)
            or not isinstance(manifest['status'], str) or not manifest['status']
            or not isinstance(manifest['source_set_sha256'], str)
            or not HEX64.fullmatch(manifest['source_set_sha256'])):
        raise ValueError('invalid manifest file count/status/digest')
    canonical = json.dumps(records, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')
    if hashlib.sha256(canonical).hexdigest() != manifest['source_set_sha256']:
        raise ValueError('manifest source set digest mismatch')
    files = {}
    normalized = set()
    for record in records:
        guard(deadline)
        if (not isinstance(record, dict) or set(record) != {'path', 'bytes', 'sha256'}
                or type(record['bytes']) is not int or record['bytes'] < 0
                or not isinstance(record['sha256'], str) or not HEX64.fullmatch(record['sha256'])):
            raise ValueError('invalid manifest file record')
        relative = safe_relative(record['path'])
        portable_name = unicodedata.normalize('NFC', relative.as_posix()).casefold()
        if portable_name in normalized:
            raise ValueError('duplicate/case-colliding manifest path: ' + str(relative))
        normalized.add(portable_name)
        path = root
        for part in relative.parts:
            path /= part
            if path.is_symlink():
                raise ValueError('manifest path contains symlink: ' + str(relative))
        size, digest = digest_file(path, deadline)
        if size != record['bytes'] or digest != record['sha256']:
            raise ValueError('manifest file bytes/hash mismatch: ' + str(relative))
        files[str(relative)] = digest
    # A self-consistent but incomplete manifest must not silently omit executable
    # code/assets. Only explicit installation roots, report output and generated
    # bytecode for declared .py source can be additional files.
    def walk(directory):
        guard(deadline)
        for path in sorted(directory.iterdir()):
            guard(deadline)
            relative = path.relative_to(root)
            if path == manifest_path:
                continue
            if path.is_symlink():
                raise ValueError('undeclared symlink in package: ' + str(relative))
            if path.is_dir():
                if len(relative.parts) == 1 and relative.name in RUNTIME_DIRS:
                    continue
                walk(path)
            elif str(relative.as_posix()) not in files:
                cache_source = None
                if relative.parent.name == '__pycache__' and path.suffix == '.pyc':
                    cache_source = relative.parent.parent / (relative.name.split('.', 1)[0] + '.py')
                if cache_source is not None and cache_source.as_posix() in files:
                    continue
                if relative.parts[0] == 'evidence' and path.suffix in REPORT_SUFFIXES:
                    continue
                raise ValueError('undeclared package source file: ' + str(relative))
    walk(root)
    artifacts = manifest.get('artifacts', [])
    if not isinstance(artifacts, list) or len(artifacts) > 100:
        raise ValueError('invalid package artifacts list')
    artifact_names = set()
    for artifact in artifacts:
        guard(deadline)
        if (not isinstance(artifact, dict) or set(artifact) != {
                'type', 'path', 'bytes', 'sha256', 'requires_commit', 'contains_commit'}
                or artifact['type'] != 'git_bundle' or type(artifact['bytes']) is not int
                or artifact['bytes'] < 0 or not isinstance(artifact['sha256'], str)
                or not HEX64.fullmatch(artifact['sha256'])
                or not all(isinstance(artifact[k], str) and HEX40.fullmatch(artifact[k])
                           for k in ('requires_commit', 'contains_commit'))
                or artifact['contains_commit'] != manifest['commit']):
            raise ValueError('invalid git bundle artifact declaration')
        relative = safe_relative(artifact['path'])
        portable_name = unicodedata.normalize('NFC', relative.as_posix()).casefold()
        if portable_name in artifact_names or relative.suffix != '.bundle':
            raise ValueError('duplicate/invalid bundle artifact path')
        artifact_names.add(portable_name)
        path = manifest_path.parent
        for part in relative.parts:
            path /= part
            if path.is_symlink():
                raise ValueError('artifact path contains symlink: ' + str(relative))
        if path.is_relative_to(root):
            raise ValueError('bundle artifact must be outside application source')
        size, artifact_hash = digest_file(path, deadline)
        if size != artifact['bytes'] or artifact_hash != artifact['sha256']:
            raise ValueError('package artifact bytes/hash mismatch: ' + str(relative))
    guard(deadline)
    if digest_file(manifest_path, deadline)[1] != manifest_hash:
        raise ValueError('manifest changed during verification')
    return {'kind': 'package-source', 'verified': True, 'git_head': None,
            'manifest_declared_commit': manifest['commit'], 'manifest_declared_tree': manifest['tree'],
            'manifest_sha256': manifest_hash, 'source_set_sha256': manifest['source_set_sha256'],
            'file_count': len(files), 'files_sha256': files,
            'package_artifacts': artifacts,
            'artifact_verification': 'Attachment bytes/hashes only; bundle commit claims are declarations, not inspected Git history.',
            'provenance': 'Manifest declaration only; Git history/publisher authenticity not verified.',
            'excluded_unlisted_state': ['root installation/cache directories',
                'generated bytecode for declared Python source', 'non-code evidence reports']}


def collect_source_identity(root, paths, *, scratch_root, register_process,
                            process_deadline, work_deadline, cleanup_reserve, phase):
    """Use the caller's one process budget and cleanup registry, with no fallback.

    A present but invalid manifest always fails, even in a Git checkout. Without
    a manifest, a nested directory must never inherit an unrelated parent's HEAD.
    """
    root = Path(root).resolve()
    guard(work_deadline)
    manifests = [p for p in (root / MANIFEST, root.parent / MANIFEST) if p.exists() or p.is_symlink()]
    if len(manifests) > 1:
        raise ValueError('ambiguous release manifests')
    if manifests:
        return verify_manifest(root, manifests[0], work_deadline)
    marker = root / '.git'
    if marker.is_symlink() or not (marker.is_file() or marker.is_dir()):
        raise ValueError('source identity unverified: no local Git metadata or release manifest')
    files = {}
    for path in sorted(set(paths)):
        path = Path(path)
        relative = path.relative_to(root)
        cursor = root
        for part in relative.parts:
            cursor /= part
            if cursor.is_symlink():
                raise ValueError('source path contains symlink: ' + str(relative))
        files[relative.as_posix()] = digest_file(path, work_deadline)[1]
    log = Path(scratch_root) / ('source-' + phase + '.log')
    descriptor = SimpleNamespace(case='source_identity', phase=phase, log=log)
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env['GIT_TERMINAL_PROMPT'] = '0'
    guard(work_deadline)
    process = OwnedProcess(['git', 'rev-parse', '--show-toplevel', '--verify', 'HEAD'],
        cwd=root, env=env, stdout_path=log, temp_root=scratch_root,
        deadline=process_deadline, cleanup_reserve=cleanup_reserve)
    register_process(descriptor, process)
    result = process.wait()
    guard(work_deadline)
    lines = log.read_text(encoding='utf-8', errors='replace').strip().splitlines()
    if (result.returncode != 0 or not result.cleanup_confirmed or len(lines) != 2
            or Path(lines[0]).resolve() != root or not HEX40.fullmatch(lines[1])):
        raise ValueError('cannot verify this checkout Git root/HEAD: ' + repr(lines)[:1000])
    return {'kind': 'git-checkout', 'verified': True, 'git_head': lines[1], 'files_sha256': files,
            'worktree_matches_commit': None,
            'provenance': 'Git HEAD metadata verified for this root; worktree cleanliness not asserted. Actual diagnostic source bytes are identified by files_sha256.'}
