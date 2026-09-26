"""Apply transparent reviewed source diffs with exact release-byte verification.

Used only on the dedicated refactor branch, never on main. No dynamic Python
execution or arbitrary shell text. Temporary delivery inputs are removed after
source/brand/compiler checks; normal CI then tests the committed source SHA.
"""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
D=ROOT/'.delivery'
M=json.loads((D/'manifest.json').read_text(encoding='utf-8'))
def run(args):subprocess.run(args,cwd=ROOT,check=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def path(name):
    p=Path(name)
    if p.is_absolute() or '..' in p.parts or set(p.parts)&{'.git','.runtime','.venv','node_modules'}:raise ValueError('Unsafe release path')
    out=ROOT/p
    if out.is_symlink() or any(v.is_symlink() for v in out.parents if v!=ROOT.parent):raise ValueError('Release symlink refused')
    return out
if '--check-build' in sys.argv:
    actual={p.name:sha(p) for p in (ROOT/'web/dist').glob('*.js')}
    if actual!=M['compiled']:raise RuntimeError('Compiled frontend differs from the tested artifact')
    for name,item in M['files'].items():
        if sha(path(name))!=item['sha256']:raise RuntimeError('Source changed after assembly: '+name)
    for name,expected in M['brand'].items():
        if sha(ROOT/'web/brand'/name)!=expected:raise RuntimeError('Original brand bytes changed')
    shutil.rmtree(D)
else:
    run(['git','merge-base','--is-ancestor',M['base_commit'],'HEAD'])
    for name,expected in M['parts'].items():
        if sha(D/name)!=expected:raise RuntimeError('Patch transport hash mismatch: '+name)
    for name in M['files']:
        p=path(name)
        if p.exists():
            text=p.read_text(encoding='utf-8-sig').replace('\r\n','\n')
            if text and not text.endswith('\n'):text+='\n'
            p.write_bytes(text.encode('utf-8'))
    parts=[str(D/name) for name in sorted(M['parts'])]
    run(['git','apply','--check','--whitespace=nowarn',*parts])
    run(['git','apply','--whitespace=nowarn',*parts])
    for name,item in M['files'].items():
        p=path(name)
        if item['newline']=='crlf':p.write_bytes(p.read_bytes().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'))
        if sha(p)!=item['sha256']:raise RuntimeError('Assembled source hash mismatch: '+name)
    for p in (ROOT/'web/dist').glob('*'):
        if p.suffix in ('.js','.map'):p.unlink()
    print('Reviewed source diffs applied; all release source hashes match.')
