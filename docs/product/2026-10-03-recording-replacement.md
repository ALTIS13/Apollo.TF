# Queue-Preserving Recording Replacement

Source: `cb91727d7e24aa277cbfa607da4a6cc1e182869b` on
`codex/tf-listener-experience`. Continuation of the accepted listener checkpoint;
no new login, public DTO, schema migration, provider credential or release identity.

## Completed Behavior

- A known source/admission failure offers an SPA link to exact artist/title
  search. The mounted player and queue survive navigation.
- A temporary marker binds the action to the failed occurrence, source/ID,
  current load and TF security generation. The URL carries only an opaque local
  marker; search sends the existing request body without it. No marker is saved
  in the queue snapshot or accepted as access authority.
- Results have an explicit replacement action, distinct from normal play.
  Choosing a candidate consumes the marker once, retains occurrence/original-order
  identities and all other slots, and resets candidate progress to zero.
- The failed recording itself, stale/consumed/cancelled markers, removed targets
  and old-account results cannot fall through to ordinary `playTrack`.
- A pending replacement has a cancellable occurrence/load identity. Cancellation
  stops its connection, not the already selected queue metadata; that recording
  remains paused for a later explicit queue selection. Removing its slot prevents
  a delayed response from starting audio. Normal next/previous/shuffle semantics
  remain the existing implementation; replacement never initiates auto-skip.
- Normal searches leave replacement mode. A late completion cannot clear a newer
  search. Cancelled result cards are removed rather than relabelled as normal play.

## Validation

- RED/GREEN: seven marker/occurrence cases, three initially failing Home flows,
  two review-reported delayed-stream cases and a repeated-removal regression.
  Existing account-generation coverage was extended instead of duplicating it.
- Final focused runs: **21 protected-runtime cases PASS**, 13 unrelated cases
  skipped; **29 Home integration cases PASS**. Total **50 unique cases**.
  The Home request-variable change affects its search, retry, suggestion and
  navigation flows, so that small integration file was checked in full.
- The harness now waits for Audio creation before direct player calls and wraps
  the affected manual-start event in `act`; intermittent pre-effect startup was
  not treated as product failure or hidden with arbitrary sleeps.
- Typecheck, production build and `git diff --check` PASS. Existing UI sourcemap
  diagnostics and the large-chunk warning remain; no unrelated optimization.
- Mill wrote only the Home test harness. A fresh read-only reviewer found the
  delayed cancellation/removal race and null pending removal access. Both were
  reproduced, fixed and reviewed; no remaining actionable findings were reported.

## Browser Evidence

Chrome extension control worked. Local compiled UI used controlled HTTP and a
synthetic renewal-v1 session, with a real HTMLAudioElement decoding a generated
200-second silent WAV. Checks covered desktop `2560x1249` and `1440x900`, plus
mobile-size `390x844`: nonblank intended page, no framework overlay, no relevant
console errors, no horizontal overflow and visible responsive controls.

Observed: collection -> failed middle entry -> SPA search -> one-slot replacement;
pending candidate -> cancel -> release late HTTP response -> no playback event;
explicit queue selection afterward -> playback; stale marker after reload ->
disabled replacement cards. The before/after queue retained three entries.
HTTP receipts confirm no local marker in search bodies.

Artifacts remain outside source under
`C:/Users/maksi/.codex/visualizations/2026/06/23/019ef2c2-95cb-7d01-9951-aa0abfe25d37/`:
`tf-replacement-browser-evidence.json`, `tf-replacement-http-receipts.json`,
`tf-replacement-desktop.png`, `tf-replacement-mobile.png`,
`tf-replacement-queue-mobile.png`, `tf-replacement-stale-mobile.png`.
This is not live provider media, production Auth/Platform, physical Android/A063,
headset delivery or Coolify acceptance. The loopback fixture is not beta access.

## Ownership And Continuation

Root's accepted renewal-v2 source remains `1f49e426f694778850f6885e669b865471d6b1b7`,
**SOURCE_INTAKE_ACCEPTED / NOT_RUNTIME_ADMITTED**. Its corrected separate intake
file raw SHA256 is `ad234e2650650ecf94c46a5ef3d7c2a592ce334a33da8e9976c6dea735f175d5`.
This product commit is not silently added to that canary/image candidate.
No HomeNode/Caddy/container/credential/Platform authority was changed.

Next independent assessment: compare current Discover/recommendations against the
saved UX audit for negative preferences and per-track recommendation explanations.
Choose only a missing bounded behavior after checking current code. Offline and
cross-device contracts remain Platform-owned. Runtime activation waits for the
root-owned signed profile, isolated fixture/cleanup and publisher/runtime receipts;
do not repeat unchanged admission or accepted search/lyrics/duration stages.
