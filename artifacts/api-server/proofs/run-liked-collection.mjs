import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env };
// This runner must never turn a missing proof URL into an ambient DB connection or a skip.
delete env.DATABASE_URL;
if (!env.TF_TEST_RUNTIME_DATABASE_URL || !env.TF_TEST_RUN_ID) {
  process.stderr.write(
    "Set TF_TEST_RUNTIME_DATABASE_URL and TF_TEST_RUN_ID for the disposable PostgreSQL 17 proof.\n",
  );
  process.exit(2);
}

const vitest = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const result = spawnSync(
  process.execPath,
  [
    vitest,
    "run",
    "src/routes/collections.integration.test.ts",
    "--maxWorkers=1",
    "--reporter=verbose",
    "--testTimeout=30000",
  ],
  { cwd, env, stdio: "inherit" },
);
if (result.error || result.signal) {
  process.stderr.write(
    "TF liked collection proof process failed to complete.\n",
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
