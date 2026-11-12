# Reviewed TF successor intake

Status: **SOURCE_ARCHIVE_VERIFIED / STATIC_WEB_BUILD_VERIFIED / NOT_RUNTIME_ADMITTED**.
This selects a new input for the reviewed acceptance Application; it does not supersede or republish the frozen October candidate. No release ID or tag has been claimed.

| Artifact | Exact input or evidence |
| --- | --- |
| Git source | `7e991b091426e2db772669ab854e0386941c1142`, clean checkout |
| Source tar | `tf-reviewed-source-20261113-7e991b09.tar`, 12,994,560 bytes, SHA-256 `8ef58e934c876ba43d4cb5b48e9b2e3c43ac9301a3342db84f923b0047932662` |
| Static Web tar | `tf-reviewed-web-20261113-7e991b09.tar`, 2,016,256 bytes, SHA-256 `863655c33bce0b64d22e60999ab30bb538ea61bb52cd640d0f7edd79324daf7d` |
| Compiled Web entry | `assets/index-Dwj_l5IB.js`, SHA-256 `ce9e686b22eef079d57cf02ab826af9cca9b95ec1ae31c5e637f1fc2081c5436` |
| Web build inputs | `VITE_API_URL=https://api.tf.canary.apollot.ru`, `BASE_PATH=/`, successor WebSocket disabled; Node 24.15.0 and pnpm 10.33.2 on the local host |
| Build targets | Existing TF-only profile: nine custom Linux/amd64 images and external pinned Redis. No new OCI image digest or registry claim. |

The source tar's embedded Git commit matches the selection. A second `git -c tar.umask=0002 archive --format=tar <source>` on Git 2.54.0 for Windows reproduced its bytes. The archived Web entry was read back and matched the built file; the HTML points to that single module and the entry contains the canary API origin without either production API origin. This is a local static package, not the runner image. Use the actual source archive for intake; the native publisher must verify custody, archive digest and its own build environment, not assume a different Git implementation emits identical bytes. Neither tar contains runtime secrets or private operational receipts.

REA 6.7.0 selected the compiled entry (`ev_fb2115f199d9c34d4d467c43191772facd005447eaa575fd590aa086260e04d4`) but skipped it during semantic analysis: zero JavaScript files parsed. The build, entrypoint and archive checks above are independent; the REA receipt is not evidence of analyzed behavior.

The [reviewed Compose profile](2026-11-12-tf-reviewed-acceptance.md) requires an explicit Spotify playlist API mode. 51 focused checks and scripts typecheck passed, including real Compose renders for both reviewed variants. A separate render with dummy digests and `items` reported 14 definitions, 10 networks, five volumes, `compose-config-only`, `activationAllowed: false`, and topology SHA-256 `904d9f96ef47c1a0560c3e6cf311ec3cbef87a6aebc7f824da7bf8dadd9b6188`. The dummy mode is not confirmation that the registered Spotify client has that mode.

## Current external gate

At the 2026-11-13 check, all three intended canary names had an A answer from the local resolver. Both strict TLS clients failed before HTTP on the TF Web, TF API and Platform canary probes (Node: `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`). This is not a diagnosis of DNS or Caddy. The team-scoped Coolify search found no application or service for the TF Web canary name. The established HomeNode SSH route reported active Caddy, no exact canary names in the main Caddyfile and zero running containers with the reviewed Compose project label; imported files, other teams and other project names were not enumerated. No runtime or ingress changes were made.

The next runtime action requires the owner's selected publisher/build destination and credential custody, source-matched OCI digests with independent Coolify pull, and the isolated Platform issuer/TF client and ingress receipts. Only then register the reviewed Git Compose Application and verify actual TLS, Platform sign-in/denial/revoke, Spotify callback and import, reviewed playback/download, rollback and scoped cleanup. Keep the root-owned publisher gate in place. Existing services, DNS, Caddy and the frozen candidate are not targets of this intake. Android and Windows have separate [native launch admission](2026-11-13-tf-native-launch-boundary.md); this Web archive is not evidence of either install.
