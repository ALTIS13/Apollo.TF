import { describe, expect, it, vi } from "vitest";
import { readSpotifyImport } from "./spotify-import";

const signal = new AbortController().signal;
const row = { title: "First", artist: "Artist", durationMs: 181500, id: "Spotify1", spotifyUrl: "https://open.spotify.com/track/Spotify1" };

describe("Spotify metadata import reads", () => {
  it.each([
    [{ kind: "liked", name: "Liked" }, "/spotify/liked?offset=0&limit=50", "spotify_liked"],
    [{ kind: "playlist", id: "Playlist1", name: "List" }, "/spotify/playlists/Playlist1/tracks?offset=0&limit=50", "spotify_playlist"],
  ] as const)("projects only ordered metadata from %j", async (selection, path, source) => {
    const fetchPage = vi.fn(async () => ({ offset: 0, limit: 50, total: 2, tracks: [row, row] }));
    await expect(readSpotifyImport(selection, signal, fetchPage)).resolves.toEqual({
      input: { name: selection.name, source, entries: [
        { title: "First", artist: "Artist", durationSeconds: 181 },
        { title: "First", artist: "Artist", durationSeconds: 181 },
      ] }, unavailable: 0, range: { offset: 0, end: 2, total: 2 },
    });
    expect(fetchPage).toHaveBeenCalledExactlyOnceWith(path, signal);
  });

  it("reads just the selected range of a large catalog with the provider's positional counts", async () => {
    const selection = { kind: "liked", name: "Liked" } as const;
    const fetchPage = vi.fn(async (path: string) => {
      const offset = Number(new URL(path, "https://fixture.invalid").searchParams.get("offset"));
      const tracks = Array.from({ length: Math.min(50, 202 - offset) }, (_, i) => ({
        ...row, title: `Track ${offset + i + 1}`,
      })).filter(({ title }) => title !== "Track 201");
      return { offset, limit: 50, total: 202, tracks };
    });
    const first = await readSpotifyImport(selection, signal, fetchPage);
    expect(first).toMatchObject({
      input: { name: "Liked (1-200)" }, unavailable: 0, range: { offset: 0, end: 200, total: 202 },
    });
    expect(first.input?.entries).toHaveLength(200);
    expect(fetchPage.mock.calls.map(([path]) => path)).toEqual([0, 50, 100, 150].map(
      (offset) => `/spotify/liked?offset=${offset}&limit=50`,
    ));
    fetchPage.mockClear();
    await expect(readSpotifyImport(selection, signal, fetchPage, { offset: 200, expectedTotal: 202 })).resolves.toEqual({
      input: { name: "Liked (201-202)", source: "spotify_liked", entries: [
        { title: "Track 202", artist: "Artist", durationSeconds: 181 },
      ] },
      unavailable: 1, range: { offset: 200, end: 202, total: 202 },
    });
    expect(fetchPage).toHaveBeenCalledExactlyOnceWith("/spotify/liked?offset=200&limit=50", signal);
  });

  it("keeps a completely unavailable range navigable without creating an empty draft", async () => {
    const fetchPage = vi.fn(async () => ({ offset: 200, limit: 50, total: 203, tracks: [] }));
    await expect(readSpotifyImport({ kind: "album", id: "Album1", name: "Album" }, signal, fetchPage,
      { offset: 200, expectedTotal: 203 })).resolves.toEqual({
      input: null, unavailable: 3, range: { offset: 200, end: 203, total: 203 },
    });
  });

  it("does not silently truncate an import that exceeds the draft byte limit", async () => {
    const fetchPage = vi.fn(async (path: string) => ({
      offset: Number(new URL(path, "https://fixture.invalid").searchParams.get("offset")),
      limit: 50,
      total: 200,
      tracks: Array.from({ length: 50 }, () => ({ ...row, title: "T".repeat(500) })),
    }));
    await expect(readSpotifyImport({ kind: "liked", name: "Liked" }, signal, fetchPage))
      .rejects.toMatchObject({ code: "too_large" });
  });

  it("rejects changing totals within a range or during navigation", async () => {
    const changing = vi.fn().mockResolvedValueOnce({ offset: 0, limit: 50, total: 51, tracks: [row] })
      .mockResolvedValueOnce({ offset: 50, limit: 50, total: 52, tracks: [row] });
    await expect(readSpotifyImport({ kind: "playlist", id: "Playlist1", name: "List" }, signal, changing))
      .rejects.toMatchObject({ code: "changed" });
    expect(changing).toHaveBeenLastCalledWith("/spotify/playlists/Playlist1/tracks?offset=50&limit=50", signal);
    const moved = vi.fn(async () => ({ offset: 200, limit: 50, total: 202, tracks: [row] }));
    await expect(readSpotifyImport({ kind: "liked", name: "Liked" }, signal, moved,
      { offset: 200, expectedTotal: 203 })).rejects.toMatchObject({ code: "changed" });
    expect(moved).toHaveBeenCalledTimes(1);
  });

  it("does not process a late page or read the next page after cancellation", async () => {
    const controller = new AbortController();
    let finish!: (page: unknown) => void;
    const fetchPage = vi.fn(() => new Promise<unknown>((resolve) => { finish = resolve; }));
    const pending = readSpotifyImport({ kind: "liked", name: "Liked" }, controller.signal, fetchPage);
    controller.abort();
    finish({ offset: 0, limit: 50, total: 51, tracks: [row] });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
