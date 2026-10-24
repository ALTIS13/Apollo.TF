#!/usr/bin/env node

import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { constants, readFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const USAGE =
  "usage: generate-account-keys.mjs --output-directory NEW_DIRECTORY";
const PUBLISHABLE_PREFIX = "sb_publishable_";
const PROJECT_REF = "supabase-self-hosted";

class InputError extends Error {}

function parseArguments(argumentsList) {
  if (
    argumentsList.length !== 2 ||
    argumentsList[0] !== "--output-directory" ||
    argumentsList[1] === ""
  ) {
    throw new InputError(USAGE);
  }
  return resolve(argumentsList[1]);
}

async function assertNewOutputDirectory(outputDirectory) {
  const requestedParent = dirname(outputDirectory);
  const parentMetadata = await lstat(requestedParent).catch(() => undefined);
  if (
    parentMetadata === undefined ||
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink()
  ) {
    throw new InputError("output parent must be an existing non-symlink directory");
  }
  const canonicalParent = await realpath(requestedParent);
  const canonicalOutput = join(canonicalParent, basename(outputDirectory));
  const existingMetadata = await lstat(canonicalOutput).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (existingMetadata !== undefined) {
    throw new InputError("output directory must not already exist");
  }
  return canonicalOutput;
}

async function readLegacySecretFromStdin() {
  const input = readFileSync(0, { encoding: "utf8" });
  if (input.length > 512) {
    throw new InputError("stdin must contain one valid legacy secret line");
  }
  const value = input.endsWith("\n") ? input.slice(0, -1) : input;
  if (
    value.includes("\n") ||
    value.includes("\r") ||
    !/^[A-Za-z0-9+/]{40}$/.test(value)
  ) {
    throw new InputError(
      "stdin must contain one 30-byte base64 legacy secret line",
    );
  }
  return value;
}

function generateKeyMaterial(legacySecret) {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privateJwk = privateKey.export({ format: "jwk" });
  const kid = randomUUID();
  const keys = [
    {
      kty: "EC",
      kid,
      use: "sig",
      key_ops: ["sign", "verify"],
      alg: "ES256",
      ext: true,
      crv: privateJwk.crv,
      x: privateJwk.x,
      y: privateJwk.y,
      d: privateJwk.d,
    },
    {
      kty: "oct",
      k: Buffer.from(legacySecret).toString("base64url"),
      alg: "HS256",
    },
  ];
  const randomPart = randomBytes(17).toString("base64url").slice(0, 22);
  const intermediate = `${PUBLISHABLE_PREFIX}${randomPart}`;
  const checksum = createHash("sha256")
    .update(`${PROJECT_REF}|${intermediate}`)
    .digest("base64url")
    .slice(0, 8);
  return {
    account_jwt_keys: `${JSON.stringify(keys)}\n`,
    account_legacy_jwt_secret: `${legacySecret}\n`,
    account_publishable_key: `${intermediate}_${checksum}\n`,
  };
}

async function writeClosedFile(path, contents) {
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  );
  try {
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function run() {
  const outputDirectory = await assertNewOutputDirectory(
    parseArguments(process.argv.slice(2)),
  );
  const legacySecret = await readLegacySecretFromStdin();
  const keyMaterial = generateKeyMaterial(legacySecret);
  const temporaryDirectory = join(
    dirname(outputDirectory),
    `.${basename(outputDirectory)}.incomplete-${randomUUID()}`,
  );
  let temporaryCreated = false;
  try {
    await mkdir(temporaryDirectory, { mode: 0o700 });
    temporaryCreated = true;
    for (const [name, contents] of Object.entries(keyMaterial)) {
      await writeClosedFile(join(temporaryDirectory, name), contents);
    }
    await rename(temporaryDirectory, outputDirectory);
    temporaryCreated = false;
  } finally {
    if (temporaryCreated) {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }
}

try {
  await run();
} catch (error) {
  if (error instanceof InputError) {
    console.error(error.message);
    process.exitCode = 2;
  } else {
    console.error("key material generation failed");
    process.exitCode = 1;
  }
}
