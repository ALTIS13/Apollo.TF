import { beforeEach, expect, it, vi } from "vitest";

const redisFactory = vi.hoisted(() => vi.fn());
const logInfo = vi.hoisted(() => vi.fn());
const logWarn = vi.hoisted(() => vi.fn());

vi.mock("ioredis", () => ({
  default: class RedisTestDouble {
    constructor(...arguments_: unknown[]) {
      return redisFactory(...arguments_);
    }
  },
}));
vi.mock("./logger.js", () => ({
  logger: { info: logInfo, warn: logWarn },
}));

beforeEach(() => {
  vi.resetModules();
  redisFactory.mockReset();
  logInfo.mockReset();
  logWarn.mockReset();
});

it("constructs the shared cache client from the already resolved mounted URL", async () => {
  const client = {
    connect: vi.fn(async () => {}),
    on: vi.fn(),
  };
  redisFactory.mockReturnValue(client);
  const { getRedis } = await import("./redis.js");
  const url = "redis://tf-cache:mounted-password@tf-redis:6379/0";

  expect(getRedis(url)).toBe(client);
  expect(redisFactory).toHaveBeenCalledWith(
    url,
    expect.objectContaining({ enableOfflineQueue: false, lazyConnect: true }),
  );
  expect(client.connect).toHaveBeenCalledOnce();
});

it.each(["connect", "ping"] as const)(
  "fails closed with value-free diagnostics when file-selected cache Redis %s fails",
  async (failureStage) => {
    const secret = "cache-password-never-observable";
    const url = `redis://tf-cache:${secret}@tf-redis:6379/0`;
    const connect = vi.fn(async () => {
      if (failureStage === "connect") throw new Error(`private ${url}`);
    });
    const ping = vi.fn(async () => {
      if (failureStage === "ping") throw new Error(`WRONGPASS ${secret}`);
      return "PONG";
    });
    const disconnect = vi.fn(() => {
      throw new Error(`disconnect ${secret}`);
    });
    redisFactory.mockReturnValue({ connect, disconnect, on: vi.fn(), ping });
    const redisModule = await import("./redis.js");
    const getRedisForStartup = Reflect.get(
      redisModule,
      "getRedisForStartup",
    ) as unknown;

    expect(getRedisForStartup).toBeTypeOf("function");
    let failure: unknown;
    try {
      await (
        getRedisForStartup as (
          resolvedUrl: string,
          requireReady: boolean,
        ) => Promise<unknown>
      )(url, true);
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(new Error("TF cache Redis is unavailable"));
    expect(connect).toHaveBeenCalledOnce();
    expect(ping).toHaveBeenCalledTimes(failureStage === "ping" ? 1 : 0);
    expect(disconnect).toHaveBeenCalledWith(false);
    expect(redisFactory).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        commandTimeout: 1_000,
        connectTimeout: 3_000,
        enableOfflineQueue: false,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: expect.any(Function),
      }),
    );
    const strictOptions = redisFactory.mock.calls[0]![1] as {
      retryStrategy: () => unknown;
    };
    expect(strictOptions.retryStrategy()).toBeNull();
    const observables = [
      String(failure),
      JSON.stringify(failure),
      JSON.stringify(logInfo.mock.calls),
      JSON.stringify(logWarn.mock.calls),
    ].join("\n");
    expect(observables).not.toContain(secret);
    expect(observables).not.toContain(url);
  },
);

it("publishes a file-selected cache client only after connect and PING succeed", async () => {
  const client = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    on: vi.fn(),
    ping: vi.fn(async () => "PONG"),
  };
  redisFactory.mockReturnValue(client);
  const { getRedisForStartup, isRedisAvailable } = await import("./redis.js");

  await expect(
    getRedisForStartup(
      "redis://tf-cache:mounted-password@tf-redis:6379/0",
      true,
    ),
  ).resolves.toBe(client);
  expect(client.connect).toHaveBeenCalledOnce();
  expect(client.ping).toHaveBeenCalledOnce();
  expect(client.connect.mock.invocationCallOrder[0]).toBeLessThan(
    client.ping.mock.invocationCallOrder[0]!,
  );
  expect(client.disconnect).not.toHaveBeenCalled();
  expect(isRedisAvailable()).toBe(true);
});

it("preserves absent and inline cache Redis as legacy best effort", async () => {
  const connectFailure = new Error("legacy cache unavailable");
  const inlineClient = {
    connect: vi.fn(async () => {
      throw connectFailure;
    }),
    on: vi.fn(),
    ping: vi.fn(),
  };
  redisFactory.mockReturnValue(inlineClient);
  const redisModule = await import("./redis.js");
  const getRedisForStartup = Reflect.get(
    redisModule,
    "getRedisForStartup",
  ) as unknown;

  expect(getRedisForStartup).toBeTypeOf("function");
  await expect(
    (
      getRedisForStartup as (
        resolvedUrl: string | undefined,
        requireReady: boolean,
      ) => Promise<unknown>
    )(undefined, false),
  ).resolves.toBeNull();
  await expect(
    (
      getRedisForStartup as (
        resolvedUrl: string | undefined,
        requireReady: boolean,
      ) => Promise<unknown>
    )("legacy-cache-value", false),
  ).resolves.toBe(inlineClient);
  expect(inlineClient.connect).toHaveBeenCalledOnce();
  expect(inlineClient.ping).not.toHaveBeenCalled();
});
