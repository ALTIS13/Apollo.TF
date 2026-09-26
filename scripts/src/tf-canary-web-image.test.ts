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
  options: {
    repoDigests?: string[];
    includeIndex?: boolean;
    unusedJs?: string;
    imageSize?: number;
    createOutput?: string;
    indexHtml?: string;
  } = {},
) {
  const commands: string[][] = [];
  let createdName: string | undefined;
  const run = async (args: readonly string[]): Promise<string> => {
    commands.push([...args]);
    if (args[0] === "pull") return "";
    if (args[0] === "image" && args[1] === "inspect") {
      return args[3] === "{{.Size}}"
        ? String(options.imageSize ?? 40 * 1024 * 1024)
        : JSON.stringify(options.repoDigests ?? [imageReference]);
    }
    if (args[0] === "create") {
      createdName = args[args.indexOf("--name") + 1];
      return options.createOutput ?? containerId;
    }
    if (args[0] === "ps") return `${containerId} ${createdName}\n`;
    if (args[0] === "cp") {
      const root = args[2]!;
      await mkdir(join(root, "assets"));
      if (options.includeIndex !== false) {
        await writeFile(
          join(root, "index.html"),
          options.indexHtml ??
            '<script type="module" src="/assets/index.js"></script>',
        );
      }
      await writeFile(join(root, "assets", "index.js"), js);
      if (options.unusedJs !== undefined) {
        await writeFile(join(root, "assets", "unused.js"), options.unusedJs);
      }
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
    const docker = dockerWithBundle(`const api="${canaryOrigin}/api";`, {
      repoDigests: [`ghcr.io/altis13/apollo-tf-web@sha256:${"d".repeat(64)}`],
    });

    await expect(
      imageVerifier.inspectTfWebImage(artifact(), canaryOrigin, docker.run),
    ).rejects.toThrow("tf_web_digest_mismatch");
    expect(docker.commands.some(([command]) => command === "create")).toBe(
      false,
    );
  });

  it("rejects an incomplete copied web bundle with a stable error", async () => {
    const docker = dockerWithBundle(`const api="${canaryOrigin}/api";`, {
      includeIndex: false,
    });

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

  it("rejects an origin present only in an unused JavaScript asset", async () => {
    const docker = dockerWithBundle(
      'const api="https://api.canary.other.apollot.ru/api";',
      {
        unusedJs: `const unused="${canaryOrigin}/api";`,
      },
    );

    await expect(
      imageVerifier.inspectTfWebImage(artifact(), canaryOrigin, docker.run),
    ).rejects.toThrow("unsafe_tf_web_bundle");
  });

  it("does not count a script inside a non-executing HTML template", async () => {
    const docker = dockerWithBundle(
      'const api="https://api.canary.other.apollot.ru/api";',
      {
        unusedJs: `const unused="${canaryOrigin}/api";`,
        indexHtml:
          '<script type="module" src="/assets/index.js"></script><template><script type="module" src="/assets/unused.js"></script></template>',
      },
    );

    await expect(
      imageVerifier.inspectTfWebImage(artifact(), canaryOrigin, docker.run),
    ).rejects.toThrow("unsafe_tf_web_bundle");
  });

  it("rejects an oversized image before creating or copying a container", async () => {
    const docker = dockerWithBundle(`const api="${canaryOrigin}/api";`, {
      imageSize: 1024 * 1024 * 1024,
    });

    await expect(
      imageVerifier.inspectTfWebImage(artifact(), canaryOrigin, docker.run),
    ).rejects.toThrow("tf_web_image_too_large");
    expect(docker.commands.some(([command]) => command === "create")).toBe(
      false,
    );
  });

  it("reconciles an owned container when create returns an invalid ID", async () => {
    const docker = dockerWithBundle(`const api="${canaryOrigin}/api";`, {
      createOutput: "incomplete",
    });

    await expect(
      imageVerifier.inspectTfWebImage(artifact(), canaryOrigin, docker.run),
    ).rejects.toThrow("tf_web_container_id_invalid");
    const create = docker.commands.find(([command]) => command === "create")!;
    const label = create[create.indexOf("--label") + 1]!;
    expect(label).toMatch(/^org\.apollo\.tf\.inspection=[0-9a-f-]{36}$/);
    expect(docker.commands.find(([command]) => command === "ps")).toContain(
      `label=${label}`,
    );
    expect(docker.commands).toContainEqual(["rm", containerId]);
  });
});
