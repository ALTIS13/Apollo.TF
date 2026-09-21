# TF Spotify source successor candidate

Owner: TF. Stage: SOURCE_VERIFIED; root successor-selection gate pending.
Base/initial HEAD: `d14e08d3dba275b0f4ce10525257a1c233aafff5`.
Branch: `codex/tf-spotify-source-successor`.
Worktree: `D:/CodexProjects/Apollo.TF/.worktrees/tf-spotify-source-successor`.

Scope: confidential Basic authentication for Spotify exchange/refresh and
fail-closed `/spotify/liked-all` page failures. Only the two Spotify source
files, their existing test files and this journal. F remains frozen history;
this candidate is not published, admitted or deployed.

Setup: filtered pnpm install with `--offline --frozen-lockfile --ignore-scripts`
reused 255 cached packages; zero downloads. No dependency manifest/lock change.
Tests now capture token request headers/body, missing replacement refresh token,
first/second-page failure mappings and complete library pagination.

RED at unchanged source: provider selection 2 failed (missing Basic header),
18 skipped; route selection 5 failed (200 instead of 502/401), 7 passed,
6 skipped. The passing cases cover preserved not-connected/typed-unavailable
and complete pagination behavior. Expected assertion failures, no setup errors.

## Changes

- `artifacts/tf-integrations/src/providers/spotify.ts`: exchange and refresh use
  confidential `Authorization: Basic` with UTF-8/base64 client credentials;
  no client credentials remain in either form body. Fixed endpoints/callback,
  signal/timeout handling, refresh fallback and safe logging are unchanged.
  This aligns the documented protocol; no claim the previous live exchange
  was rejected. [Code flow](https://developer.spotify.com/documentation/web-api/tutorials/code-flow),
  [refresh](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens).
- `artifacts/api-server/src/routes/spotify.ts`: `/liked-all` calls the existing
  `sendLibraryFailure` for any error response, irrespective of accumulated
  pages. Unknown exceptions return safe 502; typed gateway unavailability
  retains 503. Neither returns partial tracks or retries. Successful pagination
  and output shape remain unchanged.
- Existing `spotify.test.ts` beside each source was updated, not duplicated.
  The obsolete partial-success assertion was replaced. New route cases cover
  first/second-page provider rejection, unknown exception, `not_connected`,
  typed unavailability, exact gateway call boundaries, and 0/100/120-track
  completion (empty, full last page, short last page).

## Validation

Commands from the worktree root, Windows, pnpm 10.33.2 / Vitest 4.1.10:

```powershell
pnpm --filter @workspace/tf-integrations... --filter @workspace/api-server... install --offline --frozen-lockfile --ignore-scripts
pnpm --filter @workspace/tf-integrations exec vitest run src/providers/spotify.test.ts -t "confidential Basic authentication"
pnpm --filter @workspace/api-server exec vitest run src/routes/spotify.test.ts -t "liked-all" --maxWorkers=2
git diff --check
```

Same test selections before and after fixes: RED 7 expected failures / 7 passes;
GREEN provider 2 passes, routes 12 passes, 24 unrelated cases skipped in total.
The route selection was rerun once after formatting its changed block: 12 PASS.
Outbound provider requests use injected fetch; route tests use ephemeral local
loopback only. No external network/native runtime/credentials were used.

Scoped TypeScript check PASS, no emit; four changed TS files plus their imports
and existing Express augmentation. Initial invocation omitted the monorepo
Node type root/augmentation and failed with TS2688/TS2339; corrected invocation
below passed without editing declarations/configs or building libraries.
Executed with `node -e` using this program:

```javascript
const ts = require('typescript');
const c = ts.readConfigFile('tsconfig.base.json', ts.sys.readFile);
if (c.error) throw new Error(ts.flattenDiagnosticMessageText(c.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(c.config, ts.sys, '.');
const files = [
  'artifacts/tf-integrations/src/providers/spotify.ts',
  'artifacts/tf-integrations/src/providers/spotify.test.ts',
  'artifacts/api-server/src/routes/spotify.ts',
  'artifacts/api-server/src/routes/spotify.test.ts',
  'artifacts/api-server/src/types/session.d.ts',
];
const p = ts.createProgram(files, {
  ...parsed.options,
  noEmit: true,
  types: ['node'],
  typeRoots: ['artifacts/api-server/node_modules/@types'],
});
const d = [...parsed.errors, ...ts.getPreEmitDiagnostics(p)];
if (d.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(d, {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: f => f,
    getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else console.log('Scoped TypeScript check PASS: 4 changed files plus existing Express augmentation and imported dependencies; no emit');
```

Diff review: only the four named TS files and this journal; no dependency,
scope, playlist, UI, schema or deployment changes. Frozen F handoff and both
publisher lanes are untouched. No full suite/build/release prepare replay.

Next/root blocker: independent review and explicit successor selection; no
publication, F replacement or live Spotify acceptance is implied. Candidate
commit identity is reported in the root handoff; this journal is in that commit.

## Review Follow-Up: Filtered Page Termination

Owner TF; stage SOURCE_VERIFIED, independent scoped re-review pending. Follow-up base:
`094448eb4f92973402af4482bc7dd3a5aab64ec7`. Root included the pre-existing
filtered-page defect in this successor's no-false-partial-library scope.
Independent review SHA256:
`fe1ea61a86699b73988298dc7e4e64bda0a7aeb4d71563bcc0270c5c184013ff`.
Read-only review path:
`D:/CodexProjects/Apollo.Platform/.superpowers/sdd/2026-09-05-apollo-unified-production-plan/tf-spotify-successor-review-20260921.md`.

Confirmed trace: provider `trackPage` drops raw `track:null` but retains the raw
offset/total. With total=100, a normalized page of 49 (or zero) cannot terminate
the scan before offset50. New cases require that next page, for success,
provider rejection and unknown exception. Only API route/test and this journal
are assigned; Basic-auth evidence is reused without rerun.

Fix commit: `7df3dda88087ecd88b3c6cc1b11e5e8a5ea87adc`, direct child of
`094448eb4f92973402af4482bc7dd3a5aab64ec7`. Two-file source/test commit; this
report append is committed separately to record that immutable fix identity.

Source change: remove `tracks.length < MAX_PAGE_SIZE` termination. The existing
monotonically advancing offset/validated provider total now determines completion.
The 49-row first page followed by 50 rows returns 99 available tracks, with the
same public `total=99` shape; an empty normalized first page still reaches the
remaining 50. A failed/throwing next page returns safe 502 without partial data.
No new retry, schema, SDK, scope, UI, quota or public response contract.

Exact commands from the same worktree root:

```powershell
# RED against 094448e source, after adding/formatting six new cases:
pnpm --filter @workspace/api-server exec vitest run src/routes/spotify.test.ts -t "liked-all normalized first page" --maxWorkers=2
# GREEN after the one-branch source correction:
pnpm --filter @workspace/api-server exec vitest run src/routes/spotify.test.ts -t "liked-all" --maxWorkers=2
git diff --check
```

RED exit1, Vitest4.1.10 summary (2026-09-21):

```text
Test Files  1 failed (1)
Tests       6 failed | 18 skipped (24)
Duration    408ms
49-row success: expected 99, received 49.
0-row success: expected 50, received 0.
Both page sizes x rejection/exception: expected status 502, received 200.
```

GREEN exit0 summary:

```text
Test Files  1 passed (1)
Tests       18 passed | 6 skipped (24)
Duration    461ms
```

The GREEN selection includes all six new cases, earlier reached-page failure
mappings, 0/100/120 complete pagination, and the existing 257-call capacity
refusal. Each new case requires exactly offsets `[0,50]`, no retry/following
call. No Basic-auth tests or unrelated suites rerun.

Scoped TypeScript invocation uses the earlier `node -e` program/options, now
with only API `src/routes/spotify.ts`, `src/routes/spotify.test.ts` and existing
`src/types/session.d.ts` as roots (plus imported dependencies). Exit0, output:

```text
Scoped TypeScript check PASS: API Spotify route/test plus existing Express augmentation and imported dependencies; no emit
```

Diff/whitespace and three-file scope checks PASS. Publisher/capture refs remain
at d14e; no frozen F report/source edits or runtime/native/external requests.
This is deterministic normalized-page source proof, not a live Spotify library
snapshot guarantee under concurrent remote edits. Root next action: independent
scoped re-review of the fix, then separately decide successor admission.
