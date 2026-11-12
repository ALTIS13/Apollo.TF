# TF reviewed-audio acceptance profile

State: **source candidate, not runtime admitted**. Baseline product source is `0c192c2`. No TF Application, shared Caddy route, destination, registry credential, or existing workload was changed. Coolify's read connector returned zero Applications for the scoped name `apollo-tf-reviewed-acceptance`; this is not a server-wide inventory or permission to create one.

## Licensed recording receipt

**Cylinder Five** by Chris Zabriskie, from **Cylinders** (2014), copyright Chris Zabriskie, is available under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) according to the [artist's album](https://chriszabriskie.com/cylinders/) and [licensing statement](https://chriszabriskie.com/use/). The selected [public Wikimedia file revision](https://commons.wikimedia.org/w/index.php?title=File:Chris_Zabriskie_-_05_-_Cylinder_Five.ogg&oldid=857724712) is an Ogg transcode of the released recording, not a studio master. Commons labels its own review as pending; the license here is corroborated by the creator, not inferred from the file listing, date, or duration. TF does not transcode or edit these bytes. Retain the creator, title, album, source, license and change notice together. The file also carries a CC BY 4.0 copyright comment.

- Acquisition: the Commons file revision's public Original file link, without sign-in or a protected streaming endpoint. Published SHA-1 `df7e46841dfa2b9c706a516da3add66bd391b010` and size 3,194,811 bytes matched. The TF verifier decoded 173.533 seconds against the album's 2:54 reference. SHA-256 `ae4e304cde343904b881983502c88fbd4464251301f9dcbe382f28b655a6a803`.
- [Example catalog](../../deploy/coolify/fixtures/cylinder-five.catalog.example.json) is opt-in metadata, not part of the default runtime. Store the verified original Ogg bytes as `<sha256>.ogg` in the private media directory. Do not commit the audio or use this sample to infer rights on another recording.
- Chrome against the real local TF API and marked PG16: opened the saved import row, showed the source/credit, explicitly confirmed the edition, played and paused the Ogg (progress exceeded five seconds; one `206`, no generic track request). A separate authorized file request returned all 3,194,811 unchanged bytes with an attachment and `no-store`; its SHA-256 matched. Web and API used separate loopback origins. Session/entitlements were synthetic; this is real licensed audio proof, not live Platform, Spotify OAuth, or production authorization. Both fixture servers and the database were stopped.

## Compose Application source

Select [the standalone Git Compose file](../../deploy/coolify/apollo-tf.reviewed-acceptance.git.compose.yml) for a dedicated [Coolify Compose Application](https://coolify.io/docs/applications/builds/docker-compose), not a pasted Compose Service. It is derived from the TF base, canary, renewal v2 and [reviewed acceptance overlay](../../deploy/coolify/apollo-tf.reviewed-acceptance.compose.yml), in that order. All ten networks and five data volumes use the new namespace; the frozen candidate and shared Platform network are not modified. The existing TF web/API/admin loopback exposure model is preserved. Do not enable the optional maintenance profile or attach external shared networks merely to run playback.

Only `tf-api` receives the two binds. Both use long syntax, are read-only, and disable creation of missing host paths. The operator selects existing distinct absolute sources using `TF_REVIEWED_CATALOG_FILE` and `TF_REVIEWED_MEDIA_DIR`, under a dedicated `TF_REVIEWED_DATA_ROOT`. `TF_REVIEWED_DATA_ROOT` is a validator input, not a mount. Use the [Coolify bind mount requirements](https://coolify.io/docs/core/persistent-storage/storage-mounts/bind-mounts) to check the actual paths and permission for container UID/GID `10001` on the selected destination. Bind mounts do not replicate across nodes. Media and metadata must be staged and verified separately on each future replica.

Render the checked-in source snapshot without a Docker daemon or secret interpolation:

```powershell
docker compose --env-file deploy/coolify/canary-renewal.v2.env.example `
  -f deploy/coolify/apollo-tf.compose.yml `
  -f deploy/coolify/apollo-tf.canary.compose.yml `
  -f deploy/coolify/apollo-tf.canary-renewal.v2.compose.yml `
  -f deploy/coolify/apollo-tf.reviewed-acceptance.compose.yml `
  config --no-interpolate --no-path-resolution --format yaml `
  --output deploy/coolify/apollo-tf.reviewed-acceptance.git.compose.yml
```

Do not use the old example environment to activate this Application. It is a names-only render input with zero image digests. For the reviewed profile, supply actual source-bound image digests, dedicated control/credential paths, allocated free loopback ports, and a registered HTTPS issuer and Web/API callback set through the protected operator environment. Check the Web image's compiled API origin against the registered host. No new DNS is needed for source validation; any runtime route or callback change requires the coordinated destination and ingress receipt.

Keep the legacy environment variable names required by the source layers, but give them reviewed-specific paths. `TF_CANARY_SECRET_DIRECTORY` must equal `TF_SECRET_DIRECTORY`, and `TF_CANARY_ADMIN_CREDENTIAL_DIRECTORY` must equal `TF_ADMIN_CREDENTIAL_DIRECTORY`. The validator requires both dedicated paths to contain the reviewed project namespace and rejects any overlap with the media root or with the other control path. It does not dereference the declared remote paths; verify them on the chosen host before activation.

Declare `TF_INTEGRATIONS_SPOTIFY_PLAYLIST_API` explicitly in the reviewed Application. Use `items` for a client admitted to the [current Development Mode playlist contract](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide#playlist-endpoint-renames); select `tracks` only when the owner has confirmed the legacy route for the actual client. No implicit fallback, mixed-profile reads, or added OAuth scope. Both reviewed variants require this value and compare the effective module setting to it. This check does not prove the registered Spotify client's mode, playlist access or OAuth callback. The frozen profiles are unchanged.

From the repository root, run the no-write topology check against the operator environment:

```powershell
pnpm release:validate:tf-reviewed --env-file '<operator>/tf-reviewed.env'
```

Keep the environment outside Git. The check uses only Compose `config`, compares the standalone file with its ordered source layers, and reports a compact topology receipt instead of the resolved config or environment values.

35 targeted cases passed, including a real Compose v5.4.0 render and unsafe topology rejections. The CLI run against isolated dummy inputs reported `evidenceLevel: compose-config-only`, `activationAllowed: false` and canonical SHA-256 `01c5c756de906f43226b142e47b83ddf5b27e50558e519f8222caa3fae51d5c5`. The 14 validated service definitions include two opt-in maintenance definitions; the normal application render has 12 services. No container was started for this proof.

## Admission still required

The topology check accepts source equivalence, declared isolation and file-mount shape, not actual runtime authority. Before enabling an Application, require the root-owned source/image/registry receipt, current destination and port inventory, file hashes/readability inside `tf-api`, registered Platform issuer/JWKS and Spotify callback/OAuth, real entitlement/revocation, migration/backup, rollback and scoped cleanup proof. Keep existing HomeNode services untouched. Do not reuse the frozen canary's keys, database volumes, or images by relabeling them.
