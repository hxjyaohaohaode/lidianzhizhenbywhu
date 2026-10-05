# Historical percentage-question reading limits — 2026-10-05

Historical reports can retain correctly stored amount values while failing to
answer the original request for a percentage. The report audit now provides a
separate read-time compatibility notice for the current finite unsupported
percentage-operation and denominator rules. The report page and corresponding
copilot report readout show the approved original question, the applicable
limitation, and an explicit distinction between retained values and the missing
percentage answer. A new-research route lets the reader define a supported
question. Downloads are explicitly labelled as unchanged original exports.

Saved copilot questions with the same known old mismatch show the notice above
their original answer. Their current-input trace no longer presents an amount
as the requested percentage: the UI explains the unavailable operation and the
API returns `TRACE_QUESTION_UNSUPPORTED` before calculation. Existing ownership,
identity, saved-scope, current dataset-integrity and target-quarter checks still
run first. No formula, saved answer, result, snapshot, plan fingerprint, event,
artifact or export is rewritten.

The notice uses the canonical question router's bounded operation predicates;
it does not infer invalidity from absent modern fields. Current refusals and
supported amount, named-ratio, revenue-growth and percentage-point questions
retain their behavior. For reports, the existing integrity verdict is required,
and studio reports additionally verify their approved plan before resolving
its edited target. A proposal's old source question or unrelated included
history cannot replace that approved target. An unavailable target does not
become an invented incompatibility. The existing corrupt-report mask and export
gate remain separate and mandatory.

## Evidence

The new in-process tests restore untouched business rows from the authentic
`percentage-execution-scope-80defc9.json` and
`bare-percentage-scope-80defc9.json` captures. Both completed execution engines
show the notice, all original JSON/Markdown export hashes still match, and all
captured tables and SQLite write counts remain unchanged after repeated reads.
Saved supported amount traces still return their original values; unsupported
traces cannot reach the calculation function. Additional controls cover edited
supported targets with unsupported source questions, current data corruption,
report/plan corruption, cross-owner access, older revenue growth, and a genuine
pre-readout/pre-anchor supported report with its original partial-integrity
contract. No historical fixture was changed or rehashed.

Compiled JavaScript tests render all four genuine old completed outputs and
saved messages, exercise the actual run-page and chat handlers through an API/
DOM bridge, check that the warning precedes retained values, verify escaping,
retain the original answer after a failed trace, and verify corrupt reports do
not expose normal readouts. These are not native browser checks.

Validation results are recorded after the final run below. This scoped task
runs no HTTP listener, local/native browser, live supplier call, publication,
merge or deployment. Hosted Chromium and end-to-end acceptance remain with the
integrating task.

## Executed validation on the final source

- Related in-process backend regression: 768 passed, zero failures/skips,
  including all 22 new cases
- Full compiled frontend regression: 968 passed, zero failures/skips, including
  the eight new authentic-fixture rendering/handler cases
- Python compilation, TypeScript typecheck/build, source guard and Git whitespace
  checks passed; compiled JavaScript is included
- Socket connect, connect_ex, create_connection, bind and listen were prohibited
  throughout the backend run; zero attempts occurred
- Existing Starlette TestClient deprecation warning only

The 19 backend modules were `test_historical_question_scope`,
`test_percentage_execution_scope`, `test_bare_percentage_execution_scope`,
`test_legacy_execution_scope`, `test_copilot_message_trace`, `test_report_readout`,
`test_report_export_integrity`, `test_report_source_integrity`,
`test_percentage_transformation_scope`, `test_bare_percentage_scope`,
`test_question_scope`, `test_currency_comparison_scope`, `test_services`,
`test_service_hardening`, `test_source_freeze_boundaries`,
`test_proposal_execution_binding`, `test_copilot_metric_coverage`,
`test_copilot_research_inputs` and `test_legacy_comparison_shape`.

Full scoped logs and the source-guard record are in
`evidence/historical-question-scope-20261005/`. These are focused regression
results, not a full backend or browser acceptance claim.
