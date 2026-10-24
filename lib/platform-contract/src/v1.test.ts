import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APOLLO_PLATFORM_V1_CONTRACT_REVISION,
  COMPACT_JWS_MAX_ASCII_BYTES_V1,
  KNOWN_APOLLO_MODULE_CODES,
  aiModuleStatusV1Schema,
  aiRuntimeGrantClaimsV1Schema,
  clientReleaseMetadataV1Schema,
  entitlementStateV1Schema,
  gapNetworkAdmissionEnvelopeV1Schema,
  installationRegistrationRequestV1Schema,
  installationRegistrationResponseV1Schema,
  moduleCodeV1Schema,
  moduleEntitlementSnapshotV1Schema,
  moduleLaunchAdmissionV1Schema,
  networkAdmissionAssertionClaimsV1Schema,
  platformProblemV1Schema,
  releaseAdmissionV1Schema,
  sessionContextV1Schema,
} from "./index";

const accountSubject = "11111111-1111-4111-8111-111111111111";
const installationId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const auditCorrelationId = "55555555-5555-4555-8555-555555555555";
const releaseId = "66666666-6666-4666-8666-666666666666";
const artifactId = "77777777-7777-4777-8777-777777777777";
const now = "2026-09-04T12:00:00.000Z";
const later = "2026-09-04T12:05:00.000Z";
const digest = "a".repeat(64);
const thumbprint = "A".repeat(43);

const correlation = {
  request_id: requestId,
  audit_correlation_id: auditCorrelationId,
};

const goldenFixtureSchemas = {
  SessionContextV1: sessionContextV1Schema,
  InstallationRegistrationRequestV1: installationRegistrationRequestV1Schema,
  InstallationRegistrationResponseV1: installationRegistrationResponseV1Schema,
  ModuleEntitlementSnapshotV1: moduleEntitlementSnapshotV1Schema,
  ModuleLaunchAdmissionV1: moduleLaunchAdmissionV1Schema,
  ClientReleaseMetadataV1: clientReleaseMetadataV1Schema,
  ReleaseAdmissionV1: releaseAdmissionV1Schema,
  NetworkAdmissionAssertionClaimsV1: networkAdmissionAssertionClaimsV1Schema,
  GapNetworkAdmissionEnvelopeV1: gapNetworkAdmissionEnvelopeV1Schema,
  AiRuntimeGrantClaimsV1: aiRuntimeGrantClaimsV1Schema,
  AiModuleStatusV1: aiModuleStatusV1Schema,
  PlatformProblemV1: platformProblemV1Schema,
} as const;

type GoldenContractName = keyof typeof goldenFixtureSchemas;

function readContractFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../docs/contracts/apollo-platform/v1/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as T;
}

describe("Apollo Platform external v1 contracts", () => {
  it("publishes known module codes as recognition data without closing module_code", () => {
    expect(KNOWN_APOLLO_MODULE_CODES).toEqual([
      "QUASAR",
      "TF",
      "OLC",
      "AWG",
      "AI",
    ]);
    expect(moduleCodeV1Schema.parse("FUTURE_MODULE")).toBe("FUTURE_MODULE");
    expect(moduleCodeV1Schema.parse("vendor.future-module")).toBe(
      "vendor.future-module",
    );
    expect(moduleCodeV1Schema.safeParse("bad..module").success).toBe(false);
    expect(moduleCodeV1Schema.safeParse("/bad").success).toBe(false);
    expect(entitlementStateV1Schema.options).toEqual([
      "UNKNOWN",
      "NOT_ENTITLED",
      "ACTIVE",
      "OFFLINE_GRACE",
      "EXPIRED",
      "REVOKED",
    ]);
    expect(entitlementStateV1Schema.safeParse("GRACE").success).toBe(false);
    expect(entitlementStateV1Schema.safeParse("SUSPENDED").success).toBe(false);
  });

  it("validates an additive SessionContextV1 without exposing identity authority", () => {
    const payload = {
      schema_version: 1,
      revision: "17",
      account_subject: accountSubject,
      session_id: sessionId,
      account_state: "ACTIVE",
      display_profile: { display_name: "Apollo Operator", avatar_uri: null },
      authentication_level: "AAL2",
      authenticated_at: now,
      session_expires_at: later,
      entitlement_snapshot_revision: "41",
      issued_at: now,
      ...correlation,
      future_transport_hint: "preserved",
    } as const;
    const parsed = sessionContextV1Schema.parse(payload);

    expect(parsed.future_transport_hint).toBe("preserved");
    const { display_profile: _displayProfile, ...withoutDisplayProfile } =
      payload;
    expect(
      sessionContextV1Schema.safeParse(withoutDisplayProfile).success,
    ).toBe(false);
    expect(
      sessionContextV1Schema.safeParse({ ...parsed, service_role: "secret" })
        .success,
    ).toBe(false);
    expect(
      sessionContextV1Schema.safeParse({ ...parsed, password_hash: "secret" })
        .success,
    ).toBe(false);
  });

  it("validates public-key-only InstallationRegistrationV1 request and response", () => {
    const request = installationRegistrationRequestV1Schema.parse({
      schema_version: 1,
      registration_idempotency_key: "88888888-8888-4888-8888-888888888888",
      application_code: "APOLLO_QUASAR_WINDOWS",
      platform_code: "WINDOWS",
      architecture: "X86_64",
      app_version: "1.4.0",
      client_nonce: thumbprint,
      signing_algorithm: "EdDSA",
      signing_public_jwk: {
        kty: "OKP",
        crv: "Ed25519",
        x: thumbprint,
        alg: "EdDSA",
        kid: "install-signing-1",
      },
      signing_public_key_thumbprint: thumbprint,
      supported_capabilities: [
        {
          capability_code: "windows.quasar.module_host.v1",
          contract_version: 1,
        },
      ],
      ...correlation,
      future_attestation_transport: "preserved",
    });

    expect(request.future_attestation_transport).toBe("preserved");
    expect(
      installationRegistrationRequestV1Schema.safeParse({
        ...request,
        signing_public_jwk: { ...request.signing_public_jwk, d: thumbprint },
      }).success,
    ).toBe(false);

    const response = installationRegistrationResponseV1Schema.parse({
      schema_version: 1,
      installation_id: installationId,
      account_subject: accountSubject,
      installation_state: "ACTIVE",
      key_generation: 1,
      revision: "1",
      registered_at: now,
      server_nonce: thumbprint,
      registration_receipt: "opaque.platform.registration.receipt",
      ...correlation,
    });

    expect(response.installation_id).toBe(installationId);
  });

  it("preserves unknown modules and never synthesizes NOT_ENTITLED", () => {
    const parsed = moduleEntitlementSnapshotV1Schema.parse({
      schema_version: 1,
      account_subject: accountSubject,
      installation_id: installationId,
      account_state: "ACTIVE",
      modules: [
        {
          module_code: "FUTURE_MODULE",
          state: "ACTIVE",
          capabilities: ["future.runtime.v1"],
          valid_from: now,
          entitlement_expires_at: null,
          grace_expires_at: null,
          policy_revision: "9",
          reason_code: null,
          future_module_field: "preserved",
        },
      ],
      snapshot_revision: "41",
      policy_revision: "9",
      issued_at: now,
      refresh_after: later,
      expires_at: "2026-09-04T13:00:00.000Z",
      ...correlation,
      future_snapshot_field: "preserved",
    });

    expect(parsed.modules[0]?.module_code).toBe("FUTURE_MODULE");
    expect(parsed.modules[0]?.future_module_field).toBe("preserved");
    expect(
      parsed.modules.find(({ module_code }) => module_code === "QUASAR"),
    ).toBeUndefined();
    expect(parsed.future_snapshot_field).toBe("preserved");
  });

  it("keeps ModuleLaunchAdmissionV1 allow and deny shapes unambiguous", () => {
    expect(
      moduleLaunchAdmissionV1Schema.parse({
        schema_version: 1,
        launch_id: "99999999-9999-4999-8999-999999999999",
        account_subject: accountSubject,
        installation_id: installationId,
        module_code: "AI",
        decision: "ALLOW",
        reason_code: null,
        target_kind: "WEB",
        target_uri: "https://ai.apollot.ru/launch",
        opaque_state: "bounded-one-time-state",
        issued_at: now,
        expires_at: later,
        one_time: true,
        entitlement_snapshot_revision: "41",
        policy_revision: "9",
        ...correlation,
      }).decision,
    ).toBe("ALLOW");

    expect(
      moduleLaunchAdmissionV1Schema.safeParse({
        schema_version: 1,
        launch_id: "99999999-9999-4999-8999-999999999999",
        account_subject: accountSubject,
        installation_id: installationId,
        module_code: "AI",
        decision: "DENY",
        reason_code: "not_entitled",
        target_kind: "WEB",
        target_uri: "https://ai.apollot.ru/launch",
        opaque_state: null,
        issued_at: now,
        expires_at: later,
        one_time: true,
        entitlement_snapshot_revision: "41",
        policy_revision: "9",
        ...correlation,
      }).success,
    ).toBe(false);
  });

  it("keeps ClientReleaseMetadataV1 independent from account admission", () => {
    const parsed = clientReleaseMetadataV1Schema.parse({
      schema_version: 1,
      application_code: "APOLLO_QUASAR_WINDOWS",
      platform_code: "WINDOWS",
      architecture: "X86_64",
      release_channel: "STABLE",
      release_id: releaseId,
      artifact_id: artifactId,
      version: "1.4.0",
      minimum_source_version: "1.3.0",
      publication_state: "PUBLISHED",
      published_at: now,
      size_bytes: 1024,
      sha256: digest,
      updater_manifest_uri: `https://quasar.apollot.ru/releases/${releaseId}/manifest.json`,
      updater_manifest_sha256: digest,
      release_revision: "7",
      ...correlation,
      future_provenance_field: "preserved",
    });

    expect(parsed).not.toHaveProperty("account_subject");
    expect(parsed.future_provenance_field).toBe("preserved");
  });

  it("allows a one-time download grant only on ReleaseAdmissionV1 ALLOW", () => {
    const base = {
      schema_version: 1 as const,
      admission_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      account_subject: accountSubject,
      installation_id: installationId,
      application_code: "APOLLO_QUASAR_WINDOWS",
      module_code: "QUASAR",
      release_id: releaseId,
      artifact_id: artifactId,
      platform_code: "WINDOWS",
      architecture: "X86_64",
      release_channel: "STABLE",
      update_policy: "OPTIONAL",
      entitlement_snapshot_revision: "41",
      policy_revision: "9",
      release_revision: "7",
      rollout_cohort: null,
      issued_at: now,
      expires_at: later,
      sha256: digest,
      size_bytes: 1024,
      ...correlation,
    };

    expect(
      releaseAdmissionV1Schema.parse({
        ...base,
        decision: "ALLOW",
        reason_code: null,
        download_grant: {
          token: "opaque-one-time-download-grant",
          expires_at: later,
          one_time: true,
        },
      }).decision,
    ).toBe("ALLOW");

    expect(
      releaseAdmissionV1Schema.safeParse({
        ...base,
        decision: "DENY",
        reason_code: "not_entitled",
        download_grant: {
          token: "must-not-be-present",
          expires_at: later,
          one_time: true,
        },
      }).success,
    ).toBe(false);
  });

  it("validates the GAP admission envelope and bounded network assertion claims", () => {
    const gapAccountSubject = "account_01j6z7qx4m";
    const claims = networkAdmissionAssertionClaimsV1Schema.parse({
      schema_version: 1,
      iss: "https://api.apollot.ru",
      aud: "apollo-gap",
      sub: gapAccountSubject,
      account_subject: gapAccountSubject,
      installation_id: installationId,
      installation_signing_key_id: "install-signing-1",
      installation_signing_key_thumbprint: thumbprint,
      allowed_modules: ["AWG", "OLC"],
      allowed_capabilities: ["network.awg.outbound.v1"],
      purpose: "ENROLL",
      entitlement_snapshot_revision: "41",
      policy_revision: "9",
      jti: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      replay_nonce: thumbprint,
      iat: 1_788_523_200,
      nbf: 1_788_523_200,
      exp: 1_788_523_500,
      ...correlation,
      future_gap_claim: "preserved",
    });

    expect(claims.sub).toBe(gapAccountSubject);
    expect(claims.future_gap_claim).toBe("preserved");
    expect(
      networkAdmissionAssertionClaimsV1Schema.safeParse({
        ...claims,
        key_id: "must-live-in-jose-header",
      }).success,
    ).toBe(false);
    expect(
      networkAdmissionAssertionClaimsV1Schema.safeParse({
        ...claims,
        allowed_modules: ["QUASAR"],
      }).success,
    ).toBe(false);

    const envelope = gapNetworkAdmissionEnvelopeV1Schema.parse({
      schema_version: 1,
      assertion_format: "JWT",
      assertion: `${"x".repeat(32)}.${"y".repeat(32)}.${"z".repeat(32)}`,
      expires_at: later,
      ...correlation,
      future_envelope_field: "preserved",
    });

    expect(envelope.future_envelope_field).toBe("preserved");
    expect(
      gapNetworkAdmissionEnvelopeV1Schema.safeParse({
        ...envelope,
        assertion: `${"x".repeat(5_460)}.${"y".repeat(5_460)}.${"z".repeat(5_462)}`,
      }).success,
    ).toBe(true);
    expect(
      gapNetworkAdmissionEnvelopeV1Schema.safeParse({
        ...envelope,
        assertion: `${"x".repeat(5_460)}.${"y".repeat(5_460)}.${"z".repeat(5_463)}`,
      }).success,
    ).toBe(false);
  });

  it("keeps AI launch redemption claims single-subject and workload-free", () => {
    const grant = aiRuntimeGrantClaimsV1Schema.parse({
      schema_version: 1,
      iss: "https://api.apollot.ru",
      aud: "apollo.ai",
      sub: accountSubject,
      installation_id: installationId,
      capability_codes: ["ai.runtime.launch.v1"],
      entitlement_snapshot_revision: "41",
      policy_revision: "9",
      session_id: sessionId,
      jti: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      iat: 1_788_523_200,
      nbf: 1_788_523_200,
      exp: 1_788_523_500,
      ...correlation,
      future_grant_claim: "preserved",
    });

    expect(grant.sub).toBe(accountSubject);
    expect(grant.future_grant_claim).toBe("preserved");
    expect(
      aiRuntimeGrantClaimsV1Schema.safeParse({
        ...grant,
        account_subject: accountSubject,
      }).success,
    ).toBe(false);
    expect(
      aiRuntimeGrantClaimsV1Schema.safeParse({
        ...grant,
        prompt: "must never cross the Platform boundary",
      }).success,
    ).toBe(false);
  });

  it("accepts only bounded public AI module status projections", () => {
    const status = aiModuleStatusV1Schema.parse({
      schema_version: 1,
      module_code: "AI",
      availability: "AVAILABLE",
      launch_state: "ENABLED",
      public_version: "1.8.0",
      api_contract_version: "v1",
      runtime_compatibility: "COMPATIBLE",
      updated_at: now,
      stale_after_seconds: 60,
      revision: "12",
      ...correlation,
      future_public_status: "preserved",
    });

    expect(status.future_public_status).toBe("preserved");
    expect(
      aiModuleStatusV1Schema.safeParse({
        ...status,
        gpu_telemetry: { utilization: 99 },
      }).success,
    ).toBe(false);
    expect(
      aiModuleStatusV1Schema.safeParse({
        ...status,
        module_code: "TF",
      }).success,
    ).toBe(false);
  });

  it("keeps PlatformProblemV1 stable, correlated, and public-safe", () => {
    const problem = platformProblemV1Schema.parse({
      schema_version: 1,
      code: "installation_revoked",
      message: "The installation is no longer active.",
      retryable: false,
      details: { field: "installation_id" },
      ...correlation,
      future_problem_field: "preserved",
    });

    expect(problem.future_problem_field).toBe("preserved");
    expect(
      platformProblemV1Schema.safeParse({
        ...problem,
        details: { access_token: "must-not-cross-boundary" },
      }).success,
    ).toBe(false);
    expect(
      platformProblemV1Schema.safeParse({
        ...problem,
        access_token: "must-not-cross-boundary",
      }).success,
    ).toBe(false);
  });
});

describe("Apollo Platform v1 golden fixtures", () => {
  it("keeps the manifest and machine-code policy explicit", () => {
    const manifest = readContractFixture<{
      schema_version: number;
      contract_revision: string;
      compact_jws_max_ascii_bytes: number;
      jose_key_id_location: string;
      contracts: { name: GoldenContractName; validator_export: string }[];
    }>("manifest.json");
    const codes = readContractFixture<{
      schema_version: number;
      module_code_policy: string;
      known_module_codes: string[];
    }>("codes.json");

    expect(manifest.schema_version).toBe(1);
    expect(manifest).toMatchObject({
      contract_revision: APOLLO_PLATFORM_V1_CONTRACT_REVISION,
      compact_jws_max_ascii_bytes: COMPACT_JWS_MAX_ASCII_BYTES_V1,
      jose_key_id_location: "protected_header_only",
    });
    expect(manifest.contracts.map(({ name }) => name).sort()).toEqual(
      Object.keys(goldenFixtureSchemas).sort(),
    );
    expect(codes).toMatchObject({
      schema_version: 1,
      module_code_policy: "open_validated_string",
      known_module_codes: [...KNOWN_APOLLO_MODULE_CODES],
    });
  });

  it("accepts every positive golden fixture", () => {
    const fixtures = readContractFixture<
      { contract: GoldenContractName; payload: unknown }[]
    >("fixtures/valid.json");

    for (const fixture of fixtures) {
      expect(
        goldenFixtureSchemas[fixture.contract].safeParse(fixture.payload)
          .success,
        fixture.contract,
      ).toBe(true);
    }
  });

  it("rejects every negative golden fixture", () => {
    const fixtures = readContractFixture<
      {
        contract: GoldenContractName;
        expected_code: string;
        payload: unknown;
      }[]
    >("fixtures/invalid.json");

    for (const fixture of fixtures) {
      expect(
        goldenFixtureSchemas[fixture.contract].safeParse(fixture.payload)
          .success,
        `${fixture.contract}:${fixture.expected_code}`,
      ).toBe(false);
    }
  });
});
