import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AUTH_COOKIE_NAMES as names,
  TfRenewalConsumer,
} from "../lib/tf-browser-session.js";
import { TfFamilyStore } from "../lib/tf-family-store.js";
import {
  familyBinding,
  TfRenewalError,
  type RenewalResult,
  type TfRenewalClient,
} from "../lib/tf-renewal-contract.js";
import {
  memoryFamilyPersistence,
  testBinding,
  testOpaque,
  testRenewalResult,
} from "../lib/tf-renewal-test-support.js";
import type { TfSessionStore } from "../lib/tf-session-store.js";

const origin = "https://tf.apollot.ru";
const servers: Server[] = [];
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

class BrowserJar {
  readonly values = new Map<string, string>();
  header() {
    return [...this.values].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  apply(response: Response) {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";", 1)[0]!;
      const i = pair.indexOf("=");
      const name = pair.slice(0, i),
        content = pair.slice(i + 1);
      if (!content || /Expires=Thu, 01 Jan 1970/i.test(value))
        this.values.delete(name);
      else this.values.set(name, content);
    }
  }
}
async function fixture(withLegacy = false) {
  const jar = new BrowserJar();
  jar.values.set(names.installation, randomUUID());
  const persistence = memoryFamilyPersistence(() => Date.now());
  const store = new TfFamilyStore(persistence, () => Date.now());
  const grants = new Map<string, RenewalResult>();
  const bindings = { A: testBinding(), B: testBinding() };
  const client = {
    enroll: vi.fn<TfRenewalClient["enroll"]>(async (input) => {
      const result = testRenewalResult(familyBinding(input), Date.now());
      grants.set(result.family_id, result);
      return result;
    }),
    renew: vi.fn<TfRenewalClient["renew"]>(async () => {
      throw new Error("unexpected renewal");
    }),
    check: vi.fn<TfRenewalClient["check"]>(async (input) => {
      const r = grants.get(input.family_id)!;
      return {
        active: true,
        accountId: r.account_id,
        sessionId: r.session_id,
        installationId: r.installation_id,
        accountStatus: "active",
        entitlements: ["tf.collections"],
        expiresAt: r.access_expires_at,
      };
    }),
    revoke: vi.fn<TfRenewalClient["revoke"]>(async () => {}),
  };
  const renewal = new TfRenewalConsumer({
    store,
    client,
    clientId: "apollo-tf-api",
    revocationKeys: {
      active: "test",
      keys: new Map([["test", randomBytes(32)]]),
    },
  });
  type Tx = Parameters<TfSessionStore["createTransaction"]>[0];
  const transactions = new Map<string, Tx>();
  const issued: { handle: string; tx: Tx }[] = [];
  const legacyHandle = testOpaque(),
    legacyCsrf = testOpaque();
  let legacyLive = withLegacy;
  const legacy = {
    id: randomUUID(),
    accountId: randomUUID(),
    installationId: randomUUID(),
    platformSessionId: randomUUID(),
    entitlements: ["tf.collections" as const],
    expiresAt: new Date(Date.now() + 240_000).toISOString(),
    assertionExpiresAt: new Date(Date.now() + 240_000).toISOString(),
  };
  if (withLegacy) {
    jar.values.set(names.session, legacyHandle);
    jar.values.set(names.csrf, legacyCsrf);
  }
  const sessionStore = {
    createTransaction: vi.fn(async (tx: Tx) => {
      const handle = testOpaque();
      transactions.set(handle, tx);
      issued.push({ handle, tx });
      return handle;
    }),
    consumeTransaction: vi.fn(async (handle: string) => {
      const tx = transactions.get(handle) ?? null;
      transactions.delete(handle);
      return tx
        ? {
            ...tx,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          }
        : null;
    }),
    createSession: vi.fn(),
    getSession: vi.fn(async (handle: string) =>
      legacyLive && handle === legacyHandle ? legacy : null,
    ),
    observeSession: vi.fn(async (handle: string) =>
      legacyLive && handle === legacyHandle
        ? { revision: legacyCsrf, session: legacy }
        : null,
    ),
    refreshSession: vi.fn(async () => legacy),
    revokeSession: vi.fn(async (handle: string) => {
      if (handle === legacyHandle) legacyLive = false;
      return true;
    }),
    issueProviderOAuthState: vi.fn(),
    consumeProviderOAuthState: vi.fn(),
    issueWebSocketTicket: vi.fn(),
  };
  const platform = {
    createAuthorizationUrl: vi.fn(
      () => "https://api.apollot.ru/v1/oauth/authorize",
    ),
    exchangeCode: vi.fn(
      async ({
        code,
        expectedNonce,
      }: {
        code: string;
        expectedNonce: string;
      }) => {
        const b = bindings[code.startsWith("B") ? "B" : "A"];
        const now = Math.floor(Date.now() / 1000);
        return {
          assertion: "initial.test.assertion",
          claims: {
            iss: "https://api.apollot.ru",
            aud: "apollo-tf" as const,
            sub: b.account_id,
            sid: b.session_id,
            installation_id: b.installation_id,
            nonce: expectedNonce,
            jti: randomUUID(),
            account_status: "active" as const,
            entitlements: ["tf.collections" as const],
            iat: now,
            nbf: now,
            exp: now + 300,
          },
        };
      },
    ),
    introspect: vi.fn(async () => ({
      active: true as const,
      accountId: legacy.accountId,
      sessionId: legacy.platformSessionId,
      installationId: legacy.installationId,
      accountStatus: "active" as const,
      entitlements: legacy.entitlements,
      expiresAt: legacy.expiresAt,
    })),
  };
  const list = vi.fn(async () => []);
  const app = createApiApp({
    nodeEnv: "test",
    auth: {
      platform,
      sessionStore,
      renewal,
      webOrigin: origin,
      secureCookies: true,
    },
    collections: { store: { list, save: vi.fn(), remove: vi.fn() } },
  });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  async function send(path: string, init: RequestInit = {}, browser = jar) {
    const response = await fetch(url + path, {
      ...init,
      redirect: "manual",
      headers: { Cookie: browser.header(), ...init.headers },
    });
    browser.apply(response);
    return response;
  }
  async function start(authorized = false) {
    const r = await send("/auth/start", {
      headers: authorized
        ? { Origin: origin, "X-CSRF-Token": jar.values.get(names.familyCsrf)! }
        : {},
    });
    expect(r.status).toBe(303);
    return issued.at(-1)!;
  }
  const callback = (tx: { tx: Tx }, account = "A") =>
    send(`/auth/callback?code=${account.repeat(32)}&state=${tx.tx.state}`);
  const logout = () =>
    send("/auth/logout", {
      method: "POST",
      body: "{}",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": jar.values.get(names.familyCsrf)!,
      },
    });
  return {
    jar,
    store,
    persistence,
    client,
    renewal,
    platform,
    sessionStore,
    legacyHandle,
    legacy,
    bindings,
    send,
    start,
    callback,
    logout,
    list,
  };
}

describe("D05 review F1-F3 browser lineage", () => {
  describe("round 3 published pending recovery", () => {
    it("immediate terminal callback preserves A only with its retained bound cookie pair, including logout custody", async () => {
      const f = await fixture();
      expect((await f.callback(await f.start())).status).toBe(303);
      const old = f.jar.values.get(names.family)!;
      const tx = await f.start(true);
      f.client.enroll.mockRejectedValueOnce(
        new TfRenewalError("INVALID_REFERENCE"),
      );
      expect((await f.callback(tx, "B")).status).toBe(503);
      expect(f.jar.values.get(names.family)).toBe(old);
      expect((await f.store.read(old))?.record.phase).toBe("ACTIVE");
      expect((await f.send("/auth/me")).status).toBe(200);
      expect(await f.store.pendingRevocations()).toHaveLength(0);
      expect((await f.logout()).status).toBe(204);
      expect((await f.store.read(old))?.record.phase).toBe("CLOSED");
    });
    it.each(["missing", "forged-csrf"])(
      "terminal callback without usable retained A custody (%s) retires A",
      async (custody) => {
        const f = await fixture();
        expect((await f.callback(await f.start())).status).toBe(303);
        const old = f.jar.values.get(names.family)!;
        const tx = await f.start(true);
        if (custody === "missing") {
          f.jar.values.delete(names.family);
          f.jar.values.delete(names.familyCsrf);
        } else f.jar.values.set(names.familyCsrf, testOpaque());
        f.client.enroll.mockRejectedValueOnce(
          new TfRenewalError("INVALID_REFERENCE"),
        );
        expect((await f.callback(tx, "B")).status).toBe(503);
        expect((await f.store.read(old))?.record.phase).toBe("CLOSED");
        expect(await f.store.pendingRevocations()).toHaveLength(1);
        expect((await f.callback(await f.start(), "B")).status).toBe(303);
      },
    );
    it.each(["csrf", "origin", "other-browser"])(
      "rejects %s pending mutation without retiring either context",
      async (kind) => {
        const f = await fixture();
        expect((await f.callback(await f.start())).status).toBe(303);
        const old = f.jar.values.get(names.family)!;
        const tx = await f.start(true);
        f.client.enroll.mockRejectedValueOnce(
          new TfRenewalError("OPERATION_UNCERTAIN"),
        );
        expect((await f.callback(tx, "B")).status).toBe(503);
        const pending = f.jar.values.get(names.family)!;
        const browser = kind === "other-browser" ? new BrowserJar() : f.jar;
        if (kind === "other-browser") {
          browser.values.set(names.browser, f.jar.values.get(names.browser)!);
          browser.values.set(
            names.installation,
            f.jar.values.get(names.installation)!,
          );
        }
        const response = await f.send(
          "/auth/renew",
          {
            method: "POST",
            body: "{}",
            headers: {
              Origin: kind === "origin" ? "https://foreign.invalid" : origin,
              "Content-Type": "application/json",
              "X-CSRF-Token":
                kind === "csrf"
                  ? testOpaque()
                  : f.jar.values.get(names.familyCsrf)!,
            },
          },
          browser,
        );
        expect(response.status).toBe(kind === "other-browser" ? 401 : 403);
        expect((await f.store.read(old))?.record.phase).toBe("ACTIVE");
        expect((await f.store.read(pending))?.record.phase).toBe("ENROLLING");
        expect(await f.store.pendingRevocations()).toHaveLength(0);
        expect(f.jar.values.get(names.family)).toBe(pending);
      },
    );
    it("terminal same-key retry after pending publication retires inaccessible A and permits fresh login/logout", async () => {
      const f = await fixture();
      expect((await f.callback(await f.start())).status).toBe(303);
      const old = f.jar.values.get(names.family)!;
      const tx = await f.start(true);
      f.client.enroll.mockRejectedValueOnce(
        new TfRenewalError("OPERATION_UNCERTAIN"),
      );
      expect((await f.callback(tx, "B")).status).toBe(503);
      const pending = f.jar.values.get(names.family)!;
      expect(pending).not.toBe(old);
      const first = f.client.enroll.mock.calls.at(-1)!;
      f.client.enroll.mockImplementationOnce(async (input, operation) => {
        expect(input).toEqual(first[0]);
        expect(operation.idempotencyKey).toBe(first[1].idempotencyKey);
        expect(operation.correlationId).toBe(first[1].correlationId);
        throw new TfRenewalError("INVALID_REFERENCE");
      });
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(Date.now() + 1100);
        const terminal = await f.send("/auth/renew", {
          method: "POST",
          body: "{}",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": f.jar.values.get(names.familyCsrf)!,
          },
        });
        expect(terminal.status).toBe(401);
        expect(f.jar.values.has(names.family)).toBe(false);
        expect((await f.store.read(pending))?.record.phase).toBe("CLOSED");
        const retired = await f.store.read(old);
        expect(retired?.record.phase).toBe("CLOSED");
        expect(retired?.raw).not.toContain("renewal_reference");
        expect(retired?.raw).not.toContain("access_token");
        expect(
          (await f.store.activeForBrowser(f.jar.values.get(names.browser)!))
            .active,
        ).toBeNull();
        expect(await f.store.pendingRevocations()).toHaveLength(1);
        expect((await f.callback(await f.start(), "B")).status).toBe(303);
        expect(await (await f.send("/auth/me")).json()).toMatchObject({
          accountId: f.bindings.B.account_id,
        });
        expect((await f.logout()).status).toBe(204);
        expect((await f.send("/auth/me")).status).toBe(401);
        expect(await f.store.pendingRevocations()).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
  describe("round 2 reservation and retirement", () => {
    it("permits fresh login after active expiry without treating its retained lineage locator as authority", async () => {
      const f = await fixture();
      expect((await f.callback(await f.start())).status).toBe(303);
      const old = f.jar.values.get(names.family)!;
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(Date.now() + 3600_001);
        f.jar.values.delete(names.family);
        f.jar.values.delete(names.familyCsrf);
        expect((await f.callback(await f.start(), "B")).status).toBe(303);
        expect(await f.store.read(old)).toBeNull();
        expect(await (await f.send("/auth/me")).json()).toMatchObject({
          accountId: f.bindings.B.account_id,
        });
      } finally {
        vi.useRealTimers();
      }
    });
    it("rejects navigation A when B completes between active lookup and reservation", async () => {
      const f = await fixture();
      const b = await f.start();
      const lookup = f.store.activeForBrowser.bind(f.store);
      let raced = false;
      vi.spyOn(f.store, "activeForBrowser").mockImplementation(
        async (binder) => {
          const observed = await lookup(binder);
          if (!raced) {
            raced = true;
            expect((await f.callback(b, "B")).status).toBe(303);
          }
          return observed;
        },
      );
      const response = await f.send("/auth/start");
      expect(response.status).not.toBe(303);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(await (await f.send("/auth/me")).json()).toMatchObject({
        accountId: f.bindings.B.account_id,
      });
    });
    it.each(["navigation", "binder-only"])(
      "rejects same-revision %s replacement without deliberate authority",
      async (mode) => {
        const f = await fixture();
        expect((await f.callback(await f.start())).status).toBe(303);
        const old = f.jar.values.get(names.family)!;
        if (mode === "binder-only") {
          f.jar.values.delete(names.family);
          f.jar.values.delete(names.familyCsrf);
        }
        expect((await f.callback(await f.start(), "B")).status).toBe(403);
        expect((await f.renewal.authorize(old)).accountId).toBe(
          f.bindings.A.account_id,
        );
      },
    );
    it("same-revision authorized promotion durably retires predecessor before returning", async () => {
      const f = await fixture();
      expect((await f.callback(await f.start())).status).toBe(303);
      const old = f.jar.values.get(names.family)!;
      expect((await f.callback(await f.start(true), "B")).status).toBe(303);
      expect((await f.store.read(old))?.record.phase).toBe("CLOSED");
      expect(await f.store.pendingRevocations()).toHaveLength(1);
      expect(await (await f.send("/auth/me")).json()).toMatchObject({
        accountId: f.bindings.B.account_id,
      });
    });
    it("promotion commit followed by process-loss error leaves encrypted predecessor retirement durable", async () => {
      const f = await fixture();
      expect((await f.callback(await f.start())).status).toBe(303);
      const old = f.jar.values.get(names.family)!;
      const tx = await f.start(true);
      const cas = f.persistence.cas;
      let crashed = false;
      f.persistence.cas = async (...args) => {
        const committed = await cas(...args);
        if (committed && !crashed && JSON.parse(args[2]).phase === "ACTIVE") {
          crashed = true;
          throw new Error(
            "controlled response loss immediately after promotion commit",
          );
        }
        return committed;
      };
      expect((await f.callback(tx, "B")).status).toBe(503);
      const retired = await f.store.read(old);
      expect(retired?.record.phase).toBe("CLOSED");
      expect(retired?.raw).not.toContain("renewal_reference");
      expect(retired?.raw).not.toContain("access_token");
      expect(await f.store.pendingRevocations()).toHaveLength(1);
      const restarted = new TfFamilyStore(f.persistence);
      expect(await restarted.pendingRevocations()).toHaveLength(1);
      await f.renewal.drainRevocations();
      expect(await restarted.pendingRevocations()).toHaveLength(0);
    });
    it("terminal pending replacement failure deliberately preserves predecessor authority", async () => {
      const f = await fixture();
      expect((await f.callback(await f.start())).status).toBe(303);
      const old = f.jar.values.get(names.family)!;
      const tx = await f.start(true);
      f.client.enroll.mockRejectedValueOnce(
        new TfRenewalError("INVALID_REFERENCE"),
      );
      expect((await f.callback(tx, "B")).status).toBe(503);
      expect((await f.renewal.authorize(old)).accountId).toBe(
        f.bindings.A.account_id,
      );
      expect(await f.store.pendingRevocations()).toHaveLength(0);
    });
    it("explicit pending-context logout terminalizes predecessor with durable revoke despite upstream outage", async () => {
      const f = await fixture();
      expect((await f.callback(await f.start())).status).toBe(303);
      const old = f.jar.values.get(names.family)!;
      const tx = await f.start(true);
      f.client.enroll.mockRejectedValueOnce(
        new TfRenewalError("OPERATION_UNCERTAIN"),
      );
      expect((await f.callback(tx, "B")).status).toBe(503);
      f.client.revoke.mockRejectedValue(
        new TfRenewalError("OPERATION_UNCERTAIN"),
      );
      expect((await f.logout()).status).toBe(503);
      expect((await f.store.read(old))?.record.phase).toBe("CLOSED");
      expect(await f.store.pendingRevocations()).toHaveLength(1);
      await expect(f.renewal.authorize(old)).rejects.toMatchObject({
        status: 401,
      });
    });
    it("predecessor CAS conflict prevents promotion instead of orphaning either context", async () => {
      const f = await fixture();
      expect((await f.callback(await f.start())).status).toBe(303);
      const old = f.jar.values.get(names.family)!;
      const tx = await f.start(true);
      const cas = f.persistence.cas;
      let raced = false;
      f.persistence.cas = async (...args) => {
        if (!raced && JSON.parse(args[2]).phase === "ACTIVE") {
          raced = true;
          const k = `tf-auth:{families}:${createHash("sha256").update(old).digest("hex")}`;
          const raw = (await f.persistence.read(k))!;
          const record = JSON.parse(raw);
          await cas(
            k,
            raw,
            JSON.stringify({ ...record, csrf: testOpaque() }),
            record.expiresAt,
          );
        }
        return cas(...args);
      };
      expect((await f.callback(tx, "B")).status).toBe(503);
      expect((await f.store.read(old))?.record.phase).toBe("ACTIVE");
      expect((await f.store.read(tx.tx.familyHandle!))?.record.phase).toBe(
        "ENROLLING",
      );
      expect(await f.store.pendingRevocations()).toHaveLength(0);
    });
  });
  it("rejects a forged CSRF cookie on deliberate replacement without changing the active family", async () => {
    const f = await fixture();
    expect((await f.callback(await f.start())).status).toBe(303);
    const handle = f.jar.values.get(names.family)!;
    f.jar.values.set(names.familyCsrf, testOpaque());
    const r = await f.send("/auth/start", {
      headers: {
        Origin: origin,
        "X-CSRF-Token": f.jar.values.get(names.familyCsrf)!,
      },
    });
    expect(r.status).toBe(403);
    expect(r.headers.has("set-cookie")).toBe(false);
    expect((await f.store.read(handle))?.record.phase).toBe("ACTIVE");
  });
  it("cross-site POST without Lax cookies cannot clear the browser's existing authentication cookies", async () => {
    const f = await fixture();
    expect((await f.callback(await f.start())).status).toBe(303);
    const before = f.jar.header();
    const r = await f.send("/auth/renew-context", {
      method: "POST",
      body: "{}",
      headers: {
        Cookie: "",
        Origin: "https://foreign.invalid",
        "Content-Type": "application/json",
      },
    });
    expect(r.status).toBe(403);
    expect(r.headers.has("set-cookie")).toBe(false);
    expect(f.jar.header()).toBe(before);
  });
  it("a matching public installation hint in another browser cannot move the pending revision", async () => {
    const f = await fixture();
    const a = await f.start();
    const originalCookies = new Map(f.jar.values);
    f.jar.values.clear();
    f.jar.values.set(
      names.installation,
      originalCookies.get(names.installation)!,
    );
    await f.start();
    const otherBinder = f.jar.values.get(names.browser);
    f.jar.values.clear();
    for (const pair of originalCookies) f.jar.values.set(...pair);
    expect(otherBinder).not.toBe(f.jar.values.get(names.browser));
    expect((await f.callback(a)).status).toBe(303);
  });
  it("browser binder alone cannot replace an active family without family CSRF custody", async () => {
    const f = await fixture();
    expect((await f.callback(await f.start())).status).toBe(303);
    const handle = f.jar.values.get(names.family)!;
    f.jar.values.delete(names.family);
    f.jar.values.delete(names.familyCsrf);
    expect((await f.callback(await f.start(), "B")).status).toBe(403);
    expect((await f.renewal.authorize(handle)).accountId).toBe(
      f.bindings.A.account_id,
    );
  });
  it.each([false, true])(
    "fences callback A after B completes (B logout=%s), without late cookie writes",
    async (logoutB) => {
      const f = await fixture();
      const a = await f.start();
      const exchange = f.platform.exchangeCode.getMockImplementation()!;
      let release!: () => void, entered!: () => void;
      const enteredPromise = new Promise<void>((r) => {
        entered = r;
      });
      const wait = new Promise<void>((r) => {
        release = r;
      });
      f.platform.exchangeCode.mockImplementationOnce(async (input) => {
        entered();
        await wait;
        return exchange(input);
      });
      const late = f.callback(a);
      await enteredPromise;
      const b = await f.start();
      expect((await f.callback(b, "B")).status).toBe(303);
      if (logoutB) expect((await f.logout()).status).toBe(204);
      const cookieBefore = f.jar.header();
      release();
      const stale = await late;
      expect(stale.status).not.toBe(303);
      expect(stale.headers.has("set-cookie")).toBe(false);
      expect(f.jar.header()).toBe(cookieBefore);
      const me = await f.send("/auth/me");
      expect(me.status).toBe(logoutB ? 401 : 200);
      if (!logoutB)
        expect(await me.json()).toMatchObject({
          accountId: f.bindings.B.account_id,
        });
    },
  );
  it.each([false, true])(
    "fences an enrollment result already in flight after B wins (logout=%s)",
    async (logoutB) => {
      const f = await fixture();
      const a = await f.start();
      const enroll = f.client.enroll.getMockImplementation()!;
      let release!: () => void, entered!: () => void;
      const enteredPromise = new Promise<void>((r) => {
        entered = r;
      });
      const wait = new Promise<void>((r) => {
        release = r;
      });
      f.client.enroll.mockImplementationOnce(async (input, operation) => {
        entered();
        await wait;
        return enroll(input, operation);
      });
      const late = f.callback(a);
      await enteredPromise;
      expect((await f.callback(await f.start(), "B")).status).toBe(303);
      if (logoutB) expect((await f.logout()).status).toBe(204);
      const before = f.jar.header();
      release();
      const old = await late;
      expect(old.status).not.toBe(303);
      expect(old.headers.has("set-cookie")).toBe(false);
      expect(f.jar.header()).toBe(before);
      expect((await f.send("/auth/me")).status).toBe(logoutB ? 401 : 200);
    },
  );
  it.each(["logout", "terminal"])(
    "pending enroll failure followed by %s never reveals a prior legacy session",
    async (end) => {
      const f = await fixture(true);
      expect((await f.send("/auth/me")).status).toBe(200);
      const tx = await f.start();
      f.client.enroll.mockRejectedValueOnce(
        new TfRenewalError("OPERATION_UNCERTAIN"),
      );
      expect((await f.callback(tx)).status).toBe(503);
      expect(f.jar.values.has(names.family)).toBe(true);
      expect(f.jar.values.has(names.session)).toBe(false);
      if (end === "logout") expect((await f.logout()).status).toBe(204);
      else {
        await f.renewal.logout(f.jar.values.get(names.family)!);
        expect((await f.send("/auth/me")).status).toBe(401);
      }
      expect((await f.send("/auth/me")).status).toBe(401);
      expect((await f.send("/collections/liked")).status).toBe(401);
      expect(f.list).not.toHaveBeenCalled();
      expect(await f.sessionStore.getSession(f.legacyHandle)).toBeNull();
    },
  );
  it("navigation-style GET start cannot close/revoke or replace an active family", async () => {
    const f = await fixture();
    expect((await f.callback(await f.start())).status).toBe(303);
    const handle = f.jar.values.get(names.family)!;
    const pending = await f.start();
    expect((await f.store.read(handle))?.record.phase).toBe("ACTIVE");
    expect(f.client.revoke).not.toHaveBeenCalled();
    expect((await f.send("/auth/me")).status).toBe(200);
    const denied = await f.callback(pending, "B");
    expect(denied.status).toBe(403);
    expect(f.jar.values.get(names.family)).toBe(handle);
  });
  it("deliberate Origin and bound-CSRF replacement publishes B and retires A only on callback", async () => {
    const f = await fixture();
    expect((await f.callback(await f.start())).status).toBe(303);
    const old = f.jar.values.get(names.family)!;
    const b = await f.start(true);
    expect((await f.store.read(old))?.record.phase).toBe("ACTIVE");
    expect((await f.callback(b, "B")).status).toBe(303);
    await expect(f.renewal.authorize(old)).rejects.toMatchObject({
      status: 401,
    });
    const me = await f.send("/auth/me");
    expect(await me.json()).toMatchObject({
      accountId: f.bindings.B.account_id,
    });
  });
  it("keeps genuinely legacy-only me and logout behavior", async () => {
    const f = await fixture(true);
    expect((await f.send("/auth/me")).status).toBe(200);
    const r = await f.send("/auth/logout", {
      method: "POST",
      headers: {
        Origin: origin,
        "X-CSRF-Token": f.jar.values.get(names.csrf)!,
      },
    });
    expect(r.status).toBe(204);
    expect((await f.send("/auth/me")).status).toBe(401);
  });
  it("fences the family on logout even when legacy retirement reports an outage", async () => {
    const f = await fixture();
    expect((await f.callback(await f.start())).status).toBe(303);
    const handle = f.jar.values.get(names.family)!;
    f.jar.values.set(names.session, f.legacyHandle);
    f.sessionStore.revokeSession.mockRejectedValueOnce(
      new Error("controlled legacy Redis failure"),
    );
    expect((await f.logout()).status).toBe(503);
    expect((await f.store.read(handle))?.record.phase).toBe("CLOSED");
    expect(f.jar.values.has(names.session)).toBe(false);
    expect(f.jar.values.has(names.family)).toBe(false);
  });
});
