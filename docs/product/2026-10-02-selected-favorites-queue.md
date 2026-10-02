# Selected favorites -> local queue

Status: source/browser PASS; independent SPEC and QUALITY APPROVED_SOURCE_ONLY, no actionable findings. Not live Auth, provider, phone or canary acceptance.

## Behavior

- Existing selection mode now offers playback and append icon commands with accessible names/tooltips. Up to20 loaded selections retain collection order, not click order; unselected rows and unloaded pages are not admitted.
- Playback uses existing `playCollection` once to replace the local queue. Append uses existing `addToQueue` to keep the current track and add selected full recording metadata without auto-play. Unknown duration stays unknown.
- Selection remains available after either command. Repeating append can intentionally create additional queue occurrences; this is not playlist membership deduplication.
- During selected playback, conflicting selection, playlist, liked removal/order, refresh/paging and other LikedCollection playback controls are locked. Current session/security generation and synchronous operation identity guard invocation and completion. Existing player owns stream resolution/errors; a settled `Promise<void>` is not an audio-success receipt.
- Queue/API/auth/persistence contracts are unchanged. TF runtime ownership and Platform identity/entitlement authority remain separate. No bulk server API, offline library or cross-device queue authority was introduced.

## Focused TDD

Before production edits, the14 selected-queue cases failed because the two commands did not exist (16 existing cases skipped). Final affected-file run: `pnpm --filter @workspace/music-player exec vitest run src/components/LikedCollection.test.tsx --testTimeout=10000`, 30passed, no warnings/unhandled rejections. `pnpm --filter @workspace/music-player typecheck` and scoped `git diff --check` passed. Test blob `bdfc7f2b93171a3c4eaaef8d0c9536995c8e56ba`.

The first full affected-file run had29passed/1timeout: the unchanged keyboard max20/pruning case exceeded its default5s ceiling by18ms. Its isolated check passed in3.62s; final file used the CLI-only10s ceiling with no test expectation or Vitest-config change. This timing sensitivity is recorded, not hidden. Existing queue engine/auth/batch-stage suites were not rerun separately. Private implementation evidence: `.superpowers/sdd/selected-queue-20261002/task-1-report.md`.

## Browser / Build Evidence

Flow: `/favorites` -> reverse-click two selected recordings -> Space append -> pending selected play -> controlled silent-WAV response -> pause -> `/queue`.

Chrome via existing bundled Playwright, real `PlayerProvider` and local persistence, HTTP fixtures only. Viewports1440x900,390x844,320x740 with browser default font20px and reduced motion. UI Git blob `dbc4ac80e289ffd26d4923bb5d21bd2c46838407`.

| Check | Evidence |
| --- | --- |
| Identity / meaningful page / overlay | Apollo TF title and collection/queue content, no Vite overlay. |
| Append | Paused `bc_anchor` retained; queue becomes anchor,yt_first,sc_second; no stream request. Space activates the command, not the global player shortcut. |
| Playback | Queue becomes yt_first,sc_second; no third/unselected recording. One first-stream request carries expected duration241. |
| Pending controls | Held first-stream request disables selected/playlist/refresh/all-play commands and checkboxes until settlement. |
| Duration/source | Unknown sc_second duration remains0 (unknown), source remains SoundCloud. |
| Responsive / motion | No document/main horizontal overflow; new targets55x55 at20px. Native small-screen vertical scroll remains necessary at enlarged font. First viewport and a separate scrolled320px action view retained. |
| Console / requests | No page errors, console errors or unexpected API calls. |
| Web build | `pnpm --filter @workspace/music-player build` exit0; JS663.92kB/gzip206.44kB. Pre-existing sheet/tooltip sourcemap and >500kB bundle warnings remain. |

External evidence directory: `C:/Users/maksi/.codex/visualizations/2026/06/23/019ef2c2-95cb-7d01-9951-aa0abfe25d37/`. Script `tf-selected-queue-20261002-qa.cjs`, evidence JSON and selection/queue PNGs for three widths, plus `tf-selected-queue-20261002-actions-320.png`. Screenshots and the synthetic media are not release assets.

## Tooling / Release Boundary

Current callable metadata was inspected, rather than copying a stale tool catalog. Figma/Mobbin/Rive, multi-agent and read-only Coolify tools are exposed; that metadata alone is not fresh connection/quota proof. Browser-extension controls and `node_repl` are not exposed in this session. Computer Use's current skill requires `node_repl`, so no custom UI-helper workaround was attempted. Existing Playwright, Lucide/Radix controls, TDD and scoped review are sufficient here; no paid reference/generation call or MobileNext session was spent.

The local shell's administrator role was verified; elevated rights do not widen infrastructure ownership. Dead preview was restored only for this TF worktree on127.0.0.1:54196. It is a development server without a local API proxy; the controlled test browser intercepts API responses. The URL alone is not an authenticated playable release. Real Auth/BFF connectivity is still an independent gate.

The native Coolify build remains source `f3828eb016e9dc034030e2da7ca2c2a39f4327c1`; this UI and the prior favorites-batch UI are outside that frozen candidate. Publisher custody/registry access and a current Platform runtime/restore receipt remain release gates. No claim, publish, runtime activation, Caddy/UFW/DNS, shared container or remote credential operation occurred here.

## Remaining Work

This selected-queue slice is complete; private read-only verdict is retained at `.superpowers/sdd/selected-queue-20261002/task-1-review.md`. Do not redispatch or rerun its unchanged evidence. Release-critical next work is actual publisher/registry admission and current Auth/Platform -> TF/restore proof; a frozen older build must not be represented as containing this new UI. Account-wide bulk removal/export remain separate listener gaps. Queue snapshots retain their existing500-track storage bound; append does not establish a new persistence guarantee or durable server authority.
