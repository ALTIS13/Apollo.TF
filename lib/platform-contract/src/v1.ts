import { z } from "zod";

export const KNOWN_APOLLO_MODULE_CODES = [
  "QUASAR",
  "TF",
  "OLC",
  "AWG",
  "AI",
] as const;

export const APOLLO_PLATFORM_V1_CONTRACT_REVISION = "2026-09-04.f1.1";
export const COMPACT_JWS_MAX_ASCII_BYTES_V1 = 16_384;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MODULE_CODE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*$/;
const UPPER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]*$/;
const LOWER_CODE_PATTERN = /^[a-z0-9][a-z0-9_]*$/;
const CAPABILITY_CODE_PATTERN =
  /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;
const JWT_COMPACT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const schemaVersionV1Schema = z.literal(1);
const opaqueIdV1Schema = z.string().min(1).max(128).regex(OPAQUE_ID_PATTERN);
const correlationIdV1Schema = z
  .string()
  .refine(
    (value) =>
      z.string().uuid().safeParse(value).success || ULID_PATTERN.test(value),
    "Expected a UUID or ULID correlation identifier",
  );
const revisionV1Schema = opaqueIdV1Schema;
const timestampV1Schema = z.string().datetime({ offset: true });
const upperCodeV1Schema = z.string().min(1).max(64).regex(UPPER_CODE_PATTERN);
const versionV1Schema = z.string().min(1).max(64).regex(VERSION_PATTERN);
const thumbprintV1Schema = z.string().regex(BASE64URL_SHA256_PATTERN);
const sha256V1Schema = z.string().regex(SHA256_PATTERN);

const correlationShape = {
  request_id: correlationIdV1Schema,
  audit_correlation_id: correlationIdV1Schema,
};

const AI_PRIVATE_PLATFORM_FIELDS = [
  "account_subject",
  "prompt",
  "prompts",
  "completion",
  "completions",
  "file",
  "files",
  "file_path",
  "file_paths",
  "request_body",
  "response_body",
  "embedding",
  "embeddings",
  "tool_args",
  "tool_results",
  "hidden_reasoning",
  "raw_jobs",
  "raw_queues",
  "model_path",
  "model_paths",
  "comfy_workflow",
  "comfy_workflows",
  "gpu_telemetry",
  "cpu_telemetry",
  "process_telemetry",
  "secret",
  "secrets",
  "token",
  "tokens",
  "cookie",
  "cookies",
] as const;

function asEpochMillis(value: string): number {
  return Date.parse(value);
}

function addInvalidLifetimeIssue(
  context: z.RefinementCtx,
  message = "Invalid temporal ordering",
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message });
}

function rejectForbiddenFields(
  value: Record<string, unknown>,
  context: z.RefinementCtx,
  fields: readonly string[],
): void {
  for (const field of fields) {
    if (Object.hasOwn(value, field)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} is not part of this public contract`,
      });
    }
  }
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export const moduleCodeV1Schema = z
  .string()
  .min(1)
  .max(64)
  .regex(MODULE_CODE_PATTERN);

export const reasonCodeV1Schema = z
  .string()
  .min(1)
  .max(64)
  .regex(LOWER_CODE_PATTERN);

export const capabilityCodeV1Schema = z
  .string()
  .min(3)
  .max(128)
  .regex(CAPABILITY_CODE_PATTERN);

export const accountStateV1Schema = z.enum([
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "DELETED",
]);

export const entitlementStateV1Schema = z.enum([
  "UNKNOWN",
  "NOT_ENTITLED",
  "ACTIVE",
  "OFFLINE_GRACE",
  "EXPIRED",
  "REVOKED",
]);

const displayProfileV1Schema = z
  .object({
    display_name: z.string().trim().min(1).max(100),
    avatar_uri: z.string().url().max(2048).nullable(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (value.avatar_uri !== null) {
      const uri = new URL(value.avatar_uri);
      if (uri.protocol !== "https:" || uri.username || uri.password) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["avatar_uri"],
          message: "Avatar URI must be an HTTPS public reference",
        });
      }
    }
    rejectForbiddenFields(value, context, [
      "email",
      "phone",
      "identities",
      "user_metadata",
      "app_metadata",
    ]);
  });

export const sessionContextV1Schema = z
  .object({
    schema_version: schemaVersionV1Schema,
    revision: revisionV1Schema,
    account_subject: opaqueIdV1Schema,
    session_id: opaqueIdV1Schema,
    account_state: accountStateV1Schema,
    display_profile: displayProfileV1Schema,
    authentication_level: z.enum(["AAL1", "AAL2"]),
    authenticated_at: timestampV1Schema,
    session_expires_at: timestampV1Schema,
    entitlement_snapshot_revision: revisionV1Schema.nullable(),
    issued_at: timestampV1Schema,
    ...correlationShape,
  })
  .passthrough()
  .superRefine((value, context) => {
    rejectForbiddenFields(value, context, [
      "service_role",
      "password",
      "password_hash",
      "refresh_token",
      "identity_row",
      "auth_user",
    ]);
    if (
      asEpochMillis(value.authenticated_at) > asEpochMillis(value.issued_at) ||
      asEpochMillis(value.issued_at) >= asEpochMillis(value.session_expires_at)
    ) {
      addInvalidLifetimeIssue(context);
    }
  });

const signingPublicJwkV1Schema = z
  .object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: thumbprintV1Schema,
    alg: z.literal("EdDSA"),
    kid: opaqueIdV1Schema,
  })
  .passthrough()
  .superRefine((value, context) => {
    rejectForbiddenFields(value, context, [
      "d",
      "p",
      "q",
      "dp",
      "dq",
      "qi",
      "oth",
      "k",
    ]);
  });

const encryptionPublicJwkV1Schema = z
  .object({
    kty: z.literal("OKP"),
    crv: z.literal("X25519"),
    x: thumbprintV1Schema,
    alg: z.literal("ECDH-ES"),
    kid: opaqueIdV1Schema,
  })
  .passthrough()
  .superRefine((value, context) => {
    rejectForbiddenFields(value, context, [
      "d",
      "p",
      "q",
      "dp",
      "dq",
      "qi",
      "oth",
      "k",
    ]);
  });

const supportedCapabilityV1Schema = z
  .object({
    capability_code: capabilityCodeV1Schema,
    contract_version: z.number().int().positive(),
  })
  .passthrough();

export const installationRegistrationRequestV1Schema = z
  .object({
    schema_version: schemaVersionV1Schema,
    registration_idempotency_key: correlationIdV1Schema,
    application_code: upperCodeV1Schema,
    platform_code: upperCodeV1Schema,
    architecture: upperCodeV1Schema,
    app_version: versionV1Schema,
    client_nonce: thumbprintV1Schema,
    signing_algorithm: z.literal("EdDSA"),
    signing_public_jwk: signingPublicJwkV1Schema,
    signing_public_key_thumbprint: thumbprintV1Schema,
    encryption_algorithm: z.literal("ECDH-ES").optional(),
    encryption_public_jwk: encryptionPublicJwkV1Schema.optional(),
    encryption_public_key_thumbprint: thumbprintV1Schema.optional(),
    supported_capabilities: z.array(supportedCapabilityV1Schema).max(128),
    platform_attestation: z
      .object({
        format: upperCodeV1Schema,
        evidence: z.string().min(1).max(16_384),
      })
      .passthrough()
      .optional(),
    ...correlationShape,
  })
  .passthrough()
  .superRefine((value, context) => {
    const encryptionFields = [
      value.encryption_algorithm,
      value.encryption_public_jwk,
      value.encryption_public_key_thumbprint,
    ];
    const encryptionFieldCount = encryptionFields.filter(
      (field) => field !== undefined,
    ).length;
    if (encryptionFieldCount !== 0 && encryptionFieldCount !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Encryption key registration must be complete or omitted",
      });
    }
    const capabilityKeys = value.supported_capabilities.map(
      ({ capability_code, contract_version }) =>
        `${capability_code}:${contract_version}`,
    );
    if (hasDuplicates(capabilityKeys)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supported_capabilities"],
        message: "Duplicate supported capability",
      });
    }
  });

export const installationStateV1Schema = z.enum([
  "ACTIVE",
  "REKEY_REQUIRED",
  "REVOKED",
]);

export const installationRegistrationResponseV1Schema = z
  .object({
    schema_version: schemaVersionV1Schema,
    installation_id: opaqueIdV1Schema,
    account_subject: opaqueIdV1Schema,
    installation_state: installationStateV1Schema,
    key_generation: z.number().int().positive(),
    revision: revisionV1Schema,
    registered_at: timestampV1Schema,
    server_nonce: thumbprintV1Schema,
    registration_receipt: z.string().min(16).max(8192),
    ...correlationShape,
  })
  .passthrough();

const moduleEntitlementItemV1Schema = z
  .object({
    module_code: moduleCodeV1Schema,
    state: entitlementStateV1Schema,
    capabilities: z.array(capabilityCodeV1Schema).max(128),
    valid_from: timestampV1Schema,
    entitlement_expires_at: timestampV1Schema.nullable(),
    grace_expires_at: timestampV1Schema.nullable(),
    policy_revision: revisionV1Schema,
    reason_code: reasonCodeV1Schema.nullable(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (hasDuplicates(value.capabilities)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilities"],
        message: "Duplicate capability code",
      });
    }
    if (
      value.entitlement_expires_at !== null &&
      asEpochMillis(value.valid_from) >=
        asEpochMillis(value.entitlement_expires_at)
    ) {
      addInvalidLifetimeIssue(context);
    }
    if (
      value.grace_expires_at !== null &&
      value.entitlement_expires_at !== null &&
      asEpochMillis(value.entitlement_expires_at) >=
        asEpochMillis(value.grace_expires_at)
    ) {
      addInvalidLifetimeIssue(context);
    }
  });

export const moduleEntitlementSnapshotV1Schema = z
  .object({
    schema_version: schemaVersionV1Schema,
    account_subject: opaqueIdV1Schema,
    installation_id: opaqueIdV1Schema.nullable().optional(),
    account_state: accountStateV1Schema,
    modules: z.array(moduleEntitlementItemV1Schema).max(256),
    snapshot_revision: revisionV1Schema,
    policy_revision: revisionV1Schema,
    issued_at: timestampV1Schema,
    refresh_after: timestampV1Schema,
    expires_at: timestampV1Schema,
    ...correlationShape,
  })
  .passthrough()
  .superRefine((value, context) => {
    if (hasDuplicates(value.modules.map(({ module_code }) => module_code))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modules"],
        message: "Duplicate module_code",
      });
    }
    if (
      asEpochMillis(value.issued_at) >= asEpochMillis(value.refresh_after) ||
      asEpochMillis(value.refresh_after) > asEpochMillis(value.expires_at)
    ) {
      addInvalidLifetimeIssue(context);
    }
  });

const moduleLaunchAdmissionCommonShape = {
  schema_version: schemaVersionV1Schema,
  launch_id: opaqueIdV1Schema,
  account_subject: opaqueIdV1Schema,
  installation_id: opaqueIdV1Schema,
  module_code: moduleCodeV1Schema,
  issued_at: timestampV1Schema,
  expires_at: timestampV1Schema,
  one_time: z.literal(true),
  entitlement_snapshot_revision: revisionV1Schema,
  policy_revision: revisionV1Schema,
  ...correlationShape,
};

const moduleLaunchAllowV1Schema = z
  .object({
    ...moduleLaunchAdmissionCommonShape,
    decision: z.literal("ALLOW"),
    reason_code: z.null().optional(),
    target_kind: z.enum(["WEB", "DEEP_LINK"]),
    target_uri: z.string().url().max(2048),
    opaque_state: z.string().min(16).max(4096),
  })
  .passthrough()
  .superRefine((value, context) => {
    const uri = new URL(value.target_uri);
    const expectedProtocol = value.target_kind === "WEB" ? "https:" : "apollo:";
    if (uri.protocol !== expectedProtocol || uri.username || uri.password) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target_uri"],
        message: "Target URI does not match target_kind",
      });
    }
    if (asEpochMillis(value.issued_at) >= asEpochMillis(value.expires_at)) {
      addInvalidLifetimeIssue(context);
    }
  });

const moduleLaunchDenyV1Schema = z
  .object({
    ...moduleLaunchAdmissionCommonShape,
    decision: z.literal("DENY"),
    reason_code: reasonCodeV1Schema,
    target_kind: z.null().optional(),
    target_uri: z.null().optional(),
    opaque_state: z.null().optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (asEpochMillis(value.issued_at) >= asEpochMillis(value.expires_at)) {
      addInvalidLifetimeIssue(context);
    }
  });

export const moduleLaunchAdmissionV1Schema = z.union([
  moduleLaunchAllowV1Schema,
  moduleLaunchDenyV1Schema,
]);

export const clientReleaseMetadataV1Schema = z
  .object({
    schema_version: schemaVersionV1Schema,
    application_code: upperCodeV1Schema,
    platform_code: upperCodeV1Schema,
    architecture: upperCodeV1Schema,
    release_channel: upperCodeV1Schema,
    release_id: opaqueIdV1Schema,
    artifact_id: opaqueIdV1Schema,
    version: versionV1Schema,
    minimum_source_version: versionV1Schema.nullable(),
    publication_state: z.enum(["PUBLISHED", "WITHDRAWN", "REVOKED"]),
    published_at: timestampV1Schema,
    size_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: sha256V1Schema,
    updater_manifest_uri: z.string().url().max(2048),
    updater_manifest_sha256: sha256V1Schema,
    release_revision: revisionV1Schema,
    ...correlationShape,
  })
  .passthrough()
  .superRefine((value, context) => {
    rejectForbiddenFields(value, context, [
      "account_subject",
      "installation_id",
      "download_grant",
    ]);
    const uri = new URL(value.updater_manifest_uri);
    if (uri.protocol !== "https:" || uri.username || uri.password) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updater_manifest_uri"],
        message: "Updater manifest URI must be an HTTPS public reference",
      });
    }
  });

const releaseAdmissionCommonShape = {
  schema_version: schemaVersionV1Schema,
  admission_id: opaqueIdV1Schema,
  account_subject: opaqueIdV1Schema,
  installation_id: opaqueIdV1Schema,
  application_code: upperCodeV1Schema,
  module_code: moduleCodeV1Schema,
  release_id: opaqueIdV1Schema,
  artifact_id: opaqueIdV1Schema,
  platform_code: upperCodeV1Schema,
  architecture: upperCodeV1Schema,
  release_channel: upperCodeV1Schema,
  update_policy: z.enum(["OPTIONAL", "REQUIRED", "BLOCKED"]),
  entitlement_snapshot_revision: revisionV1Schema,
  policy_revision: revisionV1Schema,
  release_revision: revisionV1Schema,
  rollout_cohort: opaqueIdV1Schema.nullable(),
  issued_at: timestampV1Schema,
  expires_at: timestampV1Schema,
  sha256: sha256V1Schema,
  size_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ...correlationShape,
};

const downloadGrantV1Schema = z
  .object({
    token: z.string().min(16).max(4096),
    expires_at: timestampV1Schema,
    one_time: z.literal(true),
  })
  .passthrough();

const releaseAdmissionAllowV1Schema = z
  .object({
    ...releaseAdmissionCommonShape,
    decision: z.literal("ALLOW"),
    reason_code: z.null().optional(),
    download_grant: downloadGrantV1Schema,
  })
  .passthrough()
  .superRefine((value, context) => {
    const issuedAt = asEpochMillis(value.issued_at);
    const expiresAt = asEpochMillis(value.expires_at);
    const grantExpiresAt = asEpochMillis(value.download_grant.expires_at);
    if (
      issuedAt >= expiresAt ||
      grantExpiresAt > expiresAt ||
      grantExpiresAt <= issuedAt
    ) {
      addInvalidLifetimeIssue(context);
    }
  });

const releaseAdmissionDenyV1Schema = z
  .object({
    ...releaseAdmissionCommonShape,
    decision: z.literal("DENY"),
    reason_code: reasonCodeV1Schema,
    download_grant: z.null(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (asEpochMillis(value.issued_at) >= asEpochMillis(value.expires_at)) {
      addInvalidLifetimeIssue(context);
    }
  });

export const releaseAdmissionV1Schema = z.union([
  releaseAdmissionAllowV1Schema,
  releaseAdmissionDenyV1Schema,
]);

export const networkAdmissionAssertionClaimsV1Schema = z
  .object({
    schema_version: schemaVersionV1Schema,
    iss: z.string().url().max(2048),
    aud: z.literal("apollo-gap"),
    sub: opaqueIdV1Schema,
    account_subject: opaqueIdV1Schema,
    installation_id: opaqueIdV1Schema,
    installation_signing_key_id: opaqueIdV1Schema,
    installation_signing_key_thumbprint: thumbprintV1Schema,
    allowed_modules: z.array(moduleCodeV1Schema).min(1).max(2),
    allowed_capabilities: z.array(capabilityCodeV1Schema).max(128),
    purpose: z.enum(["ENROLL", "REFRESH"]),
    entitlement_snapshot_revision: revisionV1Schema,
    policy_revision: revisionV1Schema,
    jti: opaqueIdV1Schema,
    replay_nonce: thumbprintV1Schema,
    iat: z.number().int().nonnegative(),
    nbf: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    ...correlationShape,
  })
  .passthrough()
  .superRefine((value, context) => {
    rejectForbiddenFields(value, context, ["key_id"]);
    if (value.sub !== value.account_subject) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sub"],
        message: "sub must equal account_subject",
      });
    }
    if (
      hasDuplicates(value.allowed_modules) ||
      value.allowed_modules.some(
        (moduleCode) => moduleCode !== "AWG" && moduleCode !== "OLC",
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowed_modules"],
        message: "Only AWG and OLC are valid GAP admission modules",
      });
    }
    if (
      hasDuplicates(value.allowed_capabilities) ||
      value.allowed_capabilities.some(
        (capabilityCode) => !capabilityCode.startsWith("network."),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowed_capabilities"],
        message:
          "GAP admission capabilities must be unique network capabilities",
      });
    }
    if (
      value.nbf > value.iat ||
      value.iat >= value.exp ||
      value.exp - value.iat > 300
    ) {
      addInvalidLifetimeIssue(context, "Invalid network assertion lifetime");
    }
  });

export const gapNetworkAdmissionEnvelopeV1Schema = z
  .object({
    schema_version: schemaVersionV1Schema,
    assertion_format: z.literal("JWT"),
    assertion: z
      .string()
      .min(64)
      .max(COMPACT_JWS_MAX_ASCII_BYTES_V1)
      .regex(JWT_COMPACT_PATTERN),
    expires_at: timestampV1Schema,
    ...correlationShape,
  })
  .passthrough();

export const aiRuntimeGrantClaimsV1Schema = z
  .object({
    schema_version: schemaVersionV1Schema,
    iss: z.string().url().max(2048),
    aud: z.literal("apollo.ai"),
    sub: opaqueIdV1Schema,
    installation_id: opaqueIdV1Schema,
    capability_codes: z.array(capabilityCodeV1Schema).min(1).max(128),
    entitlement_snapshot_revision: revisionV1Schema,
    policy_revision: revisionV1Schema,
    session_id: opaqueIdV1Schema,
    jti: opaqueIdV1Schema,
    iat: z.number().int().nonnegative(),
    nbf: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    ...correlationShape,
  })
  .passthrough()
  .superRefine((value, context) => {
    rejectForbiddenFields(value, context, AI_PRIVATE_PLATFORM_FIELDS);
    if (
      hasDuplicates(value.capability_codes) ||
      value.capability_codes.some(
        (capabilityCode) => !capabilityCode.startsWith("ai."),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capability_codes"],
        message: "AI runtime grants require unique AI capability codes",
      });
    }
    if (
      value.nbf > value.iat ||
      value.iat >= value.exp ||
      value.exp - value.iat > 300
    ) {
      addInvalidLifetimeIssue(context, "Invalid AI runtime grant lifetime");
    }
  });

export const aiModuleStatusV1Schema = z
  .object({
    schema_version: schemaVersionV1Schema,
    module_code: moduleCodeV1Schema,
    availability: upperCodeV1Schema,
    launch_state: upperCodeV1Schema,
    public_version: versionV1Schema,
    api_contract_version: versionV1Schema,
    runtime_compatibility: upperCodeV1Schema,
    updated_at: timestampV1Schema,
    stale_after_seconds: z.number().int().positive().max(86_400),
    revision: revisionV1Schema,
    ...correlationShape,
  })
  .passthrough()
  .superRefine((value, context) => {
    rejectForbiddenFields(value, context, AI_PRIVATE_PLATFORM_FIELDS);
    if (value.module_code !== "AI") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["module_code"],
        message: "AiModuleStatusV1 is the public projection for module AI",
      });
    }
  });

const platformProblemDetailsV1Schema = z
  .record(
    z.string().min(1).max(64).regex(LOWER_CODE_PATTERN),
    z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]),
  )
  .superRefine((value, context) => {
    if (
      Object.keys(value).length > 16 ||
      Buffer.byteLength(JSON.stringify(value), "utf8") > 4_096
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Problem details exceed the public bound",
      });
    }
    rejectForbiddenFields(value, context, [
      "access_token",
      "refresh_token",
      "service_role",
      "password",
      "password_hash",
      "cookie",
      "secret",
      "private_key",
    ]);
  });

export const platformProblemV1Schema = z
  .object({
    schema_version: schemaVersionV1Schema,
    code: reasonCodeV1Schema,
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
    details: platformProblemDetailsV1Schema.optional(),
    ...correlationShape,
  })
  .passthrough()
  .superRefine((value, context) => {
    rejectForbiddenFields(value, context, [
      "access_token",
      "refresh_token",
      "service_role",
      "password",
      "password_hash",
      "cookie",
      "secret",
      "private_key",
    ]);
  });

export type SessionContextV1 = z.infer<typeof sessionContextV1Schema>;
export type InstallationRegistrationRequestV1 = z.infer<
  typeof installationRegistrationRequestV1Schema
>;
export type InstallationRegistrationResponseV1 = z.infer<
  typeof installationRegistrationResponseV1Schema
>;
export type ModuleEntitlementSnapshotV1 = z.infer<
  typeof moduleEntitlementSnapshotV1Schema
>;
export type ModuleLaunchAdmissionV1 = z.infer<
  typeof moduleLaunchAdmissionV1Schema
>;
export type ClientReleaseMetadataV1 = z.infer<
  typeof clientReleaseMetadataV1Schema
>;
export type ReleaseAdmissionV1 = z.infer<typeof releaseAdmissionV1Schema>;
export type NetworkAdmissionAssertionClaimsV1 = z.infer<
  typeof networkAdmissionAssertionClaimsV1Schema
>;
export type GapNetworkAdmissionEnvelopeV1 = z.infer<
  typeof gapNetworkAdmissionEnvelopeV1Schema
>;
export type AiRuntimeGrantClaimsV1 = z.infer<
  typeof aiRuntimeGrantClaimsV1Schema
>;
export type AiModuleStatusV1 = z.infer<typeof aiModuleStatusV1Schema>;
export type PlatformProblemV1 = z.infer<typeof platformProblemV1Schema>;
