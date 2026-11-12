import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { isIP } from "node:net";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { isolatedComposeEnvironment } from "./coolify-release.js";

type Environment = Readonly<Record<string, string>>;
type Renderer = (
  files: readonly string[],
  environment: Environment,
  interpolate: boolean,
) => unknown;
type Output = { stdout(value: string): void; stderr(value: string): void };
type ObjectMap = Record<string, unknown>;

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const project = "apollo-tf-reviewed-acceptance";
const baselineProject = "apollo-tf-canary-renewal-v2";
const baselineFiles = [
  "deploy/coolify/apollo-tf.compose.yml",
  "deploy/coolify/apollo-tf.canary.compose.yml",
  "deploy/coolify/apollo-tf.canary-renewal.v2.compose.yml",
] as const;
const sourceFiles = [
  ...baselineFiles,
  "deploy/coolify/apollo-tf.reviewed-acceptance.compose.yml",
] as const;
const standaloneFiles = [
  "deploy/coolify/apollo-tf.reviewed-acceptance.git.compose.yml",
] as const;
const catalogTarget = "/run/tf-reviewed/catalog.json";
const mediaTarget = "/run/tf-reviewed/media";
const images = {
  "tf-admin": "TF_ADMIN_IMAGE",
  "tf-api": "TF_API_IMAGE",
  "tf-baseline": "TF_API_IMAGE",
  "tf-download-redis": "TF_DOWNLOAD_REDIS_IMAGE",
  "tf-download-worker": "TF_DOWNLOAD_WORKER_IMAGE",
  "tf-integrations": "TF_INTEGRATIONS_IMAGE",
  "tf-integrations-migrate": "TF_INTEGRATIONS_IMAGE",
  "tf-integrations-postgres": "TF_INTEGRATIONS_POSTGRES_IMAGE",
  "tf-migrate": "TF_API_IMAGE",
  "tf-postgres": "TF_POSTGRES_IMAGE",
  "tf-redis": "TF_REDIS_IMAGE",
  "tf-role-bootstrap": "TF_POSTGRES_IMAGE",
  "tf-search": "TF_SEARCH_IMAGE",
  "tf-web": "TF_WEB_IMAGE",
} as const;
const networks: Readonly<Record<string, boolean>> = {
  "tf-data": true,
  "tf-edge": false,
  "tf-integrations-control": true,
  "tf-integrations-data": true,
  "tf-integrations-egress": false,
  "tf-search-control": true,
  "tf-search-egress": false,
  "tf-download-queue": true,
  "tf-download-control": true,
  "tf-download-egress": false,
};
const volumes = [
  "tf-postgres-data",
  "tf-redis-data",
  "tf-integrations-postgres-data",
  "tf-download-redis-data",
  "tf-downloads",
] as const;
const databaseNetworks: Readonly<Record<string, string>> = {
  "tf-postgres": "tf-data",
  "tf-redis": "tf-data",
  "tf-integrations-postgres": "tf-integrations-data",
  "tf-download-redis": "tf-download-queue",
};
const ports: Readonly<Record<string, readonly [string, number]>> = {
  "tf-api": ["TF_CANARY_API_PORT", 8080],
  "tf-web": ["TF_CANARY_WEB_PORT", 80],
  "tf-admin": ["TF_CANARY_ADMIN_PORT", 80],
};

class ReviewedAcceptanceError extends Error {}
function fail(code = "reviewed_topology_invalid"): never {
  throw new ReviewedAcceptanceError(code);
}

function object(value: unknown): ObjectMap {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail();
  return value as ObjectMap;
}

function exactKeys(value: ObjectMap, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validEnvironmentKey(key: string): boolean {
  return /^(?:TF_|PLATFORM_|RELEASE_)[A-Z0-9_]+$/.test(key);
}

function assertEnvironment(env: Environment): void {
  if (
    Object.entries(env).some(
      ([key, value]) =>
        !validEnvironmentKey(key) ||
        typeof value !== "string" ||
        /[\u0000-\u001f\u007f]/.test(value) ||
        value.trim() !== value,
    )
  ) {
    fail("invalid_reviewed_environment");
  }
}

function readBounded(path: string, limit: number): string {
  const listed = lstatSync(path);
  if (!listed.isFile() || listed.size > limit) throw new Error();
  const fd = openSync(
    path,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.dev !== listed.dev ||
      stat.ino !== listed.ino ||
      stat.size > limit
    )
      throw new Error();
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length !== stat.size) throw new Error();
    return new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, length),
    );
  } finally {
    closeSync(fd);
  }
}

export function readTfReviewedAcceptanceEnvironment(
  path: string,
): Record<string, string> {
  const values: Record<string, string> = {};
  try {
    for (const raw of readBounded(path, 64 * 1024).split(/\r?\n/)) {
      if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
      const separator = raw.indexOf("=");
      const name = raw.slice(0, separator);
      if (
        separator < 1 ||
        !validEnvironmentKey(name) ||
        Object.hasOwn(values, name)
      )
        throw new Error();
      values[name] = raw.slice(separator + 1);
    }
    assertEnvironment(values);
    return values;
  } catch {
    fail("invalid_reviewed_environment");
  }
}

function linuxPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 1_024 &&
    /^(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)+$/.test(value)
  );
}

function nested(parent: string, path: string): boolean {
  return path.startsWith(`${parent}/`);
}

function overlaps(left: string, right: string): boolean {
  return left === right || nested(left, right) || nested(right, left);
}

function dedicatedPath(value: unknown): value is string {
  return (
    linuxPath(value) &&
    value.split("/").includes(project) &&
    ![
      "/etc",
      "/run",
      "/var/run",
      "/dev",
      "/proc",
      "/sys",
      "/usr",
      "/boot",
      "/bin",
      "/sbin",
      "/var/lib/docker",
      "/var/lib/containerd",
      "/var/lib/kubelet",
      "/var/lib/apollo-tf",
      "/var/lib/apollo-tf-canary",
      "/var/lib/apollo-platform",
    ].some((root) => overlaps(root, value))
  );
}

function expectedBinds(
  env: Environment,
  secrets: ObjectMap,
): readonly ObjectMap[] {
  const root = env.TF_REVIEWED_DATA_ROOT;
  const catalog = env.TF_REVIEWED_CATALOG_FILE;
  const media = env.TF_REVIEWED_MEDIA_DIR;
  if (
    !dedicatedPath(root) ||
    !linuxPath(catalog) ||
    !linuxPath(media) ||
    !nested(root, catalog) ||
    !nested(root, media) ||
    overlaps(catalog, media)
  )
    fail("reviewed_data_root_unsafe");

  const secretRoot = env.TF_CANARY_SECRET_DIRECTORY;
  const adminRoot = env.TF_CANARY_ADMIN_CREDENTIAL_DIRECTORY;
  if (
    !dedicatedPath(secretRoot) ||
    !dedicatedPath(adminRoot) ||
    env.TF_SECRET_DIRECTORY !== secretRoot ||
    env.TF_ADMIN_CREDENTIAL_DIRECTORY !== adminRoot ||
    overlaps(secretRoot, adminRoot)
  ) {
    fail("reviewed_control_root_unsafe");
  }
  if (overlaps(root, secretRoot) || overlaps(root, adminRoot))
    fail("reviewed_data_root_unsafe");
  if (
    !Object.hasOwn(secrets, "admin_access_htpasswd") ||
    !Object.hasOwn(secrets, "tf_revoke_keyring")
  )
    fail();
  for (const [name, value] of Object.entries(secrets)) {
    const secret = object(value);
    const directory = name === "admin_access_htpasswd" ? adminRoot : secretRoot;
    if (
      typeof secret.file === "string" &&
      linuxPath(secret.file) &&
      overlaps(root, posix.dirname(secret.file))
    )
      fail("reviewed_data_root_unsafe");
    if (
      !/^[a-z][a-z0-9_]*$/.test(name) ||
      !exactKeys(secret, ["name", "file"]) ||
      secret.name !== `${project}_${name}` ||
      secret.file !== `${directory}/${name}`
    )
      fail("reviewed_control_root_unsafe");
  }

  return [
    [catalog, catalogTarget],
    [media, mediaTarget],
  ].map(([source, target]) => ({
    type: "bind",
    source,
    target,
    read_only: true,
    bind: { create_host_path: false },
  }));
}

function externalOrigin(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      url.protocol === "https:" &&
      url.hostname.includes(".") &&
      !url.hostname.endsWith(".") &&
      !isIP(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|localdomain|internal)(?:\.|$)/.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}

function assertOrigins(env: Environment, services: ObjectMap): void {
  const platform = env.PLATFORM_CANARY_PUBLIC_ORIGIN;
  const api = env.TF_CANARY_API_PUBLIC_ORIGIN;
  const web = env.TF_CANARY_PUBLIC_ORIGIN;
  const apiEnv = object(object(services["tf-api"]).environment);
  const integrationsEnv = object(
    object(services["tf-integrations"]).environment,
  );
  if (
    !externalOrigin(platform) ||
    !externalOrigin(api) ||
    !externalOrigin(web) ||
    new Set([platform, api, web]).size !== 3 ||
    env.TF_WEB_API_ORIGIN !== api ||
    env.PLATFORM_PUBLIC_ORIGIN !== platform ||
    env.TF_API_PUBLIC_ORIGIN !== api ||
    env.TF_PUBLIC_ORIGIN !== web ||
    env.TF_RENEWAL_ENABLED !== "true" ||
    apiEnv.APOLLO_TF_RENEWAL_ENABLED !== "true" ||
    apiEnv.APOLLO_PLATFORM_API_ORIGIN !== platform ||
    apiEnv.APOLLO_PLATFORM_ISSUER !== platform ||
    apiEnv.APOLLO_TF_BRIDGE_ALLOW_INTERNAL_HTTP !== "false" ||
    apiEnv.SERVER_URL !== api ||
    apiEnv.APOLLO_TF_CALLBACK_URL !== `${api}/api/auth/callback` ||
    apiEnv.WEB_URL !== web ||
    apiEnv.APOLLO_TF_WEB_ORIGIN !== web ||
    integrationsEnv.TF_INTEGRATIONS_SPOTIFY_CALLBACK_URI !==
      `${api}/api/spotify/callback`
  ) {
    fail("reviewed_origin_mismatch");
  }
}

function digestImage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  const match =
    /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]{1,5})?\/)?(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:([a-f0-9]{64})$/.exec(
      value,
    );
  return !!match && !/^0+$/.test(match[1]!);
}

function assertResources(
  networkValues: ObjectMap,
  volumeValues: ObjectMap,
): void {
  if (
    !exactKeys(networkValues, Object.keys(networks)) ||
    !exactKeys(volumeValues, volumes)
  )
    fail();
  const names = new Set<string>();
  for (const [key, value] of [
    ...Object.entries(networkValues),
    ...Object.entries(volumeValues),
  ]) {
    const resource = object(value);
    const name = resource.name;
    const isNetwork = Object.hasOwn(networks, key);
    if (
      typeof name !== "string" ||
      !new RegExp(`^${project}-[a-z0-9][a-z0-9-]*$`).test(name) ||
      names.has(name) ||
      (resource.external !== undefined && resource.external !== false) ||
      Object.keys(resource).some(
        (field) =>
          ![
            "name",
            "external",
            ...(isNetwork ? ["internal", "ipam"] : []),
          ].includes(field),
      ) ||
      (isNetwork &&
        ((resource.internal ?? false) !== networks[key] ||
          (resource.ipam !== undefined &&
            !exactKeys(object(resource.ipam), []))))
    )
      fail("reviewed_resource_isolation_failed");
    names.add(name);
  }
}

function assertServices(
  env: Environment,
  services: ObjectMap,
  binds: readonly ObjectMap[],
): void {
  if (!exactKeys(services, Object.keys(images)))
    fail("reviewed_service_inventory_mismatch");
  const published = new Set<string>();
  for (const [name, imageKey] of Object.entries(images)) {
    const service = object(services[name]);
    if (!digestImage(service.image) || service.image !== env[imageKey])
      fail("reviewed_image_reference_invalid");
    if (
      [
        "build",
        "devices",
        "device_cgroup_rules",
        "network_mode",
        "pid",
        "ipc",
        "uts",
        "volumes_from",
        "configs",
        "external_links",
        "links",
      ].some((key) => Object.hasOwn(service, key)) ||
      (service.privileged !== undefined && service.privileged !== false)
    )
      fail();
    const serviceNetworks = object(service.networks);
    const databaseNetwork = databaseNetworks[name];
    if (
      !Object.keys(serviceNetworks).length ||
      Object.keys(serviceNetworks).some(
        (key) => !Object.hasOwn(networks, key),
      ) ||
      (databaseNetwork !== undefined &&
        !exactKeys(serviceNetworks, [databaseNetwork]))
    )
      fail("reviewed_resource_isolation_failed");
    const baselineJob = name === "tf-role-bootstrap" || name === "tf-baseline";
    if (
      baselineJob
        ? !isDeepStrictEqual(service.profiles, ["baseline"])
        : service.profiles !== undefined
    )
      fail();

    const servicePorts = service.ports ?? [];
    const expected = ports[name];
    if (
      !Array.isArray(servicePorts) ||
      servicePorts.length !== (expected ? 1 : 0)
    )
      fail("reviewed_port_mismatch");
    if (expected) {
      const port = object(servicePorts[0]);
      const configured = env[expected[0]];
      if (
        !configured ||
        !/^[1-9][0-9]{0,4}$/.test(configured) ||
        Number(configured) > 65_535 ||
        published.has(configured) ||
        port.host_ip !== "127.0.0.1" ||
        String(port.published) !== configured ||
        port.target !== expected[1] ||
        (port.protocol !== undefined && port.protocol !== "tcp")
      )
        fail("reviewed_port_mismatch");
      published.add(configured);
    }

    const mounted = service.volumes ?? [];
    if (!Array.isArray(mounted)) fail();
    const runtimeEnv =
      service.environment === undefined ? {} : object(service.environment);
    const recordingEnv = Object.keys(runtimeEnv).filter((key) =>
      key.startsWith("TF_RECORDING_"),
    );
    if (name === "tf-api") {
      if (
        mounted.length !== 2 ||
        !binds.every((expected) =>
          mounted.some((actual) => isDeepStrictEqual(actual, expected)),
        ) ||
        recordingEnv.length !== 2 ||
        runtimeEnv.TF_RECORDING_CATALOG_FILE !== catalogTarget ||
        runtimeEnv.TF_RECORDING_MEDIA_DIR !== mediaTarget
      )
        fail("reviewed_media_mount_mismatch");
    } else if (
      recordingEnv.length ||
      mounted.some((value) => {
        const mount = object(value);
        return (
          mount.type !== "volume" ||
          typeof mount.source !== "string" ||
          !volumes.some((name) => name === mount.source)
        );
      })
    )
      fail("reviewed_media_mount_mismatch");
  }
}

export function validateTfReviewedAcceptanceTopology(
  env: Environment,
  baseline: unknown,
  reviewed: unknown,
): void {
  assertEnvironment(env);
  const original = object(baseline);
  const resolved = object(reviewed);
  if (original.name !== baselineProject || resolved.name !== project) fail();
  const services = object(resolved.services);
  const networkValues = object(resolved.networks);
  const volumeValues = object(resolved.volumes);
  assertResources(networkValues, volumeValues);
  const binds = expectedBinds(env, object(resolved.secrets));
  assertServices(env, services, binds);
  assertOrigins(env, services);

  // Remove only verified deltas before checking the rest of the resolved model.
  const projected = structuredClone(resolved);
  projected.name = original.name;
  for (const key of ["networks", "volumes", "secrets"]) {
    const previous = object(original[key]);
    for (const [name, value] of Object.entries(object(projected[key]))) {
      object(value).name = object(previous[name]).name;
    }
  }
  const api = object(object(projected.services)["tf-api"]);
  delete api.volumes;
  delete object(api.environment).TF_RECORDING_CATALOG_FILE;
  delete object(api.environment).TF_RECORDING_MEDIA_DIR;
  if (!isDeepStrictEqual(projected, original))
    fail("reviewed_unexpected_baseline_delta");
}

function assertLocalComposeSource(path: string): void {
  const source = readBounded(path, 512 * 1024);
  // These fixed repo layers are local block YAML, with no include/extends/env-file directives.
  // Reject alternate syntax that could hide a file-loading key before invoking Compose.
  if (
    source.includes("\\") ||
    source.includes("\0") ||
    source.split(/\r?\n/).some((line) => {
      if (!line.trim() || line.trimStart().startsWith("#")) return false;
      return (
        /\b(?:include|extends|env_file)\b/.test(line) ||
        (!line.startsWith(" ") &&
          !/^(?:name|services|networks|volumes|secrets|x-[a-z0-9-]+):(?:\s|$)/.test(
            line,
          ))
      );
    })
  )
    fail("reviewed_compose_source_unsafe");
}

function renderCompose(
  files: readonly string[],
  environment: Environment,
  interpolate: boolean,
): unknown {
  const paths = files.map((file) => resolve(repositoryRoot, file));
  paths.forEach(assertLocalComposeSource);
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--profile",
      "*",
      ...paths.flatMap((file) => ["-f", file]),
      "config",
      "--format",
      "json",
      "--no-path-resolution",
      "--no-env-resolution",
      ...(!interpolate ? ["--no-interpolate"] : []),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
      env: isolatedComposeEnvironment({
        ...environment,
        COMPOSE_DISABLE_ENV_FILE: "true",
      }),
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  if (result.status !== 0) fail("reviewed_compose_render_failed");
  return JSON.parse(result.stdout) as unknown;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) =>
    typeof current === "object" && current !== null && !Array.isArray(current)
      ? Object.fromEntries(
          Object.keys(current)
            .sort()
            .map((key) => [key, (current as ObjectMap)[key]]),
        )
      : current,
  );
}

export function validateTfReviewedAcceptance(
  env: Environment,
  render: Renderer = renderCompose,
) {
  assertEnvironment(env);
  function checkedRender(
    files: readonly string[],
    interpolate: boolean,
  ): ObjectMap {
    try {
      return object(render(files, env, interpolate));
    } catch (error) {
      if (
        error instanceof ReviewedAcceptanceError &&
        error.message === "reviewed_compose_source_unsafe"
      )
        throw error;
      fail("reviewed_compose_render_failed");
    }
  }
  const source = canonical(checkedRender(sourceFiles, false));
  const standalone = canonical(checkedRender(standaloneFiles, false));
  if (source !== standalone) fail("reviewed_compose_snapshot_drift");
  validateTfReviewedAcceptanceTopology(
    env,
    checkedRender(baselineFiles, true),
    checkedRender(sourceFiles, true),
  );
  return {
    status: "validated",
    evidenceLevel: "compose-config-only",
    activationAllowed: false,
    composeSha256: createHash("sha256").update(source).digest("hex"),
    serviceCount: Object.keys(images).length,
    networkCount: Object.keys(networks).length,
    volumeCount: volumes.length,
  } as const;
}

export function runTfReviewedAcceptanceCli(
  args: readonly string[],
  render: Renderer = renderCompose,
  output: Output = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): number {
  try {
    const path = args[1];
    if (
      args.length !== 2 ||
      args[0] !== "--env-file" ||
      !path?.trim() ||
      path.startsWith("--")
    )
      fail("invalid_arguments");
    const result = validateTfReviewedAcceptance(
      readTfReviewedAcceptanceEnvironment(resolve(repositoryRoot, path)),
      render,
    );
    output.stdout(`${JSON.stringify({ ok: true, ...result })}\n`);
    return 0;
  } catch (error) {
    output.stderr(
      `${JSON.stringify({ ok: false, error: error instanceof ReviewedAcceptanceError ? error.message : "reviewed_validation_failed" })}\n`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runTfReviewedAcceptanceCli(process.argv.slice(2));
}
