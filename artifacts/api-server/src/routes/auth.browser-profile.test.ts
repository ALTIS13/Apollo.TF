import { randomBytes } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { Express } from "express";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TfRenewalConsumer } from "../lib/tf-renewal-consumer.js";
import { TfFamilyStore } from "../lib/tf-family-store.js";
import {
  memoryFamilyPersistence,
  testBinding,
  testRenewalResult,
} from "../lib/tf-renewal-test-support.js";
import {
  TfRenewalError,
  type TfRenewalClient,
} from "../lib/tf-renewal-contract.js";
let createApiApp: (typeof import("../app.js"))["createApiApp"];
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
  ({ createApiApp } = await import("../app.js"));
});
async function request(app: Express, cookie: string) {
  const req = new IncomingMessage(new Socket());
  req.method = "GET";
  req.url = "/api/auth/me";
  req.headers = { cookie, origin: "https://tf.apollot.ru" };
  const res = new ServerResponse(req);
  return new Promise<{
    status: number;
    body: unknown;
    headers: ReturnType<typeof res.getHeaders>;
  }>((resolve) => {
    res.end = function (chunk?: unknown) {
      resolve({
        status: res.statusCode,
        body: JSON.parse(chunk?.toString() ?? "null"),
        headers: res.getHeaders(),
      });
      return res;
    } as typeof res.end;
    app(req, res);
    req.push(null);
  });
}
async function fixture() {
  let now = Date.now();
  const binding = testBinding();
  const store = new TfFamilyStore(
    memoryFamilyPersistence(() => now),
    () => now,
  );
  const result = testRenewalResult(binding, now);
  const client: Pick<TfRenewalClient, "enroll" | "renew" | "revoke" | "check"> =
    {
      enroll: async () => result,
      renew: vi.fn(),
      revoke: async () => {},
      check: async () => ({
        active: true,
        accountId: binding.account_id,
        sessionId: binding.session_id,
        installationId: binding.installation_id,
        accountStatus: "active",
        entitlements: ["tf.search"],
        expiresAt: result.access_expires_at,
      }),
    };
  const renewal = new TfRenewalConsumer({
    store,
    client,
    clientId: binding.client_id,
    revocationKeys: {
      active: "test",
      keys: new Map([["test", randomBytes(32)]]),
    },
  });
  const login = await renewal.createLogin();
  await store.beginEnrollment(login.handle, binding, "initial.assertion");
  await renewal.renew(login.handle);
  const legacySession = {
    accountId: binding.account_id,
    installationId: binding.installation_id,
    entitlements: ["tf.search"],
    expiresAt: result.access_expires_at,
  };
  const sessionStore = {
    getSession: vi.fn(async () => ({
      ...legacySession,
      id: "local-test",
      platformSessionId: binding.session_id,
      assertionExpiresAt: result.access_expires_at,
    })),
    observeSession: vi.fn(),
    createTransaction: vi.fn(),
    consumeTransaction: vi.fn(),
    createSession: vi.fn(),
    refreshSession: vi.fn(),
    revokeSession: vi.fn(),
    issueProviderOAuthState: vi.fn(),
    consumeProviderOAuthState: vi.fn(),
    issueWebSocketTicket: vi.fn(),
  };
  const app = createApiApp({
    nodeEnv: "test",
    auth: {
      webOrigin: "https://tf.apollot.ru",
      secureCookies: true,
      renewal,
      sessionStore,
      platform: {
        createAuthorizationUrl: vi.fn(),
        exchangeCode: vi.fn(),
        introspect: vi.fn(),
      },
    },
  });
  const cookie = `__Host-apollo_tf_family=${login.handle}; __Host-apollo_tf_family_csrf=${login.record.csrf}`;
  return {
    app,
    cookie,
    client,
    legacySession,
    csrf: login.record.csrf,
    advance() {
      now += 301_000;
    },
  };
}
describe("local browser profile header without frozen me body changes", () => {
  it("family success exposes only a non-secret profile header to the exact web origin", async () => {
    const f = await fixture();
    const r = await request(f.app, f.cookie);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ...f.legacySession, csrfToken: f.csrf });
    expect(r.headers["apollo-tf-session-profile"]).toBe("renewal-v1");
    expect(r.headers["access-control-expose-headers"]).toBe(
      "Apollo-TF-Session-Profile",
    );
    expect(r.headers["access-control-allow-origin"]).toBe(
      "https://tf.apollot.ru",
    );
  });
  it("short expiry keeps generic401 and family cookies, with profile hint only", async () => {
    const f = await fixture();
    f.advance();
    const r = await request(f.app, f.cookie);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "unauthorized" });
    expect(r.headers["apollo-tf-session-profile"]).toBe("renewal-v1");
    expect(r.headers["set-cookie"]).toBeUndefined();
  });
  it("terminal401 still clears cookies; header never means authorization", async () => {
    const f = await fixture();
    f.client.check = async () => {
      throw new TfRenewalError("SESSION_REVOKED");
    };
    const r = await request(f.app, f.cookie);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "unauthorized" });
    expect(r.headers["set-cookie"]).toBeDefined();
    expect(r.headers["apollo-tf-session-profile"]).toBe("renewal-v1");
  });
  it("legacy remains original body with non-renewable legacy header", async () => {
    const f = await fixture();
    const opaque = "a".repeat(42) + "A";
    const r = await request(
      f.app,
      `__Host-apollo_tf=${opaque}; __Host-apollo_tf_csrf=${opaque}`,
    );
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ...f.legacySession, csrfToken: opaque });
    expect(r.headers["apollo-tf-session-profile"]).toBe("legacy-v1");
  });
});
