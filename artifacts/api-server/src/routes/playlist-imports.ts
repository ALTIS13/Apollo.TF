import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";

import {
  defaultPlaylistImportStore,
  type PlaylistImportStore,
} from "../lib/playlist-import-store.js";
import { defaultPlaylistImportSelectionStore, type PlaylistImportSelectionStore } from "../lib/playlist-import-selection-store.js";
import { defaultRecordingCatalog, type RecordingCatalog } from "../lib/recording-catalog.js";

const COLLECTION_PATH = "/collections/imports";
const DETAIL_PATH = `${COLLECTION_PATH}/:importId` as const;
const ENTRY_PATH = `${DETAIL_PATH}/entries/:position` as const;
const IMPORT_SUBPATH_PATTERN = /^\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:\/entries\/(?:0|[1-9][0-9]{0,2})\/(?:candidates|selection))?$/;
const MAX_NORMALIZED_BYTES = 90 * 1024;
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
const recordingSelectionSchema = z.object({
  candidateId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  evidenceRevision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export interface PlaylistImportRouteDependencies {
  readonly store: PlaylistImportStore;
  readonly catalog: RecordingCatalog;
  readonly selections: PlaylistImportSelectionStore;
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
  const selections = dependencies.selections ?? defaultPlaylistImportSelectionStore;
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

  async function lookupEntry(request: Request<{ importId: string; position: string }>, response: Response) {
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

  async function readCatalog(entry: Parameters<RecordingCatalog["candidates"]>[0], response: Response) {
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
    const selection = await selections.get(target.accountId, target.importId, target.position);
    response.json({ ...result, selection });
  });

  router.put(`${ENTRY_PATH}/selection`, async (request, response) => {
    const input = recordingSelectionSchema.safeParse(request.body);
    if (!input.success) return badRequest(response);
    const target = await lookupEntry(request, response);
    if (!target) return;
    const result = await readCatalog(target.entry, response);
    if (!result) return;
    const candidate = result.candidates.find(({ id }) => id === input.data.candidateId);
    if (result.status !== "ready" || !candidate || candidate.evidenceRevision !== input.data.evidenceRevision) {
      response.status(409).json({ error: "recording_selection_changed" });
      return;
    }
    if (candidate.access !== "full") {
      response.status(409).json({ error: "recording_not_full" });
      return;
    }
    const selection = await selections.put(target.accountId, target.importId, target.position, input.data, target.entry);
    if (!selection) {
      response.status(404).json({ error: "import_entry_not_found" });
      return;
    }
    response.json({ selection });
  });

  return router;
}
