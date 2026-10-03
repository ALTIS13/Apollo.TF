import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { parse, type DefaultTreeAdapterTypes } from "parse5";

import { verifyTfOnlyOperatorReleaseEvidence } from "./operator-release.js";
import type { TfOnlyReleaseArtifact } from "./release-images.js";

export type DockerCommand = (args: readonly string[]) => Promise<string>;

const execFileAsync = promisify(execFile);
const webRepository = "ghcr.io/altis13/apollo-tf-web";
const productionOrigins = [
  "https://api.tf.apollot.ru",
  "https://api.apollot.ru",
];
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const containerIdPattern = /^[a-f0-9]{64}$/;
const maxImageBytes = 256 * 1024 * 1024;

async function defaultDockerCommand(args: readonly string[]): Promise<string> {
  const timeout = args[0] === "pull" ? 10 * 60_000 : 2 * 60_000;
  const { stdout } = await execFileAsync("docker", [...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    timeout,
    windowsHide: true,
  });
  return stdout;
}

async function checkedDocker(
  docker: DockerCommand,
  args: readonly string[],
  errorCode: string,
): Promise<string> {
  try {
    return await docker(args);
  } catch {
    throw new Error(errorCode);
  }
}

function assertCanaryOrigin(origin: unknown): asserts origin is string {
  if (typeof origin !== "string") throw new Error("invalid_tf_web_origin");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("invalid_tf_web_origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== origin ||
    !parsed.hostname.startsWith("api.") ||
    !parsed.hostname.split(".").includes("canary") ||
    !parsed.hostname.endsWith(".apollot.ru")
  ) {
    throw new Error("invalid_tf_web_origin");
  }
}

function entryScriptPaths(indexHtml: string): string[] {
  const pending: DefaultTreeAdapterTypes.Node[] = [parse(indexHtml)];
  const paths: string[] = [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if ("tagName" in node && node.tagName === "script") {
      const attributes = new Map(
        node.attrs.map(({ name, value }) => [name, value]),
      );
      const src = attributes.get("src");
      if (
        attributes.get("type") !== "module" ||
        src === undefined ||
        !/^\/assets\/[a-zA-Z0-9._-]+\.js$/.test(src)
      ) {
        throw new Error("unsafe_tf_web_bundle");
      }
      paths.push(src.slice(1));
    }
    if ("childNodes" in node) pending.push(...node.childNodes);
  }
  if (paths.length !== 1) throw new Error("unsafe_tf_web_bundle");
  return paths;
}

async function scanWebBundle(root: string, apiOrigin: string): Promise<number> {
  const indexPath = join(root, "index.html");
  const indexStat = await lstat(indexPath);
  if (!indexStat.isFile() || indexStat.size > 2 * 1024 * 1024) {
    throw new Error("unsafe_tf_web_bundle");
  }
  const indexHtml = await readFile(indexPath, "utf8");
  const entryPaths = entryScriptPaths(indexHtml);
  const jsAssets = new Map<string, string>();
  const assetsRoot = join(root, "assets");
  const assetsStat = await lstat(assetsRoot);
  if (!assetsStat.isDirectory()) throw new Error("unsafe_tf_web_bundle");

  const pending = [assetsRoot];
  let jsAssetCount = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("unsafe_tf_web_bundle");
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.size > 16 * 1024 * 1024) {
          throw new Error("unsafe_tf_web_bundle");
        }
        totalBytes += stat.size;
        jsAssetCount += 1;
        if (totalBytes > 64 * 1024 * 1024 || jsAssetCount > 256) {
          throw new Error("unsafe_tf_web_bundle");
        }
        jsAssets.set(
          relative(root, path).replaceAll("\\", "/"),
          await readFile(path, "utf8"),
        );
      }
    }
  }
  if (
    jsAssetCount === 0 ||
    !entryPaths.every((path) => jsAssets.has(path)) ||
    !entryPaths.some((path) => jsAssets.get(path)!.includes(apiOrigin)) ||
    [indexHtml, ...jsAssets.values()].some((value) =>
      productionOrigins.some((origin) => value.includes(origin)),
    )
  ) {
    throw new Error("unsafe_tf_web_bundle");
  }
  return jsAssetCount;
}

async function removeOwnedTemporaryRoot(root: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  const canonicalTemp = await realpath(tmpdir());
  if (
    dirname(canonicalRoot) !== canonicalTemp ||
    !basename(canonicalRoot).startsWith("apollo-tf-web-inspect-") ||
    !(await lstat(root)).isDirectory()
  ) {
    throw new Error("tf_web_cleanup_failed");
  }
  await rm(root, { recursive: true });
}

export async function inspectTfWebImage(
  artifact: TfOnlyReleaseArtifact,
  expectedOrigin: string,
  docker: DockerCommand = defaultDockerCommand,
): Promise<{
  apiOrigin: string;
  imageReference: string;
  jsAssetCount: number;
}> {
  const apiOrigin = artifact.tfWebApiOrigin;
  assertCanaryOrigin(apiOrigin);
  assertCanaryOrigin(expectedOrigin);
  if (apiOrigin !== expectedOrigin) throw new Error("tf_web_origin_mismatch");
  const image = artifact.images.find(
    (candidate) => candidate.name === "tf-web",
  );
  if (
    artifact.artifactSet !== "tf-only" ||
    image?.repository !== webRepository ||
    !digestPattern.test(image.imageDigest) ||
    image.imageDigest === `sha256:${"0".repeat(64)}` ||
    image.imageReference !== `${webRepository}@${image.imageDigest}`
  ) {
    throw new Error("invalid_tf_web_image");
  }
  const imageReference = image.imageReference;
  await checkedDocker(
    docker,
    ["pull", "--quiet", imageReference],
    "tf_web_pull_failed",
  );
  const inspected = await checkedDocker(
    docker,
    ["image", "inspect", "--format", "{{json .RepoDigests}}", imageReference],
    "tf_web_inspect_failed",
  );
  let repoDigests: unknown;
  try {
    repoDigests = JSON.parse(inspected);
  } catch {
    throw new Error("tf_web_digest_mismatch");
  }
  if (!Array.isArray(repoDigests) || !repoDigests.includes(imageReference)) {
    throw new Error("tf_web_digest_mismatch");
  }
  const sizeText = await checkedDocker(
    docker,
    ["image", "inspect", "--format", "{{.Size}}", imageReference],
    "tf_web_inspect_failed",
  );
  const imageBytes = Number(sizeText.trim());
  if (
    !Number.isSafeInteger(imageBytes) ||
    imageBytes <= 0 ||
    imageBytes > maxImageBytes
  ) {
    throw new Error("tf_web_image_too_large");
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "apollo-tf-web-inspect-"));
  const inspectionId = randomUUID();
  const containerName = `apollo-tf-web-inspect-${inspectionId}`;
  const ownershipLabel = `org.apollo.tf.inspection=${inspectionId}`;
  let containerId: string | undefined;
  let createAttempted = false;
  let result:
    | { apiOrigin: string; imageReference: string; jsAssetCount: number }
    | undefined;
  let failure: unknown;
  try {
    createAttempted = true;
    containerId = (
      await checkedDocker(
        docker,
        [
          "create",
          "--name",
          containerName,
          "--label",
          ownershipLabel,
          "--network",
          "none",
          "--read-only",
          imageReference,
        ],
        "tf_web_create_failed",
      )
    ).trim();
    if (!containerIdPattern.test(containerId)) {
      throw new Error("tf_web_container_id_invalid");
    }
    await checkedDocker(
      docker,
      ["cp", `${containerId}:/usr/share/nginx/html/.`, temporaryRoot],
      "tf_web_copy_failed",
    );
    let jsAssetCount: number;
    try {
      jsAssetCount = await scanWebBundle(temporaryRoot, apiOrigin);
    } catch {
      throw new Error("unsafe_tf_web_bundle");
    }
    result = {
      apiOrigin,
      imageReference,
      jsAssetCount,
    };
  } catch (error) {
    failure = error;
  }
  let cleanupFailed = false;
  try {
    if (createAttempted) {
      const listed = await checkedDocker(
        docker,
        [
          "ps",
          "-a",
          "--no-trunc",
          "--filter",
          `label=${ownershipLabel}`,
          "--format",
          "{{.ID}} {{.Names}}",
        ],
        "tf_web_cleanup_failed",
      );
      const lines = listed.trim() === "" ? [] : listed.trim().split(/\r?\n/);
      if (lines.length > 1) throw new Error("tf_web_cleanup_failed");
      if (lines.length === 1) {
        const [ownedId, ownedName, unexpected] = lines[0]!.split(" ");
        if (
          !containerIdPattern.test(ownedId ?? "") ||
          ownedName !== containerName ||
          unexpected !== undefined ||
          (containerId !== undefined &&
            containerIdPattern.test(containerId) &&
            ownedId !== containerId)
        ) {
          throw new Error("tf_web_cleanup_failed");
        }
        await checkedDocker(docker, ["rm", ownedId!], "tf_web_cleanup_failed");
      }
    }
  } catch {
    cleanupFailed = true;
  }
  try {
    await removeOwnedTemporaryRoot(temporaryRoot);
  } catch {
    cleanupFailed = true;
  }
  if (cleanupFailed) throw new Error("tf_web_cleanup_failed");
  if (failure !== undefined) throw failure;
  return result!;
}

export async function inspectTfWebImageFromManifest(
  manifestPath: string,
  expectedOrigin: string,
  docker: DockerCommand = defaultDockerCommand,
): Promise<{
  apiOrigin: string;
  imageReference: string;
  jsAssetCount: number;
}> {
  const artifact = verifyTfOnlyOperatorReleaseEvidence(manifestPath);
  return inspectTfWebImage(artifact, expectedOrigin, docker);
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPath)).href
) {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== "--manifest" ||
    args[2] !== "--expected-api-origin"
  ) {
    process.stderr.write(`${JSON.stringify({ error: "invalid_arguments" })}\n`);
    process.exitCode = 1;
  } else {
    void inspectTfWebImageFromManifest(args[1]!, args[3]!)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => {
        process.stderr.write(
          `${JSON.stringify({ error: error instanceof Error ? error.message : "tf_web_inspection_failed" })}\n`,
        );
        process.exitCode = 1;
      });
  }
}
