"""Verified plain source diff, on the dedicated branch only; no arbitrary execution."""
from pathlib import Path
import hashlib,json,shutil,subprocess
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'.delivery'
m=json.loads((D/'manifest.json').read_text())
def run(args):subprocess.run(args,cwd=ROOT,check=True)
run(['git','merge-base','--is-ancestor',m['base_commit'],'HEAD'])
patch=D/'update.patch'
if hashlib.sha256(patch.read_bytes()).hexdigest()!=m['patch_sha256']:raise RuntimeError('Transport hash mismatch')
for name in m['files']:
 p=Path(name)
 if p.is_absolute() or '..' in p.parts or p.parts[0] not in ('server','scripts','tests'):raise RuntimeError('Unapproved source path')
run(['git','apply','--check','--whitespace=nowarn',str(patch)])
run(['git','apply','--whitespace=nowarn',str(patch)])
for name,item in m['files'].items():
 if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=item['sha256']:raise RuntimeError('Assembled source mismatch: '+name)
shutil.copyfile(D/'final-ci.yml',ROOT/'.github/workflows/ci.yml')
shutil.rmtree(D)
print('Source hashes verified; temporary inputs removed; standard read-only CI restored.')
