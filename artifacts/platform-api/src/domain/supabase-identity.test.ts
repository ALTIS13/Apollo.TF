import { createServer } from "node:http";

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
} from "jose";
import type { Pool } from "pg";
import type { PoolClient } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import {
  PostgresSupabaseSessionLiveness,
  SupabaseAccessTokenVerifier,
  SupabaseIdentityService,
  createSupabaseRemoteAccessTokenVerifier,
  type SupabaseSessionClaims,
} from "./supabase-identity.js";
import { invalidCredentialsError } from "./errors.js";
import type {
  Account,
  AccountIdentitySubject,
  IdentitySubjectRepository,
  PlatformRepository,
} from "./repository.js";
import type { PlatformTransaction } from "./registration.js";

const ISSUER = "http://127.0.0.1:18300/auth/v1";
const SUBJECT = "10000000-0000-4000-8000-000000000014";
const SESSION_ID = "10000000-0000-4000-8000-000000000015";
const AUDIENCE = "authenticated";

let privateKey: CryptoKey;
let publicJwk: JWK;
let verifier: SupabaseAccessTokenVerifier;

beforeAll(async () => {
  const generated = await generateKeyPair("ES256");
  privateKey = generated.privateKey;
  publicJwk = {
    ...(await exportJWK(generated.publicKey)),
    alg: "ES256",
    kid: "supabase-test-key",
    use: "sig",
  };
  verifier = new SupabaseAccessTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwks: createLocalJWKSet({
      keys: [publicJwk],
    }),
  });
});

interface TokenOverrides {
  readonly issuer?: string;
  readonly audience?: string;
  readonly subject?: string;
  readonly sessionId?: string | null;
  readonly role?: string;
  readonly aal?: string;
  readonly isAnonymous?: boolean;
  readonly issuedAt?: number | null;
  readonly expiresAt?: number;
}

async function signedAccessToken(overrides: TokenOverrides = {}) {
  const issuedAt = overrides.issuedAt ?? Math.floor(Date.now() / 1_000);
  const expiresAt = overrides.expiresAt ?? issuedAt + 300;
  const payload: Record<string, unknown> = {
    role: overrides.role ?? "authenticated",
    aal: overrides.aal ?? "aal1",
    is_anonymous: overrides.isAnonymous ?? false,
  };
  if (overrides.sessionId !== null) {
    payload.session_id = overrides.sessionId ?? SESSION_ID;
  }
  let builder = new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", kid: "supabase-test-key" })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject(overrides.subject ?? SUBJECT)
    .setExpirationTime(expiresAt);
  if (overrides.issuedAt !== null) builder = builder.setIssuedAt(issuedAt);
  const token = await builder.sign(privateKey);
  return { expiresAt, token };
}

const CONTEXT_EXPIRES_AT = new Date("2026-09-05T01:00:00.000Z");

function createIdentityServiceHarness() {
  const claims: SupabaseSessionClaims = {
    providerCode: "supabase",
    issuer: ISSUER,
    subject: SUBJECT,
    sessionId: SESSION_ID,
    aal: "aal1",
    expiresAt: CONTEXT_EXPIRES_AT,
  };
  const linkedAt = new Date("2026-09-01T00:00:00.000Z");
  const state: {
    account: Account | null;
    link: AccountIdentitySubject | null;
    live: boolean;
    repositoryFailure: boolean;
  } = {
    account: {
      id: "10000000-0000-4000-8000-000000000001",
      email: "must-not-leak@example.test",
      displayName: "Apollo Account",
      status: "active",
      emailVerifiedAt: linkedAt,
      activatedAt: linkedAt,
      suspendedAt: null,
      deletedAt: null,
      createdAt: linkedAt,
      updatedAt: linkedAt,
    },
    link: {
      id: "10000000-0000-4000-8000-000000000013",
      accountId: "10000000-0000-4000-8000-000000000001",
      providerCode: "supabase",
      identityIssuer: ISSUER,
      identitySubject: SUBJECT,
      state: "active",
      linkedAt,
      lastSeenAt: linkedAt,
      revokedAt: null,
      revision: 1,
    },
    live: true,
    repositoryFailure: false,
  };
  const repository = {
    async findAccountByIdentitySubject() {
      if (state.repositoryFailure) throw new Error("platform database down");
      return state.link;
    },
    async lockAccountById() {
      if (state.repositoryFailure) throw new Error("platform database down");
      return state.account;
    },
  } as IdentitySubjectRepository & Pick<PlatformRepository, "lockAccountById">;
  const verifier = {
    async verify(rawToken: string) {
      if (rawToken !== "valid-access-token") throw invalidCredentialsError();
      return claims;
    },
  };
  const liveness = {
    async isLive() {
      return state.live;
    },
  };
  const client = {
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as PoolClient;
  const transaction: PlatformTransaction = async (_pool, callback) =>
    callback(client);
  const service = new SupabaseIdentityService({
    pool: {} as Pool,
    repository,
    verifier,
    sessionLiveness: liveness,
    transaction,
  });
  return { service, state };
}

describe("Supabase identity adapter", () => {
  it("provides the isolated identity authority boundary", async () => {
    const identityModule = await import("./supabase-identity.js").catch(
      () => null,
    );

    expect(identityModule).not.toBeNull();
    expect(identityModule?.SupabaseAccessTokenVerifier).toBeTypeOf("function");
    expect(identityModule?.PostgresSupabaseSessionLiveness).toBeTypeOf(
      "function",
    );
    expect(identityModule?.SupabaseIdentityService).toBeTypeOf("function");
    expect(identityModule?.createSupabaseRemoteAccessTokenVerifier).toBeTypeOf(
      "function",
    );
  });

  it("verifies an asymmetric Supabase access token into a minimal identity context", async () => {
    const { expiresAt, token } = await signedAccessToken();

    await expect(verifier.verify(token)).resolves.toEqual({
      providerCode: "supabase",
      issuer: ISSUER,
      subject: SUBJECT,
      sessionId: SESSION_ID,
      aal: "aal1",
      expiresAt: new Date(expiresAt * 1_000),
    });
  });

  it("loads the public key from the issuer JWKS endpoint", async () => {
    const requestedPaths: string[] = [];
    const server = createServer((request, response) => {
      requestedPaths.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("test server did not bind to TCP");
      }
      const issuer = `http://127.0.0.1:${address.port}/auth/v1`;
      const remoteVerifier = createSupabaseRemoteAccessTokenVerifier({
        issuer,
      });
      const { token } = await signedAccessToken({ issuer });

      await expect(remoteVerifier.verify(token)).resolves.toMatchObject({
        issuer,
        subject: SUBJECT,
        sessionId: SESSION_ID,
      });
      expect(requestedPaths).toEqual(["/auth/v1/.well-known/jwks.json"]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it.each([
    "http://identity.example/auth/v1",
    "https://identity.example/",
    "https://identity.example/auth/v1/",
    "https://identity.example/auth/v1?tenant=apollo",
  ])("rejects a non-canonical issuer endpoint: %s", (issuer) => {
    expect(() => createSupabaseRemoteAccessTokenVerifier({ issuer })).toThrow(
      "Supabase issuer is invalid",
    );
  });

  it.each([
    ["wrong issuer", { issuer: "https://identity.invalid/auth/v1" }],
    ["wrong audience", { audience: "anon" }],
    ["missing session", { sessionId: null }],
    ["anonymous identity", { isAnonymous: true }],
    ["wrong role", { role: "anon" }],
    ["unknown assurance level", { aal: "aal3" }],
    ["malformed subject", { subject: "not-a-uuid" }],
    ["missing issued-at time", { issuedAt: null }],
  ] as const)("fails closed for a %s claim set", async (_name, overrides) => {
    const { token } = await signedAccessToken(overrides);

    await expect(verifier.verify(token)).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("rejects expired and incorrectly signed access tokens", async () => {
    const current = Math.floor(Date.now() / 1_000);
    const expired = await signedAccessToken({
      issuedAt: current - 120,
      expiresAt: current - 60,
    });
    const otherKey = await generateKeyPair("ES256");
    const wrongSignature = await new SignJWT({
      role: "authenticated",
      aal: "aal1",
      is_anonymous: false,
      session_id: SESSION_ID,
    })
      .setProtectedHeader({ alg: "ES256", kid: "supabase-test-key" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(SUBJECT)
      .setIssuedAt(current)
      .setExpirationTime(current + 300)
      .sign(otherKey.privateKey);

    await expect(verifier.verify(expired.token)).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    await expect(verifier.verify(wrongSignature)).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("checks strict liveness by session id and subject with a least-privilege query", async () => {
    const queries: { text: string; values: readonly unknown[] }[] = [];
    const pool = {
      query: async (text: string, values: readonly unknown[]) => {
        queries.push({ text, values });
        return { rows: [{ is_live: true }] };
      },
    } as unknown as Pool;
    const liveness = new PostgresSupabaseSessionLiveness(pool);

    await expect(
      liveness.isLive({ subject: SUBJECT, sessionId: SESSION_ID }),
    ).resolves.toBe(true);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.text).toMatch(
      /from auth\.sessions[\s\S]*id = \$1[\s\S]*user_id = \$2/i,
    );
    expect(queries[0]!.values).toEqual([SESSION_ID, SUBJECT]);
    expect(queries[0]!.text).not.toMatch(/email|refresh_tokens|service_role/i);
  });

  it("fails strict liveness closed when the session is absent or storage fails", async () => {
    const absentPool = {
      query: async () => ({ rows: [{ is_live: false }] }),
    } as unknown as Pool;
    const failingPool = {
      query: async () => {
        throw new Error("auth database unavailable");
      },
    } as unknown as Pool;

    await expect(
      new PostgresSupabaseSessionLiveness(absentPool).isLive({
        subject: SUBJECT,
        sessionId: SESSION_ID,
      }),
    ).resolves.toBe(false);
    await expect(
      new PostgresSupabaseSessionLiveness(failingPool).isLive({
        subject: SUBJECT,
        sessionId: SESSION_ID,
      }),
    ).resolves.toBe(false);
  });

  it("resolves the Apollo account from subject without using email", async () => {
    const harness = createIdentityServiceHarness();
    harness.state.live = false;

    const context = await harness.service.authenticate("valid-access-token");

    expect(context).toEqual({
      accountId: "10000000-0000-4000-8000-000000000001",
      providerCode: "supabase",
      issuer: ISSUER,
      subject: SUBJECT,
      sessionId: SESSION_ID,
      aal: "aal1",
      expiresAt: CONTEXT_EXPIRES_AT,
      identityRevision: 1,
    });
    expect(JSON.stringify(context)).not.toContain("must-not-leak@example.test");
  });

  it("requires live auth.sessions presence for a sensitive admission", async () => {
    const harness = createIdentityServiceHarness();

    await expect(
      harness.service.authenticateForSensitiveAction("valid-access-token"),
    ).resolves.toMatchObject({ accountId: harness.state.account!.id });

    harness.state.live = false;
    await expect(
      harness.service.authenticateForSensitiveAction("valid-access-token"),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it.each(["missing", "revoked", "suspended"] as const)(
    "denies a valid Supabase identity when the Platform account link is %s",
    async (scenario) => {
      const harness = createIdentityServiceHarness();
      if (scenario === "missing") harness.state.link = null;
      if (scenario === "revoked") {
        harness.state.link = {
          ...harness.state.link!,
          state: "revoked",
          revokedAt: new Date("2026-09-04T00:00:00.000Z"),
        };
      }
      if (scenario === "suspended") {
        harness.state.account = {
          ...harness.state.account!,
          status: "suspended",
          suspendedAt: new Date("2026-09-04T00:00:00.000Z"),
        };
      }

      await expect(
        harness.service.authenticate("valid-access-token"),
      ).rejects.toMatchObject({ code: "account_access_denied" });
    },
  );

  it("keeps invalid identity and Platform storage failure semantics distinct", async () => {
    const harness = createIdentityServiceHarness();

    await expect(
      harness.service.authenticate("invalid-token"),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    harness.state.repositoryFailure = true;
    await expect(
      harness.service.authenticate("valid-access-token"),
    ).rejects.toMatchObject({ code: "policy_unavailable" });
  });

  it("fails closed for an internally inconsistent active identity link", async () => {
    const harness = createIdentityServiceHarness();
    harness.state.link = {
      ...harness.state.link!,
      state: "active",
      revokedAt: new Date("2026-09-04T00:00:00.000Z"),
    };

    await expect(
      harness.service.authenticate("valid-access-token"),
    ).rejects.toMatchObject({ code: "policy_unavailable" });
  });
});
