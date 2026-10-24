import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadTfRenewalRuntimeConfig } from "./tf-renewal-runtime-config.js";
import {
  mountedKeyring,
  runtimeAuthConfig,
} from "./tf-renewal-runtime-test-support.js";
const enabled = {
  APOLLO_TF_RENEWAL_ENABLED: "true",
  APOLLO_TF_REVOKE_KEYRING_FILE: "/run/secrets/tf_revoke_keyring",
  APOLLO_TF_CLIENT_SECRET_FILE: "/run/secrets/tf_client_secret",
};
describe("TF renewable runtime configuration", () => {
  it.each([undefined, "false"])(
    "disabled %s does not open key material or constrain existing legacy transport",
    async (flag) => {
      const f = mountedKeyring();
      const result = await loadTfRenewalRuntimeConfig(
        { APOLLO_TF_RENEWAL_ENABLED: flag },
        {
          ...runtimeAuthConfig(),
          apiOrigin: "http://platform-api:8080",
          allowPrivateHttpTransport: true,
        },
        f.dependencies,
      );
      expect(result.enabled).toBe(false);
      expect(f.openFile).not.toHaveBeenCalled();
    },
  );
  it.each(["", "TRUE", "1", " true"])(
    "rejects malformed explicit opt-in %s",
    async (flag) => {
      await expect(
        loadTfRenewalRuntimeConfig(
          { ...enabled, APOLLO_TF_RENEWAL_ENABLED: flag },
          runtimeAuthConfig(),
          mountedKeyring().dependencies,
        ),
      ).rejects.toThrow("TF renewal configuration is invalid");
    },
  );
  it.each([
    { apiOrigin: "http://platform-api:8080", allowPrivateHttpTransport: true },
    { allowPrivateHttpTransport: true },
    { issuer: "https://127.0.0.1", apiOrigin: "https://127.0.0.1" },
    { apiOrigin: "https://other.apollot.ru" },
    { webOrigin: "http://localhost:5173" },
    { callbackUrl: "https://api.tf.apollot.ru/wrong" },
    { bridgePkceVerifier: "a".repeat(43) },
  ])(
    "rejects an enabled incompatible authority/transport profile %j",
    async (override) => {
      const f = mountedKeyring();
      await expect(
        loadTfRenewalRuntimeConfig(
          enabled,
          { ...runtimeAuthConfig(), ...override },
          f.dependencies,
        ),
      ).rejects.toThrow("TF renewal configuration is invalid");
      expect(f.openFile).not.toHaveBeenCalled();
    },
  );
  it("loads only a bounded purpose-specific mounted keyring and closes the no-follow descriptor", async () => {
    const f = mountedKeyring();
    expect(
      (
        await loadTfRenewalRuntimeConfig(
          enabled,
          runtimeAuthConfig(),
          f.dependencies,
        )
      ).enabled,
    ).toBe(true);
    if (constants.O_NOFOLLOW !== undefined)
      expect(f.openFile.mock.calls[0]![1] & constants.O_NOFOLLOW).toBe(
        constants.O_NOFOLLOW,
      );
    expect(f.close).toHaveBeenCalledOnce();
  });
  it.each(["relative", "/run/secrets/tf_client_secret", " /run/secrets/key"])(
    "rejects unsafe or reused file path %s before open",
    async (path) => {
      const f = mountedKeyring();
      await expect(
        loadTfRenewalRuntimeConfig(
          { ...enabled, APOLLO_TF_REVOKE_KEYRING_FILE: path },
          runtimeAuthConfig(),
          f.dependencies,
        ),
      ).rejects.toThrow("TF renewal configuration is invalid");
      expect(f.openFile).not.toHaveBeenCalled();
    },
  );
  it.each([
    { uid: 0 },
    { mode: 0o100440 },
    { mode: 0o100600 },
    { size: 4097 },
    { isFile: () => false },
  ])(
    "rejects unsafe mounted metadata and closes descriptor",
    async (metadata) => {
      const f = mountedKeyring(undefined, metadata);
      await expect(
        loadTfRenewalRuntimeConfig(
          enabled,
          runtimeAuthConfig(),
          f.dependencies,
        ),
      ).rejects.toThrow("TF renewal configuration is invalid");
      expect(f.close).toHaveBeenCalledOnce();
    },
  );
  it.each([
    "purpose",
    "duplicate-id",
    "duplicate-material",
    "unknown-field",
    "duplicate-json",
    "noncanonical",
    "missing-active",
    "too-many",
    "client-secret",
  ])("rejects malformed or reused key material: %s", async (mutation) => {
    const key = randomBytes(32).toString("base64url");
    const value = {
      version: 1,
      purpose: "apollo-tf-revoke-only",
      active: "current",
      keys: [{ id: "current", key }],
    };
    if (mutation === "purpose") value.purpose = "platform-vault";
    if (mutation === "duplicate-id")
      value.keys.push({
        id: "current",
        key: randomBytes(32).toString("base64url"),
      });
    if (mutation === "duplicate-material") value.keys.push({ id: "old", key });
    if (mutation === "noncanonical") value.keys[0]!.key += "=";
    if (mutation === "missing-active") value.active = "missing";
    if (mutation === "too-many")
      for (let i = 0; i < 4; i++)
        value.keys.push({
          id: `old${i}`,
          key: randomBytes(32).toString("base64url"),
        });
    const raw =
      mutation === "duplicate-json"
        ? JSON.stringify(value).replace(
            '"version":1',
            '"version":1,"version":1',
          )
        : JSON.stringify(
            mutation === "unknown-field" ? { ...value, extra: true } : value,
          );
    const config = {
      ...runtimeAuthConfig(),
      ...(mutation === "client-secret" ? { clientSecret: key } : {}),
    };
    await expect(
      loadTfRenewalRuntimeConfig(
        enabled,
        config,
        mountedKeyring(raw).dependencies,
      ),
    ).rejects.toThrow("TF renewal configuration is invalid");
  });
  it("rejects inline key configuration and redacts filesystem/parser errors", async () => {
    await expect(
      loadTfRenewalRuntimeConfig(
        { ...enabled, APOLLO_TF_REVOKE_KEYRING_JSON: "secret" },
        runtimeAuthConfig(),
        mountedKeyring().dependencies,
      ),
    ).rejects.toThrow("TF renewal configuration is invalid");
    const f = mountedKeyring();
    f.openFile.mockRejectedValueOnce(new Error("secret /private/key/path"));
    try {
      await loadTfRenewalRuntimeConfig(
        enabled,
        runtimeAuthConfig(),
        f.dependencies,
      );
      throw new Error("unexpected success");
    } catch (error) {
      expect(String(error)).toBe("Error: TF renewal configuration is invalid");
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
