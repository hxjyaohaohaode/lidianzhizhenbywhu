"""Account-private model connections. Secrets never appear in API responses.

Fernet protects SQLite copies without the local master key. It does not protect
against an administrator able to read both files or the running process.
"""
from __future__ import annotations
import threading
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
from cryptography.fernet import Fernet, InvalidToken
from .store import uid, now
from .security import fail
from .providers import Provider


def endpoint(base_url: str) -> tuple[str, str]:
    u = urlsplit(base_url)
    try:
        port = u.port
    except ValueError:
        raise ValueError('模型地址端口无效') from None
    if u.scheme != 'https' or not u.hostname or u.username or u.password or port not in (None, 443) or u.query or u.fragment:
        raise ValueError('仅接受无账号、无查询参数的公共 HTTPS 模型地址，端口限443')
    host = u.hostname.encode('idna').decode('ascii').lower()
    # Literal IPs, localhost and single-label names are never provider destinations.
    if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', host) or host.endswith(('.local', '.localhost', '.internal')):
        raise ValueError('模型地址必须为公共域名，不能是IP、本机或内部地址')
    path = u.path.rstrip('/')
    if not re.fullmatch(r'(?:/[a-zA-Z0-9_.-]+)*', path) or '..' in path:
        raise ValueError('模型接口路径无效')
    if not path.endswith('/chat/completions'):
        path += '/chat/completions'
    return host, path


def migrate(store):
    with store.transaction() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS private_connections(
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL, host TEXT NOT NULL, path TEXT NOT NULL, model TEXT NOT NULL,
            cipher TEXT NOT NULL, version INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')
        db.execute('CREATE INDEX IF NOT EXISTS private_connections_owner ON private_connections(user_id)')
        db.execute('''CREATE TABLE IF NOT EXISTS session_details(
            id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            agent TEXT NOT NULL, created_at TEXT NOT NULL)''')


class ConnectionVault:
    def __init__(self, store, directory: Path):
        self.store = store
        self.path = directory / 'credentials.key'
        self._fernet = None
        self._key_lock = threading.RLock()

    def _key(self):
        with self._key_lock:
            return self._read_key()

    def _read_key(self):
        if self._fernet:
            return self._fernet
        if self.path.is_symlink():
            raise RuntimeError('拒绝使用符号链接形式的凭据主密钥')
        if not self.path.exists() and self.store.one('SELECT count(*) AS n FROM private_connections')['n']:
            raise RuntimeError('凭据主密钥缺失；拒绝创建替代密钥。请恢复配对备份或删除连接后重新配置。')
        try:
            fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            key = self.path.read_bytes()
        else:
            key = Fernet.generate_key()
            with os.fdopen(fd, 'wb') as f:
                f.write(key)
                f.flush()
                os.fsync(f.fileno())
        try:
            self._fernet = Fernet(key)
        except (ValueError, TypeError):
            raise RuntimeError('凭据主密钥损坏；不要重建覆盖，请从成对备份恢复') from None
        return self._fernet

    def catalog(self, user_id):
        return self.store.all('SELECT id,name,host,path,model,version,created_at,updated_at FROM private_connections WHERE user_id=? ORDER BY created_at,id', (user_id,))

    def save(self, user_id, spec, id=''):
        host, path = endpoint(spec.base_url)
        if any(c in spec.model for c in ('\r', '\n', '\x00')) or any(c in spec.api_key for c in ('\r', '\n', '\x00')):
            fail('INVALID_SECRET', '模型名或密钥包含非法控制字符', 422)
        old = self.store.one('SELECT * FROM private_connections WHERE user_id=? AND id=?', (user_id,id)) if id else None
        if id and not old:
            fail('NOT_FOUND', '连接不存在或无权访问', 404)
        if spec.version != (old['version'] if old else 0):
            fail('VERSION_CONFLICT', '连接已改变，请刷新后重新配置', 409)
        if not old and not spec.api_key:
            fail('MISSING_SECRET', '首次配置必须填写密钥', 422)
        key = spec.api_key
        if old and not key:
            # Do not send a saved secret to a different destination without an explicit new secret.
            if (host, path) != (old['host'], old['path']):
                fail('SECRET_DESTINATION', '修改接口地址时必须重新填写密钥，不能把旧密钥移往未知地址', 422)
            cipher = old['cipher']
        else:
            cipher = self._key().encrypt(key.encode('utf-8')).decode('ascii')
        id = id or 'u_' + uid()
        with self.store.transaction() as db:
            if old:
                count = db.execute('UPDATE private_connections SET name=?,host=?,path=?,model=?,cipher=?,version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=?',
                    (spec.name,host,path,spec.model,cipher,now(),id,user_id,spec.version)).rowcount
                if not count:
                    fail('VERSION_CONFLICT', '连接已被并发修改', 409)
            else:
                if db.execute('SELECT count(*) FROM private_connections WHERE user_id=?',(user_id,)).fetchone()[0] >= 10:
                    fail('RESOURCE_LIMIT', '每个账户最多10个私有连接', 409)
                db.execute('INSERT INTO private_connections VALUES(?,?,?,?,?,?,?,?,?,?)',
                    (id,user_id,spec.name,host,path,spec.model,cipher,1,now(),now()))
            self.store.audit(db,user_id,'connection',id,'updated' if old else 'created',{'host':host,'model':spec.model})
        return next(x for x in self.catalog(user_id) if x['id'] == id)

    def select(self, id, user_id=None):
        sql = 'SELECT * FROM private_connections WHERE id=?'
        args = (id,)
        if user_id is not None:
            sql += ' AND user_id=?'
            args += (user_id,)
        row = self.store.one(sql,args)
        if not row:
            return None
        try:
            key = self._key().decrypt(row['cipher'].encode()).decode('utf-8')
        except (InvalidToken, UnicodeError):
            fail('CREDENTIALS_UNAVAILABLE', '凭据无法解密，请恢复匹配的主密钥或重新配置；没有发送模型请求', 503)
        p = Provider(row['id'],row['host'],row['path'],row['model'],key)
        p.configuration_version = row['version']
        return p

    def delete(self,user_id,id):
        with self.store.transaction() as db:
            count=db.execute('DELETE FROM private_connections WHERE id=? AND user_id=?',(id,user_id)).rowcount
            if not count:
                fail('NOT_FOUND','连接不存在或无权访问',404)
            self.store.audit(db,user_id,'connection',id,'deleted')


def scoped_providers(service, user_id):
    """Fake providers in isolated tests still implement the original small protocol."""
    if not getattr(service, 'vault', None):
        return service
    return ScopedProviders(service,user_id)


class ScopedProviders:
    def __init__(self,service,user_id):
        self.service,self.user_id=service,user_id

    def status(self):
        base=self.service.status()
        private=[{**v,'configured':True,'connectivity':'not_tested','scope':'private_account'}
                 for v in self.service.vault.catalog(self.user_id)]
        return private+base

    def select(self,id=''):
        if id.startswith('u_'):
            return self.service.vault.select(id,self.user_id)
        if id:
            return self.service.select(id)
        private=self.service.vault.catalog(self.user_id)
        return self.service.vault.select(private[0]['id'],self.user_id) if private else self.service.select('')


def provider_binding(provider):
    out={'id':provider.id,'model':provider.model}
    version=getattr(provider,'configuration_version',None)
    if version is not None:
        out['configuration_version']=version
    return out
