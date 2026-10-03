# TF Native Coolify Build - 2026-10-01

Status: **NATIVE_PACKAGING_PASS**, completed 2026-10-02 Europe/Moscow.
This is packaging validation, not a release,
authenticated TF runtime, working audio or browser/device acceptance.

## Access And Tooling

The latest direct user request authorizes looking up existing Apollo access or
issuing a dedicated Coolify token, and continuing containerization in Coolify.
Current callable `coolify_ro` points to a separate LETSCUBE instance. It is not
the HomeNode authority and was not used for TF writes.

The custom HomeNode write integration is configured in Codex as `coolify_write`
(`@masonator/coolify-mcp`) and `coolify_homenode_ga_panel_write` (custom launcher).
Its safe endpoint is `https://coolify.apollot.ru`. The launcher uses a private
environment-file pointer with `COOLIFY_HOMENODE_BASE_URL` and
`COOLIFY_HOMENODE_ACCESS_TOKEN`; no credential values belong in this report.
These configured write tools are not callable in the present session. TF uses
the native API over the verified SSH connection instead; no duplicate plugin or
global Codex configuration change was made.

HomeNode's actual Coolify inventory has one Root Team and existing Apollo GAP,
Quasar, AI Platform, Platform and RGA projects, but no pre-existing TF project or
TF token. The existing GAP token was not reused or changed. A dedicated token
was issued by Coolify's native `User::createToken`, with `read/write/deploy`,
seven-day expiry and no `root`, wildcard or sensitive-data permission. Custody
is owner-only private storage, outside Git. Coolify scopes tokens to a team,
not an individual project; this is not a claim of TF-only security authority.
The operator additionally guards the exact new TF resource and source pin.

## Owned Resource

- Project: `Apollo.TF`, new environment `build-check`.
- Application: `Apollo.TF isolated build check`, Git-backed Raw Compose.
- Exact corrected checkout: `f3828eb016e9dc034030e2da7ca2c2a39f4327c1`.
- Base directory `/`; Compose location
  `/deploy/coolify/apollo-tf.build-check.compose.yml`; all nine contexts `.`.
- One non-secret `TF_BUILD_SOURCE_COMMIT`, matching the checkout, enabled for
  build-time and runtime interpolation. No application credential or auth token.
- Domains, automatic domain generation, preview/auto deployments, registry
  publication and shared Docker-network attachment disabled.
- Custom build: `docker compose --parallel 1 --project-directory . build --pull`.
- Custom start: `docker compose --env-file .env -f deploy/coolify/apollo-tf.build-check.compose.yml --project-directory . --project-name apollo-tf-build-check up -d --no-build --pull never`.
  No rebuild/pull during exit-only startup inside the exact source checkout.

The API does not expose the installed Advanced Raw Compose/preview flags. The
native model setters were used only on this new owned application; no Coolify
source/schema/global setting or existing resource was modified.

## Native Failures And Fixes

1. Public-application creation returned `500` for an empty
   `docker_compose_domains: []`: native logs showed array-to-string conversion.
   No application row existed after that uncertain result. Omitting the empty
   field, while keeping automatic domains off, succeeded with null domains.
   Coolify itself was not patched and no duplicate application was created.
2. The first exact `433eccd` deployment failed before building images. Raw
   Compose serialization uses Symfony YAML and changes `command: []` to `{}`;
   the helper's Compose schema rejects it. The same installed serializer plus
   Compose reproduces RED. The narrow source fix is `command: ""`, which clears
   image CMD while preserving `/bin/true`. The same round-trip is GREEN, and the
   nine-target source/context/isolation/missing-pin check still passes.
3. Independent review found missing configuration/source-pin drift guards and
   uncertain-submission duplicate protection in the ignored operator. It now
   checks approved semantic Compose content, exact commands/source/settings and
   the sole pin variable, and durably records intent before submitting. Unknown
   outcomes require reconciliation rather than automatic resubmission.
4. All nine images built, but the second job failed only at exit-only startup:
   Coolify injected host configuration paths into a command executed inside the
   helper, where the host `.env` was absent. Explicit checkout-relative `-f`,
   `--env-file` and project-directory flags fix that native command path. Installed
   `injectDockerComposeFlags` reproduces the wrong-path RED and corrected GREEN.
   Only the owned application's command changed. A third job reused cached
   image layers from the same exact source and completed successfully.

The corrected source was committed and pushed to the existing feature branch.
Only the new TF application was retargeted after the first deployment was
confirmed failed. The second and third jobs imported the exact corrected commit;
the final job is `finished`. Detailed UUIDs/logs/state remain
in ignored `.ops-private/coolify-native-20261001` and private remote custody.

## Validation Boundary

Before the build: 35 unrelated running containers, Caddy active, unchanged
configuration hash; approximately 91 GiB disk and 20 GiB available RAM. No
other Coolify deployment queued/in progress at submission. Only one TF build
resource was submitted at a time. Actual nine-container inspection confirms
`/bin/true`, empty CMD, `Exited (0)`, network `none`, read-only root, dropped
capabilities/no-new-privileges, UID/GID 10001, 16 MiB memory, 0.25 CPU and 16 PIDs,
disabled inherited healthchecks and no restart or published ports. Docker reports
zero persistent `Mounts`; the three ephemeral data masks are in
`HostConfig.Tmpfs`, not the persisted-mount array. Image-declared PostgreSQL/Redis
volumes did not become anonymous volumes.

All nine image IDs are present, source/repository labels match the exact checkout
and each architecture is `linux/amd64`. API/search/integrations/worker bundles,
bootstrap scripts, compiled secret reader and integrations runtime dependencies
are present. Isolated ephemeral probes override every application entrypoint;
they neither start a server/database nor use provider/auth credentials. They
confirmed Node `20.20.2` / `24.18.0`, yt-dlp `2026.07.04`, FFmpeg/ffprobe `5.1.9`,
PostgreSQL `16.14` / `17.10`, Redis `7.4.10` and Nginx `1.31.3` / `1.27.5`.
The hardened worker has no apt/dpkg/npm/pip executables. The web JS contains
`https://api.tf.canary.apollot.ru` and not the production TF API origin.
These versions describe the pinned images, not a new dependency upgrade.

Source archive: 11,407,360 bytes; SHA-256
`467f204efb5c6cd212618af25f5dc5ca43949ab22d8a26cb43ef050de408620f`.
Real helper checkout hashes of the listener download hook/details, API tracks
route and lockfile match local source. Private operational files and local
dependencies are absent from that checkout. Image IDs are local Docker IDs, not
registry digests or release receipts.

All nine owned exit-only containers and one empty application-specific bridge
were removed after recording inspection. Coolify creates this adjunct bridge
even when Raw Compose services use network `none`; no service attached and no
`coolify-proxy` exists here. Probe containers removed themselves. Nine candidate
images and owned application configuration are retained; no global prune.
Poststate has the same 35 unrelated running container IDs/images/health states,
active Caddy and identical configuration hash. Independent scoped review accepts
the source/command guards with no remaining findings; native evidence is the
separate captured deployment/image/container/tool/poststate inspection.

No Caddy/UFW/DNS edit, shared restart/prune, production initialization, migration,
auth/entitlement activation or GHCR publication. Existing publisher preclaim
guards and the old immutable release packet remain unchanged. Packaging is now
proven on HomeNode. The next stage is a fresh source-matched TF-only release and
the outstanding native publisher/registry and Platform issuer/JWKS/client/restore
proof before separately admitted authenticated canary activation.
