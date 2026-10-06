from __future__ import annotations
import hashlib
import hmac
import secrets
import time
import threading
import math
from collections import OrderedDict,deque
from typing import NamedTuple
from fastapi import HTTPException,Request,Response
from .store import digest, uid, now

COOKIE='lidian_session'

def fail(code,message,status=400):
    raise HTTPException(status_code=status,detail={'code':code,'message':message})

def check_version(row, expected):
    """Check only after ownership lookup; call under the mutation transaction."""
    if expected is None:fail('VERSION_REQUIRED','请提供已查看记录的版本后重试。',428)
    if row['version']!=expected:fail('VERSION_CONFLICT','记录已改变，请重新查看后确认；未删除新版本。',409)

def password_hash(password):
    salt=secrets.token_hex(16)
    value=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1,dklen=32).hex()
    return f'scrypt${salt}${value}'

def password_matches(password,stored):
    try:
        algorithm,salt,expected=stored.split('$')
        if algorithm!='scrypt':return False
        actual=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1,dklen=32).hex()
        return hmac.compare_digest(actual,expected)
    except (ValueError,TypeError):return False

DUMMY_HASH=password_hash('dummy-unavailable-account-password')

def public_user(user):
    return {k:user[k] for k in ('id','email','name','preferences','version','created_at','updated_at')}

def issue_session(request: Request,response: Response,user):
    token,csrf=secrets.token_urlsafe(40),secrets.token_urlsafe(32)
    config,store=request.app.state.settings,request.app.state.store
    with store.transaction() as db:
        current=store.one('SELECT * FROM users WHERE id=?',(user['id'],))
        if not current or not hmac.compare_digest(current['password_hash'],user['password_hash']):
            fail('CREDENTIALS_CHANGED','凭据在验证期间改变，请重新登录。',401)
        user=current
        db.execute('DELETE FROM auth_sessions WHERE expires<?',(time.time(),))
        db.execute('INSERT INTO auth_sessions VALUES(?,?,?,?)',(digest(token),user['id'],csrf,time.time()+config.session_hours*3600))
        db.execute('INSERT INTO session_details VALUES(?,?,?,?,?)',(uid(),digest(token),user['id'],request.headers.get('user-agent','')[:250],now()))
        db.execute('DELETE FROM auth_sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM auth_sessions WHERE user_id=? ORDER BY expires DESC LIMIT 10)',(user['id'],user['id']))
    response.set_cookie(COOKIE,token,httponly=True,secure=config.production,samesite='strict',max_age=config.session_hours*3600,path='/')
    response.headers['Cache-Control']='no-store'
    return {'user':public_user(user),'csrf':csrf}

def require_user(request: Request):
    token=request.cookies.get(COOKIE,'')
    if not token or len(token)>200:fail('UNAUTHORIZED','请先登录。',401)
    store=request.app.state.store
    session=store.one('SELECT * FROM auth_sessions WHERE token_hash=? AND expires>?',(digest(token),time.time()))
    if not session:fail('UNAUTHORIZED','登录已过期，请重新登录。',401)
    if request.method not in ('GET','HEAD','OPTIONS') and not hmac.compare_digest(request.headers.get('x-csrf-token','').encode(),session['csrf'].encode()):
        fail('CSRF_REJECTED','安全校验失败，请刷新页面。',403)
    user=store.one('SELECT * FROM users WHERE id=?',(session['user_id'],))
    if not user:fail('UNAUTHORIZED','账户不存在。',401)
    request.state.user_id=user['id'];request.state.csrf=session['csrf']
    return user

class RateLimitDecision(NamedTuple):
    allowed: bool
    retry_after: int

class RateLimiter:
    def __init__(self,maximum_keys=10000,*,clock=None):
        self.keys=OrderedDict();self.maximum_keys=maximum_keys;self._lock=threading.Lock();self._clock=clock or time.monotonic
    def check(self,key,limit,window=60):
        with self._lock:
            at=self._clock();q=self.keys.setdefault(key,deque());self.keys.move_to_end(key)
            while q and q[0]<=at-window:q.popleft()
            allowed=len(q)<limit
            # Compute the next admission boundary from this same locked snapshot.
            # Round up for HTTP delay-seconds; a rejected request never adds time.
            retry_after=0 if allowed else max(1,math.ceil((q[-limit] if q and limit>0 else at)+window-at))
            if allowed:q.append(at)
            while len(self.keys)>self.maximum_keys:self.keys.popitem(last=False)
            return RateLimitDecision(allowed,retry_after)
    def allow(self,key,limit,window=60):return self.check(key,limit,window).allowed
