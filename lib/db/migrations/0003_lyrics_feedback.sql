create table public.lyrics_feedback (
  id serial primary key,
  account_id uuid not null,
  track_id text not null,
  artist text not null,
  title text not null,
  duration_seconds integer not null,
  lyrics_source text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint lyrics_feedback_track_id_length check (char_length(track_id) between 1 and 4096),
  constraint lyrics_feedback_artist_length check (char_length(artist) between 1 and 200),
  constraint lyrics_feedback_title_length check (char_length(title) between 1 and 300),
  constraint lyrics_feedback_duration check (duration_seconds between 0 and 86400),
  constraint lyrics_feedback_source check (lyrics_source in ('lrclib', 'lyrics.ovh', 'none')),
  constraint lyrics_feedback_reason check (reason in ('wrong_track', 'out_of_sync', 'incomplete', 'missing')),
  constraint lyrics_feedback_missing_source check ((lyrics_source = 'none') = (reason = 'missing')),
  constraint lyrics_feedback_account_track_reason_uniq unique (account_id, track_id, lyrics_source, reason)
);

create index lyrics_feedback_created_idx
  on public.lyrics_feedback (created_at desc, id desc);

grant select, insert on public.lyrics_feedback to apollo_tf_runtime;
grant usage on sequence public.lyrics_feedback_id_seq to apollo_tf_runtime;
