import { lstat, open } from "node:fs/promises";
import { isAbsolute } from "node:path";

const maximumFileBytes = 4_096;
const maximumPathCharacters = 1_024;

const invalid = () => new Error("TF Redis configuration is invalid");

interface RedisFileMetadata {
  readonly dev: number;
  readonly ino: number;
  isFile(): boolean;
  readonly mtimeMs: number;
  readonly size: number;
}

interface RedisFileHandle {
  stat(): Promise<RedisFileMetadata>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ): Promise<{ readonly bytesRead: number }>;
  close(): Promise<void>;
}

export interface RedisUrlDependencies {
  readonly lstat?: (path: string) => Promise<RedisFileMetadata>;
  readonly openFile?: (path: string, flags: "r") => Promise<RedisFileHandle>;
}

interface RedisUrlInput {
  readonly database: 0 | 1;
  readonly fileName: "APOLLO_TF_AUTH_REDIS_URL_FILE" | "REDIS_URL_FILE";
  readonly inlineName: "APOLLO_TF_AUTH_REDIS_URL" | "REDIS_URL";
  readonly legacyInline: "auth" | "cache";
  readonly required: boolean;
}

function sameFile(
  expected: RedisFileMetadata,
  actual: RedisFileMetadata,
): boolean {
  return (
    actual.isFile() &&
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.mtimeMs === expected.mtimeMs &&
    actual.size === expected.size
  );
}

async function readMountedRedisUrl(
  path: string,
  dependencies: RedisUrlDependencies,
): Promise<string> {
  if (
    path.length < 1 ||
    path.length > maximumPathCharacters ||
    path.trim() !== path ||
    !isAbsolute(path)
  ) {
    throw invalid();
  }
  const inspect = dependencies.lstat ?? lstat;
  const captured = await inspect(path);
  if (
    !captured.isFile() ||
    !Number.isSafeInteger(captured.size) ||
    captured.size < 1 ||
    captured.size > maximumFileBytes
  ) {
    throw invalid();
  }

  const handle = await (dependencies.openFile ?? open)(path, "r");
  const bytes = Buffer.alloc(maximumFileBytes + 1);
  try {
    const opened = await handle.stat();
    if (!sameFile(captured, opened)) throw invalid();
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        total,
        bytes.length - total,
        null,
      );
      if (
        !Number.isSafeInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > bytes.length - total
      ) {
        throw invalid();
      }
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const afterRead = await inspect(path);
    const afterOpen = await handle.stat();
    if (
      total !== captured.size ||
      total > maximumFileBytes ||
      !sameFile(captured, afterRead) ||
      !sameFile(captured, afterOpen)
    ) {
      throw invalid();
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, total),
    );
  } finally {
    bytes.fill(0);
    await handle.close();
  }
}

function parseLegacyAuthRedisUrl(value: string): string {
  const url = new URL(value);
  if (
    value.length === 0 ||
    value.trim() !== value ||
    (url.protocol !== "redis:" && url.protocol !== "rediss:") ||
    url.hostname.length === 0 ||
    url.hash.length !== 0
  ) {
    throw invalid();
  }
  return value;
}

function parseMountedRedisUrl(value: string, database: 0 | 1): string {
  if (value.trim() !== value || /[\s\u0000-\u001f\u007f]/u.test(value)) {
    throw invalid();
  }
  const url = new URL(value);
  if (
    url.href !== value ||
    (url.protocol !== "redis:" && url.protocol !== "rediss:") ||
    url.hostname.length === 0 ||
    url.username.length === 0 ||
    url.password.length === 0 ||
    url.pathname !== `/${database}` ||
    url.search.length !== 0 ||
    url.hash.length !== 0
  ) {
    throw invalid();
  }
  return value;
}

async function resolveRedisUrl(
  environment: NodeJS.ProcessEnv,
  input: RedisUrlInput,
  dependencies: RedisUrlDependencies,
): Promise<string | undefined> {
  try {
    const inline = environment[input.inlineName];
    const file = environment[input.fileName];
    if (inline !== undefined && file !== undefined) throw invalid();
    if (file !== undefined) {
      return parseMountedRedisUrl(
        await readMountedRedisUrl(file, dependencies),
        input.database,
      );
    }
    if (inline !== undefined) {
      if (input.legacyInline === "cache") {
        return inline.length === 0 ? undefined : inline;
      }
      return parseLegacyAuthRedisUrl(inline);
    }
    if (input.required) throw invalid();
    return undefined;
  } catch {
    throw invalid();
  }
}

export function resolveAuthRedisUrl(
  environment: NodeJS.ProcessEnv,
  dependencies: RedisUrlDependencies = {},
): Promise<string> {
  return resolveRedisUrl(
    environment,
    {
      database: 1,
      fileName: "APOLLO_TF_AUTH_REDIS_URL_FILE",
      inlineName: "APOLLO_TF_AUTH_REDIS_URL",
      legacyInline: "auth",
      required: true,
    },
    dependencies,
  ) as Promise<string>;
}

export function resolveCacheRedisUrl(
  environment: NodeJS.ProcessEnv,
  dependencies: RedisUrlDependencies = {},
): Promise<string | undefined> {
  return resolveRedisUrl(
    environment,
    {
      database: 0,
      fileName: "REDIS_URL_FILE",
      inlineName: "REDIS_URL",
      legacyInline: "cache",
      required: false,
    },
    dependencies,
  );
}
