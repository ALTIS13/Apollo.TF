# Apollo Account Staging And Identity Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute this plan inline. Do not dispatch another task or create a user-owned chat.

**Goal:** Produce a reproducible, loopback-only self-hosted Apollo Account staging stack and a small server-side Supabase-session adapter that resolves an exact identity tuple to the existing stable Platform account.

**Architecture:** A new isolated `apollo-account-staging` Coolify Application, reproducibly sourced from the private `ALTIS13/Apollo.Platform` Git repository and its Compose manifest, uses the pinned Supabase self-hosted `v0.8.0` database, Auth, and Envoy components plus an internal Mailpit SMTP capture. Apollo Platform validates the Supabase JWT and, for sensitive admissions, checks the exact `session_id`/`sub` pair through a dedicated least-privilege database role before resolving `(provider_code, identity_issuer, identity_subject)` to `accounts.id`; it does not issue another login session or merge identities by email.

**Tech Stack:** Docker Compose, Supabase Postgres 17, GoTrue, Envoy, Mailpit, PostgreSQL migrations, TypeScript, `jose`, Vitest.

**Spec:** `docs/contracts/apollo-platform/v1/OWNERSHIP_REVIEW.md` and `C:\Users\maksi\.codex\worktrees\369d\Apollo.GAP\docs\superpowers\specs\2026-08-24-apollo-unified-client-integration-contract.md`

## Global Constraints

- Supabase Auth owns identity, factors, access/refresh sessions, and JWT `sub`; Platform never stores a password or refresh token for this flow.
- Platform owns stable `account_subject`, account policy, installations, entitlements, admission, and audit.
- The identity key is exactly `(provider_code, identity_issuer, identity_subject)`; email never creates or merges a link.
- Production signup is disabled and initial accounts are admin-created or invite-only.
- No browser or client receives `service_role`, queries `auth.*`, or receives a database credential.
- The Coolify Application publishes only explicit loopback ports and must not alter Caddy, DNS, Quasar, AI, GAP, LetsCube, or any existing HomeNode container or volume.
- The existing Quasar HS256 issuer and its `auth.sessions` trust remain unchanged.
- The generic HomeNode PostgreSQL 18 volume is never attached to the fresh PostgreSQL 17 staging container.
- Images are tag-and-digest pinned, secrets are file-backed, and only task-owned Compose resources may be removed after tests.
- No commit, push, public cutover, offline entitlement, release signer, portal UI, or production account migration is part of this slice.
- New Platform material must not be pushed to the public `ALTIS13/Apollo.TF` repository. Extraction into private `ALTIS13/Apollo.Platform` happens only after review by the root coordinator.
- Permanent components are Coolify Applications from Git/Compose, never raw standalone Compose deployments or Coolify Service resources. Coolify visibility is not backup or HA.

---

### Task 1: Pinned minimal Apollo Account staging resource

**Files:**

- Create: `deploy/coolify/apollo-account-staging.compose.yml`
- Create: `deploy/coolify/apollo-account-staging.env.example`
- Create: `deploy/supabase/account/.supabase-version`
- Create: `deploy/supabase/account/UPSTREAM.md`
- Create: `deploy/supabase/account/roles.sql`
- Create: `deploy/supabase/account/envoy.template.yaml`
- Create: `deploy/supabase/account/envoy-entrypoint.sh`
- Test: `scripts/src/apollo-account-staging-contract.test.ts`

**Interfaces:**

- Consumes: operator-selected loopback ports and `APOLLO_ACCOUNT_SECRET_DIRECTORY` containing PostgreSQL password, legacy JWT secret, asymmetric JWT key set, and publishable key files.
- Produces: an auth-only `/auth/v1` gateway, private PostgreSQL/Auth/SMTP networking, public JWKS, and a captured-email test boundary.

- [ ] **Step 1: Write the failing Compose contract test**

  Parse `docker compose config --format json` with synthetic file paths and assert four services only, digest-pinned images, signup disabled, loopback publications, private database, distinct named volumes, health checks, bounded resources, `cap_drop: ALL`, `no-new-privileges`, and no `service_role`, LetsCube, Quasar, or existing volume names.

- [ ] **Step 2: Verify RED**

  Run `pnpm --filter @workspace/scripts test -- src/apollo-account-staging-contract.test.ts`; expect failure because the Compose artifact does not exist.

- [ ] **Step 3: Add the minimal Compose and provenance artifacts**

  Pin the self-hosted `v0.8.0` component versions and registry digests, require file-backed secrets, keep `db` and `auth` private, route only `/auth/v1`, and expose Mailpit UI only on its explicit loopback port.

- [ ] **Step 4: Verify GREEN and rendered configuration**

  Run the focused test and `docker compose config --quiet` with synthetic paths; both must exit zero without printing secret values.

### Task 2: Exact identity-subject mapping persistence

**Files:**

- Create: `lib/platform-db/migrations/0006_account_identity_subjects.sql`
- Modify: `lib/platform-db/src/migrations.ts`
- Modify: `lib/platform-db/src/migration-manifest.test.ts`
- Modify: `lib/platform-db/src/integration.test.ts`
- Modify: `artifacts/platform-api/src/domain/repository.ts`
- Modify: `artifacts/platform-api/src/domain/postgres-repository.ts`
- Test: `artifacts/platform-api/src/domain/postgres-repository.test.ts`

**Interfaces:**

- Consumes: verified provider code, exact issuer, exact identity subject.
- Produces: a unique active link to an existing `accounts.id`; no account creation and no email lookup.

- [x] **Step 1: Write failing manifest/repository tests**

  Require migration `0006`, exact tuple lookup, account-scoped result, duplicate tuple rejection, revoked-link denial, and no normalized-email query.

- [x] **Step 2: Verify RED**

  Run the focused platform-db and repository tests; expect missing migration/repository behavior failures.

- [x] **Step 3: Add the migration and minimal repository methods**

  Add an RLS-protected `account_identity_subjects` table and a lookup that sets verified identity context before selecting the link, then sets `app.account_id` before reading the account.

- [x] **Step 4: Verify GREEN**

  Run migration manifest, repository, and PostgreSQL integration tests. Existing credential/session tables remain untouched compatibility debt.

### Task 3: Supabase JWT, liveness, and Platform policy adapter

**Files:**

- Create: `artifacts/platform-api/src/domain/supabase-identity.ts`
- Test: `artifacts/platform-api/src/domain/supabase-identity.test.ts`
- Test: `artifacts/platform-api/src/domain/supabase-identity.integration.test.ts`

**Interfaces:**

- Consumes: a bearer access token, exact Auth issuer, public JWKS, a dedicated database connection limited to `CONNECT`, Auth schema `USAGE`, and column-level `SELECT(id, user_id)` on `auth.sessions`, plus the exact identity-link resolver.
- Produces: an immutable authenticated Platform context containing `account_subject`, provider session reference, authentication level, token expiry, and Platform account state.
- Ordinary authenticated reads accept a valid short-lived JWT. Sensitive release/download/offline-entitlement admissions additionally require the `auth.sessions` row for the exact JWT `session_id` and `sub`.
- Auth `/user` is not used as a strict revoke oracle. Supabase documents that access tokens remain valid until `exp`; session-row presence closes sign-out/deletion reuse only on the operations where it is checked. Time-box/inactivity cleanup has weaker semantics and must not be overstated.

- [x] **Step 1: Write failing adapter tests**

  Sign real ES256 fixtures and cover valid resolution, wrong issuer/audience/signature, missing `session_id`/`aal`, expired token, Auth-session rejection, identity subject mismatch, missing/revoked mapping, and suspended Platform account.

- [x] **Step 2: Verify RED**

  Run `pnpm --filter @workspace/platform-api test -- src/domain/supabase-identity.test.ts`; expect a missing-module failure.

- [x] **Step 3: Implement the minimal adapter**

  Use `jose.jwtVerify` with the issuer's ES256 public JWKS, check strict session presence only through an injected server-side least-privilege boundary, resolve the exact tuple, and apply Platform account state after Auth acceptance. Do not register a route or modify legacy login behavior.

- [ ] **Step 4: Verify GREEN and regression gates**

  Run the focused test, Platform API suite, Platform DB suite, scripts suite, affected typechecks, and `git diff --check`. A task-owned local Compose smoke may start only the new resource and must prove exact cleanup.

## Verified local checkpoint

- Migration manifest and RLS/repository RED/GREEN cycles completed.
- One-shot PostgreSQL 18 proof: `@workspace/platform-db` 40/40, including 19 real migration/RLS tests; Platform repository integration 8/8.
- Dedicated `auth.sessions` checker proof: 2/2 against a real isolated PostgreSQL role with column-level access only; reading an unrelated marker column returned SQLSTATE `42501`.
- Platform API serial regression: 448 passed, 24 skipped. Supabase identity unit tests: 25/25. Platform contract: 24/24. Staging Compose contract: 6/6.
- Target PostgreSQL 17 plus pinned GoTrue end-to-end signup/login/logout/JWKS proof remains required before staging is accepted. The local PostgreSQL 18 run proves SQL compatibility only.
- The temporary PostgreSQL proof cluster was stopped and its exact task-owned `%TEMP%` directory was deleted.

## Private repository extraction manifest

Root reviews and copies these paths into private `ALTIS13/Apollo.Platform`; this task does not move or publish them:

- Workspace roots: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, and only ignore/config files needed by the selected packages.
- Platform runtime: `artifacts/platform-api/**`.
- Shared Platform packages: `lib/platform-contract/**` and `lib/platform-db/**`.
- Account infrastructure: `deploy/coolify/apollo-account-staging.compose.yml`, `deploy/coolify/apollo-account-staging.env.example`, and `deploy/supabase/account/**`.
- Bounded validation: `scripts/package.json`, `scripts/tsconfig.json`, `scripts/src/apollo-account-staging-contract.test.ts`, and any directly imported script test utility proven by `rg` before copy.
- Reviewed documentation only: `docs/contracts/apollo-platform/v1/**` and `docs/operations/apollo-account-staging.md`.

Explicitly exclude TF UI/services/workers, admin dashboard, root mixed-product Compose, old production runbooks, `.ops-private`, `.env*` except reviewed examples, secrets, `node_modules`, `dist`, task render directories, Git metadata, and any LetsCube/Quasar/GAP/AI source. After extraction, replace workspace coupling with the smallest private lockfile and run the same Platform tests before any Coolify Application build. TF remains a separate consumer product.

GAP compatibility keeps `service_base_url` (for example `foundry.apollot.ru/v1`) separate from signed admission `iss`; neither field is derived from the other. The current GAP gate remains closed until a real Platform producer/JWKS exists.

## Live staging gate

Before any HomeNode creation, the coordinator must review the rendered Coolify Application manifest sourced from private `ALTIS13/Apollo.Platform`, Application name `apollo-account-staging`, the exact loopback ports, secret root `/var/lib/apollo-account-staging/secrets`, immutable image digests, and task-owned volume names. It must be visible in Coolify with container health/logs and reproducible from Git/Compose; no raw standalone Compose or Coolify Service substitute is accepted. Backup recipient/key custody remains `NOT_CONFIGURED`; therefore database migration, replacement, public Auth origin, Caddy cutover, and production account use remain blocked even if the isolated local smoke passes.
