# Browser Media Session Controls: Evidence

Owner: Apollo.TF. Branch: `codex/tf-listener-experience`. Base: `43d8a24`.
Source implementation and controlled native-browser verification are complete.
This is not authenticated canary, production, or physical-device acceptance.

## Delivered

- Current recording title, artist, safe HTTPS artwork, playback state and bounded
  position are exposed through the optional browser Media Session API.
- Explicit play/pause, next/previous and seek reuse the existing player, queue,
  repeat and stream-recovery paths. Unsupported browser operations do not break
  ordinary controls. Restored queues remain paused until an explicit command.
- Current TF session, `tf.search` and security-generation checks fence commands.
  Access loss, expiry, empty queue and unmount clear system metadata and handlers;
  retained callbacks cannot start protected activity after their owner expires.
- Intentional pause cancels a pending load without misclassifying a late play
  rejection as a broken source. A saved resume position survives cancellation;
  a newly selected recording cannot inherit a delayed old recording position.
- No public DTO, Platform authority, persistence, database, provider, lockfile,
  infrastructure or deployment changes.

Plan: [bounded implementation plan](2026-10-02-media-session-plan.md).
API reference: [W3C Media Session](https://w3c.github.io/mediasession/).

## Validation

- RED/GREEN integration cases use real PlayerProvider, TfAuthProvider, session
  boundary and queue state; only Audio/MediaSession/HTTP boundaries are doubled.
  The final focused run passed **25 unique cases**: 13 new Media Session cases
  and 12 affected existing queue, expiry, stream-recovery and remote-load cases.
  Three test files passed; 36 unrelated cases were intentionally skipped.
- The existing read-only reviewer identified two concrete races: an intentional
  pause during pending ordinary resume triggered false recovery, and canceling a
  restored stream lost its saved position. Both were reproduced failing, fixed
  and included in the final passing run.
- Native Chromium verification exposed a reset-order issue: clearing/loading an
  audio source can make it paused without emitting the pause event. Pause now
  precedes source reset and explicitly updates playback state. A separate failing
  regression covered a delayed old timeupdate leaking into a new recording.
- `pnpm --filter @workspace/music-player typecheck` and `build` passed after the
  final source change. Existing UI sourcemap diagnostics and the large-chunk
  warning remain; the build exits successfully. No unrelated optimization was
  included.

The focused Vitest run selected these affected behaviors in
`tf-media-session.integration.test.tsx`, `tf-protected-runtime.test.tsx` and
`tf-player-successor-ws.integration.test.tsx`, using one worker. An intermediate
parallel run hit an existing playlist fixture timing failure; that case passed
alone, with its selected neighbors, and in the final combined one-worker run.
No unrelated fixture rewrite was made and no full-suite acceptance is claimed.

## Native Browser Evidence

Chrome `154.0.8037.58`, desktop `1440x900` and mobile-size `390x844`, against the
existing local server at `http://127.0.0.1:54196/favorites` with controlled HTTP
and session inputs. Audio was a generated 200-second silent WAV decoded by a
real HTMLAudioElement, not a provider recording or mocked Audio object.

Both viewports passed metadata, explicit play/pause, seek/resume, next-recording
reset to zero, disabled end-of-queue next, valid native position and access-loss
checks. No page errors or horizontal overflow were recorded. The mobile capture
was visually inspected. The restored paused queue made no stream request before
an explicit play command; retained callbacks made no new request after access
loss.

Evidence is retained in ignored operational scratch:
`.superpowers/sdd/media-session-20261002/browser-evidence.json`,
`browser-1440.png`, `browser-390.png` and `browser-qa.cjs`.
The harness invokes callbacks registered with the real browser API; physical
headset/OS media-key delivery, Android A063 and real Platform sessions were not
exercised. The plain local URL still requires its real authentication services;
the fixture run does not turn it into an authenticated beta preview.

## Continuation

The saved duration backlog was stale: source-bound admission (`33f3f89`) and
cold revalidation (`77bd542`) already exist. Do not repeat them. The next
independent listener gap to assess is replacing an unavailable queue recording
with another permitted source without discarding the remaining queue.

The coordinator-owned Auth -> Platform -> TF canary remains paused. Existing
[GHCR admission evidence](../operations/2026-10-02-tf-ghcr-native-admission.md)
is unchanged; this slice was not built or published on HomeNode and does not
change the publisher gate or the staged application release identity.
