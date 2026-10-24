# TF preparation E: diagnosis and selected runner observation

Owner: Apollo.TF. Base: `8b204c957af329d10444361a66b4a129729ff347`.
Checkout/branch: `tf-prepare-e-diagnostic` / `codex/tf-prepare-e-diagnostic`.
Stage: selected diagnostic patch ready for root review/native check.
Scope: operator-release.ts, its existing test file, and this journal only.
Evidence: root brief `2026-09-21-tf-preparation-e-diagnostic-owner.md`;
standalone log read in place and SHA-256 verified:
`ea20ce0fefcb104b28080cabd923374c8abc2ee3a8d15eb7fa8b8f5eb801726a`.

## Finding and comparison

**E's child failure cause is not recoverable from the retained evidence.**
E:16:13:22-16:16:24UTC, exit1/tf_web_tests, claim only. Standalone:
19files/218pass at16:17:42UTC (26.02s). This does not satisfy E's failed gate.

References below are to `scripts/src/operator-release.ts` at the pinned base.

| Boundary | Preparation / standalone evidence |
| --- | --- |
| Executable/argv (267-350) | process.execPath + sibling node_modules/corepack/dist/pnpm.js + --filter @workspace/music-player exec vitest run --maxWorkers=2. Root reports matching Node24.21.0/pnpm10.33.2/CI/workers; log proves Vitest4.1.10, not outer argv. |
| cwd/filesystem (598-650) | Fresh temporary validation-source versus standalone's already-installed exact-source archive. Gates share one tree; no per-stage filesystem/resource snapshots. Prior mutation/cache effects cannot be assumed or excluded. |
| Environment (983-1009) | CI=1/COREPACK_ENABLE_DOWNLOAD_PROMPT=0 plus allowlisted HOME/PATH/locale/OS/temp keys. NODE_OPTIONS/TZ/VITE_*/PORT/BASE_PATH excluded. Standalone full key parity and outer resource limits are unrecorded. |
| Timeout/signal (441-446,636-649) |1200000ms, no prepare AbortSignal.20-minute timeout cannot explain182-second whole run; external signal/outer deadline remains unknown. |
| Output/status (434-462,1029-1052) | shell:false, piped strings, no maxBuffer/output cap. error -> -1; close discards signal, null -> -1; checkedCommand discards cause/status/output, retaining stage only. |
| Lifecycle (636-650,709-724) | Sequential scripts -> Platform API -> TF API -> admin -> web; close awaited on success, error resolves early. Failure deletes temporary tree. Cleanup failure would instead emit cleanup_failed. |

Web config: jsdom/clearMocks/jest-dom; no prepare-specific profile. Standalone
TTY/stdio/outer argv remain unknown. Assertion/signal/spawn causes cannot be ranked.

## Implemented after root selection

Private WeakMaps bind actual runner results/errors to `commandFailure`:
`reason` = child_exit/signal/timeout/spawn_error/runner_error;
`exitCode` = integer 0-255 or null; `signalClass` =
term/kill/interrupt/abort/other/none. Only source-validation errors with a
trusted static stage serialize this additional object. Unobserved returned
doubles remain stage-only; unknown rejected commands yield runner_error.
Forged error/result fields and child text cannot supply observations.

The owned timer uses the original delay and SIGTERM, records its actual
attempt, and clears on exit/completion. Timeout denotes that attempt, not
proof of why a child died; exitCode/signalClass still describe observed close.
The spawn event distinguishes pre-spawn failures from later errors. Early
error completion, close-based normal completion, success result shape,
claim/receipt/cleanup, argv, stage order, and all budgets remain unchanged.
No output cap, retries, escalation, process groups or capture were added.

## Focused evidence

Local Windows/Node24.15.0/Vitest4.1.10. Reused installed toolchain through
ignored links in this worktree; no install or foreign checkout edits.
RED: five assertions failed for missing metadata (exit17, missing executable,
invalid executable, timer, thrown dependency). GREEN: 27 passed/0 failed,
89 skipped (88 outside selection, one POSIX self-signal case on Windows).
Includes exit0/exit17, out-of-range Windows exit273 sanitization, spawn errors,
200ms timeout, trusted/forged forwarding, stage argv/deadlines, claim-only,
no next stage/Docker/receipt, successful receipt shape and archive integrity.
This is synthetic harness evidence, not a production prepare or a release gate.

From `scripts`, using the already-installed Vitest entrypoint:
`node ./node_modules/vitest/vitest.mjs run src/operator-release.test.ts --maxWorkers=1 --testTimeout=10000 -t 'trusted real-child|reports observed validation stage|omits unobserved validation stage|successful real child|outside source validation|claims the release and publishes a receipt|allows only one same-ID preparation claimant|retains the exclusive claim but no receipt|rejects validation that mutates the exact source archive'`

Scripts `tsc -p scripts/tsconfig.json --noEmit`: pass. Source diff/whitespace
checked. Native POSIX signal observation remains for root; no SSH/Linux run.

## Optional private capture proposal (NOT implemented)

Root selection is required before any of the following code or operation:

1. Explicit valueless `--capture-source-failure` flag for `prepare-tf-only`
   only, default off. No environment toggle, arbitrary destination, publish
   mode, success capture or automatic retry. Bind intent to this one-shot
   invocation, not a persistent setting or a retrospective A-E capture.
2. Only a trusted runner `child_exit` with exitCode 1 at one of the eleven
   sourceValidationCommands gates is eligible, not archive/extract/integrity
   checks. A prepare-owned internal callback from checkedCommand
   receives the already captured stdout/stderr, never error properties or a
   public DTO. Capture before throwing the SAME source_validation_failed;
   all later stages, receipt/archive publication and Docker remain forbidden.
3. Fixed path under the existing claim custody:
   `.ops-private/tf-only-release-claims/<validated-release-id>/source-validation-failure.json`.
   Revalidate canonical non-symlink parents/claim ownership and Linux 0700
   directory protection before writing; reject insecure custody. Open fixed
   filename exclusively (`wx`, 0600), verify regular file/single link, write,
   fsync, close. No overwrite, follow-symlink, path fallback or new directory
   tree. Same-UID hostile mutation is outside portable filesystem guarantees;
   this remains the existing trusted operator-only custody boundary.
4. One bounded private JSON object: formatVersion=1, static validationStage,
   fixed commandFailure, stdoutTailBase64/stderrTailBase64 and per-stream
   truncated booleans. Retain at most 65,536 UTF-8 bytes per stream, encoded
   as base64 so terminal/control output is never executable display text.
   Enforce a 176,000-byte final file ceiling before opening. This bounds disk
   retention only; existing in-memory full output accumulation is unchanged.
5. No contents/path/hash/capture fields in publicErrorResponse or receipt;
   never copy capture into source.tar, build extraction/context, reports,
   prompts or chat. Creation occurs after the source archive was made, within
   ignored untracked custody. Root verifies ignore/archive/context exclusions
   with synthetic sentinels before selecting this feature. No raw auto-print.
6. Any capture error leaves the original terminal failure intact, never a
   success/receipt. Do not retry/overwrite/delete an existing or partial file.
   Root verifies expected file size, permissions, complete schema and hash
   read-only; absent/partial evidence means the observation gap stays open.
   Raw content is untrusted and reviewed only within root's private custody;
   only separately authorized redacted findings may leave it. Reuse root's
   manual lifecycle, no retention daemon/index/uploader or new subsystem.

If selected: focused synthetic tests for opt-in/off, hostile/oversized output,
exclusive-path/custody rejection, write failure preserving the primary error,
and no public/archive/receipt/context leakage. No production rerun is implied.

## Resume

Blocker: E's historical cause is unrecoverable; fixed metadata alone may not
identify a failing test. Next: root reviews this commit, native-checks only the
new boundary, then selects/revises the optional capture proposal. No F until
that remaining observation gap is resolved. No full suites/install/SSH/Docker/
credentials/production prepare/deploy/new agents. A-E closed; no new ID.
Frozen branches/publishers untouched. Clean owner commit only, no push.
