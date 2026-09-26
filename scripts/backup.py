"""Online-safe SQLite backup; refuse to overwrite or create a missing source DB."""
import argparse,hashlib,json,os,sqlite3
from pathlib import Path
from contextlib import closing

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',default='.runtime/workbench/lidian.sqlite3');p.add_argument('--output',required=True);a=p.parse_args();source=Path(a.source).resolve();target=Path(a.output).resolve()
    if not source.is_file():raise SystemExit('源数据库不存在；没有创建空数据库。')
    if target.exists() or target==source:raise SystemExit('目标存在，拒绝覆盖。')
    target.parent.mkdir(parents=True,exist_ok=True)
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as src,closing(sqlite3.connect(target)) as dst:
        src.backup(dst)
        if dst.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise SystemExit('完整性检查失败')
    os.chmod(target,0o600)
    print(json.dumps({'output':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'warning':'备份包含账户哈希与业务资料，必须加密并限制访问。'},ensure_ascii=False))
if __name__=='__main__':main()
