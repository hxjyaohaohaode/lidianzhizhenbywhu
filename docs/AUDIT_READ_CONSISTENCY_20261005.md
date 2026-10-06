# Report publication and audit consistency — 2026-10-05

The Windows L10 native report-history journey exposed a healthy report hidden by
`记录一致性异常` at publication. Its captured audit had a null report/snapshot
verdict, `report_missing`, and ledger `invalid_sequences: [-1]`; the concurrent
run response already contained the completed report. This remains a failed
native observation, not evidence that the candidate has passed native acceptance.

## Cause and repair

The audit previously read the owned run, artifacts, trace, ledger events and
ledger anchors in separate autocommit reads. The worker's real final commit could
land between those reads. A terminal run from a separate request could then be
paired with that older audit in the UI, which did not refresh an already-terminal
run.

The endpoint now begins a deferred SQLite read transaction before ownership
lookup and holds the shared connection lock until all audit and source-impact
reads finish. It returns the exact audited run with the verdict. The report page
uses this bound pair instead of independently fetching a run. If a later runtime
read announces completion, it refreshes the entire bound pair once. An unpublished
coherent snapshot remains pending; a completed inconsistent report still blocks
normal answers, actions and exports. Live graph observations no longer overwrite
the cached audit trace used by audit export.

No integrity predicate, publication write, business formula, historical record,
ownership check or mutation retry policy changed. Missing run binding fails
closed with a refresh message. View/account invalidation still rejects late
responses before replacing caches, and completion refresh retains draft guards.

## Deterministic execution evidence

`tests/test_audit_read_consistency.py` approves and runs real local adaptive
plans through the in-process API and production worker. Events gate the worker
after its final report node and before its actual terminal publication commit.
A separate SQLite connection commits that publication at each of three precise
reader boundaries: after the run, after artifacts, and between ledger event and
anchor reads. This exercises actual WAL snapshots with no timing sleeps,
substituted results, network calls or HTTP listeners.

Before the repair, the ledger-boundary test on base
`2e85ffac5e1ab76bd1d9dcfcd44605b314b5f3a7` failed with
`invalid_sequences: [-1]`. With the repair, all three schedules return a coherent
pending snapshot and then a valid completed snapshot on the next read. Corrupt
result, ledger, terminal evidence and artifact anchors remain unavailable;
cross-owner reads remain 404, and export remains 409. Every database table and
the reader connection's change count are checked for unchanged read behavior.
Snapshot cleanup after exceptions and nesting in an existing transaction are
also checked.

The compiled frontend tests exercise terminal-run/pre-publication-audit ordering,
pending execution, real corruption, missing binding, delayed completion reads
after navigation/account changes, unchanged drafts, and the actual production
live callback's immutable exported audit. They are explicit transport/DOM doubles,
not native browser evidence.

## Local checks

- Python compilation, TypeScript typecheck and compiled build: passed
- Report audit/source/export integrity, claim-review read model and current-viewed
  binding backend regressions: 139 passed before the final read-context cleanup
  case was added; final focused audit suite: 8 passed
- Complete frontend suite: 967 passed, zero skipped
- Diff whitespace check: passed

No local browser/server, external provider, remote publication, merge or deployment
was used. Complete aggregate verification and a new hosted native report-history
journey on the final integrated SHA remain required.
