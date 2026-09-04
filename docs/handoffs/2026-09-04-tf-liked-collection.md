# TF liked collection API handoff

Date: 2026-09-04. State: locally validated, not deployed.
Branch: `codex/tf-product-finish`, base `073613d`.
Worktree: `C:\Users\maksi\Desktop\Apollo.TF\.worktrees\tf-product-finish`.

## Delivered behavior

| Endpoint | Behavior |
| --- | --- |
| GET `/api/collections/liked` | Descending storage ID; default 50, max 100; opaque `cursor`; `{items, nextCursor}` |
| PUT `/api/collections/liked/:trackId` | Upsert bounded artist/title and optional thumbnail/duration; returns `{item}` with status 200 |
| DELETE `/api/collections/liked/:trackId` | Account-scoped deletion; idempotent status 204 |

Track IDs use existing `yt_`, `sc_`, `bc_`, `dz_` prefixes. Repeated PUT keeps
the original `likedAt`; omitted optional metadata is cleared as part of full
replacement. Unknown request fields are rejected. Legacy nullable artist/title
remain null on reads. The cursor is a position, never an authorization token.

## Authority and account isolation

- Existing `requireTfCapability` protects all collection endpoints with live
  `tf.collections` introspection. Missing auth configuration fails closed.
  TF issues no entitlement, identity or installation ID.
- Owner is `request.tfPrincipal.accountId`. Client-supplied account fields
  cannot choose an owner. Legacy SQL column `session_id` stores that account ID,
  matching existing TF play-history compatibility behavior.
- SELECT always filters `session_id = accountId`; paginated SELECT combines
  that predicate with `id < cursorId`, using AND.
- INSERT binds the account ID. Conflict target is `(session_id, track_id)`,
  matching migration `0001_tf_core_collections.sql`. UPDATE changes only
  metadata; it cannot overwrite the owner or original `liked_at`.
- DELETE combines both `session_id = accountId` and `track_id = trackId`.
  Identical track IDs in different accounts are therefore independent.
- Account isolation is enforced by API policy plus SQL predicates. This slice
  adds neither organization tenancy nor database RLS; it must not be presented
  as proof of either. No identity tables or Platform-owned data are queried.

## Validation evidence

- Earlier focused route/policy run: 45/45 passed across collections,
  policy-coverage and tf-policy. Kept without repeating on resume.
- Final collection Zod test: 3/3 passed. Regression exposed Orval Date-vs-JSON
  mismatch; generation now preserves timestamp strings, integer constraints,
  strict collection objects and trimmed artist/title. Unrelated generated
  endpoint definitions are unchanged.
- `pnpm --filter @workspace/api-spec codegen`: exit 0.
- `pnpm exec tsc -b lib/api-zod lib/api-client-react`: exit 0.
- `pnpm --filter @workspace/api-server typecheck`: exit 0.
- `git diff --check`: exit 0.
- SQL isolation was reviewed in the actual store and existing migration;
  route tests use an injected store. No PostgreSQL two-account execution,
  production build, deployment or browser integration was performed.

## Consumer requirements and remaining limits

- Existing TF-cookie login stays in force until Platform exposes an approved
  compatible cutover contract. This API does not implement unified-login cutover.
- Browser PUT/DELETE require the existing allowed Origin, session cookie and
  matching CSRF cookie/header. Pass credentials and `X-CSRF-Token` through the
  generated client's request options; no new browser auth mechanism is added.
- React Query consumers must scope query keys to the active account or clear
  collection cache on account switch/logout; generated default keys contain
  only endpoint and pagination. Invalidate affected pages after mutations.
- Client UI is not wired. Legacy device/session-owned favorites are not migrated.
  This slice saves metadata, not audio or a guarantee of full-track availability.
- Storage failures use the existing sanitized API error handler. No new DB,
  migration, container, Supabase, Platform runtime or production changes.
- Follow-up after review: isolated PostgreSQL two-account upsert/list/delete
  proof, then separately approved TF UI wiring. No next feature slice started.
