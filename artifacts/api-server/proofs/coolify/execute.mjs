import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const runId = process.env.TF_TEST_RUN_ID;
const revision = process.env.TF_PROOF_SOURCE_REVISION;
const sourceDigest = process.env.TF_PROOF_SOURCE_DIGEST;
const mode = process.argv[2];
const password =
  process.env[
    mode === "migrate"
      ? "TF_PROOF_MIGRATOR_PASSWORD"
      : "TF_PROOF_RUNTIME_PASSWORD"
  ];
let exitCode = 2;
const secretPath = "/tmp/tf-proof-migrator-url";
let secretCreated = false;
try {
  if (
    !/^[a-z0-9][a-z0-9_]{6,30}[a-z0-9]$/.test(runId ?? "") ||
    process.env.TF_PROOF_EXECUTE !== `execute:${runId}` ||
    !/^[0-9a-f]{40}$/.test(revision ?? "") ||
    !/^[0-9a-f]{64}$/.test(sourceDigest ?? "") ||
    !/^[0-9a-f]{64}$/.test(password ?? "") ||
    !["migrate", "proof"].includes(mode) ||
    process.argv.length !== 3 ||
    readFileSync("/app/proof-source-revision", "utf8") !== revision ||
    readFileSync("/app/proof-source-digest", "utf8") !== sourceDigest
  )
    throw new Error("gate");

  // Explicit allowlist: no ambient DB, PG*, admin, migrator or loader settings
  // can leak into the proof child. The DB is always this Application's service.
  const env = {
    PATH: process.env.PATH,
    HOME: "/tmp",
    TMPDIR: "/tmp",
    NO_COLOR: "1",
    CI: "1",
  };
  const role = mode === "migrate" ? "apollo_tf_migrator" : "apollo_tf_runtime";
  const url = `postgresql://${role}:${password}@proof-db:5432/apollo_tf_test_${runId}`;
  let script;
  if (mode === "migrate") {
    writeFileSync(secretPath, url, { flag: "wx", mode: 0o600 });
    secretCreated = true;
    env.TF_MIGRATOR_DATABASE_URL_FILE = secretPath;
    script = fileURLToPath(new URL("./migrate.mjs", import.meta.url));
  } else {
    env.TF_TEST_RUN_ID = runId;
    env.TF_TEST_RUNTIME_DATABASE_URL = url;
    script = fileURLToPath(
      new URL("../run-liked-collection.mjs", import.meta.url),
    );
  }
  const result = spawnSync(process.execPath, [script], {
    env,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const transcript = stripVTControlCharacters(
    `${result.stdout ?? ""}${result.stderr ?? ""}`,
  )
    .replaceAll(password, "[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, "[REDACTED_DATABASE_URL]");
  process.stdout.write(transcript);
  const completed = !result.error && !result.signal && result.status === 0;
  const counts = transcript.match(/^\s*Tests\s+(\d+) passed\s+\((\d+)\)\s*$/m);
  const accepted =
    completed &&
    (mode === "migrate" || (counts?.[1] === "5" && counts[2] === "5"));
  const outcome = {
    event: "tf_liked_proof_outcome",
    mode,
    runId,
    sourceRevision: revision,
    sourceDigest,
    runnerExitCode: result.status,
    signal: result.signal,
    accepted,
    ...(mode === "proof"
      ? {
          passed: counts ? Number(counts[1]) : null,
          skipped: counts && counts[1] === counts[2] ? 0 : null,
        }
      : {}),
    transcriptSha256: createHash("sha256").update(transcript).digest("hex"),
  };
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  exitCode = accepted ? 0 : 1;
} catch {
  process.stderr.write(
    "TF proof Application gate or execution failed; no success evidence produced.\n",
  );
} finally {
  if (secretCreated) {
    try {
      unlinkSync(secretPath);
    } catch {
      exitCode = 1;
    }
  }
}
process.exitCode = exitCode;
