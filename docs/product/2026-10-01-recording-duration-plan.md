# Recording-aware candidate admission

Status: approved listener-plan continuation; local TF source work, based on `71f50cf`.

## Scope and acceptance

TF search owns catalog metadata lookup and candidate admission. Platform identity/policy and the public v1 search DTO are unchanged. Client duration is not promoted to authority. This slice does not yet bind a persisted reference to API playback/download or change production infrastructure.

Replace the cross-song duration median with references scoped to artist, title and recording version. Keep genuine short songs, unrelated songs, live/remix/clean/remastered variants, and unknown references distinct. Existing preview URL/title gates and parser rejection counters remain in force.

Look up catalog metadata independently of selected audio sources, using the original query and a bounded result count. Deezer metadata may be a reference, never an admitted preview audio source. Preserve version metadata and validate provider data. Share bounded, short-lived cache/in-flight requests with the existing Deezer search so one query does not cause duplicate API traffic. Failures are retried on subsequent searches, not cached as successful admission. Fixture runtime must remain network-free.

## Tasks

1. Archimedes: `recording-reference.ts`, `media-completeness.ts` and their focused tests. Export `RecordingDurationReference` with `artist`, `title`, `type`, `duration`. `filterCompleteMedia(tracks, catalogReferences?)` matches references per recording, retains existing rejection reasons, and falls back only to matching peer recordings. Rejecting one version must not reject another song/version. Ignore invalid references; conflicting catalog lengths must not invent a full-length reference.
2. Fermat: Deezer adapter and its focused tests. Export `searchDeezerCatalog(query, maxResults)` returning `readonly RecordingDurationReference[]` independently of preview availability. Existing `searchDeezer` stays compatible. Fixed HTTPS endpoint, existing timeout, bounded entries/cache/in-flight operations, no failure caching, no secrets, no new dependency. Preserve `title_version` even if absent from `title`.
3. Main: search-service/runtime wiring and focused integration tests. Optional `catalogLookup(query, limit)` dependency. Run once alongside selected providers for exact/free/artist discovery, with the same Deezer result budget where selected; no per-track fan-out. Do not cache a successful search when catalog lookup failed. Cap catalog-backed search snapshots at five minutes; with the separate five-minute provider cache, metadata age can reach ten minutes, not the legacy hour. Keep source selection/provider status semantics and v1 DTO unchanged. Review with Goodall, typecheck/build search only, retain checkpoint and report. The narrowly affected cache setter is also Main's write scope.

## Global Constraints

- Worktree: `D:/CodexProjects/Apollo.TF/.worktrees/tf-listener-experience`; branch `codex/tf-listener-experience`.
- Disjoint owned write scopes; no agent commits, push, deployment, recursive delegation, extra dependencies or mutation of other projects.
- TDD on real admission failures; focused affected checks only, not the unchanged application suite.
- Use existing agents and inherited model configuration. User working agreements supersede skill defaults demanding fresh agents, explicit model overrides, sequential independent work or whole-branch retesting.
- Catalog metadata establishes a comparison reference, not cryptographic proof of audio completeness or entitlement. Missing/ambiguous metadata is unknown, not verified full audio.

## Shared interfaces

Tasks 1 and 2 share only the readonly `RecordingDurationReference` shape; task 2 may use a type-only import. Task 3 consumes task 1's optional reference argument and task 2's catalog function. No overlapping writes or public schema changes are required.
