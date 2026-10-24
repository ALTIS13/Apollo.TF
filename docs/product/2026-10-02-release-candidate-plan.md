# TF source-matched release preparation - 2026-10-02

## Scope

Continue the completed [native packaging stage](2026-10-01-container-candidate-plan.md).
Select the exact already-built source, not the newer documentation/operator HEAD.
Refresh the read-only publisher preflight; do not repeat builds or accepted
listener implementation. This preparation does not claim a release or authorize
registry writes, canary activation or changes to Platform/HomeNode services.

## Global Constraints

- Built source: `f3828eb016e9dc034030e2da7ca2c2a39f4327c1`.
- Source archive SHA-256: `467f204efb5c6cd212618af25f5dc5ca43949ab22d8a26cb43ef050de408620f`.
- Proposed, unclaimed ID: `v0.1.0-canary.20261002.f3828eb`.
- Web API origin: `https://api.tf.canary.apollot.ru`.
- Reuse `.ops-private/coolify-native-20261001/source-f3828eb.tar` and the
  existing nine custom targets plus external pinned Redis. Image IDs are not
  registry digests; packaging proof is not authenticated runtime acceptance.
- Keep every native publisher gate and the canary prepare/publish guard.
  No new test abstractions, duplicate tests or unrelated application suites.
- Preserve the retired September tuple as historical evidence. Platform owns
  identity, policy and entitlement admission; TF must not provision it here.
- Use reused, bounded agents with no recursive delegation. Keep private
  recovery evidence; do not delete it under a generic workflow cleanup rule.

## Tasks

1. Complete: update only the frozen candidate data and its CLI archive path in
   `scripts/src/tf-canary-publisher-preflight.ts`. Reuse the existing focused
   test file, including its actual Git archive check and no-claim assertions.
   Seven existing tests pass; independent spec/quality source review has no
   findings. No test or guard implementation changed.
2. Complete: run the real read-only CLI from a clean operator checkpoint;
   capture its redacted report privately. Expected: no source blockers,
   `decision: blocked`, all six unresolved native gates, no claim/output.
   Actual result matches at `72ec58e338056da1ea673daf33e92a5ca623c0e0`;
   exit 1 as designed, empty stderr and unchanged clean checkout.
3. Complete: review the scoped change, record current integration dependencies
   and the separation between built source and operator commit, then update
   the single resume record and push only owned changes to the feature branch.

See [current operational record](../operations/2026-10-02-tf-canary-release-candidate.md).
Source preparation is complete; native publisher and Platform runtime gates
remain separate. The following documentation checkpoint has no product-source
delta and does not invalidate the recorded clean-checkout preflight.

## Workflow

The worker owns Task 1's source file; the controller owns plans, operational
notes and Task 2 execution. A reused reviewer checks the bounded diff once
without replaying tests. Broad branch reviews, new approval rounds, model
overrides and evidence deletion from the generic skill are not required by
this approved continuation and conflict with the user's workflow constraints.
