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
