# Copilot report integrity mask — 2026-10-05

Independent review of the historical-question warning candidate `31788c4`
found an adjacent existing reader gap: a real executed research proposal's
report failed its frozen-output hash after an isolated amount change, but its
copilot card still rendered the altered amount normally and described it as
original frozen content. The main report page already masked that condition;
the copilot proposal card did not. The historical-question warning patch remains
unchanged as a separate commit.

The copilot thread now obtains each owned run's saved bytes and current report
integrity verdict in one read transaction. It uses the same canonical report
check as the report audit. Only a successful verdict exposes `result` for normal
rendering. An unavailable report returns `result: null`, an explicit
`report_integrity`/`report_availability` descriptor, and any saved report text
under separately labelled `unverified_report.raw`. Malformed JSON and invalid
structures are isolated to that card rather than aborting healthy neighbors.
Unrelated malformed proposal JSON cannot break the thread-selection query.
No stored report, input, event, artifact, hash or approval is repaired or replaced.

The compiled proposal card requires both the server's successful integrity
verdict and available state. Otherwise it hides the normal answer, findings,
model explanation, mathematics and related output links. It retains the original
question, a visible unavailable explanation, and escaped original text inside a
clearly labelled unverified-history disclosure. It provides paths to inspect
saved records or start a new research question without claiming the damaged
content is usable. A failed or absent verdict cannot be replaced by the presence
of a `result` object.

Queued/running work without a result shows that the report is pending. Cancelled,
failed or interrupted work without a report is distinct from corrupt completed
output. Healthy reports with changed current sources retain their frozen values
and separate applicability notice. Partial-integrity legacy reports keep their
existing limitation disclosure. Ownership and historical read-only identity
behavior remain unchanged. Current-source read failures cannot certify present
applicability or silently rewrite a separately verified report.

## Verification

The new backend cases execute the actual old captured source proposals through
the API before applying isolated corruption. Both percentage captures retain
their original input rows and hashes. The adverse matrix covers altered amounts,
malformed result/snapshot/request/artifact/event JSON, invalid shapes, missing
results/artifacts and broken ledgers. Repeated thread reads preserve every
captured table and have zero SQLite row changes. The altered-amount verdict
matches the ordinary report audit, and the export gate still refuses it. A
healthy second proposal in the same thread remains readable throughout.

Controls include another healthy thread, unrelated malformed proposal JSON,
foreign-owner denial, both execution modes, actual worker transition from
queued to running and API cancellation, healthy completed output after identity
revocation, and the existing historical percentage warnings and export hashes.
The running-state check pauses the local worker with a named test coroutine;
it does not call an external supplier.

Compiled renderer tests exercise the production proposal card and full thread
paint/remount handlers. They verify escaped raw-only display, no normal or
mathematical outputs, healthy neighboring cards, pending/no-report states,
changed current sources, partial legacy verification, and rejection of absent
or contradictory verdicts. A late older healthy read cannot revive a card after
a newer corruption verdict; changing identity discards late report content.
Existing renderer fixtures now carry the explicit healthy server verdict.

Validation results are recorded below after the final run. This is in-process
API and compiled DOM/API-bridge evidence, not native or hosted browser proof.
No local HTTP listener, browser, external supplier, publication, merge or deploy
was used. Independent review and hosted Chromium remain separate evidence.

## Executed results on the final source

- Related backend regression: 536 passed, zero failures/skips, including all
  28 new copilot integrity cases and the 22 historical-question cases
- Full compiled frontend regression: 982 passed, zero failures/skips, including
  14 new card/handler cases; focused compiled checks also passed 70/70
- Python compilation, TypeScript typecheck/build, source guard and whitespace
  checks passed; the changed compiled copilot JavaScript is included
- Backend socket connect/connect_ex/create_connection/bind/listen were forbidden;
  zero network/listener attempts occurred and no real supplier was called
- Existing Starlette TestClient deprecation warning only

Backend modules: `test_copilot_report_integrity`, `test_historical_question_scope`,
`test_copilot_research_inputs`, `test_copilot_message_trace`, `test_services`,
`test_service_hardening`, `test_report_source_integrity`,
`test_report_export_integrity`, `test_report_readout`,
`test_proposal_execution_binding`, `test_source_freeze_boundaries`,
`test_legacy_execution_scope`, `test_percentage_execution_scope`,
`test_bare_percentage_execution_scope`, `test_business_provenance`,
`test_claim_review_read_model` and `test_persisted_review_integrity`.

Logs and source guard are retained under
`evidence/copilot-report-integrity-20261005/`. Counts overlap and are not additive.
These checks do not constitute full backend or browser acceptance.
