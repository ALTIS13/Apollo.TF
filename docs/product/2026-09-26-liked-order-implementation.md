# TF manual liked order handoff

Owner: Apollo.TF source. Status: candidate only; no push, Coolify or HomeNode change.

- `GET /collections/liked` keeps its newest-first cursor/DTO. Opt-in `sort=manual` returns `revision` and a cursor bound to that revision; stale pages return `409 liked_order_conflict`.
- `PATCH /collections/liked/order` moves a track before an account-owned anchor (or to the end) under a locked account revision. New likes start at the top. Metadata updates, absent deletes and no-op moves do not advance the revision. The account comes only from the verified TF principal and still requires live `tf.collections`.
- Migration 0004 backfills positions from existing IDs, adds a deferrable per-account position constraint and revision table, and normalizes ownership of the earlier lyrics feedback table/sequence on the legacy-baseline path. Existing migration checksums are unchanged. The backfill/index take a table lock: inspect target size and schedule a compatible rollout with API/web and an approved rollback plan.
- The player uses persisted order and accessible up/down controls across loaded pages. It blocks downward moves that need an unloaded next page. Existing Apollo playlist order is unchanged; Spotify/Yandex remain metadata inputs only.

## Validation boundary

- API/policy tests, migration manifest tests and player interaction tests pass; affected TypeScript projects typecheck.
- Local marked PostgreSQL 16.15 accepted migrations 0001-0004. Runtime operations proved owner isolation, page order, revision conflict, metadata no-op and delete; targeted migration integration proved owner/privilege and legacy-baseline behavior. The test DB was dropped and local PG stopped.
- Fixture-backed Playwright at 1280 x 800 and 390 x 844 showed the move `Second` above `First` and no document/list-row overflow. Browser plugin was not callable in this task. Screenshots are outside Git under `C:\Users\maksi\.codex\tmp\tf-liked-order-*-final.png`.
- PG17, authenticated Platform session, real cross-device clients, Coolify deployment and physical-phone touch remain unverified. Root owns the isolated canary and release decision.
