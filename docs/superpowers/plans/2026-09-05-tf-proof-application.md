# TF Disposable Proof Application Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent product task and review. Preserve the accepted proof runner.

**Goal:** Package the accepted liked-collection proof as an isolated, root-gated Coolify Application without deployment.

**Architecture:** Three Compose services: fresh PostgreSQL 17 on tmpfs, canonical TF migrator, and the existing Node proof runner. Private per-Application network; no shared databases, volumes, ports, Platform authority or Docker socket.

**Tech Stack:** Docker Compose, PostgreSQL 17, Node 20, existing esbuild/TF migrator.

**Spec:** `docs/operations/tf-liked-collection-postgres-proof.md` and coordinator's source-only execution brief.

## Constraints

- No HomeNode/Coolify writes, build/deploy, push, Docker Desktop startup or shared Platform edits.
- `8756bca` runner, integration tests and migrations remain unchanged.
- Root supplies a unique run ID, exact source revision, pinned PG17 image digest and three distinct private credentials. Only root authorizes `execute:<runId>`.
- Missing/mismatched approval fails before DB initialization or proof execution.
- Real acceptance is runner exit 0 and observed 3 passed / 0 skipped, never merely a successful container start.

## Task 1: Source Package

- [x] Add `deploy/coolify/tf-liked-proof.compose.yml`, explicit environment template and `artifacts/api-server/proofs/coolify/` bootstrap/entry scripts and Dockerfiles.
- [x] Bootstrap refuses an existing cluster, provisions fixed least-privilege roles and run-marked database. Migration wrapper invokes the existing TF migrator using a private temporary URL file; runner receives only runtime credentials.
- [x] Emit bounded redacted runner output plus terminal outcome with source/run identity and transcript SHA-256. Export through Coolify logs before removing the Application.
- [x] Validate Compose without a daemon, shell/Node syntax, migration bundle and fail-closed entry gate. Do not add tests of the accepted tests or rerun green product suites.
- [x] Verify source content binding against the clean committed checkout. Review found that an operator-supplied SHA alone was not provenance; build now requires a separately computed Git-content digest. Git/local digest matched on `08a1355`; wrong digest rejected with exit 2.
- [x] Independent review, local commit, exact root execution handoff with pending real DB evidence. Package `05d162b`, no remaining source-only review finding. Runbook: `docs/operations/tf-liked-proof-application.md`.

## Task 2: Independent Product Gap

- [x] Read current product spec/code; send root one concrete unimplemented gap before edits. Root confirmed removal of the duplicate sidebar queue.
- [x] Implement only that gap with focused behavioral validation and local UI inspection where applicable. No second queue or auth authority. Sidebar tests: 3 passed (2 regressions first failed). Desktop/mobile browser fixtures verify canonical queue state and mobile close; typecheck/build pass.
- [x] Commit separately and update the current implementation status; do not claim deployment/full-stack proof. Sidebar commit `08a1355`; real DB/container execution remains pending.
