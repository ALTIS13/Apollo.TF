# Spotify invalid_grant source correction

Owner: TF. Stage: source-only candidate ready for root-assigned review.
Branch: `codex/tf-spotify-refresh-expiry`.
Base: `aed21b0450de7a4b3e2ed8f052a502f3bfbd2939`.
Source commit: `435f5bb15590e4d80e7a90541a8d443e02e66910`.
Input: Platform's sanitized `2026-09-21-tf-spotify-dashboard-handoff.md`.
Blocker for live acceptance: root-owned credentials and runtime readiness.
Next action: review this candidate; do not prepare, publish or deploy it yet.

## Trace and correction

- `providers/spotify.ts:702`: refresh HTTP 400 previously discarded its body
  and became generic `provider_rejected`. Now the existing bounded, abort-aware
  JSON reader recognizes only the exact `invalid_grant` error on refresh, not
  code exchange or other provider calls. No body/description escapes the adapter.
- `service.ts:566`: previously the rejected credential stayed stored. The
  terminal refresh classification now deletes only the loaded provider record,
  then returns the existing `not_connected` machine code. Subsequent commands
  after successful cleanup stop before provider I/O; status reports disconnected.
- `lib/tf-integrations-db/src/repository.ts:575`: deletion optionally compares
  both generation and encrypted envelope in the same parameterized DELETE.
  This preserves a concurrent reconnect or a newer successful refresh with the
  same generation. Existing explicit disconnect semantics remain unchanged.
  Existing transaction/deadline checks are retained; no migration is needed.
- API `routes/spotify.ts:145` is unchanged: `not_connected` maps to the existing
  `401 {error: "not_connected"}` on library routes; `/spotify/status` returns
  the existing connected/disconnected shape. No new public DTO/code is needed.
- Player `tf-session-client.ts:261` now classifies this exact library response
  as a local provider error, not an Apollo authentication failure. Other paths,
  ordinary unauthorized responses and the renewal profile remain fail-closed.
- Player `use-spotify.ts:9` revalidates the existing provider-status query and
  stops retrying the rejected library request. Existing Favorites/Integrations
  UI offers the same Spotify authorization link without an Apollo logout.

TF source paths above are under `artifacts/tf-integrations/src`; API under
`artifacts/api-server/src`; player under `artifacts/music-player/src`.

## Focused evidence

RED before implementation: service 4 failed / 3 passed, conditional repository
delete 2 failed, actual App component navigation 1 failed with "Login required".

GREEN, no full suites:

| Scope | Selection | Result |
| --- | --- | --- |
| Integrations `service.test.ts` | `invalid_grant\|non-terminal refresh` | 7 passed, 16 skipped |
| Repository `repository.test.ts` | `conditionally deletes only invalid_grant` | 2 passed, 14 skipped |
| Player `ClientNavigation.test.tsx` + `tf-session-client.test.ts` | `invalid_grant\|does not treat` | 4 passed, 27 skipped |
| Integrations compatibility | signed-account disconnect, cancellation/deadline, exact mutation context | 3 passed, 20 skipped |
| Repository compatibility | existing account-provider disconnect | 1 passed, 15 skipped |

The service cases use the real Spotify adapter with synthetic Responses and an
in-memory repository: successful cleanup, subsequent no-refresh, false status,
other account/provider isolation, rejection sanitization, non-terminal errors,
concurrent reconnect/refresh and honest storage failure. The repository double
checks SQL/parameters and affected-row handling, not real PostgreSQL behavior.
The App test uses real auth/hooks/components with synthetic fetch, not live OAuth.
It proves refreshed disconnected UI, one library request, one Apollo session
fetch, no logout, and the existing provider reauthorization link.

Scoped TypeScript passed for changed integrations/repository roots and changed
player roots (with existing test/Vite ambient declarations). `git diff --check`
passed. Offline frozen-lockfile dependency linking reused 413 packages, downloaded
zero, ignored scripts; no manifest/lockfile changes.

## Boundaries and remaining proof

Status remains a storage projection, not a proactive provider-validity probe.
If cleanup cannot persist, the service reports `storage_unavailable`; it does
not falsely claim disconnection or guarantee no later refresh against that row.
Already in-flight requests are not globally serialized by this correction.

Frozen DTOs, scopes, Basic authentication, endpoint allowlists, callback rules,
Platform authority, migrations, credentials and deployment inputs are unchanged.
No PDFs/private credentials, provider HTTP, native work, runtime activation,
release preparation, push, deploy or subagents. Root coordination docs untouched.
F/publisher refs remain `d14e08d3dba275b0f4ce10525257a1c233aafff5`.

Real database concurrency, current Spotify configuration/allowlist, replacement
credentials and real-account OAuth acceptance remain root-owned live proof.
Rollback before activation is simply not selecting this source candidate; no
deployed state or schema was changed by this task.
