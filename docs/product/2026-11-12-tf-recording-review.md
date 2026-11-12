# Review an imported recording

Baseline `e9fd27d`. A listener can open an occurrence in a saved import draft, compare editions, and explicitly confirm one full recording against the current reviewed catalog. This is a durable selection, not a playback, download, or offline grant.

## Evidence and selection

- The catalog matches exact normalized artist and an explicitly curated `matchTitle`. Version labels, including original and clean edit, are curator-provided. Release dates and duration agreement do not establish that a recording is uncensored. Web shows the imported, expected, and measured durations; a difference is visible without silently selecting or discarding an alternate.
- Full access needs a reviewed evidence record, explicit stream permission, a full-media classification, and matching expected/measured durations. Tolerance is 2%, bounded to 1–5 seconds. Explicit previews and measurements at most half of a reference of at least 60 seconds are not full candidates. A genuinely short full recording can qualify. A full stream-only recording is selectable; a preview or unknown-access item is not. Download permission is a separate catalog claim and cannot be earned by selecting a recording.
- `GET /api/collections/imports/{importId}/entries/{position}/candidates` returns the live evidence and any saved selection. `PUT .../selection` requires the candidate ID and current SHA-256 evidence revision. Both require `tf.collections` and `tf.search`; `PUT` also requires browser CSRF. An invalidated selection remains visible as stale until replaced. A catalog failure does not invalidate the account session. Responses are `no-store`; closing a review or changing account aborts its requests and discards the in-memory view.
- Migration `0008_playlist_import_selections.sql` stores only the candidate ID, evidence revision and selection time per owned draft occurrence. Replaying the same selection retains its time. A replacement changes only that occurrence. The store compares the expected row under the draft lock; a draft re-created with different metadata cannot receive a late write. Deleting a draft cascades to its selections. Previous migration bytes are unchanged.

## Portable catalog configuration

The server reads an optional `TF_RECORDING_CATALOG_FILE` from an operator-selected absolute local path. If absent, the UI reports that the catalog is not configured. An unreadable or malformed configured file fails closed without exposing its path or private evidence. The manifest is bounded to 512 KiB, 512 rows and 12 returned candidates per query. Each candidate's revision is derived from its normalized record, so formatting and unrelated catalog changes do not invalidate existing selections.

```json
{
  "schemaVersion": 1,
  "entries": [{
    "id": "example_original", "artist": "Example Artist",
    "title": "Example Song", "matchTitle": "Example Song",
    "edition": "original", "releaseDate": "2024-06-15",
    "expectedDurationSeconds": 240, "measuredDurationSeconds": 240,
    "mediaKind": "full", "streamPermission": "permitted",
    "downloadPermission": "not_permitted", "sourceLabel": "Artist catalog",
    "sourceUrl": "https://example.org/recordings/example",
    "evidence": {"recordId": "rights-reference", "basis": "Example only", "observedDate": "2026-11-12", "reviewed": true}
  }]
}
```

Use a private read-only mount with identical approved content on all API replicas; record its file digest in the deployment handoff. The catalog is metadata, does not fetch or store audio, and does not require new domains. The optional `sourceUrl` is an attribution page, not a media endpoint. No Compose profile or live application has been changed. Jamendo exposes a [creator download flag](https://developer.jamendo.com/v3.0/tracks) but its [API terms](https://devportal.jamendo.com/api_terms_of_use) constrain content caching/offline access. Do not treat that flag alone as authority for TF offline storage. No external provider was enabled by this increment.

## Acceptance

- 93 API/catalog/policy cases, 37 Web cases, 25 migration checks and six real disposable PG16 cases passed. Web/API typechecks, code generation and production builds passed; existing Vite warnings remain. PG16 tests cover replay, isolated occurrences/accounts, permissions, deletion, and the stale-write race.
- Chrome desktop ran the compiled Web UI against the actual local API and PG16, with synthetic session and catalog. A radio selection made no write; confirmation wrote one selection for position 0; position 1 remained unchanged. Reopening showed the saved choice and the 30-second preview was disabled. Three evidence reads, one confirmed write and zero playback requests were recorded. Both local processes were stopped.
- Still required: bind an authorized recording's exact bytes or provider-issued media reference to its reviewed evidence, verify decoded full duration, and hand it to the existing player. Recheck live authorization and independent download permission at the point of use. Actual OAuth, audio, Coolify and Android/Windows release receipts are not established by this slice.
