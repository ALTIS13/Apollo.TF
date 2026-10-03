import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isolatedComposeEnvironment,
  type ComposeDocument,
  type ComposeSecretMount,
} from "./coolify-release.js";
import { verifyTfOnlyOperatorReleaseEvidence } from "./operator-release.js";
import type { TfOnlyReleaseArtifact } from "./release-images.js";
import { validateTfCanaryComposeBinding } from "./tf-canary-compose-binding.js";

const profileName = "apollo-tf-canary-renewal.v2";
const projectName = "apollo-tf-canary-renewal-v2";
const secretRoot = "/var/lib/apollo-tf-canary/renewal-v2/secrets";
const adminRoot = "/var/lib/apollo-tf-canary/renewal-v2/admin-credentials";
const revokeName = "tf_revoke_keyring";
const revokePath = `/run/secrets/${revokeName}`;
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const networkSuffixes = [
  "data",
  "edge",
  "integrations-control",
  "integrations-data",
  "integrations-egress",
  "search-control",
  "search-egress",
  "download-queue",
  "download-control",
  "download-egress",
] as const;
const volumeSuffixes: Readonly<Record<string, string>> = {
  "tf-postgres-data": "postgres",
  "tf-redis-data": "redis",
  "tf-integrations-postgres-data": "integrations-postgres",
  "tf-download-redis-data": "download-redis",
  "tf-downloads": "downloads",
};
const requiredApiSecrets = [
  "admin_dashboard_token",
  "tf_client_secret",
  "tf_auth_redis_url",
  "tf_cache_redis_url",
  "tf_runtime_database_url",
  "tf_integrations_internal_auth_secret",
  "tf_download_queue_redis_url",
  "tf_download_internal_auth_secret",
  "tf_module_heartbeat_keys",
  "tf_search_internal_auth_secret",
] as const;
const expectedPolicy = {
  schemaVersion: 2,
  profile: profileName,
  clientId: "apollo-tf-api",
  audience: "apollo-tf",
  revokeKeyring: {
    secretName: revokeName,
    mountPath: revokePath,
    purpose: "apollo-tf-revoke-only",
    ownerPolicy: "runtime-uid",
    mode: "0400",
    allowSymlink: false,
  },
} as const;
export type TfCanaryRenewalV2Profile = typeof expectedPolicy;
export type TfCanaryRenewalV2Validation = {
  apiOrigin: string;
  imageCount: number;
  serviceCount: number;
  profile: typeof profileName;
  evidenceLevel: "source-binding-only";
  activationAllowed: false;
  blockers: readonly string[];
};

function exactPolicy(
  value: unknown,
  expected: Record<string, unknown>,
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const actual = value as Record<string, unknown>;
  return (
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(
      ([key, literal]) =>
        Object.hasOwn(actual, key) &&
        (typeof literal === "object" && literal !== null
          ? exactPolicy(actual[key], literal as Record<string, unknown>)
          : actual[key] === literal),
    )
  );
}
export function parseTfCanaryRenewalV2Profile(
  value: unknown,
): TfCanaryRenewalV2Profile {
  if (!exactPolicy(value, expectedPolicy))
    throw new Error("invalid_canary_renewal_profile");
  return structuredClone(expectedPolicy);
}

function fail(): never {
  throw new Error("canary_renewal_binding_failed");
}
function restrictedEnvironment(env: Readonly<Record<string, string>>): boolean {
  return Object.keys(env).some(
    (name) =>
      (name.startsWith("APOLLO_TF_REVOKE_KEYRING") &&
        name !== "APOLLO_TF_REVOKE_KEYRING_FILE") ||
      name.startsWith("APOLLO_TF_BRIDGE_PKCE_VERIFIER") ||
      name === "APOLLO_TF_CLIENT_SECRET",
  );
}
function runtimeMount(mount: ComposeSecretMount, name: string): boolean {
  const mode: unknown = mount.mode;
  return (
    mount.source === name &&
    mount.target === name &&
    mount.uid === "10001" &&
    mount.gid === "10001" &&
    (mode === "0400" || mode === 256) &&
    Object.keys(mount).every((key) =>
      ["source", "target", "uid", "gid", "mode"].includes(key),
    )
  );
}

export function validateTfCanaryRenewalV2Binding(
  artifact: TfOnlyReleaseArtifact,
  environment: Readonly<Record<string, string>>,
  compose: ComposeDocument,
  profile: TfCanaryRenewalV2Profile,
): TfCanaryRenewalV2Validation {
  parseTfCanaryRenewalV2Profile(profile);
  const api = compose.services?.["tf-api"];
  const env = api?.environment;
  if (
    environment.TF_RENEWAL_ENABLED !== "true" ||
    environment.TF_SECRET_DIRECTORY !== secretRoot ||
    environment.TF_CANARY_SECRET_DIRECTORY !== secretRoot ||
    environment.TF_ADMIN_CREDENTIAL_DIRECTORY !== adminRoot ||
    environment.TF_CANARY_ADMIN_CREDENTIAL_DIRECTORY !== adminRoot ||
    compose.name !== projectName ||
    Object.hasOwn(compose, "configs") ||
    restrictedEnvironment(environment) ||
    !api ||
    api.user !== "10001:10001" ||
    !env ||
    restrictedEnvironment(env) ||
    env.APOLLO_TF_RENEWAL_ENABLED !== "true" ||
    env.APOLLO_TF_CLIENT_ID !== "apollo-tf-api" ||
    env.APOLLO_TF_CLIENT_SECRET_FILE !== "/run/secrets/tf_client_secret" ||
    env.APOLLO_TF_AUTH_REDIS_URL_FILE !== "/run/secrets/tf_auth_redis_url" ||
    env.APOLLO_TF_REVOKE_KEYRING_FILE !== revokePath
  )
    fail();

  for (const suffix of networkSuffixes) {
    if (
      compose.networks?.[`tf-${suffix}`]?.name !==
      `apollo-tf-canary-renewal-${suffix}-v2`
    )
      fail();
  }
  for (const [key, suffix] of Object.entries(volumeSuffixes)) {
    const volume = compose.volumes?.[key];
    if (
      !volume ||
      volume.name !== `apollo-tf-canary-renewal-${suffix}-v2` ||
      Object.keys(volume).some((field) => !["name", "external"].includes(field))
    )
      fail();
  }
  if (
    !compose.secrets?.[revokeName] ||
    Object.entries(compose.secrets).some(
      ([name, definition]) =>
        definition.file !==
          `${name === "admin_access_htpasswd" ? adminRoot : secretRoot}/${name}` ||
        Object.keys(definition).some((key) => !["file", "name"].includes(key)),
    )
  )
    fail();

  const mounts = api.secrets;
  if (
    !mounts ||
    mounts.length !== requiredApiSecrets.length + 1 ||
    [...requiredApiSecrets, revokeName].some(
      (name) =>
        mounts.filter((mount) => runtimeMount(mount, name)).length !== 1,
    )
  )
    fail();
  for (const [name, service] of Object.entries(compose.services)) {
    // File configs, volume inheritance and driver options can hide host mounts.
    if (
      Object.hasOwn(service, "configs") ||
      Object.hasOwn(service, "volumes_from") ||
      (service.environment &&
        Object.entries(service.environment).some(
          ([key, value]) =>
            posix.normalize(value) === revokePath &&
            !(name === "tf-api" && key === "APOLLO_TF_REVOKE_KEYRING_FILE"),
        ))
    )
      fail();
    if (
      name !== "tf-api" &&
      (service.secrets?.some(
        (mount) =>
          mount.source === revokeName ||
          mount.target === revokeName ||
          mount.target === revokePath,
      ) ||
        (service.environment &&
          (restrictedEnvironment(service.environment) ||
            Object.values(service.environment).includes(revokePath))))
    )
      fail();
  }

  // Project only validated additive fields; common v1 guards still see all others.
  const projected = structuredClone(compose);
  projected.name = "apollo-tf-canary";
  for (const suffix of networkSuffixes)
    projected.networks![`tf-${suffix}`]!.name = `apollo-tf-canary-${suffix}-v1`;
  for (const [key, suffix] of Object.entries(volumeSuffixes))
    projected.volumes![key]!.name = `apollo-tf-canary-${suffix}-v1`;
  const projectedApi = projected.services["tf-api"]!;
  projectedApi.environment!.APOLLO_TF_RENEWAL_ENABLED = "false";
  delete projectedApi.environment!.APOLLO_TF_REVOKE_KEYRING_FILE;
  projectedApi.secrets = projectedApi.secrets!.filter(
    (mount) => mount.source !== revokeName,
  );
  delete projected.secrets![revokeName];
  const result = validateTfCanaryComposeBinding(
    artifact,
    { ...environment, TF_RENEWAL_ENABLED: "false" },
    projected,
  );
  return {
    ...result,
    profile: profileName,
    evidenceLevel: "source-binding-only",
    activationAllowed: false,
    blockers: [
      "runtime_admission_required",
      "fixture_admission_required",
      "cleanup_admission_required",
      "keyring_custody_unproven",
    ],
  };
}

type Renderer = (
  environmentPath: string,
  environment: Readonly<Record<string, string>>,
) => ComposeDocument;
function readEnvironment(path: string): Record<string, string> {
  const contents = readFileSync(path, "utf8");
  if (Buffer.byteLength(contents) > 64 * 1024 || contents.includes("\0"))
    throw new Error("invalid_canary_environment");
  const result: Record<string, string> = {};
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator);
    if (
      separator <= 0 ||
      !/^[A-Z][A-Z0-9_]*$/.test(key) ||
      Object.hasOwn(result, key)
    )
      throw new Error("invalid_canary_environment");
    result[key] = line.slice(separator + 1);
  }
  return result;
}
function readProfile(path: string): TfCanaryRenewalV2Profile {
  try {
    const contents = readFileSync(path, "utf8");
    if (Buffer.byteLength(contents) > 4096) throw new Error();
    return parseTfCanaryRenewalV2Profile(JSON.parse(contents) as unknown);
  } catch {
    throw new Error("invalid_canary_renewal_profile");
  }
}
function renderCompose(
  environmentPath: string,
  environment: Readonly<Record<string, string>>,
): ComposeDocument {
  const render = (files: readonly string[]) => {
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--env-file",
        environmentPath,
        ...files.flatMap((file) => ["-f", resolve(repositoryRoot, file)]),
        "config",
        "--format",
        "json",
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: isolatedComposeEnvironment({ ...environment }),
        maxBuffer: 4 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
      },
    );
    if (result.status !== 0) throw new Error("canary_compose_render_failed");
    return result.stdout;
  };
  const git = render([
    "deploy/coolify/apollo-tf.canary-renewal.v2.git.compose.yml",
  ]);
  const source = render([
    "deploy/coolify/apollo-tf.compose.yml",
    "deploy/coolify/apollo-tf.canary.compose.yml",
    "deploy/coolify/apollo-tf.canary-renewal.v2.compose.yml",
  ]);
  if (git !== source) throw new Error("canary_compose_snapshot_drift");
  try {
    const value: unknown = JSON.parse(git);
    if (
      !value ||
      typeof value !== "object" ||
      !("services" in value) ||
      !value.services ||
      typeof value.services !== "object" ||
      Array.isArray(value.services)
    )
      throw new Error();
    return value as ComposeDocument;
  } catch {
    throw new Error("canary_compose_render_failed");
  }
}
export function validateTfCanaryRenewalV2FromFiles(
  manifestPath: string,
  environmentPath: string,
  profilePath: string,
  render: Renderer = renderCompose,
): TfCanaryRenewalV2Validation {
  const artifact = verifyTfOnlyOperatorReleaseEvidence(manifestPath);
  const environment = readEnvironment(environmentPath);
  const profile = readProfile(profilePath);
  return validateTfCanaryRenewalV2Binding(
    artifact,
    environment,
    render(environmentPath, environment),
    profile,
  );
}
export function runTfCanaryRenewalV2Cli(
  argv: readonly string[],
  render: Renderer = renderCompose,
  output: {
    stdout: (value: string) => void;
    stderr: (value: string) => void;
  } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): number {
  try {
    const allowed = new Set(["--release-manifest", "--env-file", "--profile"]);
    const values = new Map<string, string>();
    if (argv.length !== 6) throw new Error("invalid_arguments");
    for (let index = 0; index < argv.length; index += 2) {
      const flag = argv[index]!,
        value = argv[index + 1]!;
      if (
        !allowed.has(flag) ||
        values.has(flag) ||
        !value.trim() ||
        value.startsWith("--")
      )
        throw new Error("invalid_arguments");
      values.set(flag, value);
    }
    const result = validateTfCanaryRenewalV2FromFiles(
      resolve(repositoryRoot, values.get("--release-manifest")!),
      resolve(repositoryRoot, values.get("--env-file")!),
      resolve(repositoryRoot, values.get("--profile")!),
      render,
    );
    output.stdout(`${JSON.stringify({ ok: true, ...result })}\n`);
    return 0;
  } catch (error) {
    const known = new Set([
      "invalid_arguments",
      "invalid_release_manifest",
      "invalid_canary_environment",
      "invalid_canary_renewal_profile",
      "canary_renewal_binding_failed",
      "canary_compose_render_failed",
      "canary_compose_snapshot_drift",
      "canary_origin_mismatch",
      "canary_image_environment_mismatch",
      "canary_resource_isolation_failed",
      "canary_unexpected_service",
      "canary_build_forbidden",
      "canary_service_image_mismatch",
      "canary_port_mismatch",
    ]);
    const message = error instanceof Error ? error.message : "";
    output.stderr(
      `${JSON.stringify({ ok: false, error: known.has(message) ? message : "canary_validation_failed" })}\n`,
    );
    return 1;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runTfCanaryRenewalV2Cli(process.argv.slice(2));
}
