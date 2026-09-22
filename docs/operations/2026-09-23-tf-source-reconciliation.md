# TF F-to-successor source reconciliation

Status: source-only. No release selection, publication, deploy, provider login, or live runtime acceptance.

## Frozen and accepted checkpoints

| Checkpoint | Source contents | Release meaning |
| --- | --- | --- |
| F `d14e08d3` | Prepared TF web/API/admin/parser and the compact client (`31de0c6` is an ancestor). Common Apollo login, entitled search/play/liked collection, existing admin topology/module/provider/parser/account surfaces. | F preparation succeeded, but first runtime has not been observed. F is closed and must not be replayed or edited. |
| `85f67b6` successor (`094448e`, `7df3dda`) | Spotify confidential Basic exchange/refresh, truthful failure of `liked-all`, correct pagination offset after filtering. | Source accepted, not in F or released. |
| `aed21b0` successor (`5751e22`) | Rejects legacy Deezer preview/cache substitution when a full track cannot be resolved. | Source accepted, not in F or released. |
| `3b68aaa` successor (`435f5bb`) | Invalid-grant expiration handling with generation/envelope-guarded credential removal; provider reconnect state without logging out the Apollo account. | Source accepted, not in F or released. |
| This branch | Production HTTP admin starts without a demo snapshot; development demo remains unchanged. | Source candidate only; requires independent review and later release selection. |

The admin dashboard UI itself is **not** a successor-only source change: `artifacts/admin-dashboard` has no F-to-`3b68aaa` diff. The later dashboard handoff describes evidence and remaining runtime obligations, not a new admin UI release.

## Current source boundary

- TF owns its search, parser completeness/preview rejection, player, collections, provider credentials/status, admin presentation, and TF runtime/API. Existing parser checks and the dashboard tables are not missing features to reimplement.
- Platform owns the common account/session authority boundary and entitlement/policy admission. TF must consume Platform decisions; it must not mint a second login, duplicate identity/entitlement tables, or infer module access from a downloaded client. Admin accounts/connections need the Platform overview and integrations connection contracts, not mock healthy rows.
- GAP owns managed networking subscriptions, routing, nodes and telemetry; TF must not mirror that authority.
- F's first runtime obligations and the exact operator sequence remain in `docs/operations/2026-09-21-tf-first-runtime-handoff.md` in the accepted handoff worktree. Root's current status is `Apollo.Platform/docs/operations/2026-09-08-unified-resume.md` and `2026-09-23-tf-presecret-b-native-attempt.md`: F closed/no replay; B consumed/no replay after one zero-stdin nonsecret invocation (supervisor exit 79, claim `4f23d27f`, proof `6f609c55`, `PRE_READY_FAILURE/HANDSHAKE/STATUS_EOF`, no READY or terminal, `cleanupComplete=false`); Spotify/direct-preview successors source accepted/not released. B is outcome-unknown, not publication or cleanup acceptance.

## New narrow source change

`createHttpDashboardSnapshotAdapter()` previously supplied `demoSnapshot` as its default `initialSnapshot`. On a production HTTP failure, the dashboard could retain fabricated module versions, incidents, provider and account statuses even while the connection marker said offline. The HTTP adapter now has no initial snapshot unless a caller explicitly supplies one. The existing hook already loads on mount, shows an empty state until a verified response, and retains only a successful last-known-good response as stale. The development-only demo adapter remains unchanged.

This does not prove real dashboard data is available. `admin` still needs an authenticated live API and Platform-backed account/connection data. No Platform Auth/API, release metadata, private carrier, or HomeNode state was changed.

## Next handoff

1. Independently review this branch's two-file behavior change and focused test. Do not absorb it into the frozen F artifact.
2. Root must first diagnose B's `HANDSHAKE/STATUS_EOF` source-only; A and B must not be replayed. Only a justified, separately reviewed fresh operation may reopen the publication gate. Validate F's first runtime per the accepted handoff only after that gate actually succeeds; this branch does not alter it or authorize publication.
3. After first runtime, choose a new successor release explicitly containing the accepted Spotify, preview, expiry, and this admin truthfulness change. Validate provider `/v1/me`, playlist schema, rate-limit and ID durability, and the four expiry obligations against real PostgreSQL/provider sessions. Source tests alone do not close those items.
