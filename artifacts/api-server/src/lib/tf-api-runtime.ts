import { createApiApp, type ApiAppOptions } from "../app.js";
import {
  PlatformAuthClient,
  type TfAuthRuntimeConfig,
} from "./platform-auth-client.js";
import { TfSessionStore, type StrictRedisClient } from "./tf-session-store.js";
import { TfRenewalConsumer } from "./tf-renewal-consumer.js";
import {
  configuredRevokeKeys,
  loadTfRenewalRuntimeConfig,
  type TfRenewalConfigDependencies,
} from "./tf-renewal-runtime-config.js";
import {
  createRevokeScheduler,
  type RevokeDrainStatus,
} from "./tf-revoke-scheduler.js";

interface Options {
  environment: NodeJS.ProcessEnv;
  authConfig: TfAuthRuntimeConfig;
  redis: StrictRedisClient;
  appOptions?: Omit<ApiAppOptions, "auth" | "nodeEnv">;
}
interface Dependencies extends TfRenewalConfigDependencies {
  fetch?: typeof fetch;
  report?: (status: RevokeDrainStatus) => void;
}
export async function createTfApiRuntime(
  options: Options,
  dependencies: Dependencies = {},
) {
  const config = options.authConfig;
  // Validate the entire explicit opt-in before constructing the app or starting work.
  const renewalConfig = await loadTfRenewalRuntimeConfig(
    options.environment,
    config,
    dependencies,
  );
  const transport = new AbortController();
  const fetchImplementation = dependencies.fetch ?? fetch;
  const ownedFetch: typeof fetch = (input, init) => {
    if (transport.signal.aborted)
      return Promise.reject(new Error("TF auth runtime stopped"));
    return fetchImplementation(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, transport.signal])
        : transport.signal,
    });
  };
  const platform = new PlatformAuthClient({
    issuer: config.issuer,
    apiOrigin: config.apiOrigin,
    allowPrivateHttpTransport: config.allowPrivateHttpTransport,
    clientId: config.clientId,
    redirectUri: config.callbackUrl,
    clientSecret: config.clientSecret,
    fetch: renewalConfig.enabled ? ownedFetch : fetchImplementation,
  });
  const sessionStore = new TfSessionStore(options.redis);
  const renewal = renewalConfig.enabled
    ? new TfRenewalConsumer({
        store: sessionStore.families,
        client: platform.renewal,
        clientId: config.clientId,
        revocationKeys: configuredRevokeKeys(renewalConfig),
      })
    : undefined;
  const auth = {
    platform,
    sessionStore,
    webOrigin: config.webOrigin,
    secureCookies: true,
    ...(renewal ? { renewal } : {}),
    ...(config.bridgePkceVerifier === undefined
      ? {}
      : { pkceVerifier: () => config.bridgePkceVerifier! }),
  };
  const app = createApiApp({
    ...options.appOptions,
    nodeEnv: config.nodeEnv,
    auth,
  });
  const scheduler = renewal
    ? createRevokeScheduler(
        async () => {
          await renewal.drainRevocations();
          if (transport.signal.aborted) return "pending";
          // Pending is not a policy denial or readiness failure; ciphertext remains durable.
          return (await sessionStore.families.pendingRevocations()).length
            ? "pending"
            : "drained";
        },
        dependencies.report ?? (() => {}),
        () => transport.abort(),
      )
    : undefined;
  return {
    app,
    auth,
    start() {
      scheduler?.start();
    },
    async stop() {
      await scheduler?.stop();
    },
  };
}

/** Used by both startup rollback and normal shutdown; never detach Redis under a drain. */
export function createTfRuntimeResourceCloser(
  getRuntime: () => { stop(): Promise<void> } | undefined,
  disconnectStorage: () => void,
) {
  let closing: Promise<void> | undefined;
  return (): Promise<void> => {
    closing ??= (async () => {
      await getRuntime()?.stop();
      disconnectStorage();
    })();
    return closing;
  };
}
