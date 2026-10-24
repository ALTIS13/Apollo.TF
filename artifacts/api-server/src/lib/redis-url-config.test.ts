import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveAuthRedisUrl,
  resolveCacheRedisUrl,
} from "./redis-url-config.js";

const temporaryDirectories: string[] = [];

async function mountedUrl(name: string, value: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "apollo-tf-redis-url-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, value, "utf8");
  return path;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

function expectValueFreeFailure(
  operation: Promise<unknown>,
  environment: NodeJS.ProcessEnv,
  ...canaries: string[]
): Promise<void> {
  const before = { ...environment };
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  return operation.then(
    () => {
      throw new Error("expected Redis configuration failure");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "TF Redis configuration is invalid",
      );
      const observable = `${String(error)}\n${JSON.stringify(error)}\n${stdout.mock.calls.join("\n")}\n${stderr.mock.calls.join("\n")}`;
      for (const canary of canaries.filter((value) => value.length > 0)) {
        expect(observable).not.toContain(canary);
      }
      expect(environment).toEqual(before);
    },
  );
}

describe("TF Redis URL inputs", () => {
  it("preserves explicit inline development URLs and optional cache absence", async () => {
    await expect(
      resolveAuthRedisUrl({
        NODE_ENV: "development",
        APOLLO_TF_AUTH_REDIS_URL: "redis://127.0.0.1:16379/7?legacy=true",
      }),
    ).resolves.toBe("redis://127.0.0.1:16379/7?legacy=true");
    await expect(
      resolveCacheRedisUrl({ NODE_ENV: "development" }),
    ).resolves.toBeUndefined();
  });

  it("preserves the distinct legacy inline auth and cache behavior", async () => {
    const legacyCache = " legacy-cache-value ";
    await expect(
      resolveCacheRedisUrl({ REDIS_URL: legacyCache }),
    ).resolves.toBe(legacyCache);
    await expect(
      resolveCacheRedisUrl({ REDIS_URL: "" }),
    ).resolves.toBeUndefined();
    await expect(
      resolveAuthRedisUrl({
        APOLLO_TF_AUTH_REDIS_URL: " redis://127.0.0.1:6379/7 ",
      }),
    ).rejects.toThrow("TF Redis configuration is invalid");
  });

  it("loads authenticated, database-specific mounted URLs for both consumers", async () => {
    const auth = "redis://tf-auth:auth-password@tf-redis:6379/1";
    const cache = "redis://tf-cache:cache-password@tf-redis:6379/0";
    const authPath = await mountedUrl("tf_auth_redis_url", auth);
    const cachePath = await mountedUrl("tf_cache_redis_url", cache);

    await expect(
      resolveAuthRedisUrl({ APOLLO_TF_AUTH_REDIS_URL_FILE: authPath }),
    ).resolves.toBe(auth);
    await expect(
      resolveCacheRedisUrl({ REDIS_URL_FILE: cachePath }),
    ).resolves.toBe(cache);
  });

  it.each([
    [
      "auth",
      resolveAuthRedisUrl,
      "APOLLO_TF_AUTH_REDIS_URL",
      "APOLLO_TF_AUTH_REDIS_URL_FILE",
    ],
    ["cache", resolveCacheRedisUrl, "REDIS_URL", "REDIS_URL_FILE"],
  ] as const)(
    "rejects ambiguous %s inputs before opening either value",
    async (_label, resolveUrl, inlineName, fileName) => {
      const inline =
        "redis://inline-user:inline-password@inline.invalid:6379/1";
      const path = "/private/mounted-url-canary";
      const environment = { [inlineName]: inline, [fileName]: path };
      const lstat = vi.fn(async () => {
        throw new Error("must not inspect");
      });
      const openFile = vi.fn(async () => {
        throw new Error("must not open");
      });
      await expectValueFreeFailure(
        resolveUrl(environment, { lstat, openFile } as never),
        environment,
        inline,
        path,
      );
      expect(lstat).not.toHaveBeenCalled();
      expect(openFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["oversized", "x".repeat(4_097)],
    ["malformed", "not-a-url"],
    ["unsupported scheme", "https://tf-cache:password@tf-redis:6379/0"],
    ["missing credential", "redis://tf-cache@tf-redis:6379/0"],
    ["wrong database", "redis://tf-cache:password@tf-redis:6379/1"],
    ["query", "redis://tf-cache:password@tf-redis:6379/0?name=value"],
  ])(
    "rejects %s cache file contents without disclosure",
    async (label, value) => {
      const path = await mountedUrl(`cache-${label}`, value);
      const environment = { REDIS_URL_FILE: path };
      await expectValueFreeFailure(
        resolveCacheRedisUrl(environment),
        environment,
        value,
        path,
      );
    },
  );

  it("rejects missing, non-regular, and symlink files", async () => {
    const target = await mountedUrl(
      "target",
      "redis://tf-auth:password@tf-redis:6379/1",
    );
    const directory = temporaryDirectories.at(-1)!;
    const link = join(directory, "link");
    await symlink(target, link, "file");
    for (const path of [join(directory, "missing"), directory, link]) {
      const environment = { APOLLO_TF_AUTH_REDIS_URL_FILE: path };
      await expectValueFreeFailure(
        resolveAuthRedisUrl(environment),
        environment,
        target,
        path,
      );
    }
  });

  it("bounds reads, detects post-open drift, closes once, and hides contents", async () => {
    const canary = "redis://tf-cache:bounded-password@tf-redis:6379/0";
    let position = 0;
    let largestRead = 0;
    const close = vi.fn(async () => {});
    const environment = { REDIS_URL_FILE: "/run/secrets/tf_cache_redis_url" };
    await expectValueFreeFailure(
      resolveCacheRedisUrl(environment, {
        lstat: async () => ({
          dev: 1,
          ino: 2,
          isFile: () => true,
          mtimeMs: 3,
          size: canary.length,
        }),
        openFile: async () => ({
          stat: async () => ({
            dev: 1,
            ino: 2,
            isFile: () => true,
            mtimeMs: 4,
            size: canary.length,
          }),
          read: async (buffer, offset, length) => {
            largestRead = Math.max(largestRead, length);
            const bytes = Buffer.from(canary);
            const bytesRead = Math.min(length, bytes.length - position);
            buffer.set(bytes.subarray(position, position + bytesRead), offset);
            position += bytesRead;
            return { bytesRead };
          },
          close,
        }),
      }),
      environment,
      canary,
    );
    expect(largestRead).toBeLessThanOrEqual(4_097);
    expect(close).toHaveBeenCalledOnce();
  });
});
