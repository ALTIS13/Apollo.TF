# TF Canary Release Candidate - 2026-10-02

Status: **SOURCE_PREPARATION_PASS / PUBLISHER_BLOCKED**. This is an unclaimed
candidate bound to the completed native Coolify build, not a release receipt,
registry publication or authenticated runtime activation.

## Current Selection

| Input | Exact value |
| --- | --- |
| Built application source | `f3828eb016e9dc034030e2da7ca2c2a39f4327c1` |
| Proposed, unclaimed release ID | `v0.1.0-canary.20261002.f3828eb` |
| Archive SHA-256 | `467f204efb5c6cd212618af25f5dc5ca43949ab22d8a26cb43ef050de408620f` |
| Archive size | 11,407,360 bytes |
| Web API origin | `https://api.tf.canary.apollot.ru` |
| Validated operator checkpoint | `72ec58e338056da1ea673daf33e92a5ca623c0e0` |
| Image profile | Existing nine TF custom targets, `linux/amd64`, plus external pinned Redis |

Application source and operator HEAD are deliberately different. The source
archive in `.ops-private/coolify-native-20261001/source-f3828eb.tar` is the
already-built Git object, not a new archive of a later documentation/tool commit.
The catalog, Dockerfiles and lockfile have no delta from that source. The
[September candidate](2026-09-27-tf-canary-publisher-preflight.md) is retired;
its tuple remains historical, never mixed into this candidate.

## Validation

- Recomputed the retained archive's SHA-256; it matches the selection above.
- Existing focused preflight tests: seven passed, zero failed. Includes an
  actual `git archive` hash, changed tuple/archive/claim rejection and canary
  guards for both TF-only and legacy prepare/publish paths. No new tests.
- Independent scoped spec/quality review: approved source-only, no findings.
- Ran `pnpm --silent release:preflight:tf-canary` at the clean operator
  checkpoint above. Actual result: `sourceBlockers: []`, nine proposed custom
  tags, `decision: blocked`, all six unresolved native gates, exit code 1
  as designed, empty stderr. The claim/output paths remain absent and Git
  remains clean. Redacted CLI records are retained privately in
  `.ops-private/tf-release-candidate-20261002`.
- Reused [native packaging evidence](2026-10-01-tf-coolify-native-build.md);
  no Docker rebuild, image retag/push, remote write, HomeNode/Caddy/UFW/DNS
  change, provider request or application suite in this stage. Retained local
  image IDs are not GHCR digests or independent registry pull evidence.

## Outstanding Admission

The executable preflight still reports exactly:

1. `new_publisher_custody_unproven`
2. `toolchain_custody_unproven`
3. `docker_auth_session_unproven`
4. `ghcr_write_access_unproven`
5. `all_nine_tags_unproven`
6. `competing_publisher_absence_unproven`

The publisher custody, same-PAT effective write proof for all nine repositories,
separate Coolify pull credential and immediate tag/exclusivity checks follow the
[existing pre-claim procedure](2026-09-27-tf-canary-publisher-preflight.md#pre-claim-native-read-only-gate),
but use this new tuple. Tag absence has not been checked. No claim, manifest,
receipt, digest or package write is synthesized from native packaging evidence.
The guard in `operator-release.ts` remains unchanged.

Platform's current owner response supplies no completed runtime receipt for
Auth -> Platform -> TF. Its saved canary/registry records show the required
issuer/JWKS, confidential TF client, entitlement and restore checks still lack
the end-to-end receipt; the historical publisher token expired on September 28.
That response audited stored records, not live service health or current token
permissions. TF does not duplicate Platform identity/policy authority or
provision its canary from this source-preparation task.

## Continuation

Source preparation is complete: do not reselect the same tuple, rerun unchanged
packaging or remove the guard just because local checks pass. The coordinator's
publisher/Platform runtime admission remains the release critical path. TF can
advance the still-open collection batch-action UX independently, without new
identity, offline or cross-device authority. Any later listener changes are
not part of this frozen built candidate until a separately source-matched build
is recorded.
