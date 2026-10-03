# Browser Media Session Controls

Owner: Apollo.TF. Base: `43d8a24`, `codex/tf-listener-experience`.
Continuation of the approved listener controls plan. The saved next-duration
item was stale: source-bound comparison and cold revalidation already shipped
in `33f3f89` and `77bd542`; do not implement them again.

## Behavior

Use the browser's existing Media Session API to expose the current title,
artist, safe public artwork, playback state, and bounded position. System
play/pause must express that command directly, never toggle the opposite state.
Next/previous reuse current queue/repeat semantics. Seek uses the current media
duration and clamps valid seconds to its range; reject non-finite or negative
offset inputs. Missing or unsupported API operations must leave ordinary player
controls usable.

Bind actions to the current authenticated TF session with `tf.search`. Existing
security-generation and suspension checks apply synchronously, including a
sleeping tab whose session has expired before its React update. Clear system
metadata, position, and callbacks on access loss, account replacement, empty
player, or unmount. A saved queue stays paused until an explicit play command.
Pausing a pending load fences its late completion; resume uses existing stream
resolution/recovery rather than a parallel audio or auth implementation.

## Tasks

1. Add focused integration regressions using real PlayerProvider, TfAuthProvider,
   session boundary, and queue state; replace only browser/network boundaries.
   Observe missing metadata/action behavior failing before implementation.
2. Add a small optional browser bridge and connect it to existing player actions.
   Split explicit play/pause from toggle while preserving existing UI behavior.
3. Verify the changed controls, adjacent stream-recovery behavior, player
   TypeScript/build, and actual Chromium Media Session with local controlled
   HTTP/audio inputs. Keep physical headset/Android evidence separate.
4. Reuse the existing reviewer for this bounded diff, address real findings,
   update checkpoint/evidence, and commit/push owned files.

## Boundaries

No public DTO, Platform policy, session ownership, queue persistence, source
admission, provider, database, lockfile, or deployment changes. Coordinator canary
remains paused. Use installed tooling; no paid design generation or MobileNext
session is needed for browser controls. Focus verification on changed behavior,
not the unchanged application suite. Source/browser fixtures do not establish
authenticated canary or physical lock-screen acceptance.

Reference: [W3C Media Session](https://w3c.github.io/mediasession/).
