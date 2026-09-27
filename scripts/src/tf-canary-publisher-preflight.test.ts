import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it } from "vitest";

import {
  prepareOperatorRelease,
  prepareTfOnlyOperatorRelease,
  publishOperatorRelease,
  publishTfOnlyOperatorRelease,
} from "./operator-release.js";
import {
  tfOnlyOperatorReleaseImageTargets,
  tfOnlyReleaseImageCatalog,
} from "./release-images.js";
import {
  inspectTfCanaryPublisherPreclaim,
  tfCanaryPublisherCandidate,
} from "./tf-canary-publisher-preflight.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "tf-canary-preclaim-"));
  roots.push(repositoryRoot);
  const archivePath = join(repositoryRoot, "source.tar");
  await writeFile(archivePath, "source fixture");
  const archiveSha256 = createHash("sha256")
    .update("source fixture")
    .digest("hex");
  const gitCalls: string[][] = [];
  const git = async (args: readonly string[]) => {
    gitCalls.push([...args]);
    if (args[0] === "status") return { status: 0, stdout: "" };
    if (args[0] === "cat-file") return { status: 0, stdout: "" };
    if (args[0] === "rev-parse")
      return { status: 0, stdout: "f".repeat(40) + "\n" };
    throw new Error("unexpected git command");
  };
  return { repositoryRoot, archivePath, archiveSha256, git, gitCalls };
}

it("keeps a source-matched candidate closed until native auth, write, tag and custody proof", async () => {
  const setup = await fixture();
  const result = await inspectTfCanaryPublisherPreclaim(
    { repositoryRoot: setup.repositoryRoot, archivePath: setup.archivePath },
    { git: setup.git, expectedArchiveSha256: setup.archiveSha256 },
  );

  expect(result).toMatchObject({
    decision: "blocked",
    releaseId: tfCanaryPublisherCandidate.releaseId,
    sourceCommit: tfCanaryPublisherCandidate.sourceCommit,
    sourceBlockers: [],
  });
  expect(result.imageTags).toEqual(
    tfOnlyOperatorReleaseImageTargets.map(
      ({ repository }) =>
        `${repository}:${tfCanaryPublisherCandidate.releaseId}`,
    ),
  );
  expect(result.nativeGates).toContain("ghcr_write_access_unproven");
  expect(result.nativeGates).toContain("all_nine_tags_unproven");
  expect(setup.gitCalls).toContainEqual([
    "cat-file",
    "-e",
    `${tfCanaryPublisherCandidate.sourceCommit}^{commit}`,
  ]);
  expect(await readdir(setup.repositoryRoot)).toEqual(["source.tar"]);
});

it("blocks archive drift and an already claimed release without creating any further evidence", async () => {
  const setup = await fixture();
  const claim = join(
    setup.repositoryRoot,
    ".ops-private",
    "tf-only-release-claims",
    tfCanaryPublisherCandidate.releaseId,
  );
  await mkdir(claim, { recursive: true });

  const result = await inspectTfCanaryPublisherPreclaim(
    { repositoryRoot: setup.repositoryRoot, archivePath: setup.archivePath },
    { git: setup.git },
  );

  expect(result.decision).toBe("blocked");
  expect(result.sourceBlockers).toContain("archive_sha256_mismatch");
  expect(result.sourceBlockers).toContain("release_claim_exists");
  expect(await readdir(claim)).toEqual([]);
});

it("blocks a changed operator image tuple before any registry action", async () => {
  const setup = await fixture();
  const changedTargets = tfOnlyOperatorReleaseImageTargets.map((target) =>
    target.name === "tf-web" ? { ...target, target: "changed-runner" } : target,
  );

  const result = await inspectTfCanaryPublisherPreclaim(
    { repositoryRoot: setup.repositoryRoot, archivePath: setup.archivePath },
    {
      git: setup.git,
      expectedArchiveSha256: setup.archiveSha256,
      imageTargets: changedTargets,
    },
  );

  expect(result.sourceBlockers).toContain("image_tuple_mismatch");
  expect(result.decision).toBe("blocked");
  expect(await readdir(setup.repositoryRoot)).toEqual(["source.tar"]);
});

it("includes the external Redis digest in the frozen image catalog", async () => {
  const setup = await fixture();
  const changedCatalog = tfOnlyReleaseImageCatalog.map((entry) =>
    entry.name === "redis"
      ? { ...entry, reference: "docker.io/library/redis:changed" }
      : entry,
  );

  const result = await inspectTfCanaryPublisherPreclaim(
    { repositoryRoot: setup.repositoryRoot, archivePath: setup.archivePath },
    {
      git: setup.git,
      expectedArchiveSha256: setup.archiveSha256,
      imageCatalog: changedCatalog,
    },
  );

  expect(result.sourceBlockers).toContain("image_tuple_mismatch");
});

it("does not let the proposed one-use ID bypass native preclaim admission", async () => {
  const setup = await fixture();
  const common = {
    mode: "production" as const,
    releaseId: tfCanaryPublisherCandidate.releaseId,
    repositoryRoot: setup.repositoryRoot,
    sourceCommit: tfCanaryPublisherCandidate.sourceCommit,
    tfWebApiOrigin: tfCanaryPublisherCandidate.tfWebApiOrigin,
  };

  await expect(prepareTfOnlyOperatorRelease(common)).rejects.toThrow(
    "publisher_preflight_required",
  );
  await expect(
    publishTfOnlyOperatorRelease({ ...common, receiptPath: "not-created" }),
  ).rejects.toThrow("publisher_preflight_required");
  await expect(prepareOperatorRelease(common)).rejects.toThrow(
    "publisher_preflight_required",
  );
  await expect(
    publishOperatorRelease({ ...common, receiptPath: "not-created" }),
  ).rejects.toThrow("publisher_preflight_required");
  expect(await readdir(setup.repositoryRoot)).toEqual(["source.tar"]);
});

it("pins the candidate archive hash to the actual selected Git object", async () => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const result = await execFileAsync(
    "git",
    ["archive", "--format=tar", tfCanaryPublisherCandidate.sourceCommit],
    { cwd: repositoryRoot, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  expect(createHash("sha256").update(result.stdout).digest("hex")).toBe(
    tfCanaryPublisherCandidate.archiveSha256,
  );
});
