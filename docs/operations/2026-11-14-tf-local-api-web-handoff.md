# TF API and Web image handoff

Status: **LOCAL_OCI_VERIFIED / NOT_PUBLISHER_OR_RUNTIME_ADMITTED**.

Source `f399053dbf540fc0ca299d00a58b1d7f9526c2b0`, from the [verified Git archive](2026-11-13-tf-publisher-input.md). Both `linux/amd64` images were built with BuildKit 0.29.0 in disposable WSL2 from the `runner` targets and Web build arguments in the [build-only Compose profile](../../deploy/coolify/apollo-tf.build-check.compose.yml). The builder used an empty Docker credential directory. The two archives are retained outside Git; the temporary WSL registration and its virtual disk were removed, with six other registrations unchanged.

| Image | Container port | Local OCI manifest SHA-256 | Archive SHA-256 | Archive bytes |
| --- | --- | --- | --- | ---: |
| `tf-api` | `8080/tcp` | `894fc93b18252f5b790f286a89089c98644ea5ad1f54a13be033b242bec6a241` | `f3c8aa18e7085b6d6fd53cff32d7e0d7bd453672ca17af7ac0213687d9f6e17a` | 279,231,488 |
| `tf-web` | `80/tcp` | `a0082f1cee52295af4bff43ba630afb12d2960c8456ae2715b7d948ef60b4860` | `d8cdea8580d81045b16dd338b5c21aa52c38d503a911d0ff6c965e6e504a9d15` | 27,408,896 |

The verifier checked the transferred archive bytes, both manifests and configs, all 21 referenced layers, source labels, platform and exposed ports. Web embeds `https://api.tf.canary.apollot.ru`, not a production API origin. The [canary port examples](../../deploy/coolify/canary-renewal.v2.env.example) map loopback `19201` and `19202` to the internal ports; these are not destination port reservations.

## Platform dependency

The Platform owner reported isolated verification of upstream Auth on `https://api.canary.apollot.ru/auth/v1`: private DNS/TLS, ES256 JWKS, password login and `/user`, with wrong SNI and untrusted CA rejected. The disposable Auth resources were removed; public canary was not opened. TF expects the **Platform** issuer `https://api.canary.apollot.ru`, client `apollo-tf-api`, audience `apollo-tf`, and callback `https://api.tf.canary.apollot.ru/api/auth/callback`. This still needs the exact Platform client and issuer, signed entitlement policy, callback and renewal/revoke evidence.

These are local manifest digests, not registry receipts or inputs admitted for a native release. No container start, live Auth, OAuth, or Coolify pull was verified in this build. The Spotify changes belong to `tf-integrations`, which was not rebuilt here. No key transfer, release claim, GHCR write, ingress, or production change occurred. Keep the [native publisher gate](2026-09-27-tf-canary-publisher-preflight.md#pre-claim-native-read-only-gate) in place before publication.
