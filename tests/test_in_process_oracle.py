"""Portable lifecycle and adverse checks, not a Windows or native browser run."""
import asyncio
from contextlib import contextmanager, asynccontextmanager
import socket

import anyio.from_thread
from fastapi import FastAPI
import pytest

from in_process_oracle import offline_test_client

DATAGRAM_METHODS = [name for name in ('sendto', 'sendmsg') if hasattr(socket.socket, name)]


def no_real_datagram(*args, **kwargs):
    # Even a regressed guard must not emit an actual packet during this test.
    raise RuntimeError('The guard allowed a datagram operation to reach its underlying method.')


def test_only_empty_host_bootstraps_before_guard_and_all_asgi_work_reuses_it(monkeypatch):
    original_portal = anyio.from_thread.start_blocking_portal
    original_socketpair = socket.socketpair
    bootstraps, socketpairs, phases, loops = [], [], [], []

    def tracked_socketpair(*args, **kwargs):
        socketpairs.append('stdlib-wakeup')
        return original_socketpair(*args, **kwargs)

    @contextmanager
    def tracked_portal(*args, **kwargs):
        bootstraps.append('empty-host')
        assert phases == []
        with original_portal(*args, **kwargs) as portal:
            yield portal

    monkeypatch.setattr(socket, 'socketpair', tracked_socketpair)
    monkeypatch.setattr(anyio.from_thread, 'start_blocking_portal', tracked_portal)

    def build_app(providers):
        assert bootstraps == ['empty-host'] and len(socketpairs) == 1
        assert socket.socketpair is not tracked_socketpair
        phases.append('construct')

        @asynccontextmanager
        async def lifespan(app):
            phases.append('startup')
            loops.append(asyncio.get_running_loop())
            yield
            phases.append('shutdown')
            loops.append(asyncio.get_running_loop())

        app = FastAPI(lifespan=lifespan)

        @app.get('/')
        async def request():
            phases.append('request')
            loops.append(asyncio.get_running_loop())
            return {'ok': True}

        return app

    with offline_test_client(build_app) as (client, providers, attempts):
        assert client.get('/').json() == {'ok': True}
        assert client.get('/').json() == {'ok': True}
        assert providers.calls == [] and attempts == []
    assert phases == ['construct', 'startup', 'request', 'request', 'shutdown']
    assert len(bootstraps) == 1 and len(socketpairs) == 1
    assert all(loop is loops[0] for loop in loops) and loops[0].is_closed()
    assert socket.socketpair is tracked_socketpair
    assert anyio.from_thread.start_blocking_portal is tracked_portal


def caught_network_attempt(method):
    """Every call is intercepted; no real bind, DNS lookup or connection occurs."""
    with pytest.raises(AssertionError, match='cannot open network'):
        if method == 'create_connection':
            socket.create_connection(('test.invalid', 443))
        elif method == 'getaddrinfo':
            socket.getaddrinfo('test.invalid', 443)
        elif method == 'socketpair':
            socket.socketpair()
        elif method in DATAGRAM_METHODS:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as candidate:
                if method == 'sendto':
                    candidate.sendto(b'blocked', ('127.0.0.1', 9))
                else:
                    candidate.sendmsg([b'blocked'], [], 0, ('127.0.0.1', 9))
        else:
            with socket.socket() as candidate:
                argument = 1 if method == 'listen' else ('127.0.0.1', 0)
                getattr(candidate, method)(argument)


@pytest.mark.parametrize('phase', ['construct', 'startup', 'request', 'shutdown'])
@pytest.mark.parametrize('method', ['connect', 'connect_ex', 'bind', 'listen',
                                   'create_connection', 'getaddrinfo', 'socketpair', *DATAGRAM_METHODS])
def test_caught_network_attempts_fail_in_every_application_phase(monkeypatch, phase, method):
    if method in DATAGRAM_METHODS:
        monkeypatch.setattr(socket.socket, method, no_real_datagram)
    def attempt(at):
        if phase == at:
            caught_network_attempt(method)

    def build_app(providers):
        attempt('construct')

        @asynccontextmanager
        async def lifespan(app):
            attempt('startup')
            yield
            attempt('shutdown')

        app = FastAPI(lifespan=lifespan)

        @app.get('/')
        async def request():
            attempt('request')
            return {'caught': True}

        return app

    with pytest.raises(AssertionError, match='recorded network or listener attempts'):
        with offline_test_client(build_app) as (client, providers, attempts):
            assert client.get('/').json() == {'caught': True}
    assert attempts == ['network-or-listener'] and providers.calls == []


@pytest.mark.parametrize('method', ['complete', 'propose'])
@pytest.mark.parametrize('phase', ['startup', 'request', 'shutdown'])
def test_caught_supplier_attempts_still_fail_after_shutdown(phase, method):
    def build_app(providers):
        async def attempt(at):
            if phase == at:
                with pytest.raises(AssertionError, match='cannot call'):
                    await getattr(providers, method)()

        @asynccontextmanager
        async def lifespan(app):
            await attempt('startup')
            yield
            await attempt('shutdown')

        app = FastAPI(lifespan=lifespan)

        @app.get('/')
        async def request():
            await attempt('request')
            return {'caught': True}

        return app

    with pytest.raises(AssertionError, match='recorded supplier attempts'):
        with offline_test_client(build_app) as (client, providers, attempts):
            assert client.get('/').json() == {'caught': True}
    assert providers.calls == [method] and attempts == []


@pytest.mark.parametrize('method', ['bind', *DATAGRAM_METHODS])
def test_guard_remains_installed_until_owned_portal_has_exited(monkeypatch, method):
    original_portal = anyio.from_thread.start_blocking_portal
    if method in DATAGRAM_METHODS:
        monkeypatch.setattr(socket.socket, method, no_real_datagram)

    @contextmanager
    def attempt_during_host_shutdown(*args, **kwargs):
        with original_portal(*args, **kwargs) as portal:
            yield portal
        caught_network_attempt(method)

    monkeypatch.setattr(anyio.from_thread, 'start_blocking_portal', attempt_during_host_shutdown)
    with pytest.raises(AssertionError, match='recorded network or listener attempts'):
        with offline_test_client(lambda providers: FastAPI()):
            pass


def test_guard_and_portal_are_restored_when_application_construction_fails():
    original_connect, original_portal = socket.socket.connect, anyio.from_thread.start_blocking_portal

    def fail(providers):
        raise ValueError('application construction failed')

    with pytest.raises(ValueError, match='application construction failed'):
        with offline_test_client(fail):
            pytest.fail('The failed application cannot yield a client.')
    assert socket.socket.connect is original_connect
    assert anyio.from_thread.start_blocking_portal is original_portal


def test_unbound_unused_datagram_objects_are_not_misreported_as_communication():
    def build_app(providers):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM):
            pass
        return FastAPI()

    with offline_test_client(build_app) as (client, providers, attempts):
        assert attempts == [] and providers.calls == []
