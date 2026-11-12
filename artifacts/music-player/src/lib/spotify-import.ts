import { tfFetch } from "@/lib/tf-session-client";
import { MAX_IMPORT_ENTRIES, validatePlaylistImportInput, type ImportDraftInput } from "@/lib/playlist-imports";

export type SpotifyImportSelection = { kind: "liked"; name: string }
  | { kind: "album" | "playlist"; id: string; name: string };

export type SpotifyImportPreview = { input: ImportDraftInput; unavailable: number };

export class SpotifyImportError extends Error {
  constructor(readonly code: "too_large" | "changed" | "invalid" | "empty") {
    super(code);
  }
}

const PAGE_SIZE = 50;
const sources = { liked: "spotify_liked", album: "spotify_album", playlist: "spotify_playlist" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readSpotifyImport(
  selection: SpotifyImportSelection,
  signal: AbortSignal,
  fetchPage: (path: string, signal: AbortSignal) => Promise<unknown> =
    (path, signal) => tfFetch(path, { signal, cache: "no-store" }),
): Promise<SpotifyImportPreview> {
  if (selection.kind !== "liked" && !/^[a-zA-Z0-9]{1,64}$/.test(selection.id)) {
    throw new SpotifyImportError("invalid");
  }
  const route = selection.kind === "liked" ? "/spotify/liked"
    : `/spotify/${selection.kind === "album" ? "albums" : "playlists"}/${selection.id}/tracks`;
  const entries: ImportDraftInput["entries"] = [];
  let total: number | undefined;
  for (let offset = 0; total === undefined || offset < total; offset += PAGE_SIZE) {
    signal.throwIfAborted();
    const page = await fetchPage(`${route}?offset=${offset}&limit=${PAGE_SIZE}`, signal);
    signal.throwIfAborted();
    if (!isRecord(page) || page.offset !== offset || page.limit !== PAGE_SIZE ||
        typeof page.total !== "number" || !Number.isSafeInteger(page.total) || page.total < 0 ||
        !Array.isArray(page.tracks)) throw new SpotifyImportError("invalid");
    if (total !== undefined && page.total !== total) throw new SpotifyImportError("changed");
    if (page.total > MAX_IMPORT_ENTRIES) throw new SpotifyImportError("too_large");
    total = page.total;
    if (page.tracks.length > Math.min(PAGE_SIZE, total - offset)) throw new SpotifyImportError("invalid");
    for (const row of page.tracks) {
      if (!isRecord(row) || typeof row.title !== "string" || typeof row.artist !== "string") {
        throw new SpotifyImportError("invalid");
      }
      const duration = selection.kind === "album" ? row.duration : row.durationMs;
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
        throw new SpotifyImportError("invalid");
      }
      entries.push({ title: row.title, artist: row.artist,
        durationSeconds: Math.floor(duration / (selection.kind === "album" ? 1 : 1000)) || null });
    }
  }
  if (!entries.length) throw new SpotifyImportError("empty");
  const input = validatePlaylistImportInput({ name: selection.name, source: sources[selection.kind], entries });
  return { input, unavailable: (total ?? 0) - entries.length };
}
