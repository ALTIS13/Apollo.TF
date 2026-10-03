import { db } from "@workspace/db";
import { playlistsTable, playlistTracksTable } from "@workspace/db/schema";
import { and, asc, count, eq, max, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";

const playlistIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .transform(Number)
  .pipe(z.number().int().max(2_147_483_647));
const trackIdSchema = z
  .string()
  .min(4)
  .max(4_096)
  .regex(/^(?:yt|sc|bc|dz)_[A-Za-z0-9_-]+$/);
const createSchema = z
  .object({ name: z.string().trim().min(1).max(200) })
  .strict();
const addTrackSchema = z
  .object({
    trackId: trackIdSchema,
    artist: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(500),
    thumbnailUrl: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => /^https?:\/\//.test(value))
      .nullable()
      .optional(),
    durationSeconds: z.number().int().min(1).max(86_400).nullable().optional(),
  })
  .strict();
const reorderSchema = z
  .object({
    trackIds: z
      .array(trackIdSchema)
      .max(500)
      .refine(
        (trackIds) =>
          new Set(trackIds).size === trackIds.length &&
          trackIds.reduce((length, trackId) => length + trackId.length, 0) <=
            50_000,
      ),
  })
  .strict();

export interface PlaylistRecord {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly trackCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlaylistTrackRecord {
  readonly trackId: string;
  readonly artist: string;
  readonly title: string;
  readonly thumbnailUrl: string | null;
  readonly durationSeconds: number | null;
  readonly position: number;
  readonly addedAt: string;
}

export interface AddPlaylistTrackInput {
  readonly trackId: string;
  readonly artist: string;
  readonly title: string;
  readonly thumbnailUrl: string | null;
  readonly durationSeconds: number | null;
}

export interface PlaylistDetailRecord {
  readonly playlist: PlaylistRecord;
  readonly tracks: readonly PlaylistTrackRecord[];
}

export function isExactPlaylistPermutation(
  existingTrackIds: readonly string[],
  requestedTrackIds: readonly string[],
): boolean {
  if (existingTrackIds.length !== requestedTrackIds.length) return false;
  const existing = new Set(existingTrackIds);
  const requested = new Set(requestedTrackIds);
  return (
    existing.size === existingTrackIds.length &&
    requested.size === requestedTrackIds.length &&
    existingTrackIds.every((trackId) => requested.has(trackId))
  );
}

export interface PlaylistCollectionStore {
  readonly list: (accountId: string) => Promise<readonly PlaylistRecord[]>;
  readonly create: (accountId: string, name: string) => Promise<PlaylistRecord>;
  readonly get: (
    accountId: string,
    playlistId: number,
  ) => Promise<PlaylistDetailRecord | null>;
  readonly addTrack: (
    accountId: string,
    playlistId: number,
    input: AddPlaylistTrackInput,
  ) => Promise<{
    readonly track: PlaylistTrackRecord;
    readonly added: boolean;
  } | null>;
  readonly removeTrack: (
    accountId: string,
    playlistId: number,
    trackId: string,
  ) => Promise<boolean>;
  readonly remove: (accountId: string, playlistId: number) => Promise<boolean>;
  readonly reorder: (
    accountId: string,
    playlistId: number,
    trackIds: readonly string[],
  ) => Promise<PlaylistDetailRecord | "invalid_order" | null>;
}

export interface PlaylistRouteDependencies {
  readonly store: PlaylistCollectionStore;
}

function playlistFromRow(
  row: typeof playlistsTable.$inferSelect,
  trackCount: number,
): PlaylistRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trackCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function durationFromRow(duration: string | null): number | null {
  if (duration === null || !/^[1-9][0-9]*$/.test(duration)) return null;
  const number = Number(duration);
  return Number.isSafeInteger(number) && number <= 86_400 ? number : null;
}

function trackFromRow(
  row: typeof playlistTracksTable.$inferSelect,
): PlaylistTrackRecord {
  return {
    trackId: row.trackId,
    artist: row.artist ?? "",
    title: row.title ?? "",
    thumbnailUrl: row.thumbnailUrl,
    durationSeconds: durationFromRow(row.duration),
    position: row.position,
    addedAt: row.addedAt.toISOString(),
  };
}

async function ownedPlaylist(
  executor: Pick<typeof db, "select">,
  accountId: string,
  playlistId: number,
) {
  const [row] = await executor
    .select()
    .from(playlistsTable)
    .where(
      and(
        eq(playlistsTable.id, playlistId),
        eq(playlistsTable.sessionId, accountId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const defaultPlaylistCollectionStore: PlaylistCollectionStore = {
  async list(accountId) {
    const rows = await db
      .select({
        playlist: playlistsTable,
        trackCount: sql<number>`count(${playlistTracksTable.id})::int`,
      })
      .from(playlistsTable)
      .leftJoin(
        playlistTracksTable,
        eq(playlistTracksTable.playlistId, playlistsTable.id),
      )
      .where(eq(playlistsTable.sessionId, accountId))
      .groupBy(playlistsTable.id)
      .orderBy(asc(playlistsTable.id));
    return rows.map(({ playlist, trackCount }) =>
      playlistFromRow(playlist, trackCount),
    );
  },

  async create(accountId, name) {
    const [row] = await db
      .insert(playlistsTable)
      .values({ sessionId: accountId, name })
      .returning();
    if (!row) throw new Error("playlist insert returned no row");
    return playlistFromRow(row, 0);
  },

  async get(accountId, playlistId) {
    const playlist = await ownedPlaylist(db, accountId, playlistId);
    if (!playlist) return null;
    const tracks = await db
      .select()
      .from(playlistTracksTable)
      .where(eq(playlistTracksTable.playlistId, playlistId))
      .orderBy(asc(playlistTracksTable.position), asc(playlistTracksTable.id));
    return {
      playlist: playlistFromRow(playlist, tracks.length),
      tracks: tracks.map(trackFromRow),
    };
  },

  async addTrack(accountId, playlistId, input) {
    return db.transaction(async (tx) => {
      // Serialize admissions and removals because the existing table has no unique track constraint.
      await tx.execute(sql`select pg_advisory_xact_lock(22023, ${playlistId})`);
      const playlist = await ownedPlaylist(tx, accountId, playlistId);
      if (!playlist) return null;
      const [existing] = await tx
        .select()
        .from(playlistTracksTable)
        .where(
          and(
            eq(playlistTracksTable.playlistId, playlistId),
            eq(playlistTracksTable.trackId, input.trackId),
          ),
        )
        .orderBy(asc(playlistTracksTable.id))
        .limit(1);
      if (existing) return { track: trackFromRow(existing), added: false };
      const [last] = await tx
        .select({ position: max(playlistTracksTable.position) })
        .from(playlistTracksTable)
        .where(eq(playlistTracksTable.playlistId, playlistId));
      const position = (last?.position ?? -1) + 1;
      if (position > 2_147_483_647)
        throw new Error("playlist position exhausted");
      const [row] = await tx
        .insert(playlistTracksTable)
        .values({
          playlistId,
          trackId: input.trackId,
          artist: input.artist,
          title: input.title,
          thumbnailUrl: input.thumbnailUrl,
          duration:
            input.durationSeconds === null
              ? null
              : String(input.durationSeconds),
          position,
        })
        .returning();
      if (!row) throw new Error("playlist track insert returned no row");
      await tx
        .update(playlistsTable)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(playlistsTable.id, playlistId),
            eq(playlistsTable.sessionId, accountId),
          ),
        );
      return { track: trackFromRow(row), added: true };
    });
  },

  async removeTrack(accountId, playlistId, trackId) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(22023, ${playlistId})`);
      if (!(await ownedPlaylist(tx, accountId, playlistId))) return false;
      const removed = await tx
        .delete(playlistTracksTable)
        .where(
          and(
            eq(playlistTracksTable.playlistId, playlistId),
            eq(playlistTracksTable.trackId, trackId),
          ),
        )
        .returning({ id: playlistTracksTable.id });
      if (removed.length > 0)
        await tx
          .update(playlistsTable)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(playlistsTable.id, playlistId),
              eq(playlistsTable.sessionId, accountId),
            ),
          );
      return true;
    });
  },

  async remove(accountId, playlistId) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(22023, ${playlistId})`);
      if (!(await ownedPlaylist(tx, accountId, playlistId))) return false;
      await tx
        .delete(playlistTracksTable)
        .where(eq(playlistTracksTable.playlistId, playlistId));
      await tx
        .delete(playlistsTable)
        .where(
          and(
            eq(playlistsTable.id, playlistId),
            eq(playlistsTable.sessionId, accountId),
          ),
        );
      return true;
    });
  },

  async reorder(accountId, playlistId, trackIds) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(22023, ${playlistId})`);
      const playlist = await ownedPlaylist(tx, accountId, playlistId);
      if (!playlist) return null;
      const rows = await tx
        .select()
        .from(playlistTracksTable)
        .where(eq(playlistTracksTable.playlistId, playlistId))
        .orderBy(
          asc(playlistTracksTable.position),
          asc(playlistTracksTable.id),
        );
      if (
        !isExactPlaylistPermutation(
          rows.map((row) => row.trackId),
          trackIds,
        )
      ) {
        return "invalid_order";
      }

      const byTrackId = new Map(rows.map((row) => [row.trackId, row]));
      let changed = false;
      const ordered = [] as PlaylistTrackRecord[];
      for (const [position, trackId] of trackIds.entries()) {
        const row = byTrackId.get(trackId)!;
        if (row.position !== position) {
          await tx
            .update(playlistTracksTable)
            .set({ position })
            .where(
              and(
                eq(playlistTracksTable.id, row.id),
                eq(playlistTracksTable.playlistId, playlistId),
              ),
            );
          changed = true;
        }
        ordered.push(trackFromRow({ ...row, position }));
      }

      let currentPlaylist = playlist;
      if (changed) {
        const [updated] = await tx
          .update(playlistsTable)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(playlistsTable.id, playlistId),
              eq(playlistsTable.sessionId, accountId),
            ),
          )
          .returning();
        if (!updated) throw new Error("playlist reorder returned no row");
        currentPlaylist = updated;
      }
      return {
        playlist: playlistFromRow(currentPlaylist, ordered.length),
        tracks: ordered,
      };
    });
  },
};

function badRequest(response: Response): void {
  response.status(400).json({ error: "bad_request" });
}

function notFound(response: Response): void {
  response.status(404).json({ error: "playlist_not_found" });
}

export function createPlaylistsRouter(
  dependencies: Partial<PlaylistRouteDependencies> = {},
): IRouter {
  const router: IRouter = Router();
  const store = dependencies.store ?? defaultPlaylistCollectionStore;

  router.get("/collections/playlists", async (request, response) => {
    if (Object.keys(request.query).length > 0) return badRequest(response);
    response
      .status(200)
      .json({ playlists: await store.list(request.tfPrincipal!.accountId) });
  });

  router.post("/collections/playlists", async (request, response) => {
    const body = createSchema.safeParse(request.body);
    if (!body.success) return badRequest(response);
    response.status(201).json({
      playlist: await store.create(
        request.tfPrincipal!.accountId,
        body.data.name,
      ),
    });
  });

  router.get(
    "/collections/playlists/:playlistId",
    async (request, response) => {
      const id = playlistIdSchema.safeParse(request.params.playlistId);
      if (!id.success) return badRequest(response);
      const detail = await store.get(request.tfPrincipal!.accountId, id.data);
      if (!detail) return notFound(response);
      response.status(200).json(detail);
    },
  );

  router.post(
    "/collections/playlists/:playlistId/tracks",
    async (request, response) => {
      const id = playlistIdSchema.safeParse(request.params.playlistId);
      const body = addTrackSchema.safeParse(request.body);
      if (!id.success || !body.success) return badRequest(response);
      const result = await store.addTrack(
        request.tfPrincipal!.accountId,
        id.data,
        {
          ...body.data,
          thumbnailUrl: body.data.thumbnailUrl ?? null,
          durationSeconds: body.data.durationSeconds ?? null,
        },
      );
      if (!result) return notFound(response);
      response.status(200).json(result);
    },
  );

  router.patch(
    "/collections/playlists/:playlistId/tracks/order",
    async (request, response) => {
      const id = playlistIdSchema.safeParse(request.params.playlistId);
      const body = reorderSchema.safeParse(request.body);
      if (!id.success || !body.success) return badRequest(response);
      const result = await store.reorder(
        request.tfPrincipal!.accountId,
        id.data,
        body.data.trackIds,
      );
      if (result === null) return notFound(response);
      if (result === "invalid_order") return badRequest(response);
      response.status(200).json(result);
    },
  );

  router.delete(
    "/collections/playlists/:playlistId/tracks/:trackId",
    async (request, response) => {
      const id = playlistIdSchema.safeParse(request.params.playlistId);
      const trackId = trackIdSchema.safeParse(request.params.trackId);
      if (!id.success || !trackId.success) return badRequest(response);
      if (
        !(await store.removeTrack(
          request.tfPrincipal!.accountId,
          id.data,
          trackId.data,
        ))
      )
        return notFound(response);
      response.status(204).end();
    },
  );

  router.delete(
    "/collections/playlists/:playlistId",
    async (request, response) => {
      const id = playlistIdSchema.safeParse(request.params.playlistId);
      if (!id.success) return badRequest(response);
      if (!(await store.remove(request.tfPrincipal!.accountId, id.data)))
        return notFound(response);
      response.status(204).end();
    },
  );

  return router;
}

export default createPlaylistsRouter();
