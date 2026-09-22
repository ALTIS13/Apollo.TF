import { beforeAll, expect, it, vi } from "vitest";
import {
  mountedKeyring,
  runtimeAuthConfig,
} from "./tf-renewal-runtime-test-support.js";
let createTfApiRuntime: (typeof import("./tf-api-runtime.js"))["createTfApiRuntime"];
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
  ({ createTfApiRuntime } = await import("./tf-api-runtime.js"));
});
it("real factory wires the same accepted consumer only on explicit successor WS opt-in", async () => {
  for (const enabled of [false, true]) {
    const mounted = mountedKeyring(),
      fetch = vi.fn(async () => {
        throw new Error("no network");
      });
    const redis = { get: vi.fn(async () => null), set: vi.fn(), eval: vi.fn() };
    const runtime = await createTfApiRuntime(
      {
        authConfig: runtimeAuthConfig(),
        redis,
        environment: {
          APOLLO_TF_RENEWAL_ENABLED: "true",
          APOLLO_TF_REVOKE_KEYRING_FILE: "/run/secrets/tf-revoke-test",
          ...(enabled ? { APOLLO_TF_SUCCESSOR_WS_ENABLED: "true" } : {}),
        },
      },
      { ...mounted.dependencies, fetch },
    );
    if (enabled)
      expect(runtime.familyWebSocket?.consumer).toBe(runtime.auth.renewal);
    else expect(runtime.familyWebSocket).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    await runtime.stop();
  }
});
it("real factory fails explicit WS enable without renewal before any HTTP or Redis operation", async () => {
  const redis = { get: vi.fn(async () => null), set: vi.fn(), eval: vi.fn() },
    fetch = vi.fn();
  await expect(
    createTfApiRuntime(
      {
        authConfig: runtimeAuthConfig(),
        redis,
        environment: { APOLLO_TF_SUCCESSOR_WS_ENABLED: "true" },
      },
      { fetch },
    ),
  ).rejects.toThrow("TF successor WebSocket configuration is invalid");
  expect(fetch).not.toHaveBeenCalled();
  expect(redis.eval).not.toHaveBeenCalled();
});
