# Search And Recommendations UI

Owner: Apollo.TF. Source slice based on `f89a78c`; no release/deployment change.

## Scope And Plan

1. Main: localized search states, touch-sized mode/source/type selectors and a retry using the failed request snapshot. Preserve quick/exact search, pasted-link metadata, suggestions, account-scoped recent searches, current CSRF and entitlement boundaries.
2. Fermat: compact recommendations, loading/empty/error states and recovery without replacing the recommendation service or its truthful basis labels.
3. Archimedes: shared compact track rows with visible playback affordance, named commands and stable download states. Preserve duration/preview admission and collection actions.
4. Main: integrated rendered checks at desktop/mobile widths and enlarged browser font; focused affected tests, TypeScript/build, review and local checkpoint commit. No unrelated application suites or duplicated feature implementations.

The accepted [shell/collection/player slice](2026-10-01-listener-ui-polish.md) remains the baseline. The new Platform visual delta is advisory, not a frozen cross-project design system: Segoe/system fonts, graphite surfaces, restrained Apollo violet, TF cyan as product identity rather than a connected/entitled status. Existing Radix, Lucide and Framer Motion/CSS cover these controls. No new dependency, Figma generation, Mobbin deep search, Rive mutation/export or MobileNext session is needed.

## Implemented

- Search type filters, exact-mode placeholders and errors are localized. Mode/source/type targets are at least 44 px. Retry displays and reuses the failed query/source payload, not subsequently edited fields; the mutation still reads current CSRF at execution time.
- Recommendations use the shared compact result row, restrained header, reduced-motion-safe skeleton, useful empty-search link and a neutral network-error retry. Loaded metadata belongs to a canonical account/installation/entitlement tuple and survives token-only rotation without automatic list refetch. Asynchronous requests retain security-generation/abort guards, restart if token rotation occurs while pending, and cannot publish stale successes/failures. Owner/rights changes and security suspension reset the snapshot. API HTTP failures retain the existing shared boundary, rather than being reclassified for cosmetic recovery.
- Compact playback is visible without hover, with a 48 x 48 px target. Named queue icons have 44 x 44 px targets. Download/cancel uses a stable 72 x 64 px slot, a separate reserved status line and full accessible status/title. Existing duration/preview admission, collection commands and download hooks were not replaced.

## Validation

The new search retry failed before implementation, then passed after receiving the original failed payload despite edited fields/source selection. Discover was observed RED (five failures) then GREEN (seven tests); TrackCard RED (eight failures) then GREEN (eleven tests). Existing tests were extended rather than adding parallel duplicate suites.

52 unique focused cases passed across Home/security generation, source preferences, the six affected Home/generated-search API-migration cases, three Home/navigation cases, Discover and TrackCard. Current unauthorized rejection was rechecked after adding the no-visible-retry assertion. The final Discover run has 13 passing cases, including real active-download hook behavior, pending-request renewal and account/installation/entitlement changes. Unchanged integration/provider/queue/playlist suites were not repeated. TypeScript and Vite production build passed again after the lifecycle correction. Untouched sheet/tooltip sourcemap diagnostics and the 645.90 kB JS-chunk warning remain visible.

Rendered Chromium used isolated HTTP fixtures on the existing loopback Vite server at `http://127.0.0.1:54196`. Viewports: 1440 x 900, 768 x 800, 390 x 844 and 320 x 740; actual browser default font 20 px was also checked at 320 x 900 and 768 x 1000. Verified:

- Failed free-text query retries with its original manual YouTube source payload and current CSRF header; edited form input is retained. Exact-mode keyboard submission still reaches the exact endpoint.
- Type filtering removes only matching result rows, not the persistent current-track player. The browser runner was corrected to scope result-heading assertions to `main`; a player title is not a failed filter.
- Playback affordance is opaque and 48 x 48 px before hover; modes render as 44 px targets, or 55 px at the enlarged default font.
- Long unbroken query/title/artist fields, unknown duration and unverified quality labels do not cause document/main horizontal overflow. Desktop/mobile screenshots were inspected for layout and coherent controls.
- Download wrapper dimensions are identical before/after active status. Cancel emits its request and shows canceled state; `preview_rejected` keeps the failure visible and sends the unchanged expected-duration value. No output file was fetched.
- Recommendations recover after a network abort, preserve the truthful liked-track basis and provide navigation from an empty result. No unexpected fixture request, page exception or Vite overlay occurred. Deliberate failed requests are fixture evidence, not provider outages.

Screenshot/runner/evidence prefix is `tf-search-20261001` in the calling chat's Codex visualizations directory, outside the repository. Coverless fixtures use the real missing-cover state, not fabricated album art. The restored queue remained paused; no media-playback claim follows.

## Known Limits And Next

Long terminal download messages are ellipsized in the reserved action slot. Their complete text remains in the accessible status/title and the existing failure toast; a touch-friendly persistent detail presentation is still useful. This is not silently promoted to a complete offline/error-inspection interface.

Read-only review found a P2 lifecycle regression: an exact-session snapshot reset on successful same-owner token rotation unmounted the result cards and orphaned the existing download controls. Chromium reproduced it with the normal scheduled renewal protocol, a new CSRF token and an active job; the original card became disconnected. The focused correction was observed RED then GREEN in both source tests and Chromium. The latter exercised `/auth/renew-context`, the 204 renewal and a new `/auth/me` session: the original card remained connected, only one job and one recommendation request existed, and the same job was canceled with the new CSRF. A read-only observer of the dev module's security generation waited for actual session commit; it did not bypass or replace authentication. Review of the correction found no further actionable issues. No download-job/authentication protocol was changed.

After that correction, the next independent media-correctness slice is a trusted expected-duration/recording-version reference for candidate admission. Do not implement another copy of existing preview filtering, lyrics, manual order, pasted-link parsing or queue recovery. True offline storage and cross-device queue authority remain separate policy/storage decisions, not CSS work.

## Boundaries

Local browser API fixtures are not live Platform login, audio playback, provider availability, physical Android or Coolify acceptance. Shared authentication/security mappings remain untouched. Spotify/Yandex remain metadata inputs. File download is not a durable offline library. HomeNode, Caddy, UFW, existing services, publication claims and the frozen native release candidate are outside this source slice.

Before any live rollout, use current authority/resource evidence and the existing [readiness packet](../operations/2026-09-23-tf-listener-readiness.md), not this local UI report.
