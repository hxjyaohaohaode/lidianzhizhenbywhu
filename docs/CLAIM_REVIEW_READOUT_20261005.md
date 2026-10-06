# Current claim-review readout and report export controls — 2026-10-05

## Corrected behavior

Previously, a saved claim-review payload of JSON null or a list disappeared from
`GET /api/workspace/runs/{id}/reviews` because the general parent filter depended
on `payload.run_id`. The GET returned 200 with an empty list. The report remained
readable with an audit warning, but its claim card incorrectly said no human
review existed and its form offered version 0.

The report-specific GET now checks the owned live report first and selects only
that owner's rows associated by saved natural key or payload report ID. Healthy
response bytes below the supported version ceiling remain unchanged. Invalid rows are separate `unavailable`
descriptors with the saved ID/version, a reason, and no invented verdict/note.
`claim_id` is supplied only when the association is unambiguous; an independent
`target_claim_id` identifies a known occupied write slot without endorsing a
conflicting payload as a trusted prior review. Scoped `candidate_claim_ids` also
identify the other current-report claims named by a conflicting payload; an
otherwise unbound candidate cannot be presented as a brand-new version-0 review.
An independent healthy exact slot takes precedence over these candidates.

For a recoverable JSON value and an unambiguous saved key, the UI explains that a
new explicit assessment updates the current review. It starts with a blank new
verdict and note and submits the actual existing version through the
owner/version-checked POST. Concurrent updates remain conflicts. No read repairs
data, and submitting a new review does not rewrite frozen reports, action/watch
payloads or their saved source fingerprints. The existing audit records the new
version; the UI does not claim to restore the old review content.

Conflicting associations or unusable saved versions have an explanation and no
active version-0 form. A bad second claim does not mask or block an independently
healthy first claim: the latter retains its original verdict and actual version
and still supports an ordinary re-review. Late mutation responses cannot dismiss
newer navigation, dialogs or edits; late conflicts cannot replace a newer error.

The detail and list views hide MD/JSON download links only for known frozen-report
integrity failures and expose `data-report-export-unavailable` with a Chinese
reason and the choices to check trusted records or create a new analysis.
Healthy, current-source-changed, review-unavailable and genuine legacy-partial
reports keep their download links. The separate server export gate covers damage
that occurs after the page read; this change does not retry failed downloads.

A report known to fail integrity no longer enters the normal answer, chart,
comparison, adaptive-result or calculation-lineage renderers, and does not offer
report-based action/watch controls. The original question remains visible with
`data-report-unverified`, a Chinese explanation and a collapsed
`data-unverified-report-raw` section explicitly labelled as unverified saved
technical content. Tampered numbers may be inspected there, but are not formatted
or endorsed as a main answer. Valid source-changed and legacy-partial reports
retain their ordinary question answers and controls. No stored content is changed.

## Verified limits

Raw invalid JSON is handled safely by this reviews GET and is explicitly blocked
for the affected re-review. A known raw unreadable row also prevents offering a
new review slot whose unchanged capacity check cannot safely inspect that row.
This is not a guarantee that other audit/source endpoints support arbitrary raw
invalid JSON, nor a database-repair feature. No broader store or provenance contract was changed. The POST now rejects
version-count growth beyond the supported safe-integer limit, after ownership,
claim existence and stale-version checks, in the same write transaction.

A structurally valid review at version `9007199254740991` retains its trusted
payload in `items`, with a separate `read_only` explanation. Its prior verdict
and note remain viewable, without a re-review form or a corruption warning. The
POST returns `VERSION_LIMIT` / 409 with zero writes at that ceiling; a stale
version still returns `VERSION_CONFLICT` first. Eight concurrent attempts from
the last available revision have one winner and seven conflicts, never an
out-of-range stored version. An existing exact slot with an invalid saved zero
version is rejected as `INVALID_VERSION` / 409 after the conflict check, without
repairing or rewriting it. An absent slot may still be created with request
version 0, producing the normal first stored version 1.

## Execution evidence

- 23 focused backend route tests passed in `tests/test_claim_review_read_model.py`
- 40 new production renderer/listener tests passed in `tests/claim-review-readout.frontend.test.mjs`
- Initial related backend regression before the final boundary additions: 288 passed across the new read-model tests and existing workspace API, business provenance, provenance eligibility, report-source integrity, persisted-review integrity and live-source integrity modules
- Initial full frontend suite before the final boundary additions: 477 passed
- Before the final stored-zero guard: 55 backend tests passed (22 review read-model + 33 export-integrity), and 52 focused frontend tests passed (40 readout plus existing report-integrity/readout cases); the final aggregate suite is intentionally left to the parent acceptance run
- Final stored-zero guard rerun: all 23 review read-model tests passed; the independent stored-zero probe reports 409 / zero writes while absent-slot version-0 creation remains 200 / version 1
- TypeScript typecheck/build, Python compilation and patch whitespace checks passed
- Backend cases include healthy exact response bytes, malformed JSON values, ambiguous bindings, invalid versions, raw malformed JSON, owner/deleted-parent/unrelated-report isolation, zero-write reads, actual versioned re-review, independent healthy-claim recovery, and unchanged frozen report/action/watch data
- Frontend cases execute the compiled production renderers and event handlers with explicit DOM/transport doubles, including repeat submission, version conflicts, navigation/dismissal/new-dialog/edit races and export boundaries

All new backend tests use isolated temporary databases and named in-process
provider doubles. No real provider, browser, native UI, live listener or deployment
was used for this record. Full backend aggregation and native UI acceptance are
separate checks.
