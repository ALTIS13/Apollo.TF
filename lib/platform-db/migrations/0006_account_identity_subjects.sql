create table apollo_platform.account_identity_subjects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null
    references apollo_platform.accounts(id) on delete cascade,
  provider_code text not null,
  identity_issuer text not null,
  identity_subject text not null,
  state text not null default 'active',
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revision bigint not null default 1,
  constraint account_identity_subjects_provider_check check (
    provider_code = lower(btrim(provider_code))
    and provider_code ~ '^[a-z][a-z0-9._-]{0,63}$'
  ),
  constraint account_identity_subjects_issuer_check check (
    identity_issuer = btrim(identity_issuer)
    and identity_issuer <> ''
  ),
  constraint account_identity_subjects_subject_check check (
    identity_subject = btrim(identity_subject)
    and identity_subject <> ''
  ),
  constraint account_identity_subjects_state_check check (
    state in ('active', 'revoked')
  ),
  constraint account_identity_subjects_revision_check check (revision > 0),
  constraint account_identity_subjects_lifecycle_check check (
    last_seen_at >= linked_at
    and (
      (state = 'active' and revoked_at is null)
      or (state = 'revoked' and revoked_at is not null and revoked_at >= linked_at)
    )
  ),
  constraint account_identity_subjects_subject_key unique (
    provider_code,
    identity_issuer,
    identity_subject
  )
);

create index account_identity_subjects_account_id_idx
  on apollo_platform.account_identity_subjects(account_id);

create unique index account_identity_subjects_active_account_provider_idx
  on apollo_platform.account_identity_subjects(
    account_id,
    provider_code,
    identity_issuer
  )
  where state = 'active';

alter table apollo_platform.account_identity_subjects enable row level security;
alter table apollo_platform.account_identity_subjects force row level security;

create policy account_identity_subjects_account_isolation
  on apollo_platform.account_identity_subjects
  for all
  using (
    account_id = nullif(current_setting('app.account_id', true), '')::uuid
  )
  with check (
    account_id = nullif(current_setting('app.account_id', true), '')::uuid
  );

create policy account_identity_subjects_pre_auth_select
  on apollo_platform.account_identity_subjects
  for select to apollo_platform_runtime
  using (
    provider_code = nullif(
      current_setting('app.identity_provider_code', true),
      ''
    )
    and identity_issuer = nullif(
      current_setting('app.identity_issuer', true),
      ''
    )
    and identity_subject = nullif(
      current_setting('app.identity_subject', true),
      ''
    )
  );

grant select on apollo_platform.account_identity_subjects
  to apollo_platform_runtime;
