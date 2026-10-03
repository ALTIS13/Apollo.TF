import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import type { TfAuthRuntimeConfig } from "./platform-auth-client.js";
export const runtimeAuthConfig = (): TfAuthRuntimeConfig => ({
  nodeEnv: "production",
  issuer: "https://api.apollot.ru",
  apiOrigin: "https://api.apollot.ru",
  allowPrivateHttpTransport: false,
  clientId: "apollo-tf-api",
  clientSecret: "test-only-confidential-secret",
  callbackUrl: "https://api.tf.apollot.ru/api/auth/callback",
  webOrigin: "https://tf.apollot.ru",
  authRedisUrl: "redis://tf-redis:6379/1",
});
export function mountedKeyring(
  source = JSON.stringify({
    version: 1,
    purpose: "apollo-tf-revoke-only",
    active: "current",
    keys: [{ id: "current", key: randomBytes(32).toString("base64url") }],
  }),
  metadata: Record<string, unknown> = {},
) {
  const bytes = Buffer.from(source);
  let offset = 0;
  const close = vi.fn(async () => {});
  const openFile = vi.fn(async (_path: string, _flags: number) => ({
    stat: async () => ({
      isFile: () => true,
      size: bytes.length,
      uid: 10001,
      mode: 0o100400,
      dev: 1,
      ino: 2,
      mtimeMs: 0,
      ...metadata,
    }),
    read: async (
      buffer: Uint8Array,
      start: number,
      length: number,
      _position: null,
    ) => {
      const count = Math.min(length, bytes.length - offset);
      buffer.set(bytes.subarray(offset, offset + count), start);
      offset += count;
      return { bytesRead: count };
    },
    close,
  }));
  return { dependencies: { openFile, ownerUid: 10001 }, openFile, close };
}
