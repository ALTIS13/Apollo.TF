import { Router, type IRouter, type Response } from "express";
import { z } from "zod";

import {
  defaultPlaylistImportStore,
  type PlaylistImportStore,
} from "../lib/playlist-import-store.js";

const COLLECTION_PATH = "/collections/imports";
const DETAIL_PATH = `${COLLECTION_PATH}/:importId` as const;
const IMPORT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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

export interface PlaylistImportRouteDependencies {
  readonly store: PlaylistImportStore;
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
  const router = Router();

  router.use(COLLECTION_PATH, (request, response, next) => {
    // Validate the raw path before Express decodes the route parameter.
    if (
      Object.keys(request.query).length > 0 ||
      (request.path !== "/" && !IMPORT_ID_PATTERN.test(request.path.slice(1)))
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

  return router;
}
