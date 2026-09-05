import { Router, type IRouter } from "express";
import { createHealthRouter } from "./health.js";
import { createTracksRouter, type TrackRouteDependencies } from "./tracks.js";
import {
  createSpotifyRouter,
  type SpotifyRouteDependencies,
} from "./spotify.js";
import { createYandexRouter, type YandexRouteDependencies } from "./yandex.js";
import { adminRouter } from "./admin.js";
import { createAuthRouter, type AuthRouteDependencies } from "./auth.js";
import { requireTfCapability } from "../lib/tf-policy.js";
import { hasFamilyCookie } from "../lib/tf-browser-session.js";
import { createWebSocketTicketRouter } from "./websocket-tickets.js";
import type { TfIntegrationsGateway } from "../lib/tf-integrations-client.js";
import {
  createCollectionsRouter,
  type CollectionRouteDependencies,
} from "./collections.js";

export interface ApiRouterOptions {
  readonly auth?: AuthRouteDependencies;
  readonly spotify?: Omit<
    Partial<SpotifyRouteDependencies>,
    "gateway" | "providerOAuthStateStore"
  >;
  readonly yandex?: Omit<Partial<YandexRouteDependencies>, "gateway">;
  readonly integrationsGateway?: TfIntegrationsGateway;
  readonly tracks?: Partial<TrackRouteDependencies>;
  readonly collections?: Partial<CollectionRouteDependencies>;
  readonly readiness?: () => Promise<boolean>;
}

export function createApiRouter(options: ApiRouterOptions = {}): IRouter {
  const router: IRouter = Router();
  if (options.auth !== undefined) {
    router.use("/auth", createAuthRouter(options.auth));
  }
  router.use(createHealthRouter(options.readiness));
  if (options.auth === undefined) {
    router.use(
      ["/tracks", "/collections", "/spotify", "/yandex", "/ws/tickets"],
      (_request, response) => {
        response.status(503).json({ error: "policy_unavailable" });
      },
    );
  } else {
    router.use(
      ["/tracks", "/collections", "/spotify", "/yandex", "/ws/tickets"],
      requireTfCapability({
        platform: options.auth.platform,
        sessionStore: options.auth.sessionStore,
        renewal: options.auth.renewal,
      }),
    );
  }
  if (options.auth !== undefined) {
    router.use("/ws/tickets", (request, response, next) => {
      // Successor ticket/upgrade ownership is a separate gated integration slice.
      if (hasFamilyCookie(request)) {
        response.status(503).json({ error: "policy_unavailable" });
        return;
      }
      next();
    });
    router.use(
      createWebSocketTicketRouter({
        issueWebSocketTicket: (handle) =>
          options.auth!.sessionStore.issueWebSocketTicket(handle),
      }),
    );
  }
  router.use(createTracksRouter(options.tracks));
  router.use(createCollectionsRouter(options.collections));
  router.use(
    createSpotifyRouter({
      ...options.spotify,
      ...(options.integrationsGateway === undefined
        ? {}
        : { gateway: options.integrationsGateway }),
      ...(options.auth === undefined
        ? {}
        : { providerOAuthStateStore: options.auth.sessionStore }),
    }),
  );
  router.use(
    createYandexRouter({
      ...options.yandex,
      ...(options.integrationsGateway === undefined
        ? {}
        : { gateway: options.integrationsGateway }),
    }),
  );
  router.use(adminRouter);
  return router;
}

export default createApiRouter();
