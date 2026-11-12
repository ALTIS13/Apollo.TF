# Spotify library rate limits

[Spotify documents HTTP 429 and Retry-After](https://developer.spotify.com/documentation/web-api/concepts/rate-limits#develop-a-backoff-retry-strategy) for Web API rate limits. TF distinguishes those from an expired Spotify grant, an Apollo authorization failure, and other upstream failures. This change covers the Spotify library reads used by import and browsing; it does not grant new provider permissions.

- The integrations adapter returns a signed, correlated `provider_rate_limited` failure. Only a bounded decimal delay (0 through 86,400 seconds) can cross the internal contract. Upstream text, headers other than the parsed delay, and request credentials stay inside the provider adapter. No upstream retry or sleep.
- TF API sends `429` and `{ error: "spotify_rate_limited", retryAfterSeconds?: number }` with `Cache-Control: no-store`. When the delay exists, the response also carries `Retry-After`. The Web client uses the JSON field, so it does not depend on exposing that header across origins. The paged read stops; incomplete metadata is not committed.
- The Web client does not end the Apollo session or invalidate the Spotify connection for this code. It waits locally and offers explicit retry; missing or invalid delay uses a local 30-second pause, not an invented upstream header. No automatic retry at the deadline and no disk persistence of cooldown state.

## Release boundary

The new reader still accepts old module replies. An old strict TF API cannot decode the added internal error variant and will report a generic failure. For a separately rolled stack, update TF API before the integrations module; roll back the module before the API. An aligned image set is preferred. The Spotify app registration, account grant, provider quota, and actual Coolify deployment are not proved by local fixtures.

The local integrations build produced `dist/index.mjs`, SHA-256 `920610bbc846bb40016302cdbd3687b8f0ea590558fef9b9a7358527bc131830`. Static REA evidence `ev_fa38cd2352b30ab9f3d0907a1a3f0b8d7aefae5fdde149b899aa54728d2efdc3` parsed the selected file with 18,488 AST nodes and no parse errors. The file contains `SpotifyRateLimitError`, `parseRetryAfterSeconds`, and `provider_rate_limited`. This is build content evidence, not observed Spotify traffic or a published image.

Chrome fixture: the first read of positions 201-202 returned 429 with an 8-second hint. The retry button was disabled and showed a local retry time. At 8.025 seconds the fixture still recorded exactly one attempt and no writes. The explicit retry after 18.098 seconds fetched the same range, followed by one confirmed metadata-only draft. There were no logout, audio or download requests. The fixture was stopped.
