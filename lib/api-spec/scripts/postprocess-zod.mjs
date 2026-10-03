import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const generatedSchemaPath = path.resolve(
  packageDirectory,
  "..",
  "api-zod",
  "src",
  "generated",
  "api.ts",
);

function replaceOnce(source, search, replacement, label) {
  const occurrences = source.split(search).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Cannot enforce ${label}: expected one generated match, found ${occurrences}`,
    );
  }
  return source.replace(search, replacement);
}

let generated = await readFile(generatedSchemaPath, "utf8");

const requestStart = "export const SearchTracksBody = zod.object({";
const requestEnd = "\n});\n\nexport const searchTracksResponseSourcesMax";
const requestStartIndex = generated.indexOf(requestStart);
const requestEndIndex = generated.indexOf(
  requestEnd,
  requestStartIndex + requestStart.length,
);
if (requestStartIndex === -1 || requestEndIndex === -1) {
  throw new Error("Cannot locate the generated SearchTracksBody block");
}

let requestSchema = generated.slice(requestStartIndex, requestEndIndex);
requestSchema = replaceOnce(
  requestSchema,
  "  artist: zod\n    .string()",
  "  artist: zod\n    .string()\n    .trim()",
  "trimmed search artist",
);
requestSchema = replaceOnce(
  requestSchema,
  "  title: zod\n    .string()",
  "  title: zod\n    .string()\n    .trim()",
  "trimmed search title",
);
requestSchema = replaceOnce(
  requestSchema,
  "maxResults: zod.number()",
  "maxResults: zod\n    .number()\n    .int()",
  "integer search maxResults",
);
requestSchema = replaceOnce(
  requestSchema,
  `    .max(searchTracksBodySourcesMax)
    .optional(),`,
  `    .max(searchTracksBodySourcesMax)
    .refine((sources) => new Set(sources).size === sources.length, {
      message: "Sources must be unique",
    })
    .optional(),`,
  "unique request sources",
);
generated =
  generated.slice(0, requestStartIndex) +
  requestSchema +
  generated.slice(requestEndIndex);

generated = replaceOnce(
  generated,
  "    .max(searchTracksResponseSourcesMax),",
  `    .max(searchTracksResponseSourcesMax)
    .refine((sources) => new Set(sources).size === sources.length, {
      message: "Sources must be unique",
    }),`,
  "unique response sources",
);

// Orval 8.5 emits number() for OpenAPI integers. Limit corrections to TF collections.
for (const schemaName of [
  "ListLikedTracksQueryParams",
  "ListLikedTracksResponse",
  "SaveLikedTrackBody",
  "SaveLikedTrackResponse",
]) {
  const start = generated.indexOf(`export const ${schemaName} =`);
  if (start === -1) throw new Error(`Cannot locate ${schemaName}`);
  const nextExport = generated.indexOf("\nexport const ", start + 1);
  const end = nextExport === -1 ? generated.length : nextExport;
  let schema = generated.slice(start, end);
  schema = replaceOnce(
    schema,
    ".number()",
    ".number().int()",
    `${schemaName} integer`,
  );
  if (schemaName === "SaveLikedTrackBody") {
    for (const field of ["artist", "title"]) {
      schema = replaceOnce(
        schema,
        `${field}: zod.string()`,
        `${field}: zod.string().trim()`,
        `trimmed collection ${field}`,
      );
    }
  }
  generated = generated.slice(0, start) + schema + generated.slice(end);
}

await writeFile(generatedSchemaPath, generated, "utf8");
