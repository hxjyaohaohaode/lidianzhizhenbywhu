# Tasks

- [ ] Task 1: Fix SSE stream abort signal in app.ts
  - [ ] SubTask 1.1: Change the abort signal getter from `{ get aborted() { return clientDisconnected; } }` to `{ get aborted() { return response.destroyed; } }` in the `/api/investor/stream` handler
  - [ ] SubTask 1.2: Keep `request.on("close")` handler for heartbeat interval cleanup only, remove `clientDisconnected = true` from it
  - [ ] SubTask 1.3: Remove the now-unused `clientDisconnected` variable declaration
- [ ] Task 2: Remove debug logging from app.ts
  - [ ] SubTask 2.1: Remove `console.log("[DEBUG stream] request close event");`
  - [ ] SubTask 2.2: Remove `console.log("[DEBUG stream] request.body:", JSON.stringify(request.body));`
  - [ ] SubTask 2.3: Remove `console.log("[DEBUG stream] event:", event.type, "aborted:", clientDisconnected);`
  - [ ] SubTask 2.4: Remove `console.log("[DEBUG stream] completed normally");`
  - [ ] SubTask 2.5: Remove `console.log("[DEBUG stream] error:", error);`
- [ ] Task 3: Run full test suite and verify all tests pass
  - [ ] SubTask 3.1: Run `npx vitest run src/server/app.test.ts src/server/app.models-api.test.ts`
  - [ ] SubTask 3.2: Verify 0 test failures

# Task Dependencies
- Task 2 depends on Task 1 (both modify the same code block, do them together)
- Task 3 depends on Task 1 and Task 2
