import { tfFetch } from "@/lib/tf-session-client";
import { MAX_IMPORT_ENTRIES, PlaylistImportInputError, validatePlaylistImportInput, type ImportDraftInput } from "@/lib/playlist-imports";

export type SpotifyImportSelection = { kind: "liked"; name: string }
  | { kind: "album" | "playlist"; id: string; name: string };

export type SpotifyImportRangeRequest = { offset: number; expectedTotal?: number };
export type SpotifyImportPreview = {
  input: ImportDraftInput | null;
  unavailable: number;
  range: { offset: number; end: number; total: number };
};

export class SpotifyImportError extends Error {
  constructor(readonly code: "too_large" | "changed" | "invalid") {
    super(code);
  }
}

const PAGE_SIZE = 50;
const MAX_PROVIDER_TOTAL = 1_000_000;
const sources = { liked: "spotify_liked", album: "spotify_album", playlist: "spotify_playlist" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PROVIDER_TOTAL;
}

export async function readSpotifyImport(
  selection: SpotifyImportSelection,
  signal: AbortSignal,
  fetchPage: (path: string, signal: AbortSignal) => Promise<unknown> =
    (path, signal) => tfFetch(path, { signal, cache: "no-store" }),
  range: SpotifyImportRangeRequest = { offset: 0 },
): Promise<SpotifyImportPreview> {
  if (selection.kind !== "liked" && !/^[a-zA-Z0-9]{1,64}$/.test(selection.id)) {
    throw new SpotifyImportError("invalid");
  }
  const { offset: start, expectedTotal } = range;
  if (!isProviderCount(start) || start >= MAX_PROVIDER_TOTAL || start % MAX_IMPORT_ENTRIES !== 0 ||
      (expectedTotal !== undefined && !isProviderCount(expectedTotal))) {
    throw new SpotifyImportError("invalid");
  }
  const route = selection.kind === "liked" ? "/spotify/liked"
    : `/spotify/${selection.kind === "album" ? "albums" : "playlists"}/${selection.id}/tracks`;
  const entries: ImportDraftInput["entries"] = [];
  let total = expectedTotal;
  let end = start + MAX_IMPORT_ENTRIES;
  for (let offset = start; offset < end; offset += PAGE_SIZE) {
    signal.throwIfAborted();
    const page = await fetchPage(`${route}?offset=${offset}&limit=${PAGE_SIZE}`, signal);
    signal.throwIfAborted();
    if (!isRecord(page) || page.offset !== offset || page.limit !== PAGE_SIZE ||
        !isProviderCount(page.total) ||
        !Array.isArray(page.tracks)) throw new SpotifyImportError("invalid");
    if (total !== undefined && page.total !== total) throw new SpotifyImportError("changed");
    if (start > 0 && start >= page.total) throw new SpotifyImportError("changed");
    total = page.total;
    end = Math.min(start + MAX_IMPORT_ENTRIES, total);
    if (page.tracks.length > Math.min(PAGE_SIZE, end - offset)) throw new SpotifyImportError("invalid");
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
  const suffix = (total ?? 0) > MAX_IMPORT_ENTRIES ? ` (${start + 1}-${end})` : "";
  const name = suffix
    ? selection.name.trim().slice(0, 200 - suffix.length).replace(/[\uD800-\uDBFF]$/, "").trimEnd() + suffix
    : selection.name;
  try {
    const input = entries.length ? validatePlaylistImportInput({ name, source: sources[selection.kind], entries }) : null;
    return { input, unavailable: end - start - entries.length, range: { offset: start, end, total: total ?? 0 } };
  } catch (error) {
    if (!(error instanceof PlaylistImportInputError)) throw error;
    throw new SpotifyImportError(error.code === "import_payload_too_large" ? "too_large" : "invalid");
  }
}
