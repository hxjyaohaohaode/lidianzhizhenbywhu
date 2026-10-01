# Review regression fixes — 2026-10-01

## Enforced boundaries

- Research proposal previews are fingerprint-bound to their proposal and remain read-only through the ordinary plan-execution endpoint. Preview/proposal persistence and run/confirmation persistence each commit atomically. Discarding a proposal or deleting its assistant thread revokes unexecuted linked previews; independently confirmed runs survive.
- Active planning policies require their original current, consenting assessed cases. Source deletion or assessment changes invalidate the affected policy version and outstanding draft-plan bindings. Rollback checks original sources and reruns the bounded local evaluation. Historical reports and evaluation evidence are not rewritten.
- Report-backed actions and watches, including inherited action origins, use the same read-only integrity verdict as report audits. Known corruption cannot be accepted through `allow_historical`; changed business context remains separately acknowledgeable. New legacy reports also anchor a whole-result digest in their terminal event transaction.
- Persisted call-closure events distinguish verified non-dispatch failures from unknown remote outcomes after a crash. Neither class gains permission to retry. Planner-omitted optional challengers stay disabled; deterministic review gates remain mandatory.
- Report UI distinguishes pending evidence, completed integrity failures, verified reports, and older legacy reports with only partial independent evidence.

## Upgrade limits

**Already-orphaned historical preview plans cannot be identified automatically.**
Older releases did not mark the origin of a plan. If its proposal was already deleted or never saved, the remaining plan is indistinguishable from an ordinary legacy workspace draft. This change blocks new bound previews and still-linked old previews; it does not guess their provenance or blanket-invalidate legitimate old workspace drafts. An installation with such historical records needs an explicit operator review/re-preview decision. No production database or live-data migration was exercised or implied by this patch.

Older legacy reports without a terminal whole-result digest remain readable and usable under their available snapshot, dataset and event checks. Their `report_hash_valid` remains `null`, and the UI discloses partial verification. Arbitrary pre-existing changes to their unanchored output cannot be independently detected; existing captured source hashes can still detect later changes. The stronger terminal digest applies to newly published legacy reports without retroactively modifying older reports.

Older completed non-dispatch checkpoints can resume only when their existing artifact and completion anchors prove the matching failure, call ID and error class. An older unfinished non-dispatch row with no trustworthy closure evidence fails closed and is never automatically retried.

Strategy invalidation affects new planning and undispatched drafts. Independently approved frozen runs and archived reports are retained; withdrawing replay consent does not silently rewrite or cancel them.

## Regression coverage

- `tests/test_proposal_execution_binding.py`: direct-execution rejection, current and linked-legacy discard/deletion, failed saves, concurrent confirmation, consent, ownership, current inputs and independent-run retention
- `tests/test_strategy_source_lifecycle.py`: real activation, single/batch deletion, consent changes, invalid rollback, unrelated/foreign controls, atomic rollback and malformed history
- `tests/test_report_source_integrity.py`: corruption matrices, zero-write rejection, multi-hop inherited sources, healthy/historical legacy compatibility, prospective legacy publication hashes and unpublished-final-artifact boundaries
- `tests/test_adaptive_recovery_selection.py`: crash recovery, closure tampering, legacy terminal checkpoint compatibility, forged non-dispatch metadata and optional specialist selection
- `tests/proposal-preview.frontend.test.mjs` and `tests/report-integrity.frontend.test.mjs`: read-only preview controls and pending/completed/partial-verification rendering contracts

The dated execution record is `evidence/review-regressions-20261001.json`. Unit/protocol checks, native browser acceptance and live provider use are reported separately; provider doubles are not live supplier calls.
