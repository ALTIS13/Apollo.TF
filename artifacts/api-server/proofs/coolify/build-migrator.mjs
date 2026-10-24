import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Bundle the existing CLI, not a second migration implementation.
await build({
  entryPoints: [
    fileURLToPath(new URL("../../src/migrate.ts", import.meta.url)),
  ],
  outfile: fileURLToPath(new URL("./migrate.mjs", import.meta.url)),
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["pg-native"],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
