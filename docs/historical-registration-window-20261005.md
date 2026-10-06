# Historical-warning registration observation — 2026-10-05

The historical-warning native journey previously started its ten-second
registration-response observer before the entire registration helper. That
included the original opening, readiness checks, three fields and screenshots.
The observer could expire even when the actual registration completed promptly.

The Windows run 37383460564, attempt 1, at
`abb2d5b09c3b0dcb7d6e1daf6ce487c2a8126506` remains
`blocked_or_error`: `Timeout 10000ms exceeded while waiting for event "response"`.
The reviewed trace starts that wait at 1315.839 ms, records its timeout at
11321.488 ms and sends the registration request only at 11190.483 ms. Its 201
response completes at 11331.948 ms. The empty-workspace frame is present, but
the 49-row historical preparation was not reached. This repair does not turn
that failed native run into a pass.

## Change

`register_empty_workspace` accepts an optional `observe_registration` callback.
Only the historical-warning journey opts in. The response observation starts
inside the existing submit step, after the before-screenshot and visible-form
check, immediately around the original `submit_form`. The original single
button click and ten-second form lifecycle remain. The subsequent workspace
wait, after-screenshot and empty-workspace checks also remain. Ordinary callers
continue to use the original `Probe.submit` branch and return `None`.

The journey still requires the captured response to be 201. Before preparation,
it also requires the observed write list to contain exactly one registration
POST. It takes the owner from that response; the unchanged
`prepare_native_history` checks both that owner and the recorded owner against
the current authenticated `/api/auth/me` owner before opening the database.
There is no retry or extra wait.

No application, branding, fixture bytes, export bytes, admission scope, workflow,
300-second native journey budget, response timeout or form timeout changed.
The original separate legacy scope, 49-row restore, single-use receipt, frozen
row/export checks and no-external-call requirement remain in effect.

## Executed checks

The new deterministic instrumentation runs the actual registration helper,
`Probe.step`, `_capture_response` and `submit_form` against a virtual-time page
double. It includes the natural opening and every before/after capture. The
old outer observer still times out after preparation exceeds ten seconds. The
submit-only observer succeeds with both 140 ms and 9999 ms response delays,
while all original steps, captures, field operations and empty-workspace reads
match the default branch. This is an instrument contract, not browser evidence.

Adverse contracts reject non-201 status, a missing or unrelated response,
completion beyond ten seconds, visible form errors, duplicate registration,
an extra business write and registration/current-login owner disagreement.
They verify one click only, listener cleanup and no historical preparation on
rejection. Existing unpatched admission-denial and 49-row fixture tests remain
part of the focused run.

Executed: 186 tests passed in the registration instrumentation, historical
reader, historical fixture, audit runner and CI budget modules; changed Python
files compile; `git diff --check` passes; protected application, native-runner,
workflow and fixture paths are unchanged from the base commit. The existing
Starlette/httpx deprecation warning remains. Full aggregate verification is
pending integration. No local browser, new native run, publication or CI
trigger was performed.

The synthetic timing receipt and focused output are in
`evidence/historical-registration-window-20261005/`. They contain no original
native media and do not certify the historical-warning UI journey as passing.
