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
