import { randomBytes, randomUUID } from "node:crypto";
import { CompactSign, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { PlatformAuthClient } from "./platform-auth-client.js";

const opaque = () => randomBytes(32).toString("base64url");
const binding = {
  schema_version: 1 as const,
  contract_id: "apollo.tf.session-renewal.v1" as const,
  account_id: randomUUID(),
  session_id: randomUUID(),
  installation_id: randomUUID(),
  client_id: "apollo-tf-api",
  audience: "apollo-tf" as const,
};
async function fixture(apiOrigin?: string) {
  const keys = await generateKeyPair("EdDSA");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "renewal-test",
    alg: "EdDSA",
  };
  const nonce = opaque();
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({
    sid: binding.session_id,
    installation_id: binding.installation_id,
    nonce,
    account_status: "active",
    entitlements: ["tf.collections"],
  })
    .setProtectedHeader({ alg: "EdDSA", kid: jwk.kid })
    .setIssuer("https://api.apollot.ru")
    .setAudience("apollo-tf")
    .setSubject(binding.account_id)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 300)
    .sign(keys.privateKey);
  const result = {
    ...binding,
    family_id: randomUUID(),
    generation: 0,
    renewal_reference: opaque(),
    absolute_expires_at: new Date((now + 3600) * 1000).toISOString(),
    issued_at: new Date(now * 1000).toISOString(),
    access_expires_at: new Date((now + 300) * 1000).toISOString(),
    renew_after: new Date((now + 240) * 1000).toISOString(),
    token: { access_token: assertion, token_type: "Bearer", expires_in: 300 },
  };
  const requests: { url: string; init: RequestInit }[] = [];
  let body = JSON.stringify(result);
  let status = 200;
  let badHeaders = false;
  const client = new PlatformAuthClient({
    issuer: "https://api.apollot.ru",
    clientId: binding.client_id,
    ...(apiOrigin ? { apiOrigin, allowPrivateHttpTransport: true } : {}),
    redirectUri: "https://api.tf.apollot.ru/api/auth/callback",
    clientSecret: "test-only-confidential-secret",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      const sent = new Headers(init?.headers);
      return new Response(
        String(url).endsWith("jwks.json")
          ? JSON.stringify({ keys: [jwk] })
          : body,
        {
          status,
          headers: {
            "Content-Type": "application/json",
            ...(!badHeaders
              ? {
                  "X-Request-ID": sent.get("X-Request-ID") ?? "",
                  "X-Audit-Correlation-ID":
                    sent.get("X-Audit-Correlation-ID") ?? "",
                  "Cache-Control": "no-store",
                  Pragma: "no-cache",
                  "Referrer-Policy": "no-referrer",
                }
              : {}),
          },
        },
      );
    },
  });
  return {
    client,
    result,
    requests,
    nonce,
    assertion,
    request: { ...binding, initial_assertion: assertion, nonce },
    operation: { idempotencyKey: randomUUID(), correlationId: randomUUID() },
    respond(value: unknown, code = 200) {
      body = JSON.stringify(value);
      status = code;
    },
    raw(value: string) {
      body = value;
    },
    breakHeaders() {
      badHeaders = true;
    },
    async duplicateClaims() {
      const payload = Buffer.from(
        assertion.split(".")[1]!,
        "base64url",
      ).toString("utf8");
      return new CompactSign(
        Buffer.from(payload.replace(/}$/, `,"sid":"${binding.session_id}"}`)),
      )
        .setProtectedHeader({ alg: "EdDSA", kid: jwk.kid })
        .sign(keys.privateKey);
    },
    async expiredAssertion() {
      const payload = JSON.parse(
        Buffer.from(assertion.split(".")[1]!, "base64url").toString("utf8"),
      );
      return new SignJWT(payload)
        .setProtectedHeader({ alg: "EdDSA", kid: jwk.kid })
        .setIssuedAt(now - 301)
        .setNotBefore(now - 301)
        .setExpirationTime(now - 1)
        .sign(keys.privateKey);
    },
  };
}
describe("D05 Platform consumer", () => {
  it("rejects duplicate JWT claims even under a valid signature", async () => {
    const f = await fixture();
    f.respond({
      ...f.result,
      token: { ...f.result.token, access_token: await f.duplicateClaims() },
    });
    await expect(
      f.client.renewal.enroll(f.request, f.operation),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("classifies verified expired short access as ACCESS_EXPIRED without a family revocation", async () => {
    const f = await fixture();
    await expect(
      f.client.renewal.check({
        ...binding,
        family_id: f.result.family_id,
        generation: 0,
        access_assertion: await f.expiredAssertion(),
      }),
    ).rejects.toMatchObject({
      reason: "ACCESS_EXPIRED",
      status: 401,
      terminal: false,
    });
  });
  it("does not inherit legacy private-HTTP credential transport for the D05 extension", async () => {
    const f = await fixture("http://platform-api:8080");
    await expect(
      f.client.renewal.enroll(f.request, f.operation),
    ).rejects.toMatchObject({ status: 503 });
    expect(f.requests).toHaveLength(0);
  });
  it("rejects absent response correlation and no-store metadata", async () => {
    const f = await fixture();
    f.breakHeaders();
    await expect(
      f.client.renewal.enroll(f.request, f.operation),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("checks a signed family grant without idempotency/reference and rejects a different family or added capability", async () => {
    const f = await fixture();
    const input = {
      ...binding,
      family_id: f.result.family_id,
      generation: 0,
      access_assertion: f.assertion,
    };
    const output = {
      schema_version: 1,
      contract_id: binding.contract_id,
      family_id: f.result.family_id,
      generation: 0,
      decision: {
        active: true,
        accountId: binding.account_id,
        sessionId: binding.session_id,
        installationId: binding.installation_id,
        accountStatus: "active",
        entitlements: ["tf.collections"],
        expiresAt: f.result.access_expires_at,
      },
    };
    f.respond(output);
    expect(await f.client.renewal.check(input)).toEqual(output.decision);
    const sent = f.requests.find((r) => r.url.endsWith("/check"))!;
    expect(new Headers(sent.init.headers).has("Idempotency-Key")).toBe(false);
    expect(JSON.parse(sent.init.body as string)).not.toHaveProperty(
      "renewal_reference",
    );
    f.respond({ ...output, family_id: randomUUID() });
    await expect(f.client.renewal.check(input)).rejects.toMatchObject({
      status: 503,
    });
    f.respond({
      ...output,
      decision: {
        ...output.decision,
        entitlements: ["tf.collections", "tf.search"],
      },
    });
    await expect(f.client.renewal.check(input)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("enrolls with M2M/idempotency headers and verifies actual EdDSA nonce/binding", async () => {
    const f = await fixture();
    expect(typeof f.client.renewal?.enroll).toBe("function");
    const value = await f.client.renewal.enroll(f.request, f.operation);
    expect(value).toEqual(f.result);
    expect(f.requests[0]!.url).toBe(
      "https://api.apollot.ru/v1/tf/session-renewals/enroll",
    );
    expect(f.requests[0]!.init.redirect).toBe("error");
    const headers = new Headers(f.requests[0]!.init.headers);
    expect(headers.get("Idempotency-Key")).toBe(f.operation.idempotencyKey);
    expect(headers.get("X-Audit-Correlation-ID")).toBe(
      f.operation.correlationId,
    );
    expect(headers.get("Authorization")).toMatch(/^Basic /);
    expect(headers.has("Cookie")).toBe(false);
  });
  it.each(["nonce", "account", "cap", "extra", "token-size", "duplicate"])(
    "fails closed for %s",
    async (fault) => {
      const f = await fixture();
      expect(typeof f.client.renewal?.enroll).toBe("function");
      if (fault === "nonce") f.request.nonce = opaque();
      if (fault === "account")
        f.respond({ ...f.result, account_id: randomUUID() });
      if (fault === "cap")
        f.respond({
          ...f.result,
          absolute_expires_at: new Date(
            Date.now() + 9 * 3600_000,
          ).toISOString(),
        });
      if (fault === "extra")
        f.respond({ ...f.result, refresh_token: "must-not-leak" });
      if (fault === "token-size")
        f.respond({
          ...f.result,
          token: { ...f.result.token, access_token: "a".repeat(8193) },
        });
      if (fault === "duplicate")
        f.raw(
          JSON.stringify(f.result).replace(
            '"generation":0',
            '"generation":0,"generation":0',
          ),
        );
      await expect(
        f.client.renewal.enroll(f.request, f.operation),
      ).rejects.toMatchObject({
        code: "TF_RENEWAL_AUTHORITY_UNAVAILABLE",
        status: 503,
      });
    },
  );
  it.each([
    [401, "INVALID_CLIENT", 503],
    [401, "SESSION_REVOKED", 401],
    [403, "ACCESS_DENIED", 403],
    [503, "AUTHORITY_UNAVAILABLE", 503],
    [409, "REFERENCE_SPENT", 409],
  ] as const)(
    "maps %s %s without inventing user revocation",
    async (http, suffix, local) => {
      const f = await fixture();
      expect(typeof f.client.renewal?.enroll).toBe("function");
      f.respond(
        {
          schema_version: 1,
          contract_id: binding.contract_id,
          code: `TF_RENEWAL_${suffix}`,
          retryable: http === 503,
        },
        http,
      );
      await expect(
        f.client.renewal.enroll(f.request, f.operation),
      ).rejects.toMatchObject({ code: `TF_RENEWAL_${suffix}`, status: local });
    },
  );
});
