# Apollo Platform ownership review

This is the Web Platform correction set for sections 3, 6, 7, 10, 16, and 17
of
`C:\Users\maksi\.codex\worktrees\369d\Apollo.GAP\docs\superpowers\specs\2026-08-24-apollo-unified-client-integration-contract.md`.
That draft was read only and was not edited.

## Evidence from the current Apollo.TF checkout

The current worktree contains the reusable foundation plus the bounded F1
contract and Supabase identity-adapter changes. New Platform material remains
local pending reviewed extraction to private `ALTIS13/Apollo.Platform`; it must
not be published from public `ALTIS13/Apollo.TF`.

- `apollo_platform.accounts.id` is a stable UUID. The same migration still
  stores email/display name, password credentials, email verification/reset
  tokens, and Platform-issued `auth_sessions` as compatibility debt. Migration
  `0006_account_identity_subjects.sql` adds the exact unique
  `(provider_code, identity_issuer, identity_subject) -> account_subject`
  mapping with forced RLS; email is not part of lookup or linking.
- `client_installations` currently stores only Platform UUID, account UUID,
  label, first/last-seen timestamps, and revocation timestamp. OAuth currently
  accepts a client-supplied installation UUID/label. There is no registered
  public key, proof of possession, application/platform identity, key
  generation, or installation revision.
- `modules.module_key` is a closed-format lowercase dotted capability key; the
  existing seeds are TF capabilities. It is not the new open, case-preserving
  product `module_code` vocabulary.
- `account_module_entitlements` provides useful grant/revoke/expiry/audit
  patterns, but it has no product-level state, grace deadline, capability
  projection, snapshot revision, or policy revision.
- `project_releases` and `changelog_entries` are immutable project-history
  records. They are not client artifact metadata, rollout policy, release
  admission, or download-grant persistence.
- `audit_events` already records actor/target/action, UUID correlation, reason,
  before/after values, and time with append-only protections. HTTP runtime
  creates `X-Request-ID`, but does not yet accept/propagate a distinct
  `X-Audit-Correlation-ID`.
- OAuth Authorization Code + PKCE, client-authenticated introspection,
  short-lived `apollo-tf` Ed25519 assertions, and public JWKS exist. The signer
  configuration supports active/previous public keys, but there is no
  purpose-specific operational custody/rotation service.

Compatibility mapping required before runtime adoption:

| Existing Apollo.TF name/meaning                    | External v1 meaning                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `accounts.id`, `accountId`                         | `account_subject`; identity-provider `sub` is mapped server-side and is not a replacement ID.                      |
| lowercase account `status`                         | uppercase `account_state` projection with explicit mapping.                                                        |
| `client_installations.id` accepted through OAuth   | legacy installation reference; new authoritative registration is Platform-generated and proof-of-possession bound. |
| lowercase dotted `module_key` such as `tf.search`  | `capability_code` under product `module_code=TF`; it is not itself a product module code.                          |
| active/unexpired `account_module_entitlements` row | one input to an entitlement-state projection, not the complete `ModuleEntitlementSnapshotV1`.                      |
| strict camelCase TF DTOs                           | remain frozen for existing consumers; new external v1 DTOs are additive snake_case and tolerant of unknown fields. |
| `apollo-tf` assertion/JWKS                         | TF compatibility assertion only; not network, offline, AI-runtime, registration-receipt, or release signing.       |
| `project_releases`                                 | changelog/project history only; not `ClientReleaseMetadataV1`.                                                     |
| HTTP request ID reused as service correlation      | split into per-attempt `request_id` and operation-stable `audit_correlation_id`.                                   |

## Section 3 — authority matrix

The target authority split is confirmed with these corrections:

1. Supabase Auth, not the current Platform credential/session tables, is the
   target login/session authority. Current tables are transition debt and may
   remain only behind a bounded compatibility adapter during migration.
2. `accounts.id` can remain `account_subject`, but the stable Supabase subject
   mapping is now implemented as a separate additive table. No login route or
   automatic email-based account creation is enabled by this slice.
3. The current `client_installations` row is an installation-like compatibility
   record, not the approved device-bound installation model. Calling it an
   implemented installation authority without that qualifier is incorrect.
4. Current TF capability entitlements are reusable persistence/service
   patterns, not canonical `QUASAR|TF|OLC|AWG|AI` product entitlements.
5. GAP exclusively owns managed network subscription/binding, bundles, routes,
   nodes, peers, rooms, runtime, and telemetry. Platform stores only opaque
   GAP references and bounded admission/audit outcomes where required.
6. Quasar exclusively owns Windows shell/service/updater and artifact
   verification. This F1 slice makes no Quasar change.
7. A valid Supabase access JWT is sufficient for ordinary authenticated reads
   until its short `exp`. Sensitive release/download/offline-entitlement
   admissions additionally check the exact JWT `session_id` and `sub` against
   `auth.sessions` through a dedicated role limited to database `CONNECT`, Auth
   schema `USAGE`, and column-level `SELECT(id, user_id)`. This role is held
   only by Platform API; clients and GAP never receive it.
8. Auth `/user` is not a strict immediate-revoke oracle. Supabase documents
   that sign-out does not retroactively invalidate an access token. Session-row
   presence closes sign-out/deletion reuse only for checked sensitive actions;
   time-box and inactivity semantics remain bounded by token expiry and Auth
   cleanup behavior.

## Section 6 — Platform API contracts

The new validators in `lib/platform-contract/src/v1.ts` are additive external
contracts beside the existing strict camelCase TF contracts.

- `SessionContextV1`: new. It is not compatible with the current
  `/v1/session` body. The internal Supabase JWT/subject adapter now exists, but
  no route emits this DTO and legacy login/session behavior is unchanged.
- `InstallationRegistrationV1`: new request/response pair. It does not map
  directly to today's OAuth installation-label upsert.
- `ModuleEntitlementSnapshotV1`: new projection. Existing effective TF grants
  are inputs to a compatibility mapping, not wire-compatible output.
- `ModuleLaunchAdmissionV1`: new. No admission persistence, issue, or redeem
  route exists.
- `ClientReleaseMetadataV1` and `ReleaseAdmissionV1`: new. Existing
  `project_releases` is not enough to back them.
- `AiRuntimeGrantClaimsV1` and `AiModuleStatusV1`: new contract-only boundary.
  Existing Apollo.AI login/invitation/cookie/runtime endpoints are internal and
  are not Platform implementations.
- `OfflineEntitlementV1`: intentionally not frozen or implemented by F1. It
  remains blocked by purpose/key/lifetime/custody decisions.

Canonical naming corrections:

- `module_code` is an open validated string. The five known codes are
  recognition data, never an enum or a five-value database CHECK.
- Canonical shell-compatible entitlement states are `UNKNOWN`,
  `NOT_ENTITLED`, `ACTIVE`, `OFFLINE_GRACE`, `EXPIRED`, and `REVOKED`.
  Account `SUSPENDED` remains separate. The GAP draft's `GRACE` and
  entitlement-level `SUSPENDED` must not be frozen without an explicit mapping.
- Reason codes are open lowercase `[a-z0-9_]+` strings. Uppercase `GAP_*`
  variants are not canonical Platform reason codes.
- No parser synthesizes a negative entitlement for a missing or unknown
  module.

## Section 7 — Platform-to-GAP admission

`NetworkAdmissionAssertionClaimsV1` and the compact-JWT response envelope are
now defined, but no Platform signer/route/replay ledger exists.

Read-only comparison with Apollo.GAP commit `1ef5e2cbc3` confirms compatible
Ed25519/EdDSA compact JWS, pinned JWKS, exact issuer/audience, required
`sub/jti/iat/nbf/exp`, 300-second maximum lifetime, configurable skew, lowercase
error codes, duplicate-member rejection, and immutable verified claims. A
joint review of later GAP revision `675622bc5c` found its temporary compact-JWS
limit at 8,192 bytes. Canonical Platform producer revision
`2026-09-04.f1.1` fixes the shared target at 16,384 ASCII bytes; GAP must adopt
that bound before the cross-project fixture gate is considered green. The GAP
consumer owner has acknowledged this producer revision, protected-header-only
`kid`, `nbf <= iat`, and 300-second lifetime policy and is aligning the
GAP-owned verifier/docs/tests without changing Platform files.

Corrections and remaining mismatches:

- JOSE `kid` belongs only in the protected header. The Platform claims schema
  rejects a duplicate `key_id` claim.
- GAP's current verifier intentionally validates generic JWS trust/time only;
  it does not validate installation, purpose, AWG/OLC modules, capability,
  revision, correlation, or replay semantics. Those remain the admission
  layer's responsibility.
- Platform's current JWKS signs `aud=apollo-tf`; it must not be reused as the
  network-admission key ring merely because both use Ed25519.
- `ManagedNetworkSubscriptionV1` is the stable operational GAP network
  subscription created after enrollment; it is not billing. It remains
  distinct from the installation-scoped managed binding. Final GAP
  naming/fields must preserve that distinction rather than mechanically rename
  one to the other.
- GAP currently has no `/client/v1` enrollment/refresh endpoint, replay ledger,
  or managed-binding write in the reported foundation slice.
- GAP's service base URL, currently represented as
  `foundry.apollot.ru/v1`, and the signed admission issuer, currently frozen as
  `https://api.apollot.ru`, are separate configured fields. Neither is derived
  from the other.

The only Platform authorization payload GAP needs is the verified assertion:
JOSE `kid` plus `iss`, `aud=apollo-gap`, `sub=account_subject`,
`installation_id`, installation signing key ID/thumbprint, AWG/OLC allowed
modules, network capabilities, `ENROLL|REFRESH` purpose, entitlement/policy
revisions, `jti`, replay nonce, `iat/nbf/exp`, request ID, and audit correlation
ID. A bounded server-to-server key lookup may return the registered public
installation key and its state/revision; it never returns a private key or an
identity-table row.

Platform may retain an opaque GAP subscription/binding reference, last observed
GAP revision/result code, and correlated audit outcome. It must not store GAP
node/endpoint selection, AWG peer or private key, OlcRTC room/runtime secret,
sealed bundle/payload, route manifest/rules/datasets, packet/destination logs,
network health time series, or raw telemetry. GAP derives its own
account-scoped subscription (if needed) and installation-scoped binding from
the assertion; Platform does not issue either entity as a shadow authority.

## Section 10 — Apollo.Quasar boundary

Confirmed unchanged. Platform supplies additive DTO/admission inputs only.
Quasar's strict existing IPC v1, current fail-closed service, zapret behavior,
one-TUN target ownership, updater manifest trust, and origin separation remain
outside this checkout. `api.apollot.ru`, `quasar.apollot.ru`, and
`foundry.apollot.ru/v1` are not interchangeable.

## Section 16 — sequencing

The user's explicit 2026-09-04 authorization opened the Web Platform F1
contract slice. This repository now owns the producer validators and golden
fixtures for Platform DTOs. That does not claim the whole cross-project Slice
0/1 gate is complete: Windows/Android/GAP/AI consumer parity, canonical artifact
publication ownership, and production key operations remain open.

The next gate is reviewed extraction into private `ALTIS13/Apollo.Platform`
followed by the pinned PostgreSQL 17/GoTrue/Coolify Application staging smoke.
Installation registration plus online entitlement snapshot remains the next
product unit after that gate; offline/release signing and portal work do not
start implicitly.

## Section 17 — Web Platform answers and stop factors

Confirmed ownership:

- `account_subject`: Platform `accounts.id`.
- `identity_subject`: Supabase JWT `sub`, stored in the unique exact-tuple
  server-side mapping; never exposed as policy authority and never joined by
  email.
- `installation_id`: Platform-generated global ID bound to account and client
  public keys; existing legacy rows require migration classification.
- Product policy/entitlement/admission/audit: Platform.
- Network subscription/binding/runtime/routes/telemetry: GAP.
- Windows artifact verification and updater state: Quasar.
- AI runtime/workload data: Apollo.AI.

Reusable today: account UUIDs, transactional repository patterns, RLS/role
separation, OAuth/PKCE, TF assertion/JWKS implementation patterns, TF grant and
audit workflows, request IDs, migration manifest/tests, and container-first
test conventions. Reuse means adapting patterns and data, never sharing signing
keys or preserving a second visible login.

Stop factors before later phases:

- Pinned PostgreSQL 17/GoTrue asymmetric-JWKS staging smoke, explicit backup
  recipient/key custody, and restore rehearsal before any production identity
  migration. No existing Quasar or generic PostgreSQL 18 volume is reused.
- Explicit owners and operating procedures for Supabase Auth, Platform online
  assertion, network admission, offline entitlement, AI runtime grant, GAP
  bundle/route, and client-release key domains.
- Offline lifetime/skew and release/download signing/admission policy.
- GAP domain-schema validation/replay/endpoint work and exact subscription vs
  binding semantics.
- Apollo.AI service-principal authentication and atomic launch-redeem storage.
- Consumer fixture parity and canonical artifact version/release process.
- Separate portal concept approval against the recorded visual references.
