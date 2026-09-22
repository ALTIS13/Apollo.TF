# TF release baseline - 2026-09-21

## Resume record

- Owner: Apollo.TF task `019ef2c2-95cb-7d01-9951-aa0abfe25d37`.
- Stage: `TF-RELEASE-BASELINE-20260921`, `CANDIDATE_READY_FOR_ROOT_REVIEW`.
- Source: `D:/CodexProjects/Apollo.TF/.worktrees/tf-only-publisher`, branch
  `codex/tf-only-publisher`, clean input `f2e62c41068fcee5c6187b1eba8256cffe1c9ba5`.
- Authority: coordinator brief
  `D:/CodexProjects/Apollo.Platform/docs/handoff/2026-09-21-tf-release-baseline-owner.md`.
- Evidence: four precise environment-drift failures reproduced on this base;
  existing publisher 91 checks remain accepted evidence. A fresh scripts
  typecheck covers the changed `it.each` tuple/callback typing below.
- Blocker: none for source-only work. Root owns acceptance, publication and runtime.
- Next action: root reviews the local commit containing this journal, accepts
  its exact SHA and binds release preparation to it. No push/merge by TF.

## Cause and scope

`validateCoolifyRelease` invokes both the general environment comparison and
`validateTfProductionBinding`. Four hostile-value cases change fixed TF API
binding inputs: `APOLLO_PLATFORM_API_ORIGIN`, `APOLLO_PLATFORM_ISSUER`,
`APOLLO_TF_BRIDGE_ALLOW_INTERNAL_HTTP`, and `APOLLO_TF_CALLBACK_URL`. Each must
return exactly `environment_contract` and `tf_production_binding`, in sorted
order with redacted stack/service context. The old table expected only the
first error. This is stale test evidence, not a validator defect.

Changed scope: the four table rows and exact expected error list in
`scripts/src/coolify-release.test.ts`, plus this journal. Other table rows still
expect only the environment error. `toEqual`, `ok: false`, and value-redaction
checks remain intact; no arbitrary error superset, new tests, copied validator
logic, fixture change, production change, or contract change.

All four reproduced failures belong to `coolify-release.test.ts`; the adjacent
`coolify-production-smoke.test.ts` has no expectation requiring this correction
and is left byte-identical. Both files remain in scoped verification. The live
Docker smoke is opt-in and must remain disabled.

## Evidence

Each test command is preceded by this source-only safety check:

```powershell
if ($env:APOLLO_RUN_COOLIFY_PRODUCTION_SMOKE -eq '1') { throw 'Live smoke enabled; refusing source-only run' }
```

RED (2026-09-21 15:22 MSK):

```powershell
pnpm --filter @workspace/scripts exec vitest run src/coolify-release.test.ts src/coolify-production-smoke.test.ts --maxWorkers=1 --testTimeout=10000 -t 'rejects rendered environment drift for apollo-tf.tf-api.APOLLO_(PLATFORM_API_ORIGIN|PLATFORM_ISSUER|TF_BRIDGE_ALLOW_INTERNAL_HTTP|TF_CALLBACK_URL)'
```

Exit 1: exactly 4 failed, 114 deselected/skipped. Every failure is the extra
redacted `tf_production_binding` object, not an infrastructure or fixture error.

GREEN of the same four-case command (15:24:09 MSK): exit 0, 4 passed and 114
deselected/skipped. Complete owning-file run (15:24:33 MSK): exit 0, 117 passed
and 1 intentionally skipped opt-in Docker smoke.

```powershell
pnpm --filter @workspace/scripts exec vitest run src/coolify-release.test.ts src/coolify-production-smoke.test.ts --maxWorkers=1 --testTimeout=10000
pnpm --filter @workspace/scripts typecheck
```

Typecheck is justified by the changed typed `it.each` tuple/callback signature,
not production changes. First run caught TS2322: `as const` inferred the optional
fourth value as literal `true`, incompatible with the `false` default. Explicit
`boolean` parameter annotation resolves the test-only typing.

Final source verification (15:25 MSK): scripts typecheck exit 0, no diagnostics;
complete two-file command above exit 0, 117 passed / 0 failed / 1 skipped
(the sole explicitly gated live Docker scenario). `git diff --check` exit 0.
No broader suite was run. Runtime enforcement files and the smoke file remain
unchanged; exactly the owning test and this journal enter the local commit.
Exact resulting commit SHA and base-to-candidate inventory are sent to the
coordinator; the journal identifies its candidate by its containing commit.

## Acceptance boundary

Source-only candidate. No credentials read, Docker/WSL, registry login,
prepare/publish, release-ID claim, build/push, deployment, or cross-project edit.
Preserved dirty `tf-product-finish` is untouched. No full project suite or
unchanged publisher gate is replayed for the assertion changes.
This does not establish a green preparation receipt or runtime acceptance.

## Next TF queue

For coordinator selection, not automatic expansion of this slice:

1. READY for a bounded source/fixture assignment: existing admin visual-state
   smoke, then compact search-first composition and separate integrations
   navigation. These are the independent items in
   [remaining gates](../handoffs/2026-09-05-tf-remaining-gates.md), not new D05 or
   player work. Source still has the large Home hero and provider connection UI
   in Favorites; App has no settings/integrations route. No edits made here.
2. DEPENDENT: real browser login, liked A/B isolation, revoke, full-track audio
   and renewal beyond five minutes. Requires root's accepted image, dedicated
   TF Redis/custody and real Platform/Auth producer. Reuse accepted liked PG17
   and D05/source checks. Optional successor WS remains off until its own proof.
3. DEPENDENT: bounded TF status/launch/deep-link/release integration requires
   current owner-issued Platform/Quasar contracts and a new bounded assignment;
   do not replay the historical broad architecture plan.

Root's current checkpoint and custody admission in Apollo.Platform state both
GitHub tokens are ready and nine targets were absent in the accepted inventory.
TF does not recheck secrets or registry state. After review, root binds the new
candidate source and owns fresh release preparation/publication and actual
private pull proof. Source tests cannot replace those operational gates.
