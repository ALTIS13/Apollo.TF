import { Buffer } from "node:buffer";

import { db } from "@workspace/db";
import { likedTracksTable } from "@workspace/db/schema";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const TRACK_ID_PATTERN = /^(?:yt|sc|bc|dz)_[A-Za-z0-9_-]+$/;
const CURSOR_PREFIX = "liked:";

const listQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
    cursor: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const trackIdSchema = z
  .string()
  .trim()
  .min(4)
  .max(4_096)
  .regex(TRACK_ID_PATTERN);
const saveLikedTrackSchema = z
  .object({
    artist: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(500),
    thumbnailUrl: z.string().trim().url().max(2_048).nullable().optional(),
    durationSeconds: z.number().int().min(1).max(86_400).nullable().optional(),
  })
  .strict();
const lookupLikedTracksSchema = z
  .object({
    trackIds: z.array(trackIdSchema).min(1).max(40).refine(
      (trackIds) => new Set(trackIds).size === trackIds.length &&
        trackIds.reduce((size, trackId) => size + trackId.length, 0) <= 16_384,
    ),
  })
  .strict();

export interface LikedTrackRecord {
  readonly storageId: number;
  readonly trackId: string;
  readonly artist: string | null;
  readonly title: string | null;
  readonly thumbnailUrl: string | null;
  readonly durationSeconds: number | null;
  readonly likedAt: string;
}

export interface SaveLikedTrackInput {
  readonly accountId: string;
  readonly trackId: string;
  readonly artist: string;
  readonly title: string;
  readonly thumbnailUrl: string | null;
  readonly durationSeconds: number | null;
}

export interface LikedCollectionStore {
  readonly list: (input: {
    readonly accountId: string;
    readonly cursorId: number | null;
    readonly limit: number;
  }) => Promise<readonly LikedTrackRecord[]>;
  readonly lookup: (accountId: string, trackIds: readonly string[]) => Promise<readonly string[]>;
  readonly save: (input: SaveLikedTrackInput) => Promise<LikedTrackRecord>;
  readonly remove: (accountId: string, trackId: string) => Promise<void>;
}

export interface CollectionRouteDependencies {
  readonly store: LikedCollectionStore;
}

function parseDuration(value: string | null): number | null {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 86_400 ? parsed : null;
}

function recordFromRow(
  row: typeof likedTracksTable.$inferSelect,
): LikedTrackRecord {
  return {
    storageId: row.id,
    trackId: row.trackId,
    artist: row.artist,
    title: row.title,
    thumbnailUrl: row.thumbnailUrl,
    durationSeconds: parseDuration(row.duration),
    likedAt: row.likedAt.toISOString(),
  };
}

export function encodeLikedCursor(storageId: number): string {
  if (!Number.isSafeInteger(storageId) || storageId <= 0) {
    throw new Error("invalid liked collection cursor id");
  }
  return Buffer.from(`${CURSOR_PREFIX}${storageId}`, "utf8").toString(
    "base64url",
  );
}

function decodeLikedCursor(cursor: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!decoded.startsWith(CURSOR_PREFIX)) return null;
  const rawId = decoded.slice(CURSOR_PREFIX.length);
  if (!/^[1-9][0-9]*$/.test(rawId)) return null;
  const storageId = Number(rawId);
  if (!Number.isSafeInteger(storageId)) return null;
  return encodeLikedCursor(storageId) === cursor ? storageId : null;
}

export const defaultLikedCollectionStore: LikedCollectionStore = {
  async list(input) {
    const owner = eq(likedTracksTable.sessionId, input.accountId);
    const rows = await db
      .select()
      .from(likedTracksTable)
      .where(
        input.cursorId === null
          ? owner
          : and(owner, lt(likedTracksTable.id, input.cursorId)),
      )
      .orderBy(desc(likedTracksTable.id))
      .limit(input.limit);
    return rows.map(recordFromRow);
  },

  async lookup(accountId, trackIds) {
    const rows = await db
      .select({ trackId: likedTracksTable.trackId })
      .from(likedTracksTable)
      .where(and(
        eq(likedTracksTable.sessionId, accountId),
        inArray(likedTracksTable.trackId, [...trackIds]),
      ));
    return rows.map((row) => row.trackId);
  },

  async save(input) {
    const [row] = await db
      .insert(likedTracksTable)
      .values({
        sessionId: input.accountId,
        trackId: input.trackId,
        artist: input.artist,
        title: input.title,
        thumbnailUrl: input.thumbnailUrl,
        duration:
          input.durationSeconds === null ? null : String(input.durationSeconds),
      })
      .onConflictDoUpdate({
        target: [likedTracksTable.sessionId, likedTracksTable.trackId],
        set: {
          artist: input.artist,
          title: input.title,
          thumbnailUrl: input.thumbnailUrl,
          duration:
            input.durationSeconds === null
              ? null
              : String(input.durationSeconds),
        },
      })
      .returning();
    if (row === undefined)
      throw new Error("liked track upsert returned no row");
    return recordFromRow(row);
  },

  async remove(accountId, trackId) {
    await db
      .delete(likedTracksTable)
      .where(
        and(
          eq(likedTracksTable.sessionId, accountId),
          eq(likedTracksTable.trackId, trackId),
        ),
      );
  },
};

function publicTrack(record: LikedTrackRecord) {
  return {
    trackId: record.trackId,
    artist: record.artist,
    title: record.title,
    thumbnailUrl: record.thumbnailUrl,
    durationSeconds: record.durationSeconds,
    likedAt: record.likedAt,
  };
}

function badRequest(response: Response): void {
  response.status(400).json({ error: "bad_request" });
}

export function createCollectionsRouter(
  dependencies: Partial<CollectionRouteDependencies> = {},
): IRouter {
  const router: IRouter = Router();
  const store = dependencies.store ?? defaultLikedCollectionStore;

  router.get("/collections/liked", async (request, response) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      badRequest(response);
      return;
    }
    const cursorId =
      query.data.cursor === undefined
        ? null
        : decodeLikedCursor(query.data.cursor);
    if (query.data.cursor !== undefined && cursorId === null) {
      badRequest(response);
      return;
    }
    const rows = await store.list({
      accountId: request.tfPrincipal!.accountId,
      cursorId,
      limit: query.data.limit + 1,
    });
    const hasNextPage = rows.length > query.data.limit;
    const page = rows.slice(0, query.data.limit);
    response.status(200).json({
      items: page.map(publicTrack),
      nextCursor:
        hasNextPage && page.length > 0
          ? encodeLikedCursor(page[page.length - 1]!.storageId)
          : null,
    });
  });

  router.post("/collections/liked/lookup", async (request, response) => {
    const body = lookupLikedTracksSchema.safeParse(request.body);
    if (!body.success) {
      badRequest(response);
      return;
    }
    const found = new Set(await store.lookup(
      request.tfPrincipal!.accountId,
      body.data.trackIds,
    ));
    response.status(200).json({
      likedTrackIds: body.data.trackIds.filter((trackId) => found.has(trackId)),
    });
  });

  router.put("/collections/liked/:trackId", async (request, response) => {
    const trackId = trackIdSchema.safeParse(request.params.trackId);
    const body = saveLikedTrackSchema.safeParse(request.body);
    if (!trackId.success || !body.success) {
      badRequest(response);
      return;
    }
    const item = await store.save({
      accountId: request.tfPrincipal!.accountId,
      trackId: trackId.data,
      artist: body.data.artist,
      title: body.data.title,
      thumbnailUrl: body.data.thumbnailUrl ?? null,
      durationSeconds: body.data.durationSeconds ?? null,
    });
    response.status(200).json({ item: publicTrack(item) });
  });

  router.delete("/collections/liked/:trackId", async (request, response) => {
    const trackId = trackIdSchema.safeParse(request.params.trackId);
    if (!trackId.success) {
      badRequest(response);
      return;
    }
    await store.remove(request.tfPrincipal!.accountId, trackId.data);
    response.status(204).end();
  });

  return router;
}

export default createCollectionsRouter();
