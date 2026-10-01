# TF Linux container candidate - 2026-10-01

## Scope

Continue the accepted listener checkpoint `b453514` with a source-matched,
TF-only container candidate built through Coolify, as explicitly selected by
the user during this stage. Reuse the existing nine custom targets and
external pinned Redis catalog. This is not a publication receipt or permission
to activate a canary. Preserve the retired candidate and publisher gate.

Platform remains identity/policy authority. The latest direct user request
authorizes a dedicated Coolify token, TF project/build resource and source push.
Only this isolated build-check may mutate HomeNode. No Platform image, registry
write, release claim, authenticated runtime activation or shared service change
belongs to this stage. Packaging evidence is not authenticated acceptance.

## Tasks

1. **Complete:** audit Dockerfiles, source inclusion, Compose isolation and
   existing candidate machinery. One reused worker performs a bounded read-only
   audit; the controller owns local tools, builds and the final commit.
2. **Complete:** prepare a separate Git-backed Coolify build-check Compose
   entrypoint, not the immutable release/canary runtime definition. Build the
   nine custom targets without activating TF: no ports, domains, credentials,
   volumes or shared networks; each result exits successfully via `/bin/true`.
   Use source labels and the fixed canary web API build argument. Retain an
   exact-commit archive separately; local image IDs are not registry digests.
   A dedicated seven-day `read/write/deploy` token and TF-owned binding are now
   provisioned; no `root` or sensitive-data permission. The token is team-scoped,
   not application-scoped; the private operator also guards exact TF ownership.
3. **Complete:** check affected Linux runtime boundaries and Compose rendering.
   If a concrete packaging defect appears, reproduce it before a narrow fix and
   recheck the changed target. Do not replay accepted application suites.
4. **Complete:** review the scoped diff/evidence,
   reconcile only task-owned test resources, and save a short resume plus a linked
   report. Owned source is pushed to the existing feature branch for Coolify's
   exact checkout; no merge, GitHub Actions or runtime deployment.

## Acceptance

- Exact source SHA and archive hash; build context excludes dirty/private files.
- Catalog, source labels, explicit canary origin and Linux architecture match.
- Native build/runtime results, failures and cleanup are recorded truthfully.
- Fresh registry/publisher and Platform issuer/JWKS/client proof remain separate
  gates. The user's later explicit credential-provisioning approval does not
  authorize using LETSCUBE, weakening the publisher guard or activating the
  production/canary runtime definitions.

## Current Evidence

The bullets below retain the initial preparation evidence. The authoritative
continuation is [native build report](../operations/2026-10-01-tf-coolify-native-build.md):
TF access and source publication are no longer blockers. An actual native
attempt exposed Coolify's `command: []` to `{}` YAML round-trip; `command: ""`
clears the image CMD and passes that exact consumer path. The corrected attempt
pins `f3828eb016e9dc034030e2da7ca2c2a39f4327c1`.
All nine images and inert exits/masks/tools are now verified. An additional native
custom-start path defect was corrected only on the new application; final job
finished using cached layers. Owned temporary containers/empty bridge removed,
candidate images retained; 35 unrelated running container IDs/images/health and
Caddy active/configuration hash unchanged. No runtime activation/publication.

- Local Docker Linux API unavailable; Desktop startup reports an inaccessible
  `sailor-ingest.sock`. Bounded start/restart did not recover it; CLI waits were
  cancelled, no reset, socket deletion, engine switch or broad process kill.
  The user selected Coolify instead; no further local recovery belongs here.
- Fresh HomeNode SSH: Docker Linux `29.1.3`, `amd64`, Compose `5.0.2`, about
  91 GiB free disk and 20 GiB available RAM. Running inventory has no named TF
  container; Caddy active and its configuration hash retained privately.
- HomeNode's stdin render of the existing canary Git entrypoint exactly matches
  local `5.4.0` source-pair JSON: 14 template services, 12 without the disabled
  baseline profile, 10 networks, five volumes. No runtime created.
- Existing Coolify MCP is read-only and sees only team LETSCUBE. Platform owner
  confirms no TF/admin credential or team/project binding in its context.
  User asked for an existing credential-file pointer/access, not a chat secret.
- Actual POSIX execution of search Dockerfile workspace narrowing preserves its
  three packages and YAML catalog; the different escaping is not a defect.
- New build-check: nine catalog targets and required pin/isolation checked;
  effective configuration matches local `5.4.0` and HomeNode `5.0.2`. Only
  unused extension-anchor empty-command representation differs. Native images,
  image-declared-volume suppression and Coolify source-copy behavior unproven.
- R1 corrected: installed Coolify job adds checkout-root `--project-directory`;
  initial `../..` context failed the consumer-equivalent root assertion. Worker
  changed only shared context to `.` plus an orienting comment. Same assertion
  and nine-target checks GREEN; corrected host parser render matches. No old
  Dockerfile, publisher or runtime definition changed.
- Read-only host poststate: same 35 container IDs/images/health states and active
  Caddy with unchanged configuration hash. No TF container/image created.
- Goodall independent spec/quality `APPROVED_SOURCE_ONLY`; R1 addressed, no open
  findings. Local checkpoint records only owned configuration/docs. Actual Coolify
  build and subsequent release remain pending the documented access/native gates.

## Workflow

Use subagent-assisted execution with reused agents, no recursive delegation and
non-overlapping scope. Task-focused review and checks replace whole-branch
retests for this bounded stage, per the user's verification agreement. Keep the
ignored ledger/evidence directory for interruption recovery, not as a new public
release manifest.
