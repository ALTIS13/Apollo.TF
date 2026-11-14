import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { playlistImportDraftsTable as drafts } from "./playlistImportDrafts";

export const playlistImportSelectionsTable = pgTable("playlist_import_selections", {
  accountId: uuid("account_id").notNull(),
  importId: uuid("import_id").notNull(),
  position: integer("position").notNull(),
  candidateId: text("candidate_id").notNull(),
  evidenceRevision: text("evidence_revision").notNull(),
  selectedAt: timestamp("selected_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
}, (table) => [
  primaryKey({ columns: [table.accountId, table.importId, table.position] }),
  foreignKey({
    name: "playlist_import_selections_draft_fk",
    columns: [table.accountId, table.importId],
    foreignColumns: [drafts.accountId, drafts.id],
  }).onDelete("cascade"),
  check("playlist_import_selections_position_check", sql`${table.position} between 0 and 199`),
  check("playlist_import_selections_candidate_check", sql`${table.candidateId} collate "C" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
  check("playlist_import_selections_revision_check", sql`${table.evidenceRevision} collate "C" ~ '^[0-9a-f]{64}$'`),
]);
