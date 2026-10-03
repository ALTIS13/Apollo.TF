# TF listener release readiness, 2026-09-23

Status: source candidate and read-only infrastructure inventory. No release, deployment, Caddy reload, migration on HomeNode, or production acceptance is claimed.

## Target version correction

The TF core database image in `artifacts/api-server/Dockerfile` is PostgreSQL 16. The PostgreSQL 17 disposable proof in `tf-liked-proof-application.md` is a separate integrations/Supabase staging baseline and does not change the TF core runtime major. Playlist database validation therefore targets PG16, not PG17.

## Local database evidence

- Official [EDB PostgreSQL binary archive](https://www.enterprisedb.com/download-postgresql-binaries): Windows x64 PostgreSQL 16.15. Downloaded archive SHA-256: `25e6fcdfb8caec38691bf461125e7564508760666f7b8e5dc6a5f0818f58f81e`.
- Initialized a fresh UTF-8 cluster on loopback port 55476 with a unique `apollo_tf_test_playlists16sep23` database and exact `apollo.tf.integration-run:playlists16sep23` marker. Created separate non-superuser, NOINHERIT migrator/runtime roles. No existing database was used.
- `playlists.integration.test.ts`: 1 passed, 0 skipped on PG16.15. It used the canonical two migrations and the actual runtime store to check concurrent duplicate admission, owner denial, persisted reorder and direct SQL state. After its cleanup both playlist tables had zero rows; both migration names remained in history.
- The cluster was stopped and port 55476 closed. This is local Windows database behavior, not native Linux/Coolify or authenticated HTTP evidence.

## HomeNode read-only snapshot

At 2026-09-23 16:35 UTC, the configured HomeNode SSH alias responded. Existing Coolify, Caddy and other listed application containers were running; this snapshot did not perform a full health or backup audit. Caddy was active and listening on 80/443. No TF container appeared in `docker ps`, and no listener appeared on the planned TF API/web loopback ports 18201/18202. Public TF hostnames resolved, but unauthenticated HTTPS probes failed with TLS alert `InternalError`; the root cause was not diagnosed. No configuration or service was changed.

## Release boundary

The [HomeNode preflight](homenode-coolify-preflight.md) still requires owner approval for exact resource/secret creation, backup and rollback evidence, then separate hostname cutover approvals. This TF branch has not been published or merged, and the source-only/local evidence above does not satisfy those gates. Root should review the exact source revision before any isolated Coolify staging Application is created. Validate Platform entitlement denial/grant, web login, API/DB readiness, and rollback in the isolated stage before considering Caddy changes.

## Coolify canary checkpoint, 2026-09-25

Owner: Apollo.TF web/API. Stage: `WAITING_DEPENDENCY`. Source: clean `codex/tf-listener-experience` at `2fea517f26b1325abcd362cce493dae0ceea1780`. No TF release, push, Coolify resource, migration, Caddy change, or live-login acceptance occurred in this checkpoint.

The user selected Coolify for the next container test. Read-only SSH to HomeNode confirmed 32 running containers (33 total), a healthy Coolify control plane, 93 GB free on the Docker filesystem, and no TF project, container, or local TF image. Caddy has no TF hostname block. The existing Platform API `/readyz` and Auth `/auth/v1/health` returned HTTP 502 through the loopback-resolved public ingress. The account staging Auth containers are not a substitute for the Platform OAuth/JWKS authority.

The release Compose files use fixed production project, volume, and network names; starting a second copy unchanged would not be isolated. TF browser sign-in also requires a consistent HTTPS Platform issuer/API origin, TF API callback, TF web origin, registered confidential client, and matching file-backed credentials. A TF-only web container would reproduce the current fail-closed unavailable screen, not prove a usable player. The root coordinator owns the separate Auth/Platform staging runtime and ingress binding; TF owns its candidate image and consumer-side validation after that dependency is ready.

Next action: root identifies the isolated Auth/Platform canary and exact non-conflicting ingress/secret/image bindings; TF then validates its own immutable image set and deploys into a separately named Coolify resource without touching existing services. Before any mutation, record the exact prestate, rollback image map, native secret permissions, free listeners, and backup/restore gate. After startup, verify `/api/auth/me` denial and grant, collection persistence, provider states, and a real browser session. Do not promote fixture-backed UI checks or loopback health to authenticated acceptance.

## Isolated TF Compose candidate, 2026-09-25

`deploy/coolify/apollo-tf.canary.compose.yml` is an override for `apollo-tf.compose.yml`, not a production replacement. Its rendered project is `apollo-tf-canary`; all five named volumes and ten networks use that prefix. It removes the external production Platform bridge and directs `tf-api` to the staging Platform public HTTPS origin with the private-HTTP bridge disabled. Canary ports are supplied only by the canary environment and must be checked against current HomeNode listeners before resource creation. No Caddy, UFW, DNS, Coolify, or container change is included.

Render with both files and `deploy/coolify/canary.env.example` using `docker compose --env-file deploy/coolify/canary.env.example -f deploy/coolify/apollo-tf.compose.yml -f deploy/coolify/apollo-tf.canary.compose.yml config --quiet`. The example deliberately has `.invalid` hostnames and zero image digests, so it is not a deployable environment. Local Compose v5.4.0 rendered the required `!override`/`!reset` merge tags: 12 active services and 29 secret names matched the base manifest, `platform-bridge` was absent, all secret file paths were canary-only, and only `127.0.0.1:19201..19203` were exposed. Rendering with the production env alone failed because mandatory canary paths, origins, and ports were missing. HomeNode reports Compose v5.0.2; its exact rendering remains a pre-deploy check.

Coolify stores [one Compose definition per resource](https://coolify.io/docs/applications/builds/docker-compose). Once real canary bindings exist, render both source files with the exact private canary environment to a single definition, inspect it for origin/path/port/image drift and absence of secret values, then give that definition to a separate Raw Compose resource. Review Coolify's deployable Compose before starting it; do not submit this override alone or use the example environment. Keep Coolify domain/proxy routing disabled because the existing host Caddy owns ingress.

Read-only HomeNode checks on 2026-09-25 found no listener on `19201..19203` and no Docker container, volume, or network named with the `apollo-tf-canary` prefix. This is a point-in-time collision check, not deployment authorization or a health result.

Before a real Coolify candidate: root supplies a functioning isolated Auth/Platform issuer/API and exact OAuth client/callback/allowed-origin registration; TF supplies source-matched immutable image digests and canary-only file secrets. The TF web image must be rebuilt with `VITE_API_URL` set to the canary TF API HTTPS origin, not the production build default. Recheck the rendered public origins, secret paths, image digests, project/volume/network names, free loopback ports, and database backup/restore plan before creating the resource. The canary is never merged into the production validator or launched against the current 502 Platform/Auth ingress.

## 2026-09-26 read-only inventory and web-image binding

The authenticated team-scoped Coolify inventory currently exposes one `LETSCUBE` project with five healthy applications, but no team-visible TF application, standalone database or service stack. This does not prove absence of Platform/Auth on the host or an empty environment in another team. No Coolify resource, HomeNode service, Caddy route, DNS record or migration was changed. The isolated TF target, current host capacity/listeners and healthy Platform issuer remain unverified, so deployment is **no-go**.

The TF-only release publisher now accepts an explicit canary API origin at both prepare and publish. It checks the non-production canary host, requires the flag for canary-tagged releases, and records the declared value in the claim, receipt, `tf-web` build argument and release evidence while leaving production's default unchanged. A one-file receipt substitution is rejected; these local files are not a cryptographic attestation. No image was built or published, and the local evidence does not independently prove the bundled URL in an image digest. The three canary hostnames in the private DNS note have since been created, but no TLS/application route exists yet. Recheck current Platform/Auth, registry pull, native secret permissions, image contents and the complete 12-service Compose target before a release attempt.

## 2026-09-26 DNS and image-inspection checkpoint

The owner created all three CNAME records: `canary.tf.apollot.ru`, `api.canary.tf.apollot.ru` and `admin.canary.tf.apollot.ru` point to `tf.apollot.ru`. Public DNS resolvers returned the CNAME chain and the current target A address `80.246.73.48`. This is DNS proof only; no canary TLS or application response was verified.

Read-only SSH through the configured `apollo-rga-homenode-local` alias passed the existing host-key check. At that instant there was no TF canary container, no exact canary hostname match under `/etc/caddy` and no listener on `19201..19203`. The current Platform ingress returned `502` for both `/readyz` and `/auth/v1/health`; no healthy isolated Auth/Platform dependency is established. No Caddy, Coolify, Docker, firewall or application change was made on HomeNode.

The source-side `release:verify:tf-web` command now requires both a validated TF-only manifest and an independently provided canary API origin. It pulls the web image by immutable digest, compares Docker `RepoDigests`, rejects an oversized image before copying, and requires the canary origin in the single executable JS entry loaded by `index.html` while rejecting embedded production API origins. Stopped inspection-container cleanup reconciles an exact owner label/name after an ambiguous create result. Nine focused tests and scripts typecheck passed. A local Vite build with the canary origin included that origin in JS and neither production API origin, but the actual GHCR image was not published or pulled; this is not an image attestation or browser network proof. Release remains **no-go** until the Platform issuer, TF client, isolated Coolify target, secret custody and rollback prestate are ready.

## 2026-09-27 Git-backed Application entrypoint

The Raw Compose option above is historical. For a separate Git-backed Coolify Compose Application, use `deploy/coolify/apollo-tf.canary.git.compose.yml` as its single Compose Location with Base Directory `/`. It is a flattened source-only snapshot of `apollo-tf.compose.yml` plus `apollo-tf.canary.compose.yml`; the canary release binding validator now rejects a rendered difference. Regenerate it from the repository root with `docker compose -f deploy/coolify/apollo-tf.compose.yml -f deploy/coolify/apollo-tf.canary.compose.yml config --no-interpolate --no-path-resolution --format yaml --output deploy/coolify/apollo-tf.canary.git.compose.yml` and retain the explanatory header. Keep Coolify proxy domains empty; only the existing Caddy may route exact canary names after a separately checked change.

The selected tuple is Platform issuer `https://api.canary.apollot.ru`, TF web `https://tf.canary.apollot.ru`, TF API `https://api.tf.canary.apollot.ru`, TF callback `/api/auth/callback` on that API, and Spotify callback `/api/spotify/callback`. The previously recorded `canary.tf.apollot.ru` and `*.canary.tf.apollot.ru` DNS names are not release inputs. The canary validator rejects coherent but unapproved alternative origins and ports; changing the target requires reviewed source and a new release, not only an env edit. Local synthetic Compose 5.4.0 rendering proved the Git file and source pair identical for that tuple: 12 services, 29 active secrets, and only API/web/admin loopback ports `19201..19203`. This is not a published image, target-host Compose, Coolify, Caddy, TLS, issuer or login proof. The ignored `.ops-private/tf-canary-git-application-packet.md` holds the names-only host admission and rollback packet; no HomeNode change was made.
