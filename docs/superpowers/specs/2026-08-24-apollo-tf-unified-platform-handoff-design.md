# Apollo TF Unified Platform Handoff

**Date:** 2026-08-24
**Status:** Proposed for cross-project approval
**Change class:** Architecture and contract documentation only

## Purpose

Integrate Apollo TF into the unified Apollo account and module system without
moving TF runtime ownership, duplicating identity, or changing the running TF,
HomeNode, Coolify, Caddy, Supabase, or Apollo.GAP infrastructure.

This handoff is the review boundary before implementation. It supersedes the
identity-ownership and flat TF-entitlement parts of the 2026-07-15 Platform
specifications. It does not supersede their runtime isolation, PKCE, RLS,
container, audit, or fail-closed requirements.

## Approved System Contract

- One Apollo account and one Platform installation identity are reused by all
  Apollo modules.
- Stable top-level module keys are `QUASAR`, `TF`, `OLC`, `AWG`, and `AI`.
- Supabase Auth owns identity, authentication factors, recovery, and the source
  session.
- Platform API owns account policy, module entitlements, capabilities, module
  access decisions, release/download admission, and the root audit trail.
- Apollo TF owns TF search, integrations, collections, playback, media download
  jobs, parser quality, provider credentials, TF runtime status, and TF API
  behavior.
- Apollo.GAP owns AWG/OlcRTC managed subscriptions, signed route and bundle
  revisions, nodes, runtime, rooms, and network telemetry.
- Quasar and Platform UI consume versioned projections. They are not policy or
  runtime authorities.
- Clients never query Supabase identity tables directly and never receive a
  `service_role` credential.
- There is no TF-specific login, duplicate commercial subscription, or second
  Windows VPN application.

## Terms And Stable Names

| Term | Meaning | Authority |
| --- | --- | --- |
| `identitySubject` | Stable subject from Supabase Auth | Supabase Auth |
| `accountId` | Stable Apollo policy account mapped to one identity subject | Platform API |
| `installationId` | Stable Apollo installation, browser-profile, or device-app identity | Platform API |
| `moduleKey` | One of `QUASAR`, `TF`, `OLC`, `AWG`, `AI` | Platform API |
| `capability` | Namespaced action gate such as `tf.search` | Platform API policy |
| `runtime status` | Current operational state and version of a module | Owning module runtime |

Module keys and capabilities are separate schemas. Uppercase module keys must
not be forced through the current lowercase dotted `moduleKeySchema`.

## Ownership Matrix

| Data or operation | Authoritative owner | Allowed projection elsewhere |
| --- | --- | --- |
| Credentials, MFA, recovery, IdP links, source sessions | Supabase Auth | Opaque subject and verified session assertion only |
| Apollo account lifecycle and identity-subject mapping | Platform API | Account ID and lifecycle state |
| Installation identity and revocation | Platform API | Installation ID and decision state |
| Module entitlements and capabilities | Platform API | Current access decision with revisions and expiry |
| Module catalog and release/download admission | Platform API | User-safe catalog and one-time admission result |
| TF search, playback, collection, parser, provider, and media-job state | Apollo TF | Bounded status or connection summary with TF revision |
| Spotify/Yandex credentials and provider identifiers | Apollo TF | `connected`, `degraded`, `disconnected`, last observation, display label where allowed |
| AWG/OlcRTC subscription and network control data | Apollo.GAP | Bounded module access/status projection through Platform |
| Presentation, navigation, cached view model | Quasar/Platform UI | Never authoritative |

The existing Platform password, credential, and source-session implementation
is transitional code. It must not be expanded as a second identity system.
Removing or migrating it requires a separately approved Supabase migration and
rollback plan.

## TF Entitlement And Capabilities

The top-level `TF` entitlement controls whether the Apollo account can enter the
module. A requested operation additionally requires its capability. Possession
of an installed client or a deep link grants neither.

| Capability | Purpose | Unified UI use |
| --- | --- | --- |
| `tf.launch` | Enter the TF web runtime through an admitted launch intent | Show primary launch action |
| `tf.search` | Search and resolve tracks | Show search availability |
| `tf.playback` | Request playable streams and playback metadata | Enable player controls |
| `tf.integrations` | View and manage Spotify/Yandex connections and imports | Show integration settings |
| `tf.collections` | Read and mutate likes, playlists, and history | Show collection entry points |
| `tf.downloads` | Create, inspect, cancel, and retrieve TF media jobs | Show media download actions |
| `tf.release.download` | Download an admitted TF client/module release | Show release download action |
| `tf.admin.observe` | Read TF parser, module, incident, and account projections | Operator UI only |

The current `tf.search`, `tf.integrations`, `tf.downloads`, and
`tf.collections` values are retained as capability keys. They are not renamed
or deleted in place.

### Compatibility Mapping

During an additive transition, Platform may derive these decisions from current
grants:

| Current grant | Transitional capability result |
| --- | --- |
| `tf.search` | `tf.launch`, `tf.search`, `tf.playback` |
| `tf.integrations` | `tf.launch`, `tf.integrations` |
| `tf.downloads` | `tf.launch`, `tf.downloads` |
| `tf.collections` | `tf.launch`, `tf.collections` |

An account with any live legacy TF grant may receive a compatibility projection
for module `TF`, but new writes use the top-level `TF` entitlement plus explicit
capabilities. Removal of the compatibility projection is a later, audited
migration with measured usage and a rollback window.

## Required Cross-Project Contracts

All DTOs are versioned as `schemaVersion: 1`, evolve additively, reject unknown
security-sensitive enum values at enforcement boundaries, and carry opaque
decimal-string `revision` values. Read responses use `ETag`; mutating or
admission requests accept `If-Match` where stale decisions matter. Every call
carries `requestId` and `auditCorrelationId`.

### 1. Module Catalog And Access

Platform UI and Quasar consume `GET /v1/me/modules` and
`GET /v1/me/modules/TF`; they do not join identity or entitlement tables.

```ts
interface ApolloModuleAccessV1 {
  schemaVersion: 1;
  moduleKey: "TF";
  allowed: boolean;
  code:
    | "allowed"
    | "identity_session_required"
    | "account_inactive"
    | "installation_required"
    | "installation_revoked"
    | "module_not_entitled"
    | "capability_not_granted"
    | "policy_unavailable";
  capabilities: readonly string[];
  policyRevision: string;
  entitlementRevision: string;
  expiresAt: string;
  requestId: string;
  auditCorrelationId: string;
}
```

The response may contain display name, current release, and launch affordances,
but the access decision above remains the only authorization input exposed to
the unified UI.

### 2. TF Runtime Status

TF publishes a signed bounded projection to Platform. Platform may cache and
serve it but cannot manufacture healthy state from a container or route.

```ts
interface TfModuleStatusV1 {
  schemaVersion: 1;
  moduleKey: "TF";
  state: "operational" | "degraded" | "maintenance" | "unavailable" | "unknown";
  runtimeVersion: string;
  apiVersion: string;
  capabilities: readonly {
    key: string;
    state: "operational" | "degraded" | "unavailable" | "unknown";
    version?: string;
    observedAt: string;
  }[];
  observedAt: string;
  staleAfter: string;
  revision: string;
  requestId: string;
  auditCorrelationId: string;
}
```

Unified UI receives this aggregate only. Parser counters, provider account
details, tokens, internal hostnames, and raw incidents remain in TF admin
contracts protected by `tf.admin.observe`.

### 3. Launch And Deep Links

Platform owns launch admission. TF owns the admitted route implementation.

```ts
interface TfLaunchAdmissionRequestV1 {
  schemaVersion: 1;
  moduleKey: "TF";
  installationId: string;
  target: "web" | "quasar";
  route: "home" | "search" | "collection" | "integrations" | "admin";
  resourceRef?: string;
  requestId: string;
  auditCorrelationId: string;
}

interface TfLaunchAdmissionV1 {
  schemaVersion: 1;
  allowed: boolean;
  code: ApolloModuleAccessV1["code"];
  launchIntentId?: string;
  launchUri?: string;
  expiresAt?: string;
  policyRevision: string;
  requestId: string;
  auditCorrelationId: string;
}
```

Canonical entry points are:

- web: `https://apollot.ru/launch/TF?intent=<opaque-one-time-id>`;
- Quasar shell: `apollo://module/TF?intent=<opaque-one-time-id>`.

The intent stores the approved route server-side, expires in at most 60 seconds,
and is consumed once. URLs contain no bearer token, Supabase token, account ID,
installation details, capability list, or provider data. TF exchanges the intent
through Platform and establishes its existing host-only TF session. Quasar does
not implement a separate TF login or persist TF credentials.

### 4. Release And Download Admission

`POST /v1/me/modules/TF/releases/{releaseId}/download-admissions` is a
Platform decision. The response contains an opaque one-time admission, exact
release identity, version, channel, size, digest, expiry, policy revision, and
correlation IDs. Platform checks `TF` plus `tf.release.download`, account state,
installation state, release channel, platform, architecture, and minimum shell
version before admitting the download.

Release admission is not a TF media-download job. Media search/download remains
inside TF and is enforced by `TF` plus `tf.downloads` at TF API.

### 5. Policy Decision And Introspection

TF keeps its signed assertion, PKCE, secure cookie, CSRF, and one-time WebSocket
ticket boundary. Platform replaces its identity-source role with validation of
the Supabase session and remains the issuer of a short-lived TF audience
assertion.

```ts
interface TfPolicyDecisionRequestV1 {
  schemaVersion: 1;
  accountId: string;
  sessionId: string;
  installationId: string;
  moduleKey: "TF";
  capability: string;
  action: string;
  resourceRef?: string;
  knownPolicyRevision?: string;
  requestId: string;
  auditCorrelationId: string;
}

interface TfPolicyDecisionV1 extends ApolloModuleAccessV1 {
  accountId: string;
  sessionId: string;
  installationId: string;
  capability: string;
  decisionExpiresAt: string;
}
```

The server-to-server caller is authenticated independently of the user session.
Platform binds all three IDs, evaluates module and capability policy, and returns
stable machine codes. A client-supplied `accountId` or capability is never
trusted without the bound Platform decision.

## How TF Enforces Platform Entitlement

1. Platform validates the Supabase session and binds the canonical Platform
   `accountId` and `installationId`.
2. Platform issues a one-time authorization/launch code and then a TF-audience
   assertion with a lifetime no longer than five minutes.
3. TF validates issuer, audience, signature, time bounds, nonce, and assertion
   ID against Platform JWKS.
4. Before creating or refreshing a TF session, TF introspects Platform and
   requires matching account, session, installation, module `TF`, capabilities,
   and non-stale revisions.
5. Every protected route maps to exactly one declared capability. High-impact
   actions and WebSocket admission use a live decision; lower-risk reads may use
   the bounded decision only until the earliest assertion, policy, or decision
   expiry.
6. Revoked installation, inactive account, missing entitlement, missing
   capability, stale revision, timeout, or malformed response fails closed.
7. TF logs the same request and audit correlation IDs as Platform without
   logging tokens or private provider data.

The browser uses capability data only to render honest locked states. TF API is
authoritative for every operation.

## Data That Must Not Be Duplicated

- TF and Quasar must not store passwords, MFA state, recovery state, Supabase
  refresh tokens, or an independent account session authority.
- TF must not maintain a second module-entitlement or release-admission table.
- Platform must not copy Spotify/Yandex credentials, provider user IDs, TF
  collections, search history, parser internals, or media jobs.
- Platform and TF must not copy Apollo.GAP subscription, route, bundle, node,
  room, or network telemetry authority.
- Quasar must not persist an authoritative shadow of policy, TF runtime state,
  or GAP runtime state. Offline data is an explicitly signed, short-lived
  Platform projection, not a second database.
- Cross-service projections must include `source`, `observedAt`, `revision`, and
  expiry/freshness so stale data cannot be presented as current authority.

## Neighboring Project Handoff

| Neighbor | Contract TF needs | Contract TF provides |
| --- | --- | --- |
| Supabase Auth | No direct database access. Platform-validated session only. | Nothing; TF never receives `service_role`. |
| Platform API / Apollo.Safe | Identity-subject mapping, installation binding, module/capability decision, launch admission, release admission, revisions, audit correlation | TF status projection and TF-owned route/release metadata |
| Apollo.Quasar | Platform-approved launch intent and canonical installation ID | Supported TF routes, status summary, required minimum shell version |
| Apollo.GAP | No direct TF runtime dependency | No subscription, route, node, room, or telemetry data |
| Admin UI | Platform access projection plus `tf.admin.observe` | TF parser/module/incident/account summaries with bounded fields |

## Source-Of-Truth Gate

Before code changes, owners must select one authoritative repository and release
process for each of these currently co-located components:

- `lib/platform-contract`;
- `artifacts/platform-api`;
- `lib/platform-db`;
- Supabase Auth adapters and migrations;
- Quasar module catalog and deep-link resolver.

Until that decision, Apollo.TF may document and consume proposed interfaces but
must not fork Platform contracts, move identity tables, or add a second policy
implementation.

## Approval And Acceptance Gate

Implementation starts only after cross-project approval of:

1. the module/capability split and compatibility mapping;
2. the five DTO families and stable error codes;
3. the launch URI grammar and one-time intent exchange;
4. the TF status projection boundary;
5. source repository ownership for Platform contracts and Supabase migration.

No refactor, database migration, Supabase change, container rebuild, deployment,
DNS/Caddy change, or HomeNode operation is part of this handoff.
