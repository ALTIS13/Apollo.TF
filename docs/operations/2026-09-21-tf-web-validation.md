# TF web validation repair

Owner: Apollo.TF. Stage: source candidate verified; independent review pending.
Base: `684408e0bf80b2c64425b1d2b760799f710f9042`.
Checkout: `.worktrees/tf-web-validation`, branch `codex/tf-web-validation`.
Source: root brief `2026-09-21-tf-web-validation-owner.md`; synthetic diagnostic
SHA-256 `9856b143bac22aba0fd6742edfe576a88a4b3e1ddecda9574e2c12aa47d1e6ba`.
Root RED: 64 failures / 154 passes / one unhandled rejection in the exact
metadata-free base archive. The 11 unaffected files and prior API/archive
proofs are not repeated. No runtime/publication authority is delegated.

## Cause map

| Affected tests | Traced cause / bounded correction |
| --- | --- |
| auth, protected runtime, stale integration, collection | Year-2099 sessions overflow the auth deadline timer. Use valid five-minute fixture lifetimes; do not alter real system time or expiry enforcement. |
| websocket, session client | Repeated 43-character tickets do not encode canonical 32-byte base64url values. Supply valid synthetic tickets, preserving malformed-ticket rejection. |
| session client, migration | Protected requests now require a committed active session before CSRF handling. Establish authorization for transport tests; keep pre-session denial tests and current machine codes. Dependency unavailability suspends rather than automatically policy-revalidates. |
| protected runtime | Full WebSocket mock omitted the recovery-budget export; Audio omitted load(); fake stop() counted repeated idempotent cleanup as fresh transitions. Preserve real exports, implement the missing media method and count lifecycle transitions. |
| auth, protected runtime | Older expectations assumed every suspension unmounts or clears everything immediately. Current dependency suspension retains hidden state, stops audio/socket and blocks requests; explicit retry must revalidate. Missing search capability locks the player but does not revoke unrelated downloads. Account replacement still clears old cache before mounting B. |
| stale integration | Unmanaged /auth/me uses forbidden/authentication_unavailable, not protected-route policy codes. Stale malformed/session/transport responses still cannot mutate account B or emit auth events. |
| migration | Current localized UI, auth context and generated-request expression differ from legacy fixtures. Query real accessible behavior without changing UI. |
| auth | Attach the expected TanStack cancellation consumer before policy events. Duplicate errors now carry the real captured security generation and are rejected after suspension; no unhandled rejection is suppressed. |
| browser renewal | The old case advanced to 251s, starting automatic retry with the still-pending transport fixture. Stop at the actual 250s timeout, await deliberate refresh, then verify a late old response cannot issue more requests or replace recovery. |

No production defect was established; zero production changes. No tests were
removed or skipped, and all 113 affected cases remain. No budget, auth guard,
expiry check, capability, real clock, dependency or UI change.

## Validation

Local environment: Windows, Node24.15.0, pnpm10.33.2, locked Vitest4.1.10.
The offline frozen filtered install reused326packages, downloaded0, and ran
no lifecycle scripts. No package/lockfile changed.

- Representative local RED before fixture edits: websocket/session-client
  groups27failed/14passed, exit1. Canonical-ticket and committed-session
  failures matched root's diagnostic.
- Focused intermediate groups established expiry/mock/UI and recovery fixes;
  the incomplete Audio fake surfaced five unhandled load() errors, then these
  disappeared after implementing the required fake media API. This was not
  handled by swallowing exceptions.
- Final affected-only batch at15:45:55UTC:8files/113passed,0failed, no unhandled
  errors, exit0,7.37seconds:

```text
pnpm --filter @workspace/music-player exec vitest run src/auth/tf-browser-renewal.integration.test.tsx src/lib/tf-websocket.test.ts src/auth/tf-auth.test.tsx src/auth/tf-protected-runtime.test.tsx src/lib/tf-api-migration.test.ts src/hooks/use-liked-collection.test.tsx src/lib/tf-session-client.test.ts src/auth/tf-session-stale-integration.test.tsx --maxWorkers=2 --reporter=dot
```

- Package typecheck initially required the referenced API client declarations.
  `pnpm exec tsc -b lib/api-client-react`, followed by
  `pnpm --filter @workspace/music-player run typecheck`: both exit0.
  Generated declaration outputs remain ignored; no generated source changed.
- `git diff --check`: clean. Scope: exactly the eight named test files and this
  journal, no shared fixtures or production files.

The root's Linux Node24.21.0 metadata-free archive check remains independent
and pending. This Windows source evidence is not a release or live proof.
The11unaffected web files, previous API/WS/archive proofs and release gates
were not rerun.

## Resume

Blocker: none. Next: root independent review and affected native checks of
the clean candidate. A-D release identifiers remain consumed; no prepare/deploy,
SSH, Docker, credentials, GitHub, publisher changes or new agents.
