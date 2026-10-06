"""Bounded real sessions plus corruption of their original receipts fail closed."""
from collections import Counter
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest
from scripts import pytest_shards as shards

ROOT = Path(__file__).resolve().parents[1]


def project(path, source, conftest=''):
    path.mkdir()
    (path/'tests').mkdir()
    (path/'pyproject.toml').write_text('[tool.pytest.ini_options]\ntestpaths=["tests"]\naddopts="-ra"\n', encoding='utf-8')
    (path/'.gitignore').write_text('__pycache__/\n.pytest_cache/\nevidence/\n', encoding='utf-8')
    (path/'tests/test_probe.py').write_text(source, encoding='utf-8')
    (path/'tests/conftest.py').write_text(conftest, encoding='utf-8')
    for command in (['init', '-q'], ['add', '.'], ['-c', 'user.name=Harness', '-c',
            'user.email=harness@example.invalid', 'commit', '-qm', 'Isolated synthetic harness']):
        subprocess.run(['git', *command], cwd=path, check=True, capture_output=True)
    return path


def execute(path, monkeypatch, **kwargs):
    monkeypatch.setenv('PYTHONPATH', str(ROOT))
    monkeypatch.delenv('PYTEST_ADDOPTS', raising=False)
    monkeypatch.delenv('PYTEST_PLUGINS', raising=False)
    return shards.run(path, path/'evidence', timeout=30, **kwargs)


@pytest.fixture(scope='module')
def successful(tmp_path_factory):
    path = project(tmp_path_factory.mktemp('shard-success')/'project', '''
import pytest
import unittest
@pytest.mark.parametrize('value', [0, 1, 2], ids=['汉 字[甲]', 'a::b / []', 'last'])
def test_parameter(value): assert value >= 0
class TestSubtests(unittest.TestCase):
    def test_subtests(self):
        for value in range(3):
            with self.subTest(value=value): self.assertGreaterEqual(value, 0)
''')
    with pytest.MonkeyPatch.context() as monkeypatch:
        code, text, receipt = execute(path, monkeypatch)
    assert code == 0, text
    return path, receipt


def test_two_original_sessions_preserve_complete_ids_order_and_subtests(successful):
    path, receipt = successful
    out = path/'evidence'
    manifest = json.loads((out/'pytest-manifest.json').read_text(encoding='utf-8'))
    assert len(manifest['nodeids']) == 4
    assert receipt['coverage']['full_count'] == 4
    assert receipt['kind'] == 'aggregate-of-two-original-sessions'
    assert receipt['within_deadline'] and receipt['cleanup_confirmed']
    assert Counter(sum(manifest['assignments'], [])) == Counter(manifest['nodeids'])
    assert not set(manifest['assignments'][0]) & set(manifest['assignments'][1])
    for i in range(2):
        assert manifest['assignments'][i] == [x for x in manifest['nodeids'] if x in set(sorted(manifest['nodeids'])[i::2])]
        events = [json.loads(x) for x in (out/f'pytest-shard-{i}-progress.jsonl').read_text(encoding='utf-8').splitlines()]
        assert events[-1]['event'] == 'session_finished' and events[-1]['complete']
        assert events[0]['identity']['shard_index'] == i
    assert sum(sum(a['phase_outcomes'].values()) for a in receipt['coverage']['actual']) > 3*4
    assert not (out/'pytest.xml').exists() and not (out/'pytest-progress.jsonl').exists()
    assert not any((out/name).exists() for name in ('data', 'cache', 'fixtures', 'request.json'))


@pytest.mark.parametrize('damage', ['wrong-invocation', 'wrong-manifest', 'foreign-node', 'duplicate-node',
    'missing-node', 'missing-finish', 'truncated', 'skip', 'xfail', 'xpass', 'failed-subtest',
    'short-protocol', 'missing-phase-starts', 'missing-junit', 'foreign-junit', 'junit-failure',
    'child-nonzero', 'cleanup-unconfirmed'])
def test_corrupted_original_evidence_never_aggregates_as_success(successful, tmp_path, damage):
    path, receipt = successful
    out = tmp_path/'evidence'
    shutil.copytree(path/'evidence', out)
    manifest = json.loads((out/'pytest-manifest.json').read_text(encoding='utf-8'))
    index = next(i for i, a in enumerate(receipt['coverage']['actual']) if a['phase_outcomes']['call_passed'] > 2)
    result = copy.deepcopy(receipt['children'][index])
    journal = out/f'pytest-shard-{index}-progress.jsonl'
    events = [json.loads(x) for x in journal.read_text(encoding='utf-8').splitlines()]
    phase = next(e for e in events if e['event'] == 'phase_finished' and e['phase'] == 'call')
    if damage == 'wrong-invocation': events[0]['identity']['invocation_id'] = 'stale'
    if damage == 'wrong-manifest': events[0]['identity']['manifest_sha256'] = 'foreign'
    if damage == 'foreign-node': phase['nodeid'] = 'foreign::test'
    if damage == 'duplicate-node': events.insert(-1, copy.deepcopy(next(e for e in events if e['event'] == 'test_finished')))
    if damage == 'missing-node': events = [e for e in events if e['event'] != 'test_started']
    if damage == 'missing-finish': events.pop()
    if damage == 'missing-phase-starts': events = [e for e in events if e['event'] != 'phase_started']
    if damage == 'skip': phase['outcome'] = 'skipped'
    if damage in ('xfail', 'xpass'): phase['wasxfail'] = True
    if damage == 'failed-subtest': phase['outcome'] = 'failed'
    if damage == 'short-protocol': next(e for e in events if e['event'] == 'test_finished')['complete'] = False
    if damage == 'missing-junit': (out/f'pytest-shard-{index}.xml').unlink()
    if damage == 'foreign-junit': (out/f'pytest-shard-{index}.xml').write_text('<testsuites><testsuite failures="0" errors="0" skipped="0"><testcase name="foreign"/></testsuite></testsuites>')
    if damage == 'junit-failure': (out/f'pytest-shard-{index}.xml').write_text('<testsuites><testsuite failures="1"><testcase><failure/></testcase></testsuite></testsuites>')
    if damage == 'child-nonzero': result['returncode'] = 1
    if damage == 'cleanup-unconfirmed': result['cleanup_confirmed'] = False
    journal.write_text('\n'.join(json.dumps(e) for e in events)+'\n', encoding='utf-8')
    if damage == 'truncated': journal.write_text(journal.read_text()+'{"event":', encoding='utf-8')
    with pytest.raises((ValueError, FileNotFoundError)):
        shards.validate_child(out, manifest, receipt['manifest_sha256'], index, result)


@pytest.mark.parametrize('source,conftest', [
    ('def test_a(): pass\ndef test_b(): pass\n', 'def pytest_collection_modifyitems(items): items.pop()\n'),
    ('raise RuntimeError("collection failed")\n', ''),
    ('def test_a(): pass\ndef test_b(): pass\n', 'import pytest\n@pytest.hookimpl(wrapper=True)\ndef pytest_collection_finish(session):\n yield\n session.items.pop()\n'),
    ('import pytest\n@pytest.mark.skip(reason="probe")\ndef test_a(): pass\ndef test_b(): pass\n', ''),
    ('import pytest\n@pytest.mark.xfail(reason="probe", strict=False)\ndef test_a(): pass\ndef test_b(): pass\n', ''),
    ('import unittest\nclass TestBroken(unittest.TestCase):\n def test_a(self):\n  with self.subTest(a=1): self.assertTrue(False)\ndef test_b(): pass\n', ''),
    ('def test_a(): pass\ndef test_b(): pass\n', 'def pytest_runtest_protocol(item,nextitem): return True\n'),
])
def test_real_failed_sessions_cannot_produce_aggregate_success(tmp_path, monkeypatch, source, conftest):
    root = project(tmp_path/'project', source, conftest)
    code, _, receipt = execute(root, monkeypatch)
    assert code != 0 and receipt['status'] == 'failed' and receipt['errors']
    assert receipt['cleanup_confirmed']


def test_collection_identity_and_selection_fail_closed(successful):
    path, _ = successful
    original = json.loads((path/'evidence/pytest-collection.json').read_text())
    for key, changed in [('invocation_id', 'old'), ('collection_complete', False), ('exit_code', 1),
            ('nodeids', []), ('nodeids', ['x', 'x']), ('source', {'tree': 'wrong'})]:
        value = copy.deepcopy(original); value[key] = changed
        with pytest.raises(ValueError):
            shards.validate_collection(value, original['invocation_id'], original['source'])


def test_source_drift_and_inherited_filter_do_not_launch_children(tmp_path, monkeypatch):
    root = project(tmp_path/'project', 'def test_a(): pass\ndef test_b(): pass\n')
    monkeypatch.setenv('PYTEST_ADDOPTS', '-k test_a')
    code, _, receipt = shards.run(root, root/'evidence', timeout=30)
    assert code != 0 and receipt['collection'] is None and not receipt['children']
    monkeypatch.delenv('PYTEST_ADDOPTS')
    (root/'tests/test_probe.py').write_text('def test_changed(): pass\n')
    code, _, receipt = execute(root, monkeypatch)
    assert code != 0 and receipt['collection'] is None and not receipt['children']


def test_stale_success_is_cleared_without_touching_history(tmp_path, monkeypatch):
    root = project(tmp_path/'project', 'raise RuntimeError("current collection failure")\n')
    out = root/'evidence'; out.mkdir()
    (out/'history').mkdir(); (out/'history/pytest.xml').write_text('historical')
    for name in shards.OUTPUTS: (out/name).write_text('stale success')
    code, _, receipt = execute(root, monkeypatch)
    assert code != 0 and not receipt['children']
    assert not (out/'pytest-shard-0.xml').exists() and not (out/'pytest.xml').exists()
    assert (out/'history/pytest.xml').read_text() == 'historical'
    assert json.loads((out/'pytest-shards.json').read_text())['status'] == 'failed'


def test_watchdog_keeps_partial_original_journal_and_stacks(tmp_path, monkeypatch):
    root = project(tmp_path/'project', 'import time\ndef test_a(): time.sleep(30)\ndef test_b(): pass\n')
    code, _, receipt = execute(root, monkeypatch, test_timeout=.3)
    assert code != 0 and receipt['cleanup_confirmed']
    assert len(receipt['children']) == 2
    assert any(c['returncode'] != 0 for c in receipt['children'])
    out = root/'evidence'
    assert any('Timeout' in (out/f'pytest-shard-{i}-progress.stacks.log').read_text() for i in range(2))
    assert any(not any(json.loads(line)['event'] == 'session_finished' for line in
        (out/f'pytest-shard-{i}-progress.jsonl').read_text().splitlines()) for i in range(2))


def test_outer_collection_wrapper_cannot_hide_a_failing_source_test(tmp_path, monkeypatch):
    source = '\n'.join(f'def test_{i}(): assert {i != 5}' for i in range(6)) + '\n'
    conftest = """
import pytest
class Filter:
    @pytest.hookimpl(wrapper=True, tryfirst=True)
    def pytest_collection_modifyitems(self, items):
        items[:] = [item for item in items if not item.nodeid.endswith('test_5')]
        yield
def pytest_sessionstart(session):
    session.config.pluginmanager.register(Filter(), 'late-outer-filter')
"""
    root = project(tmp_path/'project', source, conftest)
    code, _, receipt = execute(root, monkeypatch)
    assert code != 0 and not receipt['children']
    collection = json.loads((root/'evidence/pytest-collection.json').read_text())
    assert len(collection['raw_nodeids']) == 6 and collection['collection_complete'] is False
    assert collection['nodeids'] is None  # The filtered list was never frozen as full coverage.


def test_after_collection_execution_reorder_cannot_pass(tmp_path, monkeypatch):
    source = '\n'.join(f'def test_{i}(): pass' for i in range(6)) + '\n'
    root = project(tmp_path/'project', source,
        'def pytest_runtestloop(session): session.items.reverse()\n')
    code, _, receipt = execute(root, monkeypatch)
    assert code != 0 and len(receipt['children']) == 2
    assert all(child['returncode'] == 0 for child in receipt['children'])
    assert any('identities/order' in error for error in receipt['errors'])


@pytest.mark.parametrize('delayed_step', ['hash', 'final-receipt'])
def test_last_aggregation_work_cannot_cross_deadline_and_return_success(tmp_path, monkeypatch, delayed_step):
    import time
    root = project(tmp_path/'project', 'def test_a(): pass\ndef test_b(): pass\n')
    monkeypatch.setenv('PYTHONPATH', str(ROOT))
    monkeypatch.delenv('PYTEST_ADDOPTS', raising=False)
    monkeypatch.delenv('PYTEST_PLUGINS', raising=False)
    original_hash = shards.artifact_hashes
    original_write = shards.atomic_json
    delayed = []
    def delay_hash(out):
        time.sleep(8)
        delayed.append('hash')
        return original_hash(out)
    def delay_write(path, value):
        if Path(path).name == 'pytest-shards.json' and value['status'] == 'passed' and not delayed:
            time.sleep(8)
            delayed.append('final-receipt')
        original_write(path, value)
    monkeypatch.setattr(shards, 'artifact_hashes' if delayed_step == 'hash' else 'atomic_json',
        delay_hash if delayed_step == 'hash' else delay_write)
    started = time.monotonic()
    code, _, receipt = shards.run(root, root/'evidence', timeout=8)
    assert delayed == [delayed_step] and time.monotonic()-started >= 8
    assert code != 0 and receipt['within_deadline'] is False and receipt['status'] == 'failed'
    assert 'aggregate wall deadline exceeded' in receipt['errors']
    on_disk = json.loads((root/'evidence/pytest-shards.json').read_text())
    assert on_disk['exit_code'] != 0 and on_disk['within_deadline'] is False
