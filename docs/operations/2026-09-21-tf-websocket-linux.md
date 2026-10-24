# TF WebSocket Linux completion ordering - 2026-09-21

## Resume record

- Owner: Apollo.TF `019ef2c2-95cb-7d01-9951-aa0abfe25d37`.
- Stage: TF-WEBSOCKET-LINUX-20260921, CANDIDATE_READY.
- Branch/worktree: `codex/tf-websocket-linux` at
  `D:/CodexProjects/Apollo.TF/.worktrees/tf-websocket-linux`.
- Clean base: `56ca3a825726cfbb85da4a3e3a7fc5195bbcfa69`.
- Authority: root brief
  `D:/CodexProjects/Apollo.Platform/docs/handoff/2026-09-21-tf-websocket-linux-owner.md`.
- Scope: `artifacts/api-server/src/ws.test.ts` and this journal. Production
  WebSocket/startup behavior is unchanged; no production defect established.
- Blocker: none for fixture correction. Root owns independent/native acceptance.
- Next: root independently reviews this candidate, then verifies the affected
  native Linux cases. Keep diagnostics f111d454 frozen; do not compose locally.

## Cause and ownership (recorded before editing)

Root's native RED: exact base56ca3a82, Node24.21.0/pnpm10.33.2/Linux, isolated CI;
TF API at14:48:22UTC: 785 passed / 8 failed / 11 skipped,65.65seconds. Seven
ws.test.ts failures showed correct close codes but uncleared server schedulers,
or correct server destruction/timer/listener cleanup with the client still OPEN.
The eighth missing-Vite case belongs to filtered diagnostic dependencies, not
this source finding. Scripts301/Platform429 and prior9fixture checks are closed.
This is current native evidence, not proof of historical prepare B's exact stage.

Source tracing confirms distinct event boundaries:

- `ws.ts:validateConnected` removes authorization/room membership before calling
  `ws.close(4403|1013)`. CLOSING/unauthorized sockets cannot relay. The server-side
  `onSocketClose` performs `cleanupSocket`, including scheduler.clearInterval.
- Installed `ws/lib/websocket.js:close` begins a handshake and sets local CLOSING;
  `socketOnClose` waits for that socket's receiver completion before emitClose.
  Client and server emitClose handlers are separate; one does not await the other.
- `ws.ts:close` destroys pending sockets, cleans and terminates active server
  sockets, detaches upgrade listeners and awaits its WebSocketServer.close.
  `server-startup.ts:initializeApiRuntime` awaits this before resource cleanup.
  That server guarantee cannot synchronously update a remote client's state.

The old tests equated peer completion with local disposal (six cases) and server
shutdown with peer completion (one case). This is fixture synchronization debt,
not evidence to move/relax production cleanup or revocation. Existing raw-peer
revocation tests already exercise no-relay while the handshake remains incomplete.

## Narrow correction and proof plan

The manual scheduler emits a test-only event after an actual clearInterval.
Arm its one-shot observer before triggering policy validation; await it separately
from the client close event before asserting scheduler size. Do not call handle.close
to make this assertion pass: it would conceal missing per-socket cleanup.

The startup test keeps server destruction, timer count and listener count in the
resource-cleanup snapshot. Independently arm/await the active client's close event
and retain the exact CLOSED assertion. It no longer asserts a cross-peer ordering
that the server cannot guarantee. No sleeps, polling, timeout widening, platform
skips or production/test hooks are added.

Native RED is reused from the exact-source root brief. Local unchanged baseline
at17:51:30MSK: 7 passed / 19 filtered,519ms; do not loop until a race appears or
manufacture another test of the fixture. The changed tests will be verified once
with related connected-lifecycle checks; root owns the subsequent native proof.

Dependencies linked offline/frozen/ignore-scripts:255reused,0downloads. No lock or
manifest change. No SSH/Docker/registry, real credentials, prepare/release IDs,
deployment or new agents. Consumed A/B and both reserved publishers are untouched.

## Completed evidence

- Local GREEN at17:53:40MSK: 14 passed / 0 failed / 12 filtered,1.37seconds.
  Existing connected lifecycle and startup orchestration cases only; no new
  test-of-fixture, repeated suite or artificial transport event reordering.
  Real loopback sockets observe their own completion events. The existing
  malformed-frame scenario logs its expected generic socket_error warning.
- Kept close4403/1013, exact revoked CLOSED and healthy OPEN states, scheduler
  sizes0/1, and the cleanup-time snapshot of2destroyed server sockets/0timers/
  0upgrade listeners. Existing raw-peer no-relay and idempotent shutdown checks
  also passed. No handle.close call masks the per-socket timer assertion.
- Initial API typecheck failed on missing referenced dist declarations (TS6305
  and downstream inferred-type errors) in the fresh worktree. Building the seven
  existing referenced TypeScript projects resolved that setup prerequisite;
  subsequent `pnpm --filter @workspace/api-server typecheck` exited0.
- `git diff --check`: exit0. Only ws.test.ts and this journal changed; production
  ws.ts/server-startup.ts, manifests, lockfile, deployment tests and publishers
  are unchanged. Native Linux GREEN is not claimed here.

```text
pnpm --filter @workspace/api-server exec vitest run src/ws.test.ts -t 'connected WebSocket lifecycle|API startup WebSocket orchestration' --maxWorkers=1
pnpm exec tsc -b lib/module-runtime-contract lib/tf-search-contract lib/tf-integrations-contract lib/admin-dashboard-contract lib/db lib/platform-contract lib/api-zod
pnpm --filter @workspace/api-server typecheck
```

No timing budget was widened. Awaiting actual clearInterval is intentionally
separate from receiving the close code; both are required. Client CLOSED moved
out of the server cleanup snapshot, not out of the test: an observer armed before
startup failure now proves peer completion without assuming cross-peer ordering.
