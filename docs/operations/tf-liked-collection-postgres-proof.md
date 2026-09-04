# TF Liked Collection PostgreSQL Proof

Status: prepared for remote execution; no real PostgreSQL execution claimed.
The proof image has not been built locally.

## Execution Contract

- Infra owns all provisioning. Every proof/persistent container must be a Coolify
  Application. Do not use raw SSH/docker containers. This runner provisions nothing.
- Use the local `codex/tf-product-finish` commit adding this proof, or a supplied
  archive of that exact revision. The remote branch may not contain this proof;
  publication is not authorized by this runbook.
- Proof target: **PostgreSQL 17.x**, matching the coordinator's selected
  Supabase staging component snapshot. This is an explicit validation baseline,
  not a TF SQL feature requirement. It supersedes the initial PG18 selection.
  The legacy `lib/db/src/integration.test.ts` PG16 suite and migrations are
  not invoked or modified.
- Runtime login: `apollo_tf_runtime`, LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB,
  NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, no memberships. Do not pass admin or
  migrator credentials to the runner.
- Existing disposable database: `apollo_tf_test_<runId>`. `runId` must match
  `^[a-z0-9](?:[a-z0-9_]{6,30}[a-z0-9])$` (8-32 lowercase letters/digits/underscores).
- The database comment must be exactly `apollo.tf.integration-run:<runId>`.
  The infra owner applies this marker only to the designated disposable database.
- Apply the canonical TF migrations `0001_tf_core_collections.sql` and
  `0002_tf_runtime_privileges.sql` through the existing TF migrator first; matching
  `apollo_tf.schema_migrations` checksums are required. The runner performs no DDL,
  migration, role changes, truncate, reset, or database creation.
- `public.liked_tracks` must be owned by `apollo_tf_migrator`. Runtime needs schema
  USAGE, table SELECT/INSERT/UPDATE/DELETE, migration-history SELECT, and sequence
  USAGE. Runtime must lack table TRUNCATE, sequence UPDATE, and schema/database CREATE.

## Coolify Runner

Build context: repository root. Dockerfile:
`artifacts/api-server/proofs/liked-collection.Dockerfile`.
Use as a one-shot proof Application, no public domain, no persistent volumes, no
automatic restart after completion. Infra owns networking and cleanup.

Pinned image reused from the existing API build:
`node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`.
pnpm is pinned to `10.33.2`; `pnpm install --frozen-lockfile --filter
@workspace/api-server...` pins dependencies to the checked-in lockfile, including
Vitest `4.1.10`, pg `8.20.0`, Drizzle `0.45.1`, and Express `5.2.1`.
The runner image does not install or run PostgreSQL.

Supply through Coolify runtime secrets/environment, never build args or committed files:

```text
TF_TEST_RUN_ID=likedproof20260905
TF_TEST_RUNTIME_DATABASE_URL=postgresql://apollo_tf_runtime:<encoded-password>@<disposable-db-host>:5432/apollo_tf_test_likedproof20260905
```

Use the approved DB connection's TLS parameters as required. No ambient
`DATABASE_URL` is used; the runner removes it and the test substitutes only the
explicit test URL before importing the real store/database singleton.

Exact command from repository root (also the image CMD):

```sh
node artifacts/api-server/proofs/run-liked-collection.mjs
```

Equivalent focused Vitest command with both variables already supplied:

```sh
pnpm --filter @workspace/api-server exec vitest run src/routes/collections.integration.test.ts --maxWorkers=1 --reporter=verbose --testTimeout=30000
```

Prefer the Node runner: missing environment exits 2 rather than skipping the proof.

## Expected Evidence

Exit 0, **3 passed, 0 skipped**: three real-store cases.

1. SELECT with/without cursor: two interleaved owners, descending storage IDs,
   limit, exclusive cursor boundary, foreign-owner cursors, and exhausted pages.
2. Upsert: same track ID creates two owner rows; repeated identical saves preserve
   storage ID and historical `likedAt`; changed/null/restored metadata updates one
   row only; independent SQL proves row count, stored duration, and unchanged B.
3. DELETE: deleting A's shared track removes only that row; repeated deletion and
   A deleting a B-only track are no-ops; A's other tracks and every B row remain.

Fixtures use fresh random account UUIDs and interleaved inserts through the actual
`defaultLikedCollectionStore`, without mocking DB, Drizzle, or store methods.
Independent SQL sets historical timestamps, checks rows, and cleans up only the
two generated account IDs after each case. Cleanup asserts both accounts are empty.
Sequence gaps are expected and deliberately not reset. Infra still destroys the
disposable target through Coolify, including after interrupted/failed runs.

Retain redacted output, source revision plus proof patch identity, image digest,
PostgreSQL major, test counts, exit code, and Coolify cleanup result. Do not attach
credentials. A skipped run is not real PostgreSQL evidence. This proves
the TF store's application-level owner predicates, not Platform auth or RLS.
