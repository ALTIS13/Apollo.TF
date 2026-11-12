import { describe, expect, it, vi } from "vitest";
import { MAX_IMPORT_ENTRIES, MAX_IMPORT_FILE_BYTES, readPlaylistImportFile, validatePlaylistImportInput } from "./playlist-imports";

const first = { artist: "Zeta", title: "First in file", durationSeconds: 1 };
const second = { artist: "Alpha", title: "Second in file", durationSeconds: null };
const input = { name: "Night mix", source: "file", entries: [first, second, first] };
const exported = {
  schemaVersion: "apollo.tf.playlist-export.v1",
  playlist: { name: input.name, description: "Discard this description" },
  tracks: input.entries,
};

describe("playlist import input", () => {
  it("projects an exact TF export to metadata, preserving order and duplicates", async () => {
    const file = new File([JSON.stringify(exported, null, 2)], "playlist.json", { type: "application/json" });
    await expect(readPlaylistImportFile(file)).resolves.toEqual(input);
  });

  it.each([
    { ...exported, schemaVersion: "other" },
    { ...exported, accountId: "private-value" },
    { ...exported, playlist: { ...exported.playlist, cover: "private-value" } },
    { ...exported, tracks: [] },
    { ...exported, tracks: [{ ...first, media: "private-value" }] },
    { ...exported, tracks: [{ artist: "A", title: "T" }] },
  ])("rejects non-export shapes and extra fields without disclosing input", async (value) => {
    await expect(readPlaylistImportFile(new File([JSON.stringify(value)], "playlist.json")))
      .rejects.toThrow(/^invalid_import_file$/);
  });

  it("rejects oversize files before reading and rejects malformed UTF-8", async () => {
    const read = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    try {
      const oversized = new File([new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)], "playlist.json");
      await expect(readPlaylistImportFile(oversized)).rejects.toThrow(/^import_file_too_large$/);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
    const corrupted = new File([new Uint8Array([0xc0, 0xaf])], "playlist.json");
    await expect(readPlaylistImportFile(corrupted)).rejects.toThrow(/^invalid_import_file$/);
  });

  it("enforces limits shared with provider callers without truncating or coercing input", () => {
    expect(MAX_IMPORT_ENTRIES).toBe(200);
    const valid = { name: "a".repeat(200), source: "spotify_album", entries: [
      { artist: "a".repeat(300), title: "b".repeat(500), durationSeconds: 86_400 },
      ...Array.from({ length: 199 }, () => first),
    ] };
    expect(validatePlaylistImportInput(valid)).toEqual(valid);
    expect(validatePlaylistImportInput({ ...input, name: " Night mix " })).toEqual(input);
    expect(validatePlaylistImportInput({ ...input, entries: [{ artist: " Zeta ", title: " First in file ", durationSeconds: 1 }] }).entries).toEqual([first]);
    for (const value of [
      { ...input, name: "a".repeat(201) },
      { ...input, entries: [] },
      { ...input, entries: Array.from({ length: 201 }, () => first) },
      { ...input, entries: [{ ...first, title: "a".repeat(501) }] },
      { ...input, entries: [{ ...first, artist: "a".repeat(301) }] },
      { ...input, entries: [{ ...first, durationSeconds: 0 }] },
      { ...input, entries: [{ ...first, durationSeconds: 86_401 }] },
      { ...input, entries: [{ ...first, durationSeconds: 1.5 }] },
      { ...input, entries: [{ ...first, durationSeconds: "1" }] },
      { ...input, entries: [{ ...first, providerId: "private-value" }] },
    ]) expect(() => validatePlaylistImportInput(value)).toThrow(/^invalid_import_input$/);
  });

  it("counts serialized UTF-8 bytes rather than JavaScript string length", () => {
    const value = { ...input, entries: Array.from({ length: 50 }, () => ({
      artist: "\u044F".repeat(300), title: "\u044F".repeat(500), durationSeconds: null,
    })) };
    expect(validatePlaylistImportInput(value)).toEqual(value);
    value.entries.push(...value.entries.slice(0, 10));
    expect(JSON.stringify(value).length).toBeLessThan(90 * 1024);
    expect(() => validatePlaylistImportInput(value)).toThrow(/^import_payload_too_large$/);
  });
});
