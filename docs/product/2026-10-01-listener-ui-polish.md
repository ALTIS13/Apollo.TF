# Listener UI polish

Owner: Apollo.TF. Scope: existing listener UI, source and isolated browser fixtures only.

## Implemented

- The shell keeps a persistent player and adds direct mobile navigation for search, recommendations, collection and queue. Connections and account actions remain in the drawer. The shell uses dynamic viewport height and a safe-area-aware bottom navigation.
- Graphite surfaces, restrained Apollo violet and TF cyan are retained. Typography now uses the Platform system-font stack, removing the Google Fonts network dependency. Focus states and accent foreground contrast are explicit.
- Normal liked-track rows keep play, playlist and saved-state commands visible. Manual ordering has an explicit edit mode with drag handles and keyboard arrows. Account reset, revision/CAS, pagination-tail protection, conflict recovery and busy-state handling are unchanged.
- The player uses stable 40 px controls, a labelled native volume range, a desktop queue shortcut and reduced-motion-safe states. Timed lyrics remain the existing drawer, not a new implementation.
- Collection source/view selectors use native buttons with pressed state; the old partial ARIA tab implementation no longer implies unsupported tab keyboard behavior.

## Design Sources

- Current Platform tokens were read from `artifacts/platform-web/public/styles.css` in its owner worktree: graphite surfaces, Segoe/system typography, restrained violet and thin icons. No Platform file was edited. TF retains its own cyan playback accent.
- Mobbin references: [Spotify library](https://mobbin.com/screens/fd00bec6-299f-4a82-9b99-448f679233cc) and [lyrics with persistent playback controls](https://mobbin.com/screens/ff9901a2-78b3-44fb-a2ab-4125118089bc). Layout hierarchy informs the existing application; no Spotify assets or audio were copied.
- Intentional differences: TF keeps separate source-library controls and capability-gated integration access. Small state-driven UI transitions use the already installed Framer Motion/CSS, not a new animation runtime.

## Tooling And Ownership

The ignored `.ops-private/tooling-inventory-2026-10-01.json` records 544 current tool definitions and 208 locally discovered skill files. Cached skill presence is not the same as an active session skill; connector presence is not proof of permission or quota. Account-backed tools were not exhaustively invoked.

Mobbin returned two web references in one standard search. Figma account metadata confirmed an authenticated Full seat; no canvas mutation or generation was performed. Updated local Rive MCP v0.6 passed initialize, tools/list and read-only session_info. Its editor currently has no open file; no animation export, generation or mutation was performed. Rive tools are not registered in this session catalog, so this check used the configured loopback MCP endpoint. Browser/CUA tools are absent; the existing bundled Playwright/Chrome supplied rendered evidence. MobileNext was not allocated; physical Android remains A063/ADB when testing is in scope.

Two bounded workers owned Player and LikedCollection respectively. The TF owner integrated shell/styles/collection header and rendered QA. A worker reviewed the combined source patch read-only. Direct communication with Apollo Web Platform supplied the new Rive availability and TF source paths; no other project was modified.

## Validation

Focused Vitest checks: 48 passing across Sidebar, ClientNavigation, Player, LikedCollection, liked collection hooks, playlist hooks and LyricsPanel. New behavior was observed red before implementation. TF web TypeScript passed. Vite production build passed with non-blocking sheet/tooltip sourcemap diagnostics in untouched files and the large-chunk warning; these warnings were not suppressed.

Playwright Chromium used HTTP fixtures at `http://127.0.0.1:54196`, with 1440 x 900, 768 x 800, 390 x 844 and 320 x 740 viewports. Each exercised edit-mode keyboard reorder with a revisioned PATCH, adding a track to a playlist, navigation to queue, current timed-lyrics line, shuffle and repeat. Desktop volume change was checked. Document/main horizontal overflow, console errors and framework overlays were absent. A missing `tf.search` entitlement still denied the entire listener shell.

Read-only review found two real defects, both reproduced before correction in Chromium with a 20 px browser default font. Mobile navigation rendered as a 217 px vertical block because its px-based display rule disagreed with the rem-based breakpoint. The display now uses the same Tailwind grid/md-hidden rules as the shell and rendered as a 61 px horizontal grid. The lyrics feedback submit button retained white text on the new cyan primary background (1.57:1 contrast); it now uses primary foreground (11.83:1). The focused rendered recheck passed after these corrections. No feedback request or authentication contract changed.

Screenshots and the fixture runner/evidence are outside the repository in the calling chat's Codex visualizations directory, prefix `tf-ui-20261001`. Visual inspection compared typography, neutral surfaces, cyan/violet accent roles, list density, stable controls and responsive navigation to the existing TF screenshots and Mobbin references. Metadata fixtures without cover URLs use the real missing-cover state, not fabricated artwork.

This is not real Platform login, media playback, provider availability, Coolify, HomeNode, production or physical-phone acceptance. No authority/authentication/stream contract, database migration, provider behavior or release claim was changed. The previously frozen release candidate must not be assumed to include this new UI source.

## Next

Bring search/recommendations into the same listener hierarchy, using the current shared Platform visual delta when available. Keep the existing search, provider parsing, duration rejection and lyrics triage implementations rather than rebuilding them. Integrated authentication/audio validation and immutable publication remain gated by the existing [readiness packet](../operations/2026-09-23-tf-listener-readiness.md).
