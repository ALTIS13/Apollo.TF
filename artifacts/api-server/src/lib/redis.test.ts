import { beforeEach, expect, it, vi } from "vitest";

const redisFactory = vi.hoisted(() => vi.fn());

vi.mock("ioredis", () => ({
  default: class RedisTestDouble {
    constructor(...arguments_: unknown[]) {
      return redisFactory(...arguments_);
    }
  },
}));
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

beforeEach(() => {
  vi.resetModules();
  redisFactory.mockReset();
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
