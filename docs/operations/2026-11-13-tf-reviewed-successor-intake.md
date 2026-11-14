# Reviewed TF successor intake

Status: **SOURCE_ARCHIVE_VERIFIED / LOCAL_OCI_VERIFIED / NOT_RUNTIME_ADMITTED**.
This selects a new input for the reviewed acceptance Application; it does not supersede or republish the frozen October candidate. No release ID or tag has been claimed.
The [OCI build handoff](2026-11-13-tf-reviewed-oci-build.md) records nine verified local images and the exact Web container smoke.

| Artifact | Exact input or evidence |
| --- | --- |
| Git source | `7e991b091426e2db772669ab854e0386941c1142`, clean checkout |
| Source tar | `tf-reviewed-source-20261113-7e991b09.tar`, 12,994,560 bytes, SHA-256 `8ef58e934c876ba43d4cb5b48e9b2e3c43ac9301a3342db84f923b0047932662` |
| Static Web tar | `tf-reviewed-web-20261113-7e991b09.tar`, 2,016,256 bytes, SHA-256 `863655c33bce0b64d22e60999ab30bb538ea61bb52cd640d0f7edd79324daf7d` |
| Compiled Web entry | `assets/index-Dwj_l5IB.js`, SHA-256 `ce9e686b22eef079d57cf02ab826af9cca9b95ec1ae31c5e637f1fc2081c5436` |
| Web build inputs | `VITE_API_URL=https://api.tf.canary.apollot.ru`, `BASE_PATH=/`, successor WebSocket disabled; Node 24.15.0 and pnpm 10.33.2 on the local host |
| Build targets | Nine local custom Linux/amd64 OCI archives; the existing runtime profile also requires external pinned Redis. No registry claim. |

The source tar's embedded Git commit matches the selection. A second `git -c tar.umask=0002 archive --format=tar <source>` on Git 2.54.0 for Windows reproduced its bytes. The archived Web entry was read back and matched the built file; the HTML points to that single module and the entry contains the canary API origin without either production API origin. This is a local static package, not the runner image. Use the actual source archive for intake; the native publisher must verify custody, archive digest and its own build environment, not assume a different Git implementation emits identical bytes. Neither tar contains runtime secrets or private operational receipts.

REA 6.7.0 selected the compiled entry (`ev_fb2115f199d9c34d4d467c43191772facd005447eaa575fd590aa086260e04d4`) but skipped it during semantic analysis: zero JavaScript files parsed. The build, entrypoint and archive checks above are independent; the REA receipt is not evidence of analyzed behavior.

## Build-Only Verification

The verified source archive unpacks without `.ops-private` and its inert [Coolify build-check profile](../../deploy/coolify/apollo-tf.build-check.compose.yml) resolves all nine build services. The initial Docker Desktop attempt failed: its Ingest listener could not remove `sailor-ingest.sock`. The socket and Docker data were not changed. The isolated local BuildKit run linked above succeeded afterward. A team-scoped read of the available Coolify Applications returned no matching TF build Application; do not assume another team's connection is a TF destination.

Node package builds of `@workspace/api-server` and `@workspace/tf-integrations` passed from the same tracked source (only intake documents differed in the checkout). The API `dist/index.mjs` SHA-256 is `92563a8a1fbfc491dfbd1a06dae7a2bca657ccee4d0de3ce2131e8a210945da1`. The integrations `dist/index.mjs` SHA-256 is `1c5622976971f32502d0512fb0175cd8cfdb5f1ed2a1e35e72d027d219f08453`. REA 6.7.0 parsed that integrations bundle: 131,611 bytes, one parsed file, 18,849 visited AST nodes, 45 static observations, `ev_42f6828c812ee2fa3d44d035f5c9c2ceeafc8a94e2c7f288bb2d5bba682eb983`. These are local bundle checks, not Linux image, live OAuth, or provider reachability proof.

## Licensed Acceptance Fixture

The transport artifact `tf-reviewed-audio-fixture-20261113.tar` (3,200,000 bytes, SHA-256 `748ba9ccde0f87b4f895183c53ead5285260aab29d6c87951c9e36d46c85a84a`) contains exactly three regular files, each read back and compared byte-for-byte. It carries only the [previously played recording](2026-11-12-tf-reviewed-acceptance.md#licensed-recording-receipt) and public metadata. No runtime configuration, credentials or account data are included.

| Member | SHA-256 |
| --- | --- |
| `catalog.json` | `07de1d352d24cb436ea78a27530f65cb8415a437cbc07be8b1b67743451e56a2` |
| `media/ae4e304cde343904b881983502c88fbd4464251301f9dcbe382f28b655a6a803.ogg` | `ae4e304cde343904b881983502c88fbd4464251301f9dcbe382f28b655a6a803` |
| [`cylinder-five.ATTRIBUTION.txt`](../../deploy/coolify/fixtures/cylinder-five.ATTRIBUTION.txt) | `b65f0b8bf3fe20caea37010d0dabae32ca266fa0023e2c4e150bc0c397e5bca1` |

The current API catalog reader resolves the sample as `original` and `full`, with separate `permitted` file access and the same media binding for both operations. Selection revision: `dd5928855f32dacfc1d5378759debf483d4ad4e0c07c878c9750108760dc5470`. The original source SHA-1 also matches the earlier receipt. The catalog decision does not grant account access; live Platform checks still apply. On the approved destination, verify archive and member hashes, extract only these files under a new owner-controlled fixture root without restoring archive owners or modes, and verify actual `10001` readability before binding the catalog and media separately as read-only. Keep attribution alongside the fixture. Nothing was transferred or mounted this turn.

## Compose Validation

The [reviewed Compose profile](2026-11-12-tf-reviewed-acceptance.md) requires an explicit Spotify playlist API mode. 51 focused checks and scripts typecheck passed, including real Compose renders for both reviewed variants. A separate render with dummy digests and `items` reported 14 definitions, 10 networks, five volumes, `compose-config-only`, `activationAllowed: false`, and topology SHA-256 `904d9f96ef47c1a0560c3e6cf311ec3cbef87a6aebc7f824da7bf8dadd9b6188`. The dummy mode is not confirmation that the registered Spotify client has that mode.

## Current external gate

At the 2026-11-13 check, all three intended canary names had an A answer from the local resolver. Both strict TLS clients failed before HTTP on the TF Web, TF API and Platform canary probes (Node: `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`). This is not a diagnosis of DNS or Caddy. The team-scoped Coolify search found no application or service for the TF Web canary name. The established HomeNode SSH route reported active Caddy, no exact canary names in the main Caddyfile and zero running containers with the reviewed Compose project label; imported files, other teams and other project names were not enumerated. No runtime or ingress changes were made.

The next runtime action requires the owner's selected publisher/build destination and credential custody, source-matched OCI digests with independent Coolify pull, and the isolated Platform issuer/TF client and ingress receipts. Only then register the reviewed Git Compose Application and verify actual TLS, Platform sign-in/denial/revoke, Spotify callback and import, reviewed playback/download, rollback and scoped cleanup. Keep the root-owned publisher gate in place. Existing services, DNS, Caddy and the frozen candidate are not targets of this intake. Android and Windows have separate [native launch admission](2026-11-13-tf-native-launch-boundary.md); this Web archive is not evidence of either install.
