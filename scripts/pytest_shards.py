"""Two complete, separately journaled pytest sessions under one wall deadline.

This is also the explicit collection/admission plugin. Historical node lists are
never inputs. Only the current invocation's unfiltered collection is authority.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET

import pytest

SCHEMA = 'pytest-two-shards-v1'
ALGORITHM = 'lexical-nodeid-alternate-original-order-v1'
MAX_SECONDS = 1500
from scripts.pytest_output_contract import OUTPUTS


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(',', ':')).encode('utf-8')).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def clear_outputs(out):
    for name in OUTPUTS:
        path = Path(out) / name
        if path.is_file() or path.is_symlink():
            path.unlink()


def unique_ids(ids):
    if not isinstance(ids, list) or not ids or not all(isinstance(x, str) and x for x in ids):
        raise ValueError('missing or invalid collection identities')
    if len(Counter(ids)) != len(ids):
        raise ValueError('duplicate collection identities')
    return ids


def assignments(ids):
    unique_ids(ids)
    owners = {node: i % 2 for i, node in enumerate(sorted(ids))}
    return [[node for node in ids if owners[node] == i] for i in range(2)]


def source_identity(root, deadline=None):
    def remaining():
        seconds = 10 if deadline is None else min(10, deadline - time.monotonic())
        if seconds <= 0:
            raise TimeoutError('source identity exceeded aggregate deadline')
        return seconds
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, timeout=remaining())
    paths = [p for p in git('ls-files', '-z').decode('utf-8').split('\0')
             if p and not p.startswith('evidence/')]
    # Evidence is generated; the installed dependency link is not source.
    # All other tracked source/config/assets and unexpected files must be clean.
    dirty = git('status', '--porcelain', '--untracked-files=all', '--', '.', ':!evidence', ':!node_modules').decode('utf-8')
    if dirty:
        raise ValueError('source checkout has tracked or untracked changes outside evidence')
    hashes = {}
    for p in paths:
        remaining()
        hashes[p] = hashlib.sha256((Path(root) / p).read_bytes()).hexdigest()
    return {'commit': git('rev-parse', 'HEAD').decode().strip(),
        'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
        'files': hashes, 'source_sha256': digest(hashes)}


def plugin_identity(config):
    return sorted([{'name': dist.project_name, 'version': dist.version}
        for _, dist in config.pluginmanager.list_plugin_distinfo()], key=lambda x: (x['name'], x['version']))


def pytest_addoption(parser):
    parser.getgroup('complete backend shards').addoption('--shard-request')


def pytest_configure(config):
    path = config.getoption('--shard-request')
    if path:
        config.pluginmanager.register(Admission(config, Path(path)), 'complete-shard-admission')


class Admission:
    def __init__(self, config, path):
        self.config = config
        self.request = json.loads(path.read_text(encoding='utf-8'))
        self.raw = []
        self.full = None
        self.selected = None
        self.admitted = False
        options = config.option
        if (options.keyword or options.markexpr or options.maxfail or
                any(getattr(options, n, False) for n in ('lf', 'failedfirst', 'stepwise', 'stepwise_skip')) or
                config.getini('addopts') not in ([], ['-ra'])):
            raise pytest.UsageError('sharded acceptance rejects selection, retry and fail-fast options')
        if source_identity(Path(self.request['root']), self.request['deadline']) != self.request['source']:
            raise pytest.UsageError('source identity changed before collection')
        if self.request['mode'] == 'child':
            manifest = json.loads(Path(self.request['manifest_path']).read_text(encoding='utf-8'))
            if (digest(manifest) != self.request['manifest_sha256'] or
                    manifest['invocation_id'] != self.request['invocation_id'] or
                    manifest['source'] != self.request['source']):
                raise pytest.UsageError('wrong invocation, source or manifest identity')
            unique_ids(manifest['nodeids'])
            if manifest['assignments'] != assignments(manifest['nodeids']):
                raise pytest.UsageError('manifest assignment mismatch')
            if plugin_identity(config) != manifest['plugins']:
                raise pytest.UsageError('plugin identity changed after collection')
            self.manifest = manifest

    @pytest.hookimpl(tryfirst=True)
    def pytest_itemcollected(self, item):
        # Capture actual discovery independently of collection-modifier wrappers.
        self.raw.append(item.nodeid)

    @pytest.hookimpl(wrapper=True, tryfirst=True)
    def pytest_collection_modifyitems(self, session, config, items):
        before = [item.nodeid for item in items]
        yield
        after = [item.nodeid for item in items]
        unique_ids(before)
        if self.raw != before or before != after:
            raise pytest.UsageError('another plugin altered the unfiltered collection')
        self.full = before
        if self.request['mode'] == 'child':
            if before != self.manifest['nodeids']:
                raise pytest.UsageError('full child discovery differs from frozen collection')
            self.selected = self.manifest['assignments'][self.request['shard_index']]
            members = set(self.selected)
            items[:] = [item for item in items if item.nodeid in members]
        else:
            self.selected = before

    @pytest.hookimpl(trylast=True)
    def pytest_collection_finish(self, session):
        if self.full is None or [item.nodeid for item in session.items] != self.selected:
            raise pytest.UsageError('final selected collection changed after admission')
        if source_identity(Path(self.request['root']), self.request['deadline']) != self.request['source']:
            raise pytest.UsageError('source identity changed during collection')
        self.admitted = True
        if self.request['mode'] == 'child':
            from scripts.pytest_diagnostics import Diagnostics
            i = self.request['shard_index']
            identity = {k: self.request[k] for k in ('invocation_id', 'manifest_sha256', 'shard_index')}
            identity.update(assignment_sha256=digest(self.selected),
                source_sha256=self.request['source']['source_sha256'])
            for item in session.items:
                properties = {'lidian_' + key: str(value) for key, value in identity.items()}
                properties['lidian_nodeid'] = item.nodeid
                if any(key in properties for key, _ in item.user_properties):
                    raise pytest.UsageError('reserved JUnit identity property collision')
                item.user_properties.extend(properties.items())
            diagnostics = Diagnostics(Path(self.request['journal']), self.request['test_timeout'],
                identity=identity, admission={'full_nodeids': self.full,
                    'assigned_nodeids': self.selected,
                    'peer_nodeids': self.manifest['assignments'][1-i]})
            self.config.pluginmanager.register(diagnostics, 'verification-progress')
            diagnostics.pytest_collection_finish(session)

    @pytest.hookimpl(trylast=True)
    def pytest_sessionfinish(self, session, exitstatus):
        if self.request['mode'] == 'collect':
            atomic_json(self.request['collection_path'], {'schema': SCHEMA,
                'kind': 'collection-only', 'invocation_id': self.request['invocation_id'],
                'source': self.request['source'], 'nodeids': self.full, 'raw_nodeids': self.raw,
                'plugins': plugin_identity(self.config),
                'collection_complete': self.admitted and int(session.exitstatus) == 0,
                'exit_code': int(session.exitstatus)})


def validate_collection(value, invocation, source):
    if (value.get('schema') != SCHEMA or value.get('kind') != 'collection-only' or
            value.get('invocation_id') != invocation or value.get('source') != source or
            value.get('collection_complete') is not True or value.get('exit_code') != 0):
        raise ValueError('incomplete or foreign collection receipt')
    ids = unique_ids(value.get('nodeids'))
    if value.get('raw_nodeids') != ids:
        raise ValueError('final collection differs from raw discovered item stream')
    return ids


def validate_child(out, manifest, manifest_hash, i, result):
    if (result.get('returncode') != 0 or result.get('cleanup_confirmed') is not True or
            result.get('error') or result.get('timed_out') or result.get('cancelled')):
        raise ValueError(f'shard {i} process exit or cleanup failed')
    for suffix in ('.log', '.xml', '-progress.jsonl', '-progress.stacks.log'):
        if not (Path(out) / f'pytest-shard-{i}{suffix}').is_file():
            raise ValueError(f'shard {i} missing original output {suffix}')
    journal = Path(out) / f'pytest-shard-{i}-progress.jsonl'
    events = [json.loads(line) for line in journal.read_text(encoding='utf-8').splitlines()]
    starts = [e for e in events if e.get('event') == 'session_started']
    ends = [e for e in events if e.get('event') == 'session_finished']
    expected = manifest['assignments'][i]
    identity = {'invocation_id': manifest['invocation_id'], 'manifest_sha256': manifest_hash,
        'shard_index': i, 'assignment_sha256': digest(expected),
        'source_sha256': manifest['source']['source_sha256']}
    if len(starts) != 1 or len(ends) != 1 or not events or events[-1] is not ends[0]:
        raise ValueError(f'shard {i} missing unique terminal session')
    if events[0] is not starts[0]:
        raise ValueError(f'shard {i} journal does not begin with its session')
    collections = [e for e in events if e.get('event') == 'collection_finished']
    if len(collections) != 1 or collections[0].get('collected') != len(expected):
        raise ValueError(f'shard {i} missing collection completion')
    if starts[0].get('identity') != identity:
        raise ValueError(f'shard {i} journal identity mismatch')
    if starts[0].get('admission') != {'full_nodeids': manifest['nodeids'],
            'assigned_nodeids': expected, 'peer_nodeids': manifest['assignments'][1-i]}:
        raise ValueError(f'shard {i} admission mismatch')
    end = ends[0]
    if (end.get('complete') is not True or end.get('exit_code') != 0 or
            any(end.get(k) != len(expected) for k in ('collected', 'started', 'completed'))):
        raise ValueError(f'shard {i} incomplete terminal session')
    census = {}
    for event in ('test_collected', 'test_started', 'test_finished'):
        rows = [e for e in events if e.get('event') == event]
        ids = [e.get('nodeid') for e in rows]
        if Counter(ids) != Counter(expected) or ids != expected:
            raise ValueError(f'shard {i} {event} identities/order do not equal assignment')
        if event == 'test_finished' and any(e.get('complete') is not True or e.get('interrupted') is not False for e in rows):
            raise ValueError(f'shard {i} incomplete test protocol')
        census[event] = ids
    phases = {node: Counter() for node in expected}
    phase_outcomes = Counter()
    phase_starts = {node: [] for node in expected}
    for event in events:
        if 'nodeid' in event and event['nodeid'] not in phases:
            raise ValueError(f'shard {i} foreign node identity')
        if event.get('event') == 'phase_started':
            phase_starts[event['nodeid']].append(event.get('phase'))
        if event.get('event') == 'phase_finished':
            if (event.get('phase') not in ('setup', 'call', 'teardown') or
                    event.get('outcome') != 'passed' or event.get('wasxfail') is not False):
                raise ValueError(f'shard {i} non-passing phase or expected failure')
            phases[event['nodeid']][event['phase']] += 1
            phase_outcomes[event['phase'] + '_passed'] += 1
    if any(value != ['setup', 'call', 'teardown'] for value in phase_starts.values()):
        raise ValueError(f'shard {i} missing or out-of-order phase starts')
    # unittest subtests legitimately emit several call reports; retain all of them.
    if any(counts['setup'] != 1 or counts['teardown'] != 1 or counts['call'] < 1 for counts in phases.values()):
        raise ValueError(f'shard {i} missing or duplicate test phases')
    if dict(phase_outcomes) != end.get('phase_outcomes'):
        raise ValueError(f'shard {i} phase summary mismatch')
    xml = ET.parse(Path(out) / f'pytest-shard-{i}.xml').getroot()
    suites = list(xml.iter('testsuite'))
    if not suites or not list(xml.iter('testcase')):
        raise ValueError(f'shard {i} missing JUnit test results')
    if any(list(xml.iter(tag)) for tag in ('failure', 'error', 'skipped')):
        raise ValueError(f'shard {i} unsuccessful JUnit result')
    if any(int(s.get(key, '0')) != 0 for s in suites for key in ('failures', 'errors', 'skipped')):
        raise ValueError(f'shard {i} unsuccessful JUnit counts')
    junit_nodes = []
    for case in xml.iter('testcase'):
        pairs = [(p.get('name'), p.get('value')) for p in case.findall('./properties/property')
                 if p.get('name', '').startswith('lidian_')]
        properties = dict(pairs)
        nodeid = properties.get('lidian_nodeid')
        binding = {'lidian_' + key: str(value) for key, value in identity.items()}
        binding['lidian_nodeid'] = nodeid
        if len(pairs) != len(properties) or properties != binding or nodeid not in phases:
            raise ValueError(f'shard {i} foreign or missing JUnit identity')
        junit_nodes.append(nodeid)
    # Multiple cases per node are valid for unittest subtests; terminal protocols
    # above, not JUnit case counts, are the exactly-once census.
    if set(junit_nodes) != set(expected):
        raise ValueError(f'shard {i} JUnit does not cover its assigned nodes')
    return {'terminal_nodeids': census['test_finished'], 'phase_outcomes': dict(phase_outcomes)}


def artifact_hashes(out):
    return {name: {'sha256': hashlib.sha256((Path(out)/name).read_bytes()).hexdigest(),
        'bytes': (Path(out)/name).stat().st_size} for name in OUTPUTS
        if name != 'pytest-shards.json' and (Path(out)/name).is_file()}


def run(root, out, timeout=MAX_SECONDS, *, test_timeout=120, deadline=None):
    """Return honest aggregate exit, human summary, and machine receipt.

    Shorter deadlines/watchdogs are available for isolated adverse harnesses;
    acceptance always uses 1500/120. No selection or increased budget exists.
    """
    from scripts.owned_process import OwnedProcess
    started = time.monotonic() if deadline is None else deadline - timeout
    deadline = started + timeout
    if not 0 < timeout <= MAX_SECONDS or not 0 < test_timeout <= 120:
        raise ValueError('unbounded verification deadline')
    root, out = Path(root).resolve(), Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    invocation = str(uuid.uuid4())
    receipt = {'schema': SCHEMA, 'kind': 'aggregate-of-two-original-sessions',
        'invocation_id': invocation, 'started_at': datetime.now(timezone.utc).isoformat(),
        'status': 'incomplete', 'exit_code': 1, 'cleanup_confirmed': True,
        'timeout_seconds': timeout, 'test_timeout_seconds': test_timeout,
        'collection': None, 'children': [], 'errors': []}
    processes = []
    temporary = None
    summary = ''
    boundary = False
    try:
        clear_outputs(out)
        boundary = True
        atomic_json(out / 'pytest-shards.json', receipt)
        if os.environ.get('PYTEST_ADDOPTS', '').strip() or os.environ.get('PYTEST_PLUGINS', '').strip():
            raise ValueError('acceptance rejects inherited PYTEST_ADDOPTS/PYTEST_PLUGINS')
        source = source_identity(root, deadline)
        receipt.update(source=source, context={'event_sha': os.getenv('GITHUB_SHA', ''),
            'run_id': os.getenv('GITHUB_RUN_ID', ''), 'run_attempt': os.getenv('GITHUB_RUN_ATTEMPT', ''),
            'event_name': os.getenv('GITHUB_EVENT_NAME', ''), 'platform': platform.platform(),
            'python': sys.version, 'executable': sys.executable, 'pytest': pytest.__version__})
        temporary = Path(tempfile.mkdtemp(prefix='lidian-pytest-'))
        if out == temporary or out in temporary.parents:
            raise ValueError('temporary data must remain outside evidence')
        # Give cleanup and aggregation time inside, never after, the total wall cap.
        aggregate_reserve = min(8.0, timeout / 10)
        process_deadline = deadline - aggregate_reserve
        cleanup_reserve = min(12.0, timeout / 5)
        base = [sys.executable, '-m', 'pytest', '-q', '-p', 'no:faulthandler',
            '-p', 'scripts.pytest_shards', '-p', 'scripts.pytest_diagnostics',
            '-c', str(root/'pyproject.toml'), '--durations=20']
        common = {'invocation_id': invocation, 'root': str(root), 'source': source,
            'test_timeout': test_timeout, 'deadline': process_deadline-cleanup_reserve}
        def launch(label, request, extra):
            local = temporary / label
            local.mkdir()
            request_path = local / 'request.json'
            atomic_json(request_path, request)
            env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONDONTWRITEBYTECODE': '1',
                'DATA_DIR': str(local/'data'), 'TMPDIR': str(local), 'TMP': str(local), 'TEMP': str(local)}
            command = base + ['--shard-request=' + str(request_path),
                '--basetemp=' + str(local/'fixtures'), '-o', 'cache_dir=' + str(local/'cache'), *extra]
            process = OwnedProcess(command, cwd=root, env=env, stdout_path=out/f'pytest-{label}.log',
                deadline=process_deadline, cleanup_reserve=cleanup_reserve, temp_root=local)
            processes.append(process)
            return process, command
        collection, command = launch('collection', {**common, 'mode': 'collect',
            'collection_path': str(out/'pytest-collection.json')}, ['--collect-only'])
        receipt['collection'] = {'command': command, 'status': 'running'}
        result = collection.wait().as_dict()
        receipt['collection'].update(result, status='finished')
        if (result['returncode'] != 0 or not result['cleanup_confirmed'] or
                result.get('error') or result.get('timed_out') or result.get('cancelled')):
            raise ValueError('collection process failed or cleanup unconfirmed')
        value = json.loads((out/'pytest-collection.json').read_text(encoding='utf-8'))
        ids = validate_collection(value, invocation, source)
        receipt['collection_sha256'] = digest(value)
        manifest = {'schema': SCHEMA, 'invocation_id': invocation, 'source': source,
            'algorithm': ALGORITHM, 'nodeids': ids, 'nodeids_sha256': digest(ids),
            'assignments': assignments(ids), 'plugins': value['plugins']}
        if any(not selected for selected in manifest['assignments']):
            raise ValueError('two nonempty shard assignments required')
        manifest_hash = digest(manifest)
        atomic_json(out/'pytest-manifest.json', manifest)
        receipt['manifest_sha256'] = manifest_hash
        if source_identity(root, deadline) != source:
            raise ValueError('source identity changed before child launch')
        children = []
        for i in range(2):
            process, command = launch(f'shard-{i}', {**common, 'mode': 'child', 'shard_index': i,
                'manifest_path': str(out/'pytest-manifest.json'), 'manifest_sha256': manifest_hash,
                'journal': str(out/f'pytest-shard-{i}-progress.jsonl')},
                ['--junitxml=' + str(out/f'pytest-shard-{i}.xml')])
            children.append(process)
            receipt['children'].append({'shard_index': i, 'command': command, 'status': 'running'})
        atomic_json(out/'pytest-shards.json', receipt)
        # Both processes have started before either wait. Owned guardians monitor
        # the same deadline and controller death independently of these waits.
        for i, child in enumerate(children):
            receipt['children'][i].update(child.wait().as_dict(), status='finished')
        actual = [validate_child(out, manifest, manifest_hash, i, receipt['children'][i]) for i in range(2)]
        terminal = [Counter(a['terminal_nodeids']) for a in actual]
        if terminal[0] & terminal[1] or terminal[0] + terminal[1] != Counter(ids):
            raise ValueError('actual terminal union does not equal fresh full collection')
        if (digest(json.loads((out/'pytest-manifest.json').read_text(encoding='utf-8'))) != manifest_hash or
                digest(json.loads((out/'pytest-collection.json').read_text(encoding='utf-8'))) != receipt['collection_sha256']):
            raise ValueError('collection or manifest changed during execution')
        if source_identity(root, deadline) != source:
            raise ValueError('source identity drift after execution')
        receipt['coverage'] = {'full_count': len(ids), 'child_counts': [len(a['terminal_nodeids']) for a in actual],
            'disjoint': True, 'exhaustive_with_multiplicity': True, 'actual': actual}
        receipt['status'] = 'passed'
        receipt['exit_code'] = 0
    except (Exception, KeyboardInterrupt) as exc:
        receipt['status'] = 'failed'
        receipt['errors'].append(type(exc).__name__ + ': ' + str(exc))
    finally:
        for process in processes:
            process.request_cancel()
        for index, process in enumerate(processes):
            try:
                result = process.wait().as_dict()
                record = (receipt['collection'] if index == 0 else
                    receipt['children'][index-1] if index <= len(receipt['children']) else None)
                if record is not None:
                    record.update(result, status='finished')
                if result.get('cleanup_confirmed') is not True:
                    receipt['cleanup_confirmed'] = False
            except Exception as exc:
                receipt['cleanup_confirmed'] = False
                receipt['errors'].append('cleanup: ' + type(exc).__name__ + ': ' + str(exc))
        if temporary is not None and receipt['cleanup_confirmed']:
            try:
                shutil.rmtree(temporary)
            except OSError as exc:
                receipt['errors'].append('temporary cleanup: ' + type(exc).__name__)
                receipt['exit_code'] = 1
        if not receipt['cleanup_confirmed']:
            receipt['exit_code'] = 1
        if receipt['exit_code']:
            receipt['status'] = 'failed'
        receipt['evidence_boundary_established'] = boundary
        summary = ('Two original pytest child sessions; aggregate ' + receipt['status'] + '\n' +
            '\n'.join(receipt['errors']) + '\nOriginal outputs: pytest-collection.log, '
            'pytest-shard-0.log, pytest-shard-1.log; receipt: pytest-shards.json\n')
        (out/'pytest.log').write_text(summary, encoding='utf-8')
        receipt['artifacts'] = artifact_hashes(out) if boundary else {}
        # Hashing and writing the original outputs are inside the same deadline.
        # The final write is checked afterward as well; a late write cannot make
        # a green return or leave an accepted green receipt behind.
        def fail_deadline():
            nonlocal summary
            receipt.update(status='failed', exit_code=1, within_deadline=False)
            if 'aggregate wall deadline exceeded' not in receipt['errors']:
                receipt['errors'].append('aggregate wall deadline exceeded')
            summary = 'Two original pytest child sessions; aggregate failed\n' + '\n'.join(receipt['errors']) + '\n'
            (out/'pytest.log').write_text(summary, encoding='utf-8')
            data = (out/'pytest.log').read_bytes()
            receipt['artifacts']['pytest.log'] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
        receipt['seconds_before_final_receipt_write'] = round(time.monotonic() - started, 6)
        receipt['within_deadline'] = time.monotonic() < deadline
        if not receipt['within_deadline']:
            fail_deadline()
        atomic_json(out/'pytest-shards.json', receipt)
        if time.monotonic() >= deadline:
            fail_deadline()
            receipt['seconds_before_final_receipt_write'] = round(time.monotonic() - started, 6)
            try:
                atomic_json(out/'pytest-shards.json', receipt)
            except OSError:
                # If correcting a late successful receipt fails, remove it so
                # consumers cannot mistake the earlier provisional write for pass.
                (out/'pytest-shards.json').unlink(missing_ok=True)
                raise
    return receipt['exit_code'], summary, receipt


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    raise SystemExit(run(root, root/'evidence')[0])
