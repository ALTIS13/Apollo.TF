import Redis from "ioredis";
import { pool } from "@workspace/db";
import { createTfMigrationReadinessProbe } from "@workspace/db/migrations";

import {
  createTfApiRuntime,
  createTfRuntimeResourceCloser,
} from "./lib/tf-api-runtime.js";
import {
  initBackgroundQueues,
  shutdownBackgroundQueues,
} from "./lib/background-queue.js";
import { logger } from "./lib/logger.js";
import {
  assertRequiredModuleHeartbeatKeys,
  parseModuleHeartbeatKeys,
} from "./lib/module-heartbeat.js";
import { parseTfAuthRuntimeConfig } from "./lib/platform-auth-client.js";
import { getRedisForStartup } from "./lib/redis.js";
import { probeRedisHealth } from "./lib/redis-readiness.js";
import { resolveCacheRedisUrl } from "./lib/redis-url-config.js";
import { createStrictRedisClient } from "./lib/tf-session-store.js";
import { createApiGatewayRuntime } from "./lib/api-gateway-runtime.js";
import {
  initializeApiRuntime,
  startApiListener,
} from "./lib/server-startup.js";
import { attachWebSocketServer } from "./ws.js";
import type { WebSocketServerHandle } from "./ws.js";

const probeTfMigrationReadiness = createTfMigrationReadinessProbe(pool);

async function start(): Promise<void> {
  const cacheRedisFileSelected = process.env["REDIS_URL_FILE"] !== undefined;
  assertRequiredModuleHeartbeatKeys(
    parseModuleHeartbeatKeys(process.env["APOLLO_MODULE_HEARTBEAT_KEYS"]),
  );
  const [authConfig, gatewayRuntime, cacheRedisUrl] = await Promise.all([
    parseTfAuthRuntimeConfig(process.env),
    createApiGatewayRuntime(process.env),
    resolveCacheRedisUrl(process.env),
  ]);
  const rawPort = process.env["PORT"];
  if (rawPort === undefined) {
    throw new Error("invalid runtime configuration");
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("invalid runtime configuration");
  }

  const authRedis = new Redis(authConfig.authRedisUrl, {
    commandTimeout: 1_000,
    connectTimeout: 3_000,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  authRedis.on("error", () => {
    logger.error(
      { component: "tf-auth-store" },
      "TF authentication storage unavailable",
    );
  });
  let cacheRedis: Redis | null = null;
  let webSocketHandle: WebSocketServerHandle | null = null;
  let apiRuntime: Awaited<ReturnType<typeof createTfApiRuntime>> | undefined;
  const closeRedisResources = createTfRuntimeResourceCloser(
    () => apiRuntime,
    () => {
      cacheRedis?.disconnect(false);
      authRedis.disconnect(false);
    },
  );

  try {
    await authRedis.connect();
    await authRedis.ping();
    apiRuntime = await createTfApiRuntime(
      {
        environment: process.env,
        authConfig,
        redis: createStrictRedisClient(authRedis),
        appOptions: {
          readiness: async () => {
            try {
              const [redisReady, databaseReady] = await Promise.all([
                probeRedisHealth(authConfig.authRedisUrl, { timeoutMs: 1_200 }),
                probeTfMigrationReadiness(),
              ]);
              return redisReady && databaseReady;
            } catch {
              return false;
            }
          },
          ...gatewayRuntime,
        },
      },
      {
        report: (status) =>
          logger.info(
            { component: "tf-revoke-outbox", status },
            "TF revoke drain status",
          ),
      },
    );
    const {
      app,
      auth: { platform, sessionStore },
      familyWebSocket,
    } = apiRuntime;

    const server = await startApiListener({
      beforeListen: async () => {
        cacheRedis = await getRedisForStartup(
          cacheRedisUrl,
          cacheRedisFileSelected,
        );
      },
      listen: () => app.listen(port),
      initialize: async (listeningServer) => {
        webSocketHandle = await initializeApiRuntime(listeningServer, {
          attachWebSocket: (server) =>
            attachWebSocketServer(server, {
              platform,
              sessionStore,
              familyWebSocket,
              webOrigin: apiRuntime!.auth.webOrigin,
            }),
          initializeAfterAttach: async () => {
            await initBackgroundQueues();
            apiRuntime!.start();
          },
        });
      },
      closeQueues: shutdownBackgroundQueues,
      closeRedis: closeRedisResources,
    });
    logger.info({ port }, "Server listening");

    let shuttingDown = false;
    const shutdown = (): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      const stopRenewal = apiRuntime!.stop();
      void (async () => {
        await webSocketHandle?.close();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
        await stopRenewal;
        await Promise.allSettled([
          shutdownBackgroundQueues(),
          closeRedisResources(),
        ]);
        process.exit(0);
      })();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch {
    await Promise.allSettled([
      shutdownBackgroundQueues(),
      closeRedisResources(),
    ]);
    throw new Error("TF API startup failed");
  }
}

void start().catch(() => {
  process.stderr.write("TF API startup failed\n");
  process.exitCode = 1;
});
