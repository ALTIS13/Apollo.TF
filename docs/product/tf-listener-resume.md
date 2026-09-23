# TF listener checkpoint

- Owner: Apollo.TF (web player and TF API); Platform remains identity and entitlement authority.
- Stage: local TF-core PostgreSQL 16 proof and source candidate for repeat/shuffle, device-local account-scoped queue resume, bounded natural-end next-track recovery and lyrics provenance/match admission on `codex/tf-listener-experience`.
- Evidence: focused real-store test on disposable local PostgreSQL 16.15/UTF-8, player/auth/API route tests and mocked 1280/320px browser interaction. Details: [listener experience audit](2026-09-23-listener-experience-audit.md) and [release readiness](../operations/2026-09-23-tf-listener-readiness.md).
- Blocker to release acceptance: no authenticated HTTP/Coolify or live provider proof; no deploy or HomeNode change. The separate integrations PostgreSQL 17 proof does not cover TF-core playlists.
- Next action: validate the integrated web/API deployment with Platform entitlement gates in an approved isolated environment; define cross-device queue ownership with Platform before server persistence.
