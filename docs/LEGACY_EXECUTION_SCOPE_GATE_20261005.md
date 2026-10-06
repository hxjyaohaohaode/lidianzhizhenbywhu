# Legacy execution scope admission — 2026-10-05

New approval, queued start, adaptive resume and unsent model dispatch now reject
known currency/comparison incompatibilities with `PLAN_SCOPE_REPREVIEW` and a
specific instruction to preview again. They do not silently convert currencies,
replace the approved comparison, or recalculate saved history.

New plans fingerprint the actual `scope_query` used by their preview. Legacy
standalone plans use their original query. Legacy proposal plans verify the
owner, proposal/plan association, normalized original proposal fingerprint,
approved result and plan version, dataset/identity binding, thread and source
message hash before reading the approved proposal text. Included chat history
and an unedited source question cannot replace an explicitly edited target.
Unavailable or inconsistent original targets require another preview.

The gate remains separate from plan, approval, ledger and report integrity.
Historical GET, export and already-executed repeated confirmation retain their
existing behavior. Execution suspension changes only mutable run/control state
and appends explanatory events/audits. Existing snapshots, fingerprints,
completed checkpoints and report bytes remain unchanged. Dispatch reservations
and unknown remote outcomes do not authorize retries. A first-send rejection
persists the suspension after the dispatch transaction has rolled back.

## Authentic old-state evidence

`scripts/capture_legacy_scope_fixture.py` uses a clean checkout of
`a20a9c45a846f6a5de94432420c6bcc56fed7b9f`, authenticated TestClient API requests
and the old workers to produce the checked-in fixture. It contains 46 scenarios
covering drafts, approved queues, paused checkpoints, completed reports and
unknown external outcomes. All business data is explicitly synthetic. The
capture denies socket connections and listeners; its two provider invocations
are cancellation-only local doubles, with no real supplier calls. It exports
neither authentication rows nor credentials and never rehashes saved payloads.

Fixture SHA-256:
`e635303e4b9fa7ad090f2df6a715eb873292165c181fed54bf89507536402f32`.
All 14 exported tables were compared with the original capture database on
2026-10-05; every row and serialized payload matched. An independent fresh
capture from the same clean old checkout produced the same 46 scenario types
and passed all 63 execution-scope tests under the candidate.

The old input deliberately distinguishes 2023-Q4 revenue of 100, 2024-Q3 revenue
of 200 and 2024-Q4 revenue of 300. Compatible approved QoQ requests retain a
2024-Q3 baseline and growth of 0.5; old English QoQ approvals that froze YoY are
stopped. Compatible CNY, Chinese comparison aliases, a form-selected QoQ default,
true currency evidence retrieval, edited targets and mixed-history proposals
remain executable. Historical completed USD/QoQ JSON and Markdown exports match
their old capture hashes byte for byte.

## Executed checks

Validation used Python 3.12, Node 24.19.0 and the repository-pinned TypeScript
5.8.3. Socket connect/bind/listen operations were prohibited in the isolated
backend run and fresh-capture replay.

- Legacy execution scope tests: 63 passed
- Broader related backend regression: 674 passed across 17 modules, including
  the 63 scope tests, currency/comparison, proposal bindings, services, adaptive
  recovery and dispatch, source revocation, transport lifecycle and exports
- Fresh old-API capture replay: 63 passed against a newly captured fixture
- Full frontend unit suite, including event races: 505 passed
- Python compilation, TypeScript typecheck/build and source guard: passed
- Git whitespace validation: passed

The related backend command selected `test_legacy_execution_scope`,
`test_currency_comparison_scope`, `test_dispatch_source_bindings`, `test_adaptive`,
`test_adaptive_recovery_selection`, `test_adaptive_transport_disclosure`,
`test_legacy_studio_lifecycle`, `test_proposal_execution_binding`,
`test_source_freeze_boundaries`, `test_source_native_faults`, `test_services`,
`test_service_hardening`, `test_transport_lifecycle`, `test_recovery_admission`,
`test_execution_services`, `test_planner_provider` and
`test_report_export_integrity` from `tests/`.

The initial frontend attempt found the local TypeScript dependency absent in
this worktree. Reusing the existing pinned installation resolved that setup
failure; the final build and all 505 tests passed without frontend source or
compiled asset changes. Backend runs reported only the existing TestClient
deprecation warning.

This is focused local verification, not a full backend acceptance run. Real
Uvicorn HTTP/SSE/restart/backup-chain, rendered/native browser, live supplier,
external write and deployment checks were not run, as excluded from this task.
