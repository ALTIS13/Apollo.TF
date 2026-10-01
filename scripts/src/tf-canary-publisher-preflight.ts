import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  tfOnlyOperatorReleaseImageTargets,
  tfOnlyReleaseImageCatalog,
  type OperatorReleaseImageTarget,
  type ReleaseImageCatalogEntry,
} from "./release-images.js";

const execFileAsync = promisify(execFile);
const approvedImageTupleSha256 =
  "41f6c0f2d24e25e9985f3fa895e83adcbdfc27687a661feb32b90c00e8c071a1";
const approvedCatalogSha256 =
  "161a2529c71d8474a839f8a782b8fe1652ba42e6547677d06d986ce11b8187ea";
const oldPublisherRoot =
  "/opt/apollo-platform-production/tf-publisher-20260921a";

export const tfCanaryPublisherCandidate = {
  archiveSha256:
    "467f204efb5c6cd212618af25f5dc5ca43949ab22d8a26cb43ef050de408620f",
  imageRepositories: [
    "ghcr.io/altis13/apollo-tf-api",
    "ghcr.io/altis13/apollo-tf-postgres",
    "ghcr.io/altis13/apollo-tf-web",
    "ghcr.io/altis13/apollo-tf-admin",
    "ghcr.io/altis13/apollo-tf-search",
    "ghcr.io/altis13/apollo-tf-integrations",
    "ghcr.io/altis13/apollo-tf-integrations-postgres",
    "ghcr.io/altis13/apollo-tf-download-worker",
    "ghcr.io/altis13/apollo-tf-download-redis",
  ],
  releaseId: "v0.1.0-canary.20261002.f3828eb",
  sourceCommit: "f3828eb016e9dc034030e2da7ca2c2a39f4327c1",
  tfWebApiOrigin: "https://api.tf.canary.apollot.ru",
} as const;

const nativeGates = [
  "new_publisher_custody_unproven",
  "toolchain_custody_unproven",
  "docker_auth_session_unproven",
  "ghcr_write_access_unproven",
  "all_nine_tags_unproven",
  "competing_publisher_absence_unproven",
] as const;

type GitResult = { status: number; stdout: string };
type GitRunner = (
  args: readonly string[],
  repositoryRoot: string,
) => Promise<GitResult>;

export type TfCanaryPreclaimOptions = {
  archivePath: string;
  repositoryRoot: string;
};

export type TfCanaryPreclaimDependencies = {
  expectedArchiveSha256?: string;
  git?: GitRunner;
  imageCatalog?: readonly ReleaseImageCatalogEntry[];
  imageTargets?: readonly OperatorReleaseImageTarget[];
};

export type TfCanaryPreclaimReport = {
  decision: "blocked";
  formatVersion: 1;
  imageTags: string[];
  nativeGates: readonly (typeof nativeGates)[number][];
  operatorCommit?: string;
  releaseId: string;
  sourceBlockers: string[];
  sourceCommit: string;
  tfWebApiOrigin: string;
};

async function defaultGit(
  args: readonly string[],
  repositoryRoot: string,
): Promise<GitResult> {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd: repositoryRoot,
      maxBuffer: 4096,
      timeout: 60_000,
      windowsHide: true,
    });
    return { status: 0, stdout: result.stdout };
  } catch {
    return { status: 1, stdout: "" };
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function inspectTfCanaryPublisherPreclaim(
  options: TfCanaryPreclaimOptions,
  dependencies: TfCanaryPreclaimDependencies = {},
): Promise<TfCanaryPreclaimReport> {
  const sourceBlockers: string[] = [];
  const git = dependencies.git ?? defaultGit;
  const imageTargets =
    dependencies.imageTargets ?? tfOnlyOperatorReleaseImageTargets;
  const imageCatalog = dependencies.imageCatalog ?? tfOnlyReleaseImageCatalog;
  const targetSha256 = createHash("sha256")
    .update(JSON.stringify(imageTargets))
    .digest("hex");
  const catalogSha256 = createHash("sha256")
    .update(JSON.stringify(imageCatalog))
    .digest("hex");
  if (
    imageTargets.length !== 9 ||
    targetSha256 !== approvedImageTupleSha256 ||
    imageCatalog.length !== 10 ||
    catalogSha256 !== approvedCatalogSha256 ||
    imageTargets.some(
      ({ repository }, index) =>
        repository !== tfCanaryPublisherCandidate.imageRepositories[index],
    )
  ) {
    sourceBlockers.push("image_tuple_mismatch");
  }

  let publisherRoot: string;
  try {
    publisherRoot = await realpath(options.repositoryRoot);
    if (publisherRoot.replaceAll("\\", "/") === oldPublisherRoot) {
      sourceBlockers.push("historical_publisher_checkout");
    }
  } catch {
    publisherRoot = resolve(options.repositoryRoot);
    sourceBlockers.push("publisher_checkout_unavailable");
  }

  const worktree = await git(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    publisherRoot,
  );
  if (worktree.status !== 0 || worktree.stdout.trim() !== "") {
    sourceBlockers.push("publisher_worktree_not_clean");
  }
  const sourceObject = await git(
    ["cat-file", "-e", `${tfCanaryPublisherCandidate.sourceCommit}^{commit}`],
    publisherRoot,
  );
  if (sourceObject.status !== 0) sourceBlockers.push("source_commit_missing");
  const head = await git(["rev-parse", "HEAD"], publisherRoot);
  const operatorCommit = head.stdout.trim();
  if (head.status !== 0 || !/^[a-f0-9]{40}$/.test(operatorCommit)) {
    sourceBlockers.push("operator_commit_unavailable");
  }

  try {
    const stat = await lstat(options.archivePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      sourceBlockers.push("archive_not_regular_file");
    } else if (
      (await sha256File(options.archivePath)) !==
      (dependencies.expectedArchiveSha256 ??
        tfCanaryPublisherCandidate.archiveSha256)
    ) {
      sourceBlockers.push("archive_sha256_mismatch");
    }
  } catch {
    sourceBlockers.push("archive_unavailable");
  }

  const claimDirectory = join(
    publisherRoot,
    ".ops-private",
    "tf-only-release-claims",
    tfCanaryPublisherCandidate.releaseId,
  );
  const outputDirectory = join(
    publisherRoot,
    ".ops-private",
    "tf-only-releases",
    tfCanaryPublisherCandidate.releaseId,
  );
  try {
    if (await exists(claimDirectory))
      sourceBlockers.push("release_claim_exists");
    if (await exists(outputDirectory))
      sourceBlockers.push("release_output_exists");
  } catch {
    sourceBlockers.push("local_release_state_unavailable");
  }

  return {
    decision: "blocked",
    formatVersion: 1,
    imageTags: tfCanaryPublisherCandidate.imageRepositories.map(
      (repository) => `${repository}:${tfCanaryPublisherCandidate.releaseId}`,
    ),
    nativeGates,
    ...(head.status === 0 && /^[a-f0-9]{40}$/.test(operatorCommit)
      ? { operatorCommit }
      : {}),
    releaseId: tfCanaryPublisherCandidate.releaseId,
    sourceBlockers,
    sourceCommit: tfCanaryPublisherCandidate.sourceCommit,
    tfWebApiOrigin: tfCanaryPublisherCandidate.tfWebApiOrigin,
  };
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPath)).href
) {
  if (process.argv.length !== 2) {
    process.stderr.write(`${JSON.stringify({ error: "invalid_arguments" })}\n`);
    process.exitCode = 1;
  } else {
    const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
    void inspectTfCanaryPublisherPreclaim({
      archivePath: join(
        repositoryRoot,
        ".ops-private",
        "coolify-native-20261001",
        "source-f3828eb.tar",
      ),
      repositoryRoot,
    })
      .then((report) => {
        process.stdout.write(`${JSON.stringify(report)}\n`);
        process.exitCode = 1;
      })
      .catch(() => {
        process.stderr.write(
          `${JSON.stringify({ error: "preflight_unavailable" })}\n`,
        );
        process.exitCode = 1;
      });
  }
}
