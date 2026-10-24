import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { TfAuthRuntimeConfig } from "./platform-auth-client.js";
import { opaqueSchema, parseRenewalJson } from "./tf-renewal-contract.js";
import type { TfRenewalOptions } from "./tf-renewal-consumer.js";

const invalid = () => new Error("TF renewal configuration is invalid");
const maximumBytes = 4096;
const keyId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const schema = z
  .object({
    version: z.literal(1),
    purpose: z.literal("apollo-tf-revoke-only"),
    active: keyId,
    keys: z
      .array(z.object({ id: keyId, key: opaqueSchema }).strict())
      .min(1)
      .max(4),
  })
  .strict();
export type TfRenewalRuntimeConfig =
  | { readonly enabled: false }
  | { readonly enabled: true };
const material = new WeakMap<
  TfRenewalRuntimeConfig,
  TfRenewalOptions["revocationKeys"]
>();
export function configuredRevokeKeys(config: TfRenewalRuntimeConfig) {
  const keys = material.get(config);
  if (!config.enabled || !keys) throw invalid();
  return keys;
}
interface Metadata {
  isFile(): boolean;
  size: number;
  uid: number;
  mode: number;
  dev: number;
  ino: number;
  mtimeMs: number;
}
interface MountedFile {
  stat(): Promise<Metadata>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}
export interface TfRenewalConfigDependencies {
  readonly openFile?: (path: string, flags: number) => Promise<MountedFile>;
  readonly ownerUid?: number;
}
function publicHttps(value: string, callback = false) {
  const url = new URL(value);
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (callback
      ? url.href !== value || url.pathname !== "/api/auth/callback"
      : url.origin !== value) ||
    url.port ||
    isIP(host.replace(/^\[|\]$/g, "")) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
  )
    throw invalid();
}
function validateProfile(auth: TfAuthRuntimeConfig) {
  publicHttps(auth.issuer);
  publicHttps(auth.apiOrigin);
  publicHttps(auth.webOrigin);
  publicHttps(auth.callbackUrl, true);
  if (
    auth.issuer !== auth.apiOrigin ||
    auth.allowPrivateHttpTransport ||
    auth.bridgePkceVerifier !== undefined
  )
    throw invalid();
}
function validateMetadata(value: Metadata, ownerUid: number) {
  if (
    !value.isFile() ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > maximumBytes ||
    value.uid !== ownerUid ||
    (value.mode & 0o777) !== 0o400
  )
    throw invalid();
}
async function readMounted(
  path: string,
  dependencies: TfRenewalConfigDependencies,
) {
  const ownerUid = dependencies.ownerUid ?? process.getuid?.();
  if (!Number.isSafeInteger(ownerUid) || ownerUid! < 0) throw invalid();
  const handle = await (dependencies.openFile ?? open)(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const bytes = Buffer.alloc(maximumBytes + 1);
  try {
    const before = await handle.stat();
    validateMetadata(before, ownerUid!);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        total,
        bytes.length - total,
        null,
      );
      if (
        !Number.isSafeInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > bytes.length - total
      )
        throw invalid();
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    validateMetadata(after, ownerUid!);
    if (
      total !== before.size ||
      total !== after.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mtimeMs !== after.mtimeMs
    )
      throw invalid();
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, total),
    );
  } finally {
    bytes.fill(0);
    await handle.close();
  }
}
export async function loadTfRenewalRuntimeConfig(
  env: NodeJS.ProcessEnv,
  auth: TfAuthRuntimeConfig,
  dependencies: TfRenewalConfigDependencies = {},
): Promise<TfRenewalRuntimeConfig> {
  try {
    const flag = env.APOLLO_TF_RENEWAL_ENABLED;
    if (flag !== undefined && flag !== "false" && flag !== "true")
      throw invalid();
    if (
      env.APOLLO_TF_REVOKE_KEYRING !== undefined ||
      env.APOLLO_TF_REVOKE_KEYRING_JSON !== undefined
    )
      throw invalid();
    if (flag !== "true") return Object.freeze({ enabled: false });
    validateProfile(auth);
    const path = env.APOLLO_TF_REVOKE_KEYRING_FILE;
    if (
      !path ||
      path.length > 1024 ||
      path.trim() !== path ||
      !isAbsolute(path) ||
      (env.APOLLO_TF_CLIENT_SECRET_FILE &&
        resolve(path) === resolve(env.APOLLO_TF_CLIENT_SECRET_FILE))
    )
      throw invalid();
    const value = schema.parse(
      parseRenewalJson(await readMounted(path, dependencies)),
    );
    const keys = new Map<string, Uint8Array>(),
      encoded = new Set<string>();
    const forbidden = new Set([
      auth.clientSecret,
      Buffer.from(auth.clientSecret, "utf8").toString("base64url"),
    ]);
    if (/^[a-fA-F0-9]{64}$/.test(auth.clientSecret))
      forbidden.add(
        Buffer.from(auth.clientSecret, "hex").toString("base64url"),
      );
    if (/^[A-Za-z0-9+/]{43}=$/.test(auth.clientSecret))
      forbidden.add(
        Buffer.from(auth.clientSecret, "base64").toString("base64url"),
      );
    for (const entry of value.keys) {
      const key = Buffer.from(entry.key, "base64url");
      if (
        keys.has(entry.id) ||
        encoded.has(entry.key) ||
        forbidden.has(entry.key) ||
        key.length !== 32 ||
        key.toString("base64url") !== entry.key
      )
        throw invalid();
      keys.set(entry.id, key);
      encoded.add(entry.key);
    }
    if (!keys.has(value.active)) throw invalid();
    const config = Object.freeze({ enabled: true as const });
    material.set(config, { active: value.active, keys });
    return config;
  } catch {
    throw invalid();
  }
}
