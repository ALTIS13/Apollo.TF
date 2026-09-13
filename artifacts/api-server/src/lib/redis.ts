import Redis from "ioredis";
import { logger } from "./logger.js";

let _redis: Redis | null = null;
let _available = false;

function createRedisClient(url: string, requireReady: boolean): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true,
    enableOfflineQueue: false,
    ...(requireReady
      ? {
          commandTimeout: 1_000,
          retryStrategy: () => null,
        }
      : {}),
  });

  redis.on("connect", () => {
    _available = true;
    logger.info("Redis connected");
  });

  redis.on("error", (err) => {
    if (_available) {
      if (requireReady) {
        logger.warn("Redis error — falling back to PostgreSQL cache");
      } else {
        logger.warn(
          { err: (err as Error).message },
          "Redis error — falling back to PostgreSQL cache",
        );
      }
    }
    _available = false;
  });

  redis.on("close", () => {
    _available = false;
  });

  _redis = redis;
  return redis;
}

export function getRedis(resolvedUrl?: string): Redis | null {
  if (_redis) return _redis;

  const url = resolvedUrl ?? process.env["REDIS_URL"];
  if (!url) return null;

  try {
    const redis = createRedisClient(url, false);
    redis.connect().catch(() => {});
    return redis;
  } catch {
    logger.warn(
      "Failed to initialize Redis client — using PostgreSQL cache only",
    );
    return null;
  }
}

export async function getRedisForStartup(
  resolvedUrl: string | undefined,
  requireReady: boolean,
): Promise<Redis | null> {
  if (!requireReady) return getRedis(resolvedUrl);
  if (!resolvedUrl) throw new Error("TF cache Redis is unavailable");

  let redis: Redis | undefined;
  try {
    redis = createRedisClient(resolvedUrl, true);
    await redis.connect();
    await redis.ping();
    _available = true;
    return redis;
  } catch {
    _available = false;
    try {
      redis?.disconnect(false);
    } catch {}
    if (_redis === redis) _redis = null;
    throw new Error("TF cache Redis is unavailable");
  }
}

export function isRedisAvailable(): boolean {
  return _available;
}

export async function redisGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (!r || !_available) return null;
  try {
    return await r.get(key);
  } catch {
    return null;
  }
}

export async function redisSet(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  const r = getRedis();
  if (!r || !_available) return;
  try {
    await r.set(key, value, "EX", ttlSeconds);
  } catch {}
}

export async function redisDel(key: string): Promise<void> {
  const r = getRedis();
  if (!r || !_available) return;
  try {
    await r.del(key);
  } catch {}
}
