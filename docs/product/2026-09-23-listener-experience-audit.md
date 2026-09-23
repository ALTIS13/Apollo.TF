# Apollo TF listener experience audit

Status: source/design audit, not live service acceptance. Scope: TF web client and its owned search/playback/collection modules. Platform remains authority for identity, sessions and entitlements. No production deployment is implied.

## Product boundary

- Spotify and Yandex Music connections supply account library metadata and discovery context. Apollo TF must not present their protected audio or lyrics as its downloadable source.
- Apollo TF resolves independent candidates from supported media sources (currently YouTube, SoundCloud, Bandcamp and Deezer in search), and lyrics through its separate lyrics endpoint (LRCLIB, then lyrics.ovh). A public URL, an older upload, or a paid subscription does not by itself establish permission to store or redistribute media; acquisition must obey the source's terms and rights policy.
- Search ranking, playback, downloads and offline admission must agree on which candidate is a full recording. A preview must not become a playable/downloadable "full" track merely because one endpoint missed a signal.

## Listener journey versus reference products

Spotify and Yandex Music are UX references, not source-of-file contracts. See their documented [search](https://support.spotify.com/us/article/search/), [queue](https://support.spotify.com/us/article/play-queue/), [lyrics](https://support.spotify.com/us/article/lyrics/) and [offline](https://support.spotify.com/ly-en/article/listen-offline/) workflows, and Yandex's [queue](https://www.yandex.ru/support/music/ru/listening/playback-queue), [lyrics](https://yandex.ru/support/music/ru/listening/lyrics), [liked tracks](https://yandex.ru/support/music/ru/collection/likes-and-dislikes) and [offline](https://www.yandex.ru/support/music/ru/listening/listening-offline) guidance. Spotify's [Web API track reference](https://developer.spotify.com/documentation/web-api/reference/get-track) explicitly does not authorize downloading Spotify content through the API.

| Journey | TF source state at this audit | Gap and acceptance target |
| --- | --- | --- |
| Enter and refine search | Separate artist/title fields, source filters, result cards | One-box artist/title/paste-URL parsing, debounced suggestions, recent searches, filter persistence; same query contract on web/mobile. |
| Identify the right recording | Source, title, artist, duration and score; media-completeness filter | Surface version/source/quality/confidence and a clear full/uncertain/preview state; matching must use expected duration and release/version metadata where available. |
| Play and continue listening | Play/pause, seek, volume and queue | This branch adds play-next, upcoming reorder, and clear-upcoming without stopping current track. Still missing repeat, shuffle, persistent queue, next-track error recovery and durable resume. |
| Read lyrics | Server endpoint exists but was not exposed in the client | This branch adds on-demand plain/synced lyrics panel with seek-to-line. Still need licensing/display provenance, mismatch reporting and synchronized-line quality monitoring. |
| Save and organize | TF liked collection backed by account API; Spotify/Yandex liked and playlists browsable | This branch adds account-scoped liked-status lookup and save/remove on search and recommendation cards. Provider item -> candidate -> save flow still needs fewer steps; Apollo-created playlists, reorder and batch actions are absent. |
| Use connected accounts | Spotify connect/status and library UI; Yandex status/library paths | Yandex onboarding is explicitly unavailable; status must distinguish disconnected, expired grant, degraded and policy-denied without losing TF session. Imported metadata is not an audio entitlement. |
| Download and listen offline | Server job then browser file download | Not an offline library. Requires allowed-source policy, stable file identity, client storage/index, integrity, disk quota, renew/revoke behavior, and Platform capability check. Do not label the existing browser download button "offline mode". |
| Recover from problems | Per-action errors and some retry controls | Explain source unavailable, preview rejected, geo/source restriction, expired media URL and lyrics mismatch with stable codes; offer alternate candidate and preserve queue/collection context. |

## Preview/full-track quality gate

Current `tf-search/src/media-completeness.ts` rejects Deezer preview CDN media, title markers (including demo/preview/30 sec) and short duration outliers when a reference original of at least 90 seconds is available. It excludes short results from the reference median and can use Deezer's catalog duration without accepting its preview as audio. `api-server/src/routes/tracks.ts` does not use a Deezer preview as a full playback substitute; it searches another candidate. These are useful checks but not complete proof: an isolated 30-second candidate without a trusted expected duration can pass the search filter, and a catalog can report stale or mismatched duration.

Next implementation should carry optional expected duration and version from connected-account metadata or a trusted catalog lookup into candidate matching, without making that provider the audio source. Reject or label as uncertain when candidate duration is roughly 30 seconds and substantially shorter than a reliable reference; never reject all songs under a fixed threshold because legitimate tracks may be short. Keep explicit preview URL/title rules. At playback and download admission, recheck resolved media length against the selected full-track candidate and fail closed on a detected preview. Expose `preview_rejected` versus `duration_unverified` as stable codes and measure rejection rates by source. Use fixtures for a legitimate 25-second track, 30-second preview of a 3-minute track, alternate live/remix versions, missing durations and stale metadata.

## Ordered next slices

1. Completed in this branch: lyrics and queue UX, focused tests and browser/mobile-width check.
2. In progress: preview filtering at search and account-scoped liked-status lookup on search/recommendation cards. Playback/download duration verification remains the highest media correctness risk.
3. Add one-box search and clear candidate-quality indicators, then make provider-library -> TF candidate -> TF save/play a single understandable journey; build Apollo-owned playlists.
4. Add repeat/shuffle and persisted queue/resume with account scoping and multi-device conflict rules.
5. Design true offline library only after source permissions, Platform entitlement/revocation behavior and storage lifecycle are agreed. Android remains deferred per user direction.

Validation for each slice should cover changed behavior and adjacent security/ownership boundaries, not re-run unrelated suites. Live provider availability and media rights remain separate operational checks.
