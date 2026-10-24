# Manual liked-track order

Owner: Apollo.TF source. Status: implemented source candidate, not deployment approval.

## Contract

- Preserve the existing newest-first `GET /collections/liked` response and cursor for older clients.
- `GET /collections/liked?sort=manual` returns the account's persisted order, an opaque cursor, and a decimal-string revision. A cursor from an older revision returns `409 liked_order_conflict` so pages cannot silently duplicate or skip tracks.
- `PATCH /collections/liked/order` accepts `trackId`, `beforeTrackId` (or `null` for end), and `expectedRevision`. The server derives the account from the verified TF principal; a stale revision returns `409` with the current revision. A missing track or anchor returns `404`.
- Saving a new like places it first and increments the revision. Updating metadata or deleting an absent like does not. Deleting an existing like increments it. Existing playlist ordering stays untouched.
- The web player uses the manual order, provides accessible up/down controls across loaded pages, and refreshes after a conflict. Movement past an unloaded page boundary requires loading that page first.

## Implementation sequence

1. Test the route contract and order transformation, then implement the minimal API path.
2. Add an additive migration for position and account revision, update the immutable manifest, and verify transaction/privilege behavior on a disposable database.
3. Update OpenAPI/generated client and player controls, with one focused interaction test.
4. Run affected typechecks/tests and rendered desktop/mobile inspection; update the resume checkpoint. No push, Coolify or HomeNode change in this stage.
