# TF listener checkpoint

- Owner: Apollo.TF (web player and TF API); Platform remains identity and entitlement authority.
- Stage: source candidate for account-scoped playlists, play-all and track reorder on `codex/tf-listener-experience`.
- Evidence: focused API/player tests, both typechecks and builds, plus mocked desktop/mobile browser layout. Details: [listener experience audit](2026-09-23-listener-experience-audit.md).
- Blocker to runtime acceptance: no live Postgres transaction proof or end-to-end TF service validation; no deploy or HomeNode change.
- Next action: validate playlist mutations against an isolated database, then implement repeat/shuffle and account-scoped queue resume.
