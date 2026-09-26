"""Publish this exact release from an authenticated local Git client, never force-pushing main.

No tokens are accepted, read or logged by this script. It uses the user's existing Git
credential helper and author configuration. Without --confirm it makes no remote writes.
"""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
REPOSITORY='https://github.com/hxjyaohaohaode/lidianzhizhenbywhu.git'
EXCLUDE={'.git','.venv','node_modules','.runtime','.pytest_cache','__pycache__','backups'}

def run(args: list[str],cwd: Path) -> str:
    result=subprocess.run(args,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
    if result.returncode:raise RuntimeError('Command failed: '+args[0]+' '+str(result.returncode)+'\n'+result.stderr[-2500:])
    return result.stdout.strip()

def source_files() -> list[Path]:
    files=[]
    for p in sorted(ROOT.rglob('*')):
        rel=p.relative_to(ROOT)
        if set(rel.parts)&EXCLUDE:continue
        if p.is_symlink():raise ValueError('Refusing to publish symlink: '+str(rel))
        if not p.is_file():continue
        if p.name in ('.env','.coverage') or (p.name.startswith('.env.') and p.name!='.env.example'):continue
        if p.suffix in ('.sqlite3','.pyc') or p.name.endswith(('-wal','-shm')):continue
        # Remote repository contains source and compact reports; release ZIP carries binaries/screenshots.
        if rel.parts[:2]==('web','dist'):continue
        if rel.parts[0]=='evidence' and p.suffix in ('.png','.log','.xml'):continue
        files.append(p)
    return files

def main() -> int:
    parser=argparse.ArgumentParser(description='在已有Git登录下推送新的重构分支，不覆盖main。')
    parser.add_argument('--confirm',action='store_true',help='允许创建远程新分支并提交当前源码')
    args=parser.parse_args();files=source_files()
    print('Repository:',REPOSITORY);print('Source files:',len(files));print('Main is never force-pushed or merged.')
    if not args.confirm:
        print('仅预览，没有网络写入。完成本机Git登录和回归后，加 --confirm 执行。');return 0
    if not shutil.which('git'):raise RuntimeError('Git is not installed. Use the official Git client and sign in locally first.')
    # Execute the complete Python suite again before any network write.
    run([sys.executable,'-m','pytest','-q'],ROOT)
    branch='refactor/lidian-workspace-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    with tempfile.TemporaryDirectory(prefix='lidian-publish-') as tmp:
        clone=Path(tmp)/'repo'
        run(['git','clone','--single-branch','--branch','main',REPOSITORY,str(clone)],Path(tmp))
        # Author identity is the user's existing Git identity; do not fabricate it or change global config.
        run(['git','var','GIT_AUTHOR_IDENT'],clone)
        base=run(['git','rev-parse','HEAD'],clone)
        run(['git','checkout','-b',branch],clone)
        tracked=run(['git','ls-files','-z'],clone).split('\x00')
        for name in tracked:
            if not name:continue
            target=clone/name
            if target.is_file() or target.is_symlink():target.unlink()
        expected={}
        for source in files:
            rel=source.relative_to(ROOT);target=clone/rel;target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,target);expected[rel.as_posix()]=hashlib.sha256(source.read_bytes()).hexdigest()
        for name,sha in expected.items():
            if hashlib.sha256((clone/name).read_bytes()).hexdigest()!=sha:raise RuntimeError('Copy hash mismatch: '+name)
        run(['git','add','-A'],clone)
        run(['git','commit','-m','refactor: rebuild lithium enterprise evidence workbench v4'],clone)
        commit=run(['git','rev-parse','HEAD'],clone)
        run(['git','push','origin','HEAD:refs/heads/'+branch],clone)
        remote=run(['git','ls-remote','origin','refs/heads/'+branch],clone)
        if not remote.startswith(commit+'\t'):raise RuntimeError('Remote commit verification failed; inspect remote before retrying.')
        receipt={'repository':REPOSITORY,'branch':branch,'base_commit':base,'commit':commit,'remote_verified':True,'files':expected}
        (ROOT/'evidence/publish-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        print('已验证远程分支：',branch);print('commit:',commit)
    return 0

if __name__=='__main__':
    try:raise SystemExit(main())
    except (OSError,ValueError,RuntimeError,subprocess.TimeoutExpired) as exc:
        print(str(exc),file=sys.stderr);raise SystemExit(1)
