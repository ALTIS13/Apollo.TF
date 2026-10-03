# TF Canary Renewal V2 Source Evidence

Status: **SOURCE_READY_FOR_OWNER_INTAKE**; not runtime admission.
Owner: Apollo.TF. Root owns shared Auth/Platform admission and activation.
Base `857c26b2218669408c6fd9766b2ad4174443758e`; source candidate
`1f49e426f694778850f6885e669b865471d6b1b7`. No image was built, published or
selected. Later report/resume commits do not add product code to this candidate.

## Contract And Scope

[Spec](../superpowers/specs/2026-10-03-tf-canary-renewal-v2-design.md), reviewed raw
SHA-256 `3df235cd20083b2e23f039badd37627b45dc7c2854080c05257c7345b4259dcc`.
[Plan](../superpowers/plans/2026-10-03-tf-canary-renewal-v2.md), reviewed prestate
raw SHA-256 `88327f10355cb0810c7bc7deb655c96e87578414b7dfb9694682c15a7526407b`;
its subsequent checkbox updates record progress, not contract changes.
Root's written return raw SHA-256 is
`a1f91e38a928d3cc99edcd83e7bff32ba34bfb352094ccbee90df311ae167814`.

The new additive profile `apollo-tf-canary-renewal.v2` has separate project,
networks, volumes and secret roots. One additional API-only revoke mount retains
the ten existing required API secret mounts. Client `apollo-tf-api`, audience
`apollo-tf`, issuer/API `https://api.canary.apollot.ru`, TF web
`https://tf.canary.apollot.ru`, TF API `https://api.tf.canary.apollot.ru` and
`/api/auth/callback` are unchanged. D05/wire/runtime code was not modified.

New source files:

- `deploy/coolify/apollo-tf.canary-renewal.v2.compose.yml`.
- `deploy/coolify/apollo-tf.canary-renewal.v2.git.compose.yml`, generated snapshot.
- `deploy/coolify/canary-renewal.v2.env.example`, non-admitted zero source/images.
- `deploy/coolify/canary-renewal.v2.profile.example.json`, names-only policy.
- `scripts/src/tf-canary-renewal-v2.ts`, validator/read-only file adapter/CLI.
- `scripts/src/tf-canary-renewal-v2.test.ts`, focused boundary cases.

The validator strictly parses the policy, checks v2 deltas, clones/project only
validated values and delegates common guards to unchanged v1. Both success and
failure leave caller objects unchanged. CLI arguments are strict; errors contain
safe machine codes, not input values, paths or child-process details. No command
performs deployment or reads key material.

## Validation

- Task 1 RED: missing module, then explicit not-implemented stubs exposed 33
  failures with the existing v1 compatibility case passing.
  One foreign-service fixture incorrectly assumed a web secret array; fixed the
  fixture to supply a real foreign mount, not the validator expectation.
  GREEN: 34 focused binding/policy cases.
- Task 2 RED: 12 new file/CLI cases failed for the missing entrypoint. GREEN:
  46 cases, including actual source/Git Compose JSON equality and a spawned Node
  CLI with controlled source receipt/HTTP origins. Synthetic completion hashes
  are source evidence only, not publisher/runtime receipts.
- `pnpm --filter @workspace/scripts exec vitest run src/tf-canary-renewal-v2.test.ts --maxWorkers=1`.
- Existing v1 CLI compatibility case only: `pnpm --filter @workspace/scripts exec vitest run src/tf-canary-compose-binding.test.ts --maxWorkers=1 -t 'validates the actual Git-backed and source Compose renders through the CLI'`: 1 passed, 24 intentionally not run.
- `pnpm --filter @workspace/scripts run typecheck`: PASS.
- Targeted Prettier checks and staged `git diff --cached --check`: PASS.
- All nine frozen raw pins from the reviewed spec: unchanged. No UI, D05,
  whole-application or unaffected provider suite replay.
- Independent source review identified two P1 mount-isolation bypasses and one
  P2 credential-pointer alias. The actual bad inputs reproduced structural PASS
  before the fix: volume-driver host bind, file config keyring copy, normalized
  admin credential alias and inherited API mounts. Four focused RED cases then
  passed after rejecting alternative mount surfaces and credential aliases.
  Final affected file: **50 passed**; scripts typecheck passed after these fixes.
  No minor findings were deferred and no second duplicate review was run.

Review exclusions remain intentional: real custody, Auth/SQL/D05, signed/current
profile, deployment and runtime/fixture/cleanup admission belong to root, not
this source validator. Rejecting configs/inherited mounts/volume driver options
is appropriate for this exact profile, which has none; a future profile needing
those surfaces requires a new bounded contract review rather than weakening v1.

## Source Candidate Pins

| New file | Raw SHA-256 |
| --- | --- |
| `deploy/coolify/apollo-tf.canary-renewal.v2.compose.yml` | `8ae5a03b99a1788fd4685bb9137e9a10a64f018492ff7a3584ab5ab19c5fa7cf` |
| `deploy/coolify/apollo-tf.canary-renewal.v2.git.compose.yml` | `e225c679469230132a8a82169ce363a7df6850a012f4460a0d8997b99b94bee5` |
| `deploy/coolify/canary-renewal.v2.env.example` | `57cea200ce543d0994f29677218fffa76eb97614ba8b9ffc1a0427bc91a72450` |
| `deploy/coolify/canary-renewal.v2.profile.example.json` | `7f83251f818504f2ba9e65f769bc7583e56a96502482a140edfe1387f7c39e9f` |
| `scripts/src/tf-canary-renewal-v2.ts` | `d08d26cec54208fff365f52063df86649ffd61110af27f8ab8436820d3f9824f` |
| `scripts/src/tf-canary-renewal-v2.test.ts` | `0217775743fdfd696cc315b1157e4d82e718c02d0a3f4fe953fc45445f5c526d` |

Unclaimed image proposal: `v0.1.0-canary.20261003.1f49e42` from the exact source
above, for the unchanged nine custom repositories under `ghcr.io/altis13/`:
`apollo-tf-postgres`, `apollo-tf-api`, `apollo-tf-web`, `apollo-tf-admin`,
`apollo-tf-search`, `apollo-tf-integrations-postgres`, `apollo-tf-integrations`,
`apollo-tf-download-worker`, `apollo-tf-download-redis`. The tenth/external image
retains `docker.io/library/redis@sha256:595cc6f2bb3af6e03347b90deb6123c6aa2c81dea05ce08128de8a174b6ac67b`.
These are proposals, not accepted digests; no remote tag-availability claim was
made. `publisher_preflight_required` is unchanged. No prior source/image is
relabeled as this successor.

Installed Docker Compose `v5.4.0` produced the new standalone snapshot with:

```powershell
docker compose --env-file deploy/coolify/canary-renewal.v2.env.example `
  -f deploy/coolify/apollo-tf.compose.yml `
  -f deploy/coolify/apollo-tf.canary.compose.yml `
  -f deploy/coolify/apollo-tf.canary-renewal.v2.compose.yml `
  config --no-interpolate --no-path-resolution `
  --output deploy/coolify/apollo-tf.canary-renewal.v2.git.compose.yml
```

This runs config only, not the Docker daemon lifecycle. Renders contain twelve
active services and ten image identities. Existing loopback ports `19201-19203`
remain a root prestate gate; a source render never permits stopping v1 to free
those ports.

## Read-Only CLI

From the repository's `scripts` directory, using completed source evidence and
the operator's names-only v2 environment, the validated launcher form is:

```powershell
node --import tsx -- src/tf-canary-renewal-v2.ts `
  --release-manifest '<source-evidence>/apollo-tf-release-manifest.json' `
  --env-file '<operator>/tf-canary-renewal.v2.env' `
  --profile 'deploy/coolify/canary-renewal.v2.profile.example.json'
```

Arguments are resolved from repository root, not shell cwd. The local pnpm/tsx
launcher attempts to consume `--env-file` before the application; a direct Node
invocation with `--` is proven by the real subprocess test. Unknown `--deploy`
arguments were also rejected as `invalid_arguments` in the actual CLI process.

Successful structural validation exits zero but always returns
`evidenceLevel=source-binding-only`, `activationAllowed=false` and blockers
`runtime_admission_required`, `fixture_admission_required`,
`cleanup_admission_required`, `keyring_custody_unproven`. It is not a launch gate
or signed/current profile/public-key acceptance. Real keyring regular-file,
runtime UID, `0400`, no-symlink and distinct-key custody stay with root/runtime.

## Remaining Work

Root owns issuer/JWKS/client registration, runtime/fixture/cleanup admission,
native recovery, source/image selection, publisher and Coolify execution.
No private profile, Auth/SQL, SSH/Caddy/UFW, publisher credential, key generation
or existing container was touched. Production and v1 bytes are frozen.

Independent next TF slice: replace one unavailable recording while preserving
the live queue. Read-only analysis pins occurrence ID plus security/load
generation, SPA recovery navigation, an explicit result callback and no stale
fallback into ordinary `playTrack`. It does not add a new account, offline or
cross-device authority. That product source has not been changed in this slice.
