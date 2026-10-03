# Recording and download details

Owner: Apollo.TF. Base: `39c4b06`, branch `codex/tf-listener-experience`.
Source/UI checkpoint only; Platform identity, policy and entitlements remain unchanged.
Plan: [download details](2026-10-01-download-details-plan.md).

## User-visible change

- A named 44px info control opens full source, recording version, catalog duration
  and unverified source quality labels. The same existing Russian version label is
  used in the row and dialog. No additional UI library or animation runtime.
- Short terminal failure labels fit the existing 64x72px download area. Full safe
  reason and known code are available by touch or keyboard, not hover alone.
- Retry uses the same recording and existing queue admission. Another-source
  navigation retains the exact artist/versioned title and respects the Router base;
  it does not play, download, or modify liked tracks, playlists or the player queue.
- Already-mounted Home consumes one bounded artist/title pair, preserves manual
  sources and unrelated URL/history/hash state, and rejects ambiguous/invalid input.
  Existing security-generation checks still reject old-session responses.
- Queue admission now preserves only structured numeric 503/duration_unverified
  and 422/preview_rejected. Raw messages, unknown or misleading codes remain generic;
  current authentication error forwarding and late cancellation guards are unchanged.
- The dialog subtree is immediately removed when authentication is suspended. Its
  local open state resets, so a retained session cannot expose a body portal or
  reopen it automatically after access recovery. The shared session boundary is unchanged.

## Focused verification

Three disjoint tasks used the existing workers and main, then a read-only reviewer.
No new sidebar tasks, cross-project writes, full unchanged API suites or commits by workers.

| Surface | Evidence |
| --- | --- |
| TrackCard/details | Six initial new cases RED -> GREEN; independent-review portal case also RED -> GREEN. Final 18 affected cases GREEN. |
| Mounted Home | 10 intended RED failures, one already-passing negative control; 11 new cases GREEN, 18 selected including link/suggestion/security boundaries GREEN. |
| Queue hook | Two safe-pair RED failures; 21 selected cases GREEN, including 12 new and nine reused/updated admission/auth/cancellation cases. |
| TypeScript | `pnpm --filter @workspace/music-player typecheck`, exit 0 after final component interface and worker integration. |
| Production CSS/bundle | Final `pnpm --filter @workspace/music-player build`, exit 0; 2247 modules, 18.55s after portal gate. |
| Independent review | R1 portal finding reproduced and corrected; seven final blobs verified, spec/quality APPROVED_SOURCE_ONLY, no remaining findings. |

Total: **57 unique selected cases**, including **30 new cases**. Repeated GREEN
commands are not added to totals. Detailed selectors, RED/GREEN output and worker
blob IDs are in ignored `.superpowers/sdd/download-details-20261001` reports.
Existing sheet/tooltip sourcemap diagnostics and the >500kB bundle warning remain
non-blocking, unsuppressed and outside this stage; no chunk/performance improvement
is claimed.

## Rendered QA

Browser plugin not available in this session. Bundled Playwright used installed
Chrome 154.0.8037.58 in isolated test profiles, without using personal tabs or data.
Flow: Home exact recording -> failed download -> full details -> explicit retry ->
second safe failure -> another-source link -> exactly one search on mounted Home.
Loopback fixture API supplies synthetic identity/metadata/admission failures;
production source/authentication guards were not replaced.
Validation entry was `http://127.0.0.1:57464/`, fixture API `127.0.0.1:57465`.
These temporary test servers are stopped after QA, not published player endpoints.

| Check | Result |
| --- | --- |
| Page identity / meaningful content / framework overlay | PASS |
| Desktop 1440x900, touch 390x844, long metadata 320x640 | PASS |
| Horizontal overflow / bounded scrollable modal | PASS |
| 44px info/close controls and stable 64x72px download area | PASS |
| Escape focus restoration and actual close click/tap | PASS |
| Reduced motion / full safe failure / retry / one-shot recovery | PASS |
| Real auth provider/boundary with synthetic renewal failure and explicit recovery | PASS on desktop; portal removed, retry reachable, old dialog not reopened |
| Unexpected API operations, page errors, relevant warnings | None |

Expected Chrome resource diagnostics are the deliberately injected 503/422
admission responses and the desktop renewal 503. Framer Motion emits its development reduced-motion notice;
no unexpected warnings were ignored. Card-relative geometry was compared, not
viewport coordinates after normal browser scroll-into-view.

Rendered QA exposed two real issues and validated their narrow local corrections:
the primitive's state animation overrode reduced motion (local important utility),
and the narrow-screen toast visually covered the dialog heading/close (local dialog
stacking above transient notifications). The latter had a failing rendered
overlap/paint-order check before correction. Shared Dialog/Toaster are unchanged.
Independent review additionally found the retained-session portal escape. Its
focused regression reproduced the visible dialog above hidden application content;
browser QA then exercised the actual auth provider's renew-context -> renewal 503 ->
recovery retry -> renewal 204 -> session refresh, with controlled DTOs only. Typecheck
also caught an unsupported Testing Library `exact` option in this new test; removing
the option preserves literal accessible-name matching and final TypeScript passed.

Screenshots, fixture runner, finite browser script and browser-result.json are
outside source under the calling chat's visualizations directory:
`tf-download-details-20261001/`. Desktop, mobile and narrow screenshots were inspected.
Missing covers use the existing placeholder; no fabricated artwork.

## Design and tool use

One standard Mobbin search returned two inspected Spotify modal references. The
[compact details modal](https://mobbin.com/screens/f7801d88-59e8-4e7d-9908-89fcea7fd095)
informed hierarchy only. TF retains graphite, its mint playback accent and existing
primitives; no Spotify assets were copied. Figma/Rive are callable but not needed
for this small state dialog; no paid generation, MobileNext, A063 or new installs.
Installed/callable presence is not permission or quota proof.

## Limits and next stage

No real account, provider, audio, physical phone, database, Coolify or production
acceptance is claimed. No HomeNode/Caddy/UFW/Remnawave/Docker change, push, new PR,
GitHub Actions or billing work. Browser file download is still not an offline library.

Do not rebuild the accepted search/queue/lyrics/collections/source-admission stages.
Next: prepare a fresh TF-only immutable container/release candidate for these source
changes, with isolated target/runtime verification and rollback evidence. Actual
canary activation still needs current Platform issuer/JWKS/client proof and a scoped
Coolify prestate. The old private readiness packet is not fresh live evidence.
True offline storage and cross-device queue authority remain separate design gates.
