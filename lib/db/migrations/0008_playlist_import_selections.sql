create table public.playlist_import_selections (
  account_id uuid not null,
  import_id uuid not null,
  position integer not null,
  candidate_id text not null,
  evidence_revision text not null,
  selected_at timestamptz not null default clock_timestamp(),
  primary key (account_id, import_id, position),
  constraint playlist_import_selections_draft_fk
    foreign key (account_id, import_id)
    references public.playlist_import_drafts (account_id, id) on delete cascade,
  constraint playlist_import_selections_position_check
    check (position between 0 and 199),
  constraint playlist_import_selections_candidate_check
    check (candidate_id collate "C" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint playlist_import_selections_revision_check
    check (evidence_revision collate "C" ~ '^[0-9a-f]{64}$')
);

alter table public.playlist_import_selections owner to apollo_tf_migrator;
grant select on public.playlist_import_selections to apollo_tf_runtime;
grant insert (account_id, import_id, position, candidate_id, evidence_revision)
  on public.playlist_import_selections to apollo_tf_runtime;
grant update (candidate_id, evidence_revision, selected_at)
  on public.playlist_import_selections to apollo_tf_runtime;
