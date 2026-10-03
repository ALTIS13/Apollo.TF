import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
vi.mock("node:child_process", async (original) => {
  const module = await original<typeof import("node:child_process")>();
  return { ...module, spawnSync: vi.fn(module.spawnSync) };
});
import type { ComposeDocument, ComposeSecretMount } from "./coolify-release.js";
import { isolatedComposeEnvironment } from "./coolify-release.js";
import {
  pinnedRedisDigest,
  tfOnlyReleaseImageCatalog,
  tfOnlyReleaseImageEnvironmentNames,
  type TfOnlyReleaseArtifact,
} from "./release-images.js";
import { validateTfCanaryComposeBinding } from "./tf-canary-compose-binding.js";
import {
  parseTfCanaryRenewalV2Profile,
  runTfCanaryRenewalV2Cli,
  validateTfCanaryRenewalV2Binding,
} from "./tf-canary-renewal-v2.js";

const root = resolve(import.meta.dirname, "../..");
const apiOrigin = "https://api.tf.canary.apollot.ru";
const sourceCommit = "a".repeat(40);
const secretRoot = "/var/lib/apollo-tf-canary/renewal-v2/secrets";
const adminRoot = "/var/lib/apollo-tf-canary/renewal-v2/admin-credentials";
const profile = {
  schemaVersion: 2,
  profile: "apollo-tf-canary-renewal.v2",
  clientId: "apollo-tf-api",
  audience: "apollo-tf",
  revokeKeyring: {
    secretName: "tf_revoke_keyring",
    mountPath: "/run/secrets/tf_revoke_keyring",
    purpose: "apollo-tf-revoke-only",
    ownerPolicy: "runtime-uid",
    mode: "0400",
    allowSymlink: false,
  },
};
const artifact: TfOnlyReleaseArtifact = {
  artifactSet: "tf-only",
  formatVersion: 1,
  sourceCommit,
  tfWebApiOrigin: apiOrigin,
  images: tfOnlyReleaseImageCatalog
    .map((entry, index) => {
      const imageDigest =
        entry.kind === "external"
          ? pinnedRedisDigest
          : `sha256:${(index + 1).toString(16).repeat(64)}`;
      return {
        name: entry.name,
        repository: entry.repository,
        imageDigest,
        imageReference: `${entry.repository}@${imageDigest}`,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
};
const environment: Record<string, string> = Object.fromEntries(
  readFileSync(join(root, "deploy/coolify/canary.env.example"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]),
);
Object.assign(environment, {
  RELEASE_SOURCE_COMMIT: sourceCommit,
  TF_SUCCESSOR_WS_ENABLED: "false",
  TF_WEB_API_ORIGIN: apiOrigin,
  PLATFORM_PUBLIC_ORIGIN: "https://api.canary.apollot.ru",
  PLATFORM_CANARY_PUBLIC_ORIGIN: "https://api.canary.apollot.ru",
  TF_API_PUBLIC_ORIGIN: apiOrigin,
  TF_CANARY_API_PUBLIC_ORIGIN: apiOrigin,
  TF_PUBLIC_ORIGIN: "https://tf.canary.apollot.ru",
  TF_CANARY_PUBLIC_ORIGIN: "https://tf.canary.apollot.ru",
  TF_SECRET_DIRECTORY: secretRoot,
  TF_CANARY_SECRET_DIRECTORY: secretRoot,
  TF_ADMIN_CREDENTIAL_DIRECTORY: adminRoot,
  TF_CANARY_ADMIN_CREDENTIAL_DIRECTORY: adminRoot,
  TF_RENEWAL_ENABLED: "true",
});

function releaseFiles() {
  const parent = mkdtempSync(join(temporary, "evidence-"));
  const directory = join(parent, "v0.1.0-canary.renewal-v2");
  mkdirSync(directory);
  const manifestPath = join(directory, "apollo-tf-release-manifest.json");
  const envPath = join(directory, "renewal.env");
  const profilePath = join(directory, "profile.json");
  const manifest = `${JSON.stringify(artifact, null, 2)}\n`;
  const images = `${[
    `RELEASE_SOURCE_COMMIT=${sourceCommit}`,
    "TF_SUCCESSOR_WS_ENABLED=false",
    `TF_WEB_API_ORIGIN=${apiOrigin}`,
    ...[
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
    ].map((name) => `${name}=${environment[name]}`),
  ].join("\n")}\n`;
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  writeFileSync(manifestPath, manifest);
  writeFileSync(join(directory, "tf-release-images.env"), images);
  writeFileSync(
    join(directory, "apollo-tf-release-complete.json"),
    JSON.stringify({
      artifactSet: "tf-only",
      formatVersion: 1,
      environmentSha256: sha(images),
      manifestSha256: sha(manifest),
      releaseId: directory.split(/[\\/]/).at(-1),
      sourceCommit,
    }),
  );
  writeFileSync(
    envPath,
    Object.entries(environment)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  writeFileSync(profilePath, JSON.stringify(profile));
  return { directory, envPath, profilePath, manifestPath };
}
function cli(
  paths: ReturnType<typeof releaseFiles>,
  render?: Parameters<typeof runTfCanaryRenewalV2Cli>[1],
) {
  const stdout: string[] = [],
    stderr: string[] = [];
  const status = runTfCanaryRenewalV2Cli(
    [
      "--release-manifest",
      paths.manifestPath,
      "--env-file",
      paths.envPath,
      "--profile",
      paths.profilePath,
    ],
    render,
    {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
  );
  return { status, stdout, stderr };
}

describe("TF renewal v2 read-only file admission", () => {
  it("validates actual source and Git renders without admitting activation", () => {
    const paths = releaseFiles();
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--",
        "src/tf-canary-renewal-v2.ts",
        "--release-manifest",
        paths.manifestPath,
        "--env-file",
        paths.envPath,
        "--profile",
        paths.profilePath,
      ],
      {
        cwd: join(root, "scripts"),
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    );
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      imageCount: 10,
      serviceCount: 12,
      activationAllowed: false,
      evidenceLevel: "source-binding-only",
    });
  });

  it.each([
    [
      "duplicate env",
      "invalid_canary_environment",
      (paths: ReturnType<typeof releaseFiles>) => {
        writeFileSync(
          paths.envPath,
          `${readFileSync(paths.envPath, "utf8")}\nTF_RENEWAL_ENABLED=true\n`,
        );
      },
    ],
    [
      "malformed profile",
      "invalid_canary_renewal_profile",
      (paths: ReturnType<typeof releaseFiles>) => {
        writeFileSync(paths.profilePath, "{broken");
      },
    ],
    [
      "untrusted profile",
      "invalid_canary_renewal_profile",
      (paths: ReturnType<typeof releaseFiles>) => {
        writeFileSync(
          paths.profilePath,
          JSON.stringify({ ...profile, signed: true, activationAllowed: true }),
        );
      },
    ],
    [
      "corrupt source evidence",
      "invalid_release_manifest",
      (paths: ReturnType<typeof releaseFiles>) => {
        writeFileSync(
          join(paths.directory, "apollo-tf-release-complete.json"),
          "{}",
        );
      },
    ],
  ] as const)("fails safely on %s", (_name, code, change) => {
    const paths = releaseFiles();
    change(paths);
    const result = cli(paths, () => fixture().compose);
    expect(result).toEqual({
      status: 1,
      stdout: [],
      stderr: [`${JSON.stringify({ ok: false, error: code })}\n`],
    });
  });

  it("rejects source/Git render drift", () => {
    vi.mocked(spawnSync)
      .mockImplementationOnce(
        () =>
          ({ status: 0, stdout: '{"services":{}}' }) as ReturnType<
            typeof spawnSync
          >,
      )
      .mockImplementationOnce(
        () =>
          ({ status: 0, stdout: '{"services":{"changed":{}}}' }) as ReturnType<
            typeof spawnSync
          >,
      );
    const result = cli(releaseFiles());
    expect(result).toEqual({
      status: 1,
      stdout: [],
      stderr: ['{"ok":false,"error":"canary_compose_snapshot_drift"}\n'],
    });
  });

  it("does not echo failed renderer output or paths", () => {
    vi.mocked(spawnSync).mockImplementationOnce(
      () =>
        ({ status: 1, stderr: "private renderer detail" }) as ReturnType<
          typeof spawnSync
        >,
    );
    expect(cli(releaseFiles())).toEqual({
      status: 1,
      stdout: [],
      stderr: ['{"ok":false,"error":"canary_compose_render_failed"}\n'],
    });
  });

  it.each([
    [],
    ["--env-file", "x"],
    ["--env-file", "x", "--env-file", "x", "--profile", "x"],
    ["--env-file", "x", "--deploy", "x", "--profile", "x"],
    ["--env-file", "--profile", "--release-manifest", "x", "--profile", "x"],
  ])("rejects invalid CLI arguments %j", (...args) => {
    const stderr: string[] = [];
    expect(
      runTfCanaryRenewalV2Cli(args, undefined, {
        stdout: () => {
          throw new Error("unexpected_output");
        },
        stderr: (value) => stderr.push(value),
      }),
    ).toBe(1);
    expect(stderr).toEqual(['{"ok":false,"error":"invalid_arguments"}\n']);
  });
});
for (const [name, image] of Object.entries(
  tfOnlyReleaseImageEnvironmentNames,
)) {
  environment[name] = artifact.images.find(
    (entry) => entry.name === image,
  )!.imageReference;
}

let temporary: string;
let baseline: ComposeDocument;
beforeAll(() => {
  temporary = mkdtempSync(join(tmpdir(), "tf-renewal-v2-"));
  const path = join(temporary, "source.env");
  writeFileSync(
    path,
    Object.entries(environment)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  const rendered = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      path,
      "-f",
      join(root, "deploy/coolify/apollo-tf.canary.git.compose.yml"),
      "config",
      "--format",
      "json",
    ],
    {
      encoding: "utf8",
      cwd: root,
      env: isolatedComposeEnvironment(environment),
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (rendered.status !== 0) throw new Error("fixture_render_failed");
  baseline = JSON.parse(rendered.stdout) as ComposeDocument;
}, 35_000);
afterAll(() => {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
});

function fixture() {
  const compose = structuredClone(baseline);
  compose.name = "apollo-tf-canary-renewal-v2";
  for (const resource of [
    ...Object.values(compose.networks!),
    ...Object.values(compose.volumes!),
  ]) {
    resource.name = resource
      .name!.replace("apollo-tf-canary-", "apollo-tf-canary-renewal-")
      .replace(/-v1$/, "-v2");
  }
  const api = compose.services["tf-api"]!;
  api.environment!.APOLLO_TF_RENEWAL_ENABLED = "true";
  api.environment!.APOLLO_TF_REVOKE_KEYRING_FILE =
    "/run/secrets/tf_revoke_keyring";
  api.secrets!.push({
    source: "tf_revoke_keyring",
    target: "tf_revoke_keyring",
    uid: "10001",
    gid: "10001",
    mode: 256,
  } as unknown as ComposeSecretMount);
  compose.secrets!.tf_revoke_keyring = {
    file: `${secretRoot}/tf_revoke_keyring`,
  };
  return { compose, env: { ...environment }, policy: structuredClone(profile) };
}

describe("TF canary renewal v2 source binding", () => {
  it("accepts structural binding but cannot admit activation", () => {
    const { compose, env, policy } = fixture();
    const before = JSON.stringify({ compose, env, policy });
    expect(
      validateTfCanaryRenewalV2Binding(
        artifact,
        env,
        compose,
        parseTfCanaryRenewalV2Profile(policy),
      ),
    ).toEqual({
      apiOrigin,
      imageCount: 10,
      serviceCount: 12,
      profile: "apollo-tf-canary-renewal.v2",
      evidenceLevel: "source-binding-only",
      activationAllowed: false,
      blockers: [
        "runtime_admission_required",
        "fixture_admission_required",
        "cleanup_admission_required",
        "keyring_custody_unproven",
      ],
    });
    expect(JSON.stringify({ compose, env, policy })).toBe(before);
  });

  it("keeps v1 renewal-false behavior unchanged", () => {
    expect(
      validateTfCanaryComposeBinding(artifact, environment, baseline),
    ).toEqual({ apiOrigin, imageCount: 10, serviceCount: 12 });
    const renewal = structuredClone(baseline);
    renewal.services["tf-api"]!.environment!.APOLLO_TF_RENEWAL_ENABLED = "true";
    expect(() =>
      validateTfCanaryComposeBinding(artifact, environment, renewal),
    ).toThrow("canary_origin_mismatch");
  });

  it.each([
    [
      "unknown admission",
      (p: Record<string, unknown>) => {
        p.activationAllowed = true;
      },
    ],
    [
      "inline key",
      (p: Record<string, unknown>) => {
        p.key = "synthetic-not-a-key";
      },
    ],
    [
      "foreign client",
      (p: Record<string, unknown>) => {
        p.clientId = "other-client";
      },
    ],
    [
      "foreign audience",
      (p: Record<string, unknown>) => {
        p.audience = "apollo-ai";
      },
    ],
    [
      "symlink allowance",
      (p: Record<string, unknown>) => {
        (p.revokeKeyring as Record<string, unknown>).allowSymlink = true;
      },
    ],
    [
      "nested unknown",
      (p: Record<string, unknown>) => {
        (p.revokeKeyring as Record<string, unknown>).keys = [];
      },
    ],
  ] as const)("rejects untrusted profile: %s", (_name, change) => {
    const { compose, env, policy } = fixture();
    change(policy);
    expect(() =>
      validateTfCanaryRenewalV2Binding(artifact, env, compose, policy as never),
    ).toThrow("invalid_canary_renewal_profile");
  });

  it.each([
    [
      "input false",
      (f: ReturnType<typeof fixture>) => {
        f.env.TF_RENEWAL_ENABLED = "false";
      },
    ],
    [
      "input missing",
      (f: ReturnType<typeof fixture>) => {
        delete f.env.TF_RENEWAL_ENABLED;
      },
    ],
    [
      "render false",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-api"]!.environment!.APOLLO_TF_RENEWAL_ENABLED =
          "false";
      },
    ],
    [
      "client override",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-api"]!.environment!.APOLLO_TF_CLIENT_ID =
          "other-client";
      },
    ],
    [
      "inline revoke",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services[
          "tf-api"
        ]!.environment!.APOLLO_TF_REVOKE_KEYRING_JSON = "synthetic";
      },
    ],
    [
      "static PKCE",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services[
          "tf-api"
        ]!.environment!.APOLLO_TF_BRIDGE_PKCE_VERIFIER_FILE =
          "/run/secrets/static_pkce";
      },
    ],
    [
      "wrong path",
      (f: ReturnType<typeof fixture>) => {
        f.compose.secrets!.tf_revoke_keyring!.file =
          "/var/lib/apollo-tf-canary/secrets/tf_revoke_keyring";
      },
    ],
    [
      "wrong mode",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-api"]!.secrets!.at(-1)!.mode = "0444";
      },
    ],
    [
      "wrong uid",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-api"]!.secrets!.at(-1)!.uid = "0";
      },
    ],
    [
      "missing mount",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-api"]!.secrets!.pop();
      },
    ],
    [
      "duplicate mount",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-api"]!.secrets!.push(
          f.compose.services["tf-api"]!.secrets!.at(-1)!,
        );
      },
    ],
    [
      "other service",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-web"]!.secrets = [
          f.compose.services["tf-api"]!.secrets!.at(-1)!,
        ];
      },
    ],
    [
      "client alias",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services[
          "tf-api"
        ]!.environment!.APOLLO_TF_CLIENT_SECRET_FILE =
          "/run/secrets/tf_revoke_keyring";
      },
    ],
    [
      "external keyring",
      (f: ReturnType<typeof fixture>) => {
        Object.assign(f.compose.secrets!.tf_revoke_keyring!, {
          external: true,
        });
      },
    ],
    [
      "volume driver host bind",
      (f: ReturnType<typeof fixture>) => {
        Object.assign(f.compose.volumes!["tf-downloads"]!, {
          driver: "local",
          driver_opts: { type: "none", o: "bind", device: secretRoot },
        });
      },
    ],
    [
      "file config keyring copy",
      (f: ReturnType<typeof fixture>) => {
        Object.assign(f.compose, {
          configs: { revoke_copy: { file: `${secretRoot}/tf_revoke_keyring` } },
        });
        Object.assign(f.compose.services["tf-search"]!, {
          configs: [{ source: "revoke_copy", target: "/tmp/revoke-copy" }],
        });
      },
    ],
    [
      "normalized admin credential alias",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-api"]!.environment!.ADMIN_DASHBOARD_TOKEN_FILE =
          "/run/secrets/../secrets/tf_revoke_keyring";
      },
    ],
    [
      "inherited API mounts",
      (f: ReturnType<typeof fixture>) => {
        Object.assign(f.compose.services["tf-search"]!, {
          volumes_from: ["tf-api"],
        });
      },
    ],
    [
      "v1 project",
      (f: ReturnType<typeof fixture>) => {
        f.compose.name = "apollo-tf-canary";
      },
    ],
    [
      "v1 volume",
      (f: ReturnType<typeof fixture>) => {
        f.compose.volumes!["tf-postgres-data"]!.name =
          "apollo-tf-canary-postgres-v1";
      },
    ],
    [
      "v1 network",
      (f: ReturnType<typeof fixture>) => {
        f.compose.networks!["tf-data"]!.name = "apollo-tf-canary-data-v1";
      },
    ],
    [
      "v1 secret root",
      (f: ReturnType<typeof fixture>) => {
        f.env.TF_CANARY_SECRET_DIRECTORY = "/var/lib/apollo-tf-canary/secrets";
      },
    ],
  ] as const)("rejects additive binding violation: %s", (_name, change) => {
    const f = fixture();
    change(f);
    const before = JSON.stringify(f);
    expect(() =>
      validateTfCanaryRenewalV2Binding(
        artifact,
        f.env,
        f.compose,
        parseTfCanaryRenewalV2Profile(f.policy),
      ),
    ).toThrow("canary_renewal_binding_failed");
    expect(JSON.stringify(f)).toBe(before);
  });

  it.each([
    [
      "coherent foreign origin",
      "canary_origin_mismatch",
      (f: ReturnType<typeof fixture>) => {
        f.env.PLATFORM_CANARY_PUBLIC_ORIGIN = "https://api.apollot.ru";
        f.compose.services["tf-api"]!.environment!.APOLLO_PLATFORM_ISSUER =
          "https://api.apollot.ru";
      },
    ],
    [
      "source mismatch",
      "canary_origin_mismatch",
      (f: ReturnType<typeof fixture>) => {
        f.env.RELEASE_SOURCE_COMMIT = "b".repeat(40);
      },
    ],
    [
      "successor WS",
      "canary_origin_mismatch",
      (f: ReturnType<typeof fixture>) => {
        f.env.TF_SUCCESSOR_WS_ENABLED = "true";
      },
    ],
    [
      "private HTTP",
      "canary_origin_mismatch",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services[
          "tf-api"
        ]!.environment!.APOLLO_TF_BRIDGE_ALLOW_INTERNAL_HTTP = "true";
      },
    ],
    [
      "image mismatch",
      "canary_service_image_mismatch",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-web"]!.image =
          f.compose.services["tf-api"]!.image;
      },
    ],
    [
      "public port",
      "canary_port_mismatch",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-api"]!.ports![0]!.host_ip = "0.0.0.0";
      },
    ],
    [
      "build",
      "canary_build_forbidden",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-api"]!.build = ".";
      },
    ],
    [
      "host bind",
      "canary_resource_isolation_failed",
      (f: ReturnType<typeof fixture>) => {
        f.compose.services["tf-api"]!.volumes = [
          { type: "bind", source: "/etc", target: "/host" },
        ];
      },
    ],
  ] as const)("retains common v1 guard: %s", (_name, code, change) => {
    const f = fixture();
    change(f);
    expect(() =>
      validateTfCanaryRenewalV2Binding(
        artifact,
        f.env,
        f.compose,
        parseTfCanaryRenewalV2Profile(f.policy),
      ),
    ).toThrow(code);
  });
});
