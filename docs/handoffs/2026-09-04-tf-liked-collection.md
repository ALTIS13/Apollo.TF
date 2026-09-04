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
- The 2026-09-05 UI continuation below wires these behaviors into music-player.
  Legacy device/session-owned favorites are not migrated.
  This slice saves metadata, not audio or a guarantee of full-track availability.
- Storage failures use the existing sanitized API error handler. No new DB,
  migration, container, Supabase, Platform runtime or production changes.
- Follow-up after review: isolated PostgreSQL two-account upsert/list/delete
  proof, then separately approved TF UI wiring. No next feature slice started.

## Visual coordination for future TF UI

Source: the coordinating agent's live visual review on 2026-09-04, reported
to this task. It inspected authenticated Chrome renders at
`https://ai.apollot.ru/` and `/models`, plus the installed
`C:\Program Files\Apollo Quasar\apollo-quasar-desktop.exe` network overview.
This task did not independently repeat those observations.

- AI uses a narrow icon rail, restrained violet illumination near the top,
  a heading with short supporting text, compact inline status chips and wide
  functional panels. Its overview combines GPU panels, a chart and a dense
  model list; its catalogue uses wide search, compact filters and a table.
- Quasar uses an icon-and-label rail, visible `Quasar | Overview` context in
  its chrome, a separate work surface, one summary strip, a primary violet
  action panel and quieter supporting panels/log. Rounded edges, thin light
  borders, local shadows and depth are visible in the installed render.
- Preserve soft glass/material hierarchy and moderate product differences.
  Do not force identical rail widths across products or give every runtime
  category the same color. Adapt context titles to each surface; the Quasar
  separator does not justify adding duplicate chrome to AI or TF.
- Before accepting the first representative TF UI page, compare it side by
  side with these live references in normal, empty, error and stale states.
  Matching CSS tokens alone is not visual acceptance.
- Operational numbers and statuses from the reference must not become TF demo
  data. Quasar showed zeros where measurements were absent and differing
  runtime indicators; newer source fixes may not be in the installed build.
  These observations establish appearance, not network health or authority.

The API slice remains complete at `57fe6d6`. This coordination update adds no
UI work, AI/Quasar refactor, runtime change or deployment.

## Account infrastructure priority update

The coordinating agent reports the user's new priority: self-hosted Supabase
on HomeNode and connecting the Apollo account system to it. Apollo Web Platform
owns this work and the Supabase-to-Platform adapter.

Reported read-only HomeNode baseline: existing GoTrue with PostgreSQL 18,
healthy, zero users/sessions, signup disabled, Quasar issuer. These are the
coordinator's observations, not a fresh check by TF or evidence that the TF
account integration is complete.

- Preserve the current TF API and login/session behavior. Do not create a new
  TF identity/session authority or perform auth cutover in this task.
- Future TF UI/API integration consumes the owner's compatible Platform
  contract backed by its Supabase adapter. No direct identity-table access or
  client `service_role`; Platform retains entitlement and policy authority.
- The two-account isolated PostgreSQL collection proof and account-scoped UI
  cache remain outstanding TF follow-ups. They do not authorize HomeNode
  changes or supersede the Platform-owned integration gate.
- Claude-owned AI/Quasar remain read-only; no implementation work is started
  there. This update only records coordination for the completed API slice.

## UI continuation (2026-09-05)

The coordinator authorized independent product work while Web Platform owns
Supabase integration. Existing music-player Favorites now defaults to an Apollo
collection alongside its unchanged provider catalogue tabs. `use-liked-collection`
uses `['tf', 'liked', accountId]`, cancellation signals, generated API clients
with current cookie/CSRF via `tfRequestInit`, and account-only invalidation after
save/delete. Existing `TfAuthProvider`
already cancels/clears queries on refresh, account switch and logout; no replacement
auth provider is added. Late mutation callbacks cannot invalidate a different
account and never write response data directly into cache. Auth errors are
forwarded only while the original session object/account remains active; a late
401 from an old mutation cannot invalidate the replacement session. Successful
mutations still invalidate their captured account key after navigation unmounts
the originating hook, without inserting cache data or affecting another account.

Search/recommendation TrackCard instances receive a save action; the base card
and download behavior remain reusable. The collection has compact rows, player
actions, deletion, cursor pagination, refresh, empty/loading/error/stale states
and reduced-motion handling. Provider status requests are deferred until their
tab is selected so Apollo collection access does not require provider integration.

Local evidence:

- Hook transport/invalidation, account switch/logout, late canceled response,
  cursor pagination, late old-session mutation 401 and save completion after
  navigation: six passed. The last two regressions reproduced replacement-account
  logout and stale collection after navigation before their respective fixes.
  Independent review has no remaining concrete finding after the navigation fix.
- Existing Yandex disconnected case: one passed, twelve unrelated cases skipped.
- Final music-player typecheck and build: exit 0. Build reports tooltip sourcemap
  and chunk-size warnings above 500 kB; no broad build optimization was attempted.
- Browser plugin unavailable; regular Playwright used installed Chrome against
  local Vite at `http://127.0.0.1:4191/favorites` with isolated HTTP fixtures.
  Search/save/list/refresh-error/retry/delete passed with CSRF and no owner in
  payload. Fixtures and screenshots are outside source, not product demo data.
- Screenshots: `C:\Users\maksi\.codex\tmp\tf-liked-ui-evidence\` contains
  loading-desktop, empty-desktop, normal-desktop, stale-desktop, normal-mobile
  and error-mobile PNGs. Viewports 1440x900 and 390x844; zero page errors and no
  mobile horizontal document overflow.
- Compared rendered collection against the saved `apollo-portal-selected-v1.png`
  composition and the coordinator's `PORTAL_VISUAL_REFERENCE.md` live-composition
  section. Preserved graphite surfaces, quiet violet actions and compact rows;
  existing TF sidebar/player differences remain intentional within this slice.
  The saved portal image is not current AI/Quasar live evidence. Their live PNGs
  were unavailable; full side-by-side acceptance is not claimed or a blocker
  for the locally verified flow, as directed by the coordinator.

Outstanding integration evidence:

- `8756bca` pins the real-store proof to coordinator-selected PostgreSQL 17,
  superseding the initial PG18 target; TF SQL needs no PG18-specific feature.
  Runner/role/database marker instructions are in
  `docs/operations/tf-liked-collection-postgres-proof.md`. Expected: three passed,
  zero skipped. Infra is preparing a disposable Coolify Application; no real DB
  result has been returned yet. Local Docker stayed off.
- Browser fixtures prove rendering/transport, not deployed persistence, provider
  availability, actual audio streaming or Supabase-to-Platform integration.
- All permanent components and proof containers must be Coolify Applications,
  reproducible from Git/Compose. Secrets/private environment are excluded from Git;
  volume backup/restore and key custody are separate requirements, not automatic HA.
