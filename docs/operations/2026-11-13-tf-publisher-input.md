# TF publisher input, 2026-11-13

Status: **PROTECTED_CREDENTIAL_VERIFIED / SOURCE_INTAKE_PREPARED / NOT_PUBLISHER_ADMITTED**.

The replacement classic PAT was saved outside the repository with Windows user-bound encryption and an owner-only ACL. GitHub's identity API returned `ALTIS13` (account `50678628`), exact scope `write:packages`, and expiry `2026-12-13T04:06:16Z`. The package metadata API returned `200` and `private` for all nine repositories in the [TF-only catalog](2026-10-02-tf-ghcr-native-admission.md#effective-registry-proof). These reads do not establish a successful write or an isolated native publisher login. The credential was not transferred to a build host or Coolify. Keep the publisher and Coolify pull credentials separate.

The proposed next source for native review is `f399053dbf540fc0ca299d00a58b1d7f9526c2b0`, a clean checkout descending from the consolidated `main` baseline `890b35382c5280851df15317637c7e041c7b6253`. This includes the [Spotify track-page fixes](../product/2026-11-13-tf-spotify-import-ranges.md), which are absent from the locally built `7e991b0` images. No release ID or tag is proposed or claimed by this input.

| Transport archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `tf-reviewed-source-20261113-f399053.tar` | 13,025,280 | `9657cb0efc40028f6348fc9c0f0f3f8db0b99ba998676b27c918c0ac927cd5bf` |

The archive's embedded commit matched and its inventory excluded `.ops-private` and the protected credential. The transport hash is for these exact bytes, not a claim that a different native Git produces the same archive. The [earlier OCI and Web smoke evidence](2026-11-13-tf-reviewed-oci-build.md) stays pinned to `7e991b0`; do not label those images with the new source or treat the archive as build proof.

Next: the publisher owner must select the dedicated protected Linux checkout and approved operator revision, review the exact tuple and one-use release window, and establish isolated same-credential custody there. Perform the [native pre-claim checks](2026-09-27-tf-canary-publisher-preflight.md#pre-claim-native-read-only-gate) before any claim or registry write. Keep `publisher_preflight_required` in place. Independent Coolify pull and Platform/Auth, ingress and runtime receipts remain separate gates.
