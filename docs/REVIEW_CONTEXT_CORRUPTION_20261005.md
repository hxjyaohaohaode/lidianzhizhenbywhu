# Unavailable current reviews in governance and cleanup — 2026-10-05

Subsequent shape-cleanup and first-review capacity corrections are recorded in
[Review parent association](REVIEW_PARENT_ASSOCIATION_20261005.md). The original
verification and limits below belong to the initial governance candidate.

An actual authenticated API probe of `ead2012392b2fa0c7add6f6e019305d3e6ffcd3c`
found another propagation path from one malformed current claim-review JSON row:
its owner's evolution overview, both affected and unrelated report assessments,
strategy evaluation, consent withdrawal, and both affected and unrelated
conversation deletion returned 500. Another owner's overview returned 200.
The failed operations wrote no business rows and left all runs/workspace rows
unchanged. This evidence is retained separately from the earlier, valid
percentage/report-read verification; that narrower pass is not broadened.

The governance review reader now uses the guarded owner/report-scoped reader.
Healthy rows retain their previous order and context hashes. A known bad review
remains an explicit unavailable record, with no invented note/verdict or fake
absence. Its case cannot authorize new replay or activate a strategy, even if a
caller echoes the unavailable context's hash. An unaffected report's assessment
and eligibility are retained. Existing active-policy invalidation still changes
only mutable policy state and future use; old reports, assessments, evaluations
and approved-plan snapshots are not rewritten by reads.

The assessment interface shows this reason even before any assessment exists:

> 已有人工审阅记录无法核验，不能作为新的回放授权或策略依据；可保存非授权反馈或撤回原同意，原报告与已保存验收依据保持不变。

Replay consent is unchecked/disabled while feedback submission remains enabled.
The production submit path sends `consent_replay: false`, allowing an explicit
withdrawal. On withdrawal from an unavailable context, the prior assessment's
source hashes, saved review receipt/hash and related-action feedback are retained
rather than replaced with a new assessment of unreadable material. New
nonconsenting feedback may be saved with an explicit unavailable marker. Version
and ownership checks remain mandatory.

Conversation cleanup guards JSON extraction, preserving the existing valid-JSON
association. A raw malformed review may be associated only by its exact saved
run-key prefix within the already-authorized owner's selected conversation.
Unrelated malformed records, unattributable orphans, other owners, independent
plans/actions, and archived evaluations are retained. This does not change the
generic workspace parent/capacity filter or claim to repair arbitrary corrupted
business objects.

## Executed checks

- 12 new authenticated API cases passed, including invalid JSON/scalar payloads,
  healthy context/hash controls, case isolation, explicit consent refusal and
  withdrawal, first nonconsenting feedback, existing-policy revocation, and
  single/batch deletion with stale/foreign/unknown-origin controls
- Related governance/review/export/source regression: 284 passed
- Separate report-integrity/strategy-cleanup/product-journey regression: 45 passed
- Full frontend unit suite: 563 passed, including five new production renderer
  and submission tests with explicit DOM/transport doubles
- Python compile, TypeScript typecheck/build, source guard and whitespace checks passed
- Backend runs actively prohibited socket connections and listeners; zero attempts
- Existing TestClient deprecation warning only; no real suppliers were called

The 12 new cases overlap the 284-case run; the two backend module selections are
distinct. No local browser, rendered/native UI, live Uvicorn listener, external
supplier, publishing, merge or deployment was performed. Browser interaction is
a separate acceptance step, not implied by the production-renderer tests.
