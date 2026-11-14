import { sql } from "drizzle-orm";
import { check, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export interface PlaylistImportDraftEntry {
  readonly artist: string;
  readonly title: string;
  readonly durationSeconds: number | null;
}

export const playlistImportSource = pgEnum("playlist_import_source", [
  "file", "spotify_album", "spotify_playlist", "spotify_liked",
]);

export const playlistImportDraftsTable = pgTable("playlist_import_drafts", {
  accountId: uuid("account_id").notNull(),
  id: uuid("id").notNull(),
  source: playlistImportSource("source").notNull(),
  name: text("name").notNull(),
  entries: jsonb("entries").$type<readonly PlaylistImportDraftEntry[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.accountId, table.id] }),
  check("playlist_import_drafts_name_length", sql`char_length(btrim(${table.name})) between 1 and 200`),
  check("playlist_import_drafts_metadata_entries", sql`
    case when jsonb_typeof(${table.entries}) = 'array' then
      jsonb_array_length(${table.entries}) between 1 and 200
      and jsonb_array_length(jsonb_path_query_array(${table.entries}, $path$
        strict $[*] ? (
          @.type() == "object"
          && @.artist.type() == "string" && @.artist like_regex "^.{1,150}.{0,150}$" flag "s"
          && @.title.type() == "string" && @.title like_regex "^.{1,250}.{0,250}$" flag "s"
          && (@.durationSeconds.type() == "null" || (
            @.durationSeconds.type() == "number"
            && @.durationSeconds >= 1 && @.durationSeconds <= 86400
            && @.durationSeconds == @.durationSeconds.floor()
          ))
          && !exists (@.keyvalue() ? (@.key != "artist" && @.key != "title" && @.key != "durationSeconds"))
        )
      $path$)) = jsonb_array_length(${table.entries})
    else false end
  `),
]);
