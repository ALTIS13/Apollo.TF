import { describe, expect, it, vi } from "vitest";
import {
  probeFileDuration,
  type RunFileDurationMetadata,
} from "./file-duration-probe";

const FILE_PATH =
  "/var/lib/apollo-tf/downloads/11111111-1111-4111-8111-111111111111.mp3.part";

describe("probeFileDuration", () => {
  it("inspects only the local encoded format with bounded ffprobe argv", async () => {
    const signal = new AbortController().signal;
    const run = vi.fn<RunFileDurationMetadata>(async () => "205.25\n");

    await expect(
      probeFileDuration(
        {
          executable: "ffprobe",
          filePath: FILE_PATH,
          extension: "mp3",
          signal,
        },
        run,
      ),
    ).resolves.toBe(205.25);
    expect(run).toHaveBeenCalledWith(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-f",
        "mp3",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        "-i",
        FILE_PATH,
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

  it.each(["N/A", "0", "-1", "Infinity", "123\n456", "1e10", ""])(
    "rejects invalid file duration %j",
    async (stdout) => {
      await expect(
        probeFileDuration(
          {
            executable: "ffprobe",
            filePath: FILE_PATH,
            extension: "mp3",
            signal: new AbortController().signal,
          },
          async () => stdout,
        ),
      ).rejects.toThrow("file_duration_probe_failed");
    },
  );

  it("rejects unsupported formats before invoking ffprobe", async () => {
    const run = vi.fn<RunFileDurationMetadata>(async () => "205");
    await expect(
      probeFileDuration(
        {
          executable: "ffprobe",
          filePath: FILE_PATH,
          extension: "aac" as "mp3",
          signal: new AbortController().signal,
        },
        run,
      ),
    ).rejects.toThrow("file_duration_probe_failed");
    expect(run).not.toHaveBeenCalled();
  });

  it("does not expose local paths or ffprobe stderr", async () => {
    await expect(
      probeFileDuration(
        {
          executable: "ffprobe",
          filePath: FILE_PATH,
          extension: "mp3",
          signal: new AbortController().signal,
        },
        async () => {
          throw new Error(`secret ${FILE_PATH}`);
        },
      ),
    ).rejects.toMatchObject({
      message: "file_duration_probe_failed",
    });
  });
});
