create table public.recommendation_hidden (
  account_id uuid not null,
  track_id text not null,
  hidden_at timestamptz not null default now(),
  primary key (account_id, track_id),
  constraint recommendation_hidden_track_id_length
    check (char_length(track_id) between 1 and 4096)
);

alter table public.recommendation_hidden owner to apollo_tf_migrator;
grant select, insert, delete on public.recommendation_hidden to apollo_tf_runtime;
