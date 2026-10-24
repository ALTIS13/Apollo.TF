# TF lyrics feedback triage handoff

Owner: Apollo.TF source. Status: candidate only; no push, deployment or HomeNode change.

- The listener's existing `POST /tracks/lyrics/feedback` remains account-scoped by the verified TF principal. A duplicate open/reviewing report remains `already_reported`. The same report after `resolved` or `dismissed` reopens, advances its revision and appends a `listener-report` event.
- The legacy `GET /admin/lyrics-feedback` response stays unchanged. New `GET /admin/lyrics-feedback/triage?status=...&before=...` returns a versioned 25-item ID-desc page with a next cursor. `PATCH /admin/lyrics-feedback/:id` accepts `{status, expectedRevision, note?}`. Resolved/dismissed decisions require a 3-500 character explanation; open/reviewing reject one. Missing report is 404, stale revision is 409, and other server failures are sanitized 503. `X-Request-ID` correlates successful and failed write attempts to an immutable runtime audit event when a transition commits.
- The admin dashboard keeps its Basic Auth and server-injected dashboard token. Nginx exposes only the existing reads, the exact triage read, and numeric-ID PATCH. Other `/api/` paths remain 404. The shared dashboard token identifies the console, not an individual human operator; per-operator attribution needs a reviewed Platform admin identity contract before production acceptance.
- Migration 0005 adds status, revision, update time and terminal explanation to the existing report table, plus `lyrics_feedback_events`. Runtime has column-limited UPDATE on reports and SELECT/INSERT only on events, with no event UPDATE/DELETE. The migration explicitly transfers event-table ownership for the legacy-superuser baseline. Previous migration bytes/checksums are untouched.
- Admin UI filters by state, pages through reports, requires an explanation before closing, handles 409 by refreshing, and shows a readable mobile row layout. The demo is explicitly labeled and does not send write actions.

## Release boundary

Apply and review 0005 before the updated API and admin UI. Its constraints validate existing rows and its indexes take locks; inspect production report-table size and schedule the migration with a rollback plan. 0004 liked-order backfill remains a separate deployment gate. The current source has not been validated through the authenticated Platform ingress, production Basic Auth proxy, Coolify, PostgreSQL 17 or a physical phone.

## Validation

- Focused admin API, admin UI/proxy and migration unit tests pass; API, admin and library TypeScript checks pass.
- A marked disposable PostgreSQL 16.15 database accepted 0001-0005 on fresh and legacy-baseline paths. A real runtime-store test proved atomic transition/event commits, stale revision, no-op, rollback on event insert failure, and listener re-report after resolution. The database was verified empty, dropped by its exact marker, and the local cluster stopped.
- Demo browser check at desktop and 390 px showed the new queue/filter UI, an empty-state transition and no mobile document overflow. The only console error was the existing missing `favicon.ico`. This does not prove authenticated write behavior in the browser.
