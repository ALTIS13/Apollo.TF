import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse, type Server } from "node:http";
import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { TfRenewalConsumer } from "./tf-renewal-consumer.js";
import {
  mountedKeyring,
  runtimeAuthConfig,
} from "./tf-renewal-runtime-test-support.js";
import { testBinding, testOpaque } from "./tf-renewal-test-support.js";
import type { StrictRedisClient } from "./tf-session-store.js";
import { startApiListener } from "./server-startup.js";
let createTfApiRuntime: (typeof import("./tf-api-runtime.js"))["createTfApiRuntime"];
let createTfRuntimeResourceCloser: (typeof import("./tf-api-runtime.js"))["createTfRuntimeResourceCloser"];
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
  ({ createTfApiRuntime, createTfRuntimeResourceCloser } =
    await import("./tf-api-runtime.js"));
}, 30_000);
afterEach(() => vi.useRealTimers());
const env = {
  APOLLO_TF_RENEWAL_ENABLED: "true",
  APOLLO_TF_REVOKE_KEYRING_FILE: "/run/secrets/tf_revoke_keyring",
};
function redisFixture() {
  const records = new Map<string, string>();
  const pending = new Set<string>();
  const redis: StrictRedisClient = {
    get: vi.fn(async (key) => records.get(key) ?? null),
    set: vi.fn(async () => {
      throw new Error("unexpected write");
    }),
    eval: vi.fn(async (_script, count, ...args) => {
      if (count === 1) return [...pending].slice(0, 10);
      if (count !== 4) throw new Error("unexpected script");
      const [key, , , , expected, raw, , , outbox] = args.map(String);
      if ((records.get(key!) ?? "") !== expected) return 0;
      records.set(key!, raw!);
      if (outbox === "1") pending.add(key!);
      else pending.delete(key!);
      return 1;
    }),
  };
  return { redis, records, pending };
}
// Native in-memory request/response objects: no listening socket, DNS or HTTP service.
async function request(
  app: Express,
  path: string,
  headers: Record<string, string> = {},
) {
  const req = new IncomingMessage(new Socket());
  req.method = "GET";
  req.url = path;
  req.headers = headers;
  const res = new ServerResponse(req);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    res.end = function (chunk?: unknown) {
      resolve({ status: res.statusCode, body: chunk?.toString() ?? "" });
      return res;
    } as typeof res.end;
    app(req, res);
    req.push(null);
    req.on("error", reject);
  });
}
function seedRevoke(
  f: ReturnType<typeof redisFixture>,
  key: Buffer,
  keyId: string,
) {
  const id = randomUUID(),
    expiresAt = Date.now() + 300_000;
  const packet = {
    request: {
      ...testBinding(),
      family_id: randomUUID(),
      generation: 0,
      renewal_reference: testOpaque(),
      reason: "USER_LOGOUT",
    },
    operation: { idempotencyKey: randomUUID(), correlationId: randomUUID() },
  };
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`tf-d05-revoke:v1:${id}:${expiresAt}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(packet)),
    cipher.final(),
  ]);
  const raw = JSON.stringify({
    version: 1,
    id,
    lineageId: testOpaque(),
    createdAt: Date.now(),
    expiresAt,
    phase: "CLOSED",
    revocation: JSON.stringify({
      keyId,
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    }),
  });
  const recordKey = `tf-auth:{families}:${"a".repeat(64)}`;
  f.records.set(recordKey, raw);
  f.pending.add(recordKey);
  return { recordKey, packet, raw };
}
describe("real TF runtime factory composition", () => {
  it("startup failure and repeated shutdown settle the owned aborted drain before disconnecting storage", async () => {
    const f = redisFixture(),
      key = randomBytes(32);
    const seeded = seedRevoke(f, key, "current");
    const events: string[] = [];
    let entered!: () => void;
    const inTransport = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => {
              events.push("transport-aborted");
              reject(new Error("private failure"));
            },
            { once: true },
          );
          entered();
        }),
    );
    const keyring = JSON.stringify({
      version: 1,
      purpose: "apollo-tf-revoke-only",
      active: "current",
      keys: [{ id: "current", key: key.toString("base64url") }],
    });
    const runtime = await createTfApiRuntime(
      { environment: env, authConfig: runtimeAuthConfig(), redis: f.redis },
      { ...mountedKeyring(keyring).dependencies, fetch },
    );
    const closeStorage = createTfRuntimeResourceCloser(
      () => runtime,
      () => {
        events.push("storage-disconnected");
      },
    );
    const server = Object.assign(new EventEmitter(), {
      listening: true,
      closeAllConnections() {},
      close(callback: () => void) {
        this.listening = false;
        callback();
      },
    });
    await expect(
      startApiListener({
        listen: () => {
          queueMicrotask(() => server.emit("listening"));
          return server as unknown as Server;
        },
        initialize: async () => {
          runtime.start();
          await inTransport;
          throw new Error("startup failure");
        },
        closeQueues: async () => {},
        closeRedis: closeStorage,
      }),
    ).rejects.toThrow("TF API startup failed");
    await closeStorage();
    expect(events).toEqual(["transport-aborted", "storage-disconnected"]);
    expect(server.listening).toBe(false);
    expect(f.records.get(seeded.recordKey)).toBe(seeded.raw);
  });
  it("local readiness does not turn remote revoke outage into denial, while local store failure is unavailable", async () => {
    let localReady = true;
    const f = redisFixture();
    const runtime = await createTfApiRuntime(
      {
        environment: env,
        authConfig: runtimeAuthConfig(),
        redis: f.redis,
        appOptions: { readiness: async () => localReady },
      },
      {
        ...mountedKeyring().dependencies,
        fetch: async () => {
          throw new Error("remote outage");
        },
      },
    );
    expect((await request(runtime.app, "/api/readyz")).status).toBe(200);
    localReady = false;
    expect((await request(runtime.app, "/api/readyz")).status).toBe(503);
    await runtime.stop();
  });
  it.each([false, true])(
    "injects the actual accepted consumer into the real app only when enabled=%s",
    async (enabled) => {
      const f = redisFixture();
      const files = mountedKeyring();
      const fetch = vi.fn<typeof globalThis.fetch>();
      const runtime = await createTfApiRuntime(
        {
          environment: enabled ? env : {},
          authConfig: runtimeAuthConfig(),
          redis: f.redis,
        },
        { ...files.dependencies, fetch },
      );
      if (enabled) {
        expect(runtime.auth.renewal).toBeInstanceOf(TfRenewalConsumer);
        expect(runtime.auth.renewal!.store).toBe(
          runtime.auth.sessionStore.families,
        );
      } else expect(runtime.auth.renewal).toBeUndefined();
      const result = await request(runtime.app, "/api/auth/me", {
        cookie: `__Host-apollo_tf_family=${testOpaque()}; __Host-apollo_tf_family_csrf=${testOpaque()}`,
      });
      expect(result.status).toBe(enabled ? 401 : 503);
      expect(fetch).not.toHaveBeenCalled();
      await runtime.stop();
    },
  );
  it("invalid enabled composition fails generically before any app worker or transport I/O", async () => {
    const f = redisFixture(),
      fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      createTfApiRuntime(
        {
          environment: env,
          authConfig: {
            ...runtimeAuthConfig(),
            allowPrivateHttpTransport: true,
          },
          redis: f.redis,
        },
        { ...mountedKeyring().dependencies, fetch },
      ),
    ).rejects.toThrow("TF renewal configuration is invalid");
    expect(f.redis.eval).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("restart drain decrypts a retained old key, keeps outage work durable, and never calls renew/enroll", async () => {
    vi.useFakeTimers();
    const f = redisFixture(),
      oldKey = randomBytes(32),
      currentKey = randomBytes(32);
    const seeded = seedRevoke(f, oldKey, "old");
    const keyring = JSON.stringify({
      version: 1,
      purpose: "apollo-tf-revoke-only",
      active: "current",
      keys: [
        { id: "current", key: currentKey.toString("base64url") },
        { id: "old", key: oldKey.toString("base64url") },
      ],
    });
    let available = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      expect(String(url)).toBe(
        "https://api.apollot.ru/v1/tf/session-renewals/revoke",
      );
      expect(JSON.parse(init!.body as string)).toEqual(seeded.packet.request);
      if (!available) throw new Error("private transport secret");
      const headers = new Headers(init!.headers);
      return new Response(
        JSON.stringify({
          schema_version: 1,
          contract_id: "apollo.tf.session-renewal.v1",
          family_id: seeded.packet.request.family_id,
          state: "REVOKED",
          revoked_at: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            Pragma: "no-cache",
            "Referrer-Policy": "no-referrer",
            "X-Request-ID": headers.get("X-Request-ID")!,
            "X-Audit-Correlation-ID": headers.get("X-Audit-Correlation-ID")!,
          },
        },
      );
    });
    const reports: string[] = [];
    const runtime = await createTfApiRuntime(
      { environment: env, authConfig: runtimeAuthConfig(), redis: f.redis },
      {
        ...mountedKeyring(keyring).dependencies,
        fetch,
        report: (status) => reports.push(status),
      },
    );
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.records.get(seeded.recordKey)).toBe(seeded.raw);
    expect(reports).toEqual(["pending"]);
    await runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
    available = true;
    const restarted = await createTfApiRuntime(
      { environment: env, authConfig: runtimeAuthConfig(), redis: f.redis },
      { ...mountedKeyring(keyring).dependencies, fetch },
    );
    restarted.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.pending.size).toBe(0);
    expect(JSON.parse(f.records.get(seeded.recordKey)!).revocation).toBeNull();
    await restarted.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
