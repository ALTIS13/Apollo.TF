# Apollo Platform external contracts v1

Status: Phase F1 contract skeleton. This directory and
`@workspace/platform-contract` define parser-level compatibility only. No new
Platform API route, database migration, signer, Supabase adapter, portal, or
consumer runtime is implemented by this slice.

Stable producer revision: `2026-09-04.f1.1`. Compact JWS is bounded to 16,384
ASCII bytes, and the only signing key identifier is JOSE `kid` in the protected
header. A duplicate `key_id` claim is rejected.

## Authority boundary

- Supabase Auth owns login identity, factors, access/refresh sessions, and the
  identity `sub`.
- Apollo Platform API resolves that identity server-side to stable
  `account_subject` and owns account policy, installations, module
  entitlements, launch/release/network admission, offline policy, and audit.
- Apollo.GAP owns AWG/OLC managed bindings, sealed network bundles, routes,
  nodes, rooms, runtime, and network telemetry.
- Apollo.Quasar remains the Windows shell, module host, privileged service,
  and updater-verification authority. Platform admission augments but never
  replaces Quasar's signed manifest, digest, compatibility, anti-rollback, and
  staging checks.
- Apollo.AI owns AI runtime internals. Platform sees only launch admission,
  a short-lived runtime grant, and a bounded public status projection.

Clients never receive Supabase `service_role`, query identity tables, or turn
`user_metadata` into policy. Platform does not store GAP bundles/routes/runtime
or AI prompts, files, tool payloads, jobs, model paths, workflows, raw
telemetry, credentials, or cookies.

## Executable contract

The canonical validator is
`lib/platform-contract/src/v1.ts`. `manifest.json` maps wire DTO names to the
exported Zod validators. Positive and negative golden fixtures live in
`fixtures/` and are executed by `src/v1.test.ts`.

Run the affected contract gate from the repository root:

```text
pnpm --filter @workspace/platform-contract test -- src/v1.test.ts
pnpm --filter @workspace/platform-contract typecheck
```

All external object schemas are additive and preserve unknown fields. Required
fields and security deny-lists remain enforced. New optional fields may be
added without changing `schema_version`; removals, type changes, meaning
changes, or newly required fields require a new schema version.

## Common wire rules

- JSON fields use `snake_case`; `schema_version` is the integer `1`.
- `request_id` is unique per request. `audit_correlation_id` remains stable
  across a multi-service operation. Both are UUID or ULID values.
- Revisions are bounded opaque strings. Consumers compare them for equality
  and never parse ordering from their textual form.
- Mutable/current representations use an HTTP `ETag` derived from their
  canonical representation. The ETag is a response header, not a duplicate
  body field. Mutations use `If-Match`; cacheable reads use `If-None-Match`.
- Times outside signed JWT claims are UTC RFC 3339 strings. JWT `iat`, `nbf`,
  and `exp` are integer epoch seconds.
- Machine-facing decisions use stable codes. Display text, localization, and
  imagery do not cross the authority boundary.
- An unknown enum value fails closed. Unknown fields and valid unknown
  `module_code` values are preserved.

`module_code` is deliberately not an enum. It is a case-preserving dotted
ASCII identifier of at most 64 bytes. `QUASAR`, `TF`, `OLC`, `AWG`, and `AI`
are recognized values, not a closed universe. Database migrations must not add
a CHECK constraint limited to those five values.

The canonical entitlement vocabulary for shell interoperability is
`UNKNOWN`, `NOT_ENTITLED`, `ACTIVE`, `OFFLINE_GRACE`, `EXPIRED`, and
`REVOKED`. `UNKNOWN` means no current verified authority decision and is never
coerced to `NOT_ENTITLED`. A missing module entry is likewise not a negative
decision. Account `SUSPENDED` is a separate account state; the unqualified
entitlement value `GRACE` is not part of v1.

## DTO set

| DTO                                  | Boundary and mandatory semantics                                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionContextV1`                   | Stable `account_subject`, session reference, bounded display profile, account/auth state, expiry, entitlement revision, correlation. No identity row or credential material.                                |
| `InstallationRegistrationRequestV1`  | Client nonce, application/platform/version, public Ed25519 signing JWK, optional complete X25519 encryption-key tuple, capabilities, and idempotency. Private JWK members are rejected.                     |
| `InstallationRegistrationResponseV1` | Platform-generated installation ID, account subject, state, key generation, revision, server nonce, and opaque registration receipt. Receipt signing format/key purpose is not frozen here.                 |
| `ModuleEntitlementSnapshotV1`        | Account and optional installation scope, independent module entries, capabilities, validity bounds, snapshot/policy revisions, refresh/expiry, correlation. Module codes are open and unique.               |
| `ModuleLaunchAdmissionV1`            | One-time ALLOW with bounded target/state or DENY with reason and no target. Used for TF/AI navigation; it does not transfer runtime ownership.                                                              |
| `ClientReleaseMetadataV1`            | Immutable account-independent artifact and updater-manifest references. Quasar's signed manifest remains artifact truth.                                                                                    |
| `ReleaseAdmissionV1`                 | Account/installation/policy/release decision. Only ALLOW carries a bounded one-time opaque download grant. No artifact-signing implementation is included.                                                  |
| `NetworkAdmissionAssertionClaimsV1`  | Short-lived Platform claims for GAP, audience `apollo-gap`, installation key binding, AWG/OLC-only modules, network capabilities, purpose, revisions, and replay correlation.                               |
| `GapNetworkAdmissionEnvelopeV1`      | Additive transport wrapper for the compact signed JWT. The network-admission signer/JWKS lifecycle is not implemented in F1.                                                                                |
| `AiRuntimeGrantClaimsV1`             | Short-lived claims with audience `apollo.ai`, one subject (`sub`), installation/session binding, AI capabilities, policy revisions, and correlation. No duplicate `account_subject` claim or workload data. |
| `AiModuleStatusV1`                   | Bounded public AI availability/launch/version/compatibility projection with staleness and revision. Raw runtime telemetry is rejected.                                                                      |
| `PlatformProblemV1`                  | Open lowercase machine code, audience-safe message, retryability, correlation, and optional bounded scalar details with sensitive fields rejected.                                                          |

## Reserved AI boundary

The following target paths are reserved but not registered in
`artifacts/platform-api` by F1:

- `POST /v1/module-launch-admissions/{launch_id}/redeem`: one-time atomic CAS,
  callable only by the Apollo.AI service principal, returning a signed
  `AiRuntimeGrantV1` envelope after launch admission is consumed.
- `POST /v1/service-projections/modules/AI/status`: bounded idempotent status
  write by the Apollo.AI service principal.
- `GET /v1/modules/AI/status`: public/account-safe projection read.

Apollo.AI's existing `/auth/redeem` means invitation redemption. It is not
launch redemption and must not be reused for the route above.

## Origin separation

- `https://api.apollot.ru` is the Platform API issuer/origin.
- `https://quasar.apollot.ru` is Quasar cloud/update content and may be
  referenced by release metadata.
- `https://foundry.apollot.ru/v1` is a Quasar laboratory control surface.

No client or server may treat these origins as aliases.

## Explicitly deferred

`OfflineEntitlementV1`, download/release signing, registration-receipt signing,
and runtime grant signing are not implemented. Before any signer is added,
the owner must freeze distinct purposes, audiences, key rings, JWKS exposure,
custody, overlap, revoke, incident rotation, backup, lifetimes, and clock-skew
rules. The Supabase subject adapter is also deferred until the pinned
self-hosted release and PostgreSQL 16-to-17 rehearsal/rollback gate are met.

See `OWNERSHIP_REVIEW.md` for the evidence-backed current/target mapping and
`NEXT_EXECUTABLE_SLICE.md` for the next bounded installation/snapshot slice.
