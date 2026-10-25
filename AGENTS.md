# Apollo.TF — Kimi project guide

This is the authoritative repository guide for Kimi. The current task brief,
checked-out source, tests, and explicit owner instructions take precedence over
historical plans and handoffs. Do not infer a new implementation, release, or
deployment assignment from old documents.

## Purpose and current state

Apollo Track Finder (TF) is the `TF` product in the shared Apollo ecosystem.
This pnpm workspace contains its API, web listener, mobile client, admin UI,
search/integrations/download services, shared contracts, and release tooling.

The consolidated source line includes the operator release publisher, unified
Platform/TF integration, listener experience, and the preserved external v1
contract and Apollo Account staging work. Source completeness is not runtime
acceptance. No live Auth, production deployment, physical Android, provider
OAuth, or full-audio result is implied by a green local suite.

Historical checkpoints remain useful evidence, especially
`docs/product/tf-listener-resume.md` and the dated operational handoffs, but they
do not reopen accepted stages or authorize repeating their work.

## Architecture and ownership

- `artifacts/api-server`: TF Express API, authentication consumer, collections,
  streaming, queue orchestration, cache, and persistence.
- `artifacts/music-player`: React/Vite listener web application.
- `artifacts/trackfinder-mobile`: Expo/React Native mobile client.
- `artifacts/admin-dashboard`: operational administration UI.
- `artifacts/tf-search`, `artifacts/tf-integrations`, and
  `artifacts/tf-download-worker`: separately deployable TF services.
- `artifacts/platform-api`, `lib/platform-contract`, and `lib/platform-db`:
  vendored Platform compatibility and contract code. The current Apollo
  Platform repository remains authoritative for new shared Platform runtime
  work; do not create a second identity or login authority here.
- `lib/api-spec`: OpenAPI source of truth. Update generated clients through the
  established generation flow; do not hand-edit generated output in isolation.
- `lib/api-client-react`, `lib/api-zod`, `lib/db`, and the other `lib/*`
  packages: shared clients, schemas, persistence, and module contracts.
- `scripts`: release, deployment-contract, and validation tooling.

Ownership boundaries are mandatory: Supabase Auth owns identity and upstream
sessions; Platform owns stable account/installation identity, policy,
entitlements, admission, and audit; TF owns only TF runtime/BFF/player behavior
and TF storage; GAP owns network control and runtime. Quasar and Apollo.AI own
their respective client/update and AI runtime boundaries.

Module codes are extensible, not a closed enum. Preserve the compatibility
capability keys `tf.search`, `tf.integrations`, `tf.downloads`, and
`tf.collections`. Unknown or unsupported modules/capabilities never grant
access: fail closed and preserve established identity and contract boundaries.

## REA routing

Route every request–execution–acceptance (REA) cycle to the authority that owns
the behavior and the evidence:

| Request area | Execution owner | Acceptance boundary |
| --- | --- | --- |
| Login, identity subjects, upstream session lifecycle | Supabase/Platform through the current assigned parent task | Real issuer/JWKS/session evidence; TF must not add another login |
| Entitlements, installations, admission, account audit | Platform | Platform-owned contract and runtime receipts |
| TF search, playback, collections, integrations, downloads, TF API/UI/storage | Apollo.TF | Affected source tests plus explicitly admitted runtime proof |
| Network subscriptions, routes, bundles, peers, rooms, telemetry | GAP | GAP-owned runtime evidence |
| Windows updater/artifact verification or AI workloads | Quasar or Apollo.AI | Respective owner evidence; no TF shadow authority |
| Release publication, infrastructure, ingress, production data | Root/operator under a separate explicit assignment | Source-matched images, protected custody, scoped runtime and rollback receipts |

If a request crosses boundaries, keep the TF change scoped and hand the other
owner a precise contract/evidence requirement. Do not silently execute the other
owner's stage. Distinguish request preparation, source execution, and real
acceptance; a handoff or local preview is not acceptance.

## Infrastructure and release boundaries

Use the existing pnpm and OpenAPI/code-generation flows. Keep TF data stores and
backend ports private; route only explicitly approved public hosts through the
established ingress. Never share Platform Redis with TF auth/cache or the TF
download queue. Secrets are file-backed and owner-supplied; never print or
commit credentials, tokens, DSNs, private operational notes, or credential-
bearing remote URLs. `.ops-private/` is not startup context.

Release commands are operational actions, not routine verification. Do not run
publication, deployment, migration, registry, or infrastructure mutation without
current authority, a read-only impact check, rollback, and scoped validation.
Old release IDs, image digests, runtime claims, device inventories, and tool
catalogs are historical unless revalidated.

The listener checkpoint leaves root-owned runtime activation and real
issuer/JWKS/client/entitlement/recovery receipts pending. The preserved Apollo
Account staging slice still requires its pinned PostgreSQL 17/GoTrue staging
proof and owner-reviewed extraction/custody; local unit tests do not close that
gate. Mobile release validation targets an Android APK through ADB only when
explicitly assigned; Expo Go/static deployment is not release validation.

## Unfinished product work

The listener checkpoint identifies artist/discovery-to-library navigation as
the next product gap. Do not restart accepted lyrics, playlist, recommendation,
renewal, or release stages merely because their documents remain in the tree.
Runtime acceptance, provider OAuth/library behavior, decoded full-track audio,
and physical mobile validation remain separate observations with their own
authorization and evidence requirements.

## Working rules

1. Check `HEAD`, branch, and dirty state before editing. Preserve other owners'
   changes and keep commits focused. Do not delete branches/worktrees or commit
   caches, dependencies, generated artifacts, or `.worktrees/`.
2. Current source and tests override old conversations. Use test-first
   red/green/refactor for behavior changes and bugfixes; reproduce failures on
   the pre-change baseline before calling them pre-existing.
3. Read only task-relevant historical sections. Do not treat historical
   authorization, tools, agents, or deployments as currently available.
4. Report exact commands, pass/skip/fail counts, environment limitations, and
   unproven runtime boundaries. Never turn skipped integration tests into PASS.

## Verification

Use the workspace-pinned `pnpm@10.33.2`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --build --force
pnpm -r --if-present test
pnpm run typecheck
pnpm run build
```

`pnpm exec tsc --build --force` is intentional for fresh or copied worktrees:
it prevents stale copied build metadata from being mistaken for current
library declarations. `pnpm run build` includes the normal typecheck followed
by every package production build.

Focused checks used for the consolidated account/contracts work are:

```sh
pnpm --filter @workspace/platform-contract test
pnpm --filter @workspace/platform-contract typecheck
pnpm --filter @workspace/platform-db test
pnpm --filter @workspace/platform-db typecheck
pnpm --filter @workspace/platform-api test
pnpm --filter @workspace/platform-api typecheck
pnpm --filter @workspace/scripts typecheck
pnpm --filter @workspace/scripts exec vitest run --maxWorkers=1 src/apollo-account-staging-contract.test.ts
```

### Consolidation verification: selected greens are not full acceptance

Task 5 passed workspace typecheck, 21 selected non-root/non-mobile package
builds, 434 music-player tests, 24 Platform contract tests, and the focused
API bundle-boundary check. Other focused results are recorded in the Task 5
report. They do not make the full workspace or release acceptance green:

- The root production build remains blocked at mobile because Metro port
  `8081` is occupied; this reproduced on the pre-merge baseline.
- Operator-release real-child tests hit timeout/Corepack-shim failures in the
  Electron-hosted environment. The latest full TF search run was 302 passed,
  1 skipped, 2 failed: `bundle-startup.test.ts` and
  `deployment-contract.test.ts` retain Electron child-environment failures.
- Some native credential/temp tests fail with Windows `EPERM` during cleanup.
- Canary Compose rendering requires unavailable Docker, and the pinned canary
  archive hash differs in this Git/runtime. Do not rewrite that hash merely to
  manufacture a pass; revalidate it under the original evidence environment.

Docker/Compose and real PostgreSQL integration cases require their declared
local dependencies and fixtures. Record unavailable Docker as an environment
limitation and integration tests without a configured database as skipped; do
not weaken contracts or substitute fabricated runtime evidence. Full Auth,
provider, audio, mobile, deployment, and production acceptance remains open.
