import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { isolatedComposeEnvironment } from "./coolify-release.js";
import { readTfReviewedAcceptanceEnvironment } from "./tf-reviewed-acceptance.js";

type Environment = Readonly<Record<string, string>>;
type Renderer = (source: Buffer, environment: Environment) => unknown;
type Options = { render?: Renderer; source?: Buffer };
type CliOptions = Options & {
  readEnvironment?: (path: string) => Environment;
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
};
type Fields = Record<string, unknown>;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const composePath = resolve(root, "deploy/coolify/apollo-tf.search-compute.git.compose.yml");
const project = "apollo-tf-search-compute";
const control = "tf-search-compute-control";
const egress = "tf-search-compute-egress";
const controlName = `${project}-control-v1`;
const egressName = `${project}-egress-v1`;
const imageRepository = "ghcr.io/altis13/apollo-tf-search";
const secretNames = ["tf_search_internal_auth_secret", "tf_search_heartbeat_secret"] as const;
const composeKeys = [
  "TF_SEARCH_COMPUTE_IMAGE_DIGEST", "TF_SEARCH_VERSION", "TF_SEARCH_DEPLOYED_AT",
  "TF_SEARCH_COMPUTE_SECRET_DIRECTORY", "TF_SEARCH_COMPUTE_HEARTBEAT_API_ORIGIN",
] as const;
const inputKeys = [
  ...composeKeys, "TF_SEARCH_ORIGIN", "TF_SEARCH_COMPUTE_APPROVED_LISTENER_ORIGIN",
  "TF_SEARCH_COMPUTE_LISTENER_MODE", "TF_SEARCH_COMPUTE_LISTENER_DESTINATION",
  "TF_SEARCH_COMPUTE_LISTENER_NETWORK", "TF_SEARCH_COMPUTE_LISTENER_UPSTREAM",
  "TF_SEARCH_COMPUTE_DESTINATION", "TF_SEARCH_COMPUTE_OWNER", "TF_SEARCH_COMPUTE_AVAILABLE_MILLICPUS",
  "TF_SEARCH_COMPUTE_AVAILABLE_MEMORY_MIB", "TF_SEARCH_COMPUTE_AVAILABLE_PIDS",
] as const;
const sourceLimit = 64 * 1024;
const MiB = 1024 * 1024;

class SearchComputeError extends Error {}

function requireCheck(condition: unknown, code = "search_compute_topology_invalid"): asserts condition {
  if (!condition) throw new SearchComputeError(code);
}

function fields(value: unknown, allowed: readonly string[]): Fields {
  requireCheck(typeof value === "object" && value !== null && !Array.isArray(value));
  requireCheck(Object.keys(value).every((key) => allowed.includes(key)));
  return value as Fields;
}

function positiveInt(value: unknown): number {
  const numeric = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  return typeof numeric === "number" && Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function httpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch { return false; }
}

function safeSecretDirectory(path: string): boolean {
  return /^(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*){2,}$/.test(path) && ![
    "/etc", "/dev", "/proc", "/sys", "/usr", "/boot", "/run", "/var/run",
    "/var/lib/docker", "/var/lib/containerd", "/var/lib/kubelet",
  ].some((system) => path === system || path.startsWith(`${system}/`) || system.startsWith(`${path}/`));
}

function validateInputs(input: Environment) {
  const validInput = (condition: unknown) => requireCheck(condition, "search_compute_input_invalid");
  validInput(Object.keys(input).length === inputKeys.length && inputKeys.every((key) =>
    Object.hasOwn(input, key) && typeof input[key] === "string" && /^[!-~]{1,1024}$/.test(input[key]!),
  ));
  const env = input as Readonly<Record<(typeof inputKeys)[number], string>>;
  const digest = env.TF_SEARCH_COMPUTE_IMAGE_DIGEST;
  const listener = env.TF_SEARCH_ORIGIN;
  const validId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
  validInput(/^[0-9a-f]{64}$/.test(digest) && digest !== "0".repeat(64));
  validInput(/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,127}$/.test(env.TF_SEARCH_VERSION));
  const date = env.TF_SEARCH_DEPLOYED_AT;
  const timestamp = Date.parse(date);
  const iso = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
  validInput(iso === date || iso.replace(/\.000Z$/, "Z") === date);
  validInput(safeSecretDirectory(env.TF_SEARCH_COMPUTE_SECRET_DIRECTORY));
  validInput(httpsOrigin(env.TF_SEARCH_COMPUTE_HEARTBEAT_API_ORIGIN));
  validInput(validId.test(env.TF_SEARCH_COMPUTE_OWNER) && validId.test(env.TF_SEARCH_COMPUTE_DESTINATION));
  validInput(httpsOrigin(listener) && listener === env.TF_SEARCH_COMPUTE_APPROVED_LISTENER_ORIGIN &&
    env.TF_SEARCH_COMPUTE_LISTENER_MODE === "private-https" &&
    env.TF_SEARCH_COMPUTE_LISTENER_DESTINATION === env.TF_SEARCH_COMPUTE_DESTINATION &&
    env.TF_SEARCH_COMPUTE_LISTENER_NETWORK === controlName &&
    env.TF_SEARCH_COMPUTE_LISTENER_UPSTREAM === "http://tf-search:8080");
  const cpus = positiveInt(env.TF_SEARCH_COMPUTE_AVAILABLE_MILLICPUS) / 1000;
  const memory = positiveInt(env.TF_SEARCH_COMPUTE_AVAILABLE_MEMORY_MIB) * MiB;
  const pids = positiveInt(env.TF_SEARCH_COMPUTE_AVAILABLE_PIDS);
  validInput(cpus > 0 && memory > 0 && Number.isSafeInteger(memory) && pids > 0);
  return { env, digest: `sha256:${digest}`, cpus, memory, pids };
}

function readSource(): Buffer {
  try {
    const stat = lstatSync(composePath);
    requireCheck(stat.isFile() && stat.size <= sourceLimit, "search_compute_source_unsafe");
    return readFileSync(composePath);
  } catch { throw new SearchComputeError("search_compute_source_unsafe"); }
}

function assertSafeSource(source: Buffer): void {
  const safe = (condition: unknown) => requireCheck(condition, "search_compute_source_unsafe");
  safe(source.length > 0 && source.length <= sourceLimit);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(source); }
  catch { throw new SearchComputeError("search_compute_source_unsafe"); }
  // Only this local block-YAML profile is supported. Check before Compose can read any referenced files.
  safe(!/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029]|\r(?!\n)/.test(text));
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    safe(!line.includes("\\") &&
      (line.startsWith(" ") || /^(?:name|services|secrets|networks):(?: |$)/.test(line)) &&
      !/\b(?:include|extends|env_file|label_file)\b/.test(line) &&
      !/^\s*(?:[-?]\s+)?(?:[&*!?%]|<<\s*:)/.test(line) && !/:\s+[&*!]/.test(line));
    if (/(?:^|[\s[{,])['"]?file['"]?\s*:/.test(line)) {
      safe(/^ +file: \$\{TF_SEARCH_COMPUTE_SECRET_DIRECTORY:\?[^{}$]+\}\/tf_search_(?:heartbeat|internal_auth)_secret(?: +#.*)? *$/.test(line));
    }
    const withoutInterpolation = line.replace(/\$\{([A-Z_]+):\?[^{}$]+\}/g, (expression, key: string) =>
      composeKeys.some((known) => known === key) ? "" : expression,
    );
    safe(!withoutInterpolation.includes("$"));
  }
}

function renderCompose(source: Buffer, env: Environment): unknown {
  const result = spawnSync("docker", [
    "compose", "-f", "-", "config", "--format", "json", "--no-path-resolution", "--no-env-resolution",
  ], {
    cwd: root,
    input: source,
    encoding: "utf8",
    windowsHide: true,
    env: isolatedComposeEnvironment({ ...env, COMPOSE_DISABLE_ENV_FILE: "true" }),
    maxBuffer: 512 * 1024,
    timeout: 15_000,
  });
  requireCheck(result.status === 0, "search_compute_render_failed");
  return JSON.parse(result.stdout) as unknown;
}

function sizeBytes(value: unknown): number {
  if (typeof value === "number") return positiveInt(value);
  const match = typeof value === "string" ? /^([1-9][0-9]*)([kmg])?b?$/i.exec(value) : null;
  const power = match?.[2] ? "kmg".indexOf(match[2].toLowerCase()) + 1 : 0;
  return match ? positiveInt(Number(match[1]) * 1024 ** power) : 0;
}

function validateTopology(value: unknown, input: ReturnType<typeof validateInputs>): void {
  const { env } = input;
  const topology = fields(value, ["name", "services", "secrets", "networks"]);
  const services = fields(topology.services, ["tf-search"]);
  const service = fields(services["tf-search"], [
    "image", "init", "restart", "stop_grace_period", "pids_limit", "deploy", "logging", "user", "read_only",
    "cap_drop", "security_opt", "environment", "secrets", "tmpfs", "networks", "healthcheck", "command", "entrypoint",
  ]);
  requireCheck(topology.name === project && service.image === `${imageRepository}@${input.digest}`);
  requireCheck(service.command == null && service.entrypoint == null && service.init === true &&
    service.user === "10001:10001" && service.read_only === true &&
    isDeepStrictEqual(service.cap_drop, ["ALL"]) && isDeepStrictEqual(service.security_opt, ["no-new-privileges:true"]));

  const deploy = fields(service.deploy, ["replicas", "mode", "resources", "placement"]);
  const resources = fields(deploy.resources, ["limits"]);
  const limits = fields(resources.limits, ["cpus", "memory", "pids"]);
  const cpu = typeof limits.cpus === "number" || (typeof limits.cpus === "string" && /^\d+(?:\.\d+)?$/.test(limits.cpus)) ? Number(limits.cpus) : 0;
  const memory = sizeBytes(limits.memory);
  const pids = positiveInt(limits.pids);
  requireCheck(deploy.replicas === 1 && (deploy.mode === undefined || deploy.mode === "replicated") &&
    (deploy.placement === undefined || isDeepStrictEqual(deploy.placement, {})) &&
    cpu > 0 && cpu <= input.cpus && memory > 0 && memory <= input.memory &&
    pids > 0 && pids <= input.pids && positiveInt(service.pids_limit) === pids);

  const log = fields(service.logging, ["driver", "options"]);
  const logOptions = fields(log.options, ["max-size", "max-file"]);
  requireCheck(log.driver === "json-file" && sizeBytes(logOptions["max-size"]) > 0 && positiveInt(logOptions["max-file"]) > 0);

  requireCheck(isDeepStrictEqual(service.environment, {
    APOLLO_API_VERSION: env.TF_SEARCH_VERSION, APOLLO_DEPLOYED_AT: env.TF_SEARCH_DEPLOYED_AT,
    NODE_ENV: "production", PORT: "8080", TF_SEARCH_HEARTBEAT_ALLOW_INSECURE_HTTP: "false",
    TF_SEARCH_HEARTBEAT_API_ORIGIN: env.TF_SEARCH_COMPUTE_HEARTBEAT_API_ORIGIN,
    TF_SEARCH_HEARTBEAT_SECRET_FILE: "/run/secrets/tf_search_heartbeat_secret",
    TF_SEARCH_INTERNAL_AUTH_SECRET_FILE: "/run/secrets/tf_search_internal_auth_secret",
  }));

  const secrets = fields(topology.secrets, secretNames);
  requireCheck(Array.isArray(service.secrets) && service.secrets.length === secretNames.length);
  const mounts = service.secrets.map((mount) => fields(mount, ["source", "target", "uid", "gid", "mode"]));
  for (const name of secretNames) {
    const secret = fields(secrets[name], ["name", "file"]);
    const mount = mounts.find(({ source }) => source === name);
    requireCheck((secret.name === undefined || secret.name === `${project}_${name}`) &&
      secret.file === `${env.TF_SEARCH_COMPUTE_SECRET_DIRECTORY}/${name}` &&
      mount?.target === name && mount.uid === "10001" && mount.gid === "10001" &&
      (mount.mode === "0400" || mount.mode === 0o400));
  }

  requireCheck(Array.isArray(service.tmpfs) && service.tmpfs.length === 2);
  const sizes = ["/tmp", "/tmp/yt-dlp"].map((path) => {
    const prefix = `${path}:rw,noexec,nosuid,size=`;
    const mount = service.tmpfs as unknown[];
    return sizeBytes(mount.find((item): item is string => typeof item === "string" && item.startsWith(prefix))?.slice(prefix.length));
  });
  requireCheck(sizes.every((size) => size > 0) && sizes.reduce((sum, size) => sum + size, 0) <= memory);

  const networks = fields(topology.networks, [control, egress]);
  const privateNetwork = fields(networks[control], ["name", "external", "ipam"]);
  const egressNetwork = fields(networks[egress], ["name", "driver", "internal", "ipam"]);
  requireCheck(privateNetwork.name === controlName && privateNetwork.external === true && egressNetwork.name === egressName &&
    (egressNetwork.driver === undefined || egressNetwork.driver === "bridge") &&
    (egressNetwork.internal === undefined || egressNetwork.internal === false) &&
    [privateNetwork, egressNetwork].every(({ ipam }) => ipam === undefined || isDeepStrictEqual(ipam, {})));
  const attachments = fields(service.networks, [control, egress]);
  const privateAttachment = fields(attachments[control] ?? (Object.hasOwn(attachments, control) ? {} : undefined), ["gw_priority"]);
  const egressAttachment = fields(attachments[egress], ["gw_priority"]);
  requireCheck((privateAttachment.gw_priority === undefined || privateAttachment.gw_priority === 0) && positiveInt(egressAttachment.gw_priority) > 0);

  const health = fields(service.healthcheck, ["test", "interval", "timeout", "retries", "start_period", "start_interval", "disable"]);
  requireCheck((health.disable === undefined || health.disable === false) && isDeepStrictEqual(health.test, [
    "CMD", "node", "-e", "fetch('http://127.0.0.1:8080/readyz').then(r=>{if(!r.ok)process.exit(1)})",
  ]));
}

export function validateTfSearchCompute(input: Environment, options: Options = {}) {
  const validated = validateInputs(input);
  const source = options.source ?? readSource();
  assertSafeSource(source);
  const composeSha256 = createHash("sha256").update(source).digest("hex");
  const environment = Object.fromEntries(composeKeys.map((key) => [key, validated.env[key]]));
  let topology: unknown;
  try { topology = (options.render ?? renderCompose)(source, environment); }
  catch { throw new SearchComputeError("search_compute_render_failed"); }
  validateTopology(topology, validated);
  return {
    status: "validated", evidenceLevel: "compose-config-only", activationAllowed: false,
    composeSha256, imageDigest: validated.digest, serviceCount: 1, networkCount: 2,
  } as const;
}

export function runTfSearchComputeCli(args: readonly string[], options: CliOptions = {}): number {
  const stdout = options.stdout ?? ((value: string) => process.stdout.write(value));
  const stderr = options.stderr ?? ((value: string) => process.stderr.write(value));
  try {
    const path = args[1];
    requireCheck(args.length === 2 && args[0] === "--declarations-file" && path?.trim() && !path.startsWith("-"), "invalid_arguments");
    let input: Environment;
    try { input = (options.readEnvironment ?? readTfReviewedAcceptanceEnvironment)(resolve(root, path)); }
    catch { throw new SearchComputeError("search_compute_input_invalid"); }
    stdout(`${JSON.stringify({ ok: true, ...validateTfSearchCompute(input, options) })}\n`);
    return 0;
  } catch (error) {
    stderr(`${JSON.stringify({ ok: false, error: error instanceof SearchComputeError ? error.message : "search_compute_validation_failed" })}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runTfSearchComputeCli(process.argv.slice(2));
}
