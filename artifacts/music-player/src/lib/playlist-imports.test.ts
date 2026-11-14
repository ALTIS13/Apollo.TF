import { describe, expect, it, vi } from "vitest";
import {
  MAX_IMPORT_ENTRIES,
  MAX_IMPORT_FILE_BYTES,
  previewSpotifyLibraryRange,
  readPlaylistImportFile,
  readSpotifyExportFile,
  validatePlaylistImportInput,
} from "./playlist-imports";

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

describe("Spotify playlist archive", () => {
  const track = {
    track: {
      trackName: "Archive song", artistName: "Archive artist", trackUri: "spotify:track:ABC123",
      albumName: "Discard album",
    },
    addedAt: "Discard date",
  };
  const local = { track: { ...track.track, trackUri: "spotify:local:A:B:C:123" } };
  const file = (value: unknown) => new File([JSON.stringify(value)], "Playlist1.json");

  it.each([false, true])("retains separate selected playlists and ordered occurrences (wrapped: %s)", async (wrapped) => {
    const playlists = [
      { name: "First", items: [track], description: "Discard description" },
      { name: " Second ", items: [...Array(200).fill(null), track, local, track], owner: "Discard owner" },
      { name: "Empty", items: [] },
    ];
    const archive = await readSpotifyExportFile(file(wrapped ? { playlists, account: "Discard account" } : playlists));
    expect(archive.kind).toBe("playlists");
    expect(archive.collections.map((item) => [item.name, item.slots.length])).toEqual([
      ["First", 1], ["Second", 203], ["Empty", 0],
    ]);
    const entry = { artist: "Archive artist", title: "Archive song", durationSeconds: null };
    expect(previewSpotifyLibraryRange(archive.collections[1]!, 200)).toEqual({
      offset: 200, end: 203, total: 203, unavailable: 1,
      input: { name: "Second (201–203)", source: "file", entries: [entry, entry] },
    });
    expect(JSON.stringify(archive)).not.toMatch(/Discard|spotify:track:|spotify:local:/);
  });

  it("rejects malformed collections and combined slot overflow instead of silently importing a subset", async () => {
    await expect(readSpotifyExportFile(file([{ trackName: "History entry" }]))).rejects.toThrow(/^invalid_import_file$/);
    await expect(readSpotifyExportFile(file({ playlists: [
      { name: "Good", items: [track] }, { name: "Broken", items: "not an array" },
    ] }))).rejects.toThrow(/^invalid_import_file$/);
    await expect(readSpotifyExportFile(file({ playlists: [
      { name: "A", items: Array(5_001).fill(null) }, { name: "B", items: Array(5_000).fill(null) },
    ] }))).rejects.toThrow(/^invalid_import_file$/);
  });
});

describe("Spotify saved tracks file", () => {
  const song = { artist: " Fixture Artist ", track: " Example Track ", uri: "spotify:track:Example123" };
  const exportFile = (value: unknown) => new File([JSON.stringify(value)], "YourLibrary.json");
  const readLibrary = async (file: Blob) => {
    const archive = await readSpotifyExportFile(file);
    expect(archive.kind).toBe("library");
    expect(archive.collections).toHaveLength(1);
    return archive.collections[0]!;
  };

  it("previews raw positions without retaining Spotify IDs, unrelated data or unsupported rows", async () => {
    const library = await readLibrary(exportFile({
      tracks: [
        ...Array.from({ length: 200 }, () => null),
        { ...song, album: "Not retained", durationMs: 200_000, audioUrl: "Not retained" },
        { ...song, uri: "spotify:local:artist:album:track:123" },
        song,
      ],
      episodes: [{ name: "Private episode" }],
      account: { username: "Private account" },
    }));
    const entry = { artist: "Fixture Artist", title: "Example Track", durationSeconds: null };
    expect(library.slots.slice(200)).toEqual([entry, null, entry]);
    expect(Object.keys(library)).toEqual(["slots"]);
    expect(previewSpotifyLibraryRange(library, 0)).toEqual({
      offset: 0, end: 200, total: 203, unavailable: 200, input: null,
    });
    expect(previewSpotifyLibraryRange(library, 200)).toEqual({
      offset: 200, end: 203, total: 203, unavailable: 1,
      input: { name: "Любимые Spotify из файла (201–203)", source: "file", entries: [entry, entry] },
    });
    expect(() => previewSpotifyLibraryRange(library, 201)).toThrow(/^invalid_import_input$/);
  });

  it("rejects ZIP and unrelated JSON, bounds input size and keeps the TF file limit", async () => {
    await expect(readSpotifyExportFile(exportFile({ history: [] }))).rejects.toThrow(/^invalid_import_file$/);
    await expect(readSpotifyExportFile(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "data.zip")))
      .rejects.toThrow(/^invalid_import_file$/);
    await expect(readSpotifyExportFile(exportFile({ tracks: Array(10_001).fill(song) })))
      .rejects.toThrow(/^invalid_import_file$/);
    const oversized = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]);
    const read = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    try {
      await expect(readSpotifyExportFile(oversized)).rejects.toThrow(/^import_file_too_large$/);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
    const boundedLargeFile = exportFile({ tracks: [song], extra: " ".repeat(128 * 1024) });
    await expect(readLibrary(boundedLargeFile)).resolves.toMatchObject({ slots: [{ title: "Example Track" }] });
    await expect(readPlaylistImportFile(boundedLargeFile)).rejects.toThrow(/^import_file_too_large$/);
  });

  it("keeps a zero-song library read-only and refuses a preview over the draft byte budget", async () => {
    const empty = await readLibrary(exportFile({ tracks: [] }));
    expect(previewSpotifyLibraryRange(empty, 0)).toEqual({
      offset: 0, end: 0, total: 0, unavailable: 0, input: null,
    });
    const large = await readLibrary(exportFile({
      tracks: Array(200).fill({ ...song, artist: "я".repeat(300), track: "я".repeat(500) }),
    }));
    expect(() => previewSpotifyLibraryRange(large, 0)).toThrow(/^import_payload_too_large$/);
  });
});
