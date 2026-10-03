# TF private source-failure capture

Owner: Apollo.TF. Branch/worktree: `codex/tf-private-failure-capture` /
`D:/CodexProjects/Apollo.TF/.worktrees/tf-private-failure-capture`.
Base: `785037ca6b4a2db88aaeee25aa9813adb1bee485`; frozen base left unchanged.
Authority: Root selection: private diagnostic capture in the Platform owner
brief `2026-09-21-tf-preparation-e-diagnostic-owner.md`.
Stage: source candidate complete; independent review and native custody proof
remain root-owned. No release ID or production operation selected.

## Implemented

- TF-only preparation has one explicit default-off valueless capture option.
  Legacy preparation, publication, duplicate/valued/unknown flags and invalid
  modes reject it. Direct API misuse also rejects outside TF preparation.
- Only a trusted runner observation `child_exit` / exitCode 1 at the eleven
  static sourceValidationCommands gates can call the private sink. Returned
  forged fields, other exits, successful commands and archive/extract failures
  do not create a capture. The prerequisite WeakMap observation code is intact.
- Before gates, snapshot repository/private-parent/claim directory identities;
  before opening and writing, recheck canonical paths, non-symlink directories
  and dev/ino identity. Linux requires root/current-euid ownership, a repository
  not writable by group/others, and exact 0700 private directories.
- One fixed claim-local filename, exclusive `wx`/0600 open; regular-file,
  single-link, handle/name identity and Linux owner/mode checks before writing.
  Write/sync/close, no overwrite/adoption/retry/removal. Capture failures keep
  the original terminal source error; uncertain partial output is retained.
- Version-1 private JSON contains static stage/observation, two base64 tails
  and truncation booleans. Each tail is at most 65,536 UTF-8 bytes, including
  correct byte truncation inside multibyte text; final file cap is 176,000 bytes.
  Encoding uses bounded suffix buffers, not full copies of captured output.
  Existing runner accumulation, lifecycle, timers and mandatory gates unchanged.
- No capture metadata or data enters public responses/receipts/source archives/
  build contexts. No automatic display, logging, upload or retention subsystem.
  Base64 is transport encoding, not encryption or sanitization of hostile text.

## Validation

Local Windows, Node24.15.0, Vitest4.1.10; installed dependencies reused through
ignored worktree-local links, no installation or edits to their source copy.
RED: 10 expected failures before flag/capture implementation. Final focused
selection: **19 passed, 0 failed, 117 skipped** (116 outside this new group;
one POSIX mode-rejection case skipped on Windows). The old 27-case diagnostic
selection and other suites were not rerun.

Run from this worktree's `scripts` directory:
`node ./node_modules/vitest/vitest.mjs run src/operator-release.test.ts --maxWorkers=1 --testTimeout=10000 -t 'private source failure capture'`

Checks cover opt-in/off, wrong operations/mode/flags, real exit1 versus forged
results/exit17/success/archive failure, oversized ANSI/multibyte output, exact
tail limits, file exclusivity, claim replacement/junction, and a synthetic
partial-write error preserving the primary failure. Successful opt-in omits
capture from its receipt; failed opt-in never continues gates/creates receipt
or invokes Docker. A real temporary Git repository proves ignore handling,
byte-identical archives before/after synthetic capture and an extracted build
context containing only the committed public fixture. This is not a Docker run.

Scripts typecheck and focused diff/whitespace checks pass. No production capture,
credential, infrastructure or runtime data was read or retained for these tests.

## Dependencies And Limits

Root reported base acceptance: independent review `17b00c2c` PASS0 and native
Linux/Node24.21.0 28 focused passes (including POSIX SIGTERM), then publisher
fast-forwards to the base. That evidence was not reproduced by this owner.

Root must independently review this delta and prove Linux UID/0700/0600 custody
on its selected filesystem. Windows tests prove path/file behavior, not POSIX
permissions or Windows ACL isolation. Same-UID hostile mutation races remain
outside the existing operator-private filesystem trust boundary. Failed optional
capture is deliberately not advertised publicly: root inspects its private
artifact for permissions, completeness and usefulness; partial/missing output
does not establish successful capture or permit another blind preparation.

Resume: owner TF; source/evidence in this commit; blocker is root review/native
custody and useful private observation; next action is bounded root validation.
No push, new release ID, production prepare, receipt, SSH, Docker, credentials,
deploy, new agents or changes to frozen candidates/publishers by this owner.
