# TF listener checkpoint

- Owner: Apollo.TF (web player and TF API); Platform remains identity and entitlement authority.
- Stage: playlist PostgreSQL proof and source candidate for repeat/shuffle with device-local account-scoped queue resume on `codex/tf-listener-experience`.
- Evidence: focused real-store test on disposable local PostgreSQL 18.4, player/WS tests and mocked 1280/320px browser interaction. Details: [listener experience audit](2026-09-23-listener-experience-audit.md).
- Blocker to release acceptance: no target PostgreSQL 17, authenticated HTTP/Coolify or live provider proof; no deploy or HomeNode change.
- Next action: run the marked disposable PostgreSQL 17 playlist proof, then validate the integrated web/API deployment and define cross-device queue ownership with Platform before server persistence.
