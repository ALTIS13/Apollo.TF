# TF remaining gates

Date: 2026-09-05. Source checkpoint: `700ed3e9e7d88cc9e6bc8fdb6144fd3beb4873e4`.
Read-only reconciliation plus documentation; no new implementation or test run.

## Closed source work: do not repeat

- Liked collection API and UI are implemented and locally validated. Root has
  now accepted the real PG17 store proof below; HTTP/UI integration remains open.
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
new implementation here and not reasons to rerun the accepted liked-store proof.

## Real PG17 and full-stack gates

Root-reported accepted evidence (not independently rerun by TF):

- Corrected private source `cc364d176d205c27930f87efc6d4e9c45ee7530f`, digest
  `a5e652d07acd48f6ae2472e899b5c943946ad160af15e5ec8fb01b3250209db1`.
- Separate Application `dl50veios5706uj33h8itja8`, run `tf20260905_28f286c2`;
  runtime deployment `xhu38arvsjohvb9i08xqwv5z`.
- PG17.6 healthy, two migrations applied, migration exit 0; all three unchanged
  official tests **passed, 0 skipped, proof exit 0, accepted true**.
- Proof transcript SHA-256:
  `0b625c863d2ef17f930bf3a7203505fe93fbf09ac153fbe9790c9db7e6acb6ff`.
- Root checked build/source/effective Compose isolation and retained redacted
  evidence. Application deletion initiated; **cleanup verification still pending**.

This closes real liked-store PG17 correctness, not HTTP/UI/audio or Platform
cutover. Against an approved TF backend, the remaining integration check is the
real authenticated browser save/list/delete path and its account/policy boundary.
Provider search/full-track playback and media jobs still need live validation;
HTTP/Audio fixtures are not evidence for those outcomes. Do not use account DB
credentials/volumes for TF verification or repeat the accepted store suite.

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

1. Root confirms scoped cleanup; TF makes no cleanup or runtime call.
2. When root provides an approved TF backend/session, close the real liked
   HTTP/UI flow. Reuse accepted store code; no new identity or PG proof harness.
3. Independently, root can select the missing admin visual smoke, then compact
   search-first composition and integrations navigation from the existing design.
4. Real provider/audio/media-job validation and unified Platform contracts remain
   separate scoped runtime/ownership gates, not consequences of store success.

No new code, tests, publication or deployment is authorized by this handoff;
wait for root's next selected slice. Accepted local UI checkpoints remain frozen.
