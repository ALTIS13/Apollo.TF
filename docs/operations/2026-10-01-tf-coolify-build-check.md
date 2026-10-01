# TF Coolify Build Check - 2026-10-01

Status: **CONFIGURATION_SOURCE_APPROVED / TF_WRITE_CAPABILITY_PENDING**.
This stage does not publish a release or activate an authenticated TF runtime.

## Purpose

Use a separate Git-backed Raw Docker Compose Application to check the nine
existing custom TF image targets on Coolify's Linux builder. The existing
immutable release/canary manifests remain image-only and unchanged. This avoids
running production initialization simply to find a packaging error.

Selected entrypoint: `deploy/coolify/apollo-tf.build-check.compose.yml`.
Repository: `https://github.com/ALTIS13/Apollo.TF.git`.
Base directory: `/`. Pin the exact accepted source commit that contains this
entrypoint; do not deploy the branch tip automatically. Set
`TF_BUILD_SOURCE_COMMIT` to that same full SHA. A caller-provided tag/label is not
source provenance: verify the actual Coolify checkout and deployment log SHA.
Enable this non-secret variable for both build-time and runtime Compose
interpolation; it is not a TF service environment credential.

The accumulated listener baseline is
`b453514ef52093cd1b180411b906ef819ebee978`; the build-check configuration is a
later source candidate. A baseline archive is not a checkout containing the new
entrypoint. At this stage's remote check, origin still pointed to `91bfd69`.
No push occurred and Coolify cannot retrieve these later commits from origin yet.

## Resource Boundary

- Use an existing TF-approved team/project/server, or an explicitly authorized
  new TF project. Do not use LETSCUBE or another project's application/token.
- Raw Compose enabled; Domains empty; automatic domain generation, preview
  deployments, registry publication and automatic Git deployments disabled.
  No Caddy, proxy, firewall or DNS edits belong to this build resource.
- Build only the catalog's nine custom targets; pinned external Redis is not a
  tenth build. Use `linux/amd64`, local-only image names and build source labels.
- The web build explicitly targets `https://api.tf.canary.apollot.ru` with
  successor WS disabled. This is a bundle setting, not live API availability.
- Runtime containers override the image entrypoint with `/bin/true`, have an
  empty command, disabled inherited healthchecks and no restart policy. Expected
  state is **Exited (0)**, not a healthy or usable application.
- No application secrets, environment, credentials, dependencies, ports,
  named/bind storage or shared networks. Runtime networking is disabled.
  Small tmpfs mounts suppress image-declared PostgreSQL/Redis data volumes.
  Runtime limits do not cap Docker's build process; run one resource build at a
  time after checking current server headroom and other owners' activity.

Coolify's documented [Git Compose build pack](https://coolify.io/docs/applications/builds/docker-compose)
supports image builds from the repository. Confirm the actual build context
resolves to the exact checkout root before admitting its native build result;
local Compose parsing alone does not prove Coolify's source-copy behavior.

The installed Coolify `4.1.2` job passes `--project-directory <checkout-root>`
even for a nested Compose file. Therefore this entrypoint must use build context
`.` and the equivalent CLI check must include `--project-directory .`. Ordinary
nested-file resolution without that option is not the Coolify contract.

## Admission And Validation

1. Obtain the existing TF-approved write/deploy capability through its private
   credential-file path and exact team/project/server binding. Do not print a
   token, reuse LETSCUBE's access, create an admin token or edit Coolify's database
   to circumvent this missing capability.
2. After source publication is separately admitted, verify the exact SHA exists
   on origin. Recheck host/container/Caddy prestate and absence of collisions;
   create only the new named build-check Application with no automatic deploy.
3. Confirm the saved application contains only the selected entrypoint and
   non-secret SHA variable. Keep a private application UUID/configuration snapshot
   and trigger exactly one build. No global restart/prune or shared resource edit.
4. Retain build logs, actual checkout SHA, builder versions/architecture and the
   nine resulting image IDs/build revision labels. Verify all intended targets
   were built, not merely created from an old local image.
5. Inspect emitted JS for the selected API origin and absence of production API
   substitution; inspect bundled outputs and required native tools. Confirm the
   nine exit-only containers finish with code 0, no application wrapper or
   migration runs, and no anonymous/named/bind volume was created.
6. Recheck unrelated container IDs/health and unchanged Caddy configuration.
   Stop/reconcile only the new application and its exact owned resources. Retain
   image/source evidence until its release decision; do not prune shared cache.

Local image IDs and successful exit-only containers are **not** GHCR digests,
release receipts, server readiness, account isolation, full-track audio, native
device proof or authenticated browser acceptance. The publisher preclaim guard,
fresh immutable manifest, Platform issuer/JWKS/TF-client proof, credentials,
migrations/restore and separately reviewed ingress remain later runtime gates.

## Current Evidence

- Source archive from exact baseline: 11,386,880 bytes, 1,060 tar entries,
  SHA-256 `97e65c961fdbda37cd03731a85afc1b0e1079020d5e94e593ac430e7a4e13c28`.
  No Git/private/dependency directory included. Ignored copy retained for resume.
- Worker source audit: all nine targets covered, 90 COPY inputs present in the
  Git tree, no confirmed build blocker or source omission. Native builds pending.
- Search workspace narrowing executed through POSIX shell: three packages and
  catalog preserved. No escaping fix required.
- Fresh HomeNode read-only checks: Linux Docker `29.1.3`, `amd64`, Compose
  `5.0.2`, about 91 GiB free disk and 20 GiB available RAM; Caddy active. Existing
  canary render matches local Compose `5.4.0`: 14 template / 12 active services,
  ten networks, five volumes. No resource started by the check.
- New build-check parsed by local `5.4.0` and HomeNode `5.0.2`: nine exact
  catalog Dockerfile targets, no networks/volumes/secrets, fixed web build
  arguments, source image labels and exit-only restrictions verified. Local
  resolved build context is the checkout root with explicit project-directory;
  missing SHA input is rejected.
  Effective service configuration is identical. The only parser difference is
  `[]` versus `null` for the unused extension anchor's empty command; all nine
  effective service commands are `[]`. No image was built by these checks.
- Consumer-context regression reproduced before correction: installed Coolify
  `ApplicationDeploymentJob.php` lines 748/750 pass the root project directory.
  With those arguments, the first `context: ../..` resolved outside the checkout
  and the focused root-context assertion failed. The narrow fix is `context: .`.
  The same equivalent-command check is GREEN after the fix for all nine targets,
  including isolation and required-pin checks. Corrected configuration re-rendered
  on HomeNode; effective local/host configuration still matches.
- Independent post-inspection: the same 35 running container IDs/images/health
  states as prestate, Caddy active and configuration SHA-256 unchanged. This is
  read-only host comparison, not TF runtime or unrelated application acceptance.
- Independent scoped review: R1 context correction addressed; spec and quality
  `APPROVED_SOURCE_ONLY`, no open findings. Configuration and evidence accepted
  locally, not as native or production proof. Unchanged application suites were
  not repeated; document links and scoped diff checks pass.
- Coolify MCP is read-only and sees only LETSCUBE. Platform confirmed no
  TF/admin-approved credential/binding in its context; user asked for existing
  access. No Coolify mutation, upload, image build, publication or deployment.

## Resume

Owner: TF. Stage: isolated Coolify build-check source approved locally; the
containing commit is its source checkpoint. Evidence:
this report, the [stage plan](../product/2026-10-01-container-candidate-plan.md)
and ignored `.superpowers/sdd/container-candidate-20261001` worker/render/archive
records. Blocker: approved TF Coolify write/deploy capability and origin source
admission. Next: perform the exact new resource's build after those inputs exist;
do not rebuild the accepted listener feature stages or mutate existing services.
