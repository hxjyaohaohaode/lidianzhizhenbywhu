"""HTTPS only, exact hosts, all DNS results public, pinned connection, no redirects/proxies."""
from __future__ import annotations
import http.client
import ipaddress
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit

class NetworkRejected(ValueError):pass


class RequestDeadline:
    """Cooperative thread cancellation; registered sockets are actively interrupted.

    OS DNS cannot be killed safely. Its caller must retain an admission slot until
    the thread exits, and check this deadline again before opening a connection.
    """
    def __init__(self, timeout, guard=None):
        self.deadline = time.monotonic() + timeout
        self.guard = guard
        self.stopped = threading.Event()
        self._lock = threading.Lock()
        self._socket = None
        self.sent = False

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if self.stopped.is_set() or remaining <= 0:
            raise TimeoutError('MODEL_REQUEST_STOPPED')
        return remaining

    def register(self, sock):
        with self._lock:
            if self.stopped.is_set() or time.monotonic() >= self.deadline:
                sock.close()
                raise TimeoutError('MODEL_REQUEST_STOPPED')
            self._socket = sock
            sock.settimeout(self.remaining())

    def authorize(self):
        self.remaining()
        try:approved = self.guard is None or self.guard()
        except Exception:approved = False
        if not approved:
            # Once any request bytes may have left, absence of a full response
            # cannot establish that the supplier did not process the request.
            error = ConnectionAbortedError if self.sent else ValueError
            raise error('MODEL_AUTHORIZATION_CHANGED')

    def before_send(self):
        self.authorize()
        self.remaining()
        self.sent = True

    def stop(self):
        with self._lock:
            self.stopped.set()
            if self._socket is not None:
                try:self._socket.shutdown(socket.SHUT_RDWR)
                except OSError:pass
                self._socket.close()
                self._socket = None

def public_addresses(host):
    ips=list(dict.fromkeys(r[4][0] for r in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)))
    if not ips:raise NetworkRejected('DNS没有可用地址')
    for address in ips:
        ip=ipaddress.ip_address(address);mapped=getattr(ip,'ipv4_mapped',None)
        if not ip.is_global or (mapped and not mapped.is_global):raise NetworkRejected('禁止访问非公网地址')
    return ips

def validate_url(url,allowed):
    parsed=urlsplit(url)
    try:port=parsed.port
    except ValueError:raise NetworkRejected('无效端口') from None
    if parsed.scheme!='https' or parsed.username or parsed.password or port not in (None,443) or parsed.fragment:raise NetworkRejected('仅允许不带身份信息的443端口HTTPS地址')
    host=parsed.hostname or ''
    if host not in allowed:raise NetworkRejected('域名不在服务端精确白名单中')
    path=parsed.path or '/'
    if parsed.query:path+='?'+parsed.query
    if any(ord(c)<32 or ord(c)>126 for c in path):raise NetworkRejected('URL必须百分号编码且不能含控制字符')
    return host,path

class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self,host,ip,timeout):
        super().__init__(host,443,timeout=timeout,context=ssl.create_default_context());self.ip=ip
    def connect(self):
        deadline=getattr(self,'deadline',None)
        sock=socket.create_connection((self.ip,443),deadline.remaining() if deadline else self.timeout)
        try:
            if deadline:deadline.register(sock)
            # Register TLS before its blocking handshake, so cancellation can
            # interrupt the handshake as well as response headers/body reads.
            self.sock=self._context.wrap_socket(sock,server_hostname=self.host,do_handshake_on_connect=False)
            if deadline:deadline.register(self.sock)
            self.sock.do_handshake()
        except BaseException:sock.close();raise

    def send(self,data):
        deadline=getattr(self,'deadline',None)
        if deadline:
            deadline.remaining()
            if self.sock is None:self.connect()
            deadline.before_send()
            self.sock.settimeout(deadline.remaining())
        return super().send(data)

def fetch_public(url,allowed,timeout=8,max_bytes=2_000_000):
    host,path=validate_url(url,allowed);ip=public_addresses(host)[0];conn=PinnedHTTPS(host,ip,timeout)
    try:
        conn.request('GET',path,headers={'User-Agent':'LidianEvidence/3.0','Accept':'text/html,text/plain,application/pdf','Accept-Encoding':'identity'})
        res=conn.getresponse()
        if res.status!=200:raise NetworkRejected(f'来源返回HTTP {res.status}；不自动跟随重定向')
        if res.getheader('Content-Encoding','identity') not in ('','identity'):raise NetworkRejected('不接受压缩响应')
        kind=res.getheader('Content-Type','').split(';')[0].lower()
        if kind not in ('text/html','text/plain','application/pdf'):raise NetworkRejected('内容类型不支持')
        payload=res.read(max_bytes+1)
        if len(payload)>max_bytes:raise NetworkRejected('来源文件超过大小上限')
        return payload,kind
    finally:conn.close()
