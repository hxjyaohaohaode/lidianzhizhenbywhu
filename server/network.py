"""HTTPS only, exact hosts, all DNS results public, pinned connection, no redirects/proxies."""
from __future__ import annotations
import http.client
import ipaddress
import socket
import ssl
from urllib.parse import urlsplit

class NetworkRejected(ValueError):pass

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
        sock=socket.create_connection((self.ip,443),self.timeout)
        try:self.sock=self._context.wrap_socket(sock,server_hostname=self.host)
        except BaseException:sock.close();raise

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
