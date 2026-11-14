import { createHash } from "node:crypto";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyRecordingMedia } from "./verify-recording-media.js";

const executable = process.env["TF_TEST_FFMPEG_EXECUTABLE"];
const roots: string[] = [];

function wav(seconds: number) {
  const sampleRate = 8_000;
  const dataBytes = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

async function fixture(bytes: Buffer) {
  const root = await mkdtemp(join(tmpdir(), "tf-media-verification-"));
  roots.push(root);
  const path = join(root, "fixture.wav");
  await writeFile(path, bytes);
  return path;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep + "tf-media-verification-")) throw new Error("Unexpected fixture cleanup path");
    await rm(root, { recursive: true, force: true });
  }
});

describe("verify reviewed recording media", () => {
  it.skipIf(!executable)("hashes the same bytes it decodes and admits a genuine short recording", async () => {
    const bytes = wav(4);
    const file = await fixture(bytes);
    await expect(verifyRecordingMedia({ file, format: "wav", expectedDurationSeconds: 4, executable })).resolves.toEqual({
      schemaVersion: 1, media: { format: "wav", sha256: createHash("sha256").update(bytes).digest("hex") },
      expectedDurationSeconds: 4, measuredDurationSeconds: 4, decodedDurationSeconds: 4, byteLength: bytes.length,
    });
  });

  it.skipIf(!executable)("rejects both a 30-second excerpt and a container with truncated audio frames", async () => {
    const excerpt = await fixture(wav(30));
    await expect(verifyRecordingMedia({ file: excerpt, format: "wav", expectedDurationSeconds: 205, executable }))
      .rejects.toMatchObject({ code: "duration_mismatch" });
    const truncated = await fixture(wav(4).subarray(0, 2_000));
    await expect(verifyRecordingMedia({ file: truncated, format: "wav", expectedDurationSeconds: 4, executable }))
      .rejects.toMatchObject({ code: "decode_failed" });
  });

  it("rejects an oversize input before needing a decoder", async () => {
    const file = await fixture(Buffer.from("irrelevant"));
    await truncate(file, 32 * 1024 * 1024 + 1);
    await expect(verifyRecordingMedia({ file, format: "wav", expectedDurationSeconds: 1, executable: "unused-ffmpeg" }))
      .rejects.toMatchObject({ code: "file_invalid" });
  });
});
