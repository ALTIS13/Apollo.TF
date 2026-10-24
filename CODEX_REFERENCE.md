# Apollo TF architecture reference

Repository execution rules are in AGENTS.md. This is a scoped reference, not a
startup checklist or a new implementation/deployment assignment. Current unified
design, accepted contracts and the assigned brief/owner journal govern new work.

## Project layout and contracts

- `artifacts/api-server`: Express API for search, streaming, Spotify/Yandex
  integrations, cache and database access.
- `artifacts/music-player`: React/Vite web player.
- `artifacts/trackfinder-mobile`: Expo/React Native mobile client.
- `lib/api-spec`: OpenAPI source of truth; change it deliberately and update
  generated clients through the established generation flow.
- `lib/api-client-react`, `lib/api-zod`, `lib/db`: shared clients, validation
  and database packages. Do not hand-edit generated output without its source.
- Prefer pnpm and rg. Never print credential-bearing Git remote URLs.

## Mobile delivery decision

The owner retired Expo Go/static deployment as release validation on2026-07-14.
The delivery target is an Android APK validated through ADB when the active task
authorizes release validation. Do not assume physical devices, SDK, credentials
or deployment access are currently available. Check Java/Gradle compatibility
when that build path is in scope.

Expo packages remain part of this architecture snapshot. For a mobile
implementation, explicitly scope either retaining Expo modules with native
Gradle/prebuild or migrating to bare React Native; do not silently combine them.

## Repository and operations hygiene

Use the assigned branch/worktree; feature branches use `codex/<logical-name>`
when a new branch is actually assigned. Keep commits focused, if authorized.
Do not commit secrets, private operational notes or generated session artifacts.
`.ops-private/` is private operational material, not required startup context.

Infrastructure work requires current task authority, read-only impact checks,
rollback and scoped validation. Keep TF backend ports private and route only
approved public hosts through the established ingress. Do not infer live host,
device, tool/plugin availability or deployment approval from old records.

## Unified ownership and preserved handoff

TF is the `TF` module in the shared Apollo account/installation system, retaining
TF runtime/API behavior. Supabase Auth owns identity/source sessions. Platform
owns policy, entitlements/capabilities, canonical installation identity, module
access, release/download admission and root audit. GAP owns AWG/OlcRTC network
subscriptions, signed routes/bundles, nodes, rooms and network telemetry; TF has
no direct control-plane dependency on GAP.

Known top-level module examples are `QUASAR`, `TF`, `OLC`, `AWG` and `AI`, not
a closed registry. Preserve `tf.search`, `tf.integrations`, `tf.downloads` and
`tf.collections` compatibility keys; unknown values do not authorize access.

Historical handoff:
`docs/superpowers/specs/2026-08-24-apollo-tf-unified-platform-handoff-design.md`.
Historical implementation plan:
`docs/superpowers/plans/2026-08-24-apollo-tf-unified-platform-integration.md`.
These do not reopen accepted contracts or supersede later approved task briefs.

Repository recorded by this variant: `https://github.com/ALTIS13/Apollo.TF`.
Verify local repository identity without exposing credential-bearing remotes.
