# TF canary publisher preflight, 2026-09-27

Status: **STOP before claim**. This is a source-only release candidate, not a
publication or deployment authorization. No PAT, release claim, receipt, build,
push, Coolify change, or host change was used to prepare this note. GitHub Actions
are prohibited by the user's choice; publication, if later authorized, is an
operator-run native publisher action only.

## Selected release tuple

| Input                              | Exact selection                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Source commit                      | `91bfd69d1c1938179cc8a478c93da0d6f45c42b3`                                                                    |
| Proposed one-use release ID        | `v0.1.0-canary.20260927.91bfd69` (not claimed)                                                                |
| TF web API origin                  | `https://api.tf.canary.apollot.ru`                                                                            |
| `git archive --format=tar` SHA-256 | `5a61e99e6cac2d8ddb97e01d715dca499fe4043e5bc3a8c514e69e6765135418`                                            |
| Publisher profile                  | TF-only, `--mode production`, `linux/amd64`; pass the exact `--tf-web-api-origin` on both prepare and publish |

The source commit was the worktree's `HEAD` when the candidate was selected;
the later operator-tool commit is separate and must be recorded independently.
The existing source archive hash was checked locally without creating a new
archive file. Neither observation is native publisher or GHCR proof. The TF-only
catalog in `scripts/src/release-images.ts` has these **nine**
custom GHCR targets; its tenth entry is an external, digest-pinned Redis image,
not a tag to publish. Treat the complete catalog, Dockerfiles and build targets
at this source commit as one immutable image tuple.

| Image                      | Exact tag that must be absent                                                    | Dockerfile target                                         |
| -------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `tf-api`                   | `ghcr.io/altis13/apollo-tf-api:v0.1.0-canary.20260927.91bfd69`                   | `artifacts/api-server/Dockerfile#runner`                  |
| `tf-postgres`              | `ghcr.io/altis13/apollo-tf-postgres:v0.1.0-canary.20260927.91bfd69`              | `artifacts/api-server/Dockerfile#postgres-role-init`      |
| `tf-web`                   | `ghcr.io/altis13/apollo-tf-web:v0.1.0-canary.20260927.91bfd69`                   | `artifacts/music-player/Dockerfile#runner`                |
| `tf-admin`                 | `ghcr.io/altis13/apollo-tf-admin:v0.1.0-canary.20260927.91bfd69`                 | `artifacts/admin-dashboard/Dockerfile#default`            |
| `tf-search`                | `ghcr.io/altis13/apollo-tf-search:v0.1.0-canary.20260927.91bfd69`                | `artifacts/tf-search/Dockerfile#runner`                   |
| `tf-integrations`          | `ghcr.io/altis13/apollo-tf-integrations:v0.1.0-canary.20260927.91bfd69`          | `artifacts/tf-integrations/Dockerfile#runner`             |
| `tf-integrations-postgres` | `ghcr.io/altis13/apollo-tf-integrations-postgres:v0.1.0-canary.20260927.91bfd69` | `artifacts/tf-integrations/Dockerfile#postgres-role-init` |
| `tf-download-worker`       | `ghcr.io/altis13/apollo-tf-download-worker:v0.1.0-canary.20260927.91bfd69`       | `artifacts/tf-download-worker/Dockerfile#runner`          |
| `tf-download-redis`        | `ghcr.io/altis13/apollo-tf-download-redis:v0.1.0-canary.20260927.91bfd69`        | `artifacts/tf-download-worker/Dockerfile#queue-redis`     |

## Separate publisher custody

The publisher owner must provision a **new, dedicated, protected native checkout**
and toolchain containing the selected source commit and the approved operator
tool commit. The publisher must archive the selected source SHA, not its newer
tool `HEAD`. Do not use or copy state from
`/opt/apollo-platform-production/tf-publisher-20260921a`. Record the canonical
checkout path, filesystem owner, access controls, Git/Docker context, Node,
Corepack, pnpm, Docker Engine and Buildx versions, and target architecture before
any claim. `package.json` pins pnpm `10.33.2`; the operator also expects
`corepack.js` and `pnpm.js` under
`dirname(process.execPath)/node_modules/corepack/dist`. Resolve that native
layout read-only. Unknown tools, mismatched versions/layout, writable-by-other
checkout, or shared Docker credentials mean STOP, not an improvised install.

Keep the publisher's Docker config/credential helper isolated from Coolify.
After a separately authorized preparation, retain the claim, `source.tar`, and
`prepare-receipt.json` together under the new checkout's
`.ops-private/tf-only-release-claims/<releaseId>/` with native owner-only
permissions and no symlink redirection. Use that exact receipt once in the same
checkout for publication; do not transplant, edit, or regenerate it to bypass a
failed gate. The final private manifest, environment fragment, and completion
marker belong under `.ops-private/tf-only-releases/<releaseId>/`. A failed claim
or partial push consumes the ID; investigate and select a new ID rather than
replaying it. See the existing [TF-only publisher contract](apollo-production-rollout.md#tf-only-publication-profile)
for operation syntax and the [canary readiness record](2026-09-23-tf-listener-readiness.md)
for separate deployment dependencies; this preflight does not repeat either runbook.

## Pre-claim native read-only gate

The publisher owner records redacted, current evidence from the _new native
checkout_ before invoking preparation, which would create the claim:

1. Reconfirm exact `HEAD`, clean tracked/untracked source, catalog and build
   targets, proposed ID, canary origin, and stream-hashed native `git archive`
   SHA-256. Bind the observed Git, Node/Corepack/pnpm, Docker/Buildx, Docker
   context and `linux/amd64` tuple to this check. Any difference from the
   selected source/archive/image tuple is STOP.
2. Confirm an already-established, isolated Docker-auth session at `ghcr.io`
   comes from the **same** classic PAT examined for GitHub API identity and
   `write:packages` scope, without printing or copying the secret. Verify the
   authenticated principal, `altis13` namespace ownership or membership,
   applicable package write roles or creation rights, and SSO authorization if
   required. A successful `docker login`, a token scope header, or a package
   settings view alone is **not** proof that GHCR will accept a push. Do not run
   `docker login` as part of this read-only gate; if the session or same-PAT
   provenance cannot be established, STOP.
3. With that Docker context, inspect **all nine exact tags above**. Accept only
   an unambiguous registry `manifest unknown` or `not found` for each exact tag.
   A found manifest, denied/unauthorized response, timeout, rate limit,
   transport failure, or mixed/ambiguous error is STOP; do not infer absence
   from it. The publisher's own tag check occurs after it writes
   `publication-started.json`, so it cannot substitute for this pre-claim gate.
4. Exclude a competing publisher or existing claim/receipt/output for this ID
   across the approved publisher estate and GHCR. Identify one owner and one
   exclusive release window; if another runner, checkout, or operator can claim
   or push the same tags, STOP. Recheck the exact tags and exclusivity
   immediately before any later authorized claim.

The source-only command `pnpm --silent release:preflight:tf-canary` checks the
local source archive, candidate paths and image tuple without writing a claim.
It deliberately exits nonzero with `decision: blocked` and names the unresolved
native gates. Both TF-only and legacy `prepare`/`publish` entrypoints reject
every otherwise-valid canary-segment release ID with
`publisher_preflight_required` before claim or publication; the legacy profile
shares the TF GHCR repositories. Invalid origins still fail their existing
argument check. Ordinary production release IDs and the historical F
publication path remain unchanged. Unblocking requires a reviewed operator-tool
change after native proof; never remove the guard merely because local checks
pass.
When the gate is opened, restore focused tests for canary origin binding through
the web build argument, release evidence, and receipt tamper rejection.

These checks establish identity, readable registry state and source/tool
consistency, **not effective write access**. Therefore the present gate remains
**STOP** even if every read-only check passes. The exact unresolved native proof
task is a separately authorized, controlled push of a disposable, non-release
tag to **each of the nine exact GHCR repositories** using the same classic PAT,
Docker-auth context and publisher principal; verify each resulting registry
digest, record only redacted outcomes, and reconcile the nine exact proof tags
under explicit cleanup authority. Prestate, package-creation permission and
visibility must be reviewed before that task; if any proof push is not
authorized, do not substitute a read probe or use the proposed canary ID.

Keep the publication classic PAT (`write:packages` plus effective namespace and
package rights) separate from a Coolify pull credential with only
`read:packages` and read access to the private TF packages. Never give the
publish PAT to Coolify or rely on anonymous pull. GitHub documents
[GHCR authentication and push](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry),
[package scopes and roles](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages),
[per-package access control](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility),
and [token scope response headers](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
