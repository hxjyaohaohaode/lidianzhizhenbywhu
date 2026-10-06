"""Test-only ASGI host: no application work runs outside the offline guard."""
from contextlib import contextmanager, nullcontext
import socket

import anyio.from_thread
from fastapi.testclient import TestClient
import pytest

from server.providers import ProviderService


class NoSupplierCalls(ProviderService):
    def __init__(self):
        super().__init__()
        self.providers = {}
        self.calls = []

    async def complete(self, *args, **kwargs):
        self.calls.append('complete')
        raise AssertionError('The local oracle contract cannot call a supplier.')

    async def propose(self, *args, **kwargs):
        self.calls.append('propose')
        raise AssertionError('The local oracle contract cannot call a planner.')


@contextmanager
def offline_test_client(build_app):
    """Yield a real TestClient, with attempts checked even if the app catches them.

    Windows' default Proactor loop creates its own wake-up socketpair using a
    temporary loopback listener. Initialize only the empty test-host portal
    before guarding sockets; no app or supplier is constructed until guarded.
    Keep that same portal alive through ASGI startup, requests and shutdown.
    Unbound, unused socket objects are allowed. Covered Python socket entry
    points reject application connections, listeners, datagrams and socketpairs;
    the host's existing wake-up socket may still coordinate ASGI via send().
    This tests the application's current I/O paths, not arbitrary native or
    Proactor async I/O, and is not a general-purpose network security sandbox.
    """
    network_attempts = []
    providers = None
    with pytest.MonkeyPatch.context() as guard:
        try:
            with anyio.from_thread.start_blocking_portal() as portal:
                def forbidden_network(*args, **kwargs):
                    network_attempts.append('network-or-listener')
                    raise AssertionError('The in-process oracle contract cannot open network connections, send datagrams or start listeners.')

                for method in ('connect', 'connect_ex', 'bind', 'listen'):
                    guard.setattr(socket.socket, method, forbidden_network)
                for method in ('sendto', 'sendmsg'):
                    if hasattr(socket.socket, method):
                        guard.setattr(socket.socket, method, forbidden_network)
                for method in ('create_connection', 'getaddrinfo', 'socketpair'):
                    guard.setattr(socket, method, forbidden_network)

                def reuse_portal(backend='asyncio', backend_options=None, *, name=None):
                    assert backend == 'asyncio' and not backend_options
                    return nullcontext(portal)

                guard.setattr(anyio.from_thread, 'start_blocking_portal', reuse_portal)
                providers = NoSupplierCalls()
                with TestClient(build_app(providers), raise_server_exceptions=False) as client:
                    assert client.portal is portal
                    yield client, providers, network_attempts
            # The guard also remains active while the owned portal shuts down.
        finally:
            assert network_attempts == [], 'The offline oracle recorded network or listener attempts.'
            assert providers is None or providers.calls == [], 'The offline oracle recorded supplier attempts.'
