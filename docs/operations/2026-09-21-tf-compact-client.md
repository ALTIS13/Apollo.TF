# TF compact client - 2026-09-21

## Resume record

- Owner: Apollo.TF `019ef2c2-95cb-7d01-9951-aa0abfe25d37`.
- Stage: `TF-COMPACT-CLIENT-20260921`, CANDIDATE_READY for independent root review.
- Worktree: `D:/CodexProjects/Apollo.TF/.worktrees/tf-compact-client-20260921`;
  branch `codex/tf-compact-client-20260921`, clean base
  `97fd05d68068df01a84f9b8ce9bee61847e9d892`.
- Authority: `D:/CodexProjects/Apollo.Platform/docs/handoff/2026-09-21-tf-compact-client-owner.md`.
- Paths: music-player App/Sidebar/TrackCard, Home, Favorites, new Integrations
  page, new ClientNavigation.test.tsx and this journal only (8 paths).
- Evidence: focused 19/19 tests, typecheck/build, fixture browser evidence below.
- Blocker: none for this source slice. Live integration still requires root's
  runtime dependencies; no current Claude screenshot was supplied.
- Next: root independently reviews the local candidate commit containing this
  record, then decides import/publication. No owner push/merge/deploy.

## Boundaries

Publisher worktree remains clean at the accepted base. Native worktree tool
failed with `Not a git repository` because this task's saved cwd is obsolete;
explicit Git worktree creation used the verified repository and ignored
`.worktrees` location. Dependencies linked offline with frozen lockfile and
scripts disabled; no dependency/version change.

Browser plugin unavailable; bundled Playwright is available for isolated local
fixtures. No credentials, real Auth/provider mutations, Docker/WSL, publish,
push/merge/deploy, D05/PG17 replay or subagents. The generic TDD full-suite and
worktree baseline-suite guidance conflicts with the explicit scoped-verification
brief; only changed behavior and concrete affected boundaries will be checked.

## Design and compatibility

Compact search form/source toggles and results start in the first viewport.
TrackCard gains an opt-in compact layout for Home, not another queue or player.
Its play surface is a native keyboard button. Mobile navigation reuses the
existing Sheet primitive with focus containment/restoration and Escape close;
global player hotkeys no longer consume native button/link/select key presses.
Favorites retains Apollo and connected-provider collection content; it links
to Integrations instead of offering connection/disconnection commands. Existing
Spotify callback still targets `/favorites`; a client-only redirect transfers
only its recognized outcome to Integrations, where current status is fetched.
Callback query text is not proof of a connection or a user-facing raw error.
Existing capability hooks/API remain authoritative. Yandex onboarding stays
unavailable, never replaced with token entry or invented OAuth. Persistent
player and canonical queue implementation/dimensions are unchanged.

## Evidence and handoff

### Focused checks

All commands ran in this isolated worktree on 2026-09-21. No broad application,
unrelated backend, D05 or PG17 suite was run.

- RED: new navigation/relocation tests initially exposed 6 missing behaviors.
- GREEN, 16:02 MSK: `pnpm --filter @workspace/music-player exec vitest run
  src/pages/ClientNavigation.test.tsx src/components/Sidebar.test.tsx
  src/components/TrackCard.test.tsx
  src/auth/tf-home-generation.integration.test.tsx --maxWorkers=1 --pool=threads`
  returned 4 files / 19 passed / 0 failed / 0 skipped.
- `pnpm --filter @workspace/music-player typecheck`: exit 0. This fresh worktree
  first needed the existing api-client-react declaration output generated via
  `pnpm --filter @workspace/music-player exec tsc -b ../../lib/api-client-react`;
  generated output remains ignored, no source or generated-client contract edit.
- `pnpm --filter @workspace/music-player build`: exit 0; Vite reports original
  sourcemap-location warnings in existing ui/tooltip.tsx and ui/sheet.tsx, plus
  a >500 kB chunk warning (572.15 kB JS / 181.00 kB gzip). Not suppressed.
- `git diff --check`: exit 0. Publisher worktree was rechecked clean at
  `97fd05d68068df01a84f9b8ce9bee61847e9d892`; it was not changed.

The new behavior test uses the real App/auth/provider hooks with a fetch fixture,
not duplicated hook implementations. It checks collection content remains,
navigation/current-page state, POST disconnect with existing credentials/CSRF,
capability denial without provider requests, transport retry, existing HTTP503
fail-closed behavior, truthful disconnected/Yandex-unavailable states, old OAuth
callback compatibility, and keyboard form submission with manual source choices.

### Browser evidence (mocked)

Bundled Playwright used installed Chrome, isolated contexts and synthetic API
responses on `http://127.0.0.1:54195/`. External font CSS was replaced with empty
CSS and the existing local opengraph asset was used as a synthetic cover. No
provider credentials, live sessions or real account mutations were used.

Local evidence directory:
`C:/Users/maksi/.codex/visualizations/2026/06/23/019ef2c2-95cb-7d01-9951-aa0abfe25d37`.

- Reproduction script: `tf-compact-qa.cjs after` and `tf-compact-qa.cjs after --edges`.
- Records: `tf-before-evidence.json`, `tf-after-evidence.json`,
  `tf-after-edges-evidence.json`.
- Desktop/mobile before and after screenshots: `tf-{before,after}-home-{1440,390}.png`.
- Integrations screenshots: `tf-after-integrations-{1440,390,320,1024}.png`.
- Narrow/medium Home screenshots: `tf-after-home-{320,1024}.png`.
- Mobile state screenshots: `tf-after-{locked,loading,transport,http503,longName,empty}-390.png`.

First result title moved from y=949 to y=320 at 1440x900 and from y=1263 to
y=570 at 390x844. Additional 320x844 / 1024x768 checks show y=650 / y=308.
No horizontal page overflow was detected. Player bounds remain exactly 90 px
high and unchanged through search -> integrations -> collection -> queue.
Space adds a result to the canonical queue and opens the mobile menu; Enter
navigates from Favorites, Tab remains inside the dialog, Escape closes it and
restores focus. The queued result survives all route changes.

Screenshots were visually inspected. No unexpected console/page errors appeared;
the intentional transport/HTTP503 fixtures emit their expected network errors,
and reduced-motion contexts emit Motion's development warning. Existing HTTP503
handling suspends protected UI through the shared auth boundary rather than
showing only a provider-row error; that authority behavior was preserved, not
weakened by this presentation slice.

### Limits and next owner

This is source/build and fixture-backed UI evidence, not real login/audio/
renewal/revocation acceptance. Root owns accepted images, Redis/custody and
genuine Platform/Auth activation. No recent Claude screenshot was supplied;
the candidate retains accepted local neutral/dark primitives. Fonts/provider
artwork and real service latency require live visual confirmation after root's
activation. Local preview alone has no mocked session outside the QA contexts.

No server, Auth, provider hook, API, schema, Compose, release publisher, dependency,
lockfile, registry or other-project file changed. No new task/subagent, Docker/WSL,
push, merge, deployment or credential access. Historical dirty worktrees untouched.
