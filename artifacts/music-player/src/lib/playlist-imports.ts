import { z } from "zod";

export const MAX_IMPORT_ENTRIES = 200;
export const MAX_IMPORT_PAYLOAD_BYTES = 90 * 1024;
export const MAX_IMPORT_FILE_BYTES = 128 * 1024;
export const MAX_SPOTIFY_LIBRARY_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SPOTIFY_LIBRARY_SLOTS = 10_000;
const MAX_SPOTIFY_EXPORT_PLAYLISTS = 1_000;
const MAX_IMPORT_NAME_LENGTH = 200;

const sourceSchema = z.enum(["file", "spotify_album", "spotify_playlist", "spotify_liked"]);
const requiredText = (max: number) => z.string().trim().min(1).max(max).refine((text) => !text.includes("\0"));
const nameSchema = requiredText(MAX_IMPORT_NAME_LENGTH);
const entriesSchema = z.array(z.object({
  artist: requiredText(300),
  title: requiredText(500),
  durationSeconds: z.number().int().min(1).max(86_400).nullable(),
}).strict()).min(1).max(MAX_IMPORT_ENTRIES);
const inputSchema = z.object({ name: nameSchema, source: sourceSchema, entries: entriesSchema }).strict();
const exportSchema = z.object({
  schemaVersion: z.literal("apollo.tf.playlist-export.v1"),
  playlist: z.object({ name: nameSchema, description: z.string().nullable() }).strict(),
  tracks: entriesSchema,
}).strict();
const spotifyLibrarySchema = z.object({
  tracks: z.array(z.unknown()).max(MAX_SPOTIFY_LIBRARY_SLOTS),
});
const spotifyTrackUriSchema = z.string().regex(/^spotify:track:[A-Za-z0-9]{1,64}$/);
const spotifyLibraryTrackSchema = z.object({
  artist: requiredText(300),
  track: requiredText(500),
  uri: spotifyTrackUriSchema,
});
const spotifyPlaylistArraySchema = z.array(z.object({
  name: nameSchema,
  items: z.array(z.unknown()).max(MAX_SPOTIFY_LIBRARY_SLOTS),
})).max(MAX_SPOTIFY_EXPORT_PLAYLISTS);
const spotifyPlaylistExportSchema = z.union([
  z.object({ playlists: spotifyPlaylistArraySchema }).transform(({ playlists }) => playlists),
  spotifyPlaylistArraySchema.min(1),
]);
const spotifyPlaylistTrackSchema = z.object({
  track: z.object({
    artistName: requiredText(300),
    trackName: requiredText(500),
    trackUri: spotifyTrackUriSchema,
  }),
});

export type ImportDraftInput = z.infer<typeof inputSchema>;
export type ImportDraftSource = ImportDraftInput["source"];
export type ImportDraftEntry = ImportDraftInput["entries"][number];
export interface ImportDraftSummary {
  id: string;
  name: string;
  source: ImportDraftSource;
  entryCount: number;
  createdAt: string;
}
export interface ImportDraft extends ImportDraftSummary {
  entries: ImportDraftEntry[];
}
export interface SpotifyLibraryExport {
  readonly name?: string;
  readonly slots: readonly (ImportDraftEntry | null)[];
}
export interface SpotifyExportFile {
  readonly kind: "library" | "playlists";
  readonly collections: readonly SpotifyLibraryExport[];
}

type ImportInputErrorCode = "invalid_import_input" | "import_payload_too_large" | "invalid_import_file" | "import_file_too_large";

export class PlaylistImportInputError extends Error {
  constructor(readonly code: ImportInputErrorCode) {
    super(code);
    this.name = "PlaylistImportInputError";
  }
}

export function validatePlaylistImportInput(value: unknown): ImportDraftInput {
  const result = inputSchema.safeParse(value);
  if (!result.success) throw new PlaylistImportInputError("invalid_import_input");
  if (new TextEncoder().encode(JSON.stringify(result.data)).byteLength > MAX_IMPORT_PAYLOAD_BYTES) {
    throw new PlaylistImportInputError("import_payload_too_large");
  }
  return result.data;
}

function readFileBytes(file: Blob, signal?: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    reader.onloadend = () => signal?.removeEventListener("abort", abort);
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new PlaylistImportInputError("invalid_import_file"));
    };
    reader.onerror = () => reject(new PlaylistImportInputError("invalid_import_file"));
    reader.onabort = () => reject(new DOMException("File read aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    reader.readAsArrayBuffer(file);
  });
}

async function readImportJson(file: Blob, limit: number, signal?: AbortSignal): Promise<unknown> {
  if (file.size > limit) throw new PlaylistImportInputError("import_file_too_large");
  signal?.throwIfAborted();
  let value: unknown;
  try {
    const bytes = await readFileBytes(file, signal);
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    signal?.throwIfAborted();
    throw new PlaylistImportInputError("invalid_import_file");
  }
  signal?.throwIfAborted();
  return value;
}

export async function readPlaylistImportFile(file: Blob, signal?: AbortSignal): Promise<ImportDraftInput> {
  const value = await readImportJson(file, MAX_IMPORT_FILE_BYTES, signal);
  signal?.throwIfAborted();
  const result = exportSchema.safeParse(value);
  if (!result.success) throw new PlaylistImportInputError("invalid_import_file");
  return validatePlaylistImportInput({ name: result.data.playlist.name, source: "file", entries: result.data.tracks });
}

function parseSpotifyLibrary(value: unknown): SpotifyLibraryExport {
  const library = spotifyLibrarySchema.safeParse(value);
  if (!library.success) throw new PlaylistImportInputError("invalid_import_file");
  // Retain a slot for each unavailable row without retaining its raw data or Spotify ID.
  const slots = library.data.tracks.map((raw): ImportDraftEntry | null => {
    const song = spotifyLibraryTrackSchema.safeParse(raw);
    if (!song.success) return null;
    return { artist: song.data.artist, title: song.data.track, durationSeconds: null };
  });
  return { slots };
}

export async function readSpotifyExportFile(file: Blob, signal?: AbortSignal): Promise<SpotifyExportFile> {
  const value = await readImportJson(file, MAX_SPOTIFY_LIBRARY_FILE_BYTES, signal);
  signal?.throwIfAborted();
  const hasPlaylists = typeof value === "object" && value !== null && Object.hasOwn(value, "playlists");
  if (!Array.isArray(value) && !hasPlaylists) {
    return { kind: "library", collections: [parseSpotifyLibrary(value)] };
  }
  const result = spotifyPlaylistExportSchema.safeParse(value);
  if (!result.success || result.data.reduce((count, { items }) => count + items.length, 0) > MAX_SPOTIFY_LIBRARY_SLOTS) {
    throw new PlaylistImportInputError("invalid_import_file");
  }
  return {
    kind: "playlists",
    collections: result.data.map(({ name, items }) => ({
      name,
      slots: items.map((item): ImportDraftEntry | null => {
        const parsed = spotifyPlaylistTrackSchema.safeParse(item);
        return parsed.success
          ? { artist: parsed.data.track.artistName, title: parsed.data.track.trackName, durationSeconds: null }
          : null;
      }),
    })),
  };
}

export function previewSpotifyLibraryRange(library: SpotifyLibraryExport, offset: number) {
  const total = library.slots.length;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % MAX_IMPORT_ENTRIES !== 0 ||
      offset >= Math.max(1, total)) throw new PlaylistImportInputError("invalid_import_input");
  const end = Math.min(offset + MAX_IMPORT_ENTRIES, total);
  const entries = library.slots.slice(offset, end).filter((entry) => entry !== null);
  const title = library.name ?? "Любимые Spotify из файла";
  const suffix = total > MAX_IMPORT_ENTRIES ? ` (${offset + 1}–${end})` : "";
  const name = title.slice(0, MAX_IMPORT_NAME_LENGTH - suffix.length).replace(/[\uD800-\uDBFF]$/, "").trimEnd() + suffix;
  return {
    offset, end, total, unavailable: end - offset - entries.length,
    input: entries.length ? validatePlaylistImportInput({ name, source: "file", entries }) : null,
  };
}
