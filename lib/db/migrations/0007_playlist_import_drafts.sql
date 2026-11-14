create type public.playlist_import_source as enum (
  'file', 'spotify_album', 'spotify_playlist', 'spotify_liked'
);

create table public.playlist_import_drafts (
  account_id uuid not null,
  id uuid not null,
  source public.playlist_import_source not null,
  name text not null,
  entries jsonb not null,
  created_at timestamptz not null default now(),
  primary key (account_id, id),
  constraint playlist_import_drafts_name_length
    check (char_length(btrim(name)) between 1 and 200),
  constraint playlist_import_drafts_metadata_entries check (
    case when jsonb_typeof(entries) = 'array' then
      jsonb_array_length(entries) between 1 and 200
      and jsonb_array_length(jsonb_path_query_array(entries, $path$
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
      $path$)) = jsonb_array_length(entries)
    else false end
  )
);

alter type public.playlist_import_source owner to apollo_tf_migrator;
alter table public.playlist_import_drafts owner to apollo_tf_migrator;
grant select, insert, delete on public.playlist_import_drafts to apollo_tf_runtime;
