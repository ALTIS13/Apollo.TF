alter table public.lyrics_feedback
  add column status text not null default 'open',
  add column revision integer not null default 1,
  add column updated_at timestamptz not null default now(),
  add column resolution_note text;

alter table public.lyrics_feedback
  add constraint lyrics_feedback_status_check
    check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  add constraint lyrics_feedback_revision_check check (revision > 0),
  add constraint lyrics_feedback_note_check
    check (resolution_note is null or char_length(resolution_note) between 3 and 500),
  add constraint lyrics_feedback_resolution_state_check
    check (
      (status in ('open', 'reviewing') and resolution_note is null)
      or (status in ('resolved', 'dismissed') and resolution_note is not null)
    );

create index lyrics_feedback_status_id_idx
  on public.lyrics_feedback (status, id desc);

create table public.lyrics_feedback_events (
  id uuid primary key,
  feedback_id integer not null references public.lyrics_feedback(id),
  from_status text not null,
  to_status text not null,
  note text,
  request_id uuid not null unique,
  operator_identity text not null,
  created_at timestamptz not null default now(),
  constraint lyrics_feedback_events_from_check
    check (from_status in ('open', 'reviewing', 'resolved', 'dismissed')),
  constraint lyrics_feedback_events_to_check
    check (to_status in ('open', 'reviewing', 'resolved', 'dismissed')),
  constraint lyrics_feedback_events_note_check
    check (note is null or char_length(note) between 3 and 500),
  constraint lyrics_feedback_events_resolution_check
    check (
      (to_status in ('open', 'reviewing') and note is null)
      or (to_status in ('resolved', 'dismissed') and note is not null)
    )
);

create index lyrics_feedback_events_feedback_idx
  on public.lyrics_feedback_events (feedback_id, created_at desc);

alter table public.lyrics_feedback_events owner to apollo_tf_migrator;

grant update (status, revision, updated_at, resolution_note)
  on public.lyrics_feedback to apollo_tf_runtime;
grant select, insert on public.lyrics_feedback_events to apollo_tf_runtime;
