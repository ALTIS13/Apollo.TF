import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maxBytes = 32 * 1024 * 1024;
const maxSeconds = 86_400;
const sampleRate = 8_000;
const bytesPerSecond = sampleRate * 2;
const inputFormats = { wav: "wav", mp3: "mp3", ogg: "ogg", flac: "flac", m4a: "mov" } as const;
type MediaFormat = keyof typeof inputFormats;
type VerificationErrorCode = "invalid_input" | "file_invalid" | "decode_failed" | "decode_timeout" | "duration_mismatch";

class RecordingVerificationError extends Error {
  constructor(readonly code: VerificationErrorCode) { super(code); }
}

async function readLocalFile(file: string): Promise<Buffer> {
  const invalid = () => new RecordingVerificationError("file_invalid");
  if (!file || file.length > 1_024 || /[\u0000-\u001f]/u.test(file) || /^(?:\\\\|\/\/)/u.test(file)) throw invalid();
  const path = resolve(file);
  if (process.platform === "win32" && !/^[a-z]:[\\/][^:]*$/iu.test(path)) throw invalid();
  try {
    const initial = await lstat(path, { bigint: true });
    if (!initial.isFile() || initial.size <= 0n || initial.size > BigInt(maxBytes)) throw invalid();
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const same = (stat: typeof initial) => stat.isFile() && stat.dev === initial.dev && stat.ino === initial.ino &&
        stat.size === initial.size && stat.mtimeNs === initial.mtimeNs && stat.ctimeNs === initial.ctimeNs;
      if (!same(await handle.stat({ bigint: true }))) throw invalid();
      const bytes = Buffer.allocUnsafe(Number(initial.size) + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== Number(initial.size) || !same(await handle.stat({ bigint: true }))) throw invalid();
      return bytes.subarray(0, offset);
    } finally { await handle.close(); }
  } catch { throw invalid(); }
}

function decodeDuration(bytes: Buffer, format: MediaFormat, executable: string, upperBoundSeconds: number): Promise<number> {
  return new Promise((resolveDuration, reject) => {
    const child = spawn(executable, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-err_detect", "explode", "-threads", "1",
      "-protocol_whitelist", "pipe", "-f", inputFormats[format], "-i", "pipe:0",
      // Raw PCM permits only one audio stream, so a multi-audio container fails instead of picking an edition.
      "-map", "0:a", "-vn", "-sn", "-dn", "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
    ], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let decoded = 0;
    let stopped: VerificationErrorCode | null = null;
    const stop = (code: VerificationErrorCode) => {
      if (stopped) return;
      stopped = code;
      child.kill("SIGKILL");
    };
    const deadline = setTimeout(() => stop("decode_timeout"), 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      decoded += chunk.length;
      if (decoded > upperBoundSeconds * bytesPerSecond) stop("duration_mismatch");
    });
    child.stdin.on("error", () => { /* FFmpeg may close its pipe before all input was consumed. */ });
    child.stdout.on("error", () => stop("decode_failed"));
    child.once("error", () => { stopped ??= "decode_failed"; });
    child.once("close", (code) => {
      clearTimeout(deadline);
      if (stopped) reject(new RecordingVerificationError(stopped));
      else if (code !== 0 || decoded === 0 || decoded % 2 !== 0) reject(new RecordingVerificationError("decode_failed"));
      else resolveDuration(decoded / bytesPerSecond);
    });
    child.stdin.end(bytes);
  });
}

export async function verifyRecordingMedia(input: {
  file: string;
  format: string;
  expectedDurationSeconds: number;
  executable?: string;
}) {
  const { expectedDurationSeconds: expected, file, format } = input;
  if (!Object.hasOwn(inputFormats, format) || !Number.isInteger(expected) || expected < 1 || expected > maxSeconds) {
    throw new RecordingVerificationError("invalid_input");
  }
  const knownFormat = format as MediaFormat;
  const bytes = await readLocalFile(file);
  const tolerance = Math.max(1, Math.min(5, Math.floor(expected * 0.02)));
  const decoded = await decodeDuration(bytes, knownFormat, input.executable ?? "ffmpeg", Math.min(maxSeconds, expected + tolerance));
  if (decoded < 1 || Math.abs(decoded - expected) > tolerance) throw new RecordingVerificationError("duration_mismatch");
  return {
    schemaVersion: 1 as const,
    media: { format: knownFormat, sha256: createHash("sha256").update(bytes).digest("hex") },
    expectedDurationSeconds: expected,
    measuredDurationSeconds: Math.round(decoded),
    decodedDurationSeconds: Math.round(decoded * 1_000) / 1_000,
    byteLength: bytes.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, format, expected, ...rest] = process.argv.slice(2);
  if (!file || !format || !expected || !/^[1-9]\d{0,4}$/u.test(expected) || rest.length) {
    process.stderr.write("Usage: verify-recording-media <local-file> <wav|mp3|ogg|flac|m4a> <expected-seconds>\n");
    process.exitCode = 2;
  } else {
    void verifyRecordingMedia({ file, format, expectedDurationSeconds: Number(expected), executable: process.env["TF_FFMPEG_EXECUTABLE"] })
      .then((receipt) => { process.stdout.write(`${JSON.stringify(receipt)}\n`); })
      .catch((error: unknown) => {
        process.stderr.write(`Recording verification failed: ${error instanceof RecordingVerificationError ? error.code : "decode_failed"}\n`);
        process.exitCode = 1;
      });
  }
}
