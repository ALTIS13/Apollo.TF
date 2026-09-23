import { execFile } from "node:child_process";
import { promisify } from "node:util";

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_BUFFER_BYTES = 4_096;
const execFileAsync = promisify(execFile);

export interface DurationProbeOptions {
  readonly executable: string;
  readonly sourceUrl: string;
  readonly signal: AbortSignal;
}

export type RunDurationMetadata = (
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

const runMetadata: RunDurationMetadata = async (executable, args, options) => {
  const { stdout } = await execFileAsync(executable, args, options);
  return stdout;
};

export async function probeSourceDuration(
  options: DurationProbeOptions,
  run: RunDurationMetadata = runMetadata,
): Promise<number> {
  try {
    const stdout = await run(
      options.executable,
      [
        "--ignore-config",
        "--no-playlist",
        "--skip-download",
        "--no-warnings",
        "--quiet",
        "--print",
        "%(duration)s",
        "--",
        options.sourceUrl,
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
    throw new Error("duration_probe_failed");
  }
}
