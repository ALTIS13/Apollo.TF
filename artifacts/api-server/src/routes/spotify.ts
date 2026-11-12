import {
  SPOTIFY_PLAYLIST_MAX_OFFSET,
  SPOTIFY_PLAYLIST_PAGE_SIZE,
  SPOTIFY_SAVED_ALBUMS_PAGE_SIZE,
  spotifyCatalogIdSchema,
  type NormalizedTrack,
  type TfIntegrationsErrorResponse,
} from "@workspace/tf-integrations-contract";
import { Router, type IRouter, type Response } from "express";

import {
  TfIntegrationsUnavailableError,
  type TfIntegrationsGateway,
} from "../lib/tf-integrations-client.js";
import type { TfSessionStore } from "../lib/tf-session-store.js";

const PROVIDER_CODE_PATTERN = /^[\x21-\x7e]{1,2048}$/;
const MAX_PAGE_SIZE = 50;

export interface SpotifyRouteDependencies {
  readonly gateway: TfIntegrationsGateway;
  readonly serverUrl?: string;
  readonly publicApiDomain?: string;
  readonly webUrl: string;
  readonly providerOAuthStateStore: Pick<
    TfSessionStore,
    "issueProviderOAuthState" | "consumeProviderOAuthState"
  >;
}

const unavailableGateway: TfIntegrationsGateway = {
  async execute() {
    throw new TfIntegrationsUnavailableError();
  },
};

const unavailableProviderOAuthStateStore: SpotifyRouteDependencies["providerOAuthStateStore"] =
  {
    async issueProviderOAuthState() {
      throw new Error("provider OAuth state unavailable");
    },
    async consumeProviderOAuthState() {
      throw new Error("provider OAuth state unavailable");
    },
  };

function defaultDependencies(): SpotifyRouteDependencies {
  return {
    gateway: unavailableGateway,
    serverUrl: process.env["SERVER_URL"],
    publicApiDomain: process.env["PUBLIC_API_DOMAIN"],
    webUrl: process.env["WEB_URL"] ?? "",
    providerOAuthStateStore: unavailableProviderOAuthStateStore,
  };
}

function redirectUri(
  dependencies: SpotifyRouteDependencies,
  hostname: string,
): string {
  if (dependencies.serverUrl) {
    return `${dependencies.serverUrl.replace(/\/$/, "")}/api/spotify/callback`;
  }
  const domain = dependencies.publicApiDomain ?? hostname;
  return `https://${domain}/api/spotify/callback`;
}

function webRedirect(
  dependencies: SpotifyRouteDependencies,
  response: Response,
  parameters: Readonly<Record<string, string>>,
): void {
  const query = new URLSearchParams(parameters).toString();
  response.redirect(
    `${dependencies.webUrl.replace(/\/$/, "")}/favorites?${query}`,
  );
}

function verifiedAuthorizationUrl(
  value: string,
  expectedState: string,
  expectedCallbackUri: string,
): string | null {
  try {
    const url = new URL(value);
    const states = url.searchParams.getAll("state");
    const callbackUris = url.searchParams.getAll("redirect_uri");
    if (
      url.origin !== "https://accounts.spotify.com" ||
      url.pathname !== "/authorize" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      states.length !== 1 ||
      states[0] !== expectedState ||
      callbackUris.length !== 1 ||
      callbackUris[0] !== expectedCallbackUri
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function isFailure(
  value: object,
): value is TfIntegrationsErrorResponse {
  return "error" in value;
}

function paginationValue(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function pagination(
  query: Readonly<Record<string, unknown>>,
  maxPageSize = MAX_PAGE_SIZE,
): {
  readonly offset: number;
  readonly limit: number;
} {
  return {
    offset: paginationValue(query["offset"], 0, 1_000_000),
    limit: Math.max(1, paginationValue(query["limit"], maxPageSize, maxPageSize)),
  };
}

function playlistPageQuery(
  originalUrl: string,
): { offset: number; limit: number } | null {
  const queryStart = originalUrl.indexOf("?");
  if (queryStart < 0 || queryStart === originalUrl.length - 1) {
    return { offset: 0, limit: SPOTIFY_PLAYLIST_PAGE_SIZE };
  }

  const fieldCount = originalUrl.slice(queryStart + 1).split("&", 3).length;
  if (fieldCount > 2) return null;
  const params = new URLSearchParams(originalUrl.slice(queryStart));
  const offsets = params.getAll("offset");
  const limits = params.getAll("limit");
  if (
    fieldCount !== params.size ||
    offsets.length + limits.length !== params.size ||
    offsets.length > 1 ||
    limits.length > 1
  ) {
    return null;
  }
  const offsetText = offsets[0] ?? "0";
  const limitText = limits[0] ?? String(SPOTIFY_PLAYLIST_PAGE_SIZE);
  if (!/^[0-9]+$/.test(offsetText) || !/^[0-9]+$/.test(limitText)) return null;

  const offset = Number(offsetText);
  const limit = Number(limitText);
  if (offset > SPOTIFY_PLAYLIST_MAX_OFFSET || limit < 1 || limit > SPOTIFY_PLAYLIST_PAGE_SIZE) {
    return null;
  }
  return { offset, limit };
}

function mapTrack(track: NormalizedTrack) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.duration * 1_000,
    thumbnailUrl: track.thumbnailUrl,
    spotifyUrl: track.providerUrl,
  };
}

function sendLibraryFailure(
  response: Response,
  failure: TfIntegrationsErrorResponse,
): void {
  if (failure.error.code === "provider_rate_limited") {
    const { retryAfterSeconds } = failure.error;
    response.setHeader("Cache-Control", "no-store");
    if (retryAfterSeconds !== undefined) {
      response.setHeader("Retry-After", String(retryAfterSeconds));
    }
    response.status(429).json({
      error: "spotify_rate_limited",
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
    return;
  }
  if (failure.error.code === "not_connected") {
    response.status(401).json({ error: "not_connected" });
    return;
  }
  response.status(502).json({ error: "spotify_error" });
}

export function createSpotifyRouter(
  overrides: Partial<SpotifyRouteDependencies> = {},
): IRouter {
  const dependencies: SpotifyRouteDependencies = {
    ...defaultDependencies(),
    ...overrides,
  };
  const router = Router();

  router.get("/spotify/login", async (request, response) => {
    try {
      const accountId = request.tfPrincipal!.accountId;
      const state =
        await dependencies.providerOAuthStateStore.issueProviderOAuthState(
          "spotify",
          accountId,
        );
      const result = await dependencies.gateway.execute({
        accountId,
        operation: "spotify.oauth.authorize",
        input: {
          state,
          callbackUri: redirectUri(dependencies, request.hostname),
        },
      });
      if (isFailure(result)) {
        response.status(503).json({ error: "spotify_unavailable" });
        return;
      }
      const authorizationUrl = verifiedAuthorizationUrl(
        result.result.authorizationUrl,
        state,
        redirectUri(dependencies, request.hostname),
      );
      if (authorizationUrl === null) {
        response.status(503).json({ error: "spotify_unavailable" });
        return;
      }
      response.redirect(authorizationUrl);
    } catch {
      response.status(503).json({ error: "spotify_unavailable" });
    }
  });

  router.get("/spotify/callback", async (request, response) => {
    const accountId = request.tfPrincipal!.accountId;
    const suppliedState =
      typeof request.query["state"] === "string" ? request.query["state"] : "";
    let stateConsumed: boolean;
    try {
      stateConsumed =
        await dependencies.providerOAuthStateStore.consumeProviderOAuthState(
          "spotify",
          accountId,
          suppliedState,
        );
    } catch {
      webRedirect(dependencies, response, { spotify_error: "internal" });
      return;
    }
    if (!stateConsumed) {
      webRedirect(dependencies, response, {
        spotify_error: "invalid_state",
      });
      return;
    }
    if (request.query["error"] !== undefined) {
      webRedirect(dependencies, response, {
        spotify_error: "provider_denied",
      });
      return;
    }
    const code =
      typeof request.query["code"] === "string" ? request.query["code"] : "";
    if (!PROVIDER_CODE_PATTERN.test(code)) {
      webRedirect(dependencies, response, {
        spotify_error: "invalid_callback",
      });
      return;
    }

    try {
      const result = await dependencies.gateway.execute({
        accountId,
        operation: "spotify.oauth.complete",
        input: {
          code,
          callbackUri: redirectUri(dependencies, request.hostname),
        },
      });
      if (isFailure(result)) {
        webRedirect(dependencies, response, {
          spotify_error:
            result.error.code === "storage_unavailable"
              ? "internal"
              : "token_exchange_failed",
        });
        return;
      }
      webRedirect(dependencies, response, { spotify_connected: "1" });
    } catch {
      webRedirect(dependencies, response, { spotify_error: "internal" });
    }
  });

  router.get("/spotify/status", async (request, response) => {
    try {
      const result = await dependencies.gateway.execute({
        accountId: request.tfPrincipal!.accountId,
        operation: "spotify.status",
        input: {},
      });
      if (isFailure(result)) {
        response.status(503).json({ error: "spotify_unavailable" });
        return;
      }
      if (!result.result.account.connected) {
        response.json({ connected: false });
        return;
      }
      response.json({
        connected: true,
        displayName: result.result.account.account.displayName,
        spotifyUserId: result.result.account.account.id,
      });
    } catch (error) {
      if (error instanceof TfIntegrationsUnavailableError) {
        response.status(503).json({ error: "spotify_unavailable" });
        return;
      }
      throw error;
    }
  });

  router.post("/spotify/logout", async (request, response) => {
    try {
      const result = await dependencies.gateway.execute({
        accountId: request.tfPrincipal!.accountId,
        operation: "spotify.disconnect",
        input: {},
      });
      if (isFailure(result)) {
        response.status(503).json({ error: "spotify_unavailable" });
        return;
      }
      response.json({ ok: true });
    } catch {
      response.status(503).json({ error: "spotify_unavailable" });
    }
  });

  router.get("/spotify/liked", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const page = pagination(request.query);
    try {
      const result = await dependencies.gateway.execute({
        accountId: request.tfPrincipal!.accountId,
        operation: "spotify.liked.list",
        input: page,
      });
      if (isFailure(result)) {
        sendLibraryFailure(response, result);
        return;
      }
      response.json({
        tracks: result.result.tracks.map(mapTrack),
        total: result.result.total,
        offset: page.offset,
        limit: page.limit,
        hasMore:
          page.offset + result.result.tracks.length < result.result.total,
      });
    } catch {
      response.status(502).json({ error: "spotify_error" });
    }
  });

  router.get("/spotify/liked-all", async (request, response) => {
    const allTracks: ReturnType<typeof mapTrack>[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      try {
        const result = await dependencies.gateway.execute({
          accountId: request.tfPrincipal!.accountId,
          operation: "spotify.liked.list",
          input: { offset, limit: MAX_PAGE_SIZE },
        });
        if (isFailure(result)) {
          sendLibraryFailure(response, result);
          return;
        }
        total = result.result.total;
        allTracks.push(...result.result.tracks.map(mapTrack));
        // Null tracks are filtered out; advance by the raw page size, not retained tracks.
        offset += MAX_PAGE_SIZE;
      } catch (error) {
        if (error instanceof TfIntegrationsUnavailableError) {
          response.status(503).json({ error: "spotify_unavailable" });
          return;
        }
        response.status(502).json({ error: "spotify_error" });
        return;
      }
    }
    response.json({ tracks: allTracks, total: allTracks.length });
  });

  router.get("/spotify/playlists", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const result = await dependencies.gateway.execute({
        accountId: request.tfPrincipal!.accountId,
        operation: "spotify.playlists.list",
        input: {},
      });
      if (isFailure(result)) {
        sendLibraryFailure(response, result);
        return;
      }
      response.json(result.result);
    } catch {
      response.status(502).json({ error: "spotify_error" });
    }
  });

  router.get("/spotify/playlists/page", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const page = playlistPageQuery(request.originalUrl);
    if (page === null) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const result = await dependencies.gateway.execute({
        accountId: request.tfPrincipal!.accountId,
        operation: "spotify.playlists.page",
        input: page,
      });
      if (isFailure(result)) {
        sendLibraryFailure(response, result);
        return;
      }
      if (result.result.offset !== page.offset || result.result.limit !== page.limit) {
        response.status(502).json({ error: "spotify_error" });
        return;
      }
      response.json(result.result);
    } catch {
      response.status(502).json({ error: "spotify_error" });
    }
  });

  router.get(
    "/spotify/playlists/:playlistId/tracks",
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      const page = pagination(request.query);
      try {
        const result = await dependencies.gateway.execute({
          accountId: request.tfPrincipal!.accountId,
          operation: "spotify.playlist-tracks.list",
          input: {
            playlistId: request.params.playlistId!,
            ...page,
          },
        });
        if (isFailure(result)) {
          sendLibraryFailure(response, result);
          return;
        }
        response.json({
          tracks: result.result.tracks.map(mapTrack),
          total: result.result.total,
          offset: page.offset,
          limit: page.limit,
        });
      } catch {
        response.status(502).json({ error: "spotify_error" });
      }
    },
  );

  router.get("/spotify/albums", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const result = await dependencies.gateway.execute({
        accountId: request.tfPrincipal!.accountId,
        operation: "spotify.albums.list",
        input: pagination(request.query, SPOTIFY_SAVED_ALBUMS_PAGE_SIZE),
      });
      if (isFailure(result)) {
        sendLibraryFailure(response, result);
        return;
      }
      response.json(result.result);
    } catch {
      response.status(502).json({ error: "spotify_error" });
    }
  });

  router.get("/spotify/albums/:albumId/tracks", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const albumId = spotifyCatalogIdSchema.safeParse(request.params.albumId);
    if (!albumId.success) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const result = await dependencies.gateway.execute({
        accountId: request.tfPrincipal!.accountId,
        operation: "spotify.album-tracks.list",
        input: { albumId: albumId.data, ...pagination(request.query) },
      });
      if (isFailure(result)) {
        sendLibraryFailure(response, result);
        return;
      }
      response.json(result.result);
    } catch {
      response.status(502).json({ error: "spotify_error" });
    }
  });

  router.get("/spotify/top-tracks", async (request, response) => {
    const suppliedRange = request.query["time_range"];
    const timeRange =
      suppliedRange === "short_term" ||
      suppliedRange === "long_term" ||
      suppliedRange === "medium_term"
        ? suppliedRange
        : "medium_term";
    try {
      const result = await dependencies.gateway.execute({
        accountId: request.tfPrincipal!.accountId,
        operation: "spotify.top-tracks.list",
        input: { timeRange },
      });
      if (isFailure(result)) {
        sendLibraryFailure(response, result);
        return;
      }
      response.json({
        tracks: result.result.tracks.map(mapTrack),
        timeRange,
      });
    } catch {
      response.status(502).json({ error: "spotify_error" });
    }
  });

  return router;
}

export default createSpotifyRouter();
