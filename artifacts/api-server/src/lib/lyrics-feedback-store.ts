import { randomUUID } from "node:crypto";
import { db, lyricsFeedbackEventsTable, lyricsFeedbackTable } from "@workspace/db";
import type {
  LyricsFeedbackList,
  LyricsFeedbackStatus,
  LyricsFeedbackTriageList,
  LyricsFeedbackTriageReport,
  LyricsFeedbackTriageUpdate,
} from "@workspace/admin-dashboard-contract";
import { and, desc, eq, lt, type InferSelectModel } from "drizzle-orm";

export interface LyricsFeedbackInput {
  readonly accountId: string;
  readonly trackId: string;
  readonly artist: string;
  readonly title: string;
  readonly durationSeconds: number;
  readonly lyricsSource: "lrclib" | "lyrics.ovh" | "none";
  readonly reason: "wrong_track" | "out_of_sync" | "incomplete" | "missing";
}

export async function recordLyricsFeedback(
  input: LyricsFeedbackInput,
): Promise<"recorded" | "already_reported"> {
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(lyricsFeedbackTable).values(input)
      .onConflictDoNothing({
        target: [
          lyricsFeedbackTable.accountId,
          lyricsFeedbackTable.trackId,
          lyricsFeedbackTable.lyricsSource,
          lyricsFeedbackTable.reason,
        ],
      })
      .returning({ id: lyricsFeedbackTable.id });
    if (inserted.length > 0) return "recorded";

    const [existing] = await tx.select({
      id: lyricsFeedbackTable.id,
      status: lyricsFeedbackTable.status,
      revision: lyricsFeedbackTable.revision,
    }).from(lyricsFeedbackTable).where(and(
      eq(lyricsFeedbackTable.accountId, input.accountId),
      eq(lyricsFeedbackTable.trackId, input.trackId),
      eq(lyricsFeedbackTable.lyricsSource, input.lyricsSource),
      eq(lyricsFeedbackTable.reason, input.reason),
    )).for("update");
    if (!existing || existing.status === "open" || existing.status === "reviewing") {
      return "already_reported";
    }

    await tx.update(lyricsFeedbackTable).set({
      status: "open",
      revision: existing.revision + 1,
      updatedAt: new Date(),
      resolutionNote: null,
    }).where(eq(lyricsFeedbackTable.id, existing.id));
    await tx.insert(lyricsFeedbackEventsTable).values({
      id: randomUUID(),
      feedbackId: existing.id,
      fromStatus: existing.status,
      toStatus: "open",
      note: null,
      requestId: randomUUID(),
      operatorIdentity: "listener-report",
    });
    return "recorded";
  });
}

export async function loadLyricsFeedback(): Promise<LyricsFeedbackList> {
  const rows = await db.select({
    id: lyricsFeedbackTable.id,
    accountId: lyricsFeedbackTable.accountId,
    trackId: lyricsFeedbackTable.trackId,
    artist: lyricsFeedbackTable.artist,
    title: lyricsFeedbackTable.title,
    lyricsSource: lyricsFeedbackTable.lyricsSource,
    reason: lyricsFeedbackTable.reason,
    createdAt: lyricsFeedbackTable.createdAt,
  }).from(lyricsFeedbackTable)
    .orderBy(desc(lyricsFeedbackTable.createdAt), desc(lyricsFeedbackTable.id))
    .limit(25);
  return {
    schemaVersion: 1,
    reports: rows.map((row) => ({
      ...row,
      lyricsSource: row.lyricsSource as LyricsFeedbackList["reports"][number]["lyricsSource"],
      reason: row.reason as LyricsFeedbackList["reports"][number]["reason"],
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

const triageFields = {
  id: lyricsFeedbackTable.id,
  accountId: lyricsFeedbackTable.accountId,
  trackId: lyricsFeedbackTable.trackId,
  artist: lyricsFeedbackTable.artist,
  title: lyricsFeedbackTable.title,
  lyricsSource: lyricsFeedbackTable.lyricsSource,
  reason: lyricsFeedbackTable.reason,
  createdAt: lyricsFeedbackTable.createdAt,
  status: lyricsFeedbackTable.status,
  revision: lyricsFeedbackTable.revision,
  updatedAt: lyricsFeedbackTable.updatedAt,
  resolutionNote: lyricsFeedbackTable.resolutionNote,
};

type TriageRow = Pick<InferSelectModel<typeof lyricsFeedbackTable>, keyof typeof triageFields>;

function triageReport(row: TriageRow): LyricsFeedbackTriageReport {
  return {
    ...row,
    lyricsSource: row.lyricsSource as LyricsFeedbackTriageReport["lyricsSource"],
    reason: row.reason as LyricsFeedbackTriageReport["reason"],
    status: row.status as LyricsFeedbackStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadLyricsFeedbackTriage(
  status: LyricsFeedbackStatus,
  before: number | null,
): Promise<LyricsFeedbackTriageList> {
  const rows = await db.select(triageFields)
    .from(lyricsFeedbackTable)
    .where(and(
      eq(lyricsFeedbackTable.status, status),
      before === null ? undefined : lt(lyricsFeedbackTable.id, before),
    ))
    .orderBy(desc(lyricsFeedbackTable.id))
    .limit(26);
  const page = rows.slice(0, 25);
  return {
    schemaVersion: 1,
    reports: page.map(triageReport),
    nextCursor: rows.length > 25 ? page.at(-1)!.id : null,
  };
}

export type LyricsFeedbackUpdateOutcome =
  | { kind: "updated"; report: LyricsFeedbackTriageReport }
  | { kind: "conflict" }
  | { kind: "not_found" };

export async function updateLyricsFeedback(
  id: number,
  input: LyricsFeedbackTriageUpdate,
  requestId: string,
): Promise<LyricsFeedbackUpdateOutcome> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select(triageFields).from(lyricsFeedbackTable)
      .where(eq(lyricsFeedbackTable.id, id)).for("update");
    if (!current) return { kind: "not_found" };
    if (current.revision !== input.expectedRevision) return { kind: "conflict" };

    const note = input.note ?? null;
    if (current.status === input.status && current.resolutionNote === note) {
      return { kind: "updated", report: triageReport(current) };
    }

    const [updated] = await tx.update(lyricsFeedbackTable).set({
      status: input.status,
      revision: current.revision + 1,
      resolutionNote: note,
      updatedAt: new Date(),
    }).where(eq(lyricsFeedbackTable.id, id)).returning(triageFields);
    await tx.insert(lyricsFeedbackEventsTable).values({
      id: randomUUID(),
      feedbackId: id,
      fromStatus: current.status,
      toStatus: input.status,
      note,
      requestId,
      operatorIdentity: "admin-dashboard-token",
    });
    return { kind: "updated", report: triageReport(updated!) };
  });
}
