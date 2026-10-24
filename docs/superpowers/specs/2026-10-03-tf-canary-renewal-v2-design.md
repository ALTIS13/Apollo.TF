# TF Canary Renewal V2 Source Contract

Status: **CANDIDATE_FOR_WRITTEN_SOURCE_REVIEW**, not runtime admission.
Owner: Apollo.TF; reviewer/admission owner: Apollo.Quasar root.
Base: `857c26b2218669408c6fd9766b2ad4174443758e`.
Direct user resumed coordination on 2026-10-03; root assigned this bounded
source/config gap after the [Task 3 handoff](../../operations/2026-10-03-tf-task3-consumer-handoff.md).
No D05, Auth, SQL, keys, live profile, publisher or production changes.

## Decision

Choose a separate `apollo-tf-canary-renewal.v2` profile, source overlay and Git
snapshot. Keep v1 renewal-false configuration/validator and production defaults
byte-identical. Do not broaden v1's accepted inputs. Duplicating its entire
validator would invite isolation drift; instead validate every v2-specific
field, deep-copy/project only those fields and delegate common checks to v1.
The caller's environment/Compose objects must not be mutated, even on failure.

This is an additive operator source contract, not a change to frozen TF/D05/F1
wire DTOs. The old `113f6e9` release proposal remains historical/unbuilt. Any
implementation uses a new exact source SHA and image candidate; no retagging of
`f3828eb`, `79ebdd6` or `113f6e9` as the successor.

## Files And Interfaces

New files only, apart from task evidence/resume documentation:

- `deploy/coolify/apollo-tf.canary-renewal.v2.compose.yml`: overlay applied after
  existing base + canary v1, enables renewal and mounts its revoke-only secret.
- `deploy/coolify/apollo-tf.canary-renewal.v2.git.compose.yml`: standalone
  image-only Git entrypoint, mechanically rendered from those three source files.
- `deploy/coolify/canary-renewal.v2.env.example`: names-only synthetic inputs,
  immutable image placeholders and non-admitted source marker; no real secrets.
- `deploy/coolify/canary-renewal.v2.profile.example.json`: strict policy below.
- `scripts/src/tf-canary-renewal-v2.ts` and matching `.test.ts`: independent
  parser, source binding validation and read-only file/render CLI.

```ts
parseTfCanaryRenewalV2Profile(value: unknown): TfCanaryRenewalV2Profile
validateTfCanaryRenewalV2Binding(
  artifact: TfOnlyReleaseArtifact,
  environment: Readonly<Record<string, string>>,
  compose: ComposeDocument,
  profile: TfCanaryRenewalV2Profile,
): TfCanaryRenewalV2Validation
```

The binding validator reparses the supplied profile as untrusted input; a
TypeScript cast cannot bypass the strict schema. Binding schema version 2 is
separate from the unchanged release artifact `formatVersion: 1`.

The result contains original `apiOrigin`, `imageCount`, `serviceCount`, exact
profile name, `evidenceLevel: "source-binding-only"`, `activationAllowed: false`
and fixed blockers `runtime_admission_required`, `fixture_admission_required`,
`cleanup_admission_required`, `keyring_custody_unproven`. There is no success
result that admits activation, including with a structurally valid fixture.
No signed profile/current public key is generated, read or accepted here.

File validation reuses existing immutable release evidence verification, strict
environment parsing and isolated Compose rendering behavior, but in new code;
v1's private helpers are not exported through edits. CLI permits only explicit
`--release-manifest`, `--env-file`, `--profile` paths. Missing/duplicate/unknown
arguments fail; command performs read/config validation only, never up/deploy.
Malformed inputs return a stable code without including input paths or values.

## Strict Names-Only Profile

Exact keys/literals; reject unknown fields, including keys, credentials,
admission assertions, overrides or public-key material:

```json
{
  "schemaVersion": 2,
  "profile": "apollo-tf-canary-renewal.v2",
  "clientId": "apollo-tf-api",
  "audience": "apollo-tf",
  "revokeKeyring": {
    "secretName": "tf_revoke_keyring",
    "mountPath": "/run/secrets/tf_revoke_keyring",
    "purpose": "apollo-tf-revoke-only",
    "ownerPolicy": "runtime-uid",
    "mode": "0400",
    "allowSymlink": false
  }
}
```

Actual keyring content/schema, live UID/regular-file/no-follow/mode enforcement
remain in unchanged `tf-renewal-runtime-config.ts`. Compose file-secret mode
declarations are not proof of host file mode/ownership. Root supplies distinct
runtime-owned `0400` regular non-symlink custody, real registered client, Auth/
JWKS/SQL/profile/fixture/cleanup admission and independent recovery receipts.

## Binding Invariants

- Exact issuer/API `https://api.canary.apollot.ru`, web
  `https://tf.canary.apollot.ru`, API/build origin
  `https://api.tf.canary.apollot.ru`, callback `/api/auth/callback` on that API,
  client `apollo-tf-api`, audience `apollo-tf`; no ports/alternate/production
  domains, private HTTP, static bridge PKCE or inline revoke key variables.
- `TF_RENEWAL_ENABLED=true` input and `APOLLO_TF_RENEWAL_ENABLED=true` service
  binding. Revoke env points only at `/run/secrets/tf_revoke_keyring`; top-level
  secret file equals normalized distinct
  `/var/lib/apollo-tf-canary/renewal-v2/secrets/tf_revoke_keyring`. API has exactly
  one mount, with exact source/target and mode `0400` (Compose numeric `256`).
  Declare mount UID/GID `10001:10001`, matching the unchanged API runtime user;
  these declarations still do not establish live ownership.
  No other service receives it; no duplicate mounts, client-secret aliasing,
  inline/external secret or host bind substitute.
- Project `apollo-tf-canary-renewal-v2`; ten networks named
  `apollo-tf-canary-renewal-<existing suffix>-v2`; five volumes named
  `apollo-tf-canary-renewal-<existing suffix>-v2`. Preserve existing internal
  flags, 12 active services, ten pinned images, image mapping and loopback
  `19201/19202/19203` ports. Port availability remains a root runtime gate.
- Secret roots exactly `/var/lib/apollo-tf-canary/renewal-v2/secrets` and separate
  `.../admin-credentials`; every existing secret retains its filename, not v1/
  production custody. Revoke file is additional, not a replacement credential.
- After v2 checks, project a deep copy to v1 names/renewal=false, remove only the
  validated revoke env/top-level secret/API mount and delegate common checks to
  `validateTfCanaryComposeBinding`. No other field is rewritten/ignored to pass.
- Render the new Git entrypoint and base + v1 + v2 overlay with isolated names-
  only env. Their JSON outputs must match. Any source/snapshot difference fails.
- Original D05 short assertion/absolute cap, canonical tuple, revoke/replay and
  unknown/outage semantics are unchanged. Source fixtures prove none of these
  as real runtime acceptance; prior accepted suites are not replayed.

## Focused Verification

Meaningful failing cases precede implementation: valid v2 source binding with
blocked activation; v1 rejects it; false/missing flag; wrong client/origin/image/
source; unknown profile field; inline key/PKCE/internal HTTP; wrong revoke path,
mode, missing/duplicate/foreign-service mount; reused client secret; v1 resource/
directory alias; public port/build/host bind; snapshot drift; failed input never
mutates caller. One parameterized locus per input class, no tests of test code.
Test file/render functions with generated disposable source evidence, not live
keys or a fabricated runtime receipt. Existing v1 representative compatibility
check, scripts typecheck, exact raw-pin comparison and independent source review
complete this slice. Do not run unchanged UI/D05/full application suites.

## Frozen Prestate Raw SHA-256

| File | SHA-256 |
| --- | --- |
| `deploy/coolify/apollo-tf.canary.compose.yml` | `9377c2de60a657cb1efd53a481dccfd28109b2b578d65386c99714d95f832aae` |
| `deploy/coolify/apollo-tf.canary.git.compose.yml` | `8969c0b52a4186036f813679f6673b22ab7fb7bd9e1351d0294b7deca3111c22` |
| `deploy/coolify/canary.env.example` | `d3d9db90bd271f5d73878fb72b313ba64f6e8a77876e999e46040c61e15177c6` |
| `scripts/src/tf-canary-compose-binding.ts` | `2b519cbef2193dbc23cb6b1cec999baf9a7952769ee41d6b438d2ddf4d6ed625` |
| `deploy/coolify/apollo-tf.compose.yml` | `b765c8d1f59c40d98bccddcbf1a40d78ed76fc1bb330f7b6e5cc864e769813c8` |
| `deploy/coolify/apollo-tf.production-binding.compose.yml` | `cca95ef5ba8c6e32a48e36fdb936d562882d8b708e114560457ba99d787094da` |
| `deploy/coolify/release.env.example` | `b8d8f8f3212bafca0320f8d762ad25ffec419903ffc1343f68d83851c812d418` |
| `scripts/src/coolify-release.ts` | `2268b32d08bc56452daecf80a503b403c79295e8a2f771833d106264edd8339b` |
| `scripts/src/operator-release.ts` | `267fbfed8cd64eb602104f9089f5d0281438715c24637ec8591eb250cff61e0f` |

The coordinator's written review fixes this contract before product source
changes. Independent TF product work can continue while that review is pending.

Read-only sidecar review confirmed the exported common validator and Compose
types are reusable without changes to v1. Its shared-resource suggestion is
not adopted: a separately admitted v2 candidate must not alias v1 custody or
resources. No release format/catalog change is required.
