"""Delete only a stopped verification invocation's private temporary tree.

A Windows readonly-file retry is deliberately narrower than a permission retry.
Unknown denial, lock, inspection failure, replacement or expired time stays red.
"""
import errno
import os
from pathlib import Path
import shutil
import stat
import sys
import time


class BoundaryError(OSError):
    pass


def _reject(reason):
    raise BoundaryError(errno.EPERM, reason)


def _ordinary(info, *, directory):
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    attributes = getattr(info, 'st_file_attributes', None)
    return (expected(info.st_mode) and (os.name != 'nt' or attributes is not None)
        and not ((attributes or 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT))


def capture_private_root(path):
    """Call immediately after mkdtemp, before launching any test code."""
    path = Path(path).absolute()
    info = path.lstat()
    if not _ordinary(info, directory=True):
        _reject('private root is not an ordinary directory')
    return {'device': info.st_dev, 'inode': info.st_ino,
        'resolved': str(path.resolve(strict=True))}


def cleanup_private_tree(path, identity, deadline):
    """Return deletion evidence; only complete deletion before deadline is green.

    The caller must already have confirmed every owned process has stopped.
    Path checks are not atomic against an unrelated actor replacing private files.
    A callback cannot preempt a stalled OS syscall or ordinary rmtree traversal.
    Final aggregate checks reject late success; each custom readonly chmod/unlink
    retry checks the original deadline immediately before starting.
    """
    root = Path(path).absolute()
    report = {'attempted': True, 'complete': False, 'readonly_retries': [],
        'errors': [], 'failure': None}
    current = ['verify-root', root]
    attempted = set()

    def relative(target):
        try:
            return Path(target).absolute().relative_to(root).as_posix()
        except (TypeError, ValueError):
            return '<outside-private-root>'

    def detail(operation, target, exc):
        value = {'operation': operation, 'relative_path': relative(target),
            'type': type(exc).__name__, 'errno': getattr(exc, 'errno', None),
            'winerror': getattr(exc, 'winerror', None)}
        if isinstance(exc, BoundaryError):
            value['reason'] = exc.strerror
        return value

    def remaining():
        if time.monotonic() >= deadline:
            raise TimeoutError('private temporary cleanup deadline exhausted')

    def root_info():
        current[:] = ['lstat-root', root]
        info = root.lstat()
        if (not _ordinary(info, directory=True) or identity is None or
                (info.st_dev, info.st_ino) != (identity['device'], identity['inode']) or
                str(root.resolve(strict=True)) != identity['resolved']):
            _reject('private root identity changed')
        return info

    def inspect(target, event=None):
        base = root_info()
        target = Path(target).absolute()
        rel = target.relative_to(root)
        if not rel.parts or '..' in rel.parts:
            _reject('retry target is not a private descendant')
        snapshots = [('.', base.st_dev, base.st_ino)]
        cursor = root
        for name in rel.parts[:-1]:
            cursor = cursor / name
            current[:] = ['lstat-ancestor', cursor]
            info = cursor.lstat()
            if not _ordinary(info, directory=True):
                _reject('retry ancestor is not an ordinary directory')
            snapshots.append((relative(cursor), info.st_dev, info.st_ino))
        current[:] = ['lstat-file', target]
        info = target.lstat()
        if event is not None:
            event['file_attributes'] = getattr(info, 'st_file_attributes', None)
            event['readonly_observed'] = None if event['file_attributes'] is None else bool(
                event['file_attributes'] & stat.FILE_ATTRIBUTE_READONLY)
            event['link_count'] = info.st_nlink
        if not _ordinary(info, directory=False) or info.st_nlink != 1:
            _reject('retry target is not an ordinary single-link file')
        current[:] = ['resolve-file', target]
        target.resolve(strict=True).relative_to(Path(identity['resolved']))
        snapshots.append((relative(target), info.st_dev, info.st_ino))
        return info, snapshots

    def onexc(function, target, exc):
        name = getattr(function, '__name__', type(function).__name__)
        event = detail(name, target, exc)
        event.update(readonly_observed=None, file_attributes=None,
            mutation_attempted=False, unlink_retries=0, outcome='rejected')
        report['errors'].append(event)
        current[:] = [name, target]
        remaining()
        # Read and boundary errors are themselves failures; retain the original
        # deletion error above as well as the failing inspection in failure.
        info, before = inspect(target, event)
        attributes = getattr(info, 'st_file_attributes', None)
        event['file_attributes'] = attributes
        event['readonly_observed'] = None if attributes is None else bool(
            attributes & stat.FILE_ATTRIBUTE_READONLY)
        current[:] = [name, target]
        if not (os.name == 'nt' and function is os.unlink and
                isinstance(exc, PermissionError) and getattr(exc, 'winerror', None) == 5 and
                attributes is not None and attributes & stat.FILE_ATTRIBUTE_READONLY):
            raise exc
        key = str(Path(target).absolute())
        if key in attempted:
            _reject('readonly unlink already retried')
        attempted.add(key)
        remaining()
        _, latest = inspect(target)
        if latest != before:
            _reject('retry file or ancestor identity changed before mutation')
        remaining()
        current[:] = ['chmod-readonly', target]
        event['mutation_attempted'] = True
        # On Windows chmod changes readonly, not ACLs or unrelated attributes.
        # Never follow a reparse leaf; unsupported no-follow stays a failure.
        os.chmod(target, info.st_mode | stat.S_IWRITE, follow_symlinks=False)
        remaining()
        _, latest = inspect(target)
        if latest != before:
            _reject('retry file or ancestor identity changed before unlink')
        remaining()
        current[:] = ['unlink-retry', target]
        event['unlink_retries'] = 1
        report['readonly_retries'].append(relative(target))
        function(target)  # One retry of this exact failed unlink; no tree retry.
        event['outcome'] = 'deleted'

    try:
        remaining()
        root_info()
        current[:] = ['rmtree', root]
        if sys.version_info >= (3, 12):
            shutil.rmtree(root, onexc=onexc)
        else:
            shutil.rmtree(root, onerror=lambda f, p, e: onexc(f, p, e[1]))
        remaining()
        current[:] = ['confirm-root-absent', root]
        try:
            root.lstat()
        except FileNotFoundError:
            remaining()
            report['complete'] = True
        else:
            _reject('private root still exists after cleanup')
    except Exception as exc:
        report['failure'] = detail(current[0], current[1], exc)
    return report
