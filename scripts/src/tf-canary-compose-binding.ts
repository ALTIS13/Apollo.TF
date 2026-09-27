import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isolatedComposeEnvironment,
  type ComposeDocument,
} from "./coolify-release.js";
import { verifyTfOnlyOperatorReleaseEvidence } from "./operator-release.js";
import {
  tfOnlyReleaseImageEnvironmentNames,
  type TfOnlyArtifactImageName,
  type TfOnlyReleaseArtifact,
} from "./release-images.js";

const serviceImages: Readonly<Record<string, TfOnlyArtifactImageName>> = {
  "tf-admin": "tf-admin",
  "tf-api": "tf-api",
  "tf-download-redis": "tf-download-redis",
  "tf-download-worker": "tf-download-worker",
  "tf-integrations": "tf-integrations",
  "tf-integrations-migrate": "tf-integrations",
  "tf-integrations-postgres": "tf-integrations-postgres",
  "tf-migrate": "tf-api",
  "tf-postgres": "tf-postgres",
  "tf-redis": "redis",
  "tf-search": "tf-search",
  "tf-web": "tf-web",
};

const servicePorts: Readonly<
  Record<string, { environmentName: string; target: number }>
> = {
  "tf-api": { environmentName: "TF_CANARY_API_PORT", target: 8080 },
  "tf-web": { environmentName: "TF_CANARY_WEB_PORT", target: 80 },
  "tf-admin": { environmentName: "TF_CANARY_ADMIN_PORT", target: 80 },
};

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const networkNames: Readonly<Record<string, string>> = Object.fromEntries(
  [
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
  ].map((name) => [`tf-${name}`, `apollo-tf-canary-${name}-v1`]),
);
const internalNetworks = new Set([
  "tf-data",
  "tf-integrations-control",
  "tf-integrations-data",
  "tf-search-control",
  "tf-download-queue",
  "tf-download-control",
]);

const volumeNames: Readonly<Record<string, string>> = {
  "tf-postgres-data": "apollo-tf-canary-postgres-v1",
  "tf-redis-data": "apollo-tf-canary-redis-v1",
  "tf-integrations-postgres-data": "apollo-tf-canary-integrations-postgres-v1",
  "tf-download-redis-data": "apollo-tf-canary-download-redis-v1",
  "tf-downloads": "apollo-tf-canary-downloads-v1",
};

function assertResourceNames(
  actual: Record<string, { name?: string; external?: boolean }> | undefined,
  expected: Readonly<Record<string, string>>,
): void {
  if (
    actual === undefined ||
    Object.keys(actual).length !== Object.keys(expected).length ||
    Object.entries(expected).some(
      ([key, name]) =>
        actual[key]?.name !== name || actual[key]?.external === true,
    )
  ) {
    throw new Error("canary_resource_isolation_failed");
  }
}

function isCanaryHostDirectory(value: string | undefined): value is string {
  return (
    value !== undefined &&
    posix.isAbsolute(value) &&
    posix.normalize(value) === value &&
    value.split("/").includes("apollo-tf-canary")
  );
}

function assertCanarySecretFiles(
  environment: Readonly<Record<string, string>>,
  compose: ComposeDocument,
): void {
  const secretDirectory = environment.TF_CANARY_SECRET_DIRECTORY;
  const adminDirectory = environment.TF_CANARY_ADMIN_CREDENTIAL_DIRECTORY;
  const secrets = compose.secrets;
  if (
    !isCanaryHostDirectory(secretDirectory) ||
    !isCanaryHostDirectory(adminDirectory) ||
    secretDirectory === adminDirectory ||
    secrets === undefined ||
    Object.keys(secrets).length === 0 ||
    Object.entries(secrets).some(([name, definition]) => {
      const directory =
        name === "admin_access_htpasswd" ? adminDirectory : secretDirectory;
      return (
        !/^[a-z][a-z0-9_]*$/.test(name) ||
        definition.file !== posix.join(directory, name)
      );
    })
  ) {
    throw new Error("canary_resource_isolation_failed");
  }
}

export function validateTfCanaryComposeBinding(
  artifact: TfOnlyReleaseArtifact,
  environment: Readonly<Record<string, string>>,
  compose: ComposeDocument,
): { apiOrigin: string; imageCount: number; serviceCount: number } {
  const apiOrigin = artifact.tfWebApiOrigin;
  if (
    apiOrigin === undefined ||
    environment.TF_WEB_API_ORIGIN !== apiOrigin ||
    environment.TF_CANARY_API_PUBLIC_ORIGIN !== apiOrigin ||
    environment.RELEASE_SOURCE_COMMIT !== artifact.sourceCommit ||
    environment.TF_SUCCESSOR_WS_ENABLED !== "false"
  ) {
    throw new Error("canary_origin_mismatch");
  }

  const references = new Map(
    artifact.images.map(({ name, imageReference }) => [name, imageReference]),
  );
  if (references.size !== 10) {
    throw new Error("canary_image_environment_mismatch");
  }
  for (const [name, imageName] of Object.entries(
    tfOnlyReleaseImageEnvironmentNames,
  )) {
    if (environment[name] !== references.get(imageName)) {
      throw new Error("canary_image_environment_mismatch");
    }
  }

  if (compose.name !== "apollo-tf-canary") {
    throw new Error("canary_resource_isolation_failed");
  }
  assertResourceNames(compose.networks, networkNames);
  if (
    Object.keys(networkNames).some(
      (name) =>
        Boolean(compose.networks?.[name]?.internal) !==
        internalNetworks.has(name),
    )
  ) {
    throw new Error("canary_resource_isolation_failed");
  }
  assertResourceNames(compose.volumes, volumeNames);
  assertCanarySecretFiles(environment, compose);

  const publishedPorts = Object.values(servicePorts).map(
    ({ environmentName }) => environment[environmentName],
  );
  if (
    publishedPorts.some(
      (port) =>
        port === undefined ||
        !/^[0-9]+$/.test(port) ||
        Number(port) < 1024 ||
        Number(port) > 65535 ||
        ["18201", "18202", "18203"].includes(port),
    ) ||
    new Set(publishedPorts).size !== publishedPorts.length
  ) {
    throw new Error("canary_port_mismatch");
  }

  if (
    Object.keys(compose.services).length !==
      Object.keys(serviceImages).length ||
    Object.keys(compose.services).some((name) => !(name in serviceImages))
  ) {
    throw new Error("canary_unexpected_service");
  }
  for (const [serviceName, imageName] of Object.entries(serviceImages)) {
    const service = compose.services[serviceName];
    if (service === undefined) throw new Error("canary_unexpected_service");
    if (Object.hasOwn(service, "build")) {
      throw new Error("canary_build_forbidden");
    }
    if (
      service.network_mode !== undefined ||
      service.volumes?.some(
        (mount) =>
          typeof mount === "string" ||
          mount.type !== "volume" ||
          mount.source === undefined ||
          !(mount.source in volumeNames),
      ) ||
      (service.networks !== undefined &&
        (Array.isArray(service.networks)
          ? service.networks
          : Object.keys(service.networks)
        ).some((network) => !(network in networkNames)))
    ) {
      throw new Error("canary_resource_isolation_failed");
    }
    if (service.image !== references.get(imageName)) {
      throw new Error("canary_service_image_mismatch");
    }
    const expectedPort = servicePorts[serviceName];
    if (expectedPort === undefined) {
      if ((service.ports?.length ?? 0) !== 0) {
        throw new Error("canary_port_mismatch");
      }
    } else {
      const port = service.ports?.[0];
      if (
        service.ports?.length !== 1 ||
        port?.host_ip !== "127.0.0.1" ||
        String(port.published) !== environment[expectedPort.environmentName] ||
        port.target !== expectedPort.target ||
        (port.protocol !== undefined && port.protocol !== "tcp")
      ) {
        throw new Error("canary_port_mismatch");
      }
    }
  }

  const apiEnvironment = compose.services["tf-api"]!.environment;
  const integrationsEnvironment =
    compose.services["tf-integrations"]!.environment;
  const webOrigin = environment.TF_CANARY_PUBLIC_ORIGIN;
  const platformOrigin = environment.PLATFORM_CANARY_PUBLIC_ORIGIN;
  if (
    !isCanaryHttpsOrigin(webOrigin) ||
    !isCanaryHttpsOrigin(platformOrigin) ||
    apiEnvironment?.SERVER_URL !== apiOrigin ||
    apiEnvironment.APOLLO_TF_CALLBACK_URL !==
      `${apiOrigin}/api/auth/callback` ||
    apiEnvironment.APOLLO_TF_WEB_ORIGIN !== webOrigin ||
    apiEnvironment.WEB_URL !== webOrigin ||
    apiEnvironment.APOLLO_PLATFORM_API_ORIGIN !== platformOrigin ||
    apiEnvironment.APOLLO_PLATFORM_ISSUER !== platformOrigin ||
    apiEnvironment.APOLLO_TF_BRIDGE_ALLOW_INTERNAL_HTTP !== "false" ||
    apiEnvironment.APOLLO_TF_RENEWAL_ENABLED !== "false" ||
    integrationsEnvironment?.TF_INTEGRATIONS_SPOTIFY_CALLBACK_URI !==
      `${apiOrigin}/api/spotify/callback`
  ) {
    throw new Error("canary_origin_mismatch");
  }

  return {
    apiOrigin,
    imageCount: references.size,
    serviceCount: Object.keys(serviceImages).length,
  };
}

function isCanaryHttpsOrigin(origin: string | undefined): origin is string {
  if (origin === undefined) return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "https:" &&
      parsed.origin === origin &&
      parsed.hostname.endsWith(".apollot.ru") &&
      parsed.hostname.split(".").includes("canary")
    );
  } catch {
    return false;
  }
}

export function validateTfCanaryComposeFromFiles(
  manifestPath: string,
  environmentPath: string,
  render: (
    environmentPath: string,
    environment: Readonly<Record<string, string>>,
  ) => ComposeDocument = renderTfCanaryCompose,
): { apiOrigin: string; imageCount: number; serviceCount: number } {
  const artifact = verifyTfOnlyOperatorReleaseEvidence(manifestPath);
  const environment = readCanaryEnvironment(environmentPath);
  if (
    artifact.tfWebApiOrigin === undefined ||
    environment.TF_WEB_API_ORIGIN !== artifact.tfWebApiOrigin ||
    environment.TF_CANARY_API_PUBLIC_ORIGIN !== artifact.tfWebApiOrigin
  ) {
    throw new Error("canary_origin_mismatch");
  }
  return validateTfCanaryComposeBinding(
    artifact,
    environment,
    render(environmentPath, environment),
  );
}

function readCanaryEnvironment(path: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("invalid_canary_environment");
    const name = line.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || environment[name] !== undefined) {
      throw new Error("invalid_canary_environment");
    }
    environment[name] = line.slice(separator + 1);
  }
  return environment;
}

function renderTfCanaryCompose(
  environmentPath: string,
  environment: Readonly<Record<string, string>>,
): ComposeDocument {
  const rendered = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      environmentPath,
      "-f",
      resolve(repositoryRoot, "deploy/coolify/apollo-tf.compose.yml"),
      "-f",
      resolve(repositoryRoot, "deploy/coolify/apollo-tf.canary.compose.yml"),
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
  if (rendered.status !== 0) throw new Error("canary_compose_render_failed");
  try {
    const compose = JSON.parse(rendered.stdout) as ComposeDocument;
    if (
      typeof compose !== "object" ||
      compose === null ||
      typeof compose.services !== "object" ||
      compose.services === null
    ) {
      throw new Error("canary_compose_render_failed");
    }
    return compose;
  } catch {
    throw new Error("canary_compose_render_failed");
  }
}

export function runTfCanaryComposeBindingCli(
  argv: readonly string[],
  render: (
    environmentPath: string,
    environment: Readonly<Record<string, string>>,
  ) => ComposeDocument = renderTfCanaryCompose,
  output: {
    stdout: (value: string) => void;
    stderr: (value: string) => void;
  } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): number {
  try {
    const values = new Map<string, string>();
    const allowed = new Set(["--env-file", "--release-manifest"]);
    if (argv.length !== 4) throw new Error("invalid_arguments");
    for (let index = 0; index < argv.length; index += 2) {
      const flag = argv[index]!;
      const value = argv[index + 1]!;
      if (!allowed.has(flag) || values.has(flag) || value.startsWith("--")) {
        throw new Error("invalid_arguments");
      }
      values.set(flag, value);
    }
    const environmentPath = values.get("--env-file");
    const manifestPath = values.get("--release-manifest");
    if (!environmentPath || !manifestPath) {
      throw new Error("invalid_arguments");
    }
    const result = validateTfCanaryComposeFromFiles(
      resolve(repositoryRoot, manifestPath),
      resolve(repositoryRoot, environmentPath),
      render,
    );
    output.stdout(`${JSON.stringify({ ok: true, ...result })}\n`);
    return 0;
  } catch (error) {
    const knownErrors = new Set([
      "invalid_arguments",
      "invalid_release_manifest",
      "invalid_canary_environment",
      "canary_compose_render_failed",
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
      `${JSON.stringify({ ok: false, error: knownErrors.has(message) ? message : "canary_validation_failed" })}\n`,
    );
    return 1;
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  resolve(entryPath) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runTfCanaryComposeBindingCli(process.argv.slice(2));
}
