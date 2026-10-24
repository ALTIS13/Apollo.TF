import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const accountDirectory = dirname(fileURLToPath(import.meta.url));
const helperPath = resolve(accountDirectory, "generate-account-keys.mjs");
const syntheticLegacySecret =
  "c3ludGhldGljLWFwb2xsby1rZXktdGVzdC0wMDAx";

test("writes compatible key material from stdin without exposing a secret", () => {
  const root = mkdtempSync(resolve(tmpdir(), "apollo-account-keygen-"));
  const outputDirectory = resolve(root, "generated");
  const helperArguments = [
    helperPath,
    "--output-directory",
    outputDirectory,
  ];

  try {
    assert.equal(helperArguments.includes(syntheticLegacySecret), false);
    const result = spawnSync(process.execPath, helperArguments, {
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
      input: `${syntheticLegacySecret}\n`,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(readdirSync(outputDirectory).sort(), [
      "account_jwt_keys",
      "account_legacy_jwt_secret",
      "account_publishable_key",
    ]);
    if (process.platform !== "win32") {
      assert.equal(statSync(outputDirectory).mode & 0o777, 0o700);
      for (const name of readdirSync(outputDirectory)) {
        assert.equal(statSync(resolve(outputDirectory, name)).mode & 0o777, 0o600);
      }
    }

    assert.equal(
      readFileSync(resolve(outputDirectory, "account_legacy_jwt_secret"), "utf8"),
      `${syntheticLegacySecret}\n`,
    );
    const serializedKeys = readFileSync(
      resolve(outputDirectory, "account_jwt_keys"),
      "utf8",
    );
    assert.equal(serializedKeys.endsWith("\n"), true);
    const keys = JSON.parse(serializedKeys);
    assert.equal(Array.isArray(keys), true);
    assert.equal(keys.length, 2);
    const [asymmetricKey, legacyKey] = keys;
    assert.deepEqual(
      {
        alg: asymmetricKey.alg,
        crv: asymmetricKey.crv,
        ext: asymmetricKey.ext,
        key_ops: asymmetricKey.key_ops,
        kty: asymmetricKey.kty,
        use: asymmetricKey.use,
      },
      {
        alg: "ES256",
        crv: "P-256",
        ext: true,
        key_ops: ["sign", "verify"],
        kty: "EC",
        use: "sig",
      },
    );
    for (const coordinate of ["kid", "x", "y", "d"]) {
      assert.match(asymmetricKey[coordinate], /^[A-Za-z0-9_-]+$/);
    }
    assert.deepEqual(legacyKey, {
      alg: "HS256",
      k: Buffer.from(syntheticLegacySecret).toString("base64url"),
      kty: "oct",
    });

    const privateKey = createPrivateKey({ format: "jwk", key: asymmetricKey });
    const publicJwk = createPublicKey(privateKey).export({ format: "jwk" });
    assert.equal("d" in publicJwk, false);
    const payload = Buffer.from("synthetic-signature-contract");
    const signature = sign("sha256", payload, {
      dsaEncoding: "ieee-p1363",
      key: privateKey,
    });
    assert.equal(
      verify(
        "sha256",
        payload,
        { dsaEncoding: "ieee-p1363", key: createPublicKey(privateKey) },
        signature,
      ),
      true,
    );

    const publishableKey = readFileSync(
      resolve(outputDirectory, "account_publishable_key"),
      "utf8",
    ).trimEnd();
    assert.match(publishableKey, /^sb_publishable_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{8}$/);
    const checksumSeparator = publishableKey.lastIndexOf("_");
    const intermediate = publishableKey.slice(0, checksumSeparator);
    const expectedChecksum = createHash("sha256")
      .update(`supabase-self-hosted|${intermediate}`)
      .digest("base64url")
      .slice(0, 8);
    assert.equal(publishableKey.slice(checksumSeparator + 1), expectedChecksum);

    for (const secret of [
      syntheticLegacySecret,
      serializedKeys.trimEnd(),
      publishableKey,
    ]) {
      assert.equal(result.stdout.includes(secret), false);
      assert.equal(result.stderr.includes(secret), false);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects a generic base64 secret that is not the documented 30-byte shape", () => {
  const root = mkdtempSync(resolve(tmpdir(), "apollo-account-keygen-invalid-"));
  const outputDirectory = resolve(root, "generated");
  const invalidSyntheticSecret =
    "U3ludGhldGljLVRlc3QtT25seS1MZWdhY3ktU2VjcmV0LTE=";

  try {
    const result = spawnSync(
      process.execPath,
      [helperPath, "--output-directory", outputDirectory],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: "" },
        input: `${invalidSyntheticSecret}\n`,
      },
    );

    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes(invalidSyntheticSecret), false);
    assert.throws(() => statSync(outputDirectory));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("refuses an existing output path without changing or disclosing it", () => {
  const root = mkdtempSync(resolve(tmpdir(), "apollo-account-keygen-existing-"));
  const outputDirectory = resolve(root, "generated");
  const sentinelPath = resolve(outputDirectory, "operator-sentinel");
  mkdirSync(outputDirectory);
  writeFileSync(sentinelPath, "preserve\n");

  try {
    const result = spawnSync(
      process.execPath,
      [helperPath, "--output-directory", outputDirectory],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: "" },
        input: `${syntheticLegacySecret}\n`,
      },
    );

    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes(syntheticLegacySecret), false);
    assert.deepEqual(readdirSync(outputDirectory), ["operator-sentinel"]);
    assert.equal(readFileSync(sentinelPath, "utf8"), "preserve\n");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
