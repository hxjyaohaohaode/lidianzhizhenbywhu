"""Local deployment contracts; no image build, hosting, TLS, or browser claim.

The staging helper interprets only the COPY forms in this repository's final
Docker stage. It deliberately does not pretend to execute Docker RUN commands.
"""
from contextlib import closing
from html.parser import HTMLParser
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

from server.app import make_app
from server.config import Settings
from server.service_contracts import PrivateConnection

ROOT = Path(__file__).resolve().parents[1]


def require_explicit_non_deploying_branches(config):
    rules = config['git']['deploymentEnabled']
    # Vercel defaults unspecified branches to enabled. A matching true wildcard
    # can override branch false, so the reviewed two-branch map is exact.
    assert isinstance(rules, dict)
    assert set(rules) == {'main', 'feat/research-workbench-hardening'}
    assert all(value is False for value in rules.values())


def test_main_and_review_branch_cannot_automatically_deploy():
    require_explicit_non_deploying_branches(json.loads((ROOT / 'vercel.json').read_text()))


@pytest.mark.parametrize('rules', [
    {},
    {'feat/research-workbench-hardening': False},
    {'main': False},
    {'main': True, 'feat/research-workbench-hardening': False},
    {'main': False, 'feat/research-workbench-hardening': True},
    {'main': False, 'feat/research-workbench-hardening': False, '*': True},
    {'main': 'false', 'feat/research-workbench-hardening': False},
    {'main': 0, 'feat/research-workbench-hardening': False},
    False,
])
def test_automatic_deployment_guard_rejects_missing_enabled_or_ambiguous_rules(rules):
    with pytest.raises(AssertionError):
        require_explicit_non_deploying_branches({'git': {'deploymentEnabled': rules}})


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.paths.append(attrs['src'])
        if tag == 'link' and attrs.get('href'):
            self.paths.append(attrs['href'])


def test_entry_assets_and_transitive_modules_are_served_by_application(client):
    module_entries = set()
    for page, entry in (('/', 'app.js'), ('/api/docs', 'docs.js')):
        response = client.get(page)
        assert response.status_code == 200, page
        parser = PageAssets()
        parser.feed(response.text)
        assert '/assets/dist/' + entry in parser.paths
        for path in parser.paths:
            assert path.startswith('/assets/')
            response = client.get(path)
            assert response.status_code == 200, path
            assert response.content == (ROOT / 'web' / path.removeprefix('/assets/')).read_bytes()
            assert response.headers['x-content-type-options'] == 'nosniff'
            if path.startswith('/assets/dist/') and path.endswith('.js'):
                module_entries.add(path.removeprefix('/assets/dist/'))
    # Parse module syntax, not occurrences of "import" inside UI strings.
    parsed = subprocess.run(['node', '--input-type=module', '-e', '''
import ts from 'typescript';
import {readFileSync, readdirSync} from 'node:fs';
const graph = {};
for (const name of readdirSync('web/dist').filter(name => name.endsWith('.js'))) {
  const file = ts.createSourceFile(name, readFileSync('web/dist/' + name, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const dependencies = graph[name] = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) throw Error('Nonliteral module dependency');
      dependencies.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw Error('Nonliteral dynamic import');
      dependencies.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
}
console.log(JSON.stringify(graph));
'''], cwd=ROOT, capture_output=True, text=True, timeout=30)
    assert parsed.returncode == 0, parsed.stderr
    graph = json.loads(parsed.stdout)
    pending, visited = list(module_entries), set()
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        response = client.get('/assets/dist/' + name)
        assert response.status_code == 200, name
        assert 'javascript' in response.headers['content-type'], name
        for target in graph[name]:
            assert target.startswith('./') and target.endswith('.js'), (name, target)
            pending.append(target.removeprefix('./'))
    assert {'api.js', 'brand.js', 'live.js', 'docs.js'} <= visited
    assert client.get('/api/health').json()['mode'] == 'single_process'
    assert client.get('/api/auth/me').status_code == 401


def test_plain_static_output_is_not_the_application():
    # Faithful local static-directory routing, not a request to Vercel.
    for root, index_status in [(ROOT / 'web', 200), (ROOT / 'web/dist', 404)]:
        static = Starlette(routes=[Mount('/', app=StaticFiles(directory=root, html=True))])
        with TestClient(static) as client:
            assert client.get('/').status_code == index_status
            for path in ('/assets/dist/app.js', '/assets/styles.css', '/api/health'):
                assert client.get(path).status_code == 404


def test_production_same_origin_cookie_and_host_contract(tmp_path):
    origin = 'https://deployment.test.example'
    settings = Settings(data_dir=tmp_path / 'data', production=True,
                        origin=origin, invite_code='SYNTHETIC-INVITATION-ONLY')
    with TestClient(make_app(settings, worker_enabled=False), base_url=origin) as client:
        assert client.get('/api/health').status_code == 200
        assert client.get('/api/health', headers={'Host': 'other.test.example'}).status_code == 400
        registration = client.post('/api/auth/register', json={
            'name': '部署合同合成账户', 'email': 'deployment@test.example',
            'password': 'Synthetic-deployment-password', 'invitation': settings.invite_code,
        }, headers={'Origin': origin})
        assert registration.status_code == 201, registration.text
        cookie = registration.headers['set-cookie'].lower()
        assert 'secure' in cookie and 'httponly' in cookie and 'samesite=strict' in cookie
        assert client.get('/api/datasets').json()['items'] == []
        csrf = registration.json()['csrf']
        for headers in ({'Origin': origin}, {'Origin': 'https://other.test.example', 'X-CSRF-Token': csrf}):
            assert client.post('/api/auth/logout', headers=headers).status_code == 403
        assert client.post('/api/auth/logout', headers={'Origin': origin, 'X-CSRF-Token': csrf}).status_code == 200


def stage_runtime_copy_layout(target):
    """Stage the reviewed COPY subset; reject changed layout/ignore assumptions.

    This is not a general Dockerfile or .dockerignore interpreter. The current
    ignore policy is pinned here deliberately: any change needs an explicit
    review of its effect on COPY inputs before this simulation may accept it.
    """
    reviewed_ignore_rules = ('.git', '.venv', 'node_modules', '.runtime', 'backups',
                            '.env', '.env.*', 'evidence', '__pycache__', '.pytest_cache', '.coverage')
    ignore_rules = tuple(line.strip() for line in (ROOT / '.dockerignore').read_text().splitlines()
                         if line.strip() and not line.lstrip().startswith('#'))
    assert ignore_rules == reviewed_ignore_rules, 'Unsupported .dockerignore change; review real Docker COPY behavior'
    text = (ROOT / 'Dockerfile').read_text()
    instructions = [shlex.split(line, comments=True) for line in text.splitlines() if line.strip()]
    stages = [index for index, words in enumerate(instructions) if words and words[0] == 'FROM']
    assert stages, 'Missing Docker stage'
    instructions = instructions[stages[-1]:]
    workdirs = [index for index, words in enumerate(instructions) if words and words[0] == 'WORKDIR']
    assert len(workdirs) == 1 and instructions[workdirs[0]] == ['WORKDIR', '/app'], 'Unsupported runtime WORKDIR'
    copies = []
    for index, words in enumerate(instructions):
        if not words or words[0] != 'COPY':
            continue
        assert index > workdirs[0], 'COPY before reviewed runtime WORKDIR'
        args = words[1:]
        if args[0].startswith('--'):
            assert args[0] == '--from=frontend'
            assert args[1] == '/build/web/dist'
            args = ['web/dist', *args[2:]]
        assert len(args) >= 2
        sources, destination = args[:-1], args[-1]
        assert len(sources) == 1 or destination.endswith('/'), 'Multiple COPY sources require a directory ending in /'
        assert not destination.startswith('/') and '..' not in Path(destination).parts
        for source in sources:
            assert not source.startswith('/') and '..' not in Path(source).parts
        copies.append((sources, destination))
    # Validate all supported assumptions before writing any staging output.
    target.mkdir()
    for sources, destination in copies:
        for source in sources:
            src, dst = ROOT / source, target / destination
            if src.is_dir():
                shutil.copytree(src, dst, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            else:
                if len(sources) > 1 or destination.endswith('/'):
                    dst = dst / src.name
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dst)
    return target


@pytest.mark.parametrize('change', [
    'missing_directory_slash', 'different_workdir', 'relative_workdir', 'second_workdir',
    'copy_before_workdir', 'excluded_backup', 'negated_ignore', 'wildcard_ignore', 'removed_ignore',
])
def test_runtime_copy_staging_rejects_unsupported_layout_before_writing(tmp_path, monkeypatch, change):
    source = tmp_path / 'source'
    source.mkdir()
    dockerfile = (ROOT / 'Dockerfile').read_text()
    ignore = (ROOT / '.dockerignore').read_text()
    if change == 'missing_directory_slash':
        dockerfile = dockerfile.replace('COPY scripts/start.py scripts/backup.py ./scripts/',
                                        'COPY scripts/start.py scripts/backup.py ./scripts')
    elif change == 'different_workdir':
        dockerfile = dockerfile.replace('WORKDIR /app', 'WORKDIR /different')
    elif change == 'relative_workdir':
        dockerfile = dockerfile.replace('WORKDIR /app', 'WORKDIR app')
    elif change == 'second_workdir':
        dockerfile = dockerfile.replace('COPY server ./server', 'WORKDIR /app/subdir\nCOPY server ./server')
    elif change == 'copy_before_workdir':
        dockerfile = dockerfile.replace('WORKDIR /app', 'COPY requirements.txt ./\nWORKDIR /app')
    elif change == 'excluded_backup':
        ignore += '\nscripts/backup.py\n'
    elif change == 'negated_ignore':
        ignore += '\n!scripts/backup.py\n'
    elif change == 'wildcard_ignore':
        ignore += '\nscripts/**\n'
    else:
        ignore = ignore.replace('.env.*\n', '')
    (source / 'Dockerfile').write_text(dockerfile)
    (source / '.dockerignore').write_text(ignore)
    monkeypatch.setattr(sys.modules[__name__], 'ROOT', source)
    target = tmp_path / 'image-app'
    with pytest.raises(AssertionError):
        stage_runtime_copy_layout(target)
    assert not target.exists()


def test_runtime_copy_layout_can_backup_and_restore_paired_credentials(actor, tmp_path):
    staged = stage_runtime_copy_layout(tmp_path / 'image-app')
    backup_script = staged / 'scripts/backup.py'
    assert backup_script.is_file(), 'Runtime image must include the documented safe SQLite backup command'
    for name in ('server/store.py', 'server/connections.py', 'web/index.html', 'web/dist/app.js',
                 'web/brand/logo.png', 'web/brand/loading-video.mp4', 'examples/template.csv'):
        assert (staged / name).read_bytes() == (ROOT / name).read_bytes(), name
    requirements = (staged / 'requirements.txt').read_text().splitlines()
    assert any(line.startswith('cryptography==') for line in requirements)
    vault = actor.client.app.state.providers.vault
    connection = vault.save(actor.user['id'], PrivateConnection(
        name='合成容器备份合同', base_url='https://models.test.example/v1',
        model='synthetic', api_key='SYNTHETIC_CONTAINER_SECRET', password=actor.password))
    target = tmp_path / 'restore/lidian.sqlite3'
    # Isolated mode and staged cwd prevent Python imports from the source checkout.
    env = {key: value for key, value in os.environ.items()
           if key in ('PATH', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL')}
    result = subprocess.run([sys.executable, '-I', str(backup_script), '--source',
                             str(actor.client.app.state.store.path), '--output', str(target), '--include-key'],
                            cwd=staged, env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert 'SYNTHETIC_CONTAINER_SECRET' not in result.stdout + result.stderr
    receipt = json.loads(result.stdout)
    assert receipt['integrity'] == receipt['foreign_key_check'] == 'ok'
    assert receipt['key_included'] and receipt['matching_key_required']
    assert receipt['sha256'] == hashlib.sha256(target.read_bytes()).hexdigest()
    with closing(sqlite3.connect(target)) as restored:
        assert restored.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert restored.execute('PRAGMA foreign_key_check').fetchall() == []
        assert restored.execute('SELECT email FROM users').fetchone()[0] == actor.email
    shutil.copyfile(target.with_name(target.name + '.credentials.key'), target.parent / 'credentials.key')
    code = '''import sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
from server.store import Store
from server.connections import ConnectionVault
import server
assert Path(server.__file__).resolve().is_relative_to(Path.cwd())
store = Store(Path(sys.argv[1]))
try:
    selected = ConnectionVault(store, Path(sys.argv[1]).parent).select(sys.argv[2], sys.argv[3])
    assert selected.key == 'SYNTHETIC_CONTAINER_SECRET'
finally:
    store.close()
print('staged runtime restore verified')
'''
    restored = subprocess.run([sys.executable, '-I', '-c', code, str(target), connection['id'], actor.user['id']],
                              cwd=staged, env=env, capture_output=True, text=True, timeout=30)
    assert restored.returncode == 0, restored.stderr
    assert restored.stdout.strip() == 'staged runtime restore verified'
