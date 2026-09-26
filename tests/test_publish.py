"""Actual local Git staging contracts, with no network or credential access."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import pytest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publisher',ROOT/'scripts/publish.py');pub=importlib.util.module_from_spec(spec);spec.loader.exec_module(pub)
def source(p):
    p.mkdir()
    for name in ('web/dist/app.js','web/brand/logo.png','web/brand/loading-video.mp4','scripts/bootstrap.py'):
        f=p/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b'fixture\r\n')
    return p

def test_sources_include_compiled_frontend_exclude_keys_and_broken_venvs(tmp_path):
    p=source(tmp_path/'source')
    for name in ('.env','.runtime/credentials.key','.venv-backup/token.txt','backup.sqlite3','backup.credentials.key','private.pem','web/dist/app.js.map'):
        f=p/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_text('SECRET_TEST_ONLY')
    f=p/'.env.example';f.write_text('APP_ENV=development')
    names={f.relative_to(p).as_posix() for f in pub.source_files(p)}
    assert names=={'web/dist/app.js','web/brand/logo.png','web/brand/loading-video.mp4','scripts/bootstrap.py','.env.example'}

def test_staged_bytes_equal_source_with_windows_line_endings(tmp_path):
    p=source(tmp_path/'source');repo=tmp_path/'isolated';repo.mkdir()
    subprocess.run(['git','init',str(repo)],check=True,capture_output=True)
    (repo/'old.txt').write_text('old');subprocess.run(['git','add','.'],cwd=repo,check=True)
    subprocess.run(['git','config','core.autocrlf','true'],cwd=repo,check=True)
    actual=pub.stage_release(p,repo)
    assert 'web/dist/app.js' in actual and not (repo/'old.txt').exists()
    assert subprocess.check_output(['git','show',':web/dist/app.js'],cwd=repo)==b'fixture\r\n'

def test_publisher_refuses_original_checkout_as_destination(tmp_path):
    p=source(tmp_path/'source')
    with pytest.raises(ValueError,match='原项目'):pub.stage_release(p,p)
