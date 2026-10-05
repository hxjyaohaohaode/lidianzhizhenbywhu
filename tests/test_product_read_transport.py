"""Corroborating-read contracts; mocks/in-process protocol only, no listener."""
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts.product_browser_audit import Probe


def make_probe(tmp_path, request):
    page = SimpleNamespace(context=SimpleNamespace(request=request))
    return Probe(page, 'http://127.0.0.1:8000/', tmp_path, None)


def expected_call(path):
    return ((f'http://127.0.0.1:8000{path}',),
            {'timeout': 30_000, 'headers': {'Connection': 'close'}})


def test_first_and_every_supplementary_read_close_only_their_own_connection(tmp_path):
    body = {'items': [{'value': 0}], 'missing': None}
    response = SimpleNamespace(status=200, json=Mock(return_value=body))
    request = SimpleNamespace(get=Mock(return_value=response))
    probe = make_probe(tmp_path, request)
    paths = ['/api/auth/me', '/api/datasets', '/api/services/tracking?identity_id=']
    for path in paths:
        assert probe.get(path) is body
    assert request.get.call_count == len(paths)
    assert request.get.call_args_list == [expected_call(path) for path in paths]
    assert response.json.call_count == len(paths)


@pytest.mark.parametrize('error', [OSError('socket hang up'), TimeoutError('timed out')])
def test_transport_failure_propagates_once_without_retry_or_fallback(tmp_path, error):
    request = SimpleNamespace(get=Mock(side_effect=error))
    probe = make_probe(tmp_path, request)
    with pytest.raises(type(error)) as caught:
        probe.get('/api/services/tracking?identity_id=')
    assert caught.value is error
    assert request.get.call_args_list == [expected_call('/api/services/tracking?identity_id=')]


@pytest.mark.parametrize('status', [201, 302, 401, 403, 404, 409, 500, 503])
def test_non_200_still_fails_without_reading_body_or_replaying(tmp_path, status):
    response = SimpleNamespace(status=status, json=Mock())
    request = SimpleNamespace(get=Mock(return_value=response))
    with pytest.raises(AssertionError, match=f'Corroborating GET /api/auth/me: HTTP {status}'):
        make_probe(tmp_path, request).get('/api/auth/me')
    assert request.get.call_args_list == [expected_call('/api/auth/me')]
    response.json.assert_not_called()


def test_json_failure_propagates_unchanged_without_retry(tmp_path):
    error = ValueError('invalid JSON')
    response = SimpleNamespace(status=200, json=Mock(side_effect=error))
    request = SimpleNamespace(get=Mock(return_value=response))
    with pytest.raises(ValueError) as caught:
        make_probe(tmp_path, request).get('/api/auth/me')
    assert caught.value is error
    assert request.get.call_args_list == [expected_call('/api/auth/me')]
    response.json.assert_called_once_with()


@pytest.mark.parametrize('path', ['https://example.com/api/me', '//example.com/api/me',
                                '/api/../auth/me', '/api/me?next=https://example.com', '/other'])
def test_existing_path_guard_still_rejects_before_any_request(tmp_path, path):
    request = SimpleNamespace(get=Mock())
    with pytest.raises(ValueError, match='same-origin API GETs'):
        make_probe(tmp_path, request).get(path)
    request.get.assert_not_called()


def test_probe_is_the_only_direct_product_api_request_entrypoint():
    root = Path(__file__).resolve().parents[1] / 'scripts'
    matches = [(path.name, line.strip()) for path in root.glob('product*.py')
               for line in path.read_text(encoding='utf-8').splitlines()
               if '.context.request.' in line or '.request.new_context(' in line]
    assert matches == [('product_browser_audit.py', 'response = self.page.context.request.get(')]


def test_playwright_agent_pool_with_in_memory_responses():
    """Pinned real agent/HTTP parser, fake Duplex only; not native E2E evidence.

    Uvicorn's close-response behavior is independently exercised below. A close
    request may still select a previously pooled socket from another caller.
    """
    import subprocess
    from playwright._impl._driver import compute_driver_executable

    node, cli = compute_driver_executable()
    agent_module = Path(cli).parent / 'lib/server/utils/happyEyeballs.js'
    source = r'''
const assert = require('node:assert/strict');
const { Duplex } = require('node:stream');
const http = require('node:http');
const net = require('node:net');
net.createConnection = net.connect = () => { throw new Error('Network forbidden'); };
const { httpHappyEyeballsAgent: agent } = require(process.argv[1]);
assert.equal(agent.keepAlive, true);
const tick = () => new Promise(resolve => setImmediate(resolve));
let made = 0;
class MemorySocket extends Duplex {
  constructor() { super(); this.number = ++made; this.pending = ''; }
  _read() {}
  _write(chunk, encoding, callback) {
    this.pending += chunk.toString();
    if (this.pending.includes('\r\n\r\n')) {
      const close = /Connection: close\r\n/i.test(this.pending);
      this.pending = '';
      queueMicrotask(() => {
        this.push('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n' +
                  (close ? 'Connection: close\r\n' : '') + '\r\n{}');
        if (close) this.push(null);
      });
    }
    callback();
  }
  setKeepAlive() { return this; }
  setTimeout() { return this; }
  setNoDelay() { return this; }
  ref() { return this; }
  unref() { return this; }
}
agent.createConnection = () => new MemorySocket();
async function read(close) {
  const value = await new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:8000/api/auth/me', {
      agent, headers: close ? {Connection: 'close'} : {},
    }, res => {
      res.resume();
      res.on('end', () => resolve({reused: req.reusedSocket, keep: req.shouldKeepAlive}));
    });
    req.on('error', reject);
  });
  await tick();
  return value;
}
(async () => {
  assert.equal((await read(false)).reused, false);
  assert.equal((await read(false)).reused, true);
  // Header is not a force-new-socket option for a pool another caller seeded.
  assert.deepEqual(await read(true), {reused: true, keep: false});
  assert.equal(Object.values(agent.freeSockets).flat().length, 0);
  const before = made;
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await read(true), {reused: false, keep: false});
    assert.equal(Object.values(agent.freeSockets).flat().length, 0);
  }
  assert.equal(made - before, 3);
  agent.destroy();
})().catch(error => { console.error(error); process.exitCode = 1; });
'''
    result = subprocess.run([node, '-e', source, str(agent_module)],
                            text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize('close', [False, True])
def test_uvicorn_honors_close_without_idle_pool_or_timing_change(close):
    """Actual Uvicorn protocol + memory transport; no server is launched."""
    from uvicorn import Config
    from uvicorn.protocols.http.h11_impl import H11Protocol
    from uvicorn.server import ServerState

    class MemoryTransport(asyncio.Transport):
        def __init__(self):
            self.output = bytearray()
            self.closed = False

        def get_extra_info(self, name, default=None):
            return {'peername': ('127.0.0.1', 50000), 'sockname': ('127.0.0.1', 8000)}.get(name, default)

        def write(self, data): self.output.extend(data)
        def is_closing(self): return self.closed
        def close(self): self.closed = True
        def pause_reading(self): pass
        def resume_reading(self): pass

    async def check():
        calls = []

        async def app(scope, receive, send):
            calls.append(scope['path'])
            await send({'type': 'http.response.start', 'status': 200,
                        'headers': [(b'content-length', b'2')]})
            await send({'type': 'http.response.body', 'body': b'{}'})

        config = Config(app, lifespan='off', access_log=False, log_config=None)
        state = ServerState()
        protocol = H11Protocol(config, state, {})
        transport = MemoryTransport()
        protocol.connection_made(transport)
        try:
            header = b'Connection: close\r\n' if close else b''
            protocol.data_received(b'GET /api/auth/me HTTP/1.1\r\nHost: 127.0.0.1:8000\r\n' + header + b'\r\n')
            await asyncio.gather(*state.tasks)
            assert calls == ['/api/auth/me']
            assert transport.closed == close
            assert (b'connection: close\r\n' in transport.output.lower()) == close
            assert (protocol.timeout_keep_alive_task is None) == close
            assert config.timeout_keep_alive == 5
        finally:
            protocol.connection_lost(None)

    asyncio.run(check())
