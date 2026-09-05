import { once } from "node:events";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as browser from "../lib/tf-browser-session.js";
import { TfFamilyStore } from "../lib/tf-family-store.js";
import {
  memoryFamilyPersistence,
  testBinding,
  testOpaque,
  testRenewalResult,
} from "../lib/tf-renewal-test-support.js";
import {
  TfRenewalError,
  type RenewalResult,
  type TfRenewalClient,
} from "../lib/tf-renewal-contract.js";

const servers: Server[] = [];
const origin = "https://tf.apollot.ru";
let createApiApp: (typeof import("../app.js"))["createApiApp"];
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
  ({ createApiApp } = await import("../app.js"));
}, 30_000);
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});
async function fixture() {
  let now = Date.now();
  const binding = testBinding();
  const persistence = memoryFamilyPersistence(() => now);
  const store = new TfFamilyStore(persistence, () => now);
  let current: RenewalResult;
  const client = {
    enroll: vi.fn(async () => (current = testRenewalResult(binding, now))),
    renew: vi.fn(
      async () => (current = testRenewalResult(binding, now, current)),
    ),
    check: vi.fn<TfRenewalClient["check"]>(async () => ({
      active: true,
      accountId: binding.account_id,
      sessionId: binding.session_id,
      installationId: binding.installation_id,
      accountStatus: "active",
      entitlements: ["tf.collections"],
      expiresAt: current.access_expires_at,
    })),
    revoke: vi.fn(async () => {}),
  };
  expect(typeof browser.TfRenewalConsumer).toBe("function");
  const renewal = new browser.TfRenewalConsumer({
    store,
    client,
    clientId: binding.client_id,
    revocationKeys: {
      active: "test-key",
      keys: new Map([["test-key", randomBytes(32)]]),
    },
  });
  const login = await renewal.createLogin();
  await store.beginEnrollment(login.handle, binding, "initial.assertion.value");
  await renewal.renew(login.handle);
  const platform = {
    createAuthorizationUrl: vi.fn(),
    exchangeCode: vi.fn(),
    introspect: vi.fn(),
  };
  const sessionStore = {
    createTransaction: vi.fn(),
    consumeTransaction: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    observeSession: vi.fn(),
    refreshSession: vi.fn(),
    revokeSession: vi.fn(),
    issueProviderOAuthState: vi.fn(),
    consumeProviderOAuthState: vi.fn(),
    issueWebSocketTicket: vi.fn(),
  };
  const list = vi.fn(async () => []);
  const app = createApiApp({
    nodeEnv: "test",
    auth: {
      platform,
      sessionStore,
      webOrigin: origin,
      secureCookies: true,
      renewal,
    },
    collections: { store: { list, save: vi.fn(), remove: vi.fn() } },
  });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const cookie = `__Host-apollo_tf_family=${login.handle}; __Host-apollo_tf_family_csrf=${login.record.csrf}`;
  const request = (path: string, init: RequestInit = {}) =>
    fetch(url + path, {
      ...init,
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  return {
    store,
    persistence,
    renewal,
    login,
    client,
    platform,
    sessionStore,
    list,
    request,
    binding,
    url,
    cookie,
    advance(ms: number) {
      now += ms;
    },
  };
}
describe("D05 actual TF routes", () => {
  it("does not return CSRF or clear cookies when Redis is unavailable", async () => {
    const f = await fixture();
    vi.spyOn(f.persistence, "read").mockRejectedValue(
      new Error("controlled Redis outage"),
    );
    const r = await f.request("/auth/renew-context", {
      method: "POST",
      body: "{}",
    });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({
      code: "TF_RENEWAL_AUTHORITY_UNAVAILABLE",
      retryable: true,
    });
    expect(r.headers.has("set-cookie")).toBe(false);
  });
  it("reports a definitive capability denial on me as403, not an authority outage", async () => {
    const f = await fixture();
    f.client.check.mockRejectedValue(new TfRenewalError("ACCESS_DENIED"));
    const r = await f.request("/auth/me");
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "forbidden" });
  });
  it("resolves response loss with the exact persisted key/nonce/body and bounded attempts", async () => {
    const f = await fixture();
    f.advance(301_000);
    const original = f.client.renew.getMockImplementation()!;
    f.client.renew.mockRejectedValueOnce(
      new TfRenewalError("OPERATION_UNCERTAIN"),
    );
    const send = () =>
      f.request("/auth/renew", {
        method: "POST",
        body: "{}",
        headers: { "X-CSRF-Token": f.login.record.csrf },
      });
    expect((await send()).status).toBe(503);
    const pending = await f.store.read(f.login.handle);
    f.advance(1001);
    f.client.renew.mockImplementation(original);
    expect((await send()).status).toBe(204);
    const first = f.client.renew.mock.calls[0] as unknown as [
      unknown,
      { idempotencyKey: string; correlationId: string },
    ];
    const second = f.client.renew.mock.calls[1] as unknown as typeof first;
    expect(second[0]).toEqual(first[0]);
    expect(second[1].idempotencyKey).toBe(first[1].idempotencyKey);
    expect(second[1].correlationId).toBe(first[1].correlationId);
    expect(pending?.record.phase).toBe("ACTIVE");
    expect((await f.store.read(f.login.handle))?.record.phase).toBe("ACTIVE");
  });
  it("does not select legacy when only the successor CSRF cookie survives", async () => {
    const f = await fixture();
    f.sessionStore.getSession.mockResolvedValue({
      accountId: f.binding.account_id,
    });
    const r = await f.request("/auth/me", {
      headers: {
        Cookie: `__Host-apollo_tf_family_csrf=${f.login.record.csrf}; __Host-apollo_tf=${testOpaque()}; __Host-apollo_tf_csrf=${testOpaque()}`,
      },
    });
    expect(r.status).toBe(401);
    expect(f.sessionStore.getSession).not.toHaveBeenCalled();
  });
  it("rejects duplicate raw security headers and duplicate family cookies before dispatch", async () => {
    const f = await fixture();
    const r = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        f.url + "/auth/renew-context",
        {
          method: "POST",
          headers: [
            "Host",
            new URL(f.url).host,
            "Cookie",
            f.cookie,
            "Origin",
            origin,
            "Origin",
            origin,
            "Content-Type",
            "application/json",
            "Content-Length",
            "2",
          ],
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
    expect(r).toBe(403);
    expect(
      (
        await f.request("/auth/me", {
          headers: {
            Cookie: `${f.cookie}; __Host-apollo_tf_family=${testOpaque()}`,
          },
        })
      ).status,
    ).toBe(401);
  });
  it.each([
    ["{", 400],
    [JSON.stringify({ x: "a".repeat(13000) }), 413],
  ] as const)(
    "bounds and sanitizes malformed renewal bodies",
    async (body, status) => {
      const f = await fixture();
      const r = await f.request("/auth/renew", {
        method: "POST",
        body,
        headers: { "X-CSRF-Token": f.login.record.csrf },
      });
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({
        code: "TF_RENEWAL_INVALID_REQUEST",
        retryable: false,
      });
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(f.client.renew).not.toHaveBeenCalled();
    },
  );
  it("does not let a late terminal check close a newer committed generation", async () => {
    const f = await fixture();
    f.advance(241_000);
    let rejectOld!: (error: Error) => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    f.client.check.mockImplementationOnce(() => {
      entered();
      return new Promise((_, reject) => {
        rejectOld = reject;
      });
    });
    const old = f.renewal.authorize(f.login.handle);
    const rejected = expect(old).rejects.toMatchObject({ status: 503 });
    await started;
    await f.renewal.renew(f.login.handle);
    rejectOld(new TfRenewalError("SESSION_REVOKED"));
    await rejected;
    expect((await f.store.read(f.login.handle))?.record.phase).toBe("ACTIVE");
  });
  it("coalesces an early/repeated renew into checked current access without a new rotation", async () => {
    const f = await fixture();
    const before = await f.store.read(f.login.handle);
    const r = await f.request("/auth/renew", {
      method: "POST",
      body: "{}",
      headers: { "X-CSRF-Token": f.login.record.csrf },
    });
    expect(r.status).toBe(204);
    expect(f.client.renew).not.toHaveBeenCalled();
    expect((await f.store.read(f.login.handle))?.raw).toBe(before?.raw);
  });
  it("keeps successor WS ticket issuance gated even when a valid legacy cookie is also present", async () => {
    const f = await fixture();
    f.client.check.mockImplementation(async () => ({
      active: true,
      accountId: f.binding.account_id,
      sessionId: f.binding.session_id,
      installationId: f.binding.installation_id,
      accountStatus: "active",
      entitlements: ["tf.search"],
      expiresAt: new Date(Date.now() + 200_000).toISOString(),
    }));
    f.sessionStore.issueWebSocketTicket.mockResolvedValue(testOpaque());
    const r = await f.request("/ws/tickets", {
      method: "POST",
      headers: {
        "X-CSRF-Token": f.login.record.csrf,
        Cookie: `__Host-apollo_tf_family=${f.login.handle}; __Host-apollo_tf_family_csrf=${f.login.record.csrf}; __Host-apollo_tf=${testOpaque()}`,
      },
    });
    expect(r.status).toBe(503);
    expect(f.sessionStore.issueWebSocketTicket).not.toHaveBeenCalled();
  });
  it("starts a fresh persisted login, fences the prior family, and enrolls callback without legacy introspection", async () => {
    const f = await fixture();
    f.sessionStore.createTransaction.mockResolvedValue(testOpaque());
    f.platform.createAuthorizationUrl.mockReturnValue(
      "https://api.apollot.ru/v1/oauth/authorize",
    );
    const start = await f.request("/auth/start", { redirect: "manual" });
    expect(start.status).toBe(303);
    const tx = f.sessionStore.createTransaction.mock.calls[0]![0];
    expect(tx.familyHandle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await f.store.read(f.login.handle))?.record.phase).toBe("CLOSED");
    f.sessionStore.consumeTransaction.mockResolvedValue(tx);
    f.platform.exchangeCode.mockResolvedValue({
      assertion: "initial.test.assertion",
      claims: {
        sub: f.binding.account_id,
        sid: f.binding.session_id,
        installation_id: f.binding.installation_id,
      },
    });
    const callback = await f.request(
      `/auth/callback?code=${"a".repeat(32)}&state=${tx.state}`,
      {
        redirect: "manual",
        headers: { Cookie: `__Host-apollo_tf_tx=${testOpaque()}` },
      },
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("set-cookie")).toContain(
      `__Host-apollo_tf_family=${tx.familyHandle}`,
    );
    expect((await f.store.read(tx.familyHandle))?.record.phase).toBe("ACTIVE");
    expect(f.platform.introspect).not.toHaveBeenCalled();
    expect(f.sessionStore.createSession).not.toHaveBeenCalled();
  });
  it("checks family CSRF binding for actual protected writes, not only double-submit equality", async () => {
    const f = await fixture();
    const forged = testOpaque();
    const r = await f.request("/collections/liked/track", {
      method: "DELETE",
      headers: {
        Cookie: `__Host-apollo_tf_family=${f.login.handle}; __Host-apollo_tf_family_csrf=${forged}`,
        "X-CSRF-Token": forged,
      },
    });
    expect(r.status).toBe(403);
  });
  it("does not slide absolute lifetime and clears terminal cookies at the fixed deadline", async () => {
    const f = await fixture();
    const before = await f.store.read(f.login.handle);
    f.advance(301_000);
    const r = await f.request("/auth/renew", {
      method: "POST",
      body: "{}",
      headers: { "X-CSRF-Token": f.login.record.csrf },
    });
    expect(r.status).toBe(204);
    expect((await f.store.read(f.login.handle))?.record.expiresAt).toBe(
      before?.record.expiresAt,
    );
    f.advance(3600_000);
    const me = await f.request("/auth/me");
    expect(me.status).toBe(401);
    expect(me.headers.get("set-cookie")).toContain("__Host-apollo_tf_family=");
  });
  it.each(["?x=1", "?"])(
    "rejects renew queries %s without dispatch",
    async (query) => {
      const f = await fixture();
      const r = await f.request(`/auth/renew${query}`, {
        method: "POST",
        body: "{}",
        headers: { "X-CSRF-Token": f.login.record.csrf },
      });
      expect(r.status).toBe(400);
      expect(f.client.renew).not.toHaveBeenCalled();
    },
  );
  it("rejects text bodies and rate-limits non-authorizing context without extending TTL", async () => {
    const f = await fixture();
    expect(
      (
        await f.request("/auth/renew-context", {
          method: "POST",
          body: "{}",
          headers: { "Content-Type": "text/plain" },
        })
      ).status,
    ).toBe(415);
    const before = await f.store.read(f.login.handle);
    for (let n = 0; n < 10; n++)
      expect(
        (await f.request("/auth/renew-context", { method: "POST", body: "{}" }))
          .status,
      ).toBe(200);
    expect(
      (await f.request("/auth/renew-context", { method: "POST", body: "{}" }))
        .status,
    ).toBe(429);
    expect((await f.store.read(f.login.handle))?.raw).toBe(before?.raw);
  });
  it("retains cookies/CSRF context after short expiry, denies access, then renews without another login", async () => {
    const f = await fixture();
    f.advance(301_000);
    const me = await f.request("/auth/me");
    expect(me.status).toBe(401);
    expect(me.headers.has("set-cookie")).toBe(false);
    const denied = await f.request("/collections/liked");
    expect(denied.status).toBe(401);
    expect(f.list).not.toHaveBeenCalled();
    const context = await f.request("/auth/renew-context", {
      method: "POST",
      body: "{}",
    });
    expect(context.status).toBe(200);
    expect(await context.json()).toEqual({ csrf_token: f.login.record.csrf });
    expect(context.headers.has("set-cookie")).toBe(false);
    const renew = await f.request("/auth/renew", {
      method: "POST",
      body: "{}",
      headers: { "X-CSRF-Token": f.login.record.csrf },
    });
    expect(renew.status).toBe(204);
    expect((await f.request("/collections/liked")).status).toBe(200);
    expect(f.platform.introspect).not.toHaveBeenCalled();
    expect(f.sessionStore.observeSession).not.toHaveBeenCalled();
  });
  it("returns503 on family-check outage even alongside syntactically valid legacy cookies", async () => {
    const f = await fixture();
    f.client.check.mockRejectedValue(
      new TfRenewalError("AUTHORITY_UNAVAILABLE"),
    );
    const r = await f.request("/collections/liked", {
      headers: {
        Cookie: `__Host-apollo_tf_family=${f.login.handle}; __Host-apollo_tf_family_csrf=${f.login.record.csrf}; __Host-apollo_tf=${testOpaque()}`,
      },
    });
    expect(r.status).toBe(503);
    expect(f.list).not.toHaveBeenCalled();
    expect(f.platform.introspect).not.toHaveBeenCalled();
  });
  it("rejects wrong Origin, absent CSRF and nonempty/duplicate bodies before renewal", async () => {
    const f = await fixture();
    expect(
      (
        await f.request("/auth/renew-context", {
          method: "POST",
          body: "{}",
          headers: { Origin: "https://evil.invalid" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await f.request("/auth/renew", { method: "POST", body: "{}" })).status,
    ).toBe(403);
    expect(
      (
        await f.request("/auth/renew", {
          method: "POST",
          body: '{"x":1,"x":1}',
          headers: { "X-CSRF-Token": f.login.record.csrf },
        })
      ).status,
    ).toBe(400);
    expect(f.client.renew).not.toHaveBeenCalled();
  });
  it("uses current capability state and does not confuse403 with an outage", async () => {
    const f = await fixture();
    f.client.check.mockImplementation(async () => ({
      active: true,
      accountId: f.binding.account_id,
      sessionId: f.binding.session_id,
      installationId: f.binding.installation_id,
      accountStatus: "active",
      entitlements: [],
      expiresAt: new Date(Date.now() + 200_000).toISOString(),
    }));
    expect((await f.request("/collections/liked")).status).toBe(403);
    expect(f.list).not.toHaveBeenCalled();
  });
  it("logout clears family cookies and retains encrypted revoke-only work when Platform is unavailable", async () => {
    const f = await fixture();
    f.advance(301_000);
    f.client.revoke.mockRejectedValue(
      new TfRenewalError("AUTHORITY_UNAVAILABLE"),
    );
    const before = await f.store.read(f.login.handle);
    const r = await f.request("/auth/logout", {
      method: "POST",
      body: "{}",
      headers: { "X-CSRF-Token": f.login.record.csrf },
    });
    expect(r.status).toBe(503);
    expect(r.headers.get("set-cookie")).toContain("__Host-apollo_tf_family=");
    const record = await f.store.read(f.login.handle);
    expect(record?.record.phase).toBe("CLOSED");
    if (before?.record.phase === "ACTIVE")
      expect(record?.raw).not.toContain(before.record.result.renewal_reference);
    expect(
      (await f.request("/auth/renew-context", { method: "POST", body: "{}" }))
        .status,
    ).toBe(401);
    f.client.revoke.mockResolvedValue();
    await f.renewal.drainRevocations();
    expect((await f.store.read(f.login.handle))?.record).toMatchObject({
      phase: "CLOSED",
      revocation: null,
    });
  });
});
