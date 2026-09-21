# TF download storage repair

Owner: Apollo.TF. Stage: source candidate verified; independent review pending.
Base: `684408e0bf80b2c64425b1d2b760799f710f9042`.
Checkout: `.worktrees/tf-download-storage`, branch `codex/tf-download-storage`.
Brief: Platform `docs/handoff/2026-09-21-tf-download-storage-owner.md`.
Synthetic root diagnostic SHA-256:
`b0cdb75ebe53b52bed77ae9b0ea128430fc4cb5bb3acefe56764552d00ee6b9f`.
Root Linux result:184passed/2failed/2skipped. Local original focused cases:
6passed/16filtered; the Linux replacement failure is not reproduced on NTFS.

## Cause and boundary

Identity is dev/ino plus expected size; timestamps are not consulted.
The original tests close and clear the operation handle before unlink/recreate.
Linux may recycle the unreferenced inode, explaining both diagnostic outcomes.
That test construction is stronger than ordinary caller access, but source
also closes its own handle before abort/failure removal and before publication.
Thus the identity-lifetime gap is present in real code, not only test setup.

Production correction in storage.ts:

- Keep the original descriptor alive through begin-failure cleanup, failed
  commit cleanup, abort removal and successful publication/partial removal.
  Successful commit closes it before returning; failed cleanup closes in
  finally, including mismatches. No handle is reacquired from a pathname.
- Require a live original handle matching dev/ino/size before unfinished
  operation cleanup. Missing/closed/mismatching authority refuses removal with
  fixed storage_unavailable and retriable=false.
- Recheck the partial after beforePublish and before link(). The new boundary
  regression also exposed that base could link the replacement into the final
  name and then refuse cleanup, leaving that foreign final behind.

The two original replacement cases and their assertions are unchanged.
Two lost-handle cases force the same identity deterministically without relying
on Linux inode reuse. A publication replacement and an open-handle abort
replacement retain the original file under another name, proving adversarial
replacement preservation without internal handle clearing. The normal abort
case observes real filesystem state at close; normal commit checks fd release.
No timestamp heuristic, content hash, filename-only trust or sleep was added.

Linux reference: [unlink(2)](https://man7.org/linux/man-pages/man2/unlink.2.html)
documents retention of an unlinked file until its last open descriptor closes.
Node reference: [FileHandle](https://nodejs.org/api/fs.html#class-filehandle).
These explain the mechanism, not proof of this candidate on Linux.

## Validation

Windows Node24.15.0, pnpm10.33.2, locked Vitest4.1.10. Filtered offline frozen
install reused125packages/downloaded0, scripts disabled; no manifest or lock
change. Scope is storage.ts, storage.test.ts and this journal only.

- RED before production edit:4failed/21filtered. The old code closed while
  the original partial still existed; lost-handle commit removed the file;
  lost-handle abort incorrectly succeeded; publication left a foreign final.
- First GREEN after source correction:9passed/16filtered, including both
  original same-sized replacement cases and the new deterministic regressions.
- Storage boundary sweep initially exposed a Windows fixture limitation:
  keeping a child file open prevents the old direct parent-directory rename.
  The root-replacement fixture now moves the still-open file temporarily out,
  swaps the root and moves the file back. It neither closes the descriptor nor
  relaxes root-identity/content/error assertions.
- Final storage file at15:59:13UTC:26passed/0failed/0skipped, exit0,558ms.
- Four directly affected processor boundaries at16:00:21UTC:4passed/36filtered,
  exit0,343ms. No processor source/test changes.

```text
pnpm --filter @workspace/tf-download-worker exec vitest run src/storage.test.ts --maxWorkers=2 --reporter=dot
pnpm --filter @workspace/tf-download-worker exec vitest run src/processor.test.ts -t 'returns strict metadata|maps external abort|observes cancellation while final progress|rolls back a committed file' --maxWorkers=2 --reporter=dot
pnpm exec tsc -b lib/module-runtime-contract lib/tf-download-contract
pnpm --filter @workspace/tf-download-worker run typecheck
```

Both declaration build and package typecheck exit0. Generated outputs remain
ignored. Diff check clean. The full worker and other release/workspace suites
were not repeated. Linux metadata-free acceptance remains root-owned.

## Residual filesystem limits

This is not an atomic path compare-and-unlink implementation. Node's portable
path APIs still leave a check/use window against another writer with the same
UID; the existing private, single-UID storage-volume boundary remains required.
Committed-final cleanup, startup scans and sweeps retain their existing identity
checks and trust model, rather than gaining a permanent descriptor per file.
No claim is made for malicious same-UID mutation, in-place data tampering or
filesystems with nonstandard identity/open-unlink semantics. Missing handle or
identity mismatch can leave a partial for operator investigation; it must not
be silently adopted. Permissions/quota/retention policy are not redesigned.

## Resume

Blocker: none. Next: root independent review and affected native acceptance
of the clean candidate. Web candidate d254cff5 remains frozen and untouched.
No SSH/Docker/credentials/prepare/deploy, new agents, full worker/workspace
suites or publisher changes. A-D stay closed.
