# Playback of a reviewed recording

Baseline `c1cde6a`. The existing Web player now plays media bound to an explicit import selection. Nothing is played by confirming a choice. A separate file action is available only when the reviewed record and live Platform policy both allow downloads.

## Admission and storage

1. Acquire the exact authorized file and independently identify its edition and expected duration. A matching date, filename or decoded duration is not proof that the words are unchanged or that rights exist.
2. Run `pnpm --filter @workspace/scripts exec tsx src/verify-recording-media.ts <local-file> <wav|mp3|ogg|flac|m4a> <expected-seconds>`. `ffmpeg` must be on PATH, or the operator can point `TF_FFMPEG_EXECUTABLE` to an approved executable. The command reads and hashes the same bytes it fully decodes, checks the decoded duration against the expected value, rejects broken or ambiguous input, and emits JSON without a source path. [FFmpeg input protocols](https://ffmpeg.org/ffmpeg-protocols.html) are restricted to pipes in the verifier. A receipt does not grant rights.
3. Add the receipt's `media: { sha256, format }` and rounded measured duration to the [reviewed catalog](2026-11-12-tf-recording-review.md), with independent evidence and stream/download permissions. Put the exact bytes at `<sha256>.<format>` in the directory configured as `TF_RECORDING_MEDIA_DIR`. Use private read-only mounts for both the manifest and media; keep equivalent approved content on each replica. The media binding participates in the evidence revision, so adding or changing it requires the listener to confirm again.

The new `GET /api/collections/imports/{importId}/entries/{position}/audio/{revision}` and `.../file/{revision}` require a matching current selection, fresh catalog approval, live `tf.collections` and `tf.search`, and an intact file digest. File delivery additionally requires live `tf.downloads` and explicit download permission. Both support a single byte range, recheck on each request, use `no-store`, and return no media for a stale revision. Only the file route uses an attachment. CORS permits `Range` and exposes media headers only on these routes for origins already allowed by the application.

The API accepts at most 32 MiB per file, checks SHA-256 before emitting bytes, and holds at most two media buffers per process with a 30-second response deadline. It uses no server-side media cache, transcode work queue, or Internet fetch for this catalog. The browser uses credentialed audio only for these URLs. Private bindings are not saved in queue snapshots or sent through generic search/history, lyric, download, or cross-device synchronization. Explicit download is not managed offline admission. Revocation stops subsequent requests, not bytes already delivered.

## Verification

- 123 affected API tests, 118 Web tests and three verifier cases passed. Typechecks, code generation and API/Web production builds passed; the existing Vite warnings remain. The decoder tests used a checksum-verified FFmpeg 9.0.2 Windows build from the [official FFmpeg download links](https://ffmpeg.org/download.html).
- Generated, owned test audio decoded to 205.011 seconds (MP3) and 192 seconds (WAV). The verifier rejected a 30-second clip against a 205-second reference and a truncated WAV. Only MP3/WAV were demonstrated end to end.
- Actual local API and marked PG16 with a synthetic session and catalog: exact range bytes and CORS credentials passed; stream-only download was denied; the allowed WAV range used an attachment; revoking `tf.downloads` denied it while playback remained allowed; stale revision was rejected.
- Chrome used separate loopback Web/API origins and the existing player. The MP3 and WAV each advanced playback (3:25 and 3:12 respectively) and could be paused. Two HTTP 206 audio responses and zero legacy track requests were recorded. The WAV download link was visible; no file was downloaded to the browser. The test servers and database were stopped.

No new schema migration, domains, production catalog, Coolify deployment, or live provider session was introduced. A release still needs a source-matched Coolify acceptance packet, real Platform/OAuth receipts, an authorized non-test catalog recording, and native Android/Windows verification.
