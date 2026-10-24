# TF validation failure diagnostics - 2026-09-21

## Resume record

- Owner: Apollo.TF `019ef2c2-95cb-7d01-9951-aa0abfe25d37`.
- Stage: TF-VALIDATION-DIAGNOSTICS-20260921, CANDIDATE_READY.
- Source: clean base `56ca3a825726cfbb85da4a3e3a7fc5195bbcfa69`, branch
  `codex/tf-validation-diagnostics`, worktree
  `D:/CodexProjects/Apollo.TF/.worktrees/tf-validation-diagnostics`.
- Authority: root brief
  `D:/CodexProjects/Apollo.Platform/docs/handoff/2026-09-21-tf-validation-diagnostics-owner.md`.
- Scope: operator-release.ts, its affected tests, active runbook, this journal.
- Blocker: none for diagnostics. Cause of native prepare B remains unknown;
  root investigates separately. Accepted prior fixture fixes are not reopened.
- Next: root independently reviews the candidate containing this journal.
  Native failure localization and any later preparation remain root-owned.

## Chosen compatibility contract (before implementation)

Add only optional `validationStage` to the existing CLI failure JSON, alongside
the unchanged `error: "source_validation_failed"`. Successful output and receipt
schemas are unchanged. No additional file, preparation receipt, or publication
artifact is produced by diagnostics. Callers consuming `error` keep that field;
strict error-object consumers must tolerate the additive optional field.

The stage is attached at the actual preparation command call, using fixed IDs
stored with the existing command table: `corepack_enable`, `dependencies_install`,
`scripts_tests`, `platform_api_tests`, `tf_api_tests`, `tf_admin_tests`,
`tf_web_tests`, `tf_search_tests`, `tf_integrations_tests`,
`tf_download_worker_tests`, `workspace_typecheck`. Preparation archive commands
use `source_archive` and `source_extract`; explicit archive mismatch checks use
`source_archive_integrity` and `claimed_archive_integrity`.

Only internally created error objects may carry trusted stage evidence, via a
private WeakMap. Arbitrary error properties, even a plausible stage name, do not
become evidence. Unknown or unstaged failures omit the field; there is no
fallback stage. No output, status value, argv, path, environment, exception
chain, token, URL, or free-form detail is included. Mandatory commands, order,
timeouts, hashes, claim semantics, cleanup and success schemas stay unchanged.

The shared preparation function serves complete and TF-only profiles. Publication
does not acquire guessed validation stages. Consumed `v0.1.0-20260921a` and
`v0.1.0-20260921b` remain closed: no retry, mutation or deletion.

## Verification plan

Use the existing injected child-command boundary with real local temporary
files, claim writing, hashing, cleanup and CLI serialization. Match command
identity and arguments, not an ordinal stage counter. Verify each failing gate
stops later commands; cover thrown child errors, hostile output/properties,
explicit archive mismatch and unknown errors. Retain claim-only failure state
and successful schemas. No actual preparation, SSH, Docker, registry, credentials,
new agents or old full suites. Native failure localization stays with root.

The TDD/worktree skills' general full-suite baseline rule conflicts with this
explicit brief; only changed boundaries are tested. Dependencies were linked
offline with frozen lockfile and lifecycle scripts disabled (102 reused, none
downloaded). The native worktree tool is bound to the stale removed task cwd;
Git created the isolated worktree in the existing ignored `.worktrees` location.

## Evidence and self-review

- RED at 17:42:41 MSK: 15 failed / 2 passed / 91 filtered. Each failing assertion
  expected the fixed observed stage but received only source_validation_failed.
  The two already-passing cases establish the existing unknown-error boundary.
- GREEN at 17:43:33 MSK: all 17 selected cases passed, 91 filtered, 494 ms.
- Final affected-boundary run at 17:45:07 MSK: 23 passed / 0 failed / 85 filtered,
  789 ms. Seventeen diagnostic cases plus six existing preparation, exact command
  order, same-ID claim exclusion, success CLI, cleanup precedence and gate-stop
  cases. All child commands are injected; local claim/hash/cleanup/JSON code is
  real. This is not execution of the package validation suites or native prepare.
- `pnpm --filter @workspace/scripts typecheck`: exit 0.
- `git diff --check`: exit 0. Formatting stayed within changed blocks.

```text
pnpm --filter @workspace/scripts exec vitest run src/operator-release.test.ts -t 'reports observed validation stage|omits unobserved validation stage|rejects validation that mutates the exact source archive|claims the release and publishes a receipt|allows only one same-ID preparation|validates the archived commit before publishing|prepares and then publishes through distinct|surfaces cleanup failure over a primary|stops before registry inspection when the archived source gate fails' --maxWorkers=1 --testTimeout=10000
```

The command table is unchanged except for literal stage IDs and readonly literal
typing. Nonzero/throwing child paths still sanitize their values. The actual last
failed command and full argv are asserted against independent test literals;
none of those argv values are emitted by the CLI. Every failed command case
retains exact claim.json, removes temporary source and has no receipt/output.
The existing source-archive mutation regression now also observes its stage.
The later claimed-archive mismatch adds only its fixed ID; its existing hash,
copy/fsync and no-receipt behavior are preserved, not separately fault-injected.
Such a late failure may leave the non-consumable claimed archive, as before.

WeakMap evidence survives the existing sanitized-error propagation without
serializing the Error or arbitrary properties. Unstaged errors, including a
forged validationStage on an otherwise allowlisted error, remain unstaged.
Cleanup failure still takes precedence without pretending the last validation
gate is the cleanup cause. No successful receipt/output field changed.

Four paths only: operator-release.ts, operator-release.test.ts, active rollout
runbook and this journal. No dependencies/locks, product code, manifests, deploy
scripts, reserved publisher or accepted prior owner checkout were modified.
Both preserved local checkouts remain clean. No native B cause is inferred;
prior root diagnostic acceptance remains valid and both consumed IDs stay closed.
