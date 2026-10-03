import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const recommendationHiddenTable = pgTable("recommendation_hidden", {
  accountId: uuid("account_id").notNull(),
  trackId: text("track_id").notNull(),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.accountId, table.trackId] }),
  check("recommendation_hidden_track_id_length", sql`char_length(${table.trackId}) between 1 and 4096`),
]);
