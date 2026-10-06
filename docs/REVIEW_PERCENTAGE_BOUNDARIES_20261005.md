# Review corruption and percentage-operation boundaries — 2026-10-05

Malformed claim-review JSON is now selected through guarded JSON extraction and
read through a raw alias before defensive decoding. Report lists and audits no
longer fail because another report's current review cannot be decoded. A known
saved key makes the original report's review explicitly unavailable; an orphan
with no usable binding is not guessed into another report. Owner filtering is
preserved. Selected-claim source resolution and saved action/watch overlays use
the same reader, so an unreadable occupied review is never treated as an absent
version-0 review. Independent healthy claims remain usable.

The export endpoint had a separate unguarded query and is corrected too. Healthy
review rows retain their original values, order and export representation. An
invalid review is represented by an explicit unavailable descriptor, without an
invented verdict or note. A valid frozen report remains exportable; the existing
frozen-report integrity gate remains mandatory. No read repairs any stored row,
report, action, watch, event or fingerprint. This is a bounded provenance/export
fix, not a general damaged-database repair or a change to review write capacity.

Both assistants now distinguish explicit relative changes (including
增长百分之多少, 百分比增长, 涨幅, and English percentage growth) from existing amount
and percentage-point differences. Unsupported metric transformations return no
substitute financial facts. Existing revenue growth uses its unchanged formula;
absolute amounts, ratio points and all explicitly requested supported metrics
retain their scope. The vocabulary is finite; this does not claim arbitrary
natural-language support or add new financial formulas.

New previews show the transformation blocker. The existing execution-admission
gate also rejects these targets before new approval or execution, including old
saved plans. It continues to use the bound edited target rather than unrelated
chat history. Completed historical outputs and repeated approval remain frozen.

## Saved old-state evidence

`scripts/capture_percentage_scope_fixture.py` captures 11 real API-created cases
from clean `80defc9b54159155000ac7564fbdd1247c0f0403` source: legacy/adaptive drafts,
approved queues, completed reports, valid amount/revenue/percentage-point
controls, and two explicitly edited proposal targets. No plan or approval is
manufactured or rehashed. All 14 exported tables were compared directly with
the original temporary capture database and matched every serialized row.
Authentication tables and credentials are not exported. Network connections and
listeners are prohibited; external provider calls are zero.

Fixture SHA-256: `4c69e0787c384443cd31eebb425d90cb90d60333a2524175b8496690080382fc`.

## Executed checks

- Initial new focused cases: 60 passed
- Related backend regression: 1,129 passed across 19 modules
- After the final healthy Markdown field-order preservation and its additional
  control: all 123 affected review/export/transformation/old-plan checks passed
- Full frontend unit suite: 558 passed, zero failures/skips
- Python compilation, TypeScript typecheck/build, source guard and patch
  whitespace checks passed; compiled frontend assets did not change
- All backend commands prohibited socket connect/connect_ex/bind/listen and
  create_connection; zero attempts were observed

Backend results include the existing TestClient deprecation warning. The focused
123 and initial 60 overlap the broader regression and are not additive totals.
The broad run preceded only the final review-field-order correction, which was
then verified by the affected 123-case suite. New test count is 61.

This record is in-process API/unit verification using isolated synthetic data
and named local provider doubles for report fixtures. Real Uvicorn/HTTP/SSE,
restart/backup-chain, native/rendered browser, live suppliers, production data,
publishing, merging and deployment were not performed in this scoped task.

## Independent word-order review and correction

Independent actual-API review of `7b41b53734f9a8ca48ddc53266b82de983b6a91f`
confirmed the malformed-review fix and original 13-question matrix, then found
four additional unsupported transformations still being answered as amounts:
`成本环比百分之多少`, `净利润环比百分之多少`, `成本环比变化百分比是多少`, and
`成本环比增加了多少百分比`. These failures are retained in
`evidence/percentage-word-order-first-candidate-failures-20261005.json` with the
original independent artifact hash; the first candidate is not relabelled as a
complete pass.

The finite Chinese matcher now pairs a change/comparison operation with an
explicit percent unit, allowing the unit before or after the change verb and
allowing a comparison to supply an omitted verb. Equivalent registered revenue
wording still uses the existing revenue-growth formula. Bare ratio percentages,
percentage-point differences, ordinary amount differences, and independent
supported metrics remain distinct. No formula, saved report, or approval
fingerprint is rewritten. This remains a bounded language contract, not a claim
of complete natural-language coverage.

An additional eight old-version API-created drafts/approved queues capture all
four exact failures with both execution engines represented. The separate
`percentage-word-order-scope-80defc9.json` fixture preserves original serialized
rows and hashes, and all 14 tables were checked against its original capture DB.
The original 11-case fixture remains byte-for-byte unchanged. Supplemental
fixture SHA-256: `ac281c2a62fdb2fe98d38cb8dffabcf9fcebebaf41037fec72736628f463e587`.

Final word-order candidate checks: all 1,154 related backend cases passed on the
final source (including all 85 new cases), with the existing one TestClient
warning and zero network/listener attempts. Full frontend tests passed 558/558;
Python compilation, TypeScript typecheck/build, source guard and whitespace
validation passed. These counts overlap the earlier checks. Native browser,
live HTTP listeners, external suppliers and deployment remain unrun.
