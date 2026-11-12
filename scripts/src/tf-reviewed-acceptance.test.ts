import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { tfOnlyReleaseImageEnvironmentNames } from "./release-images.js";
import {
  readTfReviewedAcceptanceEnvironment,
  runTfReviewedAcceptanceCli,
  validateTfReviewedAcceptance,
  validateTfReviewedAcceptanceTopology,
} from "./tf-reviewed-acceptance.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const profile = "apollo-tf-reviewed-acceptance";
const baselineName = "apollo-tf-canary-renewal-v2";
const dataRoot = `/var/lib/${profile}/data`;
const catalogTarget = "/run/tf-reviewed/catalog.json";
const mediaTarget = "/run/tf-reviewed/media";

function environment() {
  const env = readTfReviewedAcceptanceEnvironment(
    resolve(root, "deploy/coolify/canary-renewal.v2.env.example"),
  );
  for (const [variable, service] of Object.entries(
    tfOnlyReleaseImageEnvironmentNames,
  )) {
    env[variable] = `ghcr.io/fixture/${service}@sha256:${"a1".repeat(32)}`;
  }
  return Object.assign(env, {
    TF_REVIEWED_DATA_ROOT: dataRoot,
    TF_REVIEWED_CATALOG_FILE: `${dataRoot}/catalog.json`,
    TF_REVIEWED_MEDIA_DIR: `${dataRoot}/media`,
    TF_CANARY_API_PORT: "29331",
    TF_CANARY_WEB_PORT: "29332",
    TF_CANARY_ADMIN_PORT: "29333",
    TF_SECRET_DIRECTORY: `/var/lib/${profile}/control/secrets`,
    TF_CANARY_SECRET_DIRECTORY: `/var/lib/${profile}/control/secrets`,
    TF_ADMIN_CREDENTIAL_DIRECTORY: `/var/lib/${profile}/control/admin-credentials`,
    TF_CANARY_ADMIN_CREDENTIAL_DIRECTORY: `/var/lib/${profile}/control/admin-credentials`,
  });
}

const inventories = {
  "tf-admin": ["TF_ADMIN_IMAGE", "tf-edge"],
  "tf-api": [
    "TF_API_IMAGE",
    "tf-data",
    "tf-edge",
    "tf-integrations-control",
    "tf-search-control",
    "tf-download-queue",
    "tf-download-control",
  ],
  "tf-baseline": ["TF_API_IMAGE", "tf-data"],
  "tf-download-redis": ["TF_DOWNLOAD_REDIS_IMAGE", "tf-download-queue"],
  "tf-download-worker": [
    "TF_DOWNLOAD_WORKER_IMAGE",
    "tf-download-queue",
    "tf-download-control",
    "tf-download-egress",
  ],
  "tf-integrations": [
    "TF_INTEGRATIONS_IMAGE",
    "tf-integrations-control",
    "tf-integrations-data",
    "tf-integrations-egress",
  ],
  "tf-integrations-migrate": ["TF_INTEGRATIONS_IMAGE", "tf-integrations-data"],
  "tf-integrations-postgres": [
    "TF_INTEGRATIONS_POSTGRES_IMAGE",
    "tf-integrations-data",
  ],
  "tf-migrate": ["TF_API_IMAGE", "tf-data"],
  "tf-postgres": ["TF_POSTGRES_IMAGE", "tf-data"],
  "tf-redis": ["TF_REDIS_IMAGE", "tf-data"],
  "tf-role-bootstrap": ["TF_POSTGRES_IMAGE", "tf-data"],
  "tf-search": ["TF_SEARCH_IMAGE", "tf-search-control", "tf-search-egress"],
  "tf-web": ["TF_WEB_IMAGE", "tf-edge"],
} as const;

type Service = {
  image: string | undefined;
  networks: Record<string, unknown>;
  environment?: Record<string, string | undefined>;
  ports?: Array<Record<string, unknown>>;
  volumes?: Array<Record<string, unknown>>;
  profiles?: string[];
  [key: string]: unknown;
};

function fixture() {
  const env = environment();
  const services: Record<string, Service> = Object.fromEntries(
    Object.entries(inventories).map(([name, [image, ...networks]]) => [
      name,
      {
        image: env[image],
        networks: Object.fromEntries(
          networks.map((network) => [network, null]),
        ),
      },
    ]),
  );
  for (const service of ["tf-baseline", "tf-role-bootstrap"])
    services[service]!.profiles = ["baseline"];
  for (const [name, port, target] of [
    ["tf-api", env.TF_CANARY_API_PORT, 8080],
    ["tf-web", env.TF_CANARY_WEB_PORT, 80],
    ["tf-admin", env.TF_CANARY_ADMIN_PORT, 80],
  ] as const) {
    services[name]!.ports = [
      {
        host_ip: "127.0.0.1",
        published: port,
        target,
        protocol: "tcp",
        mode: "ingress",
      },
    ];
  }
  const api = env.TF_CANARY_API_PUBLIC_ORIGIN;
  services["tf-api"]!.environment = {
    SERVER_URL: api,
    WEB_URL: env.TF_CANARY_PUBLIC_ORIGIN,
    APOLLO_TF_WEB_ORIGIN: env.TF_CANARY_PUBLIC_ORIGIN,
    APOLLO_PLATFORM_API_ORIGIN: env.PLATFORM_CANARY_PUBLIC_ORIGIN,
    APOLLO_PLATFORM_ISSUER: env.PLATFORM_CANARY_PUBLIC_ORIGIN,
    APOLLO_TF_CALLBACK_URL: `${api}/api/auth/callback`,
    APOLLO_TF_BRIDGE_ALLOW_INTERNAL_HTTP: "false",
    APOLLO_TF_RENEWAL_ENABLED: "true",
  };
  services["tf-integrations"]!.environment = {
    TF_INTEGRATIONS_SPOTIFY_CALLBACK_URI: `${api}/api/spotify/callback`,
  };
  const networks: Record<
    string,
    { name: string; internal?: boolean; external?: boolean }
  > = {};
  for (const [, ...networkKeys] of Object.values(inventories)) {
    for (const key of networkKeys)
      networks[key] = {
        name: `${profile}-${key.slice(3)}`,
        ...(!key.endsWith("egress") && key !== "tf-edge"
          ? { internal: true }
          : {}),
      };
  }
  const volumes: Record<string, { name: string; [key: string]: unknown }> =
    Object.fromEntries(
      [
        ["tf-postgres-data", "postgres"],
        ["tf-redis-data", "redis"],
        ["tf-integrations-postgres-data", "integrations-postgres"],
        ["tf-download-redis-data", "download-redis"],
        ["tf-downloads", "downloads"],
      ].map(([key, suffix]) => [key, { name: `${profile}-${suffix}` }]),
    );
  const secrets: Record<string, { name: string; file: string }> = {
    admin_access_htpasswd: {
      name: `${profile}_admin_access_htpasswd`,
      file: `${env.TF_CANARY_ADMIN_CREDENTIAL_DIRECTORY}/admin_access_htpasswd`,
    },
    tf_revoke_keyring: {
      name: `${profile}_tf_revoke_keyring`,
      file: `${env.TF_CANARY_SECRET_DIRECTORY}/tf_revoke_keyring`,
    },
  };
  const reviewed = { name: profile, networks, volumes, secrets, services };
  const baseline = structuredClone(reviewed);
  baseline.name = baselineName;
  for (const value of [
    ...Object.values(baseline.networks),
    ...Object.values(baseline.volumes),
    ...Object.values(baseline.secrets),
  ]) {
    value.name = value.name.replace(profile, baselineName);
  }
  Object.assign(services["tf-api"]!.environment!, {
    TF_RECORDING_CATALOG_FILE: catalogTarget,
    TF_RECORDING_MEDIA_DIR: mediaTarget,
  });
  services["tf-api"]!.volumes = [
    {
      type: "bind",
      source: env.TF_REVIEWED_CATALOG_FILE,
      target: catalogTarget,
      read_only: true,
      bind: { create_host_path: false },
    },
    {
      type: "bind",
      source: env.TF_REVIEWED_MEDIA_DIR,
      target: mediaTarget,
      read_only: true,
      bind: { create_host_path: false },
    },
  ];
  return { env, baseline, reviewed };
}

describe("reviewed acceptance topology", () => {
  it("allows only the reviewed project/resource names and approved media binds", () => {
    const { env, baseline, reviewed } = fixture();
    expect(() =>
      validateTfReviewedAcceptanceTopology(env, baseline, reviewed),
    ).not.toThrow();
  });

  it.each<[string, (data: ReturnType<typeof fixture>) => void]>([
    [
      "extra service",
      ({ reviewed }) => {
        reviewed.services["tf-extra"] = reviewed.services["tf-api"]!;
      },
    ],
    [
      "a profiled privileged service",
      ({ reviewed }) => {
        reviewed.services["tf-baseline"]!.privileged = true;
      },
    ],
    [
      "a build",
      ({ reviewed }) => {
        reviewed.services["tf-web"]!.build = { context: "." };
      },
    ],
    [
      "host networking",
      ({ reviewed }) => {
        reviewed.services["tf-api"]!.network_mode = "host";
      },
    ],
    [
      "an external shared network",
      ({ reviewed }) => {
        reviewed.networks["tf-data"]!.external = true;
      },
    ],
    [
      "a database on edge",
      ({ reviewed }) => {
        reviewed.services["tf-postgres"]!.networks["tf-edge"] = null;
      },
    ],
    [
      "a shared resource name",
      ({ reviewed }) => {
        reviewed.volumes["tf-downloads"]!.name = "apollo-tf-downloads-v1";
      },
    ],
    [
      "a duplicate resource name",
      ({ reviewed }) => {
        reviewed.volumes["tf-downloads"]!.name =
          reviewed.networks["tf-edge"]!.name;
      },
    ],
    [
      "a driver-host bind",
      ({ reviewed }) => {
        reviewed.volumes["tf-downloads"]!.driver_opts = { device: "/srv/host" };
      },
    ],
    [
      "a writable media bind",
      ({ reviewed }) => {
        reviewed.services["tf-api"]!.volumes![1]!.read_only = false;
      },
    ],
    [
      "implicit bind creation",
      ({ reviewed }) => {
        delete reviewed.services["tf-api"]!.volumes![1]!.bind;
      },
    ],
    [
      "host bind on another service",
      ({ reviewed }) => {
        reviewed.services["tf-web"]!.volumes =
          reviewed.services["tf-api"]!.volumes;
      },
    ],
    [
      "a recording setting on another service",
      ({ reviewed }) => {
        reviewed.services["tf-web"]!.environment = {
          TF_RECORDING_MEDIA_DIR: mediaTarget,
        };
      },
    ],
    [
      "a public listen address",
      ({ reviewed }) => {
        reviewed.services["tf-api"]!.ports![0]!.host_ip = "0.0.0.0";
      },
    ],
    [
      "a fourth exposed port",
      ({ reviewed }) => {
        reviewed.services["tf-search"]!.ports = [
          { published: "29334", target: 8080 },
        ];
      },
    ],
    [
      "duplicate configured ports",
      ({ reviewed, env }) => {
        env.TF_CANARY_WEB_PORT = env.TF_CANARY_API_PORT;
        reviewed.services["tf-web"]!.ports![0]!.published =
          env.TF_CANARY_API_PORT;
      },
    ],
    [
      "a zero image digest",
      ({ reviewed, env }) => {
        env.TF_WEB_IMAGE = `ghcr.io/fixture/tf-web@sha256:${"0".repeat(64)}`;
        reviewed.services["tf-web"]!.image = env.TF_WEB_IMAGE;
      },
    ],
    [
      "a mismatched OAuth callback",
      ({ reviewed }) => {
        reviewed.services[
          "tf-integrations"
        ]!.environment!.TF_INTEGRATIONS_SPOTIFY_CALLBACK_URI =
          "https://other.example.org/api/spotify/callback";
      },
    ],
    [
      "a local HTTPS Platform origin",
      ({ env, reviewed, baseline }) => {
        env.PLATFORM_CANARY_PUBLIC_ORIGIN = "https://127.0.0.1";
        for (const compose of [reviewed, baseline]) {
          compose.services["tf-api"]!.environment!.APOLLO_PLATFORM_API_ORIGIN =
            env.PLATFORM_CANARY_PUBLIC_ORIGIN;
          compose.services["tf-api"]!.environment!.APOLLO_PLATFORM_ISSUER =
            env.PLATFORM_CANARY_PUBLIC_ORIGIN;
        }
      },
    ],
    [
      "an unrelated runtime command change",
      ({ reviewed }) => {
        reviewed.services["tf-web"]!.command = ["other"];
      },
    ],
  ])("rejects %s", (_label, change) => {
    const data = fixture();
    change(data);
    expect(() =>
      validateTfReviewedAcceptanceTopology(
        data.env,
        data.baseline,
        data.reviewed,
      ),
    ).toThrow();
  });

  it.each([
    ["shared root", "/var/lib", "/var/lib/catalog.json", "/var/lib/media"],
    ["filesystem root", "/", "/catalog.json", "/media"],
    [
      "shared deployment root",
      "/var/lib/apollo-tf-canary/renewal-v2",
      "/var/lib/apollo-tf-canary/renewal-v2/catalog.json",
      "/var/lib/apollo-tf-canary/renewal-v2/media",
    ],
    [
      "reviewed name under shared state",
      `/var/lib/apollo-tf-canary/${profile}`,
      `/var/lib/apollo-tf-canary/${profile}/catalog.json`,
      `/var/lib/apollo-tf-canary/${profile}/media`,
    ],
    [
      "dot segment",
      dataRoot,
      `${dataRoot}/files/../catalog.json`,
      `${dataRoot}/media`,
    ],
    ["Windows path", dataRoot, "C:/tf/catalog.json", `${dataRoot}/media`],
    [
      "sibling prefix",
      dataRoot,
      `${dataRoot}-other/catalog.json`,
      `${dataRoot}/media`,
    ],
    ["root itself", dataRoot, `${dataRoot}/catalog.json`, dataRoot],
    [
      "ancestor overlap",
      dataRoot,
      `${dataRoot}/media/catalog.json`,
      `${dataRoot}/media`,
    ],
  ])(
    "rejects %s even if the mounted sources match the environment",
    (_label, root, catalog, media) => {
      const { env, baseline, reviewed } = fixture();
      Object.assign(env, {
        TF_REVIEWED_DATA_ROOT: root,
        TF_REVIEWED_CATALOG_FILE: catalog,
        TF_REVIEWED_MEDIA_DIR: media,
      });
      reviewed.services["tf-api"]!.volumes![0]!.source = catalog;
      reviewed.services["tf-api"]!.volumes![1]!.source = media;
      expect(() =>
        validateTfReviewedAcceptanceTopology(env, baseline, reviewed),
      ).toThrow("reviewed_data_root_unsafe");
    },
  );

  it("rejects overlap with a resolved secret directory", () => {
    const { env, baseline, reviewed } = fixture();
    env.TF_CANARY_SECRET_DIRECTORY = `${dataRoot}/secrets`;
    env.TF_SECRET_DIRECTORY = env.TF_CANARY_SECRET_DIRECTORY;
    for (const compose of [baseline, reviewed])
      compose.secrets.tf_revoke_keyring!.file = `${dataRoot}/secrets/tf_revoke_keyring`;
    expect(() =>
      validateTfReviewedAcceptanceTopology(env, baseline, reviewed),
    ).toThrow("reviewed_data_root_unsafe");
  });

  it("rejects the frozen canary control paths even when the resolved secrets agree", () => {
    const { env, baseline, reviewed } = fixture();
    const old = readTfReviewedAcceptanceEnvironment(
      resolve(root, "deploy/coolify/canary-renewal.v2.env.example"),
    );
    for (const key of [
      "TF_SECRET_DIRECTORY",
      "TF_CANARY_SECRET_DIRECTORY",
      "TF_ADMIN_CREDENTIAL_DIRECTORY",
      "TF_CANARY_ADMIN_CREDENTIAL_DIRECTORY",
    ])
      env[key] = old[key]!;
    for (const compose of [baseline, reviewed]) {
      compose.secrets.tf_revoke_keyring!.file = `${env.TF_CANARY_SECRET_DIRECTORY}/tf_revoke_keyring`;
      compose.secrets.admin_access_htpasswd!.file = `${env.TF_CANARY_ADMIN_CREDENTIAL_DIRECTORY}/admin_access_htpasswd`;
    }
    expect(() =>
      validateTfReviewedAcceptanceTopology(env, baseline, reviewed),
    ).toThrow("reviewed_control_root_unsafe");
  });
});

describe("reviewed acceptance Compose evidence", () => {
  it("compares the canonical unexpanded profiles before resolving the topology", () => {
    const { env, baseline, reviewed } = fixture();
    const calls: Array<{ files: readonly string[]; interpolate: boolean }> = [];
    const result = validateTfReviewedAcceptance(
      env,
      (files, _environment, interpolate) => {
        calls.push({ files, interpolate });
        if (!interpolate)
          return calls.length === 1
            ? { name: profile, variable: "${REQUIRED:?}" }
            : { variable: "${REQUIRED:?}", name: profile };
        return files.length === 3 ? baseline : reviewed;
      },
    );
    expect(
      calls.map(({ files, interpolate }) => [files.length, interpolate]),
    ).toEqual([
      [4, false],
      [1, false],
      [3, true],
      [4, true],
    ]);
    expect(calls[0]?.files.map((file) => file.split("/").at(-1))).toEqual([
      "apollo-tf.compose.yml",
      "apollo-tf.canary.compose.yml",
      "apollo-tf.canary-renewal.v2.compose.yml",
      "apollo-tf.reviewed-acceptance.compose.yml",
    ]);
    expect(result).toEqual({
      status: "validated",
      evidenceLevel: "compose-config-only",
      activationAllowed: false,
      composeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      serviceCount: 14,
      networkCount: 10,
      volumeCount: 5,
    });
    expect(() =>
      validateTfReviewedAcceptance(env, (files) => ({
        name: profile,
        variable: files.length === 1 ? "${OTHER:?}" : "${REQUIRED:?}",
      })),
    ).toThrow("reviewed_compose_snapshot_drift");
    expect(() =>
      validateTfReviewedAcceptance(
        { ...env, COMPOSE_FILE: "private-leak-canary" },
        () => {
          throw new Error("should not render");
        },
      ),
    ).toThrow("invalid_reviewed_environment");
  });

  it("emits only a compact sanitized failure through the CLI", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const path = resolve(root, "deploy/coolify/canary-renewal.v2.env.example");
    const exit = runTfReviewedAcceptanceCli(
      ["--env-file", path],
      () => {
        throw new Error("private-leak-canary");
      },
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      },
    );
    expect(exit).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      '{"ok":false,"error":"reviewed_compose_render_failed"}\n',
    ]);
  });

  it("renders the real ordered layers and standalone with isolated dummy inputs using config only", () => {
    const result = validateTfReviewedAcceptance(environment());
    expect(result).toMatchObject({
      status: "validated",
      activationAllowed: false,
      serviceCount: 14,
      networkCount: 10,
      volumeCount: 5,
    });
  }, 30_000);
});
