# Current assistant inputs and viewed action reviews — 2026-10-05

Current financial facts now require intact stored dataset content before reading
financial fields, resolving periods, or labeling calculated values with the saved
input hash. The saved-question trace, workspace assistant and new copilot answer
reuse the existing dataset content/schema validator after ownership and scope
resolution. A same-version payload replacement returns `SOURCE_INTEGRITY` (409)
without saving a new answer. Healthy API revisions still calculate the requested
quarter with the current revision's actual hash. Historical answers, reports and
identical message-request replays retain their frozen content.

The evidence catalog now returns `review_hash` for the complete review content.
The action form freezes that value alongside document ID/version/content hash
and review version, then sends exactly the selected references. Action transitions
compare the viewed review hash inside the existing transaction before any write.
A same-version note or stance change returns `ACTION_EVIDENCE_CHANGED` (409).
Refreshing, reviewing and explicitly selecting the current reference can succeed.
No document hash, scope, eligibility, CSRF or action-version guard is removed.

Older clients that omit `review_hash` or send null receive
`ACTION_EVIDENCE_REVIEW_REQUIRED` (409), with a refresh/reselect instruction after
ownership resolution. The wire schema admits those old shapes only to produce
that actionable error; no current hash is silently supplied at submission time.
Malformed hashes still fail schema validation. Frozen old action history remains
readable and missing historical hashes remain missing.

## Execution record

Base: `80defc9b54159155000ac7564fbdd1247c0f0403`. This isolated patch changes no
financial formula and makes no actual provider calls. All accounts, reports and
faults are temporary synthetic fixtures.

- 414 focused backend regressions passed, including 34 new real ASGI API tests
  guarded by `offline_test_client`; the existing Starlette/httpx deprecation
  warning remains. See `evidence/current-viewed-bindings-20261005/focused-pytest.log`
- 561 frontend tests passed, including three new compiled rendering/serialization
  and production-submit-branch checks. See the adjacent `frontend.log`
- Python compile, TypeScript typecheck/build, source guard and whitespace checks
  passed; see `static-checks.json`. Compiled JS is included
- An initial frontend run could not resolve the already-installed TypeScript
  package in the new worktree. Its failure log is retained. Linking that existing
  dependency into the isolated worktree allowed the complete rerun to pass;
  no package was downloaded or changed

The new API tests cover altered cash flow, malformed periods/payloads, invalid
schema even with a matching stored hash, owner-first errors, no business/audit
writes on rejection, unchanged reports/answers, healthy revisions, review note
and stance changes, missing/null/wrong/malformed references, scope, exclusion,
expiry, original document bytes, stale action versions, CSRF, atomic rejection of
multiple selections and legacy frozen-history reads. Frontend checks establish
that a later catalog does not replace the hash in an already rendered form.

The broader regression set is focused, not the full backend suite. This task did
not run local browsers, server listeners, real HTTP/SSE/restart/backup chains,
external providers or deployment. The HTTP-chain fixture's reference projection
has been updated for the new field but that chain was not executed here. No old
CI, native screenshots or historical full-suite results are claimed as evidence
for this patch.
