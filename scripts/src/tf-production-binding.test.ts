import { describe, expect, it } from "vitest";

import { validateTfProductionBinding } from "./tf-production-binding.js";

function binding(enabled: "false" | "true" = "false") {
  return {
    apiEnvironment: {
      APOLLO_PLATFORM_API_ORIGIN: "https://api.apollot.ru",
      APOLLO_PLATFORM_ISSUER: "https://api.apollot.ru",
      APOLLO_TF_AUTH_REDIS_URL_FILE: "/run/secrets/tf_auth_redis_url",
      APOLLO_TF_BRIDGE_ALLOW_INTERNAL_HTTP: "false",
      APOLLO_TF_CALLBACK_URL: "https://api.tf.apollot.ru/api/auth/callback",
      APOLLO_TF_CLIENT_ID: "apollo-tf-api",
      APOLLO_TF_RENEWAL_ENABLED: "true",
      APOLLO_TF_REVOKE_KEYRING_FILE: "/run/secrets/tf_revoke_keyring",
      APOLLO_TF_SUCCESSOR_WS_ENABLED: enabled,
      APOLLO_TF_WEB_ORIGIN: "https://tf.apollot.ru",
      REDIS_URL_FILE: "/run/secrets/tf_cache_redis_url",
    },
    apiSecretTargets: [
      "tf_auth_redis_url",
      "tf_cache_redis_url",
      "tf_revoke_keyring",
    ],
    releaseSelection: enabled,
    webBuildArguments: {
      VITE_API_URL: "https://api.tf.apollot.ru",
      VITE_APOLLO_TF_SUCCESSOR_WS_ENABLED: enabled,
    },
  };
}

describe("TF production binding validator", () => {
  it.each(["false", "true"] as const)(
    "accepts the complete atomic tuple with successor WS %s",
    (enabled) => {
      expect(validateTfProductionBinding(binding(enabled))).toEqual({
        successorWebSocketEnabled: enabled === "true",
      });
    },
  );

  it.each([
    [
      "partial renewal",
      (value: ReturnType<typeof binding>) => {
        Object.assign(value.apiEnvironment, {
          APOLLO_TF_REVOKE_KEYRING_FILE: undefined,
        });
      },
    ],
    [
      "private bridge",
      (value: ReturnType<typeof binding>) => {
        value.apiEnvironment.APOLLO_TF_BRIDGE_ALLOW_INTERNAL_HTTP = "true";
      },
    ],
    [
      "inline auth Redis",
      (value: ReturnType<typeof binding>) => {
        Object.assign(value.apiEnvironment, {
          APOLLO_TF_AUTH_REDIS_URL: "redis://user:password@tf-redis:6379/1",
        });
      },
    ],
    [
      "fixed PKCE",
      (value: ReturnType<typeof binding>) => {
        Object.assign(value.apiEnvironment, {
          APOLLO_TF_BRIDGE_PKCE_VERIFIER_FILE: "/run/secrets/verifier",
        });
      },
    ],
    [
      "missing Redis mount",
      (value: ReturnType<typeof binding>) => {
        value.apiSecretTargets = value.apiSecretTargets.filter(
          (name) => name !== "tf_cache_redis_url",
        );
      },
    ],
    [
      "API/Web mismatch",
      (value: ReturnType<typeof binding>) => {
        value.webBuildArguments.VITE_APOLLO_TF_SUCCESSOR_WS_ENABLED = "true";
      },
    ],
    [
      "release/API mismatch",
      (value: ReturnType<typeof binding>) => {
        value.releaseSelection = "true";
      },
    ],
    [
      "wrong Web API",
      (value: ReturnType<typeof binding>) => {
        value.webBuildArguments.VITE_API_URL = "https://wrong.invalid";
      },
    ],
  ] as const)("rejects %s", (_label, mutate) => {
    const value = binding();
    mutate(value);
    expect(() => validateTfProductionBinding(value)).toThrowError(
      /^TF production binding is invalid$/,
    );
  });
});
