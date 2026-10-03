# Task 3 TF Canary Consumer Handoff

Owner: Apollo.TF. Requested by Web Platform after the completed player slice.
Status: **PREPARATION_READY / ACTIVATION_BLOCKED**. No build, registry query,
publication, deployment, Auth/SQL command, fixture creation or live acceptance
was performed here. Root owns admitted Auth/Platform profile and operations.
Its canary pause is not resumed by this document.

## Exact Candidate

| Input | Selected value |
| --- | --- |
| TF source commit | `113f6e907c774603077eff7de37d49321b2a19f3` |
| TF source tree | `825a254a8f14debc4debb0db50935ec6f338acae` |
| Proposed, unclaimed release ID | `v0.1.0-canary.20261003.113f6e9` |
| Custom image architecture | `linux/amd64` |
| Platform issuer/API | `https://api.canary.apollot.ru` |
| TF web / VITE_API_URL | `https://tf.canary.apollot.ru` / `https://api.tf.canary.apollot.ru` |
| TF OAuth callback | `https://api.tf.canary.apollot.ru/api/auth/callback` |

Every proposed tag below is under `ghcr.io/altis13/` and uses the exact release
ID above. Tags have NOT been checked for absence or claimed. Digests, archive
SHA-256, build/pull receipts and runtime revisions are absent, not zero-filled.

| Repository | Dockerfile / target |
| --- | --- |
| `apollo-tf-api` | `artifacts/api-server/Dockerfile` / `runner` |
| `apollo-tf-postgres` | `artifacts/api-server/Dockerfile` / `postgres-role-init` |
| `apollo-tf-web` | `artifacts/music-player/Dockerfile` / `runner` |
| `apollo-tf-admin` | `artifacts/admin-dashboard/Dockerfile` / default |
| `apollo-tf-search` | `artifacts/tf-search/Dockerfile` / `runner` |
| `apollo-tf-integrations` | `artifacts/tf-integrations/Dockerfile` / `runner` |
| `apollo-tf-integrations-postgres` | `artifacts/tf-integrations/Dockerfile` / `postgres-role-init` |
| `apollo-tf-download-worker` | `artifacts/tf-download-worker/Dockerfile` / `runner` |
| `apollo-tf-download-redis` | `artifacts/tf-download-worker/Dockerfile` / `queue-redis` |

External Redis must be pinned separately by root. Do not substitute an old
digest or `latest`. This source includes the [Media Session slice](../product/2026-10-02-media-session.md).
It is NOT the [built `f3828eb` candidate](2026-10-02-tf-canary-release-candidate.md),
the staged `79ebdd6` source, or the inert GHCR access-check image. Existing
[GHCR custody proof](2026-10-02-tf-ghcr-native-admission.md) is reusable only for
its unchanged custody inputs, not as this candidate's image/admission receipt.
Accepted D05 consumer `00300c3`, runtime composition `6c5cbe5` and browser
renewal `5a7527b` are ancestors; their accepted work and later fixes are retained.
No D05 code or DTO is reimplemented by this handoff.

## Registration And Activation Inputs

Root must provide one protected, revision-bound admitted profile containing:

- Exact Platform source/image revisions, live issuer/JWKS and Auth checker,
  confidential client registration and callback/allowed-origin receipt.
  Current TF wiring selects `apollo-tf-api`, audience `apollo-tf`, PKCE S256,
  Basic client authentication; the secret is a read-only file, never browser data.
  Register the exact HTTPS callback above, no wildcard/production callback.
- Common Apollo login entry and its TF return-target preservation. Start at
  TF `GET /api/auth/start`; follow the actual registered authorize/common-login
  flow, not a TF-only credential form or invented canary login hostname.
- `APOLLO_PLATFORM_ISSUER` and `APOLLO_PLATFORM_API_ORIGIN` equal the selected
  public issuer; `APOLLO_TF_BRIDGE_ALLOW_INTERNAL_HTTP=false`, exact
  `APOLLO_TF_CALLBACK_URL`, `APOLLO_TF_WEB_ORIGIN`, `APOLLO_TF_CLIENT_ID`,
  `APOLLO_TF_CLIENT_SECRET_FILE` and isolated `APOLLO_TF_AUTH_REDIS_URL_FILE`.
  Preserve host-only Secure/Lax/Path=/ cookies and credentials-enabled exact TF
  web origin; never share cookie Domain across Apollo subdomains.
- Admitted D05 activation: `APOLLO_TF_RENEWAL_ENABLED=true` and distinct
  `APOLLO_TF_REVOKE_KEYRING_FILE`, owned by runtime UID, regular non-symlink
  file, mode `0400`, matching the existing revoke-only schema. No inline keys,
  secret reuse, static bridge PKCE verifier or private HTTP renewal profile.
- Platform dedicated repository roles/keyring/M2M readiness, isolated TF
  DB/Redis and source-matched image map, exact Coolify resource/volume/network
  IDs, ingress prestate and rollback/recovery receipt. Keep existing services,
  Caddy routes and production Auth/API outside the mutation manifest.

**Concrete source/config blocker:** `deploy/coolify/apollo-tf.canary.compose.yml`
and generated `apollo-tf.canary.git.compose.yml` currently force renewal false;
`scripts/src/tf-canary-compose-binding.ts` rejects any value other than false.
Thus this existing profile can prove only the short-session demo, NOT Task 3
renewal. Root must admit a separate versioned renewal-enabled canary binding and
secret custody; TF can then implement that narrow configuration/validator delta
under its exact assignment. Do not weaken the existing validator or use the
production binding as a canary override. Any source change requires a new source
SHA/image candidate; the selected `113f6e9` tuple must not silently absorb it.
`publisher_preflight_required` remains unchanged.

## Safe Owner Fixture Inputs

The following is a names-only preparation envelope, NOT an admitted profile or
new runtime DTO. Nulls must be supplied through protected owner custody. Unknown
inputs stop the relevant phase rather than skipping checks and declaring PASS.

```json
{
  "version": 1,
  "runId": "tf-task3-20261003-113f6e9",
  "sourceCommit": "113f6e907c774603077eff7de37d49321b2a19f3",
  "profileRevision": null,
  "admissionReceipt": null,
  "clientId": "apollo-tf-api",
  "audience": "apollo-tf",
  "accounts": {
    "A": { "provisioningReceipt": null, "canonicalAccountId": null, "credentialSecretRef": null },
    "B": { "provisioningReceipt": null, "canonicalAccountId": null, "credentialSecretRef": null }
  },
  "initialCapabilities": ["tf.search", "tf.collections"],
  "canonicalTupleWitnessRef": null,
  "grantCommandProfileRef": null,
  "revokeCommandProfileRef": null,
  "isolatedCheckerOutageProfileRef": null,
  "fullTrackFixtureRef": null,
  "previewFixtureRef": null,
  "cleanupManifestRef": null
}
```

A/B must be disposable synthetic identities from approved provisioning/invites,
not direct Auth inserts or personal accounts. Use separate browser contexts.
Canonical account/installation must be witnessed by Platform after registration;
TF's installation cookie is only an alias, never the expected canonical ID.
Keep Supabase session ID, TF family handle and canonical installation distinct.

The full-track owner fixture records exact source URL/TF track ID, permission,
artist/title/version, independently trusted recording duration and audio witness
expectations. Use an audible full recording longer than six minutes for the
bounded renewal run, admitted through ordinary source-bound duration checks.
No Spotify/Yandex audio extraction, Deezer preview, DRM bypass, mocked stream or
silent WAV qualifies. A separate permitted ~30s preview of a longer referenced
recording supplies the rejection case. Credentials, source URL signatures,
cookies, codes, CSRF values, assertions and refresh/reference material must not
appear in traces/screenshots/reports. Reports use fixture aliases and safe hashes.

## Bounded Real Acceptance Sequence

Do not use Playwright route interception, FakeAudio or fabricated /auth/me for
these checks. Root selects the actual admitted executor and fixture profiles.

| Step | Required observation / invariant |
| --- | --- |
| 1. A common login -> TF callback | One-use state/nonce/code and PKCE/Basic handshake; `GET /api/auth/me` returns canonical account/install matching Platform witness; `Apollo-TF-Session-Profile: renewal-v1`. No second credential store. |
| 2. A liked persistence | `PUT /api/collections/liked/:trackId` with exact Origin and current `x-csrf-token` -> 200, body `{artist,title,thumbnailUrl,durationSeconds}`; GET -> 200 after reload. Root independently witnesses the actual owner row. |
| 3. B privacy | Separate common login; initial B GET excludes A's row; B can PUT the same track ID independently. A deletion affects only A; restore A for later checks. Actual liked table `session_id` stores canonical account, not transient auth session. |
| 4. CSRF negative | Repeat a valid PUT and DELETE without CSRF (or mismatch) -> 403 `forbidden`; no row/revision change. Browser CORS rejection alone is not server-side CSRF proof. |
| 5. Full audio + renewal | Search/select the permitted full recording, resolve `/api/tracks/:id/stream` with trusted expected duration, decode actual audio, witness audible advancing playback. Observe ordinary `/api/auth/renew-context` and `/api/auth/renew` (`POST {}`, exact Origin/CSRF; renewal -> 204), successful protected operation beyond the initial short assertion and at >300s elapsed. Same canonical tuple, track, queue and collection retained; no restart or clearing; family absolute deadline does not slide. |
| 6. Preview rejection | The separate ~30s recording against its longer trusted reference -> 422 `preview_rejected`; unavailable trustworthy duration -> 503 `duration_unverified`, not playable success. Do not disable product guards to manufacture a passing audio case. |
| 7. Capability removal | Root's authority command removes only A's `tf.collections`; next protected liked GET/PUT/DELETE -> 403 `module_access_denied`, no write or collection deletion. Restore exact prior grant/revision through authority; B unchanged. |
| 8. Authority unavailable | Root's admitted isolated checker/JWKS failure -> 503/retry state on protected activity, not 401, `active:false` or entitlement-loss UI. Existing collection data is not erased. Restore exact dependency prestate; fresh login/current grants recover access. |
| 9. Definitive session revoke | Root revokes A's actual upstream session/family; next sensitive liked mutation -> 401 `unauthorized` and local termination, no write. A retained media command cannot resume protected playback; /auth/me alone is insufficient evidence. B remains live. Fresh approved login restores A's own data. |
| 10. Replay / cleanup | Root's protected replay executor rejects used OAuth code and stale renewal reference; only identical in-window D05 retry reuses its original result, no new family/rotation or extended lifetime. Execute exact cleanup below and verify poststate. |

Record method/path (without query secrets), status/code, monotonic elapsed time,
safe account/installation aliases, source/image/profile revisions and correlated
owner receipts. Native decoded/audible playback and repository rows are separate
evidence from UI responses. This plan does not claim physical phone/headset proof
or complete absolute-expiry soak; their acceptance stays separate.

## Exact Cleanup Manifest

Root creates and seals a private manifest before the first mutation. It contains
`runId`, `sourceCommit`, `profileRevision`, owner, admitted target IDs and prestate
hash/rollback receipts. Append every created ID immediately; ambiguous creation
must be reconciled before proceeding. Each target has `kind`, exact `id`/path,
owner, created-or-borrowed status, deletion order, expected pre/post revision and
restore-or-delete action. A null, missing or wildcard target never authorizes IO.

| Target set | Required exact scope / action |
| --- | --- |
| Authority grants and isolated outage | A/B account + exact grant IDs/revisions and checker injection ID; restore prior values/current-safe revision through root authority, restore dependency prestate first. Never overwrite intervening changes. |
| TF domain rows | Enumerated liked `(canonical account, track ID)` pairs, liked-order revision rows and play-history primary keys created by this run. Restore a borrowed row from protected prestate; delete only new rows. Do not sweep by timestamp, clear collections or delete shared search cache. |
| Session/identity objects | Exact TF family/transaction/session records and Redis key names captured by root; retire family/references before removing only provisioned A/B Auth/Platform identity, alias and installation objects through owner commands. No Redis FLUSH/KEYS glob or direct Auth table delete. |
| Media/local browser artifacts | Exact scratch/media file paths and newly created browser profile IDs under the admitted run workspace. Remove only owned artifacts; do not delete private prestate/rollback receipts. |
| Coolify/Docker resources | Exact Application/service UUID, container IDs, volume/network IDs created for this run, with owner labels and actual isolation witness. Borrowed existing resources are restore-only, not deletable. No broad prune, down -v or Caddy replacement. |

After domain/session cleanup and before resource teardown, root verifies zero
run-owned leftover rows and retired session material; after cleanup it
independently compares dependency/Caddy/service
prestate and ownership. Retain redacted outcome and exact private cleanup receipt.
An unfilled manifest is a blocker, not an empty-list cleanup success.

## Preparation Validation And Return

Verified current clean player source SHA/tree, accepted D05 ancestry, concrete
route/status/CSRF behavior, existing canary origins and renewal-disabled validator.
Only this document and the TF resume record change. Document links, candidate
objects, Dockerfile targets and embedded JSON are checked locally; unchanged
application suites, provider calls and real canary work are not repeated.

Return to Web Platform/root: this exact candidate and requirements, plus two open
inputs: root's admitted runtime/fixture/cleanup profile and a separately admitted
renewal-enabled canary binding. Preparation is complete; Task 3 real acceptance
remains open. Independent TF product work resumes from its existing checkpoint.
