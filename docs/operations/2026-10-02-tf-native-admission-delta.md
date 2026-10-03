# TF native admission delta

Status: READ_ONLY_CHECK_COMPLETE / PUBLISHER_BLOCKED / NO_RUNTIME_ACTIVATION.

## Current Evidence

HomeNode was inspected on 2026-10-02 through the configured SSH connection. No deployment, credential installation, image rebuild/push, container cleanup, Caddy, DNS or firewall change was performed.

- The dedicated TF Coolify API credential is present, unexpired through 2026-10-08 and successfully reads the owned build-check application (`200`). It is not a GHCR publisher or Platform identity credential.
- The owned application still pins `f3828eb016e9dc034030e2da7ca2c2a39f4327c1`, has no domain, registry publication, auto-deploy or shared-network configuration, and has zero active deployments. The sole application source-pin variable matches. Stored raw Compose hash: `5e18ba17187f811ceca92912d2ed90c103dcbe4fe0a09b0096a4d41b58804f5c`.
- Caddy is active; its current config SHA256 is `a6470fa21877a854a7fbdc774305e5b054351723d682d021be95fa9119e39807`. Existing non-TF services were not changed.
- **All nine exact native build image IDs recorded on October 1 are now absent.** This was checked with individual `docker image inspect`, not inferred from an empty repository-prefix filter. No cleanup cause or actor is inferred. The historical successful job remains valid build evidence, not present image availability or a launchable release.
- The discovered protected `tf-publisher-20260923b` directory contains presecret carrier/proof files, not a new Git checkout. Its owner metadata retains the retired F checkout/source binding. Directory existence does not admit a current publisher, and no retired state was copied or replayed.
- The latest located publisher custody metadata expires on 2026-09-28. No newer matching publisher custody/auth context was established. Separate pull-credential metadata has a future expiry, but current validity, package access and an authenticated Coolify helper pull remain unproved. No credential bytes were read into reports or chat.
- Current GitHub CLI account verification succeeds for `ALTIS13`, but its reported scopes are `gist, read:org, repo, workflow`, with no package scope. That repository credential was not reused or broadened. [GitHub's registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) specifies a classic PAT with `write:packages` for image publication. GitHub Actions remain excluded by the user. A request for an existing fresh protected writer handoff was sent to the Platform/RGA/AI owners; no cross-project deployment or rotation was assigned.
- Platform answered `NONE`: no current writer/custody or confirmed issuance capability in its handoff. Quasar reports no confirmed writer in its last checkpoint and explicitly does not refresh it while paused; that is stored status, not a current credential audit. RGA/AI requests are queued while their existing work continues, and an existing-handoff query was also sent to GAP without resuming paused work; absence of a response is not absence of a credential. No new PAT was issued through the currently callable tools.
- Current Platform owner status still separates source-level work from the unfinished real Auth -> Platform -> TF canary flow. No new accepted runtime/restore receipt was supplied by that status read.

Private evidence is retained in `.superpowers/sdd/server-admission-20261002`: allowlisted Coolify projection, host metadata, exact image-presence output and independent local ownership audit. The Coolify Laravel version constant was not used as installed-version evidence.

## Consequences

The [existing pre-claim gates](2026-09-27-tf-canary-publisher-preflight.md) and `publisher_preflight_required` guard remain intact. API write/deploy ability in Coolify does not establish registry authority. Do not activate the inert build-check resource as an authenticated beta, revive old receipts or relabel current source as the frozen candidate.

The next native input is a newly admitted protected publisher checkout/tool/source tuple with fresh writer custody and isolated Docker authentication, followed by effective write/absence/competing-publisher evidence for all nine repositories, separate exact-image helper pull and actual Platform/Auth/restore acceptance. A successor deployment must include the newer accepted listener UI. Rebuilding old source merely to restore cached images would not resolve these gates.

The [frozen candidate](2026-10-02-tf-canary-release-candidate.md) remains unclaimed and unpublished. While native inputs are unavailable, selected-favorites bulk removal is independent TF-owned beta work; it does not constitute progress on runtime admission.
