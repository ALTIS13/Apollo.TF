# Pasted public track links

## Contract

`POST /api/tracks/link-metadata` requires `tf.search` and accepts one HTTPS track-page URL. Its additive response is `{schemaVersion:1, source, title, artist?, durationSeconds?}`. Stable errors are `bad_request` (400), `unsupported_media_link` (422), and `media_link_unavailable` (503). The route does not return an ID, preview, stream, download URL, or playback permission. The web player resolves the link to metadata, then uses the existing exact or free-text search. The user still selects a separately verified candidate; the existing preview-length admission remains on that path.

The allowlist covers individual YouTube/YouTube Music videos or shorts, SoundCloud tracks, Bandcamp track pages, and Deezer track pages. Spotify and Yandex Music remain metadata/library integrations, not pasted audio sources. Playlists, profiles, direct media/CDN URLs, arbitrary redirects, non-HTTPS URLs and encoded path escapes are rejected. YouTube `si`/`t` share parameters are discarded before canonical lookup. Provider responses are size- and time-bounded, and yt-dlp receives only reconstructed canonical URLs with no shell or user-supplied options. A provider failure cannot revoke the TF browser session; auth/policy failures still do.

## Evidence And Limits

- Route, capability coverage, resolver and Home integration checks ran focused; API and web typechecks/builds passed. A synthetic Playwright flow at desktop and 390 px showed link to result and unsupported link to inline error without stale results or auto-play. Browser plugin was not callable.
- The public [SoundCloud oEmbed example](https://developers.soundcloud.com/docs/oembed) confirms the fixed endpoint and its `title by author` shape; live oEmbed and Deezer track metadata were read without fetching previews. SoundCloud's [API guide](https://developers.soundcloud.com/docs/api/guide) distinguishes playable, preview and blocked access, so metadata alone is not media admission.
- Provider tests otherwise use bounded fakes. Local Docker daemon was unavailable; container yt-dlp, live YouTube/Bandcamp, target Coolify, entitlement issuer, and final-file duration evidence remain unverified. No deployment or HomeNode service was changed.
