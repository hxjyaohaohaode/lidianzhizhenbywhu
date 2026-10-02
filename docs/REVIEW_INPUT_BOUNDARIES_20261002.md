# Evidence disclosure and reviewed financial inputs — 2026-10-02

This is a bounded follow-on to the workflow recovery changes. It addresses three reproduced review findings without changing financial formulas, provider destinations, historical reports or database schema.

## Evidence addresses stay in local provenance

Model context no longer includes structured `source_url` or `original_source_url` evidence metadata. Fresh plan packing and both ordinary/adaptive dispatch boundaries apply the same non-mutating projection before serialization, character budgets, request hashes and dispatch reservations. This also covers saved plans, queued runs and resumed execution created by an older version; merely changing new-plan packing would not have protected those paths.

Evidence identifiers, excerpts, scope, review/verification labels, source type and timestamps remain available to the model. Full local citations, corrected display addresses, immutable original addresses, approved snapshots, fingerprints and report exports remain unchanged. Recipients and provider endpoints are not modified. Existing completed checkpoints and unknown remote outcomes are not retried.

The approval summary explicitly distinguishes local address metadata from the selected excerpt text. This is **not general text or secret DLP**: questions, approved excerpts, memories and selected history are sent as previewed. A URL deliberately present within that free text is not silently rewritten by this metadata projection. All provider captures in the regression suite are isolated test doubles, not live supplier calls.

## Gross-profit amount is not a margin percentage

Explicit amount questions such as “毛利额”, “毛利金额”, “毛利润” and “gross profit” receive an unsupported-amount explanation instead of a gross-margin percentage. Supported margin/rate questions, quarter selection and comparison rules remain intact. Short follow-ups do not restore the rejected amount request as an earlier percentage topic.

No new gross-profit calculation is advertised and no original mathematical formula changes. The two assistant entry points return no substituted ratio facts for the unsupported monetary request.

## New experiments require the reviewed revision

Creating an experiment now requires both `dataset_version` (a positive, safe JSON integer) and `dataset_hash` (64 lowercase hexadecimal characters). Missing, null or invalid fields fail validation; stale pairs fail before any experiment is saved. The pair must come from the financial data the caller actually reviewed, not from an automatic refresh used to fill omitted fields at submission time.

The bundled UI already sends this pair. API consumers that omitted it must update their creation requests. Saved historical experiments remain readable and replayable under their existing frozen payload checks; no historical request is backfilled or rewritten. Existing positive tests now send their already-read dataset pair, while stale/invalid tests keep their original rejection assertions.

## Separate alert-lineage issue

The alert-origin review overlaps the previously recorded report → watch → alert → action display/feedback question. A numerical alert has its own frozen inputs and evaluation. Withdrawing permission to use a report for strategy replay is not blanket revocation of ordinary business use, and does not make an independently calculated numerical observation false. This patch does not impose that blanket block. The fuller inherited-origin disclosure/feedback design remains separate.

## Execution record

The dated execution record is `evidence/review-input-boundaries-20261002.json`. It distinguishes focused regressions, aggregate checks, native browser execution and provider-double captures. Earlier workflow CI evidence and failed attempts remain historical evidence for their exact commits; they are not repurposed as proof for this follow-on patch.
