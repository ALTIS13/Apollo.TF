alter table public.liked_tracks add column sort_position bigint;
update public.liked_tracks set sort_position = id;
alter table public.liked_tracks
  alter column sort_position set default nextval('public.liked_tracks_id_seq'::regclass),
  alter column sort_position set not null;
alter table public.liked_tracks
  add constraint liked_tracks_account_position_uniq
  unique (session_id, sort_position) deferrable initially deferred;
create index liked_tracks_account_order_idx
  on public.liked_tracks (session_id, sort_position desc);

create table public.liked_order_revisions (
  account_id text primary key,
  revision bigint not null default 0 check (revision >= 0)
);

alter table public.lyrics_feedback owner to apollo_tf_migrator;
alter sequence public.lyrics_feedback_id_seq owner to apollo_tf_migrator;
alter table public.liked_order_revisions owner to apollo_tf_migrator;

grant select, insert, update on public.liked_order_revisions to apollo_tf_runtime;
