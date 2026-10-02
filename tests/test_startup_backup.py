"""Executable bootstrap, backup and recovery contracts; Windows behavior stays separately qualified."""
from contextlib import closing
import importlib.util
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import pytest
from server.store import Store
from server.connections import ConnectionVault
from server.service_contracts import PrivateConnection
from conftest import Actor

ROOT=Path(__file__).resolve().parents[1]
def module(name):
    spec=importlib.util.spec_from_file_location('local_'+name,ROOT/'scripts'/f'{name}.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
boot=module('bootstrap');start=module('start');back=module('backup')


def project(path):
    path.mkdir();(path/'server').mkdir();(path/'server/app.py').write_text('');(path/'requirements.txt').write_text('');(path/'web/dist').mkdir(parents=True);(path/'web/dist/app.js').write_text('');return path


def test_probe_really_runs_current_interpreter_and_rejects_missing(tmp_path):
    assert boot.probe([sys.executable])['version'][:2]==list(sys.version_info[:2])
    assert boot.probe([str(tmp_path/'missing.exe')]) is None


def test_python_selection_skips_a_broken_launcher(monkeypatch):
    monkeypatch.setattr(boot,'candidates',lambda:[['py','-3'],[sys.executable]])
    monkeypatch.setattr(boot,'probe',lambda cmd:None if cmd[0]=='py' else {'executable':sys.executable})
    assert boot.select_python()==sys.executable


def test_python_selection_reports_no_runnable_installation(monkeypatch):
    monkeypatch.setattr(boot,'probe',lambda cmd:None)
    with pytest.raises(RuntimeError,match='没有找到'):boot.select_python()


def test_bad_venv_is_retained_instead_of_deleted(tmp_path):
    p=project(tmp_path/'含中文与空格 project');(p/'.venv').mkdir();(p/'.venv/user-marker').write_text('keep')
    with pytest.raises(RuntimeError,match='没有删除'):boot.prepare(p,install=False)
    assert (p/'.venv/user-marker').read_text()=='keep'


def test_wrong_venv_prefix_never_installs_globally(tmp_path,monkeypatch):
    p=project(tmp_path/'project');(p/'.venv').mkdir()
    monkeypatch.setattr(boot,'probe',lambda cmd:{'prefix':str(tmp_path/'elsewhere'),'base_prefix':'base'})
    with pytest.raises(RuntimeError,match='不属于'):boot.prepare(p)


def test_missing_compiled_frontend_stops_before_install(tmp_path):
    p=project(tmp_path/'project');(p/'web/dist/app.js').unlink()
    with pytest.raises(RuntimeError,match='编译前端'):boot.prepare(p,yes=True)
    assert not (p/'.venv').exists()


def test_existing_env_requires_explicit_download_consent(tmp_path,monkeypatch):
    p=project(tmp_path/'project');(p/'.venv').mkdir()
    monkeypatch.setattr(boot,'probe',lambda cmd:{'prefix':str(p/'.venv'),'base_prefix':str(tmp_path),'version':[3,13,5]})
    monkeypatch.setattr(boot,'check_runtime',lambda *args:(False,'missing'))
    monkeypatch.setattr('builtins.input',lambda prompt:'n')
    with pytest.raises(RuntimeError,match='没有获得'):boot.prepare(p)
    assert not (p/'.runtime/setup-check.json').exists()


def test_valid_existing_venv_writes_diagnostic_receipt_only(tmp_path,monkeypatch):
    p=project(tmp_path/'project');(p/'.venv').mkdir()
    monkeypatch.setattr(boot,'probe',lambda cmd:{'prefix':str(p/'.venv'),'base_prefix':'base','version':[3,13,5],'executable':str(p/'.venv/bin/python')})
    monkeypatch.setattr(boot,'check_runtime',lambda *args:(True,'[]'))
    boot.prepare(p,install=False)
    assert json.loads((p/'.runtime/setup-check.json').read_text())['external_provider_test']=='not_run'


def test_pinned_dependency_check_rejects_any_installed_version_mismatch():
    # This tests the guard, not a claim that this machine installed release pins.
    import importlib.metadata as metadata
    expected=True
    for line in (ROOT/'requirements.txt').read_text().splitlines():
        if not line or line.startswith('#'):continue
        name,version=line.split('==')
        try:expected = expected and metadata.version(name)==version
        except metadata.PackageNotFoundError:expected=False
    passed,detail=boot.check_runtime(Path(sys.executable));assert passed is expected,detail


def test_second_bootstrap_process_cannot_install_concurrently(tmp_path):
    with boot.SetupLock(tmp_path/'setup.lock'):
        with pytest.raises(RuntimeError,match='已有安装'):boot.SetupLock(tmp_path/'setup.lock').__enter__()


def test_environment_file_is_literal_and_shell_has_precedence(tmp_path,monkeypatch):
    p=tmp_path/'.env';p.write_text('APP_TEST_A="$(not executed)"\nAPP_TEST_B=from_file\n',encoding='utf-8')
    monkeypatch.delenv('APP_TEST_A',raising=False);monkeypatch.setenv('APP_TEST_B','shell')
    start.load_env(p)
    assert os.environ['APP_TEST_A']=='$(not executed)' and os.environ['APP_TEST_B']=='shell'
    monkeypatch.delenv('APP_TEST_A')


@pytest.mark.parametrize('text',['BAD LINE SECRET_VALUE','KEY=x\nKEY=SECRET_VALUE','KEY="SECRET_VALUE','BAD-NAME=SECRET_VALUE','KEY=SECRET_VALUE\x00'])
def test_bad_env_fails_without_printing_values(tmp_path,text):
    p=tmp_path/'.env';p.write_text(text)
    with pytest.raises(ValueError) as e:start.load_env(p)
    assert 'SECRET_VALUE' not in str(e.value)


def test_port_probe_does_not_terminate_existing_listener():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));sock.listen();port=sock.getsockname()[1]
        assert not start.port_available('127.0.0.1',port)
        assert sock.fileno()>=0


def test_backup_missing_db_and_existing_destination_are_not_mutated(tmp_path):
    with pytest.raises(ValueError):back.backup(tmp_path/'missing',tmp_path/'out')
    assert not (tmp_path/'missing').exists()
    s=Store(tmp_path/'source.sqlite3');s.close();target=tmp_path/'out';target.write_bytes(b'KEEP')
    with pytest.raises(ValueError):back.backup(s.path,target)
    assert target.read_bytes()==b'KEEP'


def test_online_backup_restores_data_and_declares_key_requirement(actor,tmp_path):
    store=actor.client.app.state.store;vault=actor.client.app.state.providers.vault
    v=PrivateConnection(name='备份验收',base_url='https://models.test.example/v1',model='test',api_key='TEST_ONLY_SECRET',password=actor.password)
    row=vault.save(actor.user['id'],v);target=tmp_path/'backup.sqlite3'
    receipt=back.backup(store.path,target,include_key=True)
    assert receipt['key_included'] and receipt['matching_key_required'] and receipt['integrity']=='ok'
    restored=Store(target)
    # Explicit restore pairs the matching key with the backup directory, not a newly generated key.
    paired=target.with_name(target.name+'.credentials.key');(target.parent/'credentials.key').write_bytes(paired.read_bytes())
    new=ConnectionVault(restored,target.parent);assert new.select(row['id'],actor.user['id']).key=='TEST_ONLY_SECRET';restored.close()
    assert 'TEST_ONLY_SECRET' not in json.dumps(receipt)


def test_db_only_backup_does_not_implicitly_copy_secret_key(actor,tmp_path):
    vault=actor.client.app.state.providers.vault
    vault.save(actor.user['id'],PrivateConnection(name='x',base_url='https://models.test.example/v1',model='x',api_key='TEST_ONLY',password=actor.password))
    receipt=back.backup(actor.client.app.state.store.path,tmp_path/'db')
    assert receipt['matching_key_required'] and not receipt['key_included']
    assert not (tmp_path/'db.credentials.key').exists()


def test_missing_key_is_not_silently_replaced(actor,tmp_path):
    vault=actor.client.app.state.providers.vault
    row=vault.save(actor.user['id'],PrivateConnection(name='x',base_url='https://models.test.example/v1',model='x',api_key='TEST_ONLY',password=actor.password))
    vault.path.unlink();vault._fernet=None
    with pytest.raises(RuntimeError,match='缺失'):vault.select(row['id'],actor.user['id'])
    assert not vault.path.exists()
    with pytest.raises(ValueError,match='主密钥不存在'):back.backup(actor.client.app.state.store.path,tmp_path/'incomplete',include_key=True)
    assert not (tmp_path/'incomplete').exists()


def test_extended_database_is_marked_incompatible_with_old_writers(tmp_path):
    p=tmp_path/'db';s=Store(p);assert s.one('SELECT MAX(version) AS v FROM schema_version')['v']==3;s.close()
    with closing(sqlite3.connect(p)) as c:c.execute('INSERT INTO schema_version VALUES(999)');c.commit()
    with pytest.raises(RuntimeError,match='拒绝降级'):Store(p)


def test_backup_rejects_valid_but_nonmatching_key_and_cleans_outputs(actor,tmp_path):
    from cryptography.fernet import Fernet
    vault=actor.client.app.state.providers.vault
    vault.save(actor.user['id'],PrivateConnection(name='x',base_url='https://models.test.example/v1',model='x',api_key='TEST_ONLY',password=actor.password))
    vault.path.write_bytes(Fernet.generate_key())
    target=tmp_path/'mismatched.sqlite3'
    with pytest.raises(ValueError,match='不匹配'):
        back.backup(actor.client.app.state.store.path,target,include_key=True)
    assert not target.exists()
    assert not target.with_name(target.name+'.credentials.key').exists()
    assert not target.with_name(target.name+'.backup.json').exists()


def test_native_acceptance_invalidates_stale_success_before_launch(tmp_path,monkeypatch):
    native=module('native_acceptance')
    monkeypatch.setattr(native,'ROOT',tmp_path)
    monkeypatch.setattr(sys,'argv',['native_acceptance.py'])
    out=tmp_path/'evidence';out.mkdir()
    report=out/'native-service-browser.json'
    report.write_text(json.dumps({'all_checks_passed':True,'screenshots':['old.png']}))
    class UnavailableSocket:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def bind(self,*args):raise OSError('test-only occupied port')
    monkeypatch.setattr(native.socket,'socket',UnavailableSocket)
    with pytest.raises(SystemExit):native.main()
    current=json.loads(report.read_text())
    assert current['all_checks_passed'] is False and current['screenshots']==[]
    assert current['status']=='not_completed' and current['attempted_at']
