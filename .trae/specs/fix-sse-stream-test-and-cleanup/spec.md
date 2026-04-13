# Fix SSE Stream Test and Remove Debug Logging Spec

## Why
After adding authentication middleware (`authenticateRequest`), role authorization (`authorizeRole`), and unified API response format (`{success, data}`), 9 tests were failing. 8 of 9 have been fixed by adding `userId`/`role` to test requests, updating response format assertions, and adding `async`/`await` to route handlers. One test remains failing: "streams formal debate events and reuses auto-built profile" — the SSE stream emits 0 debate events because supertest's `request.on("close")` fires prematurely, setting `clientDisconnected = true`, which causes `signal.aborted` to return `true` and abort the stream before debate events are generated. Additionally, 5 debug `console.log` statements were added to `app.ts` during investigation and must be removed.

## What Changes
- Fix SSE stream abort mechanism in `app.ts` to not abort on supertest's premature `request.on("close")` event
- Remove 5 debug `console.log("[DEBUG stream]...")` statements from `app.ts`
- Verify all 9 previously failing tests now pass

## Impact
- Affected specs: SSE streaming, client disconnect handling
- Affected code: `src/server/app.ts` (SSE stream handler at `/api/investor/stream`)

## ADDED Requirements

### Requirement: SSE Stream Abort Signal Must Use Response State
The SSE stream handler SHALL use `response.destroyed` (or equivalent) as the abort signal instead of a `clientDisconnected` flag set by `request.on("close")`, so that supertest's premature connection close does not abort the stream before all events are generated.

#### Scenario: Supertest SSE stream completes fully
- **WHEN** a supertest request consumes an SSE stream from `/api/investor/stream`
- **THEN** the stream SHALL continue generating all events (session, progress, debate_message, result) even after supertest's internal `request.on("close")` fires
- **AND** the test receives all 15 debate events and the result event

#### Scenario: Real client disconnect still aborts stream
- **WHEN** a real browser client disconnects mid-stream (navigates away, closes tab)
- **THEN** `response.destroyed` becomes `true` and the stream SHALL abort, stopping further LLM processing

## MODIFIED Requirements

### Requirement: SSE Client Disconnect Detection
The `clientDisconnected` flag set by `request.on("close")` is replaced by checking `response.destroyed` in the abort signal getter. The `request.on("close")` handler is retained only for heartbeat cleanup (clearing the interval), not for abort signaling.

## REMOVED Requirements

### Requirement: Debug Logging in SSE Handler
**Reason**: Debug `console.log` statements were added temporarily during investigation and are not needed in production.
**Migration**: Remove all 5 `console.log("[DEBUG stream]...")` lines from the SSE handler in `app.ts`.
