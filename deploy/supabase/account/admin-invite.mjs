#!/usr/bin/env node

import {
  createPrivateKey,
  randomUUID,
  sign,
} from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const USAGE =
  "usage: admin-invite.mjs --gateway-url http://127.0.0.1:PORT " +
  "--secret-directory PATH --email NAME@staging.invalid";

function fail(message, exitCode = 2) {
  console.error(message);
  process.exitCode = exitCode;
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(USAGE);
    }
    if (values.has(name)) throw new Error(`duplicate argument: ${name}`);
    values.set(name, value);
  }
  for (const name of ["--gateway-url", "--secret-directory", "--email"]) {
    if (!values.has(name)) throw new Error(`${USAGE}\nmissing ${name}`);
  }
  if (values.size !== 3) throw new Error(USAGE);
  return {
    email: values.get("--email"),
    gatewayUrl: values.get("--gateway-url"),
    secretDirectory: values.get("--secret-directory"),
  };
}

function validateInputs({ email, gatewayUrl, secretDirectory }) {
  if (
    email.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@staging\.invalid$/.test(email)
  ) {
    throw new Error("email must end with @staging.invalid");
  }
  const url = new URL(gatewayUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port === "" ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("gateway URL must be loopback HTTP with an explicit port");
  }
  return {
    email,
    gatewayUrl: url.origin,
    secretDirectory: resolve(secretDirectory),
  };
}

async function readRegularSecret(secretDirectory, name) {
  const path = resolve(secretDirectory, name);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${name} must be a regular non-symlink file`);
  }
  const value = (await readFile(path, "utf8")).trim();
  if (value === "" || value.includes("\n") || value.includes("\r")) {
    throw new Error(`${name} must contain exactly one non-empty line`);
  }
  return value;
}

function selectPrivateSigningKey(serializedKeys) {
  let keys;
  try {
    keys = JSON.parse(serializedKeys);
  } catch {
    throw new Error("account_jwt_keys must be valid JSON");
  }
  if (!Array.isArray(keys)) {
    throw new Error("account_jwt_keys must be a JSON array");
  }
  const key = keys.find(
    (candidate) =>
      candidate?.kty === "EC" &&
      candidate?.crv === "P-256" &&
      candidate?.alg === "ES256" &&
      typeof candidate?.kid === "string" &&
      candidate.kid !== "" &&
      typeof candidate?.d === "string" &&
      (!Array.isArray(candidate.key_ops) || candidate.key_ops.includes("sign")),
  );
  if (key === undefined) {
    throw new Error("account_jwt_keys has no sign-capable ES256 private key");
  }
  return key;
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createAdminAssertion(jwk) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encodedHeader = encodeJson({ alg: "ES256", kid: jwk.kid, typ: "JWT" });
  const encodedPayload = encodeJson({
    exp: issuedAt + 300,
    iat: issuedAt,
    iss: "supabase",
    jti: randomUUID(),
    role: "service_role",
  });
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    dsaEncoding: "ieee-p1363",
    key: createPrivateKey({ format: "jwk", key: jwk }),
  }).toString("base64url");
  return `${signingInput}.${signature}`;
}

async function run() {
  const input = validateInputs(parseArguments(process.argv.slice(2)));
  const [serializedKeys, publishableKey] = await Promise.all([
    readRegularSecret(input.secretDirectory, "account_jwt_keys"),
    readRegularSecret(input.secretDirectory, "account_publishable_key"),
  ]);
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,128}$/.test(publishableKey)) {
    throw new Error("account_publishable_key has an invalid format");
  }
  const adminAssertion = createAdminAssertion(
    selectPrivateSigningKey(serializedKeys),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${input.gatewayUrl}/auth/v1/invite`, {
      body: JSON.stringify({ email: input.email }),
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${adminAssertion}`,
        "cache-control": "no-store",
        "content-type": "application/json",
        "x-client-info": "apollo-account-staging-admin/1.0",
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status !== 200) {
      throw new Error(`invite request failed with HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
  console.log(`invite accepted for ${input.email}`);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  const inputError =
    message === USAGE ||
    message.startsWith(`${USAGE}\n`) ||
    message.startsWith("duplicate argument") ||
    message.startsWith("email must") ||
    message.startsWith("gateway URL must");
  fail(message, inputError ? 2 : 1);
}
