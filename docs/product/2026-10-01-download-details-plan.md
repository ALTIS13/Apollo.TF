# Touch-accessible recording and download details

Approved next source task from listener resume, base `39c4b06`.
TF-owned UI only, no entitlement/session/API schema/worker/infrastructure changes.

## Acceptance

- TrackCard has an always-reachable named 44px info icon, keyboard/touch accessible.
- Existing 64x72px download/cancel area stays stable. Short visible failure label
  fits; full reason and safe known code are available by tap, not hover alone.
- Reuse existing Radix/shadcn Dialog/Button/Alert; full recording identity, source,
  candidate duration and source quality labels wrap on narrow screens. Never claim
  catalog labels are verified final file quality; no raw errors/provider details.
- Failure dialog offers retry (same recording, existing download admission), and
  search for another source. Navigation preserves exact artist/versioned title,
  does not automatically play/download or mutate liked tracks/collections/queue.
- Search navigation works even from the already mounted Home route. Consume each
  valid artist/title URL once, populate the existing fields and preserve manual
  source preferences. Reject blank/oversized pairs; no hard reload/parallel search UI.
- Keep reduced-motion and focus restoration; dialog fits 320px and desktop, long
  strings scroll/wrap rather than overlap. Existing close icon needs a 44px target
  and Russian accessible name for this dialog without changing shared primitives.
- Focused TDD and real browser desktop/mobile interaction checks. Source/synthetic
  browser proof only, not real auth/provider/audio/device/deployed acceptance.

## Tasks

1. Main owns TrackCard.tsx/tests and a small TrackDetails dialog component: TDD for
   touch/keyboard details, sanitized known/generic failure, retry and encoded search.
2. Fermat owns Home.tsx and tf-home-generation.integration.test.tsx: reactive bounded
   query consumption, focused RED/GREEN for same-route search navigation and guards.
2b. Archimedes owns use-track-download.ts/test: preserve structured queue-admission
    duration_unverified 503 / preview_rejected 422 in failed snapshot. Unknown/raw
    codes remain generic; authentication forwarding/cancellation lifecycle unchanged.
3. Main browser/build/type integration, Goodall independent stage-diff review.
   No duplicate full API/search/hook suites, paid animation generation or deployment.

## Tool Choice

Mobbin: one standard search, two Spotify modal previews inspected, no repeated paid
search/generation. Existing Dialog/Alert/Button/Lucide reused. Figma/Rive tools are
callable but no design-file rewrite/new animation needed. Browser plugin/skill is
not available this session; use existing Playwright fallback, no MobileNext/A063.
No new sidebar tasks, use existing subagents with disjoint write scope.

## Status

- Task 1: complete; seven new cases including review-discovered retained-session portal regression, 18 affected TrackCard cases GREEN.
- Task 2: complete; 11 new Home integration cases GREEN, 18 selected with security/link boundaries GREEN.
- Task 2b: complete; exact safe admission pairs preserved, 21 selected hook cases GREEN.
- Task 3: complete. Final desktop/mobile/narrow QA GREEN after local motion/stacking/portal corrections, including synthetic auth suspension/recovery. Final TypeScript/build GREEN. Independent R1 delta review APPROVED_SOURCE_ONLY, no remaining findings. Local source checkpoint only, no push/deploy.
