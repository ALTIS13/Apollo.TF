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
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

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

async function scanWebBundle(root: string, apiOrigin: string): Promise<number> {
  const indexPath = join(root, "index.html");
  const indexStat = await lstat(indexPath);
  if (!indexStat.isFile() || indexStat.size > 2 * 1024 * 1024) {
    throw new Error("unsafe_tf_web_bundle");
  }
  const contents = [await readFile(indexPath, "utf8")];
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
        contents.push(await readFile(path, "utf8"));
      }
    }
  }
  if (
    jsAssetCount === 0 ||
    !contents.slice(1).some((value) => value.includes(apiOrigin)) ||
    contents.some((value) =>
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

  const temporaryRoot = await mkdtemp(join(tmpdir(), "apollo-tf-web-inspect-"));
  let containerId: string | undefined;
  let result:
    | { apiOrigin: string; imageReference: string; jsAssetCount: number }
    | undefined;
  let failure: unknown;
  try {
    const name = `apollo-tf-web-inspect-${randomUUID()}`;
    containerId = (
      await checkedDocker(
        docker,
        [
          "create",
          "--name",
          name,
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
    if (containerId !== undefined && containerIdPattern.test(containerId)) {
      await checkedDocker(docker, ["rm", containerId], "tf_web_cleanup_failed");
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
