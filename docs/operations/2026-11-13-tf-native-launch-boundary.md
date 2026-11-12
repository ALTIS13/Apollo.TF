# TF native launch boundary

Status: **source reconciliation, not native or runtime admission**. Read-only sibling source snapshots: Platform `bb9af76e8109`, Quasar `main` `ae156053eb82`, Quasar Windows readiness `c2dc770ae7cf`; TF starting source `17964ad496e75`. Android A063 is visible over ADB. No device install, authorization request, infrastructure write or publication was performed.

| Boundary | Observed source |
| --- | --- |
| Web login | The Platform-configured confidential `apollo-tf-api` client has audience `apollo-tf` and a registered HTTPS API callback. The TF server owns PKCE S256 state, nonce, verifier and the browser transaction cookie. Platform consumes the OAuth code once. These are not app-owned credentials or a native callback. |
| Installation | Platform maps the TF browser's installation hint to a canonical account/client installation. Native `InstallationRegistrationV1` separately describes a client signing key, server installation identity and receipt. A browser hint or Android's legacy local session ID cannot be promoted to a native installation. |
| Launch | The [approved design](../superpowers/specs/2026-08-24-apollo-tf-unified-platform-handoff-design.md#3-launch-and-deep-links) describes a short-lived single-use intent with a server-held TF route. The Platform schema exists; no issuer or atomic redeemer was found at the inspected source. The proposed `apollo://module/TF?intent=...` and `https://apollot.ru/launch/TF?intent=...` are design routes, not registered OAuth callbacks. |
| Android | Legacy `com.altis13.apollotrackfinder` uses `trackfinder://` for the Spotify browser return, not Apollo login. Locally generated sessions and old sockets are not permitted for the protected API. Existing library files must not be silently imported as authorized offline media. |
| Windows | The separate Quasar Windows readiness branch opens `https://tf.apollot.ru/` using `ShellExecuteW`, with no token, installation or intent. That is a browser bridge, not an installed TF client or a verified Windows launch. |

## Handoff to platform owners

- **Platform:** supply the versioned issue/redeem contract and fixtures, exact Android/Windows client and callback registrations, canonical account/installation binding, short expiry and atomic consumption, stable denial/replay codes and audit correlation. A grant must be audience-bound to TF; never ship the confidential browser client's secret in a package. Keep release and offline admission separate.
- **Quasar:** define the selected signed shell and URI dispatch for Windows, including launch destination, installation proof and the behavior when Platform denies access. Keep the existing browser bridge as its own behavior; do not count it as native admission.
- **TF:** the internal [launch consumer](../../artifacts/api-server/src/lib/tf-launch-consumer.ts) is implemented and tested with an injected redeemer. It validates the consumed Platform admission and matching account, installation and launch ID, requires fresh pre-verified context and the route's capabilities, and maps only known local destinations. It cannot follow the issuance URI, redeem using an unverified request, or retry an ambiguous reply. Replay and atomic consumption stay at Platform. The context does not require an existing TF session, but the consumer does not create one.

The internal consumer has no HTTP route, production transport, session issuance or client wiring. The owner must supply the redeemed-result projection and bounded transport from a trusted Platform verifier before wiring it. A current TF assertion or other approved audience-bound proof remains necessary when establishing a TF session; the ordinary launch admission DTO cannot replace it.

Once those contracts are supplied, build a signed Android APK and Windows candidate with the owner-approved shell, verify native launch, revoke/recovery and playback on their real targets, then attach the exact artifact and acceptance receipts to the [release track](../product/2026-11-12-tf-release-track.md).
