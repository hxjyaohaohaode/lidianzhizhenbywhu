# Crash-dispatch HTTP harness reconstruction (2026-10-12)

This is a reconstructed check on the recovered candidate, not evidence that a lost
workspace or an earlier acceptance result was reproduced byte-for-byte. Production
runtime business code is not modified by this harness.

## Entry points and evidence

- `python scripts/crash_dispatch_check.py` writes `evidence/crash-dispatch-http.json`.
- `--output-dir PATH` keeps an independent diagnostic run separate from release evidence.
- `python scripts/verify.py --full-chain` runs this as stage 8, after the existing
  HTTP/SSE/restart/backup stage. Its outer stage timeout is 120 seconds.
- Before any verification stage starts, both HTTP JSON reports are atomically
  replaced with `passed: false, status: not_started`. If an earlier backend
  cleanup failure blocks the HTTP stages, an old success cannot remain current.
- `prepare_evidence.py` clears the new current-run report, and CI uploads it by
  exact filename. No business database or temporary account credential is uploaded.

The harness uses real loopback TCP HTTP requests to actual Uvicorn processes and
isolated SQLite databases. The financial input and account are explicitly
synthetic. Normal registration, dataset creation, plan preview, fingerprint-bound
approval and owner/version-bound manual resume all pass through the HTTP API.
Preview must not enter the test provider.

## Four hard-crash boundaries

The disposable server launcher injects an offline provider and test-only hooks.
It exits using `os._exit(91)`, without normal shutdown or exception unwinding:

1. Reservation transaction committed, before the provider is entered.
2. First-send callback committed and the injected transport's send journal was
   flushed, with no response or call closure.
3. Provider returned and the completed call/usage closure committed, before the
   terminal node checkpoint and immutable artifact were written.
4. A known-unsent `MODEL_TRANSPORT_BUSY` closure committed, before the terminal
   checkpoint and artifact were written.

The independent, flushed provider journal is evidence of this injected transport's
entry/send/completion boundaries. It is not evidence of live supplier traffic,
external TLS, supplier billing, or a real model answer. Real supplier calls are zero.

Each case checks its persisted crash state and event hash chain, restarts Uvicorn,
requires an interrupted run, and explicitly resumes over HTTP. The crashed
analyst retains exactly one ledger reservation and never re-enters the provider.
A separate approved challenger executes once. The plan allows four calls and only
two are consumed, so an exhausted one-call budget cannot mask accidental retries.
Characters and tokens are reconciled with the durable call rows. The first three
lost-output cases expose an unknown result; the known-unsent case preserves the
specific recorded failure. All four currently require a degraded, audited report.

A further hard stop/restart must leave the report, complete call rows, checkpoints,
artifacts, event history, and provider journal unchanged. Attempting to resume that
terminal run must receive `RUN_TERMINAL`. Report/snapshot hashes and all artifact
hashes/event anchors must remain valid.

## Ownership, budget and first failure

All child processes use `scripts.owned_process.OwnedProcess`. The whole invocation
has one 120-second budget: work ends by 110 seconds, owned-process cleanup has up
to 8 seconds, and reporting reserves the remaining 2 seconds. Child launches share
one absolute deadline; they do not receive a fresh 120 seconds after each restart.
Cancellation is requested for every owned process before waiting on any of them.
An absent or invalid cleanup receipt makes the run fail and retains its temporary
root. A case failure also retains its unique root and `failure-report.json`, even
when cleanup succeeded. Rerunning never replaces that first failed-round file.
The current report includes the retained path, original failure, partial snapshots
and process log tails. A retained root must not be deleted until process cleanup
is independently confirmed; it is not a distributable application data bundle.

Launch, acceptance and termination run within the same execution session. Do not
start a listener in one sandbox invocation and attempt to reach it from another.

## Execution record and limits

The initial 2026-10-12 reconstruction run passed all four actual crash/restart
cases in 12.724 seconds, including 12 confirmed owned-process cleanups. The second
run passed in 12.208 seconds with the added challenger journal/token assertions.
These are diagnostic runs on the rebuilding working tree. The final collector
also records actual Git HEAD and SHA-256 values for all server Python modules,
the harness and OwnedProcess before and after execution; a change or unavailable
Git identity fails acceptance. Git commands also run as owned processes within
the same aggregate budget. Collector contract tests additionally
cover shared deadlines, expired HTTP budgets, stale-success invalidation, failure
propagation, original failure retention, cleanup uncertainty, cancellation ordering,
late-return failure and rejection of duplicate provider entries/debits.

These focused results do not claim the entire backend/frontend verification,
Windows execution, native-browser behavior, public deployment, or live external
provider integration passed. The final frozen candidate must receive its own full
verification record.
