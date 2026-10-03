# Playlist metadata export

Owner: Apollo.TF. Scope: web-player source and isolated browser fixtures only.

## Delivered

- The selected Apollo-owned playlist has an accessible download menu for JSON and CSV, using the existing Radix components and a 44px minimum icon target.
- JSON uses `apollo.tf.playlist-export.v1`, playlist name/description and ordered artist/title/duration metadata. CSV includes displayed position, artist, title and duration, UTF-8 BOM, CRLF, escaped cells and formula-prefix protection. Unknown duration remains empty in CSV and null in JSON.
- Explicit field projection excludes account/device IDs, track IDs, stream/thumbnail URLs, timestamps and arbitrary extra server fields. This is a playlist metadata export, not an audio/offline download or provider-library export.
- Unicode filenames are bounded and strip forbidden/control/bidi characters. Empty playlists are supported; inconsistent track counts are rejected instead of silently exporting a partial list.
- Export requires `tf.collections`, the current account and exact current security-session witness. Detail refresh/error, pending order/removal/deletion and delete confirmation disable the action. Session/scope suspension closes the menu. Temporary download anchors and Blob URLs are released; a thrown browser failure shows the existing error toast.
- Compact header actions wrap on narrow screens. Real browser inspection exposed an existing implicit-grid sizing defect: long playlist names pushed row controls outside the mobile viewport. Explicit `grid-cols-1` fixes it while preserving the desktop template.

## Validation

- TDD: initial UI baseline 4 failed/1 passed because export was missing; serializer worker reproduced a failing baseline before implementation. Final controller run: 13/13 focused export tests PASS. Existing playlist hook regression: 2/2 PASS.
- UI tests cover local export without API writes/queue mutation, pending reorder and acknowledged order, stale rendered session versus replaced security session, download failure cleanup and failed detail load. Serializer tests cover projection, order, CSV injection/escaping, empty/inconsistent lists and filename safety.
- Music-player typecheck PASS after correcting two test-only locator options. Final production build PASS; existing shared Radix sourcemap diagnostics and the >500kB chunk warning remain, not claimed fixed.
- Isolated Playwright/Chrome fixtures: 1440x900, 390x844 and 320x740, default font 20px and reduced motion. JSON and CSV actually downloaded at every viewport; decoded content/order and filenames matched, queue unchanged, no unexpected API calls or console/page errors.
- Mobile geometry regression was reproduced as RED before the explicit column fix, then GREEN: no playlist buttons escape their container, no inner/document horizontal overflow, menu stays in viewport. Screenshots visually inspected at desktop and 320px.
- Independent review of the UI integration found a label-in-name accessibility mismatch. The accessible play command now reads `Слушать плейлист`, matching the visible `Слушать`; the existing playback regression was updated and passed (2/2). Final bounded review reports no remaining findings. Controller reviewed the separately implemented serializer.
- Browser script, screenshots and evidence: local visualization directory `019ef2c2-95cb-7d01-9951-aa0abfe25d37`, files `tf-playlist-export-20261002-qa.cjs`, `tf-playlist-export-20261002-evidence.json` and matching viewport PNGs. These use synthetic session/HTTP fixtures; they are not authenticated Platform, database, physical-phone or Coolify acceptance. Real spreadsheet applications have not been exercised.

## Release Boundary

- No API/DB schema, Platform authority, production services, Caddy, HomeNode or container registry changed.
- The authenticated Chrome extension still discovers tabs but reading/claiming the existing GitHub tab times out on `Emulation.setFocusEmulationEnabled`; the previous saved-permission error did not recur in the current attempts. No runtime patch, permission bypass or PAT creation was performed.
- Local fixture QA is separate from the blocked authenticated GitHub action. The preview is loopback-only at `http://127.0.0.1:54196/favorites`, without a live API/session; opening it alone does not authenticate a user.
- Frozen source `f3828eb016e9dc034030e2da7ca2c2a39f4327c1` still excludes newer listener work. Fresh publisher custody, exact successor image admission, Platform/Auth and restore evidence remain required before deployment. Do not repeat old builds or relabel that candidate.

Next independent source gap: trusted recording-duration/version admission; offline/cross-device policy remains Platform-owned.
