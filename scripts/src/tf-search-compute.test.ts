import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runTfSearchComputeCli, validateTfSearchCompute } from "./tf-search-compute.js";

const source = readFileSync(new URL("../../deploy/coolify/apollo-tf.search-compute.git.compose.yml", import.meta.url));
const env = {
  TF_SEARCH_COMPUTE_IMAGE_DIGEST: "a".repeat(64),
  TF_SEARCH_VERSION: "1.2.3-search",
  TF_SEARCH_DEPLOYED_AT: "2026-11-13T12:00:00Z",
  TF_SEARCH_COMPUTE_SECRET_DIRECTORY: "/var/lib/apollo-tf-search-compute/secrets",
  TF_SEARCH_COMPUTE_HEARTBEAT_API_ORIGIN: "https://api.test",
  TF_SEARCH_ORIGIN: "https://search.private.test",
  TF_SEARCH_COMPUTE_APPROVED_LISTENER_ORIGIN: "https://search.private.test",
  TF_SEARCH_COMPUTE_LISTENER_MODE: "private-https",
  TF_SEARCH_COMPUTE_LISTENER_DESTINATION: "search-destination",
  TF_SEARCH_COMPUTE_LISTENER_NETWORK: "apollo-tf-search-compute-control-v1",
  TF_SEARCH_COMPUTE_LISTENER_UPSTREAM: "http://tf-search:8080",
  TF_SEARCH_COMPUTE_DESTINATION: "search-destination",
  TF_SEARCH_COMPUTE_OWNER: "tf-operator",
  TF_SEARCH_COMPUTE_AVAILABLE_MILLICPUS: "1000",
  TF_SEARCH_COMPUTE_AVAILABLE_MEMORY_MIB: "512",
  TF_SEARCH_COMPUTE_AVAILABLE_PIDS: "128",
};

function rendered() {
  const secrets = ["tf_search_internal_auth_secret", "tf_search_heartbeat_secret"];
  return {
    name: "apollo-tf-search-compute",
    services: {
      "tf-search": {
        image: `ghcr.io/altis13/apollo-tf-search@sha256:${env.TF_SEARCH_COMPUTE_IMAGE_DIGEST}`,
        init: true, restart: "unless-stopped", stop_grace_period: "20s", pids_limit: 128,
        deploy: { replicas: 1, resources: { limits: { cpus: 1, memory: "536870912", pids: 128 } }, placement: {} },
        logging: { driver: "json-file", options: { "max-size": "10m", "max-file": "5" } },
        user: "10001:10001", read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"],
        command: null, entrypoint: null,
        environment: {
          APOLLO_API_VERSION: env.TF_SEARCH_VERSION, APOLLO_DEPLOYED_AT: env.TF_SEARCH_DEPLOYED_AT,
          NODE_ENV: "production", PORT: "8080", TF_SEARCH_HEARTBEAT_ALLOW_INSECURE_HTTP: "false",
          TF_SEARCH_HEARTBEAT_API_ORIGIN: env.TF_SEARCH_COMPUTE_HEARTBEAT_API_ORIGIN,
          TF_SEARCH_HEARTBEAT_SECRET_FILE: "/run/secrets/tf_search_heartbeat_secret",
          TF_SEARCH_INTERNAL_AUTH_SECRET_FILE: "/run/secrets/tf_search_internal_auth_secret",
        },
        secrets: secrets.map((name) => ({ source: name, target: name, uid: "10001", gid: "10001", mode: "0400" })),
        tmpfs: ["/tmp:rw,noexec,nosuid,size=32m", "/tmp/yt-dlp:rw,noexec,nosuid,size=64m"],
        networks: { "tf-search-compute-control": {}, "tf-search-compute-egress": { gw_priority: 1 } },
        healthcheck: {
          test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/readyz').then(r=>{if(!r.ok)process.exit(1)})"],
          interval: "5s", timeout: "3s", retries: 20, start_period: "5s",
        },
      },
    },
    secrets: Object.fromEntries(secrets.map((name) => [name, {
      name: `apollo-tf-search-compute_${name}`, file: `${env.TF_SEARCH_COMPUTE_SECRET_DIRECTORY}/${name}`,
    }])),
    networks: {
      "tf-search-compute-control": { name: "apollo-tf-search-compute-control-v1", external: true, ipam: {} },
      "tf-search-compute-egress": { name: "apollo-tf-search-compute-egress-v1", ipam: {} },
    },
  };
}

describe("TF standalone search compute preflight", () => {
  it("reports the actual tracked source digest and static evidence only", () => {
    const render = vi.fn(rendered);
    const result = validateTfSearchCompute(env, { render });
    expect(result).toEqual({
      status: "validated", evidenceLevel: "compose-config-only", activationAllowed: false,
      composeSha256: createHash("sha256").update(source).digest("hex"),
      imageDigest: `sha256:${env.TF_SEARCH_COMPUTE_IMAGE_DIGEST}`, serviceCount: 1, networkCount: 2,
    });
    expect(render).toHaveBeenCalledExactlyOnceWith(source, {
      TF_SEARCH_COMPUTE_IMAGE_DIGEST: env.TF_SEARCH_COMPUTE_IMAGE_DIGEST,
      TF_SEARCH_VERSION: env.TF_SEARCH_VERSION,
      TF_SEARCH_DEPLOYED_AT: env.TF_SEARCH_DEPLOYED_AT,
      TF_SEARCH_COMPUTE_SECRET_DIRECTORY: env.TF_SEARCH_COMPUTE_SECRET_DIRECTORY,
      TF_SEARCH_COMPUTE_HEARTBEAT_API_ORIGIN: env.TF_SEARCH_COMPUTE_HEARTBEAT_API_ORIGIN,
    });
  });

  it.each(["TF_SEARCH_COMPUTE_OWNER", "TF_SEARCH_COMPUTE_LISTENER_MODE", "TF_SEARCH_COMPUTE_AVAILABLE_MEMORY_MIB"])
    ("rejects a missing declaration before rendering: %s", (key) => {
    const input: Record<string, string> = { ...env };
    delete input[key];
    const render = vi.fn(rendered);
    expect(() => validateTfSearchCompute(input, { render })).toThrow("search_compute_input_invalid");
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    { TF_SEARCH_ORIGIN: "http://search.private.test", TF_SEARCH_COMPUTE_APPROVED_LISTENER_ORIGIN: "http://search.private.test" },
    { TF_SEARCH_ORIGIN: "https://search.private.test:8443" },
    { TF_SEARCH_COMPUTE_LISTENER_NETWORK: "coolify" },
    { TF_SEARCH_COMPUTE_LISTENER_UPSTREAM: "http://tf-search:8081" },
    { TF_SEARCH_COMPUTE_LISTENER_DESTINATION: "different-destination" },
    { TF_SEARCH_COMPUTE_HEARTBEAT_API_ORIGIN: "https://user:fixture@api.test" },
    { TF_SEARCH_COMPUTE_IMAGE_DIGEST: "0".repeat(64) },
    { TF_SEARCH_COMPUTE_SECRET_DIRECTORY: "/var/lib/docker/apollo-tf-search-compute/secrets" },
    { TF_SEARCH_INTERNAL_AUTH_SECRET: "must-not-be-accepted" },
  ])("rejects unsafe or unexpected input %# before rendering", (change) => {
    const render = vi.fn(rendered);
    const input: Record<string, string> = { ...env };
    Object.assign(input, change);
    expect(() => validateTfSearchCompute(input, { render })).toThrow("search_compute_input_invalid");
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    { ports: [{ target: 8080, published: "8080", host_ip: "127.0.0.1" }] },
    { volumes: [{ type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" }] },
    { labels: { "traefik.enable": "true" } },
    { privileged: true },
    { environment: { PORT: "9090" } },
    { deploy: { replicas: 2, resources: { limits: { cpus: 1, memory: "536870912", pids: 128 } } } },
    { secrets: [{ source: "tf_search_internal_auth_secret", target: "other", uid: "0", gid: "0", mode: "0444" }] },
    { image: `ghcr.io/altis13/apollo-tf-search@sha256:${"b".repeat(64)}` },
    { image: "ghcr.io/altis13/apollo-tf-search:latest" },
  ])("rejects rendered service drift %#", (change) => {
    const render = () => {
      const model = rendered();
      Object.assign(model.services["tf-search"], change);
      return model;
    };
    expect(() => validateTfSearchCompute(env, { render })).toThrow("search_compute_topology_invalid");
  });

  it.each([
    { services: { ...rendered().services, listener: { image: "fixture-proxy" } } },
    { volumes: { cache: {} } },
    { networks: { ...rendered().networks, coolify: { external: true } } },
    { secrets: { ...rendered().secrets, tf_search_heartbeat_secret: { file: "/etc/shadow" } } },
  ])("rejects unexpected top-level topology %#", (change) => {
    expect(() => validateTfSearchCompute(env, { render: () => ({ ...rendered(), ...change }) }))
      .toThrow("search_compute_topology_invalid");
  });

  it("rejects a destination with less CPU than the rendered limit", () => {
    expect(() => validateTfSearchCompute({ ...env, TF_SEARCH_COMPUTE_AVAILABLE_MILLICPUS: "999" }, { render: rendered }))
      .toThrow("search_compute_topology_invalid");
  });

  it.each([
    ["includes", `${source.toString()}\ninclude: [private.yml]\n`],
    ["extends", source.toString().replace("    init: true", "    extends: {file: private.yml, service: tf-search}\n    init: true")],
    ["file-backed labels", source.toString().replace("    init: true", "    'label_file': private.env\n    init: true")],
    ["escaped environment file key", source.toString().replace("    init: true", '    "env_\\x66ile": private.env\n    init: true')],
    ["hidden YAML line separator", `${source.toString()}\n# harmless\u2028include: [private.yml]\n`],
  ])("refuses %s before Compose can expand a file", (_description, changed) => {
    const render = vi.fn(rendered);
    expect(() => validateTfSearchCompute(env, { render, source: Buffer.from(changed) })).toThrow("search_compute_source_unsafe");
    expect(render).not.toHaveBeenCalled();
  });

  it("allows reviewed resource tuning and reports the digest of those actual source bytes", () => {
    const tuned = Buffer.from(source.toString().replace('cpus: "1.0"', 'cpus: "0.75"').replace("memory: 512M", "memory: 384M").replace("max-size: 10m", "max-size: 8m"));
    const render = () => {
      const model = rendered();
      const service = model.services["tf-search"];
      service.deploy.resources.limits.cpus = 0.75;
      service.deploy.resources.limits.memory = "402653184";
      service.logging.options["max-size"] = "8m";
      return model;
    };
    expect(validateTfSearchCompute(env, { render, source: tuned }).composeSha256).toBe(createHash("sha256").update(tuned).digest("hex"));
  });

  it("does not read launch inputs or disclose supplied values or renderer diagnostics", () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const readEnvironment = vi.fn(() => env);
    const render = vi.fn(() => { throw new Error("must-not-leak-renderer-output"); });
    expect(runTfSearchComputeCli(["--declarations-file", "fixture", "--launch"], { readEnvironment, render, stdout, stderr })).toBe(1);
    expect(readEnvironment).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(runTfSearchComputeCli(["--declarations-file", "fixture"], { readEnvironment, render, stdout, stderr })).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls).toEqual([
      ['{"ok":false,"error":"invalid_arguments"}\n'],
      ['{"ok":false,"error":"search_compute_render_failed"}\n'],
    ]);
  });

  const composeAvailable = spawnSync("docker", ["compose", "version", "--short"], { timeout: 5_000, windowsHide: true }).status === 0;
  it.runIf(composeAvailable)("validates real local docker compose config with fixture inputs and redacted CLI output", () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    expect(runTfSearchComputeCli(["--declarations-file", "fixture"], { readEnvironment: () => env, stdout, stderr })).toBe(0);
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledOnce();
    expect(JSON.parse(stdout.mock.calls[0]![0])).toEqual({
      ok: true, status: "validated", evidenceLevel: "compose-config-only", activationAllowed: false,
      composeSha256: createHash("sha256").update(source).digest("hex"),
      imageDigest: `sha256:${env.TF_SEARCH_COMPUTE_IMAGE_DIGEST}`, serviceCount: 1, networkCount: 2,
    });
  });
});
