# TF preparation follow-up - 2026-09-21

## Resume record

- Owner: Apollo.TF `019ef2c2-95cb-7d01-9951-aa0abfe25d37`.
- Stage: TF operator argv and fixture isolation correction, CANDIDATE_READY.
- Worktree: `D:/CodexProjects/Apollo.TF/.worktrees/tf-operator-doc-argv`;
  branch `codex/tf-operator-doc-argv`, verified clean base
  `1e56d920df170997f95645c49bf91fb40fd24fb9`.
- Authority: root task `019f88d4-1219-78b1-a93e-16bab96964ac` assigned this
  bounded documentation/CLI-usage correction after native preparation rejected
  the documented standalone `--` before any claim/output creation.
- Scope: rollout runbook; operator, backup, Caddy and native-admin-token tests;
  shared test-only noninteractive Bash launcher; this journal (7 paths).
- Blocker: none. Root retains frozen preparation/publisher/runtime ownership.
- Next: root independently reviews the local candidate containing this record,
  then runs only affected cases on Linux. No owner preparation or publication.

## Safety

No production operator/parsing semantics, manifests, UI or runtime are edited.
The expanded root assignment explicitly permits the three additional fixture
corrections below. No SSH, real Docker, prepare, registry, publication, full suite,
push/merge/deploy or new agents/tasks. Dependencies were linked offline with
frozen lockfile and lifecycle scripts disabled. The runtime forwarding proof
uses a temporary workspace whose operator entrypoint is replaced with an
argv-only collector. It never imports/runs preparation or publication there.

## Root diagnostic delta

Root's native evidence is retained, not rerun here: exact publisher 1e56d920,
Node24.21.0/pnpm10.33.2, Linux scripts diagnostic: 293 passed / 5 failed /
6 skipped in 30.66 seconds. The five failures were the backup metadata case,
Caddy generation plus both rollback cases, and native admin token ownership.
Root retains `scripts-diagnostic-20260921a.log`. Its corrected-argv preparation
created only a claim for `v0.1.0-20260921a`, then source_validation_failed.
That release ID is consumed and MUST NOT be retried. No receipt/output was
produced; only root may choose any later preparation action. Publisher source
remains frozen throughout this follow-up.

## Causes and corrections

### pnpm forwarding

pnpm 10.33.2 forwards standalone `--` after a package script name all the way
through the registered nested pnpm exec command. The pairwise operator parser
correctly rejects it; accepting/stripping it in production was not authorized
or needed. Both documented TF-only examples now pass flags directly. The same
typo in three adjacent active complete-profile examples and their exact-string
checks was corrected, without changing profile semantics. Historical July
implementation plans remain historical; the active rollout runbook is current.

Two regression cases read the TF-only invocation lines, substitute only their
documented variables with synthetic values, and use the actual registered
pnpm chain in a temporary workspace. Only `tsx src/operator-release.ts` is
replaced with a Node argv collector. Pinned packageManager/user-agent is checked;
network downloads are disabled. The captured arguments must match the operation
and intended flags, including a receipt path containing spaces, then pass the
existing pure argument parser. No operator action is invoked and no .ops-private
directory may appear. Temporary fixture directories are removed in finally.

### Backup operation boundary

The initial successful backup legitimately calls sha256sum. The old assertion
searched its entire cumulative tool log when checking a later rejected verifier.
The fixture now records the completed-backup prefix and checks only the verifier
delta, while also requiring the prefix to remain intact. Forbidden checksum
execution and sensitive-value disclosure checks remain in that delta, and the
generic failure output assertion is unchanged. An existing BASH_ENV function
fixture logs the real checksum call on both Windows and Linux, so the old
assertion fails locally as well instead of depending on PATH differences.
No backup/verifier production shell or accepted host Bash selection was changed.

### Noninteractive test shell isolation

The affected tests launch Bash with `-ceu` before execing their actual /bin/sh
scripts. Those scripts do not source bashrc. A controlled local fixture using
HOME/.bashrc, SSH_CLIENT/SHLVL and BASH_ENV reproduced startup stderr while the
requested command still exited 0, including an unset-PS1 error. This matches the
root failure class; the precise native ambient environment was not inspected.
GNU documents remote-shell startup and BASH_ENV behavior separately:
[Bash startup files](https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files).

The shared test-only `runFixtureBash` adds --noprofile/--norc and removes BASH_ENV
and ENV only from a cloned child environment. Caddy generation, credential
verification, both rollback paths and native admin ownership use it. It returns
raw stderr unchanged. The regression requires an intentional command-error line
to survive exactly, and requires the hostile startup marker never to be written.
No global PS1 injection, host bashrc change, production shell edit, suppressed
stderr, or relaxed secrecy assertion was introduced. Backup's intentional
BASH_ENV function hooks remain separate and usable.

## Focused evidence

- RED argv, 17:15:38 MSK: the two documented TF-only commands produced captured
  arrays with the extra `--`; both failed the expected-argv assertions.
- RED fixture causes, 17:19:19 MSK: backup failed on its preceding sha256sum log;
  noninteractive shell failed on actual startup-canary/unset-variable stderr.
- GREEN, 17:20:12 MSK: 4 files / 9 passed / 0 failed / 170 filtered or disabled,
  6.80 seconds, using the command below. These are local Windows/Git Bash cases,
  not a new native Linux acceptance claim.
- `pnpm --filter @workspace/scripts typecheck`: exit 0.
- Formatting was limited to new blocks/helper. `git diff --check`: exit 0.

```text
pnpm --filter @workspace/scripts exec vitest run src/operator-release.test.ts src/backup-contract.test.ts src/caddy-release-contract.test.ts src/native-admin-token-ownership.test.ts -t 'forwards documented|binds production publication guidance|rejects hostile metadata before|isolates inherited shell startup|derives the nginx htpasswd|runs rollback validate and reload|runs without credential or source-path disclosure' --maxWorkers=1 --testTimeout=10000
```

The nine cases are TF-only prepare forwarding, TF-only publish forwarding,
active guidance binding, hostile backup metadata, startup-file isolation,
Caddy credential generation, rollback with prior env present, rollback with
prior env absent, and native admin-token ownership without disclosure. All
Caddy/Docker commands reached only existing synthetic fixture executables;
no daemon, container, registry, account or real credential was accessed.

Self-review confirms only the seven listed paths changed. Mandatory gates,
production parser, Docker-dependent permanent tests and root-owned candidates
are untouched. The next evidence is root's independent review and one focused
native Linux rerun, not an owner replay of preparation or the full scripts suite.
