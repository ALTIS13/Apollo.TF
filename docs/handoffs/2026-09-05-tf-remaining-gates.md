# TF remaining gates

Date: 2026-09-05. Source checkpoint: `700ed3e9e7d88cc9e6bc8fdb6144fd3beb4873e4`.
Read-only reconciliation plus documentation; no new implementation or test run.

## Closed source work: do not repeat

- Liked collection API and UI are implemented and locally validated. Their
  remaining gate is real persistence/full-stack evidence, not another UI rewrite.
- Single canonical queue, keyboard/touch queue actions (`9745291`), responsive
  footer (`97851c8`) and native footer Space actions (`700ed3e`) are root-accepted
  after independent source review. UI remains local, unpushed and undeployed.
- Admin parser/version/status and account/connection overview, plus default
  demo/preview rejection, already exist. Do not recreate them. Historical focused
  evidence is in IMPLEMENTATION_STATUS; it is not current production verification.

## Independent source-only remainder

The approved [client design](../superpowers/specs/2026-07-15-apollo-portal-tf-client-design.md)
still has these concrete gaps in this checkout:

| Item | Current evidence | Boundary for a subsequent scoped task |
| --- | --- | --- |
| Compact search-first screen | `Home.tsx` still renders `Find any track` with `py-20 sm:py-32` hero spacing | Client composition only, retain search/result contracts and accepted visual style; obtain a bounded visual scope before edits |
| Integrations outside Favorites | `Favorites.tsx` still owns Spotify/Yandex connect/disconnect UI; App has no settings/integrations route | TF navigation/presentation using existing hooks; do not create account identity/settings authority or change provider auth |
| Admin visual acceptance | Parser/account checkpoint explicitly lacks browser visual smoke | Fixture-based rendering of existing states only; not proof of live provider/accounts data and not a repeat of backend suites |

No further reproducible player defect was investigated in this handoff. Do not
invent a new micro-fix merely while waiting for runtime gates. Native Apollo
playlists/history are mentioned in the broad client design, but only liked CRUD
is delivered by `collections.ts`; provider playlists and `play_history` storage
are not equivalent. Those are separate, unclosed product scopes, not authorized
new implementation here and not prerequisites to rerun the liked proof.

## Real PG17 and full-stack gates

1. Root creates a **separate disposable Coolify Application** for the frozen
   private proof source `a59d3be8de0b8358bd1f4a93583ca77c127b58fb`. Never use the
   Supabase/account database, its credentials, volumes or Application.
2. Pin the approved PG17 image digest, source/digest and unique run identity;
   supply three private role secrets and explicit `execute:<runId>` gate.
   Build and run the unchanged migrator/official runner. Required outcome:
   **3 passed, 0 skipped, exit 0**, with redacted provenance-bound evidence.
3. Export evidence before disposal and verify cleanup of only the owned proof
   resource. Source review/configuration checks are not substitutes for this run.
4. Against an approved TF backend, verify liked persistence/account isolation and
   browser save/list/delete, then actual provider search/full-track playback and
   media-job behavior. HTTP/Audio fixtures do not prove these outcomes.

## Platform Auth and cross-project gates

- Root/Web Platform owns real Supabase session/liveness and TF-compatible
  assertion/introspection cutover. TF consumes decisions; no new login, identity
  table access, installation issuer or policy authority is introduced.
- The August integration document still says **Proposed** and its plan has an
  ownership gate. System-level ownership approval is not acceptance of every
  proposed DTO/endpoint. Reconcile with the authoritative Platform repository
  before implementing its tasks; do not implement its historical Platform paths
  again inside TF.
- Unified module decisions, bounded TF status publication, one-time launch and
  deep-link exchange, and module-release admission distinct from media downloads
  require exact owner-issued contracts/fixtures and later real cross-project
  verification. They are not completed by the current legacy TF-cookie flow.
- Final TF release source selection, merge/push, image publication, deployment,
  migration/rollback and live smoke are separately approved root-owned gates.
  Preserve other HomeNode services. Android, billing and GitHub Actions stay out.

## Next decision

Prioritize the isolated TF PG17 Application when root is ready. A compact
search-screen scope or existing admin visual smoke can proceed independently
after root selects it; neither should change the frozen proof or auth boundary.
