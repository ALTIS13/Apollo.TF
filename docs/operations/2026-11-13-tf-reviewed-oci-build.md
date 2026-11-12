# Reviewed TF OCI build handoff

Status: **LOCAL_OCI_VERIFIED / WEB_CONTAINER_SMOKE_PASSED / NOT_RUNTIME_ADMITTED**.
Source `7e991b091426e2db772669ab854e0386941c1142`; [source and fixture receipt](2026-11-13-tf-reviewed-successor-intake.md). No release tag, GHCR push, Coolify pull or deployment.

## Build and transfer

The existing Ubuntu distribution could not launch `/bin/sh` or mount Windows drives. The build used a new disposable WSL2 Alpine 3.24.4 distribution, not Docker Desktop or any existing distribution. The vendor root filesystem SHA-256 matched `cdaa38cb8de3537967ee5b6c9b6cd00cc962da2b018e6eea48696bb274923012`. Windows drive mounts and Windows interop were disabled for this distribution; only WSL's read-only driver mount was visible as 9p. The vendor-signed packages provided BuildKit 0.29.0 and runc 1.4.4. No shared credentials, Windows network settings or HomeNode resources were used.

The isolated builder verified and unpacked the original Git source tar, then built the nine `linux/amd64` targets from the exact [build-only Compose profile](../../deploy/coolify/apollo-tf.build-check.compose.yml). Dockerfile paths, targets, source labels and Web arguments came from its Compose build plan. BuildKit used an isolated local socket and empty registry credentials directory. The OCI archives were exported one at a time, and the Windows copies were verified against the build-side archive hashes, each manifest/config digest and every referenced layer digest. All contain the exact source and repository labels. The runtime profile's separately supplied Redis image is not a custom build target.

The nine retained `*.oci.tar` files total 1,141,245,440 bytes. Digests below identify the local OCI manifests and transport files, not GHCR receipts. Keep the `sha256:` prefix for OCI digests.

| Archive basename | OCI manifest SHA-256 | Archive SHA-256 |
| --- | --- | --- |
| `tf-api` | `9ace7f66a059182bdd4b508213e21af26fdfac8a18235e91e89adbc243053786` | `fdb265508d1d6df3a6725fa2f0bb1b70da68f34cbc458687d271a48a25259239` |
| `tf-web` | `627c1c3fdb46caccb21e48968f46a1d83abd29df2d82ade25419f5d5442f48a3` | `f49d4e4aaf24bd49e4bf1db36770e04a786fdea3225855af2b32327e742052f7` |
| `tf-admin` | `5bd3a3c3af93941244447fdc587e529e11452e031fb22126a115d9b3d94f8c9a` | `a5fc81b29453a2f48c6d407f1875c638e636b6379a99944d12bf5d490769c5f1` |
| `tf-search` | `e66a2ef3ea58b80a7a3362f140b286aabaa57e52c2bc23fc398013800738931b` | `bcea0d30410597d356f0a35ec6d73cf1d0de0d97350d4ab07668bb8d51eeac0f` |
| `tf-integrations` | `ca7a75476eb3680173dd88333c236cee66bd4a82a8ab00511c643773dbaa8520` | `49dbf2f77e2f9934245b339cf740819f6721f56392bfd5d8eb15687689261d90` |
| `tf-postgres` | `dfb2e9e9ae54211687c0f03a08489466225554a743d5b022e9189445b25d4a7c` | `4a2bcdc9083a48069d37de0ebde8814dbaa3206659303c9b5904c350f2865933` |
| `tf-integrations-postgres` | `6c36fc0ea83576ca06246f4eb337b454556f130ffb353ed2ab19504fcc5e6cc7` | `4446637f34246d85d28b9a02877f6372be644ede3f0a5da5600a7499c680f4b6` |
| `tf-download-worker` | `04c240d71aae05479c46cf4999c4e2fe2a1a8b9433bd2c7587ab886c183dc7cc` | `d2d78c6dfde91bac3fcb216cf5089c90c8cb07db375a9f7b4f5767d04450fd6d` |
| `tf-download-redis` | `73c81bb8261b4d857a973eaa475b68ab1c377378d89b71578f6b4e696f827296` | `36d96c4fe13325ce406e10cbe68c2bdcea65a059d5646a98d9e8596f50b2e43d` |

## Runtime smoke and boundaries

The Web OCI entry `assets/index-BQXc1HVS.js` embeds the canary API origin, not production. Its 825,063 bytes match the earlier static entry's SHA-256, `ce9e686b22eef079d57cf02ab826af9cca9b95ec1ae31c5e637f1fc2081c5436`, despite a different filename. The exact archive was unpacked with umoci and started with its original nginx entrypoint and configuration, no bind mounts, no published ports, and its own loopback-only network namespace. The local runner used a non-interactive runtime spec with standard Docker capabilities needed for nginx's ownership and user switch. An initial `403` was traced to the unpacked bundle root directory's harness-only `0700` mode; unpacking under the usual `022` umask corrected that without changing image bytes.

- `/healthz`: `200`, expected body.
- `/favorites`: `200`, correct SPA HTML and `no-cache`.
- Fingerprinted JS: `200`, expected SHA-256 and immutable cache directive.
- Missing fingerprinted JS: `404`, `no-store`.

The test container was removed. After all nine exported archives were verified, the exact disposable builder registration and its 7,864,320,000-byte virtual disk were removed; all other WSL registrations were unchanged. The verified archives remain outside Git. No browser/API sign-in, Spotify OAuth, server stack, provider media, publication, or mobile/Windows installation occurred here.

Next owner step: decide whether the admitted publisher may ingest these digest-verified archives or must rebuild the exact source in its own environment. Independently verify the actual private registry manifests and Coolify pull, then satisfy the separate Platform/Auth, ingress, rollback and cleanup requirements before registering a reviewed Application. Do not use a local manifest digest as a remote reference until the registry returns it.
