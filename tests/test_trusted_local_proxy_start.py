"""Forwarded metadata is opt-in and fixed to an isolated trusted local peer."""
import sys
from pathlib import Path
import pytest
from scripts import start


@pytest.mark.parametrize('host',['0.0.0.0','::','::1','192.0.2.10'])
def test_proxy_rejects_non_ipv4_loopback(monkeypatch,host):
    monkeypatch.setenv('APP_ENV','production')
    with pytest.raises(ValueError):start.proxy_options(True,host)


def test_proxy_default_off_and_no_ambient_wildcard(monkeypatch):
    monkeypatch.setenv('FORWARDED_ALLOW_IPS','*');monkeypatch.setenv('APP_ENV','development')
    assert start.proxy_options(False,'127.0.0.1')=={'proxy_headers':False}
    with pytest.raises(ValueError):start.proxy_options(True,'127.0.0.1')
    monkeypatch.setenv('APP_ENV','production')
    assert start.proxy_options(True,'127.0.0.1')=={'proxy_headers':True,'forwarded_allow_ips':'127.0.0.1'}


@pytest.fixture
def launcher(monkeypatch,tmp_path):
    (tmp_path/'web/dist').mkdir(parents=True);(tmp_path/'web/dist/app.js').write_text('')
    monkeypatch.setattr(start,'ROOT',tmp_path);monkeypatch.setattr(start,'port_available',lambda *a:True)
    monkeypatch.chdir(tmp_path);monkeypatch.setattr(sys,'path',sys.path[:])
    monkeypatch.setenv('APP_ENV','production');monkeypatch.setenv('APP_ORIGIN','https://lidian.example.invalid')
    monkeypatch.setenv('REGISTRATION_CODE','SYNTHETIC-INVITE-ONLY');monkeypatch.setenv('DATA_DIR',str(tmp_path/'data'))
    import uvicorn
    calls=[];monkeypatch.setattr(uvicorn,'run',lambda *a,**kw:calls.append((a,kw)))
    def run(*args):
        monkeypatch.setattr(sys,'argv',['start.py','--port','8101',*args]);start.main();return calls
    return run,calls


def test_launcher_passes_fixed_allowlist_and_single_worker(launcher,monkeypatch):
    run,calls=launcher;monkeypatch.setenv('FORWARDED_ALLOW_IPS','*');run('--trusted-local-proxy')
    assert calls[0][0]==('server.app:app',)
    assert calls[0][1]['host']=='127.0.0.1' and calls[0][1]['workers']==1
    assert calls[0][1]['proxy_headers'] is True and calls[0][1]['forwarded_allow_ips']=='127.0.0.1'


def test_launcher_normal_production_binding_remains_available(launcher):
    run,calls=launcher;run('--host','0.0.0.0')
    assert calls[0][1]['host']=='0.0.0.0' and calls[0][1]['proxy_headers'] is False
    assert 'forwarded_allow_ips' not in calls[0][1]


def test_launcher_preserves_startup_validation(launcher,monkeypatch):
    run,calls=launcher;monkeypatch.setenv('APP_ORIGIN','http://lidian.example.invalid')
    with pytest.raises(SystemExit):run('--trusted-local-proxy')
    assert not calls


def test_launcher_rejects_public_binding_with_proxy(launcher):
    run,calls=launcher
    with pytest.raises(SystemExit):run('--host','0.0.0.0','--trusted-local-proxy')
    assert not calls
