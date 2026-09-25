import { pgTable, serial, integer, text, timestamp, uuid, unique, index } from "drizzle-orm/pg-core";

export const lyricsFeedbackTable = pgTable("lyrics_feedback", {
  id: serial("id").primaryKey(),
  accountId: uuid("account_id").notNull(),
  trackId: text("track_id").notNull(),
  artist: text("artist").notNull(),
  title: text("title").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  lyricsSource: text("lyrics_source").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("lyrics_feedback_account_track_reason_uniq").on(
    table.accountId,
    table.trackId,
    table.lyricsSource,
    table.reason,
  ),
  index("lyrics_feedback_created_idx").on(table.createdAt.desc(), table.id.desc()),
]);
