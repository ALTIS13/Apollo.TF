# TF Canary Renewal V2 Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` with one independent
> bounded source reviewer; preserve the existing isolated checkout. Steps below
> become executable only after the coordinator's written source-contract review.

**Goal:** Close the renewal-false source/config gap without changing v1 or
production defaults or implying live admission.

**Architecture:** New v2 overlay/profile/Git entrypoint and pure validator.
Validate additive fields first, deep-copy/project to unchanged v1 common checks.
Read/config CLI always returns source-only evidence with activation denied.

**Tech Stack:** Existing TypeScript/Node/Vitest and Docker Compose config only;
no new dependencies, daemon/restart or deployment.

**Spec:** [V2 source contract](../specs/2026-10-03-tf-canary-renewal-v2-design.md).

## Global Constraints

- Base `857c26b`; only owned resume record is initially dirty.
- Frozen files/raw pins in spec remain byte-identical; no D05/wire edits.
- Exact approved canary tuple/client/audience; all runtime gates stay closed.
- No keys/private profile/Auth/SQL/Coolify/publisher operations or new tooling.
- New source changes imply a new source SHA/image candidate, never `113f6e9`.
- Focused checks only; preserve evidence and owned-file staging.

## Review Focus

- Clone projection must not normalize an invalid v2 field into a valid v1 value.
- File secret declarations do not establish actual mode/UID/no-symlink custody.
- Alternate service mount or client-secret alias must not expose revoke keys.
- Snapshot parity and frozen byte pins must survive mechanical generation.
- Valid source evidence or dummy signature cannot admit actual activation.

## Task 1: Strict Profile And Additive Binding

**Files:** create `scripts/src/tf-canary-renewal-v2.ts` and `.test.ts`.
**Interfaces:** exact parser/validator/result in spec; consumes existing
`TfOnlyReleaseArtifact`, `ComposeDocument`, pure v1 validator. Produces a blocked
source-only result; no caller mutation or public-key acceptance.

- [ ] Write regression: valid v2 configuration is accepted structurally but
  activation remains false with four admission/custody blockers; v1 rejects it.
- [ ] Run `pnpm --filter @workspace/scripts exec vitest run src/tf-canary-renewal-v2.test.ts --maxWorkers=1`; observe expected missing-feature RED.
- [ ] Implement exact strict profile, v2 checks, cloning and minimal projection.
- [ ] Add meaningful negative classes from spec and observe each missing guard
  fail before its fix; use parameterized variants instead of duplicate tests.
- [ ] Run the focused file; expect all cases pass and input snapshots unchanged.

## Task 2: Isolated Composition And Read-Only File Adapter

**Files:** create `deploy/coolify/apollo-tf.canary-renewal.v2.compose.yml`,
`apollo-tf.canary-renewal.v2.git.compose.yml`, `canary-renewal.v2.env.example`,
`canary-renewal.v2.profile.example.json`; extend only new v2 code/test files.
**Interfaces:** adapter consumes strict env/profile and verified existing release
artifact; renderer compares Git vs three source files using isolated env.

- [ ] Write file/render failures for missing inputs, invalid/duplicate CLI args,
  render failure, snapshot drift and unproven activation; observe RED.
- [ ] Create names-only overlay/env/profile with exact new resource roots and
  one revoke-only API secret mount. Keep old files untouched.
- [ ] Mechanically render the standalone Git entrypoint using installed Compose
  config (no daemon action). If unavailable, preserve source and report this
  concrete verification gap instead of installing another runtime.
- [ ] Implement bounded parser/render/file adapter and strict read-only CLI.
  Config PASS reports blocked activation; malformed input reports safe codes.
- [ ] Run focused cases and actual names-only Compose parity; expect exact JSON
  equality, twelve active services and ten images, with no release receipt.

## Task 3: Review, Evidence And Owner Return

**Files:** new `docs/operations/2026-10-03-tf-canary-renewal-v2-source.md` and
owned `docs/product/tf-listener-resume.md`; existing TF handoff is historical.

- [ ] Run new focused cases plus one existing v1 compatibility case, scripts
  typecheck, diff/link checks and spec raw-pin comparisons. No app/D05 suite.
- [ ] Dispatch one independent source reviewer after written design acceptance,
  giving exact diff and the five review-focus classes. Reproduce/fix material
  findings with targeted RED/GREEN; no acknowledgement loop.
- [ ] Record commands/results, exact new source SHA/changed raw pins and proposed
  unclaimed image tuple; keep actual runtime/fixture/cleanup status blocked.
- [ ] Commit/push only owned scope; send the changed candidate to root once.
  Continue independent TF queue-preserving replacement work, not live setup.
