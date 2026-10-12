"""Release collectors verify bytes without inventing Git provenance."""
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import time

import pytest

from scripts import source_identity as identity
from scripts import crash_dispatch_check as crash
from scripts import tls_proxy_check as tls


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()).hexdigest()


def write_manifest(root, records=None, **changes):
    if records is None:
        records = [{'path': p.relative_to(root).as_posix(), 'bytes': p.stat().st_size,
                    'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                   for p in sorted(root.rglob('*')) if p.is_file()]
    value = dict(commit='a'*40, tree='b'*40, file_count=len(records), status='test package',
                 source_set_sha256=digest(records), files=records)
    value.update(changes)
    path = root.parent / identity.MANIFEST
    path.write_text(json.dumps(value))
    return path


@pytest.fixture
def package(tmp_path):
    root = tmp_path/'Lidian';root.mkdir()
    (root/'server').mkdir();(root/'server/app.py').write_text('VALUE = 1\n')
    (root/'web').mkdir();(root/'web/app.js').write_text('export const value = 1;\n')
    (root/'tests').mkdir();(root/'tests/input.json').write_text('{"synthetic":true}')
    write_manifest(root)
    return root


def collect(root, tmp_path, **changes):
    kwargs = dict(scratch_root=tmp_path, register_process=lambda *args: None,
                  process_deadline=time.monotonic()+30, work_deadline=time.monotonic()+20,
                  cleanup_reserve=8, phase='test')
    kwargs.update(changes)
    return identity.collect_source_identity(root, [], **kwargs)


def test_nogit_manifest_verifies_every_file_without_git_or_false_head(package, tmp_path, monkeypatch):
    monkeypatch.setattr(identity, 'OwnedProcess', lambda *a, **kw: pytest.fail('Git must not run'))
    before = collect(package, tmp_path)
    assert before['kind'] == 'package-source' and before['verified']
    assert before['git_head'] is None and before['manifest_declared_commit'] == 'a'*40
    assert before['file_count'] == 3 and 'tests/input.json' in before['files_sha256']
    assert 'authenticity not verified' in before['provenance']
    (package/'.runtime/venv').mkdir(parents=True)
    (package/'.runtime/venv/local.py').write_text('installation-only')
    (package/'evidence').mkdir();(package/'evidence/diagnostic.json').write_text('{}')
    (package/'server/__pycache__').mkdir()
    (package/'server/__pycache__/app.cpython-313.pyc').write_bytes(b'generated cache')
    assert collect(package, tmp_path) == before


@pytest.mark.parametrize('mutation', ['file_hash', 'file_size', 'missing', 'manifest_digest', 'count',
    'bad_commit', 'bad_tree', 'duplicate', 'case_collision', 'missing_record', 'new_code',
    'new_asset', 'unlisted_pyc', 'report_code', 'symlink_file', 'symlink_parent', 'hardlink',
    'manifest_symlink', 'duplicate_json_key', 'ambiguous_manifest'])
def test_invalid_packages_fail_closed(package, tmp_path, mutation):
    manifest = package.parent/identity.MANIFEST
    value = json.loads(manifest.read_text())
    changed_records = False
    target = package/'server/app.py'
    if mutation == 'file_hash':target.write_text('VALUE = 2\n')
    elif mutation == 'file_size':target.write_text('changed length\n')
    elif mutation == 'missing':target.unlink()
    elif mutation == 'manifest_digest':value['source_set_sha256'] = '0'*64
    elif mutation == 'count':value['file_count'] += 1
    elif mutation == 'bad_commit':value['commit'] = 'pretend-head'
    elif mutation == 'bad_tree':value['tree'] = None
    elif mutation == 'duplicate':value['files'].append(dict(value['files'][0]));changed_records=True
    elif mutation == 'case_collision':
        entry = dict(value['files'][0]);entry['path'] = entry['path'].upper()
        alternate = package/entry['path'];alternate.parent.mkdir(exist_ok=True)
        alternate.write_bytes((package/value['files'][0]['path']).read_bytes())
        value['files'].append(entry);changed_records=True
    elif mutation == 'missing_record':value['files'].pop();changed_records=True
    elif mutation == 'new_code':(package/'server/injected.py').write_text('injected')
    elif mutation == 'new_asset':(package/'web/injected.js').write_text('injected')
    elif mutation == 'unlisted_pyc':
        (package/'server/__pycache__').mkdir();(package/'server/__pycache__/injected.cpython-313.pyc').write_bytes(b'code')
    elif mutation == 'report_code':
        (package/'evidence').mkdir();(package/'evidence/injected.py').write_text('code')
    elif mutation == 'symlink_file':
        elsewhere = tmp_path/'elsewhere.py';elsewhere.write_bytes(target.read_bytes())
        target.unlink();target.symlink_to(elsewhere)
    elif mutation == 'symlink_parent':
        (package/'server').rename(tmp_path/'elsewhere');(package/'server').symlink_to(tmp_path/'elsewhere',target_is_directory=True)
    elif mutation == 'hardlink':
        import os
        os.link(target,tmp_path/'hardlink.py')
    elif mutation == 'manifest_symlink':
        manifest.rename(tmp_path/'other.json');manifest.symlink_to(tmp_path/'other.json')
    elif mutation == 'duplicate_json_key':
        manifest.write_text(manifest.read_text().replace('"commit":', '"commit":"'+'b'*40+'","commit":'))
    elif mutation == 'ambiguous_manifest':(package/identity.MANIFEST).write_bytes(manifest.read_bytes())
    if changed_records:
        value['file_count'] = len(value['files']);value['source_set_sha256'] = digest(value['files'])
    if mutation not in ('manifest_symlink','duplicate_json_key'):
        manifest.write_text(json.dumps(value))
    with pytest.raises((ValueError, OSError)):
        collect(package,tmp_path)


@pytest.mark.parametrize('path', ['../outside', '/absolute', 'C:/absolute', 'server\\app.py',
    './server/app.py', 'server//app.py', 'server/../app.py', '.runtime/hidden.py', 'server/',
    'server/CON', 'server/app.py ', 'server/app.py.', 'server/bad\nname'])
def test_unsafe_manifest_paths_rejected_before_file_read(package,tmp_path,path):
    record = dict(path=path, bytes=0, sha256=hashlib.sha256(b'').hexdigest())
    write_manifest(package,[record])
    with pytest.raises(ValueError,match='path'):
        collect(package,tmp_path)


def test_missing_manifest_never_uses_parent_repository(package,tmp_path,monkeypatch):
    (tmp_path/identity.MANIFEST).unlink();(tmp_path/'.git').mkdir()
    monkeypatch.setattr(identity,'OwnedProcess',lambda *a,**kw:pytest.fail('Must not discover parent Git'))
    with pytest.raises(ValueError,match='unverified'):
        collect(package,tmp_path)


def test_invalid_manifest_never_falls_back_to_git(package,tmp_path,monkeypatch):
    (package/'.git').mkdir();(tmp_path/identity.MANIFEST).write_text('{}')
    monkeypatch.setattr(identity,'OwnedProcess',lambda *a,**kw:pytest.fail('No Git fallback'))
    with pytest.raises(ValueError,match='schema'):
        collect(package,tmp_path)


def test_declared_commit_is_not_authenticated_and_manifest_changes_are_visible(package,tmp_path):
    before=collect(package,tmp_path)
    manifest=tmp_path/identity.MANIFEST;value=json.loads(manifest.read_text())
    value['commit']='c'*40;manifest.write_text(json.dumps(value))
    after=collect(package,tmp_path)
    assert before != after and after['git_head'] is None
    assert before['files_sha256']==after['files_sha256']
    assert after['manifest_declared_commit']=='c'*40


@pytest.mark.parametrize('wrong_root,bad_cleanup,code', [(False,False,0),(True,False,0),(False,True,0),(False,False,1)])
def test_git_identity_uses_owned_budget_and_verifies_exact_root(package,tmp_path,monkeypatch,wrong_root,bad_cleanup,code):
    (tmp_path/identity.MANIFEST).unlink();(package/'.git').mkdir()
    calls=[];registered=[]
    monkeypatch.setenv('GIT_DIR',str(tmp_path/'.git'))
    monkeypatch.setenv('GIT_WORK_TREE',str(tmp_path))
    class Process:
        def __init__(self,command,**kwargs):
            calls.append((command,kwargs))
            kwargs['stdout_path'].write_text(str(tmp_path if wrong_root else package)+'\n'+'d'*40+'\n')
        def wait(self):return SimpleNamespace(returncode=code,cleanup_confirmed=not bad_cleanup)
    monkeypatch.setattr(identity,'OwnedProcess',Process)
    if wrong_root or bad_cleanup or code:
        with pytest.raises(ValueError,match='Git root/HEAD'):
            collect(package,tmp_path,register_process=lambda d,p:registered.append((d,p)),process_deadline=999999999,work_deadline=999999990)
    else:
        result=collect(package,tmp_path,register_process=lambda d,p:registered.append((d,p)),process_deadline=999999999,work_deadline=999999990)
        assert result['git_head']=='d'*40 and result['kind']=='git-checkout'
        assert result['worktree_matches_commit'] is None and 'cleanliness not asserted' in result['provenance']
    command,kwargs=calls[0]
    assert command==['git','rev-parse','--show-toplevel','--verify','HEAD']
    assert kwargs['deadline']==999999999 and kwargs['cleanup_reserve']==8
    assert 'GIT_DIR' not in kwargs['env'] and 'GIT_WORK_TREE' not in kwargs['env']
    assert registered and registered[0][0].case=='source_identity'


def test_expired_identity_budget_does_not_start_git(package,tmp_path,monkeypatch):
    monkeypatch.setattr(identity,'OwnedProcess',lambda *a,**kw:pytest.fail('Expired budget started Git'))
    with pytest.raises(TimeoutError,match='aggregate work deadline'):
        collect(package,tmp_path,work_deadline=0)


def test_both_collectors_use_same_package_fixture_and_before_after_identity(package,tmp_path,monkeypatch):
    monkeypatch.setattr(crash,'ROOT',package);monkeypatch.setattr(tls,'ROOT',package)
    owned=[];deadline=time.monotonic()+120
    before=crash.source_identity(tmp_path,owned,deadline-2,deadline-10,'before')
    after=tls.identity(tmp_path,owned,deadline,'after')
    assert before==after and not owned
    assert before['files_sha256']['tests/input.json']==hashlib.sha256(b'{"synthetic":true}').hexdigest()


def test_crash_report_preserves_package_identity_and_rejects_fixture_tamper(package,tmp_path,monkeypatch):
    monkeypatch.setattr(crash,'ROOT',package)
    monkeypatch.setattr(crash,'CASES',('one',))
    monkeypatch.setattr(crash,'run_case',lambda *args:args[-1].update(passed=True))
    out=tmp_path/'out'
    assert crash.run(out)==0
    report=json.loads((out/'crash-dispatch-http.json').read_text())
    assert report['source_before']==report['source_after']
    assert report['source_before']['kind']=='package-source' and report['source_unchanged']
    def tamper(*args):
        args[-1]['passed']=True;(package/'tests/input.json').write_text('{"tampered":true}')
    monkeypatch.setattr(crash,'run_case',tamper)
    assert crash.run(out)==1
    report=json.loads((out/'crash-dispatch-http.json').read_text())
    assert not report['passed'] and 'mismatch' in report['error']
    crash.shutil.rmtree(report['retained_temporary_root'])


def test_tls_missing_identity_writes_failure_without_launching_server(package,tmp_path,monkeypatch):
    (tmp_path/identity.MANIFEST).unlink();monkeypatch.setattr(tls,'ROOT',package)
    nginx=tmp_path/'nginx';nginx.write_bytes(b'not executed')
    out=tmp_path/'tls-out'
    monkeypatch.setattr(tls.sys,'argv',['tls_proxy_check.py','--nginx',str(nginx),'--output',str(out)])
    monkeypatch.setattr(tls,'OwnedProcess',lambda *a,**kw:pytest.fail('No server before source identity'))
    assert tls.main()==1
    report=json.loads((out/'tls-proxy.json').read_text())
    assert not report['passed'] and report['cleanup_confirmed']
    assert 'unverified' in report['error']['message'] and report['real_external_supplier_calls']==0


def add_bundle(package,tmp_path):
    path=tmp_path/'HISTORY/release-commits.bundle';path.parent.mkdir();path.write_bytes(b'test attachment bytes')
    manifest=tmp_path/identity.MANIFEST;value=json.loads(manifest.read_text())
    value['artifacts']=[dict(type='git_bundle',path='HISTORY/release-commits.bundle',
        bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        requires_commit='c'*40,contains_commit=value['commit'])]
    manifest.write_text(json.dumps(value))
    return manifest,value,path


def test_optional_bundle_attachment_is_verified_separately_from_source(package,tmp_path):
    before=collect(package,tmp_path)
    _,value,_=add_bundle(package,tmp_path)
    after=collect(package,tmp_path)
    assert after['source_set_sha256']==before['source_set_sha256']
    assert after['files_sha256']==before['files_sha256']
    assert after['package_artifacts']==value['artifacts']
    assert 'declarations' in after['artifact_verification']


@pytest.mark.parametrize('mutation',['hash','missing','symlink','traversal','duplicate','unknown_type',
    'unknown_key','bad_commit','wrong_commit','extra_top_key','bad_list'])
def test_invalid_bundle_artifact_fails_closed(package,tmp_path,mutation):
    manifest,value,path=add_bundle(package,tmp_path)
    artifact=value['artifacts'][0]
    if mutation=='hash':path.write_bytes(b'tampered attachment')
    elif mutation=='missing':path.unlink()
    elif mutation=='symlink':
        other=tmp_path/'other.bundle';path.rename(other);path.symlink_to(other)
    elif mutation=='traversal':artifact['path']='../outside.bundle'
    elif mutation=='duplicate':value['artifacts'].append(dict(artifact))
    elif mutation=='unknown_type':artifact['type']='arbitrary'
    elif mutation=='unknown_key':artifact['unrecognized']=True
    elif mutation=='bad_commit':artifact['requires_commit']='fake'
    elif mutation=='wrong_commit':artifact['contains_commit']='d'*40
    elif mutation=='extra_top_key':value['unrecognized']=True
    elif mutation=='bad_list':value['artifacts']={}
    manifest.write_text(json.dumps(value))
    with pytest.raises((ValueError,OSError)):
        collect(package,tmp_path)
