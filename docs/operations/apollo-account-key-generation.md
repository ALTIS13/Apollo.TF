# Apollo Account staging key-generation adapter

This note covers only local creation of the three retained Auth/API-key files for the isolated Apollo Account staging package. It does not authorize key generation, transfer, deployment, production access, database-password generation, service-role persistence, or changes to the accepted ten-file deployment bundle.

## Pinned source and compatibility boundary

The adapter preserves the relevant behavior of Supabase `self-hosted/v0.8.0` at commit `e1af732589cd468edb49500ebc04e4367d4c56ad`:

| Pinned upstream source | Git blob |
| --- | --- |
| `docker/utils/generate-keys.sh` | `da1fc19218cf50146e9ca6f7313248ba94d22a2e` |
| `docker/utils/add-new-auth-keys.sh` | `3073ca76365d5b767293c7e07bbb1da7385afd52` |

The upstream asymmetric script passes `JWT_SECRET` to an embedded Node process through `argv`. Do not use that live path for Apollo. `generate-account-keys.mjs` instead uses only Node.js standard-library `crypto` and `fs` operations and launches no child process. Its only argument is a nonsecret, not-yet-existing output directory. The legacy secret arrives on stdin and must be exactly the 40-character unpadded base64 representation of 30 bytes produced by the reviewed OpenSSL command below.

Compatibility retained:

- EC P-256 signing key represented as a private ES256 JWK with `kid`, `use: sig`, and `key_ops: [sign, verify]`;
- legacy secret represented as the HS256 `oct` entry in `JWT_KEYS`;
- `sb_publishable_` opaque key generation and the pinned `supabase-self-hosted|<intermediate>` SHA-256 checksum convention.

The adapter intentionally does not generate `SUPABASE_SECRET_KEY`, `SERVICE_ROLE_KEY`, `SERVICE_ROLE_KEY_ASYMMETRIC`, either anon JWT, or a durable privileged assertion. The existing operator invite helper derives only a five-minute `service_role` assertion in memory when separately authorized.

## Approved Linux entrypoint and custody contract

The portable Node helper is an inert implementation component, **not an approved live operator entrypoint**. Its preflight `lstat` plus POSIX `rename` is not a no-clobber primitive: another actor could create an empty target between those calls and have it replaced. Live Linux generation must enter through `generate-account-keys-linux.sh`, under the single-writer custody boundary below.

The wrapper enforces:

- effective uid `0`;
- an explicit absolute/canonical operator parent, with no symlink component, owned by `root:root`, mode exactly `0700`, and root-owned non-group/world-writable ancestry;
- rejection of `/tmp`, `/var/tmp`, `/dev/shm`, and `/run/user` parents;
- root-owned, canonical, non-group/world-writable wrapper/helper/Node files and ancestry;
- an atomically created unique `account-keys-run.XXXXXXXXXX` parent beneath the operator parent;
- a scrubbed child environment and only the nonsecret helper/output paths in Node arguments;
- untouched stdin forwarding, no shell variable or environment-secret copy, and no secret stdout/diagnostic;
- cleanup on failure only when the run path, root ownership/mode, and captured device/inode still identify the task-created directory. Success retains it and prints only the nonsecret output path.

An adversarial or concurrently acting privileged root is outside this boundary. The wrapper's exclusive run parent removes the unprivileged/concurrent-name race around the Node helper's output child; it does not turn POSIX `rename` itself into a no-clobber operation.

Runtime: Linux, Node.js 18 or newer, GNU `coreutils` paths used by the wrapper, and a trusted OpenSSL executable used only to stream 30 random bytes as base64. Install the reviewed wrapper and sibling helper beneath a root-owned, non-group/world-writable directory; set the wrapper to `0700` and helper to `0600`. The approved HomeNode operator parent is `/var/lib/apollo-account-staging/operator`, owned by `root:root` with mode `0700`. The `--node-binary` value must be the canonical, non-symlink path returned by `realpath -e` for the reviewed Node installation.

After root separately approves live generation, run without `tee`, tracing, command substitution around secret data, or redirection that exposes the pipe:

```sh
set -eu
operator_parent=/var/lib/apollo-account-staging/operator
node_binary=$(realpath -e /usr/bin/node)
openssl rand -base64 30 | \
  /root-only/reviewed-source/generate-account-keys-linux.sh \
  --operator-parent "$operator_parent" \
  --node-binary "$node_binary"
```

The wrapper prints exactly one nonsecret path such as `/var/lib/apollo-account-staging/operator/account-keys-run.A1b2C3d4E5/generated`. Record it in the root-only operator log without recording any file content. The task-created run parent must not exist before invocation; the wrapper never accepts a caller-supplied run-parent name and preserves any older sibling run.

The result contains exactly:

- `account_legacy_jwt_secret`, mode `0600`;
- `account_jwt_keys`, mode `0600`;
- `account_publishable_key`, mode `0600`.

The output and task-created run parent are mode `0700` on Linux. The separate database passwords remain outside this helper. Installing the five final Compose secret files beneath the mode-`0700` HomeNode parent with the already reviewed mount permissions is a later operator step; do not broaden permissions in this helper or wrapper.

The three files are individually `fsync`ed before publication, but the helper does not `fsync` both containing directories. Publication is namespace-atomic under the exclusive-parent/single-writer threat model; it is **not guaranteed power-loss durable**. Do not delete the generation directory until the separately approved installed copy and encrypted recovery escrow have both been verified.

## Non-disclosing validation

Validate structure without printing values:

```sh
set -eu
output=/var/lib/apollo-account-staging/operator/account-keys-run.REPLACE/generated
test "$(stat -c '%a' "$output")" = 700
for name in account_legacy_jwt_secret account_jwt_keys account_publishable_key; do
  test -f "$output/$name"
  test ! -L "$output/$name"
  test "$(stat -c '%a' "$output/$name")" = 600
done
test "$(find "$output" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq 3
test "$(find "$output" -mindepth 1 -maxdepth 1 | wc -l)" -eq 3
node - "$output" <<'NODE'
const { createPrivateKey, createPublicKey } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const root = process.argv[2];
const keys = JSON.parse(readFileSync(join(root, "account_jwt_keys"), "utf8"));
if (!Array.isArray(keys) || keys.length !== 2) process.exit(1);
const signing = keys.find((key) => key.alg === "ES256" && key.d);
const legacy = keys.find((key) => key.alg === "HS256" && key.kty === "oct");
if (!signing || !legacy) process.exit(1);
const publicJwk = createPublicKey(
  createPrivateKey({ format: "jwk", key: signing }),
).export({ format: "jwk" });
if ("d" in publicJwk) process.exit(1);
NODE
```

Do not print, hash into a public log, or paste any retained file content. Transfer and encrypted recovery escrow remain separately reviewed steps. Delete the operator generation directory only after both destinations have been verified.

## Focused synthetic test

The Node test is cross-platform. The shell test must be run twice on an isolated Linux test host: once as an ordinary user for the euid rejection and once as root for permission/namespace contracts. It replaces Node with a root-owned synthetic executable and never generates key material.

```sh
node --test deploy/supabase/account/generate-account-keys.test.mjs
sh deploy/supabase/account/generate-account-keys-linux.test.sh
sudo sh deploy/supabase/account/generate-account-keys-linux.test.sh
```

The Node test supplies a synthetic 30-byte legacy secret on stdin, sets `PATH` empty so the helper cannot depend on external executables, verifies the exact three-file boundary, ES256 sign/verify compatibility, public-JWK private-field exclusion, legacy `oct` encoding, publishable checksum, wrong-shape/existing-target failures, and absence of secret material from arguments, stdout, and diagnostics. The shell phases verify non-root, weak-parent, symlink-parent, shared-temporary-parent, existing-sibling, unique-run, stdin/argv/output, and failure-cleanup behavior. All synthetic test material is removed immediately.

Exact source set for this adapter:

- `deploy/supabase/account/generate-account-keys.mjs`;
- `deploy/supabase/account/generate-account-keys.test.mjs`;
- `deploy/supabase/account/generate-account-keys-linux.sh`;
- `deploy/supabase/account/generate-account-keys-linux.test.sh`;
- `docs/operations/apollo-account-key-generation.md`.

References: [Supabase self-hosted Auth keys](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys), [Supabase self-hosting Docker](https://supabase.com/docs/guides/self-hosting/docker), and the pinned source paths above.
