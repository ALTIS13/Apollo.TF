import { z } from "zod";

export const MAX_IMPORT_ENTRIES = 200;
export const MAX_IMPORT_PAYLOAD_BYTES = 90 * 1024;
export const MAX_IMPORT_FILE_BYTES = 128 * 1024;

const sourceSchema = z.enum(["file", "spotify_album", "spotify_playlist", "spotify_liked"]);
const requiredText = (max: number) => z.string().trim().min(1).max(max).refine((text) => !text.includes("\0"));
const nameSchema = requiredText(200);
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

export async function readPlaylistImportFile(file: Blob, signal?: AbortSignal): Promise<ImportDraftInput> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new PlaylistImportInputError("import_file_too_large");
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
  const result = exportSchema.safeParse(value);
  if (!result.success) throw new PlaylistImportInputError("invalid_import_file");
  return validatePlaylistImportInput({ name: result.data.playlist.name, source: "file", entries: result.data.tracks });
}
