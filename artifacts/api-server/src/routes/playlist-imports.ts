import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";

import {
  defaultPlaylistImportStore,
  type PlaylistImportStore,
} from "../lib/playlist-import-store.js";
import {
  defaultPlaylistImportSelectionStore,
  type PlaylistImportSelectionStore,
} from "../lib/playlist-import-selection-store.js";
import {
  defaultRecordingCatalog,
  type RecordingCatalog,
} from "../lib/recording-catalog.js";
import {
  defaultRecordingMedia,
  type RecordingMedia,
  type RecordingMediaBinding,
} from "../lib/recording-media.js";

const COLLECTION_PATH = "/collections/imports";
const DETAIL_PATH = `${COLLECTION_PATH}/:importId` as const;
const ENTRY_PATH = `${DETAIL_PATH}/entries/:position` as const;
const IMPORT_SUBPATH_PATTERN =
  /^\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:\/entries\/(?:0|[1-9][0-9]{0,2})\/(?:candidates|selection|(?:audio|file)\/[a-f0-9]{64}))?$/;
const MAX_NORMALIZED_BYTES = 90 * 1024;
const MEDIA_RESPONSE_TIMEOUT_MS = 30_000;
// Unicode mode treats valid surrogate pairs as one code point.
const INVALID_METADATA_CHARACTER = /[\u0000\uD800-\uDFFF]/u;

const metadataText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !INVALID_METADATA_CHARACTER.test(value));
const draftSchema = z
  .object({
    name: metadataText(200),
    source: z.enum([
      "file",
      "spotify_album",
      "spotify_playlist",
      "spotify_liked",
    ]),
    entries: z
      .array(
        z
          .object({
            artist: metadataText(300),
            title: metadataText(500),
            durationSeconds: z.number().int().min(1).max(86_400).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
const recordingSelectionSchema = z
  .object({
    candidateId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    evidenceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export interface PlaylistImportRouteDependencies {
  readonly store: PlaylistImportStore;
  readonly catalog: RecordingCatalog;
  readonly selections: PlaylistImportSelectionStore;
  readonly media: RecordingMedia;
}

type MediaParams = { importId: string; position: string; revision: string };

function singleByteRange(
  header: string | undefined,
  length: number,
): { start: number; end: number } | null | undefined {
  if (header === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!match) return null;
  const [, first, last] = match;
  if (first === "") {
    const suffix = Number(last);
    return suffix > 0
      ? { start: Math.max(length - suffix, 0), end: length - 1 }
      : null;
  }
  const start = Number(first);
  const end = last === "" ? length - 1 : Math.min(Number(last), length - 1);
  return start <= end && start < length ? { start, end } : null;
}

function mediaUnavailable(response: Response): void {
  response.status(503).json({ error: "recording_media_unavailable" });
}

async function sendRecordingMedia(
  media: RecordingMedia,
  binding: RecordingMediaBinding,
  rangeHeader: string | undefined,
  filename: string | null,
  response: Response,
): Promise<void> {
  if (response.destroyed) return;
  const abort = new AbortController();
  let opened: Awaited<ReturnType<RecordingMedia["open"]>> | undefined;
  const timeout = setTimeout(() => {
    disconnect();
    response.destroy();
  }, MEDIA_RESPONSE_TIMEOUT_MS);
  timeout.unref();
  function cleanup() {
    clearTimeout(timeout);
    response.off("finish", cleanup);
    response.off("close", disconnect);
    response.off("error", disconnect);
    const current = opened;
    opened = undefined;
    current?.release();
  }
  function disconnect() {
    abort.abort();
    cleanup();
  }
  response.once("finish", cleanup);
  response.once("close", disconnect);
  response.once("error", disconnect);
  try {
    opened = await media.open(binding, abort.signal);
    if (abort.signal.aborted || response.destroyed) {
      cleanup();
      return;
    }
    const { bytes, mimeType } = opened;
    if (bytes.length === 0) {
      cleanup();
      mediaUnavailable(response);
      return;
    }
    const range = singleByteRange(rangeHeader, bytes.length);
    response.set("Accept-Ranges", "bytes");
    if (range === null) {
      response
        .status(416)
        .set({
          "Content-Range": `bytes */${bytes.length}`,
          "Content-Length": "0",
        })
        .end();
      return;
    }
    const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    if (range)
      response.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${bytes.length}`,
      );
    if (filename !== null)
      response.set("Content-Disposition", `attachment; filename="${filename}"`);
    response
      .status(range ? 206 : 200)
      .set({
        "Content-Type": mimeType,
        "Content-Length": String(body.length),
        "X-Content-Type-Options": "nosniff",
      })
      .end(body);
  } catch {
    cleanup();
    if (abort.signal.aborted || response.destroyed) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    for (const header of [
      "Accept-Ranges",
      "Content-Range",
      "Content-Disposition",
      "Content-Type",
      "Content-Length",
    ]) {
      response.removeHeader(header);
    }
    mediaUnavailable(response);
  }
}

function badRequest(response: Response): void {
  response.status(400).json({ error: "bad_request" });
}

function notFound(response: Response): void {
  response.status(404).json({ error: "import_not_found" });
}

export function createPlaylistImportsRouter(
  dependencies: Partial<PlaylistImportRouteDependencies> = {},
): IRouter {
  const store = dependencies.store ?? defaultPlaylistImportStore;
  const catalog = dependencies.catalog ?? defaultRecordingCatalog;
  const selections =
    dependencies.selections ?? defaultPlaylistImportSelectionStore;
  const media = dependencies.media ?? defaultRecordingMedia;
  const router = Router();

  router.use(COLLECTION_PATH, (request, response, next) => {
    // Validate the raw path before Express decodes the route parameter.
    if (
      Object.keys(request.query).length > 0 ||
      (request.path !== "/" && !IMPORT_SUBPATH_PATTERN.test(request.path))
    )
      return badRequest(response);
    next();
  });

  router.get(COLLECTION_PATH, async (request, response) => {
    response.json({
      imports: await store.list(request.tfPrincipal!.accountId),
    });
  });

  router.get(DETAIL_PATH, async (request, response) => {
    const draft = await store.get(
      request.tfPrincipal!.accountId,
      request.params.importId,
    );
    if (draft === null) return notFound(response);
    response.json({ draft });
  });

  router.put(DETAIL_PATH, async (request, response) => {
    const body = draftSchema.safeParse(request.body);
    if (!body.success) return badRequest(response);
    if (
      Buffer.byteLength(JSON.stringify(body.data), "utf8") >
      MAX_NORMALIZED_BYTES
    ) {
      response.status(413).json({ error: "request_too_large" });
      return;
    }
    const result = await store.put(
      request.tfPrincipal!.accountId,
      request.params.importId,
      body.data,
    );
    if (result.status === "conflict" || result.status === "limit") {
      response.status(409).json({
        error:
          result.status === "conflict" ? "import_conflict" : "import_limit",
      });
      return;
    }
    response
      .status(result.status === "created" ? 201 : 200)
      .json({ draft: result.draft });
  });

  router.delete(DETAIL_PATH, async (request, response) => {
    const removed = await store.remove(
      request.tfPrincipal!.accountId,
      request.params.importId,
    );
    if (!removed) return notFound(response);
    response.status(204).end();
  });

  async function lookupEntry(
    request: Request<{ importId: string; position: string }>,
    response: Response,
  ) {
    const { accountId, entitlements } = request.tfPrincipal!;
    if (!entitlements.includes("tf.search")) {
      response.status(403).json({ error: "module_access_denied" });
      return null;
    }
    const { importId } = request.params;
    const position = Number(request.params.position);
    if (!Number.isInteger(position) || position < 0 || position >= 200) {
      badRequest(response);
      return null;
    }
    const draft = await store.get(accountId, importId);
    const entry = draft?.entries[position];
    if (!entry) {
      response.status(404).json({ error: "import_entry_not_found" });
      return null;
    }
    return { accountId, importId, position, entry };
  }

  async function readCatalog(
    entry: Parameters<RecordingCatalog["candidates"]>[0],
    response: Response,
  ) {
    try {
      return await catalog.candidates(entry);
    } catch {
      response.status(503).json({ error: "recording_catalog_unavailable" });
      return null;
    }
  }

  router.get(`${ENTRY_PATH}/candidates`, async (request, response) => {
    const target = await lookupEntry(request, response);
    if (!target) return;
    const result = await readCatalog(target.entry, response);
    if (!result) return;
    const selection = await selections.get(
      target.accountId,
      target.importId,
      target.position,
    );
    response.json({ ...result, selection });
  });

  router.put(`${ENTRY_PATH}/selection`, async (request, response) => {
    const input = recordingSelectionSchema.safeParse(request.body);
    if (!input.success) return badRequest(response);
    const target = await lookupEntry(request, response);
    if (!target) return;
    const result = await readCatalog(target.entry, response);
    if (!result) return;
    const candidate = result.candidates.find(
      ({ id }) => id === input.data.candidateId,
    );
    if (
      result.status !== "ready" ||
      !candidate ||
      candidate.evidenceRevision !== input.data.evidenceRevision
    ) {
      response.status(409).json({ error: "recording_selection_changed" });
      return;
    }
    if (candidate.access !== "full") {
      response.status(409).json({ error: "recording_not_full" });
      return;
    }
    const selection = await selections.put(
      target.accountId,
      target.importId,
      target.position,
      input.data,
      target.entry,
    );
    if (!selection) {
      response.status(404).json({ error: "import_entry_not_found" });
      return;
    }
    response.json({ selection });
  });

  function recordingMediaRoute(operation: "audio" | "file") {
    return async (request: Request<MediaParams>, response: Response) => {
      let target: Awaited<ReturnType<typeof lookupEntry>>;
      let saved: Awaited<ReturnType<PlaylistImportSelectionStore["get"]>>;
      try {
        target = await lookupEntry(request, response);
        if (!target) return;
        saved = await selections.get(
          target.accountId,
          target.importId,
          target.position,
        );
      } catch {
        return mediaUnavailable(response);
      }
      if (!saved) {
        response.status(404).json({ error: "recording_selection_not_found" });
        return;
      }
      const selected = recordingSelectionSchema.safeParse({
        candidateId: saved.candidateId,
        evidenceRevision: saved.evidenceRevision,
      });
      if (
        !selected.success ||
        selected.data.evidenceRevision !== request.params.revision
      ) {
        response.status(409).json({ error: "recording_selection_changed" });
        return;
      }

      let resolved:
        | Awaited<ReturnType<NonNullable<RecordingCatalog["mediaBinding"]>>>
        | undefined;
      try {
        resolved = await catalog.mediaBinding?.(
          target.entry,
          selected.data,
          operation,
        );
      } catch {
        response.status(503).json({ error: "recording_catalog_unavailable" });
        return;
      }
      if (
        resolved?.status === "stale" ||
        resolved?.status === "not_permitted"
      ) {
        response.status(409).json({
          error:
            resolved.status === "stale"
              ? "recording_selection_changed"
              : "recording_media_not_permitted",
        });
        return;
      }
      if (resolved?.status !== "ready") {
        response.status(503).json({ error: "recording_catalog_unavailable" });
        return;
      }
      const filename =
        operation === "file"
          ? `${selected.data.candidateId}.${resolved.binding.format}`
          : null;
      await sendRecordingMedia(
        media,
        resolved.binding,
        request.get("range"),
        filename,
        response,
      );
    };
  }

  router.get(`${ENTRY_PATH}/audio/:revision`, recordingMediaRoute("audio"));
  router.get(`${ENTRY_PATH}/file/:revision`, recordingMediaRoute("file"));

  return router;
}
