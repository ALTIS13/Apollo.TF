import { isDeepStrictEqual } from "node:util";
import {
  db,
  playlistImportDraftsTable as drafts,
  playlistImportSource,
  type PlaylistImportDraftEntry,
} from "@workspace/db";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

const ACCOUNT_DRAFT_LIMIT = 30;
const metadataText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !value.includes("\0"));
const draftInput = z.object({
  name: metadataText(200),
  source: z.enum(playlistImportSource.enumValues),
  entries: z.array(z.object({
    artist: metadataText(300),
    title: metadataText(500),
    durationSeconds: z.number().int().min(1).max(86_400).nullable(),
  }).strict()).min(1).max(200),
}).strict();

export interface PlaylistImportInput {
  readonly name: string;
  readonly source: (typeof playlistImportSource.enumValues)[number];
  readonly entries: readonly PlaylistImportDraftEntry[];
}

export interface ImportDraftSummary {
  readonly id: string;
  readonly name: PlaylistImportInput["name"];
  readonly source: PlaylistImportInput["source"];
  readonly entryCount: number;
  readonly createdAt: string;
}

export interface ImportDraft extends ImportDraftSummary {
  readonly entries: PlaylistImportInput["entries"];
}

// The caller supplies the verified TF account ID, never a provider identity.
export interface PlaylistImportStore {
  list(accountId: string): Promise<readonly ImportDraftSummary[]>;
  get(accountId: string, id: string): Promise<ImportDraft | null>;
  put(accountId: string, id: string, input: PlaylistImportInput): Promise<
    | { status: "created"; draft: ImportDraft }
    | { status: "existing"; draft: ImportDraft }
    | { status: "conflict" }
    | { status: "limit" }
  >;
  remove(accountId: string, id: string): Promise<boolean>;
}

const summaryColumns = {
  id: drafts.id,
  name: drafts.name,
  source: drafts.source,
  createdAt: drafts.createdAt,
};
const detailColumns = { ...summaryColumns, entries: drafts.entries };

function detail(row: Pick<typeof drafts.$inferSelect, keyof typeof detailColumns>): ImportDraft {
  return { ...row, entryCount: row.entries.length, createdAt: row.createdAt.toISOString() };
}

function draftKey(accountId: string, id: string) {
  return and(eq(drafts.accountId, accountId), eq(drafts.id, id));
}

function accountLock(accountId: string) {
  // Canonical UUID text makes equivalent spellings share the same quota lock.
  return sql`select pg_advisory_xact_lock(hashtextextended('tf:playlist-import-drafts:' || ${accountId}::uuid::text, 0))`;
}

export const defaultPlaylistImportStore: PlaylistImportStore = {
  async list(accountId) {
    const rows = await db.select({
      ...summaryColumns,
      entryCount: sql<number>`jsonb_array_length(${drafts.entries})`,
    }).from(drafts).where(eq(drafts.accountId, accountId)).orderBy(desc(drafts.createdAt), drafts.id);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  },

  async get(accountId, id) {
    const [row] = await db.select(detailColumns).from(drafts).where(draftKey(accountId, id));
    return row ? detail(row) : null;
  },

  async put(accountId, id, input) {
    const normalized = draftInput.parse(input);
    return db.transaction(async (tx) => {
      await tx.execute(accountLock(accountId));
      const [existing] = await tx.select(detailColumns).from(drafts).where(draftKey(accountId, id));
      if (existing) {
        return existing.name === normalized.name && existing.source === normalized.source &&
          isDeepStrictEqual(existing.entries, normalized.entries)
          ? { status: "existing", draft: detail(existing) }
          : { status: "conflict" };
      }
      const [quota] = await tx.select({ total: count() }).from(drafts).where(eq(drafts.accountId, accountId));
      if (!quota) throw new Error("Missing playlist import quota count");
      if (quota.total >= ACCOUNT_DRAFT_LIMIT) return { status: "limit" };

      const [inserted] = await tx.insert(drafts).values({ accountId, id, ...normalized }).returning(detailColumns);
      if (!inserted) throw new Error("Missing inserted playlist import draft");
      return { status: "created", draft: detail(inserted) };
    }, { isolationLevel: "read committed" });
  },

  async remove(accountId, id) {
    return db.transaction(async (tx) => {
      await tx.execute(accountLock(accountId));
      const [removed] = await tx.delete(drafts).where(draftKey(accountId, id)).returning({ id: drafts.id });
      return removed !== undefined;
    }, { isolationLevel: "read committed" });
  },
};
