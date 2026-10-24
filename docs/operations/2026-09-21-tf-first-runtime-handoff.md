# TF first runtime: root-only deployment handoff

Owner TF; stage **SOURCE_COMPLETE / FIRST_RUNTIME_PENDING** for the assigned
source fixes. Latest root-accepted source is
**3b68aaa2afe9818badaefc03de10a94e7ca6917b**, not a release/runtime acceptance.
This existing document alone remains new/uncommitted. No publisher/app/Compose
edit or runtime action. Both publisher refs remain
**d14e08d3dba275b0f4ce10525257a1c233aafff5**.
Root reports F (`v0.1.0-20260921f`) completed 2026-09-21 17:18:29 UTC,
exit 0, all mandatory source gates passed; no publication/login yet. Receipts
were not opened here. Root-provided bindings:

- Receipt SHA256: `8c17dd523588466f5a9c009c5c588867392919cb8104b8ab6e2251a16a8d31a4`.
- Archive SHA256: `73b735974c07c433e3c3750940549dd39864e4652eda7ae48ef06e23f43c5528`.
- Tree SHA256: `28a11d7346aba05146a1cfb813d91e77feddb579eb50d18d64660f5bca9101e3`.

F and accepted source evidence are closed: no new prepare, release ID or suite replay. First
usable scope is common login -> entitled search/play/liked collection; connected
Spotify and downloads are separately observed capabilities, not healthcheck claims.

## Accepted Source Checkpoint

Root accepted `3b68aaa` after independent SPEC-compliant / QUALITY-approved
review with zero findings:
[expiry review](D:/CodexProjects/Apollo.Platform/.superpowers/sdd/2026-09-05-apollo-unified-production-plan/tf-spotify-expiry-review-20260921.md),
SHA256 `c31308cf34ae626366a93d8122fffbf15a67fcde248d6da6cedc4fede923fed0`.
The accepted chain inherits these closed source changes; do not reopen their
suites or propose the same fixes again:

- `85f67b6593313b7f893b00fab3b8cbfd5214fcdf`: confidential Spotify Basic
  exchange/refresh; `liked-all` fails rather than returning partial success;
  pagination advances by raw page size despite filtered tracks.
- `aed21b0450de7a4b3e2ed8f052a502f3bfbd2939`: legacy Deezer preview/cache
  fallback is rejected; unsuccessful full-track resolution remains an error.
- `3b68aaa2afe9818badaefc03de10a94e7ca6917b` (source `435f5bb`): exact refresh
  HTTP400 `invalid_grant` cleanup compares generation plus encrypted envelope;
  existing status/reconnect UI is refreshed without invalidating Apollo login.

Source reports are inherited in the accepted checkout:
[Basic/pagination](D:/CodexProjects/Apollo.TF/.worktrees/tf-spotify-refresh-expiry/docs/operations/2026-09-21-tf-spotify-source-successor.md),
[preview boundary](D:/CodexProjects/Apollo.TF/.worktrees/tf-spotify-refresh-expiry/docs/operations/2026-09-21-tf-preview-boundary.md),
[expiry](D:/CodexProjects/Apollo.TF/.worktrees/tf-spotify-refresh-expiry/docs/operations/2026-09-21-tf-spotify-refresh-expiry.md).

F is still the d14e artifact: these successor source fixes are not retroactively
inside it. No new release name, preparation, receipt or image is assigned here.
Before claiming the new runtime behavior, root must independently bind the
selected images to the accepted successor source through its release process.
Until then runtime acceptance of these changes is NOT_PROVEN. Relative recipe
links in this document resolve the frozen d14e deployment checkout; source-fix
links explicitly identify the accepted successor checkout.

## Ready Source Inputs And Artifact Boundary

Use [TF base Compose](../../deploy/coolify/apollo-tf.compose.yml) **plus**
[production binding](../../deploy/coolify/apollo-tf.production-binding.compose.yml).
[Redis custody](../../deploy/redis/README.md),
[binding validator](../../scripts/src/tf-production-binding.ts),
[release catalog](../../scripts/src/release-images.ts), and
[operator consumer](../../scripts/src/operator-release.ts) are authoritative here.
The older [rollout](apollo-production-rollout.md), historical digests and
[example env](../../deploy/coolify/release.env.example) are reference/template,
not new image evidence or authority to deploy vendored Platform.

After root's publication: consume the TF-only `apollo-tf-release-manifest.json`,
`tf-release-images.env`, `apollo-tf-release-complete.json` through
`verifyTfOnlyOperatorReleaseEvidence`. Require exact source/identity/hash/catalog
binding, immutable image digest/revision and private pull proof. The existing
combined `release:validate` intentionally rejects TF-only evidence; do not fake
a mixed manifest, inject old Platform image rows or weaken that validator.
Root must separately reconcile its TF render against these Compose/binding
contracts and its current Platform-owned deployment evidence.

Required image slots (nine TF builds plus external pinned Redis; no values yet):

| Slot | Services using it |
| --- | --- |
| `TF_POSTGRES_IMAGE` | `tf-postgres`, optional `tf-role-bootstrap` |
| `TF_API_IMAGE` | `tf-api`, `tf-migrate`, optional `tf-baseline` |
| `TF_INTEGRATIONS_POSTGRES_IMAGE` | `tf-integrations-postgres` |
| `TF_INTEGRATIONS_IMAGE` | `tf-integrations`, `tf-integrations-migrate` |
| `TF_SEARCH_IMAGE` | `tf-search` |
| `TF_DOWNLOAD_REDIS_IMAGE` | `tf-download-redis` (custom queue image) |
| `TF_DOWNLOAD_WORKER_IMAGE` | `tf-download-worker` |
| `TF_WEB_IMAGE`, `TF_ADMIN_IMAGE` | `tf-web`, `tf-admin` respectively |
| `TF_REDIS_IMAGE` | `tf-redis`, catalog-pinned Redis, not a Platform instance |

Root supplies `TF_SECRET_DIRECTORY`, `TF_ADMIN_CREDENTIAL_DIRECTORY`, real
`TF_API_VERSION`/`TF_DEPLOYED_AT` and `TF_{SEARCH,INTEGRATIONS,DOWNLOAD}_VERSION`
and matching `_DEPLOYED_AT` timestamps. Env image fragment is not this full env.
Ingress tuple: `TF_API_PORT=18201`, `TF_WEB_PORT=18202`, `TF_ADMIN_PORT=18203`,
bound to loopback only; `TF_API_PUBLIC_ORIGIN=https://api.tf.apollot.ru`,
`TF_PUBLIC_ORIGIN=https://tf.apollot.ru`, `TF_ADMIN_PUBLIC_ORIGIN=https://admin.apollot.ru`,
`PLATFORM_PUBLIC_ORIGIN=https://api.apollot.ru`. Port/domain collisions are a
root reconciliation stop, not permission to replace another HomeNode service.

## Current Producer, Same Account And Renewal

TF consumes the **current Apollo.Platform Supabase/common-login producer**, not
the vendored `artifacts/platform-api` in this TF archive. TF-only publication
does not build Platform. Read-only neighbor source inspected at Platform HEAD
`2cf5c9bfc056920ae7f1a318d6c5a7ffc6def249` (selected files clean):
`D:/CodexProjects/Apollo.Platform/artifacts/platform-api/src/{app.ts,runtime-config.ts,runtime-composition.ts,common-login-runtime-config.ts}`.
Root must bind its accepted producer image/config; this source inspection says
nothing about which producer is currently running.

That producer requires `APOLLO_AUTH_MODE=SUPABASE_ONLY`,
`APOLLO_TF_BRIDGE_ENABLED=true`, `APOLLO_ACCOUNT_PROVISIONING_ENABLED=true` and
`APOLLO_COMMON_LOGIN_ENABLED=true` for the common-login/D05 composition, plus
its owner-managed Supabase, dedicated role DSNs, keyrings and policy custody.
In `app.ts`, SUPABASE_ONLY without the TF bridge registers legacy OAuth with
authorization-code flow/introspection disabled. Vendored TF Platform instead
has legacy user-session OAuth and no composed D05 producer. Neither is a
working fallback for this launch. Do not create another account/login, use
staging identity, call a bootstrap bypass or reuse Platform Redis.

TF [auth client](../../artifacts/api-server/src/lib/platform-auth-client.ts) needs
`GET /v1/oauth/authorize`, `POST /v1/oauth/token`, `POST /v1/oauth/introspect`
and `GET /.well-known/jwks.json`. Confidential client is `apollo-tf-api`, audience
`apollo-tf`, sole callback `https://api.tf.apollot.ru/api/auth/callback`.
Root supplies its registered matching client secret, real parent login/session,
canonical Platform account/installation mapping and TF policy. Browser-generated
installation hint is not authority; callback adopts verified assertion identity.
No TF/Quasar client reads identity tables or receives Supabase service-role keys.
The consumed route capabilities are **`tf.search`, `tf.collections`,
`tf.integrations`, `tf.downloads`**, under Platform's TF module admission:
[policy map](../../artifacts/api-server/src/lib/tf-policy.ts). Do not invent a
new `tf.player` grant or treat installed UI/assets as access permission.

Production overlay couples the entire tuple: API origin and issuer both
`https://api.apollot.ru`, private-HTTP bridge false, exact callback/web origin,
renewal true and separate revoke-keyring mount. Base Compose's internal HTTP
origin/renewal-off is legacy compatibility, **not** this production profile.
No fixed bridge PKCE environment/file is permitted. Dynamic per-login S256
state/nonce/verifier and current parent-session custody must reach the producer.
The [D05 consumer](../../artifacts/api-server/src/lib/tf-renewal-contract.ts)
requires `/v1/tf/session-renewals/{enroll,renew,check,revoke}`, strict
`apollo.tf.session-renewal.v1`, bound account/session/installation/client/
audience/family/JTI and request/audit correlation. Browser renewal is
`POST /api/auth/renew-context` -> CSRF-bound `POST /api/auth/renew` -> `/api/auth/me`;
only `Apollo-TF-Session-Profile: renewal-v1` negotiates it. No silent downgrade.
Root must retain the genuine parent refresh/session producer and its absolute
family deadline; merely extending TF cookies is not renewal.

TF-only release fixes `TF_SUCCESSOR_WS_ENABLED=false`; immutable Web build must
match API `APOLLO_TF_SUCCESSOR_WS_ENABLED=false` and
`VITE_API_URL=https://api.tf.apollot.ru`. Do not turn successor WS on at runtime.
`TF_RENEWAL_ENABLED=false` in the old env template is base compatibility only:
the effective overlay API value is `APOLLO_TF_RENEWAL_ENABLED=true`.

## Dedicated Stores And Secret Slots

`tf-redis` uses `apollo-tf-redis-v1`, AOF, private `apollo-tf-data-v1`, no host
port. Auth URL must use `/1`; cache URL `/0`, both authenticated and exact
UTF-8 without newline/query/fragment. ACL disables default and separates
`tf-auth`, `tf-cache`, `tf-health`; health needs PING, auth requires accepted
session/family Lua/CAS commands/keys (including `tf-auth:{families}:*`), not
just PING. See [store](../../artifacts/api-server/src/lib/tf-session-store.ts)
and [family persistence](../../artifacts/api-server/src/lib/tf-family-store.ts).
Redis DB numbers alone are not an ACL isolation boundary. Root must prove the
actual ACL and two-process atomic operations, AOF/restart and key retention.

`tf-download-redis` is a different service/image/volume/network:
`apollo-tf-download-redis-v1` / `apollo-tf-download-queue-v1`. API is the BullMQ
producer; worker consumes this queue and serves authorized files. Neither queue
nor TF auth/cache may point at Platform Redis. Same Redis image digest does not
authorize sharing an instance. PostgreSQL volumes are `apollo-tf-postgres-v1`
and `apollo-tf-integrations-postgres-v1`; worker media volume is
`apollo-tf-downloads-v1` at `/var/lib/apollo-tf/downloads`.

All following secret names are **filenames**, no values. Source is
`${TF_SECRET_DIRECTORY}/<name>`, mount `/run/secrets/<name>`, except admin
htpasswd from `${TF_ADMIN_CREDENTIAL_DIRECTORY}/admin_access_htpasswd`.
Exact per-service `_FILE` names/UID/GID/mode are in the two Compose files;
runtime consumers normally use UID/GID10001:10001/0400, Redis/PG999:999/0400,
admin htpasswd0:0/0400. Verify actual mounted ownership, not YAML intent alone.

| Consumer | Required files / environment binding |
| --- | --- |
| `tf-api` auth/cache | `tf_client_secret` -> `APOLLO_TF_CLIENT_SECRET_FILE`; `tf_auth_redis_url` -> `APOLLO_TF_AUTH_REDIS_URL_FILE`; `tf_cache_redis_url` -> `REDIS_URL_FILE`; `tf_revoke_keyring` -> `APOLLO_TF_REVOKE_KEYRING_FILE` |
| `tf-api` DB/observability | `tf_runtime_database_url` -> `DATABASE_URL_FILE`; `tf_module_heartbeat_keys` -> `APOLLO_MODULE_HEARTBEAT_KEYS_FILE`; `admin_dashboard_token` -> `ADMIN_DASHBOARD_TOKEN_FILE` |
| `tf-api` module commands | `tf_search_internal_auth_secret` -> `TF_SEARCH_INTERNAL_AUTH_SECRET_FILE`; `tf_integrations_internal_auth_secret` -> `TF_INTEGRATIONS_INTERNAL_AUTH_SECRET_FILE`; `tf_download_internal_auth_secret` -> `TF_DOWNLOAD_WORKER_INTERNAL_AUTH_SECRET_FILE`; `tf_download_queue_redis_url` -> `TF_DOWNLOAD_QUEUE_REDIS_URL_FILE` |
| `tf-postgres` / `tf-migrate` | `tf_postgres_admin_password`, `tf_migrator_password`, `tf_runtime_password`; migrator uses `TF_MIGRATOR_DATABASE_URL_FILE` -> `tf_migrator_database_url` |
| `tf-redis` | `tf_redis_acl` and `tf_redis_health_password`; no inline URL/password |
| integrations DB/migrate | `tf_integrations_postgres_admin_password`, `tf_integrations_migrator_password`, `tf_integrations_runtime_password`; migrate `TF_INTEGRATIONS_DATABASE_URL_FILE` -> `tf_integrations_migrator_database_url` |
| `tf-integrations` | `TF_INTEGRATIONS_DATABASE_URL_FILE` -> `tf_integrations_runtime_database_url`; other `TF_INTEGRATIONS_*_FILE` suffixes `TOKEN_KEYRING`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `INTERNAL_AUTH_SECRET`, `HEARTBEAT_SECRET` map to same lowercase filenames |
| `tf-search` | `TF_SEARCH_{INTERNAL_AUTH_SECRET,HEARTBEAT_SECRET}_FILE` -> matching lowercase filenames |
| download Redis/worker | Redis `TF_DOWNLOAD_QUEUE_PASSWORD_FILE` -> `tf_download_queue_password`; worker `TF_DOWNLOAD_{QUEUE_REDIS_URL,INTERNAL_AUTH_SECRET,HEARTBEAT_SECRET}_FILE` -> matching lowercase filenames |
| `tf-admin` | `admin_dashboard_token` and `admin_access_htpasswd`; proxy upstream `http://tf-api:8080` |
| existing-schema baseline ONLY | `tf_admin_database_url` -> `TF_ROLE_BOOTSTRAP_DATABASE_URL_FILE` / `TF_BASELINE_DATABASE_URL_FILE`,0:10002/0440; role-bootstrap also needs migrator/runtime password files |

Three module command secrets must be distinct; each matches its receiving
module but differs from that module's heartbeat secret. Heartbeat registry
must match `search-media`, `account-integrations`, `download-worker` senders.
Revoke keyring is TF-only `version=1`, purpose `apollo-tf-revoke-only`, with
1..4 unique canonical base64url 32-byte keys and `active` selecting one of them,
mode 0400/current API UID;
never reuse client/Platform vault/capsule keys. Keep old keys while any durable
outbox/backup needs them. Provider token keyring is a different secret entirely.

## Startup Order And Health Meaning

1. Root binds published images/private pulls, producer readiness/custody,
   secret mounts and protected ingress inventory. External network
   `apollo-platform-bridge-v1` must exist even though the production auth origin
   is HTTPS. Do not substitute a legacy Platform container to satisfy its name.
2. Start dedicated `tf-postgres`, `tf-integrations-postgres`, `tf-redis`,
   `tf-download-redis`. PG checks use pg_isready; TF Redis health is authenticated
   tf-health PING; queue Redis uses its image's queue health script. These do
   not establish schema, auth-store ACL or provider readiness.
3. Fresh PG images initialize least-privilege roles; then one-shot `tf-migrate`
   and `tf-integrations-migrate` must exit0. Existing volumes require root's
   snapshot/role/schema admission, not blind fresh init. `baseline` profile
   (`tf-role-bootstrap` -> `tf-baseline`) is only for admitted existing startup
   schema, not a default startup command or identity/bootstrap bypass.
4. Start integrations after its migration, search, and download-worker after
   download Redis. Private command origins are `http://tf-{integrations,search}:8080`
   and `http://tf-download-worker:8080`; heartbeat target is `http://tf-api:8080`.
   These private service HTTP allowances are distinct from the forbidden auth
   HTTP bridge. Initial heartbeat delivery can wait for API; module readiness
   does not depend on a successful heartbeat, avoiding an API dependency cycle.
5. Compose admits `tf-api` only after its DB/migration/Redis and all three modules
   are healthy. [Index](../../artifacts/api-server/src/index.ts) loads gateway and
   auth config, connects/PINGs auth Redis, builds renewal runtime, strictly
   connects/PINGs file-selected cache Redis before listen, then attaches WS,
   initializes queues and starts revoke drain. Failed required config/storage
   is terminal; do not remove `_FILE` settings to invoke legacy cache fallback.
6. Start web/admin (admin depends on API healthy); root adds only approved TF
   Caddy routes, preserving every other domain/service. Web/admin `/healthz`
   proves static serving, API `/api/readyz` local auth Redis + migration readiness.
   Module `/readyz`: integrations DB readiness; search initialized adapter service;
   worker queue/storage/downloader readiness. None proves successful external
   search, provider account access, public Platform login or full-track audio.

Spotify app client ID/secret and exact callback
`https://api.tf.apollot.ru/api/spotify/callback` are required at integrations
startup by [config](../../artifacts/tf-integrations/src/config.ts), even when no
user connected Spotify. API's gateway factory and Compose require all modules;
there is no approved partial profile that omits integrations or the worker.
Root's sanitized dashboard snapshots record app existence and the intended
redirect (see below), not current live configuration or secret validity. Missing mounted credentials is
still a root dependency, not permission for dummy credentials/test adapters.
`NODE_ENV=production`, no smoke fixture flags.

## Spotify Availability And First OAuth/Audio Checklist

### Evidence Boundary

Root's sanitized handoff records two user-supplied dashboard snapshots, not a
live dashboard session. The newer snapshot shows **ApolloTF / Apollo Track
Finder**, Development mode, unchanged client ID and redirect
**`https://api.tf.apollot.ru/api/spotify/callback`**. That intended redirect
matches d14e Compose. TF did not open/copy either PDF or receive any credential
value. Historical app existence is recorded; current configuration, replacement-secret validity,
protected mount delivery, owner Premium and tester allowlisting remain UNPROVEN.
Root owns those checks/delivery. The disclosed secret is not authorized for
reuse; replacement choice/delivery remains root-owned. No dummy keys are allowed.

The existing first-runtime checklist below is carried forward with accepted
3b68aaa behavior, not executed. Previously recorded official-document checks
are dated 2026-09-21; this handoff update did not repeat them. Root must record outcomes separately as
dashboard-reported, source-confirmed or live-observed; do not promote one into
another. OAuth/library success and full audio are **two independent results**.

### Tester And Endpoint Prerequisites

- Development mode requires **the app owner** to retain Premium. Each tester
  must be allowlisted in Users Management; current default is five authorized
  users. A non-allowlisted user can complete consent yet get upstream 403.
  Existing larger allowlists may be grandfathered; do not remove users or infer
  ApolloTF's quota from defaults. [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes),
  [migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).
- Do not confuse owner Premium with a requirement that every metadata-only
  tester have Premium. Spotify-native Web Playback SDK streaming separately
  requires Premium for the listener and `streaming`; accepted TF source does not implement
  that SDK or request playback scopes. [Scopes](https://developer.spotify.com/documentation/web-api/concepts/scopes),
  [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk).
- July raised the per-developer app limit to 25, **not** the tester limit;
  Development-mode apps now share developer-account quota. Avoid bulk library
  import/retry loops for the first probe. [July update](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates).
- Public callback must be HTTPS and match byte-for-byte in dashboard, authorize
  request, token exchange and `TF_INTEGRATIONS_SPOTIFY_CALLBACK_URI`: no trailing
  slash, localhost, alternate host or substituted common-login callback.
  [Redirect rules](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

Accepted source: [Spotify adapter](D:/CodexProjects/Apollo.TF/.worktrees/tf-spotify-refresh-expiry/artifacts/tf-integrations/src/providers/spotify.ts)
(`SPOTIFY_SCOPES`, `authorizationUrl`, `exchangeCode`, `refresh`),
[public routes](D:/CodexProjects/Apollo.TF/.worktrees/tf-spotify-refresh-expiry/artifacts/api-server/src/routes/spotify.ts),
[service](D:/CodexProjects/Apollo.TF/.worktrees/tf-spotify-refresh-expiry/artifacts/tf-integrations/src/service.ts).
Spotify API endpoints below are at `https://api.spotify.com`; TF endpoints are
at `https://api.tf.apollot.ru`. This is an inventory, not instructions to call
Spotify with copied tokens from a browser or terminal.

| First-test purpose | TF/public path -> Spotify request | Least operation-specific scope |
| --- | --- | --- |
| Consent | `GET /api/spotify/login` -> `GET https://accounts.spotify.com/authorize` | Code flow plus the fixed set below |
| Complete connection | `GET /api/spotify/callback` -> server `POST https://accounts.spotify.com/api/token`, then `GET /v1/me` | Basic ID/display name consumed; no email/subscription data consumed. See profile compatibility note below |
| One saved-track page | `GET /api/spotify/liked?offset=0&limit=1` -> `GET /v1/me/tracks?offset=0&limit=1` | `user-library-read` |
| Optional playlist list | `GET /api/spotify/playlists` -> `GET /v1/me/playlists?limit=50` | `playlist-read-private`; `playlist-read-collaborative` to include collaborative playlists |
| Optional owned/collaborative playlist page | `GET /api/spotify/playlists/:id/tracks?offset=0&limit=1` -> `/v1/playlists/:id/tracks` with `fields` projection | Corresponding playlist read access; compatibility observation below |
| Optional top tracks | `GET /api/spotify/top-tracks?time_range=medium_term` -> `GET /v1/me/top/tracks?limit=50&time_range=medium_term` | `user-top-read` |
| Refresh / disconnect | Server `POST https://accounts.spotify.com/api/token` with refresh grant / TF `POST /api/spotify/logout` | Existing user grant; TF disconnect deletes its stored link, not Spotify's app consent |

The unchanged consent set is `user-library-read playlist-read-private
playlist-read-collaborative user-top-read user-read-recently-played`. First
saved-track read needs only the library scope operationally; the binary still
requests all five, not a configurable minimum. No recently-played operation
exists in this adapter. No library writes, email, `streaming` or player-control
scopes should be claimed. Endpoint/scope mapping: [saved tracks](https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks)
and [scope reference](https://developer.spotify.com/documentation/web-api/concepts/scopes).

### Operator Sequence After Root Runtime Admission

1. Confirm the protected app credentials are actually mounted for integrations
   and match root's existing app; verify owner Premium/tester allowlist without
   exporting values. Use one authorized Apollo account A with `tf.integrations`
   and `tf.search`; `tf.collections` is needed only for Apollo likes. Select one
   known full-length test track legitimately available on the chosen audio
   source and present in A's Spotify saved library. Do not use `liked-all`.
2. Establish Apollo login first: Web -> `GET /api/auth/start` -> Platform
   authorize/common login -> `https://api.tf.apollot.ru/api/auth/callback` ->
   `303 https://tf.apollot.ru`. `/auth/start` accepts no `returnTo` query; it does
   not auto-resume a Spotify callback. Source [auth router](../../artifacts/api-server/src/routes/auth.ts)
   creates fresh state/nonce/S256 verifier and a one-use transaction cookie;
   verified Platform assertion supplies account/session/installation identity.
   Confirm `/api/auth/me` account A and renewal-v1 before opening `/integrations`.
3. Follow Connect as top-level navigation to `/api/spotify/login`, not a
   cross-origin AJAX fetch of the Spotify consent page. Both login and callback
   require a valid TF principal plus `tf.integrations`. A separate random Spotify
   state is stored hashed in TF Redis for **300 seconds**, atomically consumed
   only for matching provider/account A; it is not Platform's login state.
   [State store](../../artifacts/api-server/src/lib/tf-session-store.ts)
   binds account, **not a particular browser/session/installation**. Current
   provider flow is confidential-server Authorization Code, **without Spotify
   PKCE**; do not claim the Apollo S256 verifier protects that second leg.
   Spotify documents server-side Code flow for safely held client secrets and
   PKCE for public clients. [Flow selection](https://developer.spotify.com/documentation/web-api/concepts/authorization).
4. Approve consent for the intended allowlisted Spotify user within the state
   lifetime, keeping the same Apollo browser account. Spotify returns code/state
   to the exact public callback; TF verifies current access, consumes state,
   exchanges code, fetches `/v1/me`, encrypts provider tokens under account A and
   stores the link. If TF session/state expired, return to Web, re-establish the
   Apollo session and start a fresh Connect; never transplant/replay a code.
   Raw code/state/token/secret/query-bearing Location headers must not enter
   reports, saved HAR, screenshots or logs.
5. Expect `302 https://tf.apollot.ru/favorites?spotify_connected=1`, then client
   replacement to `/integrations`, query removal and a fresh status request.
   [Favorites](../../artifacts/music-player/src/pages/Favorites.tsx) and
   [Integrations](../../artifacts/music-player/src/pages/Integrations.tsx) never
   treat the success query as authorization. `GET /api/spotify/status` must show
   the intended link; then one `/liked?offset=0&limit=1` must actually succeed.
   `connected: true` alone proves a stored record, not current token/API validity.
6. For full audio use that track's title/artist in TF search, not its raw Spotify
   ID as a TF playable ID: `POST /api/tracks/search` with artist/title and the
   approved source selection, then select a returned result and let the Web
   player call `GET /api/tracks/:id/stream`. The current [player](../../artifacts/music-player/src/hooks/use-player.tsx)
   plays the returned URL using native Audio; this is not Spotify SDK playback.
   Verify audible content, actual decoded duration against expected full length,
   seek beyond 90 seconds and near the end for a >2-minute test track, then queue
   transition. Source completeness uses preview URL/title/duration heuristics,
   not decoded-media proof: [filter](../../artifacts/tf-search/src/media-completeness.ts).
   A search result, metadata duration, HTTP200 or 30-second preview is not PASS.
7. Use normal browser account controls to verify A/B isolation, capability
   denial and one cancelled consent. A fresh account B must not see A's Spotify
   link/library; switching accounts while consent is pending must not bind to B.
   One replay/expired-state observation must fail closed, with no repeated
   provider exchange. Mutating TF requests (search/disconnect/likes) require
   exact Web Origin, credentialed cookies and `X-CSRF-Token`; top-level OAuth
   GETs instead use state plus current access. See [browser guard](../../artifacts/api-server/src/lib/tf-browser-session.ts).
   If any boundary fails, stop; do not bypass it to finish the positive test.

Spotify provider refresh is separate from Apollo D05 renewal. It remains
lazy on library requests when <=60 seconds remain, not on `/spotify/status`.
First exchange/read does not validate future refresh; retain that as a later
bounded observation at natural token expiry, without clock changes or token
injection. No need to replay F or source suites.

### Expected Safe Outcomes At Accepted Source

These are actual route mappings, not promised upstream diagnostics. Do not
log Spotify response bodies or add ad-hoc token probes to distinguish them.

| Condition | Expected public result / meaning |
| --- | --- |
| No valid TF login | `401 {error: unauthorized}` before provider route; policy backend unavailable -> `503 {error: policy_unavailable}` |
| No `tf.integrations` | `403 {error: module_access_denied}`; no provider command |
| Wrong Origin/missing mutation CSRF on renewal family | Normally `403 {code: TF_RENEWAL_CSRF_REJECTED, retryable: false}`; later policy CSRF mismatch can return `403 {error: forbidden}` |
| No stored Spotify link | Status `200 {connected:false}`; paged library read `401 {error:not_connected}` |
| Exact refresh HTTP400 `invalid_grant`, cleanup committed | Library `401 {error:not_connected}`; status false, existing Spotify reconnect link; no Apollo logout or later refresh of the removed row |
| Terminal refresh cleanup cannot persist | Internal `storage_unavailable`, public library `502 {error:spotify_error}`; no false claim that the stored link was removed |
| Old rejected refresh races with committed replacement | Conditional delete does not remove replacement; obsolete library request can return `not_connected`, but revalidated status reflects the surviving row |
| Integrations unavailable / authorize URL rejected | Login/status `503 {error:spotify_unavailable}`; paged library gateway failure maps to `502 {error:spotify_error}` |
| Consent denied with valid A state | Redirect to `/favorites?spotify_error=provider_denied`; no new link |
| Wrong/reused/expired/A-to-B state | Redirect `spotify_error=invalid_state` if current TF access passes; otherwise earlier 401/403/503 gate |
| Missing/malformed code with valid state | Redirect `spotify_error=invalid_callback` |
| Provider token exchange/profile rejection | Redirect `spotify_error=token_exchange_failed`; storage/gateway/state-store failure -> `spotify_error=internal` |
| Upstream 401/403/429 on library read | Internal `provider_rejected`, public `502 {error:spotify_error}`; upstream 5xx/network -> internal `provider_unavailable`, same public 502 |
| Search gateway / stream resolution failure | `503 {error:search_unavailable}` / `500 {error:stream_error}`; neither may become fabricated full-track success |

The Web callback bridge deliberately reduces specific provider errors to a
generic message; record only the safe machine code if available. Callback
failure does not prove an old link was removed. Never infer secret rotation,
scope denial, allowlist omission or quota exhaustion from one generic code.

### Remaining Runtime Compatibility Observations

- **Token authentication source fix is CLOSED:** exchange/refresh now uses
  confidential HTTP Basic. The existing first genuine exchange and natural
  refresh observations remain pending; do not rerun the accepted source suite.
- **Profile and scope admission:** `/v1/me` is mandatory before link persistence;
  TF consumes basic `id`/`display_name` but omits `user-read-private` and
  `user-read-email` listed in the current [profile reference](https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile).
  Basic-field access under the existing grant needs live proof, not invented
  permission requirements or adding email collection. The adapter discards
  returned token `scope` and `token_type`; its five-scope request is wider than
  the minimal first read, with no recently-played consumer. Scope trimming or
  grant validation would be a separately reviewed change.
- **Playlist schema compatibility:** TF still uses `/playlists/:id/tracks`,
  `items[].track` and requires playlist `tracks.total`. Current migration docs
  describe `/items` and renamed/possibly absent fields for non-owned playlists.
  However the official [March 9 update](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
  postponed endpoint changes for existing integrations. ApolloTF's effective
  cohort is not established by its name/mode/unchanged ID. This is a concrete
  compatibility risk, **not proof every legacy call already fails**. Limit first
  acceptance to profile + one saved track; optional playlist behavior needs its
  own observation before promising it or proposing an additive adapter update.
- **Status/error observability:** stored `connected` is not a live health check.
  Exact refresh HTTP400 `invalid_grant` is now classified internally; other
  provider diagnostics remain sanitized. 429 still merges with other 4xx, so
  `QUOTA_EXCEEDED` and retry timing are not surfaced. Partial-success and filtered
  pagination defects in `liked-all` are CLOSED; the first live read stays bounded.
- **Provider identity durability:** TF still persists Spotify `id`; Spotify now
  recommends immutable `account_id` for linking. This does not replace Apollo
  account authority or justify a DB migration here. [May change](https://developer.spotify.com/documentation/web-api/references/changes/may-2026).
- **Playback boundary:** there is no Spotify-native full-track playback in this
  source; metadata/library access grants no such implementation. The legacy
  Deezer preview fallback defect is CLOSED at source. Heuristic completeness
  still requires actual decoded/audio proof. If acceptance means Spotify SDK streaming,
  report NOT IMPLEMENTED rather than equating successful library import with it.

These remaining observations do not reopen the accepted source tasks or
authorize further changes. All positive runtime outcomes remain pending.

### New First-Runtime Obligations For Expiry

Exactly four additions to the existing first-runtime checklist follow. They
are obligations for root's separately admitted runtime, not instructions to
operate secrets/provider/PG now. Reuse accepted source evidence; no new schemas,
diagnostic API, clock changes, token injection or production fault toggles.

1. **Expiry / no repeated refresh.** On one explicitly admitted test account,
   observe a naturally expired or deliberately revoked provider grant after
   its access token reaches the existing lazy-refresh boundary. One bounded
   library read must reach the terminal refresh path; after committed cleanup,
   status is false and a subsequent read returns `not_connected` without another
   provider refresh for that removed record. Record only sanitized outcome/count
   evidence. An earlier `connected:true` storage projection is not validity proof;
   a generic provider 4xx/5xx is not evidence of terminal `invalid_grant` cleanup.
2. **Real storage outcome.** With the actual integrations runtime role, prove
   account/provider-scoped deletion commits on the dedicated PG store and that
   another account/Yandex link is unchanged, without exporting token envelopes.
   A separately admitted isolated cleanup-failure case must return
   `storage_unavailable` (public library 502), not a fabricated disconnection.
   If persistence fails, no claim of later no-refresh is permitted. No changes
   to shared production roles, stores or availability are authorized by this note.
3. **Concurrent replacement.** In an admitted isolated runtime proof using real
   PG transaction boundaries, hold an old refresh failure until after (a) a new
   authorization generation commits and (b) a successful refresh commits a new
   encrypted envelope under the same generation. In each case the old cleanup
   must not delete the replacement; status must reflect the surviving link.
   Account/provider predicates remain mandatory. If controlled interleaving is
   unavailable, record NOT_PROVEN, not a pass inferred from test doubles. No
   global serialization of already in-flight provider requests is promised.
4. **Apollo-session retention.** In the actual Web UI, terminal Spotify expiry
   must revalidate existing Spotify status, stop library retry and expose the
   existing Connect link while preserving the same Apollo account/installation
   and valid session/capabilities. Normal entitled TF activity must remain usable;
   no Apollo login redirect, logout or new login authority. Reauthorization must
   bind to that same account through the existing flow. Ordinary Apollo 401,
   entitlement and D05 expiry remain fail-closed; reuse their existing first-run
   checks rather than treating this provider-only exception as a bypass.

Capture outcomes separately as source-accepted versus live-observed, with safe
request/audit correlation and no raw token/body/cookie/query-bearing captures.
No outcomes in these four items have been executed by this handoff update.

## Minimal Post-Image Acceptance And Stops

Root-only, after its separate runtime authorization; record redacted outcomes,
not tokens/cookies/DSNs or complete browser traffic. Reuse F/source and closed
SQL/fixture evidence; do not rerun the application suites.

1. Verify image/source/manifest and actual rendered overlay/mount identities;
   migrations exit0, required services healthy, no public data-store ports,
   other HomeNode services unchanged. Wrong cache/auth credentials must not
   open a healthy TF listener. Verify real ACL/CAS and dedicated-store isolation.
2. Genuine common login on public HTTPS: `/api/auth/start` -> current producer ->
   exact callback -> `/api/auth/me` same Platform account/canonical installation,
   renewal-v1 profile, Secure/HttpOnly host-cookie custody and exact credentialed
   CORS/CSRF. Check a denied TF capability fails closed; no auth bootstrap/token
   injection to manufacture a positive test. Root verifies producer routes and
   parent/session liveness separately from TF readyz.
3. One entitled search and full track on an allowed source, audible native
   browser playback/seek/queue, real duration/content past preview length. Search
   service rejects incomplete media; the accepted
   [legacy Deezer stream fix](D:/CodexProjects/Apollo.TF/.worktrees/tf-spotify-refresh-expiry/artifacts/api-server/src/routes/tracks.ts)
   rejects preview fallback. A URL/HTTP200 is still not full-audio acceptance.
   In unavailable cases retain truthful errors; no DRM/paywall bypass.
4. Liked A add/read, B isolation, switch back; account/capability/session revoke
   removes protected access and stops player. Observe actual playback + renewal
   beyond original <=5-minute assertion lifetime, background/focus recovery,
   logout and no late prior-account success. Family absolute expiry remains
   upstream-capped, not reset by each refresh. Successor WS stays off.
5. Admin shows actual module versions/heartbeats/parser failures/preview rejects.
   User/connections overview additionally needs producer
   `/v1/internal/admin/overview` and integrations `/v1/internal/admin/connections`
   with the existing M2M authorization. Do not substitute mock healthy accounts.
   Spotify connection/status/liked import and one owned download/file access are
   separate bounded checks when enabled; Yandex onboarding remains unavailable
   in current UI, not a token-entry or invented OAuth path.

Stop at missing image/pull evidence; missing current common-login/D05 producer;
missing/unsafe secret or ACL; reused Platform Redis; incomplete migrations;
origin/callback/key/flag mismatch; missing mandatory module; custody/volume or
ingress conflict; failed same-account/isolation/revoke/renewal/audio observation.
No rollback that drops renewal to legacy while family cookies exist, no key
discard before outbox/restore proof, no global Caddy/container cleanup. Root
owns any rollback and infrastructure selection; TF does not activate it here.

Resume: owner TF; stage SOURCE_COMPLETE / FIRST_RUNTIME_PENDING for the assigned
source fixes. Evidence: root-accepted 3b68aaa and approved independent review;
inherited Basic/pagination/preview acceptance; separately frozen d14e F evidence.
Blocker: root infrastructure, accepted-source image binding, current producer,
replacement-credential custody and real runtime proof. Next: root-owned startup
and the existing OAuth/audio checklist plus exactly four expiry obligations above;
do not restart source fixes, F preparation or a general plan.
Validation of this update: acceptance/report identity, ancestry, file/link/scope
checks only. No commit, suite replay, PG/provider calls, PDF/secret access, SSH,
Docker, browser/CUA, release operation, deployment or agents.
