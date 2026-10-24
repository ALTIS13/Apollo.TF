import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DownloadExtension } from "./storage";

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_BUFFER_BYTES = 4_096;
const execFileAsync = promisify(execFile);

export interface FileDurationProbeOptions {
  readonly executable: string;
  readonly filePath: string;
  readonly extension: DownloadExtension;
  readonly signal: AbortSignal;
}

export type RunFileDurationMetadata = (
  executable: string,
  args: string[],
  options: {
    readonly shell: false;
    readonly windowsHide: true;
    readonly timeout: number;
    readonly maxBuffer: number;
    readonly signal: AbortSignal;
  },
) => Promise<string>;

const runMetadata: RunFileDurationMetadata = async (
  executable,
  args,
  options,
) => {
  const { stdout } = await execFileAsync(executable, args, options);
  return stdout;
};

export async function probeFileDuration(
  options: FileDurationProbeOptions,
  run: RunFileDurationMetadata = runMetadata,
): Promise<number> {
  try {
    if (options.extension !== "mp3" && options.extension !== "flac")
      throw new Error();
    const stdout = await run(
      options.executable,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-f",
        options.extension,
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        "-i",
        options.filePath,
      ],
      {
        shell: false,
        windowsHide: true,
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: PROBE_MAX_BUFFER_BYTES,
        signal: options.signal,
      },
    );
    const value = stdout.trim();
    if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error();
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error();
    return duration;
  } catch {
    throw new Error("file_duration_probe_failed");
  }
}
