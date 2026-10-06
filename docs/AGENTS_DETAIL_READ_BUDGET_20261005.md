# Agent detail read budget — 2026-10-05

## Observed failure and scope

The existing Linux L10 native report-history recording at
`7e7ebe828b4653a02637fe79bdf9c235d1e067a3` stopped at the seventeenth
plan submission. Counting request snapshots in its `trace.network`, excluding
`/api/auth/`, gives 601 requests in 56.514797 seconds: 565 GET, 35 POST,
and one PUT. The only failed response is `POST /api/workspace/plans`, HTTP 429,
`RATE_LIMITED`, without a `Retry-After` header. The server correctly enforced
its existing 600 non-auth requests per minute limit.

The six creation-input routes each appeared 53 times: orchestration catalog,
plans, templates, conversations, experiments, and comparisons. Those are 318
GETs. Assistant thread reads contributed another 58. There were only five
run trace reads and four SSE connections, so this recording does not establish
live-event refresh bursts as the main cause. This change targets the observed
detail-page read amplification; it does not change `RunLive` scheduling.

Trace ZIP SHA256:
`688d72824c9220425679165aee076abcfe449c2304b43b0e4ed4e2f563926e26`.
The source recording is retained separately as
`product-report-history/L10-report-history/trace.zip`; request analysis preserves
counts and route patterns only, without copying cookies or authentication headers.

## Change

Patch baseline: `2e85ffac5e1ab76bd1d9dcfcd44605b314b5f3a7`.

`agentsPage` now selects plan and run detail renderers before loading inputs for
the new-plan form. Detail pages use the saved plan, run, audit, reviews and,
where needed, adaptive runtime. Legacy runs without saved graph nodes still
fetch a fresh catalog. Saved empty graphs remain authoritative. No long-lived
cache substitutes for required reads.

Compiled page-renderer request counts, excluding the independent assistant:

| Route | Baseline GETs | Changed GETs |
| --- | ---: | ---: |
| New plan form | 6 | 6 |
| Saved plan approval | 7 | 1 |
| Run with saved non-adaptive nodes | 9 | 3 |
| Adaptive run | 10 | 4 |
| Adaptive run requiring terminal reconciliation | 12 | 6 |
| Legacy run without saved nodes | 9 | 4 |

The new-plan form continues to reread current templates, history, conversations,
experiments and comparisons on every entry. Existing creation/removal guards,
detail ownership/view guards, error propagation, audit integrity, terminal
reconciliation and approval bindings remain active. This patch changes no
writes, retries, timeouts, fixture pacing, server rate limit, native acceptance
budget, SSE transport, trace storage/cursors, or app live-audit assignment.

## Verification

Executed on 2026-10-05, against compiled production modules with isolated
transport doubles, plus in-process backend requests:

- The initial 23 route-renderer cases run on frozen baseline JS produced six
  failures, each demonstrating the unnecessary detail read batch; 17 passed
- All 25 final route-renderer cases pass, covering exact read sets, rendered
  approval/graph/audit data, fresh creation inputs and selected experiments,
  inaccessible selections, explicit required-read errors, legacy graph fallback,
  completion reconciliation, and delayed responses after navigation/identity changes
- Full frontend suite: 985 passed
- Backend positive/adverse selection: 199 passed across security, export/auth
  races, integer/SSE cursor bounds, fixture budgeting, workspace API and adaptive
  runtime tests; one existing Starlette TestClient deprecation warning
- TypeScript no-emit check and build, Python compilation, source guard and
  `git diff --check` passed

No new listener, local HTTP server, browser, external network service or paid
provider was used. Native 21-report completion, rendered screenshots and the
real HTTP/SSE/restart/backup chain were not rerun in this isolated patch task.
The request reductions above are module evidence, not a new native L10 pass.
