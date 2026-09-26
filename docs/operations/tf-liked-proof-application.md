# TF Liked Proof: Disposable Coolify Application

Status: source-only package; **no image build or remote deployment evidence yet**.
This complements `tf-liked-collection-postgres-proof.md`. The current source adds
migration 0004 and a fifth real-store test; rebuild from a newly reviewed revision.

## Ownership And Root Execute Gate

TF owns these source files. The coordinating root/infra owner alone may publish
the reviewed revision, create a **new Coolify Application**, build and execute it.
No authorization to deploy follows from this document. No Supabase, Platform,
existing TF database, existing Application or production volume is involved.

Root must record approval for one Application UUID, one unused run ID, exact
40-character source commit and selected official PostgreSQL 17-bookworm digest.
The explicit runtime gate is `TF_PROOF_EXECUTE=execute:<runId>`. Leave it unset
until that approval. It is an operator guard, not a security boundary against an
administrator who can modify the Compose definition or source image.

## Exact Inputs

Compose path: `/deploy/coolify/tf-liked-proof.compose.yml` in the approved TF Git
revision. Build context is the repository root, not the Compose directory.
Use `deploy/coolify/tf-liked-proof.env.example` to identify runtime inputs:

| Input | Value/owner |
| --- | --- |
| `TF_TEST_RUN_ID` | New 8-32 lowercase letters/digits/underscores; first/last alphanumeric. Never reuse. |
| `TF_PROOF_EXECUTE` | `execute:<same run ID>`, set only by root after preflight. |
| `TF_PROOF_SOURCE_REVISION` | Reviewed full Git SHA, matching Coolify checkout. Public build argument. |
| `TF_PROOF_SOURCE_DIGEST` | Digest computed from that clean Git revision by `source-digest.mjs git <SHA>`; public build argument checked against actual copied source. |
| `TF_PROOF_POSTGRES_IMAGE` | `postgres:17.x-bookworm@sha256:<64 lowercase hex>` (or official `docker.io/library/` prefix). Root selects/verifies digest/architecture. No floating image default. |
| `TF_PROOF_ADMIN_PASSWORD` | New random 64-character lowercase hex secret, only PG bootstrap. |
| `TF_PROOF_MIGRATOR_PASSWORD` | Different new hex secret, only PG bootstrap and migration service. |
| `TF_PROOF_RUNTIME_PASSWORD` | Different new hex secret, only PG bootstrap and proof service. |

Secrets are runtime-only, never Git, build arguments, screenshots or public logs.
Root provides these through private Coolify environment management. No external
database URL is accepted: wrappers construct only `proof-db:5432` and the database
`apollo_tf_test_<runId>` within this Application. Inherited `DATABASE_URL`, PG
settings and Node loader settings are not forwarded to the runner/migrator.

Before root supplies build inputs, run from the clean approved checkout:

```sh
node artifacts/api-server/proofs/coolify/source-digest.mjs git <full-approved-SHA>
```

This refuses a different HEAD or dirty worktree and computes the expected digest
from **Git blobs**, not the working files. The image independently hashes its
actual copied source before bundling the migrator and refuses a mismatch. The
digest covers copied root manifests/configuration and `lib`/`api-server` sources
under the checked-in Docker ignore rules, with canonical UTF-8/LF text. Dependencies
and generated outputs are excluded; dependency integrity remains the frozen lockfile
and image-digest contract. The outcome carries both revision and source digest.
This guards stale/mismatched builds, not a malicious root replacing verifier code;
root must still verify the actual Coolify checkout and resulting image digests.

## Resource Contract

- Resource type **Application**, Git/Compose backed; not a Coolify Service,
  standalone `docker run`, or manual Compose stack launched through SSH.
- New resource name `tf-liked-proof-<runId>`, no domains, public ports or proxy
  labels; automatic deployment and automatic restart disabled.
- Do not connect it to the shared Coolify/predefined/external network. Effective
  services must share only the generated private internal `proof` network.
- Three services: `proof-db`, `migrate`, `proof`. No Docker socket or host bind
  mounts. PostgreSQL data is tmpfs, with no named/anonymous persistent volume.
  Node root filesystems are read-only; temporary files and Vite cache use bounded
  tmpfs mounts, never persistent test cache volumes.
- PostgreSQL bootstrap refuses an existing PGDATA directory, validates the
  execute gate and distinct credentials, and creates only fixed proof roles and
  the run-marked synthetic DB. Runtime has no role memberships, schema/database
  CREATE, TRUNCATE or sequence UPDATE. Canonical migration grants its DML rights.
- Migration waits for healthy TCP PostgreSQL, then invokes the existing TF
  migrator with a mode-0600 temporary URL file. It neither baselines old schemas
  nor maintains a second migration implementation. The file is removed on exit.
- Proof waits for migration exit 0 and launches the official
  `run-liked-collection.mjs`, with only the runtime credential and a 180s bound.
- Successful `migrate`/`proof` services are intentionally **exited (0)**, not
  long-running healthy web services. Do not enable a healthcheck/restart loop on
  them merely to make the Coolify Application indicator green.

Compose dependency behavior follows [Docker's startup-order contract](https://docs.docker.com/compose/how-tos/startup-order/).
Fresh initialization and PostgreSQL data-directory expectations follow the
[official PostgreSQL image](https://hub.docker.com/_/postgres).
Coolify's rendered definition must still be inspected before executing: if it
rewrites dependencies, adds mounts/networks, or treats one-shot exit as a reason
to redeploy, stop and resolve that through the Application configuration.

## Execution And Evidence

1. Root verifies a clean reviewed source revision, immutable image input, resource
   isolation, private environment and sufficient memory (PG tmpfs up to 512 MiB;
   service memory caps 768 MiB/1 GiB/1 GiB). No existing service is stopped to make room.
2. Root records explicit approval, configures the gate and deploys that **new**
   Application through Coolify. Source preparation here does not perform this step.
3. Export migration and proof logs through Coolify before cleanup into a private
   per-run evidence directory. Record the actual source checkout and built image
   digests from Coolify, not merely the operator-supplied SHA in the outcome.
4. Proof stdout contains the original bounded redacted terminal transcript followed
   by `tf_liked_proof_outcome`. Retained evidence is the exported Coolify container
   stdout log, not a file in `/tmp`: tmpfs disappears when its container stops.
   The JSON contains run ID, source revision/content digest, runner exit code/signal, observed
   passed/skipped counts, `accepted` and SHA-256 of the preceding redacted
   concatenated stdout/stderr transcript (ANSI controls stripped).
5. Accept only proof service exit **0**, official runner exit **0**,
   `accepted: true`, **passed: 5, skipped: 0**, correct run/revision and actual
   PostgreSQL17 identity/privilege checks from the real suite. A healthy DB, a
   migration-only success or missing outcome is not proof success. Non-zero,
   timeout, skipped/missing test counts or interruption is pending/failed evidence.
6. After preserving evidence, root removes only this recorded Application and
   confirms its containers/private network are gone and no persistent data volume
   was created. PG tmpfs disappears with its container. Do not run global prune,
   volume cleanup or SQL against shared infrastructure. Retrying requires a new
   Application/run ID/credentials and new approval, not a restart of old resources.

## Local Source Checks

No daemon is required for `docker compose ... config --format json`, Node syntax,
Bash syntax or bundling `build-migrator.mjs`. Use throwaway synthetic inputs for
configuration checks, never export a rendered Compose file containing live secrets.
The gate can be checked with missing environment: both entrypoints must refuse
before touching PGDATA or contacting a database.

These checks do **not** establish successful Docker image builds, Linux container
bootstrap, migration SQL execution, Coolify one-shot lifecycle, or the 5/0 proof.
Root owns those remaining validation gates. Do not rerun unrelated UI/store
unit suites to substitute for the missing real database evidence.
