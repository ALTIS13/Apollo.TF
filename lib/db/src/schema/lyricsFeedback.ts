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
  status: text("status").notNull().default("open"),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  resolutionNote: text("resolution_note"),
}, (table) => [
  unique("lyrics_feedback_account_track_reason_uniq").on(
    table.accountId,
    table.trackId,
    table.lyricsSource,
    table.reason,
  ),
  index("lyrics_feedback_created_idx").on(table.createdAt.desc(), table.id.desc()),
  index("lyrics_feedback_status_id_idx").on(table.status, table.id.desc()),
]);

export const lyricsFeedbackEventsTable = pgTable("lyrics_feedback_events", {
  id: uuid("id").primaryKey(),
  feedbackId: integer("feedback_id").notNull().references(() => lyricsFeedbackTable.id),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  requestId: uuid("request_id").notNull().unique(),
  operatorIdentity: text("operator_identity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("lyrics_feedback_events_feedback_idx").on(table.feedbackId, table.createdAt.desc()),
]);
