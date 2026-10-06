"""Real private files and native Windows controls; no substituted OS context."""
import errno
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time
from types import SimpleNamespace

import pytest
from scripts import private_temp_cleanup as cleanup
from scripts import pytest_shards as shards


def tree(tmp_path):
    root = tmp_path/'invocation'
    root.mkdir()
    (root/'file.txt').write_text('isolated fixture')
    return root, cleanup.capture_private_root(root)


def test_complete_private_tree_is_deleted_with_separate_evidence(tmp_path):
    root, identity = tree(tmp_path)
    result = cleanup.cleanup_private_tree(root, identity, time.monotonic()+10)
    assert result == {'attempted':True, 'complete':True, 'readonly_retries':[], 'errors':[], 'failure':None}
    assert not root.exists()


def test_expired_deadline_never_starts_deleting(tmp_path):
    root, identity = tree(tmp_path)
    result = cleanup.cleanup_private_tree(root, identity, time.monotonic()-1)
    assert not result['complete'] and result['failure']['type']=='TimeoutError'
    assert not result['readonly_retries'] and (root/'file.txt').read_text()=='isolated fixture'


def test_replaced_private_root_is_retained_and_rejected(tmp_path):
    root, identity = tree(tmp_path)
    root.rename(tmp_path/'original')
    root.mkdir();(root/'replacement.txt').write_text('replacement sentinel')
    result = cleanup.cleanup_private_tree(root, identity, time.monotonic()+10)
    assert not result['complete'] and result['failure']['type']=='BoundaryError'
    assert 'identity changed' in result['failure']['reason']
    assert (root/'replacement.txt').read_text()=='replacement sentinel'
    assert (tmp_path/'original/file.txt').read_text()=='isolated fixture'


def test_callback_keeps_original_error_and_inspection_read_failure(tmp_path, monkeypatch):
    root, identity = tree(tmp_path)
    target=root/'file.txt';original=Path.lstat
    def denied(path, *args, **kwargs):
        if path==target:raise PermissionError(errno.EACCES,'isolated inspection denial',str(path))
        return original(path,*args,**kwargs)
    def callback(path, **kwargs):
        error=PermissionError(errno.EACCES,'isolated unlink denial',str(target))
        if 'onexc' in kwargs:kwargs['onexc'](os.unlink,str(target),error)
        else:kwargs['onerror'](os.unlink,str(target),(type(error),error,error.__traceback__))
    monkeypatch.setattr(Path,'lstat',denied)
    monkeypatch.setattr(cleanup.shutil,'rmtree',callback)
    result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+10)
    assert not result['complete'] and not result['readonly_retries']
    assert result['errors'][0]['operation']=='unlink' and result['errors'][0]['errno']==errno.EACCES
    assert result['errors'][0]['relative_path']=='file.txt'
    assert result['errors'][0]['mutation_attempted'] is False
    assert result['failure']['operation']=='lstat-file' and result['failure']['errno']==errno.EACCES
    assert target.read_text()=='isolated fixture'


def test_callback_cannot_touch_an_outside_path(tmp_path, monkeypatch):
    root,identity=tree(tmp_path)
    outside=tmp_path/'outside.txt';outside.write_text('outside sentinel')
    def callback(path, **kwargs):
        error=PermissionError(errno.EACCES,'outside denial',str(outside))
        if 'onexc' in kwargs:kwargs['onexc'](os.unlink,str(outside),error)
        else:kwargs['onerror'](os.unlink,str(outside),(type(error),error,error.__traceback__))
    monkeypatch.setattr(cleanup.shutil,'rmtree',callback)
    result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+10)
    assert not result['complete'] and not result['readonly_retries']
    assert result['errors'][0]['relative_path']=='<outside-private-root>'
    assert result['errors'][0]['mutation_attempted'] is False
    assert outside.read_text()=='outside sentinel' and (root/'file.txt').exists()


def test_unconfirmed_process_tree_never_starts_temporary_cleanup(tmp_path, monkeypatch):
    from test_pytest_shards import project
    root=project(tmp_path/'project','def test_a(): pass\ndef test_b(): pass\n')
    class Unsafe:
        def __init__(self,*args,**kwargs):pass
        def request_cancel(self):pass
        def wait(self):
            return SimpleNamespace(as_dict=lambda:{'returncode':None,'cleanup_confirmed':False,'error':'unconfirmed synthetic process'})
    from scripts import owned_process
    monkeypatch.setattr(owned_process,'OwnedProcess',Unsafe)
    calls=[]
    monkeypatch.setattr(cleanup,'cleanup_private_tree',lambda *a:(calls.append(a) or pytest.fail('cleanup before process confirmation')))
    code,_,receipt=shards.run(root,root/'evidence',timeout=20)
    assert code!=0 and not receipt['cleanup_confirmed'] and not calls
    assert receipt['temporary_cleanup']=={'attempted':False,'complete':False}
    # The production path intentionally retains an unconfirmed invocation. This
    # isolated double never launched anything; remove its own empty control tree.
    request=next(x.split('=',1)[1] for x in receipt['collection']['command'] if x.startswith('--shard-request='))
    shutil.rmtree(Path(request).parents[1])


if os.name == 'posix':
    def test_real_posix_permission_failure_stays_red_without_chmod(tmp_path):
        root,identity=tree(tmp_path)
        directory=root/'denied';directory.mkdir();(directory/'file.txt').write_text('private')
        directory.chmod(0o555)
        try:
            result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+10)
            assert not result['complete'] and not result['readonly_retries']
            assert any(e['type']=='PermissionError' and e['errno']==errno.EACCES for e in result['errors'])
            assert all(not e['mutation_attempted'] for e in result['errors'])
            assert (directory/'file.txt').read_text()=='private'
        finally:
            directory.chmod(0o700)

    def test_symlink_does_not_delete_outside_private_tree(tmp_path):
        root,identity=tree(tmp_path)
        outside=tmp_path/'outside';outside.mkdir();sentinel=outside/'sentinel.txt';sentinel.write_text('outside')
        (root/'alias').symlink_to(outside,target_is_directory=True)
        result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+10)
        assert result['complete'] and sentinel.read_text()=='outside'
        assert not result['readonly_retries']


if os.name == 'nt':
    def test_windows_real_readonly_file_baseline_fails_then_single_unlink_succeeds(tmp_path):
        root,identity=tree(tmp_path);target=root/'file.txt'
        target.chmod(stat.S_IREAD)
        assert target.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_READONLY
        with pytest.raises(PermissionError) as caught:os.unlink(target)
        assert caught.value.winerror==5
        result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+10)
        assert result['complete'] and not root.exists()
        assert result['readonly_retries']==['file.txt']
        event=result['errors'][0]
        assert event['winerror']==5 and event['readonly_observed'] is True
        assert event['unlink_retries']==1 and event['outcome']=='deleted'

    def test_windows_real_git_objects_and_controlled_readonly_object_are_removed(tmp_path):
        root,identity=tree(tmp_path)
        for args in (['init','-q'],['add','.'],['-c','user.name=Harness','-c','user.email=harness@example.invalid','commit','-qm','isolated cleanup fixture']):
            subprocess.run(['git',*args],cwd=root,check=True,capture_output=True)
        objects=[p for p in (root/'.git/objects').glob('*/*') if p.is_file()]
        assert objects
        controlled=objects[0];controlled.chmod(stat.S_IREAD)
        assert controlled.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_READONLY
        with pytest.raises(PermissionError) as caught:os.unlink(controlled)
        assert caught.value.winerror==5
        result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+15)
        assert result['complete'] and not root.exists()
        assert controlled.relative_to(root).as_posix() in result['readonly_retries']
        assert all(e['unlink_retries']==1 and e['outcome']=='deleted' for e in result['errors'])

    def test_windows_real_nonreadonly_sharing_violation_is_not_retried(tmp_path):
        import ctypes
        from ctypes import wintypes as w
        root,identity=tree(tmp_path);target=root/'file.txt'
        api=ctypes.WinDLL('kernel32',use_last_error=True)
        api.CreateFileW.argtypes=[w.LPCWSTR,w.DWORD,w.DWORD,ctypes.c_void_p,w.DWORD,w.DWORD,w.HANDLE]
        api.CreateFileW.restype=w.HANDLE
        api.CloseHandle.argtypes=[w.HANDLE];api.CloseHandle.restype=w.BOOL
        handle=api.CreateFileW(str(target),0x80000000,1,None,3,0,None)
        assert handle not in (None,ctypes.c_void_p(-1).value)
        try:
            assert not target.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_READONLY
            result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+10)
            assert not result['complete'] and not result['readonly_retries']
            event=result['errors'][0]
            assert event['winerror']==32 and event['mutation_attempted'] is False
            assert event['unlink_retries']==0 and target.read_text()=='isolated fixture'
        finally:
            assert api.CloseHandle(handle)

    def test_windows_readonly_hardlink_cannot_change_outside_alias(tmp_path):
        root,identity=tree(tmp_path)
        outside=tmp_path/'outside.txt';outside.write_text('outside sentinel')
        os.link(outside,root/'linked.txt');outside.chmod(stat.S_IREAD)
        try:
            result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+10)
            assert not result['complete'] and not result['readonly_retries']
            assert any(e.get('link_count')==2 for e in result['errors'])
            assert all(not e['mutation_attempted'] for e in result['errors'])
            assert outside.read_text()=='outside sentinel'
            assert outside.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_READONLY
        finally:
            outside.chmod(stat.S_IWRITE)

    def test_windows_junction_does_not_traverse_outside_private_tree(tmp_path):
        root,identity=tree(tmp_path)
        outside=tmp_path/'outside';outside.mkdir();sentinel=outside/'sentinel.txt';sentinel.write_text('outside')
        subprocess.run(['cmd','/c','mklink','/J',str(root/'alias'),str(outside)],check=True,capture_output=True)
        assert (root/'alias').lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
        result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+10)
        assert result['complete'] and not result['readonly_retries']
        assert sentinel.read_text()=='outside'


if os.name == 'nt':
    def test_windows_real_readonly_then_injected_retry_failure_is_not_ignored(tmp_path, monkeypatch):
        root,identity=tree(tmp_path);target=root/'file.txt';target.chmod(stat.S_IREAD)
        original=os.unlink;calls=[]
        def second_failure(path,*args,**kwargs):
            if Path(path)==target:
                calls.append(path)
                if len(calls)==2:raise PermissionError(errno.EACCES,'injected second unlink failure',str(path))
            return original(path,*args,**kwargs)
        monkeypatch.setattr(cleanup.os,'unlink',second_failure)
        result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+10)
        assert not result['complete'] and len(calls)==2 and target.exists()
        assert result['errors'][0]['winerror']==5  # First failure came from real Windows.
        assert result['errors'][0]['unlink_retries']==1
        assert result['failure']['operation']=='unlink-retry' and result['failure']['errno']==errno.EACCES

    def test_windows_inspection_crossing_deadline_never_mutates_readonly_file(tmp_path, monkeypatch):
        root,identity=tree(tmp_path);target=root/'file.txt';target.chmod(stat.S_IREAD)
        original=Path.lstat;calls=[];deadline=time.monotonic()+.5
        def slow_second_read(path,*args,**kwargs):
            if path==target:
                calls.append(path)
                if len(calls)==2:time.sleep(max(0,deadline-time.monotonic())+.05)
            return original(path,*args,**kwargs)
        monkeypatch.setattr(Path,'lstat',slow_second_read)
        try:
            result=cleanup.cleanup_private_tree(root,identity,deadline)
            assert not result['complete'] and result['failure']['type']=='TimeoutError'
            assert not result['readonly_retries']
            assert result['errors'][0]['winerror']==5 and not result['errors'][0]['mutation_attempted']
            assert original(target).st_file_attributes & stat.FILE_ATTRIBUTE_READONLY
        finally:
            target.chmod(stat.S_IWRITE)

    def test_windows_replaced_readonly_file_is_not_mutated_or_retried(tmp_path, monkeypatch):
        root,identity=tree(tmp_path);target=root/'file.txt';target.chmod(stat.S_IREAD)
        replacement=tmp_path/'replacement.txt';replacement.write_text('replacement sentinel');replacement.chmod(stat.S_IREAD)
        original=Path.lstat;calls=[]
        def replace_second_read(path,*args,**kwargs):
            if path==target:
                calls.append(path)
                if len(calls)==2:
                    target.chmod(stat.S_IWRITE)
                    target.rename(root/'original.txt')
                    replacement.rename(target)
            return original(path,*args,**kwargs)
        monkeypatch.setattr(Path,'lstat',replace_second_read)
        try:
            result=cleanup.cleanup_private_tree(root,identity,time.monotonic()+10)
            assert not result['complete'] and not result['readonly_retries']
            assert result['failure']['type']=='BoundaryError' and 'identity changed' in result['failure']['reason']
            assert not result['errors'][0]['mutation_attempted']
            assert target.read_text()=='replacement sentinel'
            assert original(target).st_file_attributes & stat.FILE_ATTRIBUTE_READONLY
        finally:
            target.chmod(stat.S_IWRITE)
            if replacement.exists():replacement.chmod(stat.S_IWRITE)


if os.name == 'posix':
    def test_real_denied_temp_cleanup_keeps_process_proof_but_fails_aggregate(tmp_path, monkeypatch):
        from test_pytest_shards import project, execute
        root=project(tmp_path/'project', '''
def test_a(tmp_path):
    denied=tmp_path/'denied'
    denied.mkdir()
    (denied/'fixture.txt').write_text('isolated private fixture')
    denied.chmod(0o555)
def test_b(): pass
''')
        code,_,receipt=execute(root,monkeypatch)
        request=next(x.split('=',1)[1] for x in receipt['collection']['command'] if x.startswith('--shard-request='))
        owned=Path(request).parents[1]
        try:
            assert code!=0 and receipt['status']=='failed'
            assert receipt['cleanup_confirmed'] is True
            assert [c['returncode'] for c in receipt['children']]==[0,0]
            assert receipt['coverage']['full_count']==2
            deletion=receipt['temporary_cleanup']
            assert deletion['attempted'] and not deletion['complete'] and deletion['failure']
            assert any(e['type']=='PermissionError' and e['errno']==errno.EACCES for e in deletion['errors'])
            assert all(not e['mutation_attempted'] for e in deletion['errors'])
            assert all(not Path(e['relative_path']).is_absolute() for e in deletion['errors'])
            assert owned.exists()
        finally:
            if owned.exists():
                for folder,dirs,files in os.walk(owned):os.chmod(folder,0o700)
                shutil.rmtree(owned)
