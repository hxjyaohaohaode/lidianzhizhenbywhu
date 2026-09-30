"""Backup snapshot integrity and no-overwrite regressions (2026-09-30)."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

from scripts import backup as back


def database(path, *, orphan=False, without_rowid=False, journal='delete'):
    connection = sqlite3.connect(path)
    connection.execute(f'PRAGMA journal_mode={journal}')
    connection.execute('PRAGMA foreign_keys=OFF')
    connection.execute('CREATE TABLE parents(id INTEGER PRIMARY KEY)')
    suffix = ' WITHOUT ROWID' if without_rowid else ''
    connection.execute('CREATE TABLE children(id INTEGER PRIMARY KEY, '
                       'parent_id INTEGER REFERENCES parents(id))' + suffix)
    connection.execute('INSERT INTO parents VALUES (1)')
    connection.execute('INSERT INTO children VALUES (1, ?)', (404 if orphan else 1,))
    connection.commit()
    return connection


def outputs(target):
    return [Path(str(target) + suffix) for suffix in
            ('', '.backup.json', '.credentials.key', '-wal', '-shm', '-journal')]


def assert_link_unchanged(link, intended_target, stored_target):
    # Windows os.readlink may expose a \\?\ prefix that was not supplied to
    # symlink_to. Preserve the OS spelling exactly across the operation, and
    # separately resolve both fixture paths without requiring the target to exist.
    assert link.is_symlink()
    assert os.readlink(link) == stored_target
    assert link.resolve(strict=False) == intended_target.resolve(strict=False)


@pytest.mark.parametrize('journal', ['delete', 'wal'])
def test_valid_snapshot_checks_relations_and_preserves_committed_online_data(tmp_path, journal):
    source, target = tmp_path / 'source.db', tmp_path / 'copy.db'
    with closing(database(source, journal=journal)) as live:
        if journal == 'wal':
            assert Path(str(source) + '-wal').stat().st_size > 0
        # NULL foreign keys are valid and must not be treated as orphaned rows.
        live.execute('INSERT INTO children VALUES (2, NULL)')
        live.commit()
        receipt = back.backup(source, target)
        assert receipt['integrity'] == 'ok'
        assert receipt['foreign_key_check'] == 'ok'
        assert receipt['sha256'] == hashlib.sha256(target.read_bytes()).hexdigest()
        assert json.loads(outputs(target)[1].read_text()) == receipt
        with closing(sqlite3.connect(target)) as restored:
            assert restored.execute('SELECT * FROM children ORDER BY id').fetchall() == [(1, 1), (2, None)]
            assert restored.execute('PRAGMA foreign_key_check').fetchall() == []
        if os.name == 'posix':
            assert target.stat().st_mode & 0o777 == 0o600
            assert outputs(target)[1].stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize('journal', ['delete', 'wal'])
@pytest.mark.parametrize('without_rowid', [False, True])
def test_orphaned_snapshot_is_rejected_without_leaving_outputs(tmp_path, journal, without_rowid):
    source, target = tmp_path / 'source.db', tmp_path / 'copy.db'
    with closing(database(source, orphan=True, without_rowid=without_rowid, journal=journal)) as live:
        # SQLite's integrity_check deliberately does not check foreign keys.
        assert live.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
        assert live.execute('PRAGMA foreign_key_check').fetchone() is not None
        with pytest.raises(ValueError, match='外键'):
            back.backup(source, target, include_key=True)
        assert all(not path.exists() and not path.is_symlink() for path in outputs(target))
        assert live.execute('SELECT parent_id FROM children').fetchone() == (404,)


@pytest.mark.parametrize('orphan', [False, True])
def test_foreign_keys_are_checked_on_completed_snapshot_not_changed_live_source(tmp_path, monkeypatch, orphan):
    source, target = tmp_path / 'source.db', tmp_path / 'copy.db'
    with closing(database(source, orphan=orphan)):
        pass
    connect = sqlite3.connect

    class SourceConnection:
        def __init__(self, connection):
            self.connection = connection

        def close(self):
            self.connection.close()

        def backup(self, destination):
            self.connection.backup(destination)
            # Deterministic concurrent change after SQLite finishes its snapshot.
            with closing(connect(source)) as live:
                live.execute('UPDATE children SET parent_id=?', (1 if orphan else 404,))
                live.commit()

    def connecting(path, *args, **kwargs):
        connection = connect(path, *args, **kwargs)
        return SourceConnection(connection) if kwargs.get('uri') else connection

    monkeypatch.setattr(back.sqlite3, 'connect', connecting)
    if orphan:
        with pytest.raises(ValueError, match='外键'):
            back.backup(source, target)
        assert all(not path.exists() for path in outputs(target))
    else:
        assert back.backup(source, target)['foreign_key_check'] == 'ok'
        with closing(connect(target)) as restored:
            assert restored.execute('SELECT parent_id FROM children').fetchone() == (1,)
    with closing(connect(source)) as live:
        assert live.execute('SELECT parent_id FROM children').fetchone() == (1 if orphan else 404,)


@pytest.mark.parametrize('suffix', ['-wal', '-shm', '-journal', '.backup.json'])
@pytest.mark.parametrize('kind', ['file', 'link', 'dangling_link'])
def test_destination_sidecars_and_receipt_are_never_overwritten(tmp_path, suffix, kind, monkeypatch):
    source, target = tmp_path / 'source.db', tmp_path / 'copy.db'
    with closing(database(source, journal='wal')):
        pass
    collision = Path(str(target) + suffix)
    sentinel = b'KEEP_EXISTING_PRIVATE_DATA'
    linked = tmp_path / 'linked-artifact'
    if kind == 'file':
        collision.write_bytes(sentinel)
    else:
        if kind == 'link':
            linked.write_bytes(sentinel)
        collision.symlink_to(linked)
        stored_target = os.readlink(collision)
        assert_link_unchanged(collision, linked, stored_target)

    def unexpected_open(*args, **kwargs):
        pytest.fail('Collision must be rejected before opening either SQLite database')

    monkeypatch.setattr(back.sqlite3, 'connect', unexpected_open)
    with pytest.raises(ValueError, match='拒绝覆盖'):
        back.backup(source, target)
    assert not target.exists()
    if kind == 'file':
        assert collision.read_bytes() == sentinel
    else:
        assert_link_unchanged(collision, linked, stored_target)
        if kind == 'link':
            assert linked.read_bytes() == sentinel
        else:
            assert not linked.exists()


@pytest.mark.parametrize('orphan', [False, True])
def test_cli_reports_only_validated_receipt_or_safe_integrity_error(tmp_path, orphan):
    source, target = tmp_path / 'source.db', tmp_path / 'copy.db'
    with closing(database(source, orphan=orphan)) as live:
        live.execute('CREATE TABLE private_notes(value TEXT)')
        live.execute('INSERT INTO private_notes VALUES (?)', ('TEST_ONLY_PRIVATE_VALUE',))
        live.commit()
    result = subprocess.run(
        [sys.executable, str(Path(back.__file__).resolve()), '--source', str(source), '--output', str(target)],
        capture_output=True, text=True, check=False,
    )
    assert 'TEST_ONLY_PRIVATE_VALUE' not in result.stdout + result.stderr
    assert 'Traceback' not in result.stderr
    if orphan:
        assert result.returncode != 0 and not result.stdout
        assert '外键完整性检查失败' in result.stderr
        assert all(not path.exists() for path in outputs(target))
    else:
        assert result.returncode == 0 and not result.stderr
        assert json.loads(result.stdout)['foreign_key_check'] == 'ok'


@pytest.mark.parametrize('dangling', [False, True])
@pytest.mark.parametrize('mutation', ['retarget', 'replace', 'remove', 'respell', 'wrong_expected'])
def test_link_preservation_assertion_rejects_actual_changes(tmp_path, dangling, mutation):
    target = tmp_path / 'intended-target'
    if not dangling:
        target.write_bytes(b'KEEP')
    link = tmp_path / 'link'
    link.symlink_to(target)
    stored_target = os.readlink(link)
    assert_link_unchanged(link, target, stored_target)
    expected = target
    if mutation == 'wrong_expected':
        expected = tmp_path / 'other-directory' / target.name
    else:
        link.unlink()
        if mutation == 'retarget':
            # Same basename, different parent. An endswith/name-only comparison
            # would accept this accidental replacement of the backup companion.
            other = tmp_path / 'other-directory' / target.name
            other.parent.mkdir()
            if not dangling:
                other.write_bytes(b'KEEP')
            link.symlink_to(other)
        elif mutation == 'replace':
            link.write_bytes(b'KEEP')
        elif mutation == 'respell':
            # Equivalent destination is still a changed link: resolution alone
            # must not replace the exact before/after preservation assertion.
            link.symlink_to(Path(target.name))
            assert link.resolve(strict=False) == target.resolve(strict=False)
    with pytest.raises(AssertionError):
        assert_link_unchanged(link, expected, stored_target)
    if not dangling:
        assert target.read_bytes() == b'KEEP'
    else:
        assert not target.exists()
