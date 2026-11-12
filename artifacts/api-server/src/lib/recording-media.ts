import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export type RecordingMediaBinding = {
  readonly sha256: string;
  readonly format: "wav" | "mp3" | "ogg" | "flac" | "m4a";
};

export type RecordingMedia = {
  open(binding: RecordingMediaBinding, signal?: AbortSignal): Promise<{
    bytes: Buffer;
    mimeType: string;
    release(): void;
  }>;
};

const errorMessages = {
  unavailable: "Recording media is unavailable.",
  busy: "Recording media is busy.",
  aborted: "Recording media read was aborted.",
} as const;

export class RecordingMediaError extends Error {
  constructor(readonly code: keyof typeof errorMessages) {
    super(errorMessages[code]);
    this.name = "RecordingMediaError";
  }
}

const mimeTypes = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
} as const satisfies Record<RecordingMediaBinding["format"], string>;

const MAX_BYTES = 32n * 1024n * 1024n;
const READ_CHUNK_BYTES = 256 * 1024;
const MAX_ACTIVE = 2;
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
let active = 0;

function requireAvailable(condition: boolean): asserts condition {
  if (!condition) throw new RecordingMediaError("unavailable");
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RecordingMediaError("aborted");
}

function mountDirectory(): string {
  const directory = process.env["TF_RECORDING_MEDIA_DIR"];
  requireAvailable(directory !== undefined && isAbsolute(directory) &&
    !directory.includes("\0") && !/^[\\/]{2}/.test(directory));

  if (process.platform === "win32") {
    requireAvailable(/^[a-z]:[\\/]/i.test(directory) &&
      directory.slice(3).split(/[\\/]/).every((part) => !/[. ]$|[:<>"|?*\x00-\x1f]/.test(part)));
  } else {
    requireAvailable(!directory.includes("\\") &&
      directory.split("/").every((part) => part !== "." && part !== ".."));
  }
  return directory;
}

function sameFile(before: BigIntStats, after: BigIntStats): boolean {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

function reserve(): () => void {
  if (active >= MAX_ACTIVE) throw new RecordingMediaError("busy");
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
  };
}

async function readVerified(
  path: string, listed: BigIntStats, expectedDigest: string, signal: AbortSignal | undefined,
): Promise<Buffer> {
  const handle = await open(path, READ_FLAGS);
  try {
    const before = await handle.stat({ bigint: true });
    requireAvailable(sameFile(listed, before));
    checkAbort(signal);
    const bytes = Buffer.allocUnsafe(Number(before.size));
    const hash = createHash("sha256");

    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await handle.read(bytes, offset, Math.min(READ_CHUNK_BYTES, bytes.length - offset), offset);
      checkAbort(signal);
      requireAvailable(bytesRead > 0);
      hash.update(bytes.subarray(offset, offset + bytesRead));
      offset += bytesRead;
    }

    // fstat catches changes during the read; lstat also catches a replaced path or last-component link.
    requireAvailable(sameFile(before, await handle.stat({ bigint: true })));
    requireAvailable(sameFile(before, await lstat(path, { bigint: true })));
    requireAvailable(hash.digest("hex") === expectedDigest);
    return bytes;
  } finally {
    await handle.close();
  }
}

export const defaultRecordingMedia: RecordingMedia = {
  async open(binding, signal) {
    let release: (() => void) | undefined;
    try {
      checkAbort(signal);
      const { sha256, format } = binding;
      requireAvailable(typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256) &&
        typeof format === "string" && Object.hasOwn(mimeTypes, format));
      const directory = mountDirectory();
      requireAvailable((await lstat(directory)).isDirectory());
      checkAbort(signal);
      const path = join(directory, `${sha256}.${format}`);
      const listed = await lstat(path, { bigint: true });
      requireAvailable(listed.isFile() && listed.size > 0n && listed.size <= MAX_BYTES);
      checkAbort(signal);
      release = reserve();
      const bytes = await readVerified(path, listed, sha256, signal);
      checkAbort(signal);
      return { bytes, mimeType: mimeTypes[format], release };
    } catch (error) {
      release?.();
      checkAbort(signal);
      if (error instanceof RecordingMediaError) throw error;
      throw new RecordingMediaError("unavailable");
    }
  },
};
