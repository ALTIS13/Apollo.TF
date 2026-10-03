# TF listener web usability check

Owner: Apollo.TF web player. Stage: source and fixture-backed browser check, not live service acceptance.

## This slice

- The playback position is a native range control with touch, pointer and keyboard semantics, a usable mobile hit area, a visible focus state and an accessible time value. It is disabled until a track and duration exist. The former mouse-only drag handler is gone.
- The account-scoped liked list can play its currently loaded page in order and add a saved recording to an Apollo-owned playlist with the existing picker. The command explicitly says "loaded tracks" because pagination may leave more tracks on the server.
- The browser tab uses the Apollo TF name and Russian document language. The collection keeps its compact dark layout, with the TF cyan accent used only for the main play command and seek position.
- The playlist action is shared between search, recommendations, provider-candidate results and liked tracks without a component import cycle. Spotify and Yandex remain metadata inputs, not audio sources.

## Evidence and boundary

- Two focused tests first failed for the absent native slider and collection commands, then passed. The affected player, collection, navigation and migration tests passed together: 41 tests. TF web TypeScript and production Vite build passed.
- Chromium rendered the authenticated collection at 1280 x 800 and 390 x 844 with isolated fixture HTTP responses, not real Platform auth. Adding a liked track opened the existing picker, posted to the playlist route and showed success. A paused, account-scoped queue snapshot exposed the seek slider; ArrowRight changed its value from 15.2 to 15.3 percent. At 390 px, document width remained 390 px.
- This machine had no running Docker Desktop engine; requests to the public TF web and API addresses failed locally. The visual browser fixture cannot establish real login, provider availability, stream playback, physical-phone touch behavior, Coolify state or media rights.
- Quasar currently opens only `https://tf.apollot.ru/` after a readiness check. TF deep links and a shared installation identity handoff are not frozen. No second identity or entitlement authority is introduced here.

## Next distinct work

1. Establish a reachable isolated integrated Platform + TF web/API stack, exercise real session and capability gates, then open the responsive web app on a physical phone. Keep existing HomeNode services outside the trial.
2. Design server-owned manual ordering for liked tracks across pagination and devices, with an account revision/conflict rule. Existing Apollo playlist reorder already persists; do not reimplement it.
3. Liked-track artists now seed recommendations alongside play history, with a response basis derived only from visible results. Negative preference signals and per-track explanations remain open; add a durable lyrics mismatch-reporting path with operator visibility rather than a log-only button.
4. Treat offline library as a separate source-rights and lifecycle project; a browser file download is not offline listening.
