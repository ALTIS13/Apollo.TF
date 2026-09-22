# TF Linux preparation - 2026-09-21

## Resume record

- Owner: Apollo.TF `019ef2c2-95cb-7d01-9951-aa0abfe25d37`.
- Stage: `TF-LINUX-PREPARATION-20260921`, CANDIDATE_READY for root review.
- Worktree: `D:/CodexProjects/Apollo.TF/.worktrees/tf-linux-preparation`;
  branch `codex/tf-linux-preparation`, verified clean base
  `97fd05d68068df01a84f9b8ce9bee61847e9d892`.
- Authority: `D:/CodexProjects/Apollo.Platform/docs/handoff/2026-09-21-tf-linux-preparation-owner.md`.
- Scope: backup-contract.test.ts shell selection/regression and this journal.
- Evidence: root's native HomeNode Node24.21.0 probe returned ENOENT for the
  Windows literal; ordinary bash returned status 0 / GNU Bash5.2.21. The
  synchronous, asynchronous and fixture-setup calls share that literal.
- Blocker: none for source correction; native Linux validation belongs to root.
- Next: root reviews the local candidate containing this record, runs the
  selected cases on isolated Linux source, and checks the Corepack layout
  prerequisite below before mandatory preparation. No owner publication.

## Boundary

Publisher and compact-client candidates remain frozen; historical dirty checkout
is not used. No Docker/SSH/WSL, registry, credentials, release ID/preparation,
push/merge/deploy or new task/subagent. Production shell, publisher source gate,
actual-mode Docker case and opt-in restore tests are unchanged. Dependencies
linked offline/frozen/ignore-scripts, no version or lockfile edit. The TDD skill's
generic full-suite instruction conflicts with the explicit no-whole-gate scope;
focused execution is used, without weakening the permanent gate.

## Verification

The only fixture fix selects Git Bash on Windows and `bash` from PATH elsewhere,
matching existing Caddy/admin helpers. POSIX path conversion is unchanged.
One execution regression invokes both real fixture runners with a spaced script
path, Bash arrays, an environment value containing spaces/metacharacters, separate
stdout/stderr and exit status 7. It does not reimplement the selection ternary,
parse source text, mock a shell or start Docker. A wrong shell or unavailable
executable fails the subprocess outcome assertions.

RED/GREEN evidence is deliberately separated by host:

- Native Linux RED, reused from the authoritative root brief: HomeNode
  Node24.21.0 returned status null / ENOENT for the Windows literal and status 0
  / GNU Bash5.2.21 for `bash --version`. No native Linux command was rerun here.
- Windows compatibility baseline, 16:14:02 MSK: the new execution case passed
  before the selection fix (1 passed / 72 filtered or disabled). Windows was
  not broken originally; this is not presented as a local RED.
- Windows GREEN, 16:14:19 MSK: command below returned 6 passed / 0 failed /
  67 filtered or disabled in 3.01 seconds. Both asynchronous same-release
  interleavings and the synchronous backup/verifier paths ran actual Git Bash
  with synthetic database/encryption tools. No native Linux GREEN is claimed.

```text
pnpm --filter @workspace/scripts exec vitest run src/backup-contract.test.ts -t 'launches Bash on the host platform|rejects password and database URL|streams pg_dump into age|preserves same-release evidence|verifies an untampered backup directly' --maxWorkers=1 --testTimeout=10000
```

Exact selected cases:

1. launches Bash on the host platform for synchronous and asynchronous fixtures
2. rejects password and database URL arguments without printing them
3. streams pg_dump into age and commits only private final artifacts
4. preserves same-release evidence across a concurrent successful owner interleaving
5. preserves same-release evidence across a concurrent failing owner interleaving
6. verifies an untampered backup directly

`pnpm --filter @workspace/scripts typecheck` and `git diff --check` returned
exit 0. No permanent skip/gate change was made. The mandatory Linux actual-0600
Docker case and opt-in PostgreSQL restore tests remain unchanged, not invoked.

## Other subprocess assumptions

Read-only inspection covered the mandatory command list and real child-process
launch sites in scripts plus the listed Platform/API/admin/player/search/
integrations/download-worker test packages. No second unconditional Windows
Bash executable was found. Caddy/admin helpers already branch by platform;
Node bundle/smoke cases use process.execPath; shell startup probes use sh;
Docker/Compose and Git invocations use command names. Opt-in Caddy container
validation additionally requires pwsh; it is not enabled by the default gate.

One concrete layout assumption needs root's native check, not an unverified
claim that HomeNode is broken:

- `scripts/src/operator-release.ts:269` derives Corepack from
  `dirname(process.execPath)/node_modules/corepack/dist`, without another
  installation-layout resolution. Lines 283-293 launch corepack.js and pnpm.js
  there before the scripts suite. `scripts/src/operator-release.test.ts:83`
  and `:90` repeat that layout, and its real CLI cases invoke the pnpm path at
  `:2832`. The Bash fix cannot cure missing files at those computed locations.
- Root action: check those two computed files against its actual Node/Corepack
  installation without running prepare. If absent, the minimal additional source
  scope is operator-release.ts command-path resolution and its directly affected
  CLI fixtures. This is outside the current two-path patch; no workaround link,
  install, executable override or source-gate bypass was attempted.

Existing mandatory Docker/Compose prerequisites remain prerequisites, not new
portability regressions: backup actual modes, API admin-config compose rendering
(`artifacts/api-server/src/admin-config-contract.test.ts:36`) and deployment
contract compose checks need root's isolated validation environment. No further
native blocker was confirmed because this owner did not access HomeNode.
