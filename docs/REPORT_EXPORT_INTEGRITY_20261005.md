# Report export integrity gate — 2026-10-05

## Corrected boundary

`GET /api/runs/{id}/export?format=json|md` now applies the same read-only
`inspect_report_integrity` verdict used by report audits. A known-invalid saved
report returns HTTP 409 with structured error code `REPORT_INTEGRITY` before
either export formatter runs. The existing transaction covers ownership,
integrity evidence and export-time reviews consistently.

The regression was reproduced with a completed local report whose saved margin
was 0.225: changing only `readout.facts[0].value` to 9876.54321, or removing the
modern readout, failed the audit's whole-report hash while the old JSON export
still returned 200. Both formats now reject those cases; corrupt modern content
cannot be presented as unrecorded legacy content.

## Preserved contracts

- Ownership remains checked first; other accounts receive 404 without integrity
  details. Unsupported formats retain 422, and absent/empty results retain the
  existing 409 `NOT_READY` response
- The inspector, artifact/event anchors, ledger checks, snapshot checks and
  direct/inherited business-source guards are unchanged
- Healthy JSON and Markdown bytes, canonical saved result content and download
  headers remain unchanged. An honest later dataset revision does not prevent
  exporting the valid frozen report or replace its values with current inputs
- Actual pre-anchor historical fixture rows remain exportable under their
  available partial-verification contract; `report_hash_valid` stays null. This
  does not certify arbitrary changes to output that never had an independent hash
- Export reads neither repair reports nor write database tables; no diagnostic
  export mode or alternate success path for known corruption was added

## Dated execution record

On 2026-10-05, 122 focused backend tests passed (33 new export tests), with one
existing Starlette TestClient deprecation warning. Coverage includes result and
readout corruption, malformed or missing saved evidence, artifact hashes and
anchors, ledger/snapshot/dataset checks, current-source changes, genuine legacy
fixtures, unrelated healthy controls, validation order, owner isolation, and
all-table/`total_changes` zero-write checks. Existing direct and multi-hop
inherited report-source tests also passed. Python compilation and patch whitespace
checks passed.

Commands, output and source fingerprints are recorded in
`evidence/report-export-integrity-20261005/summary.json` and the adjacent logs.
All execution used temporary in-process TestClient databases with synthetic
inputs. No real provider calls, browser, listener, deployment, production data or
migration were involved. This is focused backend evidence; the final aggregate
suite and any UI integration remain separate checks.

## Reader boundary and pending native journey

The report list and detail also remove ordinary MD/JSON export links when the
frozen report is explicitly known to fail integrity. Detail no longer renders
untrusted saved numbers as the normal answer, charts, calculation lineage or
report-derived action controls. It retains the original question, a clear error
and a collapsed, explicitly unverified stored-text view. Valid reports whose
current sources changed and genuine partially verified legacy reports retain
their ordinary readable content and export controls.

I9 is a separate declared native task: import synthetic data, approve and
actually download a valid20% report, inject one owner-bound temporary final
artifact fault, visibly confirm blocked export in both list and detail, then
create and download a distinct new verified report through real controls. The
old damaged report is left untouched and remains invalid; no fixture restore
is presented as user recovery. In-process contract checks independently matched
both actual query results and actual exported bytes. Hosted native execution
and independent screenshot/trace review are still pending for the next commit.

## First native execution and selector correction (10:21 UTC)

At exact commit `759e041f2e9f749dfe793e87e92fa0dda3cb3b57`, both Linux and
Windows Push jobs completed the real original-report Markdown and JSON downloads,
then failed after step 43 at the damaged-report list. These failures remain
failures; damaged-detail inspection, fresh-report creation and the second pair of
downloads were not reached.

Independent inspection of the original Linux trace found one exact original-query
button and its correct old-run route. The subsequent row count was zero because
the nested `has` locator included `#main`, an ancestor outside each candidate row.
The original screenshot visibly contained the report row and disabled-export
explanation; the actual reports response preserved the original identity,
title/query and `artifact_hash` integrity failure. This failure does not show a
missing report or a bypass of the export gate.

The correction changes only the row filter to a descendant-relative title button
with the exact question. Original API identity, title, query, source-impact,
unique-button, exact-route and unique-row assertions remain. Eight pure tests use
the installed Playwright locator construction without a browser or driver; their
counts are explicit test inputs, not rendered UI evidence. The original locator
fails that regression, and the corrected locator reaches the original observation
boundary. Independent focused tests passed without application changes, retries
or increased timeouts. A new exact-SHA hosted native execution is required.

The current journey does not expand the unverified raw-JSON disclosure; a visible
closed label does not establish that expanded raw-content inspection is usable.

The original Push and PR workflows each ended with 21 successful jobs and two I9
failures. Both PR I9 summaries likewise stop after step 43; the PR merge-ref tree
is identical to the published head. The correction passed a fresh complete local
seven-stage run: 2383 backend cases collected/started/completed, 485 frontend
tests and 18 real HTTP checks. That does not supply the still-missing native
recovery result. See `evidence/report-export-selector-20261005.json`.
