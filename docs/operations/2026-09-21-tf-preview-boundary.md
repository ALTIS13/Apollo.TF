# TF preview boundary correction

Owner: Apollo.TF. Stage: SOURCE_VERIFIED; independent root review pending.
Base: `85f67b6593313b7f893b00fab3b8cbfd5214fcdf`.
Branch: `codex/tf-preview-boundary`.
Worktree: `D:/CodexProjects/Apollo.TF/.worktrees/tf-preview-boundary`.
Approved proposal SHA256:
`16e767eb00dc6a5cf4bd8453d6cf570de30c6cb9976b8dc8322f1dbd90ae23f1`.

Scope: stream route, existing route tests, one real PlayerProvider error case
and this report. Root explicitly accepts legacy ID-only Deezer unavailability
and bypassing its opaque cache, preserving metadata-supplied private resolution,
tf.search denial, existing DTO/500 stream_error and non-Deezer caching.
Source-only correction, not full audio acceptance. Spotify/F remain unchanged;
no push/deploy/new release, external provider call or recursive delegation.

Setup: native worktree tool could not resolve the task's obsolete repository
path (Not a git repository). Explicit git worktree add in the verified TF root
created this new branch at the approved base; existing Spotify checkout clean.
Filtered offline/frozen/ignore-scripts pnpm install reused 474 packages with
zero downloads and no manifest/lock changes.

Source/test commit: `5751e22828661b9fd480a26963c1f8dee8f4ca1f`, direct child
of the base above. This report is committed separately to record that identity.
No implementation blocker; root next action: independent scoped review of the
three-file change, followed by a separate successor-admission decision.

## Behavior and accepted tradeoff

- `/api/tracks/:id/stream` handles decoded `dz_` before cache. Missing artist or
  title, no candidate, search rejection and resolver rejection all return the
  existing exact 500 `stream_error` / `Could not resolve stream URL` JSON.
  The decoded Deezer URL is never substituted by this route.
- Metadata-supplied resolution still requires `tf.search` (same 403), calls
  the same private YouTube search and resolver, and returns the same success
  DTO. Legacy Deezer cache reads/writes are skipped; non-Deezer cache hit/miss
  logic and shared cache storage/TTL remain unchanged. No cache deletion.
- The actual generated player call supplies ID only: old Deezer records are
  intentionally unavailable, even when a formerly resolved URL remains cached.
  This loss of availability/cache reuse is explicitly accepted for the
  unpublished successor. Restoring metadata resolution is separate work.
- Existing PlayerProvider stops/clears the failed track and emits the existing
  playback-error toast without invalidating auth. No player production change.
  The new fixture exposes actual provider state, not a mocked use-player hook.
- Search/resolver candidate quality is still existing behavior. This fixes
  direct preview substitution only, not complete-audio validation, live provider
  correctness, catalog matching, download/audio-stream behavior or licensing.

## Focused validation

Executed from this worktree with pnpm 10.33.2 / Vitest 4.1.10:

```powershell
pnpm --filter @workspace/api-server... --filter @workspace/music-player... install --offline --frozen-lockfile --ignore-scripts
pnpm --filter @workspace/api-server exec vitest run src/routes/tracks.test.ts -t 'stream preview boundary|uses private module candidates for every Deezer playback' --maxWorkers=2
pnpm --filter @workspace/music-player exec vitest run src/auth/tf-protected-runtime.test.tsx -t 'stream_error 500' --maxWorkers=2
git diff --check
```

RED at unchanged production source: route selection exit1, **8 failed / 1 passed
/ 62 skipped**. Six cases returned 200 instead of 500; cached legacy access
returned 200 instead of 403; the existing successful fallback still touched the
legacy cache. Non-Deezer cached playback passed. These were expected assertion
failures, not setup failures. Logger fixture preserves the actual JSON error
handler and deterministic cache mocks avoid Redis/provider access.

GREEN after route correction: same selection exit0, **9 passed / 62 skipped**,
58ms test time, 1.05s total. Coverage: three missing-metadata forms with seeded
opaque cache, three fallback failure classes, tf.search/cache boundary,
non-Deezer cache hit and existing successful private fallback. The existing
success test also exercises download/audio-stream; no new cases audit them.

Player case: first attempt failed waiting for toast (query dispatch had not
been separately awaited). Narrowed the fixture with explicit authenticated
state/Audio readiness and a dispatch wait; it then passed before production
edits. Final fixture also flushes the interaction through async `act`.
Final exit0: **1 passed / 8 skipped**, 102ms test time, 1.54s total. This is
preserved-behavior coverage, not claimed RED proof of a player production fix.
It checks no audio.play, empty src, cleared track/not-playing/not-loading,
existing toast, usable authenticated boundary, one initial session fetch and
no logout. Existing auth/renewal/Spotify suites were not replayed.

Scoped TypeScript checks both exit0, no emit. Invoked via `node -e` using
`typescript.readConfigFile`, `parseJsonConfigFileContent`, `createProgram` and
`getPreEmitDiagnostics`; inherited actual config, no generated config/tsbuild.

| Check | Configuration, roots and options |
| --- | --- |
| API | `tsconfig.base.json`; changed `tracks.ts`, `tracks.test.ts`, existing `src/types/session.d.ts` and `node_modules/pino-http/index.d.ts` under `artifacts/api-server`; `noEmit:true`, `types:['node']`, `typeRoots:['artifacts/api-server/node_modules/@types']`. Imported dependencies included. |
| Player | Parsed absolute `artifacts/music-player/tsconfig.json` relative to its directory, preserving JSX/paths/lib options; changed `src/auth/tf-protected-runtime.test.tsx`, existing `src/test/setup.ts` and `node_modules/vite/client.d.ts` under that package; `noEmit:true`, `types:['node']`, `typeRoots:['artifacts/music-player/node_modules/@types']`. Imported dependencies included. |

Initial scoped invocations omitted pino-http/Vite ambient declarations and
reported TS2339 for Request.log / ImportMeta.env. Adding the existing declaration
roots to the check fixed both; no application/type declaration/config edits.
Diff review and whitespace check passed. No full package run, external provider
request, DB/Redis runtime, credentials, browser/audio-device proof or deployment.

## Source hashes

SHA256 of exact source/test bytes in the implementation commit:

| File | SHA256 |
| --- | --- |
| `artifacts/api-server/src/routes/tracks.ts` | `6f5604aabc9aff57aa3f23e9480fe5127af9acec751a7d578243e42de9ed1a36` |
| `artifacts/api-server/src/routes/tracks.test.ts` | `239c4cb1880660aae329dbe457abb53041af3b9f84e3babbdafc674f508aa4ff` |
| `artifacts/music-player/src/auth/tf-protected-runtime.test.tsx` | `cf2767b770dbe7ca8fa91b2e9da5a1f1be83015dc60e56ca1497ecd82621ec41` |

Rollback: drop this unpublished candidate; no runtime state was changed. Do not
restore the preview-success behavior as a runtime workaround. Root owns review,
selection and any future release; this work does not authorize preparation G.
