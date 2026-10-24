# Apollo TF Unified Platform Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Apollo TF consume the unified Apollo identity, installation, entitlement, status, launch, deep-link, and release-admission contracts while retaining TF runtime/API ownership.

**Architecture:** Supabase Auth remains behind Platform API as the identity and source-session authority. Platform issues bounded module decisions and one-time admissions; TF validates Platform assertions and decisions at its existing API/session boundary. The migration is additive: current `tf.*` grants remain valid compatibility inputs until measured retirement.

**Tech Stack:** TypeScript 5.9, Zod, Express 5, jose, PostgreSQL, Redis, Vitest, React/Vite, pnpm workspace

**Spec:** `docs/superpowers/specs/2026-08-24-apollo-tf-unified-platform-handoff-design.md`

## Global Constraints

- Do not execute this plan until the spec status is changed from `Proposed` to `Approved` by the cross-project owners.
- Keep top-level module keys exactly `QUASAR`, `TF`, `OLC`, `AWG`, and `AI`.
- Keep current `tf.search`, `tf.integrations`, `tf.downloads`, and `tf.collections` grants readable throughout the compatibility window.
- Supabase Auth owns identity and source sessions; TF never queries its tables and never receives `service_role`.
- Platform API owns policy, entitlements, module access, release/download admission, and root audit.
- Apollo.GAP remains the only authority for AWG/OlcRTC subscriptions, signed routes/bundles, nodes, rooms, runtime, and network telemetry.
- DTO changes are versioned and additive. Security boundaries reject malformed or unsupported schema versions.
- Every cross-service request carries `requestId`, `auditCorrelationId`, revision, expiry, and stable lowercase snake-case machine codes.
- Do not change HomeNode, Coolify, Caddy, UFW, DNS, containers, Supabase, or production data during implementation tasks. Deployment is a separately approved final stage.
- Use focused tests for changed contracts and enforcement paths. Do not add duplicate tests or run unrelated package suites after every task.

## Ownership Gate

Before Task 1, record one source repository and release owner for each of
`lib/platform-contract`, `artifacts/platform-api`, `lib/platform-db`, Supabase
adapters/migrations, and Quasar deep-link resolution. If Platform code moves to
another repository, move it once and consume its versioned contract package;
do not maintain two implementations. The approved ownership record is a hard
prerequisite, not an implementation task.

---

### Task 1: Add The Versioned Module Integration Contract

**Files:**
- Create: `lib/platform-contract/src/module-integration.ts`
- Create: `lib/platform-contract/src/module-integration.test.ts`
- Modify: `lib/platform-contract/src/index.ts`

**Interfaces:**
- Consumes: existing Zod conventions and current legacy entitlement constants
- Produces: `apolloModuleKeySchema`, `tfCapabilitySchema`, `apolloModuleAccessV1Schema`, `tfModuleStatusV1Schema`, `tfLaunchAdmissionRequestV1Schema`, `tfLaunchAdmissionV1Schema`, `tfPolicyDecisionRequestV1Schema`, `tfPolicyDecisionV1Schema`, `tfReleaseDownloadAdmissionV1Schema`

- [ ] **Step 1: Write focused contract tests**

```ts
expect(apolloModuleKeySchema.options).toEqual(["QUASAR", "TF", "OLC", "AWG", "AI"]);
expect(tfCapabilitySchema.parse("tf.search")).toBe("tf.search");
expect(apolloModuleAccessV1Schema.parse(allowedAccess)).toEqual(allowedAccess);
expect(apolloModuleAccessV1Schema.safeParse({ ...allowedAccess, schemaVersion: 2 }).success).toBe(false);
expect(tfLaunchAdmissionV1Schema.safeParse({ ...launch, accessToken: "secret" }).success).toBe(false);
expect(tfModuleStatusV1Schema.safeParse({ ...status, providerToken: "secret" }).success).toBe(false);
```

Use one fixture per DTO family and table-driven invalid cases for duplicate
capabilities, invalid revision strings, expired/invalid timestamps, unknown
decision codes, and forbidden extra fields.

- [ ] **Step 2: Run the new test and confirm RED**

Run: `pnpm --filter @workspace/platform-contract test -- src/module-integration.test.ts`

Expected: FAIL because `module-integration.ts` and its exports do not exist.

- [ ] **Step 3: Implement strict additive schemas**

```ts
export const APOLLO_MODULE_KEYS = ["QUASAR", "TF", "OLC", "AWG", "AI"] as const;
export const TF_CAPABILITIES = [
  "tf.launch",
  "tf.search",
  "tf.playback",
  "tf.integrations",
  "tf.collections",
  "tf.downloads",
  "tf.release.download",
  "tf.admin.observe",
] as const;

export const apolloModuleKeySchema = z.enum(APOLLO_MODULE_KEYS);
export const tfCapabilitySchema = z.enum(TF_CAPABILITIES);
export const opaqueRevisionSchema = z.string().regex(/^[1-9][0-9]{0,39}$/);
```

Implement the exact fields and enum values from the spec using `.strict()`.
Keep `PLATFORM_MODULE_KEYS` and the current assertion/introspection schemas
exported so existing consumers remain source-compatible.

- [ ] **Step 4: Run focused validation**

Run:

```powershell
pnpm --filter @workspace/platform-contract test -- src/index.test.ts src/module-integration.test.ts
pnpm --filter @workspace/platform-contract typecheck
```

Expected: both commands pass; current legacy contract tests remain unchanged.

- [ ] **Step 5: Commit the contract slice**

```powershell
git add lib/platform-contract/src/index.ts lib/platform-contract/src/module-integration.ts lib/platform-contract/src/module-integration.test.ts
git commit -m "feat(platform): add unified module contracts"
```

### Task 2: Add Platform Module Decisions And Admissions

**Files:**
- Create: `lib/platform-db/migrations/0007_unified_module_access.sql`
- Modify: `lib/platform-db/src/migrations.test.ts`
- Modify: `lib/platform-db/src/integration.test.ts`
- Create: `artifacts/platform-api/src/domain/module-integration.ts`
- Create: `artifacts/platform-api/src/domain/module-integration.test.ts`
- Create: `artifacts/platform-api/src/routes/modules.ts`
- Create: `artifacts/platform-api/src/routes/modules.test.ts`
- Modify: `artifacts/platform-api/src/app.ts`
- Modify: `artifacts/platform-api/src/domain/repository.ts`
- Modify: `artifacts/platform-api/src/domain/postgres-repository.ts`

**Interfaces:**
- Consumes: Task 1 DTOs, authenticated Platform account, canonical Platform installation, current entitlement repository, release catalog, Redis-backed one-time state
- Produces: `GET /v1/me/modules`, `GET /v1/me/modules/TF`, `POST /v1/me/modules/TF/launch-admissions`, `POST /v1/me/modules/TF/releases/:releaseId/download-admissions`, and server-to-server `POST /internal/v1/policy/decisions`

- [ ] **Step 1: Write the additive database migration tests**

Extend the existing migration tests to require migration `0007` to:

```sql
alter table apollo_platform.modules
  add column kind text not null default 'capability',
  add column parent_module_id uuid null;
```

The final constraints allow only the five uppercase top-level module keys when
`kind = 'module'`, lowercase dotted keys when `kind = 'capability'`, and a
capability parent that resolves to a top-level module. Seed `TF`; classify the
four current `tf.*` rows as TF capabilities. Keep current account grants intact
and do not synthesize new rows during migration.

- [ ] **Step 2: Run migration tests and confirm RED**

Run: `pnpm --filter @workspace/platform-db test -- src/migrations.test.ts src/integration.test.ts`

Expected: FAIL because migration `0007` does not exist.

- [ ] **Step 3: Implement and validate the additive migration**

Use the existing immutable migration runner. Add constraints and indexes only
after classifying current rows in the same transaction. Prove clean install,
upgrade from `0001..0006`, preserved legacy grants, RLS default deny, and a
valid new `TF` grant through the runtime role policy.

- [ ] **Step 4: Write decision and admission tests**

Cover one allowed and one denied case for each endpoint, plus these shared
boundaries:

```ts
expect(denied.body.code).toBe("module_not_entitled");
expect(revokedInstallation.body.code).toBe("installation_revoked");
expect(launch.body.launchUri).toMatch(/^https:\/\/apollot\.ru\/launch\/TF\?intent=/);
expect(launch.body.launchUri).not.toMatch(/token|account|capabilit|session/i);
expect(reusedIntent.status).toBe(403);
expect(staleIfMatch.status).toBe(412);
```

Also prove that `tf.release.download` cannot admit a TF media job and
`tf.downloads` cannot admit a module release artifact.

- [ ] **Step 5: Run the focused Platform tests and confirm RED**

Run: `pnpm --filter @workspace/platform-api test -- src/domain/module-integration.test.ts src/routes/modules.test.ts`

Expected: FAIL because the module integration service and routes do not exist.

- [ ] **Step 6: Implement module/capability evaluation**

Create a single `ModuleIntegrationService` that:

```ts
interface ModuleDecisionInput {
  accountId: string;
  sessionId: string;
  installationId: string;
  moduleKey: "TF";
  capability: TfCapability;
  action: string;
  resourceRef?: string;
  knownPolicyRevision?: string;
  requestId: string;
  auditCorrelationId: string;
}
```

Resolve `TF` and capability grants in one transaction, derive temporary TF
access from the documented legacy mapping, bind the active account/session/
installation, and return only stable decision codes. Never infer access from
the installed module list.

- [ ] **Step 7: Implement bounded catalog, status, launch, and release routes**

Use Redis only for 60-second one-time launch intents and release admissions.
Store a digest of the opaque secret, not the raw secret. Catalog/status reads
return `ETag`; admission mutations require a current account policy revision
and append the root Platform audit event with the supplied correlation ID.

- [ ] **Step 8: Run Platform validation**

Run:

```powershell
pnpm --filter @workspace/platform-api test -- src/domain/module-integration.test.ts src/routes/modules.test.ts src/domain/policy.test.ts src/routes/routes.test.ts
pnpm --filter @workspace/platform-db test -- src/migrations.test.ts src/integration.test.ts
pnpm --filter @workspace/platform-db typecheck
pnpm --filter @workspace/platform-api typecheck
pnpm --filter @workspace/platform-api build
```

Expected: the focused existing policy/routes tests and new tests pass.

- [ ] **Step 9: Commit the Platform slice**

```powershell
git add lib/platform-db/migrations/0007_unified_module_access.sql lib/platform-db/src/migrations.test.ts lib/platform-db/src/integration.test.ts artifacts/platform-api/src/app.ts artifacts/platform-api/src/domain/module-integration.ts artifacts/platform-api/src/domain/module-integration.test.ts artifacts/platform-api/src/domain/repository.ts artifacts/platform-api/src/domain/postgres-repository.ts artifacts/platform-api/src/routes/modules.ts artifacts/platform-api/src/routes/modules.test.ts
git commit -m "feat(platform): add module access admissions"
```

### Task 3: Make TF Enforce The Platform Module Decision

**Files:**
- Modify: `artifacts/api-server/src/lib/platform-auth-client.ts`
- Modify: `artifacts/api-server/src/lib/platform-auth-client.test.ts`
- Modify: `artifacts/api-server/src/lib/tf-policy.ts`
- Modify: `artifacts/api-server/src/lib/tf-policy.test.ts`
- Modify: `artifacts/api-server/src/lib/tf-session-store.ts`
- Modify: `artifacts/api-server/src/lib/tf-session-store.test.ts`
- Modify: `artifacts/api-server/src/routes/auth.ts`
- Modify: `artifacts/api-server/src/routes/auth.test.ts`
- Modify: `artifacts/api-server/src/routes/policy-coverage.test.ts`

**Interfaces:**
- Consumes: Platform TF-audience assertion and `TfPolicyDecisionV1`
- Produces: module `TF` plus per-route capability enforcement in the existing TF cookie, CSRF, and WebSocket boundary

- [ ] **Step 1: Add compatibility and fail-closed tests**

Add table-driven coverage proving:

```ts
[
  ["POST /api/tracks/search", "tf.search"],
  ["GET /api/tracks/track-id/stream", "tf.playback"],
  ["GET /api/spotify/status", "tf.integrations"],
  ["GET /api/tracks/recent", "tf.collections"],
  ["POST /api/tracks/download/queue", "tf.downloads"],
]
```

Each route must deny a missing `TF` module, deny its missing capability, retry a
single stale revision once, and fail closed on malformed, expired, mismatched,
or unavailable Platform decisions. Existing legacy TF grants must map exactly
as specified without widening unrelated capabilities.

- [ ] **Step 2: Run the TF policy subset and confirm RED**

Run: `pnpm --filter @workspace/api-server test -- src/lib/platform-auth-client.test.ts src/lib/tf-policy.test.ts src/lib/tf-session-store.test.ts src/routes/auth.test.ts src/routes/policy-coverage.test.ts`

Expected: FAIL on the missing module/capability decision support.

- [ ] **Step 3: Extend the Platform client and TF session snapshot**

Add `decide(input: TfPolicyDecisionRequestV1): Promise<TfPolicyDecisionV1>` to
`PlatformAuthClient`. Persist only account/session/installation IDs, granted TF
capabilities, policy and entitlement revisions, and their earliest expiry.
Do not persist Supabase tokens or identity profile fields.

- [ ] **Step 4: Split search from playback without changing public routes**

Map search/suggestion/lyrics endpoints to `tf.search`, stream/audio-stream and
WebSocket playback admission to `tf.playback`, and retain the existing keys for
integrations, collections, and media downloads. Keep one startup-enumerated
route policy table so an unmapped protected route still fails validation.

- [ ] **Step 5: Run focused TF validation**

Run:

```powershell
pnpm --filter @workspace/api-server test -- src/lib/platform-auth-client.test.ts src/lib/tf-policy.test.ts src/lib/tf-session-store.test.ts src/routes/auth.test.ts src/routes/policy-coverage.test.ts src/routes/websocket-tickets.test.ts src/ws.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
```

Expected: the changed auth/policy/WebSocket boundaries pass without running
unrelated parser, worker, admin UI, or mobile tests.

- [ ] **Step 6: Commit the TF enforcement slice**

```powershell
git add artifacts/api-server/src/lib/platform-auth-client.ts artifacts/api-server/src/lib/platform-auth-client.test.ts artifacts/api-server/src/lib/tf-policy.ts artifacts/api-server/src/lib/tf-policy.test.ts artifacts/api-server/src/lib/tf-session-store.ts artifacts/api-server/src/lib/tf-session-store.test.ts artifacts/api-server/src/routes/auth.ts artifacts/api-server/src/routes/auth.test.ts artifacts/api-server/src/routes/policy-coverage.test.ts
git commit -m "feat(tf-api): enforce unified module decisions"
```

### Task 4: Publish TF Status Without Transferring Runtime Ownership

**Files:**
- Create: `artifacts/api-server/src/lib/platform-module-status-client.ts`
- Create: `artifacts/api-server/src/lib/platform-module-status-client.test.ts`
- Modify: `artifacts/api-server/src/lib/admin-telemetry.ts`
- Modify: `artifacts/api-server/src/lib/admin-telemetry.test.ts`
- Modify: `artifacts/api-server/src/lib/server-startup.ts`
- Modify: `artifacts/api-server/src/lib/server-startup.test.ts`

**Interfaces:**
- Consumes: existing signed module heartbeat aggregate
- Produces: signed `TfModuleStatusV1` projection for Platform, without parser secrets, account rows, raw incidents, or host inventory

- [ ] **Step 1: Write projection and transport tests**

Assert operational/degraded/unavailable/unknown aggregation, stale timestamps,
monotonic opaque revision, bounded response size, exact Platform origin, request
deadline, strict content type, and absence of provider/account/internal fields.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @workspace/api-server test -- src/lib/platform-module-status-client.test.ts src/lib/admin-telemetry.test.ts src/lib/server-startup.test.ts`

Expected: FAIL because the status client is not implemented.

- [ ] **Step 3: Implement the bounded projection publisher**

Build status only from current TF-owned observations. Sign or mutually
authenticate the internal request using a dedicated file-backed secret, reuse
the existing bounded HTTP response/deadline rules, and never mark missing or
stale evidence operational.

- [ ] **Step 4: Run focused validation and commit**

Run:

```powershell
pnpm --filter @workspace/api-server test -- src/lib/platform-module-status-client.test.ts src/lib/admin-telemetry.test.ts src/lib/server-startup.test.ts
pnpm --filter @workspace/api-server typecheck
```

Then:

```powershell
git add artifacts/api-server/src/lib/platform-module-status-client.ts artifacts/api-server/src/lib/platform-module-status-client.test.ts artifacts/api-server/src/lib/admin-telemetry.ts artifacts/api-server/src/lib/admin-telemetry.test.ts artifacts/api-server/src/lib/server-startup.ts artifacts/api-server/src/lib/server-startup.test.ts
git commit -m "feat(tf-api): publish bounded module status"
```

### Task 5: Consume One-Time Launch Intents In TF Web

**Files:**
- Modify: `artifacts/api-server/src/routes/auth.ts`
- Modify: `artifacts/api-server/src/routes/auth.test.ts`
- Create: `artifacts/music-player/src/lib/tf-launch-intent.ts`
- Create: `artifacts/music-player/src/lib/tf-launch-intent.test.ts`
- Modify: `artifacts/music-player/src/auth/TfSessionBoundary.tsx`
- Modify: `artifacts/music-player/src/auth/tf-auth.test.tsx`
- Modify: `artifacts/music-player/src/App.tsx`

**Interfaces:**
- Consumes: `TfLaunchAdmissionV1` one-time intent and existing TF auth/session flow
- Produces: admitted routes `home`, `search`, `collection`, `integrations`, and capability-gated `admin`

- [ ] **Step 1: Write deep-link safety and routing tests**

Prove that an intent is exchanged once, expired/replayed/mismatched intents fail
closed, route/resource data comes from the Platform exchange rather than query
parameters, and no token/account/capability data remains in browser history.

- [ ] **Step 2: Run the focused API/web tests and confirm RED**

Run:

```powershell
pnpm --filter @workspace/api-server test -- src/routes/auth.test.ts
pnpm --filter @workspace/music-player test -- src/lib/tf-launch-intent.test.ts src/auth/tf-auth.test.tsx
```

Expected: FAIL because TF does not consume unified launch intents.

- [ ] **Step 3: Implement exchange and route resolution**

The API exchanges the opaque intent server-to-server, completes the current
TF host-only session flow, and returns only an approved local route. The web
client replaces the URL with the clean TF route before rendering protected
content. Direct local routes still pass server capability enforcement.

- [ ] **Step 4: Run focused validation and commit**

Run:

```powershell
pnpm --filter @workspace/api-server test -- src/routes/auth.test.ts
pnpm --filter @workspace/music-player test -- src/lib/tf-launch-intent.test.ts src/auth/tf-auth.test.tsx src/auth/tf-protected-runtime.test.tsx
pnpm --filter @workspace/music-player typecheck
pnpm --filter @workspace/music-player build
```

Then:

```powershell
git add artifacts/api-server/src/routes/auth.ts artifacts/api-server/src/routes/auth.test.ts artifacts/music-player/src/lib/tf-launch-intent.ts artifacts/music-player/src/lib/tf-launch-intent.test.ts artifacts/music-player/src/auth/TfSessionBoundary.tsx artifacts/music-player/src/auth/tf-auth.test.tsx artifacts/music-player/src/App.tsx
git commit -m "feat(tf-web): consume admitted launch intents"
```

### Task 6: Separate Module Release Admission From TF Media Downloads

**Files:**
- Modify: `scripts/src/operator-release.ts`
- Modify: `scripts/src/operator-release.test.ts`
- Modify: `artifacts/api-server/src/lib/tf-policy.ts`
- Modify: `artifacts/api-server/src/lib/tf-policy.test.ts`
- Modify: `docs/superpowers/specs/2026-07-15-apollo-coolify-release-design.md`
- Modify: `IMPLEMENTATION_STATUS.md`

**Interfaces:**
- Consumes: Platform `TfReleaseDownloadAdmissionV1`
- Produces: immutable TF release metadata suitable for Platform admission while leaving `tf.downloads` media-job behavior unchanged

- [ ] **Step 1: Add release/media separation tests**

Assert the publisher emits module `TF`, release ID, version, channel, platform,
architecture, minimum Quasar version, size, SHA-256 digest, and immutable source
revision. Assert no media job route accepts `tf.release.download` and no release
artifact path accepts `tf.downloads`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
pnpm --filter @workspace/scripts test -- src/operator-release.test.ts
pnpm --filter @workspace/api-server test -- src/lib/tf-policy.test.ts
```

Expected: FAIL on missing unified module release metadata.

- [ ] **Step 3: Implement immutable release metadata and enforcement separation**

Extend the existing operator publisher output additively. Do not add billing,
GitHub Actions, a second downloader, or deployment automation. Platform admits
the artifact; the existing owner-controlled publisher remains responsible for
producing it.

- [ ] **Step 4: Run focused validation and commit**

Run:

```powershell
pnpm --filter @workspace/scripts test -- src/operator-release.test.ts
pnpm --filter @workspace/scripts typecheck
pnpm --filter @workspace/api-server test -- src/lib/tf-policy.test.ts
```

Then:

```powershell
git add scripts/src/operator-release.ts scripts/src/operator-release.test.ts artifacts/api-server/src/lib/tf-policy.ts artifacts/api-server/src/lib/tf-policy.test.ts docs/superpowers/specs/2026-07-15-apollo-coolify-release-design.md IMPLEMENTATION_STATUS.md
git commit -m "feat(release): expose admitted TF module metadata"
```

### Task 7: Cross-Project Contract Validation And Release Gate

**Files:**
- Create: `artifacts/api-server/src/unified-platform-contract.integration.test.ts`
- Modify: `IMPLEMENTATION_STATUS.md`
- Modify: `CODEX_REFERENCE.md`

**Interfaces:**
- Consumes: exact approved Platform contract fixtures and Quasar launch fixtures
- Produces: evidence that TF accepts compatible v1 additions, rejects breaking/security-sensitive changes, and remains deployable independently

- [ ] **Step 1: Add one fixture-driven integration test**

Use fixtures exported by the authoritative contract package. Cover one complete
allowed flow and a compact denial matrix for inactive account, revoked
installation, missing `TF`, missing capability, stale revision, replayed launch,
and unavailable Platform. Do not duplicate lower-level schema or route tests.

- [ ] **Step 2: Run the release-focused validation matrix**

Run:

```powershell
pnpm --filter @workspace/platform-contract test
pnpm --filter @workspace/platform-contract typecheck
pnpm --filter @workspace/platform-api test -- src/domain/module-integration.test.ts src/routes/modules.test.ts
pnpm --filter @workspace/api-server test -- src/unified-platform-contract.integration.test.ts src/lib/tf-policy.test.ts src/routes/auth.test.ts src/routes/websocket-tickets.test.ts
pnpm --filter @workspace/music-player test -- src/lib/tf-launch-intent.test.ts src/auth/tf-protected-runtime.test.tsx
pnpm --filter @workspace/platform-api build
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/music-player build
```

Expected: all focused checks pass. No mobile, parser, topology, unrelated admin,
or infrastructure suite is run unless its files changed.

- [ ] **Step 3: Perform review without deployment**

Review the exact branch diff for identity duplication, entitlement widening,
token leakage, missing correlation, stale decision handling, and ownership
drift. Record validation counts and residual risks in `IMPLEMENTATION_STATUS.md`.
Do not deploy, migrate production data, or modify HomeNode.

- [ ] **Step 4: Commit the validation checkpoint**

```powershell
git add artifacts/api-server/src/unified-platform-contract.integration.test.ts IMPLEMENTATION_STATUS.md CODEX_REFERENCE.md
git commit -m "docs(platform): record unified TF contract proof"
```

## Cross-Project Delivery Order

1. Approve ownership and the handoff DTOs.
2. Publish the additive contract package and compatibility fixtures.
3. Implement Platform module decisions/admissions against the chosen identity adapter.
4. Implement TF decision enforcement and status publication.
5. Implement Quasar/Platform UI catalog and one-time launch resolver in their owning repositories.
6. Validate the cross-project fixtures without production mutation.
7. Prepare a separate migration/deployment plan with rollback and request explicit production approval.
