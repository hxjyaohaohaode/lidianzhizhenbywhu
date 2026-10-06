# Windows in-process oracle lifecycle correction — 2026-10-05

## Preserved failure

The original Windows acceptance run remains failed: run `37322170829`, commit
`9376956f72497f1607038024cf0ad20d8134d89f`, Python 3.13.15,
Windows Server 2025. It completed 2,821 tests with 2,820 passing and one failing;
this was not a total-timeout failure. The original acceptance artifact is
`11351837044`, SHA256
`ce5d53bfa3971304b83e6171c2d422491f327f717052e976c94c814c02eca744`.
The downloaded ZIP digest was verified without changing the ZIP or original log.

The failing stack is `factory` → `TestClient.__enter__` →
`anyio.from_thread.start_blocking_portal` → default `ProactorEventLoop` →
`_make_self_pipe` → `socket.socketpair` → `_fallback_socketpair` →
`bind(('127.0.0.1', 0))`. The test's socket prohibition intercepted the Python
runtime's wake-up socket before application startup. The subsequent missing
`_ssock` destructor warning came from that partially initialized loop.

## Test-only correction

`tests/in_process_oracle.py` initializes one empty default asyncio portal before
installing guards. No application factory or supplier constructor runs in this
unguarded interval. The real Starlette TestClient borrows that portal, keeping
application construction, ASGI startup, all requests, ASGI shutdown and owned
portal shutdown inside the socket and supplier guard. No loop policy is changed.

All original connect, connect_ex, bind, listen, create_connection and getaddrinfo
prohibitions remain. New application socketpair creation is also prohibited once
the host exists. Attempts are retained and checked after shutdown, including
attempts whose exceptions the application catches. The same complete/propose
supplier prohibitions remain. No production file, synthetic input, business
expectation, platform selection or CI workflow is changed.

Independent review then identified a narrower omission: unconnected UDP can use
`sendto`/`sendmsg` without calling connect. A safe, non-sending stub reproduced
that uncovered path; no packet was emitted. The revised guard also records and
rejects both datagram methods where the platform provides them, including during
ASGI and portal shutdown. A socket object that is created and closed without
binding, connecting or communicating is explicitly allowed; this is a business
network-communication guard, not a ban on every OS socket object. The existing
host wake-up channel remains available to coordinate ASGI execution.

The original L7 business-test body, from the initial empty-dataset assertion
through CSV staging/import, identity creation, four messages, persisted trace,
unchanged objects and final zero-call assertions, was checked byte-for-byte
against baseline `f75ea02d80e9f49c83e3a23f423733a7fd087b13`.

## Executed checks and limits

On Linux, Python 3.12.14: `pytest -q tests/test_in_process_oracle.py
tests/test_product_question_scope.py` passed all 125 tests (88 existing L7 tests
and 37 host/guard checks). The guard checks cover one owned portal/loop across
startup, repeated requests and shutdown; seven blocked socket entry points at
construction/startup/request/shutdown; caught complete/propose calls; guard
coverage through host exit; and cleanup on application-construction failure.
Only the existing Starlette httpx deprecation warning was reported.

After the datagram correction, the same two files passed 136 tests on Linux:
the original 88 L7 tests and 48 host/guard cases. The additional cases cover
datagram attempts at every application phase and portal shutdown, including
caught exceptions, plus the explicitly allowed unused-socket boundary. An outer
non-sending stub makes these adverse checks safe even if the guard regresses.
The original 125-test result predates this addition and does not prove UDP
protection. The independently reported omission remains part of the record.

Independent rechecking passed 13 lifecycle/datagram boundary probes and the
136 focused tests. These Python socket hooks cover the application's current
synchronous DNS/HTTPS and tested datagram entry points, alongside the supplied
provider-call stub. They are not a network security sandbox: native extensions
and Windows Proactor asynchronous socket methods can bypass Python socket
methods. No claim is made that every possible network API is intercepted.

Python compileall, TypeScript typecheck/build and `git diff --check` also passed.
The build generated no changed production files. No browser, application HTTP
listener, live provider or external write was used. This focused run is not a
full-suite result or native-browser evidence. Windows Proactor execution of the
correction still requires the new integrated commit's real Windows CI run;
Linux lifecycle tests do not substitute for that evidence.
