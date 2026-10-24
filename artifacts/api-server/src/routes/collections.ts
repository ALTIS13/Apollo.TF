import { Buffer } from "node:buffer";

import { db, pool, type PoolClient } from "@workspace/db";
import { likedTracksTable } from "@workspace/db/schema";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { LikedOrderConflict, LikedTrackNotFound, moveLikedBefore } from "./liked-order.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const TRACK_ID_PATTERN = /^(?:yt|sc|bc|dz)_[A-Za-z0-9_-]+$/;
const CURSOR_PREFIX = "liked:";
const ORDER_CURSOR_PREFIX = "o:";
const DECIMAL_REVISION = /^(?:0|[1-9][0-9]*)$/;

const listQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
    cursor: z.string().trim().min(1).max(64).optional(),
    sort: z.literal("manual").optional(),
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
const moveLikedTrackSchema = z.object({
  trackId: trackIdSchema,
  beforeTrackId: trackIdSchema.nullable(),
  expectedRevision: z.string().regex(DECIMAL_REVISION).max(20),
}).strict().refine((value) => value.trackId !== value.beforeTrackId);

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
  readonly listManual: (input: {
    readonly accountId: string;
    readonly cursor: { readonly revision: string; readonly sortPosition: string } | null;
    readonly limit: number;
  }) => Promise<{
    readonly rows: readonly (LikedTrackRecord & { readonly sortPosition: string })[];
    readonly revision: string;
  }>;
  readonly lookup: (accountId: string, trackIds: readonly string[]) => Promise<readonly string[]>;
  readonly save: (input: SaveLikedTrackInput) => Promise<LikedTrackRecord>;
  readonly remove: (accountId: string, trackId: string) => Promise<void>;
  readonly move: (input: {
    readonly accountId: string;
    readonly trackId: string;
    readonly beforeTrackId: string | null;
    readonly expectedRevision: string;
  }) => Promise<{ readonly revision: string }>;
}

export interface CollectionRouteDependencies {
  readonly store: LikedCollectionStore;
}

type DatabaseClient = PoolClient;

interface RawLikedRow {
  readonly id: number;
  readonly track_id: string;
  readonly artist: string | null;
  readonly title: string | null;
  readonly thumbnail_url: string | null;
  readonly duration: string | null;
  readonly liked_at: Date;
  readonly sort_position: string;
}

function recordFromRaw(row: RawLikedRow) {
  return {
    storageId: row.id,
    trackId: row.track_id,
    artist: row.artist,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    durationSeconds: parseDuration(row.duration),
    likedAt: row.liked_at.toISOString(),
    sortPosition: row.sort_position,
  };
}

function legacyRecordFromRaw(row: RawLikedRow): LikedTrackRecord {
  const { sortPosition: _sortPosition, ...record } = recordFromRaw(row);
  return record;
}

async function withLockedCollection<T>(
  accountId: string,
  operation: (client: DatabaseClient, revision: string) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let transaction = false;
  try {
    await client.query("BEGIN");
    transaction = true;
    await client.query(
      `insert into public.liked_order_revisions (account_id)
       values ($1) on conflict (account_id) do nothing`,
      [accountId],
    );
    const state = await client.query<{ revision: string }>(
      `select revision::text as revision from public.liked_order_revisions
       where account_id = $1 for update`,
      [accountId],
    );
    const revision = state.rows[0]?.revision;
    if (revision === undefined) throw new Error("liked order state missing");
    const result = await operation(client, revision);
    await client.query("COMMIT");
    transaction = false;
    return result;
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function advanceRevision(client: DatabaseClient, accountId: string): Promise<string> {
  const state = await client.query<{ revision: string }>(
    `update public.liked_order_revisions set revision = revision + 1
     where account_id = $1 returning revision::text as revision`,
    [accountId],
  );
  const revision = state.rows[0]?.revision;
  if (revision === undefined) throw new Error("liked order revision missing");
  return revision;
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

function encodeOrderCursor(revision: string, sortPosition: string): string {
  return Buffer.from(`${ORDER_CURSOR_PREFIX}${revision}:${sortPosition}`, "utf8").toString("base64url");
}

function decodeOrderCursor(cursor: string): { revision: string; sortPosition: string } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const match = /^o:(0|[1-9][0-9]*):([1-9][0-9]*)$/.exec(decoded);
  if (!match || BigInt(match[1]!) > 9_223_372_036_854_775_807n ||
    BigInt(match[2]!) > 9_223_372_036_854_775_807n ||
    encodeOrderCursor(match[1]!, match[2]!) !== cursor) return null;
  return { revision: match[1]!, sortPosition: match[2]! };
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

  async listManual(input) {
    const client = await pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transaction = true;
      const state = await client.query<{ revision: string }>(
        `select revision::text as revision from public.liked_order_revisions
         where account_id = $1`,
        [input.accountId],
      );
      const rows = await client.query<RawLikedRow>(
        `select id, track_id, artist, title, thumbnail_url, duration, liked_at,
                sort_position::text as sort_position
         from public.liked_tracks
         where session_id = $1 and ($2::bigint is null or sort_position < $2::bigint)
         order by sort_position desc limit $3`,
        [input.accountId, input.cursor?.sortPosition ?? null, input.limit],
      );
      await client.query("COMMIT");
      transaction = false;
      return { rows: rows.rows.map(recordFromRaw), revision: state.rows[0]?.revision ?? "0" };
    } catch (error) {
      if (transaction) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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
    return withLockedCollection(input.accountId, async (client) => {
      const values = [input.accountId, input.trackId, input.artist, input.title,
        input.thumbnailUrl, input.durationSeconds === null ? null : String(input.durationSeconds)];
      const inserted = await client.query<RawLikedRow>(
        `insert into public.liked_tracks
           (session_id, track_id, artist, title, thumbnail_url, duration)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (session_id, track_id) do nothing
         returning id, track_id, artist, title, thumbnail_url, duration, liked_at,
                   sort_position::text as sort_position`,
        values,
      );
      if (inserted.rows[0]) {
        await advanceRevision(client, input.accountId);
        return legacyRecordFromRaw(inserted.rows[0]);
      }
      const updated = await client.query<RawLikedRow>(
        `update public.liked_tracks set artist = $3, title = $4,
           thumbnail_url = $5, duration = $6
         where session_id = $1 and track_id = $2
         returning id, track_id, artist, title, thumbnail_url, duration, liked_at,
                   sort_position::text as sort_position`,
        values,
      );
      if (!updated.rows[0]) throw new Error("liked track upsert returned no row");
      return legacyRecordFromRaw(updated.rows[0]);
    });
  },

  async remove(accountId, trackId) {
    await withLockedCollection(accountId, async (client) => {
      const deleted = await client.query(
        `delete from public.liked_tracks where session_id = $1 and track_id = $2
         returning id`,
        [accountId, trackId],
      );
      if (deleted.rowCount) await advanceRevision(client, accountId);
    });
  },

  async move(input) {
    return withLockedCollection(input.accountId, async (client, revision) => {
      if (revision !== input.expectedRevision) throw new LikedOrderConflict(revision);
      const ordered = await client.query<{
        id: number; track_id: string; sort_position: string;
      }>(
        `select id, track_id, sort_position::text as sort_position
         from public.liked_tracks where session_id = $1 order by sort_position desc`,
        [input.accountId],
      );
      const changes = moveLikedBefore(
        ordered.rows.map((row) => ({
          storageId: row.id,
          trackId: row.track_id,
          sortPosition: row.sort_position,
        })),
        input.trackId,
        input.beforeTrackId,
      );
      if (changes.length === 0) return { revision };
      for (const change of changes) {
        await client.query(
          `update public.liked_tracks set sort_position = $3::bigint
           where session_id = $1 and id = $2`,
          [input.accountId, change.storageId, change.sortPosition],
        );
      }
      return { revision: await advanceRevision(client, input.accountId) };
    });
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
    if (query.data.sort === "manual") {
      const cursor = query.data.cursor === undefined
        ? null : decodeOrderCursor(query.data.cursor);
      if (query.data.cursor !== undefined && cursor === null) {
        badRequest(response);
        return;
      }
      const result = await store.listManual({
        accountId: request.tfPrincipal!.accountId,
        cursor,
        limit: query.data.limit + 1,
      });
      if (cursor !== null && result.revision !== cursor.revision) {
        response.status(409).json({ error: "liked_order_conflict", revision: result.revision });
        return;
      }
      const page = result.rows.slice(0, query.data.limit);
      response.status(200).json({
        items: page.map(publicTrack),
        nextCursor: result.rows.length > query.data.limit && page.length > 0
          ? encodeOrderCursor(result.revision, page[page.length - 1]!.sortPosition)
          : null,
        revision: result.revision,
      });
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

  router.patch("/collections/liked/order", async (request, response) => {
    const body = moveLikedTrackSchema.safeParse(request.body);
    if (!body.success) {
      badRequest(response);
      return;
    }
    try {
      const result = await store.move({
        accountId: request.tfPrincipal!.accountId,
        ...body.data,
      });
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof LikedOrderConflict) {
        response.status(409).json({ error: error.code, revision: error.revision });
      } else if (error instanceof LikedTrackNotFound) {
        response.status(404).json({ error: error.code });
      } else {
        throw error;
      }
    }
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
