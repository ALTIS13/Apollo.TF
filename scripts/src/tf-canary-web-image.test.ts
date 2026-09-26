import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { TfOnlyReleaseArtifact } from "./release-images.js";
import * as imageVerifier from "./tf-canary-web-image.js";

const canaryOrigin = "https://api.canary.tf.apollot.ru";
const imageDigest = `sha256:${"a".repeat(64)}`;
const imageReference = `ghcr.io/altis13/apollo-tf-web@${imageDigest}`;
const containerId = "b".repeat(64);

function artifact(): TfOnlyReleaseArtifact {
  return {
    artifactSet: "tf-only",
    formatVersion: 1,
    images: [
      {
        imageDigest,
        imageReference,
        name: "tf-web",
        repository: "ghcr.io/altis13/apollo-tf-web",
      },
    ],
    sourceCommit: "c".repeat(40),
    tfWebApiOrigin: canaryOrigin,
  };
}

function dockerWithBundle(
  js: string,
  repoDigests = [imageReference],
  includeIndex = true,
) {
  const commands: string[][] = [];
  const run = async (args: readonly string[]): Promise<string> => {
    commands.push([...args]);
    if (args[0] === "pull") return "";
    if (args[0] === "image" && args[1] === "inspect") {
      return JSON.stringify(repoDigests);
    }
    if (args[0] === "create") return containerId;
    if (args[0] === "cp") {
      const root = args[2]!;
      await mkdir(join(root, "assets"));
      if (includeIndex) {
        await writeFile(
          join(root, "index.html"),
          '<script src="/assets/index.js"></script>',
        );
      }
      await writeFile(join(root, "assets", "index.js"), js);
      return "";
    }
    if (args[0] === "rm") return "";
    throw new Error(`unexpected docker command: ${args.join(" ")}`);
  };
  return { commands, run };
}

describe("TF canary web image gate", () => {
  it("inspects the pulled digest and accepts only the bundled canary API origin", async () => {
    expect(typeof imageVerifier.inspectTfWebImage).toBe("function");
    const docker = dockerWithBundle(`const api="${canaryOrigin}/api";`);

    await expect(
      imageVerifier.inspectTfWebImage(artifact(), canaryOrigin, docker.run),
    ).resolves.toEqual({
      apiOrigin: canaryOrigin,
      imageReference,
      jsAssetCount: 1,
    });
    expect(docker.commands).toContainEqual(["pull", "--quiet", imageReference]);
    expect(docker.commands).toContainEqual([
      "image",
      "inspect",
      "--format",
      "{{json .RepoDigests}}",
      imageReference,
    ]);
    expect(
      docker.commands.find(([command]) => command === "create")?.at(-1),
    ).toBe(imageReference);
    expect(docker.commands).toContainEqual(["rm", containerId]);
  });

  it("rejects a mixed canary/production bundle after copying the image", async () => {
    const docker = dockerWithBundle(
      `const api="${canaryOrigin}/api"; const fallback="https://api.tf.apollot.ru/api";`,
    );

    await expect(
      imageVerifier.inspectTfWebImage(artifact(), canaryOrigin, docker.run),
    ).rejects.toThrow("unsafe_tf_web_bundle");
    expect(docker.commands).toContainEqual(["rm", containerId]);
  });

  it("rejects a digest mismatch before creating an inspection container", async () => {
    const docker = dockerWithBundle(`const api="${canaryOrigin}/api";`, [
      `ghcr.io/altis13/apollo-tf-web@sha256:${"d".repeat(64)}`,
    ]);

    await expect(
      imageVerifier.inspectTfWebImage(artifact(), canaryOrigin, docker.run),
    ).rejects.toThrow("tf_web_digest_mismatch");
    expect(docker.commands.some(([command]) => command === "create")).toBe(
      false,
    );
  });

  it("rejects an incomplete copied web bundle with a stable error", async () => {
    const docker = dockerWithBundle(
      `const api="${canaryOrigin}/api";`,
      [imageReference],
      false,
    );

    await expect(
      imageVerifier.inspectTfWebImage(artifact(), canaryOrigin, docker.run),
    ).rejects.toThrow("unsafe_tf_web_bundle");
    expect(docker.commands).toContainEqual(["rm", containerId]);
  });

  it("requires the operator-approved origin independently of the manifest", async () => {
    const docker = dockerWithBundle(`const api="${canaryOrigin}/api";`);

    await expect(
      imageVerifier.inspectTfWebImage(
        artifact(),
        "https://api.canary.other.apollot.ru",
        docker.run,
      ),
    ).rejects.toThrow("tf_web_origin_mismatch");
    expect(docker.commands).toEqual([]);
  });
});
