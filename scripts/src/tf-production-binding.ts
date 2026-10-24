export interface TfProductionBindingInput {
  readonly apiEnvironment: Readonly<Record<string, string | undefined>>;
  readonly apiSecretTargets: readonly string[];
  readonly releaseSelection: string;
  readonly webBuildArguments: Readonly<Record<string, string | undefined>>;
}

const requiredApiEnvironment: Readonly<Record<string, string>> = {
  APOLLO_PLATFORM_API_ORIGIN: "https://api.apollot.ru",
  APOLLO_PLATFORM_ISSUER: "https://api.apollot.ru",
  APOLLO_TF_AUTH_REDIS_URL_FILE: "/run/secrets/tf_auth_redis_url",
  APOLLO_TF_BRIDGE_ALLOW_INTERNAL_HTTP: "false",
  APOLLO_TF_CALLBACK_URL: "https://api.tf.apollot.ru/api/auth/callback",
  APOLLO_TF_CLIENT_ID: "apollo-tf-api",
  APOLLO_TF_RENEWAL_ENABLED: "true",
  APOLLO_TF_REVOKE_KEYRING_FILE: "/run/secrets/tf_revoke_keyring",
  APOLLO_TF_WEB_ORIGIN: "https://tf.apollot.ru",
  REDIS_URL_FILE: "/run/secrets/tf_cache_redis_url",
};

const requiredSecretTargets = [
  "tf_auth_redis_url",
  "tf_cache_redis_url",
  "tf_revoke_keyring",
] as const;

const forbiddenApiEnvironment = [
  "APOLLO_TF_AUTH_REDIS_URL",
  "APOLLO_TF_BRIDGE_PKCE_VERIFIER",
  "APOLLO_TF_BRIDGE_PKCE_VERIFIER_FILE",
  "REDIS_URL",
] as const;

const invalid = () => new Error("TF production binding is invalid");

export function validateTfProductionBinding(input: TfProductionBindingInput): {
  readonly successorWebSocketEnabled: boolean;
} {
  try {
    if (
      input.releaseSelection !== "false" &&
      input.releaseSelection !== "true"
    ) {
      throw invalid();
    }
    for (const [name, value] of Object.entries(requiredApiEnvironment)) {
      if (input.apiEnvironment[name] !== value) throw invalid();
    }
    for (const name of forbiddenApiEnvironment) {
      if (input.apiEnvironment[name] !== undefined) throw invalid();
    }
    if (
      input.apiEnvironment.APOLLO_TF_SUCCESSOR_WS_ENABLED !==
        input.releaseSelection ||
      input.webBuildArguments.VITE_APOLLO_TF_SUCCESSOR_WS_ENABLED !==
        input.releaseSelection ||
      input.webBuildArguments.VITE_API_URL !== "https://api.tf.apollot.ru"
    ) {
      throw invalid();
    }
    const mounted = new Set(input.apiSecretTargets);
    if (
      mounted.size !== input.apiSecretTargets.length ||
      requiredSecretTargets.some((name) => !mounted.has(name))
    ) {
      throw invalid();
    }
    return Object.freeze({
      successorWebSocketEnabled: input.releaseSelection === "true",
    });
  } catch {
    throw invalid();
  }
}
