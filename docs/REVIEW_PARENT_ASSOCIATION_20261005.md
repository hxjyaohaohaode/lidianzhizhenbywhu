# Claim-review parent association: shape cleanup and capacity — 2026-10-05

Independent review of `4d5f09c277cec403f36918d4782a6f212b1752e8` found that
raw malformed JSON was cleaned with its deleted parent, but valid JSON values
`null`, `[]`, `{}` and `42` remained as orphan reviews despite an unambiguous
saved run-key. Its earlier successful HTTP status alone did not prove complete
logical-child cleanup. The original independent failure matrix is preserved by
hash in this record's JSON evidence.

A separate actual API probe confirmed the previously untested capacity path:
with unreadable B present, the first review on two distinct healthy reports A/C
returned 500 and wrote nothing; updating an existing healthy D review returned
200. An existing-review update therefore was not a valid capacity regression.

Cleanup and claim-review live-parent counting now share one bounded predicate:

- The run and review have the same owner
- The exact saved run-key identifies that parent
- A readable payload run ID is absent or agrees with that parent

This handles raw invalid JSON, scalar/list/null content and objects missing a
run ID. Explicit contradictory bindings are retained rather than guessed into
either deletion. Unrelated/unattributable/foreign rows remain untouched. Normal
review creation succeeds despite a bad sibling, while the bad occupied slot
still counts toward the unchanged 1,000-review ceiling. No general JSON decoder,
other workspace-kind predicate, stored payload, historical assessment/evaluation
or report is repaired or rewritten by this change.

The previous governance and withdrawal changes remain: unavailable reviews are
visibly explained, cannot authorize replay, and do not lock out explicit consent
withdrawal. This correction does not alter the percentage parser branches.

## Executed checks on the final source

- 163 review-context, parent-lifecycle, read-model and persisted-integrity cases passed
- 102 separate evolution, strategy-source, report-integrity, cleanup and journey cases passed
- Full frontend suite: 563 passed; no frontend source or compiled asset changed here
- Python compile, TypeScript typecheck/build, source guard and whitespace checks passed
- Both backend selections actively prohibited network connections/listeners; zero attempts
- Existing one TestClient deprecation warning in each backend run

The 38 review-context cases include 26 additions in this correction; they overlap
the 163 cases and are not additive. The two final backend selections are distinct.
No local/native browser, live Uvicorn listener, external supplier, publication,
merge or deployment was used.
