import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawnSync: vi.fn(original.spawnSync) };
});

import type { ComposeDocument, ComposeService } from "./coolify-release.js";
import {
  pinnedRedisDigest,
  tfOnlyReleaseImageCatalog,
  type TfOnlyReleaseArtifact,
} from "./release-images.js";
import {
  runTfCanaryComposeBindingCli,
  validateTfCanaryComposeBinding,
  validateTfCanaryComposeFromFiles,
} from "./tf-canary-compose-binding.js";

const apiOrigin = "https://api.tf.canary.apollot.ru";
const webOrigin = "https://tf.canary.apollot.ru";
const platformOrigin = "https://api.canary.apollot.ru";
const sourceCommit = "a".repeat(40);
const internalNetworks = new Set([
  "data",
  "integrations-control",
  "integrations-data",
  "search-control",
  "download-queue",
  "download-control",
]);

const serviceImages = {
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
} as const;

function artifact(): TfOnlyReleaseArtifact {
  return {
    artifactSet: "tf-only",
    formatVersion: 1,
    images: tfOnlyReleaseImageCatalog
      .map((entry, index) => {
        const imageDigest =
          entry.kind === "external"
            ? pinnedRedisDigest
            : `sha256:${(index + 1).toString(16).repeat(64)}`;
        return {
          imageDigest,
          imageReference: `${entry.repository}@${imageDigest}`,
          name: entry.name,
          repository: entry.repository,
        };
      })
      .sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      ),
    sourceCommit,
    tfWebApiOrigin: apiOrigin,
  };
}

function references(release: TfOnlyReleaseArtifact): Record<string, string> {
  return Object.fromEntries(
    release.images.map(({ name, imageReference }) => [name, imageReference]),
  );
}

function environment(release: TfOnlyReleaseArtifact): Record<string, string> {
  const image = references(release);
  return {
    RELEASE_SOURCE_COMMIT: sourceCommit,
    TF_SUCCESSOR_WS_ENABLED: "false",
    TF_WEB_API_ORIGIN: apiOrigin,
    TF_CANARY_API_PUBLIC_ORIGIN: apiOrigin,
    TF_CANARY_PUBLIC_ORIGIN: webOrigin,
    TF_CANARY_API_PORT: "19201",
    TF_CANARY_WEB_PORT: "19202",
    TF_CANARY_ADMIN_PORT: "19203",
    TF_CANARY_SECRET_DIRECTORY: "/var/lib/apollo-tf-canary/secrets",
    TF_CANARY_ADMIN_CREDENTIAL_DIRECTORY:
      "/var/lib/apollo-tf-canary/admin-credentials",
    PLATFORM_CANARY_PUBLIC_ORIGIN: platformOrigin,
    PLATFORM_PUBLIC_ORIGIN: platformOrigin,
    TF_PUBLIC_ORIGIN: webOrigin,
    TF_API_PUBLIC_ORIGIN: apiOrigin,
    TF_API_PORT: "19201",
    TF_WEB_PORT: "19202",
    TF_ADMIN_PORT: "19203",
    TF_SECRET_DIRECTORY: "/var/lib/apollo-tf-canary/secrets",
    TF_ADMIN_CREDENTIAL_DIRECTORY:
      "/var/lib/apollo-tf-canary/admin-credentials",
    TF_API_VERSION: "0.0.0-canary",
    TF_DEPLOYED_AT: "2026-09-27T00:00:00Z",
    TF_SEARCH_VERSION: "0.0.0-canary",
    TF_SEARCH_DEPLOYED_AT: "2026-09-27T00:00:00Z",
    TF_INTEGRATIONS_VERSION: "0.0.0-canary",
    TF_INTEGRATIONS_DEPLOYED_AT: "2026-09-27T00:00:00Z",
    TF_DOWNLOAD_VERSION: "0.0.0-canary",
    TF_DOWNLOAD_DEPLOYED_AT: "2026-09-27T00:00:00Z",
    TF_POSTGRES_IMAGE: image["tf-postgres"]!,
    TF_REDIS_IMAGE: image.redis!,
    TF_API_IMAGE: image["tf-api"]!,
    TF_WEB_IMAGE: image["tf-web"]!,
    TF_ADMIN_IMAGE: image["tf-admin"]!,
    TF_SEARCH_IMAGE: image["tf-search"]!,
    TF_INTEGRATIONS_POSTGRES_IMAGE: image["tf-integrations-postgres"]!,
    TF_INTEGRATIONS_IMAGE: image["tf-integrations"]!,
    TF_DOWNLOAD_REDIS_IMAGE: image["tf-download-redis"]!,
    TF_DOWNLOAD_WORKER_IMAGE: image["tf-download-worker"]!,
  };
}

function compose(release: TfOnlyReleaseArtifact): ComposeDocument {
  const image = references(release);
  const services: Record<string, ComposeService> = Object.fromEntries(
    Object.entries(serviceImages).map(([service, imageName]) => [
      service,
      { image: image[imageName] },
    ]),
  );
  services["tf-api"]!.environment = {
    APOLLO_PLATFORM_API_ORIGIN: platformOrigin,
    APOLLO_PLATFORM_ISSUER: platformOrigin,
    APOLLO_TF_BRIDGE_ALLOW_INTERNAL_HTTP: "false",
    APOLLO_TF_RENEWAL_ENABLED: "false",
    APOLLO_TF_CALLBACK_URL: `${apiOrigin}/api/auth/callback`,
    APOLLO_TF_WEB_ORIGIN: webOrigin,
    SERVER_URL: apiOrigin,
    WEB_URL: webOrigin,
  };
  services["tf-integrations"]!.environment = {
    TF_INTEGRATIONS_SPOTIFY_CALLBACK_URI: `${apiOrigin}/api/spotify/callback`,
  };
  for (const [name, published, target] of [
    ["tf-api", "19201", 8080],
    ["tf-web", "19202", 80],
    ["tf-admin", "19203", 80],
  ] as const) {
    services[name]!.ports = [
      { host_ip: "127.0.0.1", published, target, protocol: "tcp" },
    ];
  }
  return {
    name: "apollo-tf-canary",
    services,
    secrets: {
      admin_access_htpasswd: {
        file: "/var/lib/apollo-tf-canary/admin-credentials/admin_access_htpasswd",
      },
      tf_client_secret: {
        file: "/var/lib/apollo-tf-canary/secrets/tf_client_secret",
      },
    },
    networks: Object.fromEntries(
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
      ].map((name) => [
        `tf-${name}`,
        {
          name: `apollo-tf-canary-${name}-v1`,
          internal: internalNetworks.has(name),
        },
      ]),
    ),
    volumes: Object.fromEntries(
      [
        ["tf-postgres-data", "postgres"],
        ["tf-redis-data", "redis"],
        ["tf-integrations-postgres-data", "integrations-postgres"],
        ["tf-download-redis-data", "download-redis"],
        ["tf-downloads", "downloads"],
      ].map(([key, name]) => [key, { name: `apollo-tf-canary-${name}-v1` }]),
    ),
  };
}

async function releaseFiles(release: TfOnlyReleaseArtifact): Promise<{
  environmentPath: string;
  manifestPath: string;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "apollo-tf-canary-binding-"));
  const releaseId = "v0.1.0-canary.1";
  const directory = join(root, releaseId);
  await mkdir(directory);
  const manifestPath = join(directory, "apollo-tf-release-manifest.json");
  const releaseEnvironment = environment(release);
  const imageOrder = [
    "TF_POSTGRES_IMAGE",
    "TF_REDIS_IMAGE",
    "TF_API_IMAGE",
    "TF_WEB_IMAGE",
    "TF_ADMIN_IMAGE",
    "TF_SEARCH_IMAGE",
    "TF_INTEGRATIONS_POSTGRES_IMAGE",
    "TF_INTEGRATIONS_IMAGE",
    "TF_DOWNLOAD_REDIS_IMAGE",
    "TF_DOWNLOAD_WORKER_IMAGE",
  ];
  const manifest = `${JSON.stringify(release, null, 2)}\n`;
  const imageEnvironment = `${[
    `RELEASE_SOURCE_COMMIT=${sourceCommit}`,
    "TF_SUCCESSOR_WS_ENABLED=false",
    `TF_WEB_API_ORIGIN=${apiOrigin}`,
    ...imageOrder.map((name) => `${name}=${releaseEnvironment[name]}`),
  ].join("\n")}\n`;
  const digest = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  await writeFile(manifestPath, manifest);
  await writeFile(join(directory, "tf-release-images.env"), imageEnvironment);
  await writeFile(
    join(directory, "apollo-tf-release-complete.json"),
    JSON.stringify({
      artifactSet: "tf-only",
      environmentSha256: digest(imageEnvironment),
      formatVersion: 1,
      manifestSha256: digest(manifest),
      releaseId,
      sourceCommit,
    }),
  );
  const environmentPath = join(root, "canary.env");
  await writeFile(
    environmentPath,
    `${Object.entries(releaseEnvironment)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
  );
  return { environmentPath, manifestPath, root };
}

describe("TF-only canary Compose binding", () => {
  it("validates the actual Git-backed and source Compose renders through the CLI", async () => {
    const paths = await releaseFiles(artifact());
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const status = runTfCanaryComposeBindingCli(
        [
          "--env-file",
          paths.environmentPath,
          "--release-manifest",
          paths.manifestPath,
        ],
        undefined,
        {
          stdout: (value) => stdout.push(value),
          stderr: (value) => stderr.push(value),
        },
      );
      expect({ status, stderr }).toEqual({ status: 0, stderr: [] });
      expect(JSON.parse(stdout[0]!)).toEqual({
        ok: true,
        apiOrigin,
        imageCount: 10,
        serviceCount: 12,
      });
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  it("reports canary_compose_snapshot_drift when the source render diverges", async () => {
    const real =
      await vi.importActual<typeof import("node:child_process")>(
        "node:child_process",
      );
    const paths = await releaseFiles(artifact());
    const stdout: string[] = [];
    const stderr: string[] = [];
    const docker = vi.mocked(spawnSync);
    docker.mockImplementation((command, args, options) => {
      const result = real.spawnSync(command, args, options);
      if (args?.some((arg) => arg.endsWith("apollo-tf.canary.compose.yml"))) {
        const changed = JSON.parse(result.stdout as string) as Record<
          string,
          unknown
        >;
        changed.name = "apollo-tf-canary-drift";
        return { ...result, stdout: JSON.stringify(changed) };
      }
      return result;
    });
    try {
      const status = runTfCanaryComposeBindingCli(
        [
          "--env-file",
          paths.environmentPath,
          "--release-manifest",
          paths.manifestPath,
        ],
        undefined,
        {
          stdout: (value) => stdout.push(value),
          stderr: (value) => stderr.push(value),
        },
      );
      expect(status).toBe(1);
      expect(stdout).toEqual([]);
      expect(JSON.parse(stderr[0]!)).toEqual({
        ok: false,
        error: "canary_compose_snapshot_drift",
      });
    } finally {
      docker.mockReset();
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  it("exposes a read-only CLI result for verified evidence", async () => {
    const release = artifact();
    const paths = await releaseFiles(release);
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const status = runTfCanaryComposeBindingCli(
        [
          "--env-file",
          paths.environmentPath,
          "--release-manifest",
          paths.manifestPath,
        ],
        () => compose(release),
        {
          stdout: (value) => stdout.push(value),
          stderr: (value) => stderr.push(value),
        },
      );
      expect(status).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout[0]!)).toEqual({
        ok: true,
        apiOrigin,
        imageCount: 10,
        serviceCount: 12,
      });
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  it("rejects incomplete CLI arguments without exposing paths", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const status = runTfCanaryComposeBindingCli(
      ["--env-file", "private.env"],
      () => {
        throw new Error("renderer should not run");
      },
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      },
    );
    expect(status).toBe(1);
    expect(stdout).toEqual([]);
    expect(JSON.parse(stderr[0]!)).toEqual({
      ok: false,
      error: "invalid_arguments",
    });
  });

  it("uses completed TF-only evidence before validating rendered Compose", async () => {
    const release = artifact();
    const paths = await releaseFiles(release);
    try {
      expect(
        validateTfCanaryComposeFromFiles(
          paths.manifestPath,
          paths.environmentPath,
          () => compose(release),
        ),
      ).toEqual({ apiOrigin, imageCount: 10, serviceCount: 12 });

      await writeFile(paths.manifestPath, "{}\n");
      expect(() =>
        validateTfCanaryComposeFromFiles(
          paths.manifestPath,
          paths.environmentPath,
          () => compose(release),
        ),
      ).toThrow("invalid_release_manifest");
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  it("accepts the exact canary origin and image mapping", () => {
    const release = artifact();
    expect(
      validateTfCanaryComposeBinding(
        release,
        environment(release),
        compose(release),
      ),
    ).toEqual({ apiOrigin, imageCount: 10, serviceCount: 12 });
  });

  it.each([
    ["Platform", "https://api.other.canary.apollot.ru"],
    ["TF web", "https://tf.other.canary.apollot.ru"],
    ["TF API", "https://api.tf.other.canary.apollot.ru"],
  ] as const)(
    "rejects a coherent but unapproved %s origin",
    (target, alternate) => {
      const release = artifact();
      const env = environment(release);
      const rendered = compose(release);
      if (target === "Platform") {
        env.PLATFORM_CANARY_PUBLIC_ORIGIN = alternate;
        rendered.services["tf-api"]!.environment!.APOLLO_PLATFORM_API_ORIGIN =
          alternate;
        rendered.services["tf-api"]!.environment!.APOLLO_PLATFORM_ISSUER =
          alternate;
      } else if (target === "TF web") {
        env.TF_CANARY_PUBLIC_ORIGIN = alternate;
        rendered.services["tf-api"]!.environment!.APOLLO_TF_WEB_ORIGIN =
          alternate;
        rendered.services["tf-api"]!.environment!.WEB_URL = alternate;
      } else {
        release.tfWebApiOrigin = alternate;
        env.TF_WEB_API_ORIGIN = alternate;
        env.TF_CANARY_API_PUBLIC_ORIGIN = alternate;
        rendered.services["tf-api"]!.environment!.SERVER_URL = alternate;
        rendered.services["tf-api"]!.environment!.APOLLO_TF_CALLBACK_URL =
          `${alternate}/api/auth/callback`;
        rendered.services[
          "tf-integrations"
        ]!.environment!.TF_INTEGRATIONS_SPOTIFY_CALLBACK_URI =
          `${alternate}/api/spotify/callback`;
      }
      expect(() =>
        validateTfCanaryComposeBinding(release, env, rendered),
      ).toThrow("canary_origin_mismatch");
    },
  );

  it.each([
    ["TF API", "TF_CANARY_API_PORT", "tf-api", "19301"],
    ["TF web", "TF_CANARY_WEB_PORT", "tf-web", "19302"],
    ["TF admin", "TF_CANARY_ADMIN_PORT", "tf-admin", "19303"],
  ] as const)(
    "rejects a coherent but unapproved %s port",
    (_target, environmentName, serviceName, alternate) => {
      const release = artifact();
      const env = environment(release);
      const rendered = compose(release);
      env[environmentName] = alternate;
      rendered.services[serviceName]!.ports![0]!.published = alternate;
      expect(() =>
        validateTfCanaryComposeBinding(release, env, rendered),
      ).toThrow("canary_port_mismatch");
    },
  );

  it.each(["TF_WEB_API_ORIGIN", "TF_CANARY_API_PUBLIC_ORIGIN"])(
    "rejects a %s value that differs from the manifest",
    (name) => {
      const release = artifact();
      const env = environment(release);
      env[name] = "https://api.canary.other.apollot.ru";
      expect(() =>
        validateTfCanaryComposeBinding(release, env, compose(release)),
      ).toThrow("canary_origin_mismatch");
    },
  );

  it("rejects a canary API origin changed only in the rendered service", () => {
    const release = artifact();
    const rendered = compose(release);
    rendered.services["tf-api"]!.environment!.SERVER_URL =
      "https://api.canary.other.apollot.ru";
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), rendered),
    ).toThrow("canary_origin_mismatch");
  });

  it("rejects a production Platform issuer in the rendered TF API", () => {
    const release = artifact();
    const rendered = compose(release);
    rendered.services["tf-api"]!.environment!.APOLLO_PLATFORM_ISSUER =
      "https://api.apollot.ru";
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), rendered),
    ).toThrow("canary_origin_mismatch");
  });

  it("rejects a production secret file substituted into rendered canary Compose", () => {
    const release = artifact();
    const rendered = compose(release);
    rendered.secrets!.tf_client_secret!.file =
      "/var/lib/apollo-tf/secrets/tf_client_secret";
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), rendered),
    ).toThrow("canary_resource_isolation_failed");
  });

  it("rejects a host bind mount substituted into a canary service", () => {
    const release = artifact();
    const rendered = compose(release);
    rendered.services["tf-api"]!.volumes = [
      {
        type: "bind",
        source: "/var/lib/apollo-tf/secrets",
        target: "/run/secrets",
      },
    ];
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), rendered),
    ).toThrow("canary_resource_isolation_failed");
  });

  it("rejects a digest-pinned image changed only in the environment", () => {
    const release = artifact();
    const env = environment(release);
    env.TF_WEB_IMAGE = `ghcr.io/altis13/apollo-tf-web@sha256:${"f".repeat(64)}`;
    expect(() =>
      validateTfCanaryComposeBinding(release, env, compose(release)),
    ).toThrow("canary_image_environment_mismatch");
  });

  it("rejects a service using another valid release image", () => {
    const release = artifact();
    const rendered = compose(release);
    rendered.services["tf-migrate"]!.image = references(release)["tf-postgres"];
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), rendered),
    ).toThrow("canary_service_image_mismatch");
  });

  it("rejects unexpected services and build directives", () => {
    const release = artifact();
    const extra = compose(release);
    extra.services["unexpected"] = { image: references(release)["tf-web"] };
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), extra),
    ).toThrow("canary_unexpected_service");

    const build = compose(release);
    build.services["tf-web"]!.build = { context: "." };
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), build),
    ).toThrow("canary_build_forbidden");
  });

  it("rejects a production bridge in the rendered canary project", () => {
    const release = artifact();
    const rendered = compose(release);
    rendered.networks!["platform-bridge"] = {
      external: true,
      name: "apollo-platform-bridge-v1",
    };
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), rendered),
    ).toThrow("canary_resource_isolation_failed");
  });

  it("rejects an internal TF network made externally routable", () => {
    const release = artifact();
    const rendered = compose(release);
    rendered.networks!["tf-data"]!.internal = false;
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), rendered),
    ).toThrow("canary_resource_isolation_failed");
  });

  it("rejects host networking on a canary service", () => {
    const release = artifact();
    const rendered = compose(release);
    rendered.services["tf-api"]!.network_mode = "host";
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), rendered),
    ).toThrow("canary_resource_isolation_failed");
  });

  it("rejects a public or wrong port in the rendered canary project", () => {
    const release = artifact();
    const publicPort = compose(release);
    publicPort.services["tf-web"]!.ports![0]!.host_ip = "0.0.0.0";
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), publicPort),
    ).toThrow("canary_port_mismatch");

    const wrongPort = compose(release);
    wrongPort.services["tf-api"]!.ports![0]!.published = "18201";
    expect(() =>
      validateTfCanaryComposeBinding(release, environment(release), wrongPort),
    ).toThrow("canary_port_mismatch");
  });
});
