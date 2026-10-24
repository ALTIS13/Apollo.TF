import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appListen: vi.fn(() => ({ close: vi.fn() })),
  authDisconnect: vi.fn(),
  authRedisConnect: vi.fn(async () => {}),
  authRedisPing: vi.fn(async () => "PONG"),
  closeRedis: vi.fn(async () => {}),
  getRedis: vi.fn(() => ({ disconnect: vi.fn() })),
  getRedisForStartup: vi.fn(async () => {
    throw new Error(
      "redis://tf-cache:cache-password-never-observable@tf-redis:6379/0",
    );
  }),
  startApiListener: vi.fn(
    async (options: {
      beforeListen?: () => Promise<void>;
      listen: () => unknown;
    }) => {
      await options.beforeListen?.();
      return options.listen();
    },
  ),
}));

vi.mock("ioredis", () => ({
  default: class AuthRedisTestDouble {
    connect = state.authRedisConnect;
    disconnect = state.authDisconnect;
    on = vi.fn();
    ping = state.authRedisPing;
  },
}));
vi.mock("@workspace/db", () => ({ pool: {} }));
vi.mock("@workspace/db/migrations", () => ({
  createTfMigrationReadinessProbe: () => vi.fn(async () => true),
}));
vi.mock("./lib/tf-api-runtime.js", () => ({
  createTfApiRuntime: vi.fn(async () => ({
    app: { listen: state.appListen },
    auth: { platform: {}, sessionStore: {} },
    familyWebSocket: {},
    start: vi.fn(),
    stop: vi.fn(async () => {}),
  })),
  createTfRuntimeResourceCloser: () => state.closeRedis,
}));
vi.mock("./lib/background-queue.js", () => ({
  initBackgroundQueues: vi.fn(async () => {}),
  shutdownBackgroundQueues: vi.fn(async () => {}),
}));
vi.mock("./lib/logger.js", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));
vi.mock("./lib/module-heartbeat.js", () => ({
  assertRequiredModuleHeartbeatKeys: vi.fn(),
  parseModuleHeartbeatKeys: vi.fn(() => ({})),
}));
vi.mock("./lib/platform-auth-client.js", () => ({
  parseTfAuthRuntimeConfig: vi.fn(async () => ({
    authRedisUrl: "redis://tf-auth:private@tf-redis:6379/1",
  })),
}));
vi.mock("./lib/redis.js", () => ({
  getRedis: state.getRedis,
  getRedisForStartup: state.getRedisForStartup,
}));
vi.mock("./lib/redis-readiness.js", () => ({
  probeRedisHealth: vi.fn(async () => true),
}));
vi.mock("./lib/redis-url-config.js", () => ({
  resolveCacheRedisUrl: vi.fn(
    async () =>
      "redis://tf-cache:cache-password-never-observable@tf-redis:6379/0",
  ),
}));
vi.mock("./lib/tf-session-store.js", () => ({
  createStrictRedisClient: vi.fn(() => ({})),
}));
vi.mock("./lib/api-gateway-runtime.js", () => ({
  createApiGatewayRuntime: vi.fn(async () => ({})),
}));
vi.mock("./lib/server-startup.js", () => ({
  initializeApiRuntime: vi.fn(),
  startApiListener: state.startApiListener,
}));
vi.mock("./ws.js", () => ({ attachWebSocketServer: vi.fn() }));

const originalEnvironment = { ...process.env };
const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(state)) mock.mockClear();
  process.env = {
    ...originalEnvironment,
    PORT: "8080",
    REDIS_URL_FILE: "/run/secrets/tf_cache_redis_url",
  };
  process.exitCode = undefined;
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

it("rejects file-selected cache Redis before invoking the API listener without exposing the URL", async () => {
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);

  await import("./index.js");
  await vi.waitFor(() => expect(process.exitCode).toBe(1));

  expect(state.getRedisForStartup).toHaveBeenCalledWith(
    "redis://tf-cache:cache-password-never-observable@tf-redis:6379/0",
    true,
  );
  expect(state.getRedis).not.toHaveBeenCalled();
  expect(state.appListen).not.toHaveBeenCalled();
  expect(stderr).toHaveBeenCalledWith("TF API startup failed\n");
  expect(JSON.stringify(stderr.mock.calls)).not.toContain(
    "cache-password-never-observable",
  );
});
