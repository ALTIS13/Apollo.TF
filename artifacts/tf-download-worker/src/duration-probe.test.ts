import { describe, expect, it, vi } from "vitest";
import {
  probeSourceDuration,
  type RunDurationMetadata,
} from "./duration-probe";

const SOURCE_URL = "https://www.youtube.com/watch?v=sensitive-source";

describe("probeSourceDuration", () => {
  it("uses bounded yt-dlp metadata argv without a shell", async () => {
    const signal = new AbortController().signal;
    const run = vi.fn<RunDurationMetadata>(async () => "123.5\n");

    await expect(
      probeSourceDuration(
        { executable: "yt-dlp", sourceUrl: SOURCE_URL, signal },
        run,
      ),
    ).resolves.toBe(123.5);
    expect(run).toHaveBeenCalledWith(
      "yt-dlp",
      [
        "--ignore-config",
        "--no-playlist",
        "--skip-download",
        "--no-warnings",
        "--quiet",
        "--print",
        "%(duration)s",
        "--",
        SOURCE_URL,
      ],
      {
        shell: false,
        windowsHide: true,
        timeout: expect.any(Number),
        maxBuffer: expect.any(Number),
        signal,
      },
    );
    expect(run.mock.calls[0]?.[2].timeout).toBeLessThanOrEqual(15_000);
    expect(run.mock.calls[0]?.[2].maxBuffer).toBeLessThanOrEqual(16_384);
  });

  it.each(["NA", "0", "-1", "Infinity", "123\n456", "1e10", ""])(
    "rejects unavailable or malformed duration %j",
    async (stdout) => {
      await expect(
        probeSourceDuration(
          {
            executable: "yt-dlp",
            sourceUrl: SOURCE_URL,
            signal: new AbortController().signal,
          },
          async () => stdout,
        ),
      ).rejects.toThrow("duration_probe_failed");
    },
  );

  it("does not propagate provider error text", async () => {
    const run = vi.fn(async (): Promise<string> => {
      throw new Error(`stderr ${SOURCE_URL} signed-secret`);
    });
    await expect(
      probeSourceDuration(
        {
          executable: "yt-dlp",
          sourceUrl: SOURCE_URL,
          signal: new AbortController().signal,
        },
        run,
      ),
    ).rejects.toMatchObject({
      message: "duration_probe_failed",
    });
  });
});
