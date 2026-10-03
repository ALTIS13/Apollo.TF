# Recommendation Refinement

Owner: Apollo.TF. Base: `469fe81b6371364f18d5cc5c40af58eea1dde1b7`. Source-only bounded extension of the existing Discover flow; the root-accepted renewal-v2 candidate `1f49e426f694778850f6885e669b865471d6b1b7` is unchanged.

Source: `1eb19b6f9a88c7431a67f744c69606f8599406a2`, pushed to `origin/codex/tf-listener-experience`, existing [PR #5](https://github.com/ALTIS13/Apollo.TF/pull/5). No merge, image publication, runtime selection or deployment.

## Delivered Behavior

- Each recommended recording identifies its actual contributing saved-track or listening-history artist seed. Legacy candidates without that metadata stay neutral. The aggregate label reflects only surviving known reasons after a local exclusion.
- Account-scoped exclusions hide one exact source-qualified recording, not an artist or all recordings of the same work. Playback, search, liked tracks, playlists and history are not deleted or restricted by an exclusion.
- Hide succeeds visibly only after the API acknowledges the durable write. The listener can undo the latest hide or confirm a reset of all exclusions. All commands use the existing CSRF-aware session client; stale owners, revoked access and unmounted views cannot publish completion feedback.
- Same-owner reconciliation preserves surviving track cards and their active download controllers. A write acknowledged under an obsolete security generation is not accepted as current UI state; the list is re-read under the current session. Normal token rotation without a pending preference write does not refetch a loaded list.
- While an authoritative list refresh is pending, preference commands are serialized behind it. Playback and surviving cards remain available; an older GET cannot overwrite a newly admitted exclusion.
- Transport failures retain the existing recommendation and display sanitized feedback. HTTP service/policy failures retain the shared unavailable/security boundary; no cosmetic bypass or change to identity authority was introduced.

## API And Storage

`GET /api/tracks/recommendations` retains `results` and `basis`, adding `schemaVersion: 1`, `hiddenCount`, and per-result `recommendationReason: { basis, artist }`. Reasons derive from the selected seed, not guessed candidate metadata. Private source URLs/provider internals remain stripped. Hidden IDs are filtered before the existing result cap, and only surviving results contribute the aggregate basis.

`PUT /api/tracks/recommendations/hidden/:trackId`, `DELETE` on the same path, and `DELETE /api/tracks/recommendations/hidden` perform idempotent hide, restore and reset. Their versioned acknowledgements have status `hidden`, `restored`, or `cleared`. The principal supplies account identity. Shared live `tf.collections` policy/CSRF admission plus `tf.search` access apply; no new entitlement or login is introduced.

Immutable TF migration `0006_recommendation_hidden.sql` adds set membership keyed by `(account_id, track_id)` with a timestamp and length constraint. It has no foreign key or client access to Platform identity. The migrator owns the table; runtime receives only SELECT/INSERT/DELETE. Independent idempotent membership operations do not replace Platform revisions, entitlements, policy or audit authority. Old migration bytes must remain unchanged.

## Focused Evidence

Frontend: seven new behaviors first failed against the previous implementation. Independent review then exposed download-controller loss on undo/reset, an unreconciled committed write crossing token rotation, and a stale aggregate basis. Three targeted regressions failed before those fixes; the existing download/reason cases were extended instead of duplicated. Re-review exposed a refresh/new-hide race: the added delayed-GET regression first failed because hide was still enabled, then passed after preference serialization. Final Discover run: 21 PASS; the affected recommendation request/capability fixture: 1 PASS. Frontend typecheck and production build pass; bundle `index-JUYLJVFS.js`, 715.40 kB / 222.45 kB gzip. Existing tooltip/sheet/dropdown sourcemap diagnostics and the >500 kB JS chunk warning remain.

An exploratory run of the whole legacy `tf-api-migration.test.ts` also exposed four pre-existing Home fixture failures (`usePlayer must be used within a PlayerProvider`): CSRF-at-mutation and the three generated-search auth-forwarding cases. This slice corrects and verifies only the affected recommendation fixture. The unchanged Home test harness is not silently reported as green or rewritten here; the behavior has separate accepted Home generation/runtime evidence.

API/policy: initial behavioral RED was 27 failed / 2 passed. Extending the existing no-search case also exposed a real empty-seed admission failure (200 instead of 403). Final targeted run: 56 PASS across recommendations, account boundaries, validation, provider isolation and the existing live-policy inventory probe. API typecheck passes. This does not rerun unrelated API suites.

Manifest/runner: the affected existing fixtures were extended for migration 0006, with 2 failed / 2 passed before the update and 4 PASS afterward. Actual SQL bytes match the appended manifest SHA256 `3adeb13847afbe19eea037478e372db5ba44d9cfceb67f0d63299367d4a50a0d`; migrations 0001 through 0005 are unchanged. The full general DB integration suite was not run.

Real store: 3 PASS on a fresh marked local PostgreSQL 16.15 database, separate migrator/runtime roles and loopback-only trust. Proof covers persistent account/source-qualified membership, idempotent timestamp-preserving hide, restore/reset isolation, actual forbidden UPDATE (`42501`) and length constraints (`23514`). The persistence RED used a temporary no-op implementation after the store source existed: 2 failed / 1 passed, then byte-exact restoration and GREEN. This is a real-store mutation baseline, not a claim that PG RED preceded the first product-store edit. Only the fixture's random account rows were cleaned and all worker pools closed.

Commands and chronology: outside-source `tf-recommendations-api-report.md`. Total focused checks: 85 PASS (22 frontend, 56 API/policy, 4 manifest/runner, 3 real PG16). No whole application suite or unchanged admission test rerun is required for this delta.

Independent final review found no actionable issue in the frontend serialization fix or the scoped API/storage changes. Existing evidence was reused without duplicate test runs.

## Rendered QA

Chrome extension, local HTTP fixture at `http://127.0.0.1:7456/discover`; 1440x900 and 390x844. Real production bundle, synthetic account/metadata/session and controlled HTTP inputs. No live issuer, provider account, physical Android, offline library, native deployment or runtime-admission claim follows.

Verified page identity and meaningful content, no framework overlay, no relevant console warning/error, reason labels, hide/undo, reset confirmation/cancellation, confirmed reset, and network-disconnect feedback retaining the row. On the final build, hiding the only history-seed row switches the header to saved tracks; undo restores the three-row selection. A held recommendation GET confirms hide disabled, play enabled and the surviving row retained; releasing it restores preference controls. Mobile document scroll width equals viewport width (390 px). Coverless fixtures use the actual missing-cover state, not invented album art. Temporary viewport overrides were reset; the preview tab stays open through the Chrome extension.

The fixture deliberately does not emulate renewal-context recovery or legacy WebSocket tickets. An HTTP failure activates the existing unavailable boundary as expected; attempts to exercise unrelated recovery against those absent fixture endpoints are not product/runtime proof. The final product-flow fixture retains the explicit synthetic renewal-v1 header; no application admission logic is altered.

Artifacts outside source: `C:/Users/maksi/.codex/visualizations/2026/06/23/019ef2c2-95cb-7d01-9951-aa0abfe25d37/` with prefix `tf-recommendations-`: desktop/mobile/reset/error PNGs, sanitized final browser request receipts, API brief/report, frontend review/diff, local QA server and PostgreSQL proof helpers. Local disposable PostgreSQL is separate from HomeNode/Coolify. Exact data-directory/PID/port checks preceded `pg_ctl -m fast -w stop`; shutdown succeeded and loopback port 55479 no longer accepts connections. Only the previous owned recording-replacement preview was stopped; the current recommendation preview remains. The preview uses process-local fixture exclusions, not the real persistence store.

## Next Boundary

Before another product change, inspect the existing artist/library navigation surface and implement only missing discovery-to-library flow. Initial inspection confirms that current TrackCard artist metadata is plain text and App has no artist route; existing save/playlist/queue actions already work and must not be rebuilt. Do not repeat accepted queue/search/lyrics/duration/D05 work, change offline/cross-device authority, or deploy without the root-owned runtime packet.
