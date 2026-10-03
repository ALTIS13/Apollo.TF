import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dockerIgnore from "@balena/dockerignore";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const roots = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".dockerignore",
  "tsconfig.base.json",
  "tsconfig.json",
  "lib",
  "artifacts/api-server",
];
const mode = process.argv[2];
const revision =
  mode === "git" ? process.argv[3] : process.env.TF_PROOF_SOURCE_REVISION;
const git = (...args) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
try {
  if (
    !/^[0-9a-f]{40}$/.test(revision ?? "") ||
    !["git", "image", "check"].includes(mode)
  )
    throw new Error("input");
  const fromGit = (path) => git("show", `${revision}:${path}`);
  const ignored = dockerIgnore().add(
    (mode === "git"
      ? fromGit(".dockerignore")
      : readFileSync(`${root}/.dockerignore`)
    ).toString("utf8"),
  );
  let paths;
  if (mode === "git") {
    if (
      git("rev-parse", "HEAD").toString().trim() !== revision ||
      git("status", "--porcelain").length
    )
      throw new Error("checkout");
    paths = git("ls-tree", "-rz", "--name-only", revision, "--", ...roots)
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } else {
    paths = roots.filter(
      (path) => !["lib", "artifacts/api-server"].includes(path),
    );
    const walk = (directory) => {
      for (const entry of readdirSync(`${root}/${directory}`, {
        withFileTypes: true,
      })) {
        const path = `${directory}/${entry.name}`;
        if (ignored.ignores(path + (entry.isDirectory() ? "/" : ""))) continue;
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile()) paths.push(path);
        else throw new Error("unsupported source entry");
      }
    };
    walk("lib");
    walk("artifacts/api-server");
  }
  const hash = createHash("sha256");
  for (const path of paths.filter((path) => !ignored.ignores(path)).sort()) {
    const raw =
      mode === "git" ? fromGit(path) : readFileSync(`${root}/${path}`);
    // Canonical UTF-8/LF allows a Windows checkout and Linux Git clone to agree.
    const contents = new TextDecoder("utf-8", { fatal: true })
      .decode(raw)
      .replaceAll("\r\n", "\n");
    hash
      .update(path)
      .update("\0")
      .update(createHash("sha256").update(contents).digest())
      .update("\0");
  }
  const digest = hash.digest("hex");
  if (mode !== "git" && digest !== process.env.TF_PROOF_SOURCE_DIGEST)
    throw new Error("source mismatch");
  if (mode === "image") {
    writeFileSync(`${root}/proof-source-revision`, revision);
    writeFileSync(`${root}/proof-source-digest`, digest);
  }
  process.stdout.write(
    `${JSON.stringify({ event: "tf_proof_source_verified", sourceRevision: revision, sourceDigest: digest, mode })}\n`,
  );
} catch {
  process.stderr.write(
    "TF proof source verification failed: require the clean approved checkout and matching source digest.\n",
  );
  process.exitCode = 2;
}
