# TF GHCR Native Admission - 2026-10-02

Status: **PRIVATE_REGISTRY_WRITE_AND_HELPER_PULL_PASS**.
This is real registry authorization evidence, not publication of TF application
images, release acceptance, or an authenticated canary deployment.

## Ownership and Credentials

- The user supplied a fresh protected publisher credential and explicitly
  resumed only Auth -> Platform -> TF canary at the Apollo.Quasar coordinator.
  TF owns its nine registry targets; the coordinator owns the separate Platform
  canary publisher and runtime. Other paused Quasar work is not resumed.
- GitHub API verified `ALTIS13`, account ID `50678628`, exact
  `write:packages`, expiry `2026-11-01 19:50:38 UTC`. The supplied file's ACL
  was restricted to its Windows owner, SYSTEM, and Administrators, with no
  inherited permissions. Credential bytes were not emitted or committed.
- A distinct existing read credential was decrypted only in process memory.
  GitHub API verified the same owner, exact `read:packages`, expiry
  `2026-12-20 11:59:04 UTC`. No replacement pull credential was needed.
- Both native Docker logins passed. Publisher and Coolify configurations are
  separate, root-owned regular files with mode `0600`, under mode `0700`
  directories. Each contains only the `ghcr.io` auth entry. The login operation
  rejected preexisting configurations rather than overwriting other owners.
- Independent review identified Docker credential-helper autodetection as a
  possible shared-store bypass. Native inspection found both Linux helpers
  absent; the login script now fails closed if either becomes available.
  Configuration inspection confirmed file-only storage, with no helper setting.

Protected custody locations remain in the private operational handoff, not this
report. GitHub's [Container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
describes the classic PAT scopes and digest-based pull used here.

## Effective Registry Proof

The authenticated owner's complete package inventory established all nine TF
packages absent before this attempt. One `FROM scratch` image, containing only
a public proof text and labels, was built with networking disabled. It has no
application executable, runtime configuration, or credentials.

| Item | Evidence |
| --- | --- |
| Interval | `2026-10-02T20:01:03Z` to `20:02:27Z` |
| Non-release tag | `access-check-20261002-79ebdd6-8f2a4c1e` |
| Proof image ID | `sha256:7d6088c8ded7bbd08fedb0839b3e59f03f58874c9869a73fac9dde10bdae2f08` |
| Registry manifest digest, all nine | `sha256:3b4e4c9c9f73964998ba13f292491854923b35e6ea64d1ed110e179cb42f848c` |
| Coolify helper | `ghcr.io/coollabsio/coolify-helper:1.0.13` |
| Executed helper image ID | `sha256:88f3af093e3f1bb5b2b43bf0f2de7e70668d25dffb7f4037657ce5a274d72ecf` |

For **each** repository below, the same publisher credential accepted a push,
registry inspection matched the returned manifest digest, GitHub API confirmed
private visibility, and the installed Coolify helper successfully pulled the
immutable digest using the independently verified read-only credential:

1. `ghcr.io/altis13/apollo-tf-api`
2. `ghcr.io/altis13/apollo-tf-postgres`
3. `ghcr.io/altis13/apollo-tf-web`
4. `ghcr.io/altis13/apollo-tf-admin`
5. `ghcr.io/altis13/apollo-tf-search`
6. `ghcr.io/altis13/apollo-tf-integrations`
7. `ghcr.io/altis13/apollo-tf-integrations-postgres`
8. `ghcr.io/altis13/apollo-tf-download-worker`
9. `ghcr.io/altis13/apollo-tf-download-redis`

The installed Coolify deployment job and its effective configuration were read
directly. The probe used its read-only registry-config mount and Docker socket
mount, with the exact locally resolved helper image ID. This is an actual helper
process pull, not merely a host login or an assumption about Coolify. It is not
a complete application deployment job. All nine finite helper containers exited
and were removed; no proof container remains. The nine explicitly inventoried
private proof tags are retained, never promoted to application tags. No package
deletion or `delete:packages` permission was used.

The structured per-repository receipt and bounded operational scripts are kept
under ignored `.ops-private/ghcr-platform-auth-20261002/`. The native receipt is
retained in the new isolated publisher root as well.

## Source and Native Boundary

A new protected native checkout was populated from a verified self-contained
Git bundle, without reusing old publisher claims or receipts:

- Clean source: `79ebdd68febfff8d88293d84da4e60776b1aa240`.
- `git archive --format=tar` SHA-256:
  `264cde1aec133fb51de5cdc225995021c5e9ba06cd7417a3727d8f304623c09a`.
- Root-owned Node `24.21.0`, Corepack `0.34.6`; pnpm resolves to the repository's
  pinned `10.33.2` when invoked from this checkout. Outside it, the ambient
  Corepack selection is different and must not be used as the project version.
- Docker Engine/client `29.1.3`, Buildx `0.31.1`, default Docker context,
  Linux `x86_64` target. These observations are not a release-tool execution.
- The operator's environment filter does not forward `DOCKER_CONFIG`.
  Direct proof commands used an explicit `docker --config` argument. Do not
  assume the publisher operator will use this isolated credential without
  separately validating its execution context.
- The `publisher_preflight_required` guard is unchanged. No application release
  claim, prepare receipt, application image build/push, or deployment occurred.
  The old `f3828eb` candidate is not relabeled and does not include the newer
  listener source. This admission report does not change that historical record.

## Infrastructure and Continuation

Post-check: Caddy remains active and its configuration SHA-256 remains
`a6470fa21877a854a7fbdc774305e5b054351723d682d021be95fa9119e39807`.
The observed Coolify, Remnawave, account-staging, and recovery containers retain
their running/healthy state and prior uptime. No application restart, DNS,
firewall, route, proxy, or production Auth/API change was made by this task.

The coordinator accepted the user's narrow canary resume and received the new
custody and actual registry-proof deltas. Real issuer/JWKS, TF client admission,
entitlement, and recovery acceptance remain coordinator-owned and unproven in
this TF record. Production Auth/API remain held.

Next: admit the successor publisher's isolated execution context and exact
source tuple, verify fresh absence of its nine application release tags and
exclusive ownership immediately before claim, then make the reviewed narrow
operator gate change and publish source-matched application images. In parallel,
consume the coordinator's actual canary runtime/client/recovery handoff. Reuse
this effective registry proof while its inputs remain unchanged; do not replay
old publisher A/B/C/F work or unrelated application suites.
