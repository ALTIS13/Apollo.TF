# TF archive Git ignore contract - 2026-09-21

## Resume record

- Owner: Apollo.TF `019ef2c2-95cb-7d01-9951-aa0abfe25d37`.
- Stage: TF-ARCHIVE-IGNORE-20260921, CANDIDATE_READY.
- Clean base: `95a4f9d1573eeb67e4ab74f25882503b6504b5b2`.
- Worktree: `D:/CodexProjects/Apollo.TF/.worktrees/tf-archive-ignore`, branch
  `codex/tf-archive-ignore` (both verified absent before creation).
- Authority: root brief
  `D:/CodexProjects/Apollo.Platform/docs/handoff/2026-09-21-tf-archive-ignore-owner.md`.
- Scope: admin-config-contract.test.ts and this journal; no production change.
- Blocker: none. Next: root independent review and the single native archive
  contract check; no owner preparation or publication.

## Cause and selected correction

Root prepare C observed source_validation_failed / tf_api_tests. Its exact-source
archive diagnostic had792pass/1fail/11skip: the ignore contract invoked Git in a
metadata-free archive and received128/not-a-git-repository. Prior diag/WS fixes
remain accepted; C joins the consumed A/B IDs and none may be replayed.

Local RED at18:09:59MSK reproduces that same single failure in a real git archive
of95a4f9d, extracted outside any repository. Only the targeted test ran (1failed,
21filtered,1.37s), with frozen offline API dependencies. No preparation operator
or runtime deployment was invoked. The validation tree has no .git.

The smallest correction uses a test-owned temporary bare Git metadata directory
and explicitly binds check-ignore's --work-tree to the source under test. Git
reads the exact archived root and nested .gitignore bytes in their real hierarchy;
no rule flattening, list of copied rules, substring/regex substitute, operational
file copy, or .git creation in the validated source is needed. Metadata is created
only inside a unique mkdtemp-owned fixture, then removed in finally.

Each Git child receives an environment with inherited GIT_* selectors removed.
System/global config, templates and global excludes are disabled or bound to
an empty fixture file; no external repo/index/config/exclude authority participates.
Docker matching continues using the existing @balena/dockerignore parser on
the actual .dockerignore bytes, never the Docker daemon.

Keep the current .env secret/template and .ops-private assertions. Add real nested
rule coverage using artifacts/api-server/proofs/coolify/.gitignore and its ignored
migrate.mjs versus included README.md; included Markdown also detects a hostile
ambient global-excludes dependency. No production ignore rules need changing.

## Validation plan

Run only the existing ignore contract from the metadata-free exact-source archive
with this one changed test copied in, including hostile Git selectors/global
configuration supplied to the child test runner. Preserve unchanged rule hashes
and .git absence. No full suites, native run, SSH, Docker, registry, credentials,
prepare, new release ID, publisher edit, UI, manifest/lock or new agent.
Root owns the independent review and native archive check.

## Completed evidence

- Exported exact95a4f9d to a disposable directory outside all repositories.
  Local source.tar SHA-256 matched root's diagnostic archive exactly:
  `50453b8190f3f8a19baa9662bae968181133c6b388519277d89019edcf750556`.
- RED18:09:59MSK:1failed/21filtered; original isGitIgnored got128, not0/1,
  with fatal not-a-git-repository. The archive had no .git before the test.
- Copied only the candidate admin-config-contract.test.ts into that archive;
  GREEN18:12:25MSK:1passed/0failed/21filtered,614ms. Existing positive/negative
  Git and Docker assertions plus nested migrate.mjs/README.md all passed.
- The test runner inherited hostile synthetic GIT_DIR/GIT_COMMON_DIR/GIT_WORK_TREE,
  GIT_INDEX_FILE, GIT_CONFIG_GLOBAL/SYSTEM, GIT_CONFIG_COUNT/KEY_0/VALUE_0,
  malformed GIT_CONFIG_PARAMETERS and GIT_TEMPLATE_DIR. Global excludes contained
  *.md and .env.example. The contract still passed; no parent process environment
  was changed and no real credential/config file was read as test input.
- Independently checked source .git absence after GREEN, no writes to hostile
  repo/index targets, and equal before/after inventories of the uniquely prefixed
  test-owned Git metadata directories. The fixture cleans only its own directory.
- Actual archive/worktree .gitignore, .dockerignore and nested proof .gitignore
  bytes matched. SHA-256 respectively:
  `1d5bbc709f16eb2fad089b4f5063600192cef1f777df288d55c4d5697a203ac2`,
  `6ab86dad30d51978e61d2a7fea9844cfa8d60e69f50d7b46f25cf2fa3ef38b8d`,
  `30425bc68e67928962375dea1734ccffe3ee5d52e19ea74bc105253d8229617d`.
- Built only seven existing TS declaration references; API typecheck exit0.
  `git diff --check`:exit0. No operator/WS/ignore/lock/manifest/deploy diff.

```text
pnpm --filter @workspace/api-server exec vitest run src/admin-config-contract.test.ts -t 'applies Git and Docker ignore rules in order for operator files' --maxWorkers=1
pnpm exec tsc -b lib/module-runtime-contract lib/tf-search-contract lib/tf-integrations-contract lib/admin-dashboard-contract lib/db lib/platform-contract lib/api-zod
pnpm --filter @workspace/api-server typecheck
```

Only this single contract was run for RED and GREEN, not Docker Compose tests or
an API/full source suite. API dependencies were linked offline/frozen with scripts
disabled (255reused/0downloads); source lock unchanged. Native Linux acceptance
remains root-owned. No production defect or ignore-rule weakness was established.

## External proof retention

Cleanup of the separate source archive/dependency proof directory was rejected by
the execution tool policy before execution, despite an exact resolved-path guard.
No alternate deletion method was attempted. Non-secret generated proof inputs and
dependencies remain at
`C:/Users/maksi/AppData/Local/Temp/apollo-tf-ignore-proof-20260921` for separately
permitted/manual cleanup. This is distinct from the tested helper's temporary Git
metadata: the helper's own finally cleanup and inventory equality passed.
