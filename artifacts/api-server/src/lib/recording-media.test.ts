import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRecordingMedia, RecordingMediaError, type RecordingMediaBinding } from "./recording-media.js";

vi.mock("node:fs/promises", { spy: true });

const maximumBytes = 32 * 1024 * 1024;
const audio = Buffer.from("test recording bytes");
const sha256 = createHash("sha256").update(audio).digest("hex");
const binding = { sha256, format: "wav" } as const;

describe("recording media mount", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tf-recording-media-"));
    vi.stubEnv("TF_RECORDING_MEDIA_DIR", directory);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  function filename(input: RecordingMediaBinding) {
    return join(directory, `${input.sha256}.${input.format}`);
  }

  it.each([
    ["wav", "audio/wav"], ["mp3", "audio/mpeg"], ["ogg", "audio/ogg"],
    ["flac", "audio/flac"], ["m4a", "audio/mp4"],
  ] as const)("verifies bytes for %s and supplies its MIME type", async (format, mimeType) => {
    const input = { sha256, format };
    await writeFile(filename(input), audio);
    const media = await defaultRecordingMedia.open(input);
    try {
      expect(media.bytes).toEqual(audio);
      expect(media.mimeType).toBe(mimeType);
    } finally {
      media.release();
    }
  });

  it("rejects tampering and missing files with sanitized errors, without leaking slots", async () => {
    const missing = defaultRecordingMedia.open(binding);
    await expect(missing).rejects.toMatchObject({
      code: "unavailable", message: "Recording media is unavailable.",
    });
    await expect(missing).rejects.not.toHaveProperty("cause");
    await writeFile(filename(binding), Buffer.alloc(audio.length, 1));
    await expect(defaultRecordingMedia.open(binding)).rejects.toBeInstanceOf(RecordingMediaError);
    await expect(defaultRecordingMedia.open(binding)).rejects.toMatchObject({ code: "unavailable" });
    await writeFile(filename(binding), audio);
    const media = await defaultRecordingMedia.open(binding);
    media.release();
  });

  it("rejects a file whose timestamp changes between real file-handle stats, even if the digest matches", async () => {
    const path = filename(binding);
    await writeFile(path, audio);
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let stats = 0;
    vi.mocked(open).mockImplementationOnce(async (file, flags, mode) => {
      const handle = await actual.open(file, flags, mode);
      const stat = handle.stat.bind(handle);
      vi.spyOn(handle, "stat").mockImplementation((async (options?: { bigint?: boolean }) => {
        if (++stats === 2) await utimes(path, 1, 1);
        return stat(options);
      }) as typeof handle.stat);
      return handle;
    });

    await expect(defaultRecordingMedia.open(binding)).rejects.toMatchObject({ code: "unavailable" });
    expect(stats).toBe(2);
  });

  it("accepts exactly 32 MiB and rejects an object one byte larger", async () => {
    const block = Buffer.alloc(1024 * 1024);
    const digest = createHash("sha256");
    for (let n = 0; n < 32; n++) digest.update(block);
    const input = { ...binding, sha256: digest.digest("hex") };
    let file = await open(filename(input), "w");
    try {
      await file.truncate(maximumBytes + 1);
    } finally {
      await file.close();
    }
    await expect(defaultRecordingMedia.open(input)).rejects.toMatchObject({ code: "unavailable" });
    file = await open(filename(input), "r+");
    try {
      await file.truncate(maximumBytes);
    } finally {
      await file.close();
    }
    const media = await defaultRecordingMedia.open(input);
    try {
      expect(media.bytes.byteLength).toBe(maximumBytes);
    } finally {
      media.release();
    }
  });

  it("holds both admission slots until released and does not count a release twice", async () => {
    await writeFile(filename(binding), audio);
    const first = await defaultRecordingMedia.open(binding);
    const second = await defaultRecordingMedia.open(binding);
    try {
      await expect(defaultRecordingMedia.open(binding)).rejects.toMatchObject({ code: "busy" });
      first.release();
      const third = await defaultRecordingMedia.open(binding);
      try {
        first.release();
        await expect(defaultRecordingMedia.open(binding)).rejects.toMatchObject({ code: "busy" });
      } finally {
        third.release();
      }
    } finally {
      first.release();
      second.release();
    }
  });

  it("rejects an empty object before opening it or taking an admission slot", async () => {
    const empty = { ...binding, sha256: createHash("sha256").digest("hex") };
    await writeFile(filename(empty), Buffer.alloc(0));
    const openCalls = vi.mocked(open).mock.calls.length;
    const attempt = defaultRecordingMedia.open(empty).then((media) => {
      media.release();
      return media;
    });
    await expect(attempt).rejects.toMatchObject({ code: "unavailable" });
    expect(vi.mocked(open).mock.calls).toHaveLength(openCalls);

    await writeFile(filename(binding), audio);
    const first = await defaultRecordingMedia.open(binding);
    const second = await defaultRecordingMedia.open(binding);
    try {
      await expect(defaultRecordingMedia.open(empty)).rejects.toMatchObject({ code: "unavailable" });
    } finally {
      first.release();
      second.release();
    }
  });

  it("rejects malformed bindings and unsafe mount paths", async () => {
    await writeFile(filename(binding), audio);
    for (const bad of [
      { ...binding, sha256: sha256.toUpperCase() }, { ...binding, sha256: `../${sha256}` },
      { ...binding, sha256: `${sha256}\0` }, { ...binding, sha256: `${sha256}\n` },
      { ...binding, format: "__proto__" }, { ...binding, format: "wav/../mp3" },
      { ...binding, format: "aiff" },
    ]) {
      await expect(defaultRecordingMedia.open(bad as RecordingMediaBinding)).rejects.toMatchObject({ code: "unavailable" });
    }
    for (const root of [
      undefined, "relative-media", `.${sep}relative-media`, `\\\\example.invalid\\share`,
      "//example.invalid/share", "https://example.invalid/media",
      `${directory}${sep}..${sep}${basename(directory)}`,
    ]) {
      vi.stubEnv("TF_RECORDING_MEDIA_DIR", root);
      await expect(defaultRecordingMedia.open(binding), String(root)).rejects.toMatchObject({ code: "unavailable" });
    }

    // The OS environment can truncate NUL before application validation sees it.
    const env = process.env;
    let nulMount: ReturnType<typeof defaultRecordingMedia.open>;
    try {
      process.env = { ...env, TF_RECORDING_MEDIA_DIR: `${directory}\0` };
      nulMount = defaultRecordingMedia.open(binding);
    } finally {
      process.env = env;
    }
    await expect(nulMount).rejects.toMatchObject({ code: "unavailable" });
  });

  it("rejects last-component symlinks and nonregular objects", async () => {
    const real = join(directory, "same-content");
    await writeFile(real, audio);
    try {
      await symlink(real, filename(binding), "file");
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      const target = join(directory, "junction-target");
      await mkdir(target);
      await symlink(target, filename(binding), "junction");
    }
    await expect(defaultRecordingMedia.open(binding)).rejects.toMatchObject({ code: "unavailable" });
    const other = { ...binding, format: "mp3" } as const;
    await mkdir(filename(other));
    await expect(defaultRecordingMedia.open(other)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("honors an abort before or during admission and releases any acquired slot", async () => {
    await writeFile(filename(binding), audio);
    const controller = new AbortController();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementationOnce(async (file, flags, mode) => {
      const handle = await actual.open(file, flags, mode);
      controller.abort(new Error("private reason"));
      return handle;
    });
    await expect(defaultRecordingMedia.open(binding, controller.signal))
      .rejects.toMatchObject({ code: "aborted", message: "Recording media read was aborted." });
    await expect(defaultRecordingMedia.open(binding, controller.signal)).rejects.toMatchObject({ code: "aborted" });
    const first = await defaultRecordingMedia.open(binding);
    try {
      const second = await defaultRecordingMedia.open(binding);
      second.release();
    } finally {
      first.release();
    }
  });
});
