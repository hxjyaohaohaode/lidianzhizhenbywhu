"""Online SQLite backup; private model credentials require a matching key.

By default only the database is copied, with a warning when encrypted credentials
are present. --include-key creates a separate restrictive key file alongside it.
Protect and encrypt the pair outside the machine; this is not encrypted backup.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path


def exclusive_file(path: Path, content: bytes=b''):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(content);f.flush();os.fsync(f.fileno())


def backup(source: Path, target: Path, *, include_key=False) -> dict:
    source=source.resolve();target=target.absolute()
    if not source.is_file():raise ValueError('源数据库不存在；没有创建空数据库。')
    if target.exists() or target.is_symlink() or target.resolve()==source:raise ValueError('目标存在，拒绝覆盖。')
    key=source.parent/'credentials.key';key_target=target.with_name(target.name+'.credentials.key')
    meta=target.with_name(target.name+'.backup.json')
    if meta.exists() or (include_key and (key_target.exists() or key_target.is_symlink())):raise ValueError('备份配套文件已经存在，拒绝覆盖。')
    created=[];target.parent.mkdir(parents=True,exist_ok=True)
    try:
        with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as src:
            exclusive_file(target);created.append(target)
            with closing(sqlite3.connect(target)) as dst:
                src.backup(dst)
                if dst.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('数据库完整性检查失败')
                # Count and verify credentials in the completed snapshot, never a
                # pre-backup live query that can race a concurrent connection save.
                present=bool(dst.execute("SELECT 1 FROM sqlite_master WHERE name='private_connections' AND type='table'").fetchone())
                ciphers=dst.execute('SELECT cipher FROM private_connections').fetchall() if present else []
                required=len(ciphers)
                key_bytes=None
                if include_key and required:
                    if key.is_symlink() or not key.is_file():raise ValueError('凭据主密钥不存在或是链接，未创建不完整备份。')
                    key_bytes=key.read_bytes()
                    try:
                        from cryptography.fernet import Fernet
                        cipher=Fernet(key_bytes)
                        for encrypted, in ciphers:cipher.decrypt(encrypted.encode('ascii'))
                    except Exception:
                        raise ValueError('凭据主密钥格式无效或与备份数据不匹配，未创建不可恢复备份。') from None
            if key_bytes:
                exclusive_file(key_target,key_bytes);created.append(key_target)
            receipt={'output':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
                'integrity':'ok','private_connection_count':required,'matching_key_required':bool(required),
                'key_included':bool(key_bytes),'key_file':key_target.name if key_bytes else None,
                'warning':'包含账户哈希和业务资料。密钥与数据库同时被读取可解密API凭据；应离线加密备份并限制访问。' if key_bytes else
                '包含账户哈希和业务资料；必须加密并限制访问。' + ('私有凭据恢复还需要原 credentials.key，不可生成新密钥替代。' if required else '')}
            exclusive_file(meta,json.dumps(receipt,ensure_ascii=False,indent=2).encode());created.append(meta)
            return receipt
    except BaseException:
        for path in reversed(created):
            try:path.unlink()
            except OSError:pass
        raise


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',default='.runtime/workbench/lidian.sqlite3');p.add_argument('--output',required=True);p.add_argument('--include-key',action='store_true',help='明确同意复制配对的API凭据主密钥到单独文件，请离线加密保护');a=p.parse_args()
    try:print(json.dumps(backup(Path(a.source),Path(a.output),include_key=a.include_key),ensure_ascii=False))
    except (ValueError,OSError,sqlite3.Error) as exc:raise SystemExit(str(exc)) from None
if __name__=='__main__':main()
