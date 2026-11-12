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
      ] }, unavailable: 0,
    });
    expect(fetchPage).toHaveBeenCalledExactlyOnceWith(path, signal);
  });

  it("rejects an oversized catalog or changing totals without silently truncating it", async () => {
    const oversized = vi.fn(async () => ({ offset: 0, limit: 50, total: 201, tracks: [row] }));
    await expect(readSpotifyImport({ kind: "liked", name: "Liked" }, signal, oversized))
      .rejects.toMatchObject({ code: "too_large" });
    expect(oversized).toHaveBeenCalledTimes(1);
    const changing = vi.fn().mockResolvedValueOnce({ offset: 0, limit: 50, total: 51, tracks: [row] })
      .mockResolvedValueOnce({ offset: 50, limit: 50, total: 52, tracks: [row] });
    await expect(readSpotifyImport({ kind: "playlist", id: "Playlist1", name: "List" }, signal, changing))
      .rejects.toMatchObject({ code: "changed" });
    expect(changing).toHaveBeenLastCalledWith("/spotify/playlists/Playlist1/tracks?offset=50&limit=50", signal);
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
