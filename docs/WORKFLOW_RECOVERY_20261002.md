# Workflow consistency and recovery — 2026-10-02

This bounded iteration follows actual user journeys on the existing PR #2 branch. It does not designate an eternally final version, perform a production migration, or certify software-copyright eligibility.

## Corrected workflows

1. **Recheck a historical assistant follow-up.** A short continuation previously lost its resolved quarter, comparison baseline and metrics when the user opened its formula trace. The new read-only message-bound endpoint verifies ownership and current identity/dataset, reads the original normalized scope, and recalculates only that scope against the current saved revision. Historical answers are not rewritten. Missing legacy scope or a removed quarter produces a corrective error rather than a latest-quarter guess. Repeated reads reject older late responses.
2. **Create another company's dataset with an existing editor behind the dialog.** Add/remove-quarter and supplementary-field controls now target their own form. Returning from preview keeps a new company's name editable; persisted company ownership remains locked. File previews detect a replacement File even when its name, size and timestamp match the submitted file.
3. **Continue typing while a versioned save is pending.** Evidence metadata/review, memory and identity/connection editors retain the newer draft and adopt only the confirmed saved object/version. Subsequent explicit edits no longer loop on the obsolete version or create a duplicate identity/connection.
4. **Recover after a save succeeds but the following read fails.** Ordinary and service forms distinguish confirmed writes from failed synchronization, preserve newer navigation/drafts, display a visible saved/recovery notice, and avoid resubmitting a completed operation. Unknown write outcomes remain unknown and are not automatically retried. History restoration uses the same guarded completion principle and cannot close a newer dialog.
5. **Investigate an alert using current inputs.** The explicit action now performs one rendered navigation and sends the intended question once. Its continuation is invalidated by a newer navigation, identity/account change or interrupted thread loading/creation.
6. **Correct a malformed XLSX upload.** Recognized broken ZIP/XML/workbook structures return a specific 422 `IMPORT_REJECTED` with repair guidance. Input size and ZIP-safety checks remain intact. For workspace uploads, unrelated parser defects are not disguised as user-file errors; the older direct-import endpoint retains its existing broader KeyError handling. The isolated regressions assert that stored datasets, revisions, import receipts, previews and audit rows remain unchanged.

7. **Reuse assessed reports for strategy replay.** Known corruption in node artifacts or their event anchors now excludes an assessed case from evaluation, activation, rollback and future policy selection, using the same read-only integrity verdict as the report audit. New or reaffirmed replay consent is rejected; withdrawing existing consent remains possible without rewriting its frozen assessment basis. Older legacy reports retain their documented partial-verification compatibility. Independently approved runs and archived results are not rewritten.

## Verification contract

- Focused tests execute production handlers and authenticated APIs with isolated synthetic inputs; they are not native-browser evidence and do not represent live provider calls
- Full aggregate verification includes Python compile, TypeScript typecheck/build, backend tests, frontend tests, source checks, and real Uvicorn HTTP/SSE/restart/backup checks
- Native acceptance adds the two-editor/preview-return journey, historical short-follow-up trace and alert-to-research handoff. Native-only known-save recovery deliberately disconnects one post-save capabilities read; this expected network fault is labelled in the diagnostic journal
- Browser File identity is checked against actual repeated FormData reads, rather than assumed from the Node harness
- New routes are reflected in the generated OpenAPI contract. Compiled JS is included with the source

The dated local execution record is `evidence/workflow-recovery-20261002.json`. Publication and exact-SHA CI terminal results are reported on PR #2 after they occur; an older green run is not evidence for this patch.

## Preserved boundaries and remaining work

DeepSeek, GLM, MiMo and Qwen provider support, supplied logo/video, financial formulas and historical reports remain unchanged. No real provider credentials, paid calls, live business data, merge, deployment or ZIP delivery are part of this iteration.

Existing legacy limits documented in `review-regressions-20261001.md` continue to apply. A separate product-design question remains for displaying and associating the complete report → watch → numerical alert → later-action origin chain in feedback views. A valid numerical alert is independently calculated from its frozen financial inputs; it must not be mislabeled as corrupt merely because an earlier report origin becomes unavailable. That broader lineage/display policy is not changed here.

## First native CI attempt and corrective fixture (e2b7fc5b)

Both Linux jobs completed the seven aggregate stages and 25 native checks, including the new saved-read-failure, dialog isolation and historical trace scenarios. The existing later action smoke path then inherited the newly inserted four-character question “那环比呢” and correctly received the mandatory concrete-content validation error. The action form's purpose had not been explicitly filled by the fixture. Its screenshot shows the validation error; no JavaScript exception or HTTP 5xx was recorded.

The fixture now explicitly enters the action purpose and the separate memory content, retaining the acceptance text, preview and confirmation steps. No application source, minimum-length guard, assertion, timeout or retry policy is relaxed. This was independently reproduced/reviewed as a changed-fixture-context failure. The original failed runs and artifacts remain failures; a new exact-SHA full run is required.

## Bounded completion wait after Windows sampling failure (307de95e)

The PR Windows job and both Linux jobs passed all 52 native checks. Push Windows failed the pre-existing immediate second-turn count check after the shared submit helper's 500 ms delay. Its diagnostic journal shows message POST at elapsed 15.400867 s and assertion failure at 15.913739 s, without a response yet; the screenshot still shows the active local-computation indicator. No JavaScript exception or HTTP 5xx was captured. Artifact `11210321797` remains a failed attempt.

The fixture now waits for the second rendered turn under the existing 10-second locator timeout before asserting the exact count of two. This matches the adjacent later-turn waits. No application source, timeout limit, business-request retry or count assertion is changed. Final acceptance requires the new commit's complete CI cycle; the three prior successful jobs do not relabel this failed job.
