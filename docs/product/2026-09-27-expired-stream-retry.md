# Expired stream recovery

When a browser audio stream fails after it has started, or a paused stream fails on Play, the web player keeps the current track, queue and position. It stops playback and shows a retry instruction. It does not silently advance or automatically retry. The next explicit Play resolves a new stream URL through `GET /api/tracks/:id/stream?refresh=1`, then seeks to the preserved position. A newer manual track selection invalidates the old retry; a late rejection from an older `audio.play()` cannot mark the new track as failed.

For non-Deezer sources, `refresh=1` skips only the Redis URL read and replaces the cached URL after resolution. Expected-duration preview admission still runs before resolution. Deezer's existing uncached full-source fallback is unchanged. Any refresh value other than `1` is rejected with 400. A provider may still return an unusable URL; this mechanism cannot promise recovery or override a source restriction.

Focused API cache/preview/validation tests and FakeAudio player tests cover explicit retry, position and queue preservation, and stale asynchronous completion. The affected API/web typechecks and builds passed; the web build retained existing sourcemap and chunk-size warnings. This is source evidence only. No browser with live audio, Redis/CDN, container, Coolify or physical-device proof was performed for this retry path.
