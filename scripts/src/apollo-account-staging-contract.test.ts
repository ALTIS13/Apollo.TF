import { spawn, spawnSync } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  verify,
} from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const composePath = resolve(
  repositoryRoot,
  "deploy/coolify/apollo-account-staging.compose.yml",
);
const adminInvitePath = resolve(
  repositoryRoot,
  "deploy/supabase/account/admin-invite.mjs",
);
const backupExportPath = resolve(
  repositoryRoot,
  "deploy/supabase/account/backup-export.sh",
);
const temporaryRoots: string[] = [];
const contractSourceCommit = "0123456789abcdef0123456789abcdef01234567";

const expectedImages = Object.freeze({
  "account-auth":
    "supabase/gotrue:v2.189.0@sha256:385184459f57569c54c25209f51f3b2be99ddd7c4ce9e3555b5d3eea8447b7cf",
  "account-db":
    "supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00",
  "account-gateway":
    "envoyproxy/envoy:v1.39.0@sha256:d59f7f5fa10cff6d5892b6c5e7df5c9297ddfb2c3683e33fbfb82da24de4fa66",
  "account-mail":
    "axllent/mailpit:v1.31.0@sha256:c96991d9bef73594c246d89ca81411d4e916f03e76a7d2d72fa2ab5dd3c9ce24",
});

interface RenderedService {
  readonly image?: string;
  readonly user?: string;
  readonly entrypoint?: string | readonly string[];
  readonly labels?: Record<string, string>;
  readonly read_only?: boolean;
  readonly cap_drop?: readonly string[];
  readonly cap_add?: readonly string[];
  readonly security_opt?: readonly string[];
  readonly healthcheck?: { readonly test?: readonly string[] };
  readonly deploy?: { readonly resources?: { readonly limits?: unknown } };
  readonly environment?: Record<string, string>;
  readonly ports?: ReadonlyArray<{
    readonly host_ip?: string;
    readonly published?: string | number;
    readonly target?: number;
  }>;
  readonly volumes?: ReadonlyArray<{
    readonly source?: string;
    readonly target?: string;
  }>;
  readonly secrets?: ReadonlyArray<{
    readonly source?: string;
    readonly target?: string;
  }>;
}

interface RenderedCompose {
  readonly name: string;
  readonly services: Record<string, RenderedService>;
  readonly networks: Record<string, { readonly internal?: boolean }>;
  readonly volumes: Record<string, { readonly name?: string }>;
  readonly secrets: Record<string, { readonly file?: string }>;
}

function renderCompose(): {
  readonly config: RenderedCompose;
  readonly rendered: string;
  readonly secretValues: readonly string[];
} {
  const root = mkdtempSync(resolve(tmpdir(), "apollo-account-contract-"));
  temporaryRoots.push(root);
  const secretRoot = resolve(root, "secrets");
  mkdirSync(secretRoot);
  const secretValues = [
    "contract-postgres-password",
    "contract-auth-database-password",
    "contract-legacy-jwt-secret-that-is-long-enough",
    '{"keys":[{"kty":"EC","crv":"P-256","kid":"contract-key"}]}',
    "sb_publishable_contract_key",
  ];
  const secretFiles = [
    "account_postgres_password",
    "account_auth_db_password",
    "account_legacy_jwt_secret",
    "account_jwt_keys",
    "account_publishable_key",
  ];
  for (const [index, name] of secretFiles.entries()) {
    writeFileSync(resolve(secretRoot, name), `${secretValues[index]}\n`, {
      mode: 0o600,
    });
  }

  const result = spawnSync(
    "docker",
    ["compose", "-f", composePath, "config", "--format", "json"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        APOLLO_ACCOUNT_API_EXTERNAL_URL:
          "http://127.0.0.1:18300/auth/v1",
        APOLLO_ACCOUNT_GATEWAY_PORT: "18300",
        APOLLO_ACCOUNT_MAIL_UI_PORT: "18301",
        APOLLO_ACCOUNT_RESOURCE_NAME: "apollo-account-staging-contract",
        APOLLO_ACCOUNT_SECRET_DIRECTORY: secretRoot,
        APOLLO_ACCOUNT_SOURCE_COMMIT: contractSourceCommit,
        APOLLO_ACCOUNT_SITE_URL: "http://127.0.0.1:18302",
        APOLLO_ACCOUNT_POSTGRES_IMAGE: expectedImages["account-db"],
        APOLLO_ACCOUNT_AUTH_IMAGE: expectedImages["account-auth"],
        APOLLO_ACCOUNT_GATEWAY_IMAGE: expectedImages["account-gateway"],
        APOLLO_ACCOUNT_MAIL_IMAGE: expectedImages["account-mail"],
      },
    },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return {
    config: JSON.parse(result.stdout) as RenderedCompose,
    rendered: result.stdout,
    secretValues,
  };
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("Apollo Account staging Compose contract", () => {
  it("renders one isolated auth-only resource with immutable images", () => {
    const { config, rendered } = renderCompose();

    expect(config.name).toBe("apollo-account-staging-contract");
    expect(Object.keys(config.services).sort()).toEqual(
      Object.keys(expectedImages).sort(),
    );
    for (const [name, image] of Object.entries(expectedImages)) {
      expect(config.services[name]?.image).toBe(image);
      expect(config.services[name]?.labels).toMatchObject({
        "io.apollo.account.component": name,
        "io.apollo.account.resource": "apollo-account-staging-contract",
        "io.apollo.account.source-commit": contractSourceCommit,
        "io.apollo.account.stack": "staging",
      });
    }
    expect(rendered).not.toMatch(/letscube|quasar|apollo-trackfinder/i);
  });

  it("publishes only the gateway and mail viewer on explicit loopback ports", () => {
    const { config } = renderCompose();

    expect(config.services["account-db"]?.ports).toBeUndefined();
    expect(config.services["account-auth"]?.ports).toBeUndefined();
    expect(config.services["account-gateway"]?.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", target: 8000 }),
    ]);
    expect(config.services["account-mail"]?.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", target: 8025 }),
    ]);
    expect(config.networks["account-data"]?.internal).toBe(true);
    expect(config.networks["account-ingress"]?.internal).toBe(true);
  });

  it("keeps signup closed and secret contents out of the rendered manifest", () => {
    const { config, rendered, secretValues } = renderCompose();

    expect(
      config.services["account-auth"]?.environment?.GOTRUE_DISABLE_SIGNUP,
    ).toBe("true");
    expect(
      config.services["account-auth"]?.environment
        ?.GOTRUE_EXTERNAL_EMAIL_ENABLED,
    ).toBe("true");
    expect(rendered).not.toMatch(/SERVICE_ROLE_KEY|service_role_key/);
    for (const secret of secretValues) expect(rendered).not.toContain(secret);
    expect(Object.keys(config.secrets).sort()).toEqual([
      "account_auth_db_password",
      "account_jwt_keys",
      "account_legacy_jwt_secret",
      "account_postgres_password",
      "account_publishable_key",
    ]);
  });

  it("gives Auth a distinct database credential without exposing the superuser secret", () => {
    const { config } = renderCompose();
    const auth = config.services["account-auth"]!;
    const database = config.services["account-db"]!;
    const authEntrypoint = JSON.stringify(auth.entrypoint);

    expect(authEntrypoint).toContain("account_auth_db_password");
    expect(authEntrypoint).not.toContain("account_postgres_password");
    expect(auth.secrets?.map(({ source }) => source).sort()).toEqual([
      "account_auth_db_password",
      "account_jwt_keys",
      "account_legacy_jwt_secret",
    ]);
    expect(database.secrets).toEqual([
      expect.objectContaining({ source: "account_auth_db_password" }),
      expect.objectContaining({ source: "account_postgres_password" }),
    ]);
    expect(database.environment?.POSTGRES_USER).toBeUndefined();
  });

  it("invites only a synthetic staging account with an in-memory short-lived admin assertion", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "apollo-account-admin-"));
    temporaryRoots.push(root);
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const privateJwk = privateKey.export({ format: "jwk" });
    const kid = randomUUID();
    const publishableKey = "sb_publishable_contract_admin_key";
    writeFileSync(
      resolve(root, "account_jwt_keys"),
      JSON.stringify([
        {
          ...privateJwk,
          alg: "ES256",
          key_ops: ["sign", "verify"],
          kid,
          use: "sig",
        },
      ]),
      { mode: 0o600 },
    );
    writeFileSync(
      resolve(root, "account_publishable_key"),
      `${publishableKey}\n`,
      { mode: 0o600 },
    );

    let request:
      | {
          readonly authorization: string;
          readonly apikey: string;
          readonly body: string;
          readonly url: string;
        }
      | undefined;
    const server = createServer((incoming, response) => {
      let body = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => {
        body += chunk;
      });
      incoming.on("end", () => {
        request = {
          apikey: String(incoming.headers.apikey ?? ""),
          authorization: String(incoming.headers.authorization ?? ""),
          body,
          url: incoming.url ?? "",
        };
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"id":"synthetic-user"}');
      });
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("test HTTP server did not expose a TCP port");
      }
      const child = spawn(
        process.execPath,
        [
          adminInvitePath,
          "--gateway-url",
          `http://127.0.0.1:${address.port}`,
          "--secret-directory",
          root,
          "--email",
          "synthetic-contract@staging.invalid",
        ],
        { cwd: repositoryRoot, env: process.env },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
      });
      const exitCode = await new Promise<number | null>((resolveExit) =>
        child.on("close", resolveExit),
      );

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toBe("invite accepted for synthetic-contract@staging.invalid\n");
      expect(stderr).toBe("");
      expect(request).toMatchObject({
        apikey: publishableKey,
        body: JSON.stringify({ email: "synthetic-contract@staging.invalid" }),
        url: "/auth/v1/invite",
      });
      const compactJwt = request!.authorization.replace(/^Bearer /, "");
      expect(compactJwt).not.toBe(request!.authorization);
      expect(stdout).not.toContain(compactJwt);
      const [encodedHeader, encodedPayload, encodedSignature] =
        compactJwt.split(".");
      const header = JSON.parse(
        Buffer.from(encodedHeader!, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      const payload = JSON.parse(
        Buffer.from(encodedPayload!, "base64url").toString("utf8"),
      ) as Record<string, number | string>;
      expect(header).toMatchObject({ alg: "ES256", kid, typ: "JWT" });
      expect(payload).toMatchObject({ iss: "supabase", role: "service_role" });
      expect(Number(payload.exp) - Number(payload.iat)).toBe(300);
      expect(Number(payload.exp)).toBeGreaterThan(
        Math.floor(Date.now() / 1000),
      );
      const publicKey = createPublicKey(privateKey);
      expect(
        verify(
          "sha256",
          Buffer.from(`${encodedHeader}.${encodedPayload}`),
          { dsaEncoding: "ieee-p1363", key: publicKey },
          Buffer.from(encodedSignature!, "base64url"),
        ),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) =>
          error === undefined ? resolveClose() : rejectClose(error),
        ),
      );
    }
  });

  it("rejects a non-synthetic invite before reading credentials or making a request", () => {
    const result = spawnSync(
      process.execPath,
      [
        adminInvitePath,
        "--gateway-url",
        "http://127.0.0.1:18300",
        "--secret-directory",
        resolve(tmpdir(), "does-not-exist"),
        "--email",
        "real-user@example.com",
      ],
      { cwd: repositoryRoot, encoding: "utf8", env: process.env },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("email must end with @staging.invalid");
    expect(result.stderr).not.toContain("ENOENT");
  });

  it("rejects malformed backup source identity before reading files or Docker", () => {
    const cases = [
      {
        commit: contractSourceCommit,
        error:
          "source resource must use lowercase letters, digits, and interior hyphens",
        resource: "Apollo/Primary",
      },
      {
        commit: contractSourceCommit.toUpperCase(),
        error:
          "source Git commit must be exactly 40 lowercase hexadecimal characters",
        resource: "apollo-account-contract",
      },
    ];

    for (const testCase of cases) {
      const result = spawnSync(
        "sh",
        [
          backupExportPath.replaceAll("\\", "/"),
          "--backup-root",
          "/does-not-exist",
          "--secret-directory",
          "/does-not-exist",
          "--source-resource",
          testCase.resource,
          "--source-git-commit",
          testCase.commit,
        ],
        { cwd: repositoryRoot, encoding: "utf8", env: process.env },
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain(testCase.error);
      expect(result.stderr).not.toContain("backup root");
      expect(result.stderr).not.toContain("docker");
    }
  });

  it("exports a checksummed logical recovery bundle with all continuity secrets", () => {
    const root = mkdtempSync(resolve(tmpdir(), "apollo-account-backup-"));
    temporaryRoots.push(root);
    const backupRoot = resolve(root, "backups");
    const fakeBin = resolve(root, "bin");
    const dockerLog = resolve(root, "docker.log");
    const secretRoot = resolve(root, "secrets");
    mkdirSync(backupRoot);
    mkdirSync(fakeBin);
    mkdirSync(secretRoot);
    const secretFiles = [
      "account_auth_db_password",
      "account_jwt_keys",
      "account_legacy_jwt_secret",
      "account_postgres_password",
      "account_publishable_key",
    ];
    for (const name of secretFiles) {
      const value =
        name === "account_jwt_keys"
          ? JSON.stringify([
              {
                alg: "ES256",
                crv: "P-256",
                d: "synthetic-private-coordinate",
                kid: "contract-signing-kid",
                kty: "EC",
                x: "synthetic-public-x",
                y: "synthetic-public-y",
              },
            ])
          : `synthetic-${name}`;
      writeFileSync(resolve(secretRoot, name), `${value}\n`, {
        mode: 0o600,
      });
    }
    const fakeDocker = resolve(fakeBin, "docker");
    writeFileSync(
      fakeDocker,
      `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$APOLLO_ACCOUNT_TEST_DOCKER_LOG"
case "$1" in
  ps)
    [ "$*" = "ps --filter label=io.apollo.account.stack=staging --filter label=io.apollo.account.component=account-db --filter label=io.apollo.account.resource=apollo-account-contract --filter label=io.apollo.account.source-commit=${contractSourceCommit} --format {{.ID}}" ]
    printf '%s\\n' 'contract-db-container'
    ;;
  inspect)
    case "$3" in
      '{{.Config.Image}}') printf '%s\\n' 'supabase/postgres:17.6.1.136@sha256:contract' ;;
      *'/var/lib/postgresql/data'*) printf '%s\\n' 'apollo-account-contract-postgres-v1' ;;
      *'/etc/postgresql-custom'*) printf '%s\\n' 'apollo-account-contract-db-config-v1' ;;
      *) printf '%s\\n' "unexpected docker inspect: $*" >&2; exit 9 ;;
    esac
    ;;
  exec)
    case "$*" in
      *current_setting*) printf '%s\\n' '170006|17.6 (Ubuntu 17.6-1.pgdg22.04+1)' ;;
      *pg_dump*) printf '%s' 'synthetic-custom-format-dump' ;;
      *tar*) printf '%s' 'synthetic-postgresql-custom-tar' ;;
      *) printf '%s\\n' "unexpected docker exec: $*" >&2; exit 9 ;;
    esac
    ;;
  *) printf '%s\\n' "unexpected docker command: $*" >&2; exit 9 ;;
esac
`,
      { mode: 0o700 },
    );
    chmodSync(fakeDocker, 0o700);

    const result = spawnSync(
      "sh",
      [
        backupExportPath.replaceAll("\\", "/"),
        "--backup-root",
        backupRoot.replaceAll("\\", "/"),
        "--secret-directory",
        secretRoot.replaceAll("\\", "/"),
        "--source-resource",
        "apollo-account-contract",
        "--source-git-commit",
        contractSourceCommit,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          APOLLO_ACCOUNT_TEST_DOCKER_LOG: dockerLog,
          PATH: `${fakeBin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const bundleNames = readdirSync(backupRoot);
    expect(bundleNames).toHaveLength(1);
    const bundle = resolve(backupRoot, bundleNames[0]!);
    expect(readFileSync(resolve(bundle, "postgres.dump"), "utf8")).toBe(
      "synthetic-custom-format-dump",
    );
    expect(readFileSync(resolve(bundle, "postgresql-custom.tar"), "utf8")).toBe(
      "synthetic-postgresql-custom-tar",
    );
    for (const name of secretFiles) {
      const copied = readFileSync(resolve(bundle, "secrets", name), "utf8");
      expect(copied).toBe(readFileSync(resolve(secretRoot, name), "utf8"));
      expect(result.stdout).not.toContain(`synthetic-${name}`);
    }
    const manifest = readFileSync(resolve(bundle, "MANIFEST"), "utf8");
    expect(manifest).toContain("format=apollo-account-logical-v2");
    expect(manifest).toContain(
      "source_image=supabase/postgres:17.6.1.136@sha256:contract",
    );
    expect(manifest).toContain("source_resource=apollo-account-contract");
    expect(manifest).toContain(`source_git_commit=${contractSourceCommit}`);
    expect(manifest).toContain("postgres_server_version_num=170006");
    expect(manifest).toContain(
      "postgres_server_version=17.6 (Ubuntu 17.6-1.pgdg22.04+1)",
    );
    expect(manifest).toContain(
      "postgres_data_volume=apollo-account-contract-postgres-v1",
    );
    expect(manifest).toContain(
      "postgres_config_volume=apollo-account-contract-db-config-v1",
    );
    expect(manifest).toContain("signing_kid=contract-signing-kid");
    const publicJwk = JSON.stringify({
      crv: "P-256",
      kty: "EC",
      x: "synthetic-public-x",
      y: "synthetic-public-y",
    });
    const thumbprint = createHash("sha256")
      .update(publicJwk)
      .digest("base64url");
    expect(manifest).toContain(
      `signing_public_jwk_thumbprint=${thumbprint}`,
    );
    const checksum = spawnSync("sh", ["-c", "sha256sum -c SHA256SUMS"], {
      cwd: bundle,
      encoding: "utf8",
    });
    expect(checksum.status, checksum.stderr).toBe(0);
    const dockerCommands = readFileSync(dockerLog, "utf8");
    const dumpCommand = dockerCommands
      .split("\n")
      .find((command) => command.includes("pg_dump"));
    expect(dumpCommand).toBeDefined();
    expect(dumpCommand).not.toContain("--no-owner");
    expect(dumpCommand).not.toContain("--no-acl");
  });

  it("checks the routed Auth health response instead of only opening a TCP socket", () => {
    const { config } = renderCompose();
    const testCommand =
      config.services["account-gateway"]?.healthcheck?.test?.join(" ") ?? "";

    expect(testCommand).toContain("GET /auth/v1/health HTTP/1.1");
    expect(testCommand).toContain("^HTTP/1\\.[01] 200");
  });

  it("applies the hardened runtime contract without making Postgres read-only", () => {
    const { config } = renderCompose();

    for (const [name, service] of Object.entries(config.services)) {
      expect(service.security_opt, name).toContain("no-new-privileges:true");
      expect(service.healthcheck, name).toBeDefined();
      expect(service.deploy?.resources?.limits, name).toBeDefined();
      expect(service.cap_drop, name).toContain("ALL");
    }
    expect(config.services["account-db"]?.read_only).not.toBe(true);
    for (const name of ["account-auth", "account-gateway", "account-mail"]) {
      expect(config.services[name]?.read_only, name).toBe(true);
    }
    expect(config.volumes["account-postgres-data"]?.name).toBe(
      "apollo-account-staging-contract-postgres-v1",
    );
    expect(config.volumes["account-db-config"]?.name).toBe(
      "apollo-account-staging-contract-db-config-v1",
    );
  });
});
