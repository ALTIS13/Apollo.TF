import { db, lyricsFeedbackTable } from "@workspace/db";
import type { LyricsFeedbackList } from "@workspace/admin-dashboard-contract";
import { desc } from "drizzle-orm";

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
  const inserted = await db.insert(lyricsFeedbackTable).values(input)
    .onConflictDoNothing({
      target: [
        lyricsFeedbackTable.accountId,
        lyricsFeedbackTable.trackId,
        lyricsFeedbackTable.lyricsSource,
        lyricsFeedbackTable.reason,
      ],
    })
    .returning({ id: lyricsFeedbackTable.id });
  return inserted.length > 0 ? "recorded" : "already_reported";
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
