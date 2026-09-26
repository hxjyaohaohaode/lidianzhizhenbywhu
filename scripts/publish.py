"""Publish verified source + compiled assets on a new branch using existing Git login.

No credentials are read or printed. Never overwrites main, rewrites history, or
modifies the user's project checkout. Remote SHA verification is not CI success.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid
ROOT=Path(__file__).resolve().parents[1]
REPOSITORY='https://github.com/hxjyaohaohaode/lidianzhizhenbywhu.git'
EXCLUDE={'.git','.venv','node_modules','.runtime','.pytest_cache','__pycache__','backups'}


def run(args:list[str],cwd:Path,*,binary=False,timeout=300):
    result=subprocess.run(args,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if result.returncode:
        # No raw Git diagnostics: credential helpers can embed a credential URL.
        raise RuntimeError(f'命令失败（退出码 {result.returncode}）：{args[0]} {args[1] if len(args)>1 else ""}；未继续推送。')
    return result.stdout if binary else result.stdout.decode('utf-8',errors='strict').strip()


def source_files(root:Path=ROOT)->list[Path]:
    files=[]
    for p in sorted(root.rglob('*')):
        rel=p.relative_to(root)
        if any(x in EXCLUDE or x.startswith('.venv-') for x in rel.parts):continue
        if p.is_symlink():raise ValueError('拒绝发布符号链接：'+rel.as_posix())
        if not p.is_file():continue
        if p.name in ('.env','.coverage','publish-receipt.json') or (p.name.startswith('.env.') and p.name!='.env.example'):continue
        if p.suffix.lower() in ('.db','.sqlite','.sqlite3','.key','.pem','.p12','.pyc','.map','.ttf','.otf','.woff','.woff2') or p.name.endswith(('-wal','-shm')):continue
        if rel.parts[0]=='evidence' and p.suffix.lower() in ('.png','.log','.xml'):continue
        # web/dist/*.js are intentional: clone + bootstrap must work without Node.
        files.append(p)
    required={'web/dist/app.js','web/brand/logo.png','web/brand/loading-video.mp4','scripts/bootstrap.py'}
    if not required.issubset({p.relative_to(root).as_posix() for p in files}):raise ValueError('完整发布缺少启动/编译前端/原始品牌文件。')
    return files


def stage_release(source:Path,target:Path)->dict[str,str]:
    """Replace only a disposable clone's tracked tree; verify bytes in Git's index."""
    if target.resolve()==source.resolve():raise ValueError('禁止在原项目工作区内执行发布替换。')
    if not (target/'.git').is_dir():raise ValueError('发布目标必须是独立的Git克隆。')
    files=source_files(source)
    run(['git','config','core.autocrlf','false'],target)
    tracked=run(['git','ls-files','-z'],target,binary=True).split(b'\0')
    for name in tracked:
        if not name:continue
        relative=name.decode('utf-8');p=target/relative
        if p.is_file() or p.is_symlink():p.unlink()
    expected={}
    for p in files:
        rel=p.relative_to(source);out=target/rel;out.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(p,out);expected[rel.as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
    run(['git','add','-A'],target)
    indexed=run(['git','ls-files','-z'],target,binary=True).split(b'\0')
    actual={name.decode('utf-8') for name in indexed if name}
    if actual!=set(expected):raise RuntimeError('Git暂存文件集合与发布清单不一致。')
    for name,sha in expected.items():
        staged=run(['git','show',':'+name],target,binary=True)
        if hashlib.sha256(staged).hexdigest()!=sha:raise RuntimeError('暂存内容与测试源码不一致：'+name)
    return expected


def main()->int:
    parser=argparse.ArgumentParser(description='完整检查后创建新的远程分支，不覆盖main。')
    parser.add_argument('--confirm',action='store_true',help='明确同意执行测试并推送新分支')
    a=parser.parse_args();files=source_files()
    print('目标仓库：'+REPOSITORY);print('发布文件：'+str(len(files)))
    if not a.confirm:print('仅预览，未修改远程。已有Git登录后使用 --confirm。');return 0
    if not shutil.which('git'):raise RuntimeError('未找到Git。请安装官方Git，并在本机完成登录。')
    # Verify exact pinned environment, compile, tests, and real isolated HTTP chain.
    from bootstrap import check_runtime
    ready,detail=check_runtime(Path(sys.executable))
    if not ready:raise RuntimeError('依赖未满足当前安全版本约束，先运行启动环境检查。'+detail)
    run([sys.executable,'scripts/verify.py','--full-chain'],ROOT,timeout=900)
    branch='refactor/service-workbench-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]
    with tempfile.TemporaryDirectory(prefix='lidian-publish-') as tmp:
        clone=Path(tmp)/'repo';run(['git','clone','--single-branch','--branch','main',REPOSITORY,str(clone)],Path(tmp))
        run(['git','var','GIT_AUTHOR_IDENT'],clone);base=run(['git','rev-parse','HEAD'],clone)
        run(['git','checkout','-b',branch],clone);expected=stage_release(ROOT,clone)
        run(['git','commit','-m','feat: service identities, copilot workflows and secure desktop setup'],clone)
        commit=run(['git','rev-parse','HEAD'],clone)
        run(['git','push','origin','HEAD:refs/heads/'+branch],clone)
        remote=run(['git','ls-remote','origin','refs/heads/'+branch],clone)
        if not remote.startswith(commit+'\t'):raise RuntimeError('远程SHA未匹配。不要盲目重推，请核对远程状态。')
        receipt={'repository':REPOSITORY,'branch':branch,'base_commit':base,'commit':commit,'remote_verified':True,'ci_status':'not_checked','files':expected}
        (ROOT/'evidence').mkdir(exist_ok=True)
        (ROOT/'evidence/publish-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        print('远程提交已核对：'+commit+'\n分支：'+branch+'\n请检查GitHub Actions。远程SHA一致不等于CI通过。')
    return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except (OSError,ValueError,RuntimeError,subprocess.TimeoutExpired) as exc:
        print(str(exc),file=sys.stderr);raise SystemExit(1)
