# Current copilot damaged-report reader preparation · 2026-10-05

Update: the current candidate replaces the original single-line scrolling stage with the shared unverified-text reader, visible Chinese keyword search, ordinary vertical reading and an exact original-text download. See [UNVERIFIED_TEXT_READER_20261005.md](UNVERIFIED_TEXT_READER_20261005.md) for the current product contract and pending native journey. The preparation record below describes the earlier baseline; its prior results do not validate the new reader.

This preparation adds a bounded native reader journey, a narrow synthetic saved-result fault, and independent adverse contracts. It does not change the application or register/run a native suite. It is based on commit `5791b391749db18539c524fa607b7b75e3d15ff7` with web tree `fc2d662decb35ad551cae0e39766d07f6b90ee92` and server tree `f6dbb3a3f3649574237cea12aecb43fd96d14283`.

## Native entry and expected integration

- Module: `scripts/product_copilot_integrity.py`
- Function: `copilot_report_integrity(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree)`
- Scenario: `I10-copilot-report-integrity`
- Suggested independent suite: `copilot-integrity`, mode `product-copilot-integrity`, report `product-copilot-integrity-audit.json`
- The runner must explicitly admit `database_fault_injection: True`, pass the current reviewed full web/server tree IDs, and use its existing `Probe`, form submission adapter, finalization and evidence packaging
- Keep the existing 300-second process and 15-minute job limits. Preserve original source, entry/file, CSP and brand guards; original PNGs, viewport/full-page screenshots, video, trace, explicit receipt artifacts and SHA-256 transfer packaging
- No local browser, server, listener, policy workaround, provider call, remote publication or native execution occurred during preparation

## Actual UI outcome

1. Register a fresh synthetic account, import the existing labelled 12-quarter CSV through visible controls, and select 万元 display
2. Ask `2024-Q4毛利率是多少` in the real assistant. Open the research form from that response, explicitly enter external-call maximum 0, generate the proposal, read the approved question and zero-call boundary, and explicitly approve execution
3. Read the completed card's full approved question, gross margin 20%, revenue 10万元, cost 8万元, formula, dataset revision, source filename, original yuan/standalone-quarter units and unverified-input notice
4. Only after those healthy readings, declare one synthetic saved-result corruption
5. Open the actual thread-history list by its original question, reopen the original thread and read the card's unavailable reason and retained original question. Assert no normal answer, chart, mathematical output or actionable derived route remains
6. Actually expand the clearly labelled unverified raw disclosure, read its warning, and use actual native horizontal/vertical wheel movements to read the damaged readout fact's metric ID, Chinese label and value. Read-only DOM Range geometry and screenshots record each reached text range. Exact raw text and hashes corroborate this; they do not substitute for visible reading
7. Browser reload must continue to block the old card. Submit and explicitly approve a fresh independent report through the assistant in the same thread, read its healthy 20% answer and provenance, then return through history and prove the old card is still blocked
8. Compare complete old run/proposal/plan/dataset/artifact/event/ledger rows and raw text after the fresh report. No original history is repaired, restored, rewritten or re-created

The same-thread fresh-report path is independently corroborated with the real authenticated in-process proposal API and worker. New research is bound to the new message; it does not inherit the damaged report. This is API evidence, not native evidence.

## Exact artificial fault

Existing `report_artifact` only changes a separate final-artifact title. It cannot reproduce an altered saved report appearing as a normal answer. The new `inject_copilot_report_result` fixture therefore changes only the canonical saved `runs.result` scalar `readout.facts[0].value`, from `0.2` to `987654321`. Every other result byte and every related original row remains unchanged, including final-artifact bytes/content hash, event anchors, ledger, snapshot, request, timestamps, proposal and plan versions, and original dataset.

The fixture requires the native isolated runner, matching existing temporary DATA_DIR, an explicitly synthetic current owner, a healthy actual audit, exact completed report/proposal/plan binding, and exact original rows captured after healthy UI readings. Its transaction records full original and damaged rows in one explicit `fault-injection` JSON artifact. There is no restoration API. Receipt failure rolls back the uncommitted fault. Repeated faults, changed owner/source/bytes, already damaged result, ambiguous metric or wrong original amount are rejected.

Expected failure is exactly `report_hash`, with intact artifacts, event ledger, data and snapshot hashes. The thread API returns `result: null`, unavailable status and the exact unchanged damaged raw string. Native page reads may not repair it.

## Network observations and evidence boundaries

After bootstrap, the only business writes are seven native UI requests: one `POST /api/services/threads`, two `POST /api/services/threads/{thread}/messages`, two `POST /api/services/threads/{thread}/proposals`, and two `POST /api/services/proposals/{proposal}/confirm`. No script issues a direct API business write. Corroboration uses GET for current user, dataset, thread/list, proposal, plan, run/list and run audit. The separately declared fixture writes only the disposable SQLite result column.

Not covered: authentic historical unsupported-percentage warnings, malformed/missing result JSON, arbitrarily oversized raw JSON, revoked identities, or live providers. The unmodified production raw disclosure is single-line JSON; if native scrolling cannot make the damaged fields visible, this journey fails honestly. No synthetic formatting or DOM repair is allowed.

## Preparation validation

- Python compilation and diff whitespace check passed
- 87 pure, temporary-SQLite, existing native-fixture and I9 adverse contracts passed
- 1 authenticated in-process API same-thread recovery contract passed
- One upstream Starlette/httpx deprecation warning remains
- Native browser/UI/PNG/video/trace evidence is pending a separately authorized hosted run and independent artifact review
