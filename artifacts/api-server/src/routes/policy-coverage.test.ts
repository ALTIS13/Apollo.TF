import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createSignedBodySignature } from "@workspace/module-runtime-contract";
import { TF_INTEGRATIONS_COMMAND_PATH } from "@workspace/tf-integrations-contract";
import { TF_SEARCH_ARTIST_DISCOVERY_PATH } from "@workspace/tf-search-contract";
import type { Router } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiApp } from "../app.js";
import {
  HttpTfIntegrationsClient,
  type TfIntegrationsGateway,
} from "../lib/tf-integrations-client.js";
import { HttpTfSearchClient, type TfSearchGateway } from "../lib/tf-search-client.js";
import {
  TF_ROUTE_POLICIES,
  assertProtectedRouteCoverage,
  requiredPolicyForRequest,
  type TfProtectedRoute,
} from "../lib/tf-policy.js";
import { createSpotifyRouter } from "./spotify.js";
import { createTracksRouter } from "./tracks.js";
import { createYandexRouter } from "./yandex.js";
import { createCollectionsRouter } from "./collections.js";
import { createPlaylistsRouter } from "./playlists.js";
import { createPlaylistImportsRouter } from "./playlist-imports.js";

vi.hoisted(() => {
  process.env["DATABASE_URL"] ??= "postgres://unused:unused@127.0.0.1:1/unused";
});

const servers: Server[] = [];
const spotifyAlbumPages = [
  {
    path: "/api/spotify/albums",
    policyPath: "/api/spotify/albums",
    operation: "spotify.albums.list",
    input: { offset: 2, limit: 5 },
    result: {
      offset: 2,
      limit: 5,
      total: 12,
      albums: [
        {
          id: "Album123",
          title: "Album",
          artist: "Artist",
          trackCount: 12,
          thumbnailUrl: "https://images.example.test/album.jpg",
          providerUrl: "https://open.spotify.com/album/Album123",
        },
      ],
    },
  },
  {
    path: "/api/spotify/albums/Album123/tracks",
    policyPath: "/api/spotify/albums/:albumId/tracks",
    operation: "spotify.album-tracks.list",
    input: { albumId: "Album123", offset: 2, limit: 5 },
    result: {
      offset: 2,
      limit: 5,
      total: 12,
      tracks: [
        {
          id: "Track123",
          title: "Track",
          artist: "Artist",
          duration: 181,
          providerUrl: "https://open.spotify.com/track/Track123",
          discNumber: 2,
          trackNumber: 1,
        },
      ],
    },
  },
] as const;

interface RouteLayer {
  readonly route?: {
    readonly path: string;
    readonly methods: Readonly<Record<string, boolean>>;
  };
}

function discoverRoutes(router: Router): TfProtectedRoute[] {
  const stack = (router as unknown as { readonly stack: RouteLayer[] }).stack;
  return stack.flatMap((layer) => {
    if (layer.route === undefined) return [];
    return Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => ({
        method: method.toUpperCase(),
        path: `/api${layer.route!.path}`,
      }));
  });
}

function exactInventory(): TfProtectedRoute[] {
  return [
    { method: "POST", path: "/api/tracks/free-search" },
    { method: "POST", path: "/api/tracks/link-metadata" },
    { method: "POST", path: "/api/tracks/search" },
    { method: "POST", path: "/api/tracks/batch-search" },
    { method: "GET", path: "/api/tracks/:id/stream" },
    { method: "GET", path: "/api/tracks/:id/download" },
    { method: "GET", path: "/api/tracks/:id/audio-stream" },
    { method: "GET", path: "/api/tracks/recent" },
    { method: "POST", path: "/api/tracks/play" },
    { method: "GET", path: "/api/tracks/recommendations" },
    { method: "PUT", path: "/api/tracks/recommendations/hidden/:trackId" },
    { method: "DELETE", path: "/api/tracks/recommendations/hidden/:trackId" },
    { method: "DELETE", path: "/api/tracks/recommendations/hidden" },
    { method: "GET", path: "/api/collections/liked" },
    { method: "POST", path: "/api/collections/liked/lookup" },
    { method: "PATCH", path: "/api/collections/liked/order" },
    { method: "PUT", path: "/api/collections/liked/:trackId" },
    { method: "DELETE", path: "/api/collections/liked/:trackId" },
    { method: "GET", path: "/api/collections/playlists" },
    { method: "POST", path: "/api/collections/playlists" },
    { method: "GET", path: "/api/collections/playlists/:playlistId" },
    { method: "POST", path: "/api/collections/playlists/:playlistId/tracks" },
    {
      method: "PATCH",
      path: "/api/collections/playlists/:playlistId/tracks/order",
    },
    {
      method: "DELETE",
      path: "/api/collections/playlists/:playlistId/tracks/:trackId",
    },
    { method: "DELETE", path: "/api/collections/playlists/:playlistId" },
    { method: "GET", path: "/api/collections/imports" },
    { method: "GET", path: "/api/collections/imports/:importId" },
    { method: "PUT", path: "/api/collections/imports/:importId" },
    { method: "DELETE", path: "/api/collections/imports/:importId" },
    { method: "GET", path: "/api/collections/imports/:importId/entries/:position/candidates" },
    { method: "PUT", path: "/api/collections/imports/:importId/entries/:position/selection" },
    { method: "GET", path: "/api/collections/imports/:importId/entries/:position/audio/:revision" },
    { method: "GET", path: "/api/collections/imports/:importId/entries/:position/file/:revision" },
    { method: "GET", path: "/api/tracks/suggest" },
    { method: "GET", path: "/api/tracks/artist" },
    { method: "GET", path: "/api/tracks/lyrics" },
    { method: "POST", path: "/api/tracks/lyrics/feedback" },
    { method: "POST", path: "/api/tracks/download/queue" },
    { method: "GET", path: "/api/tracks/download/jobs" },
    { method: "GET", path: "/api/tracks/download/status/:jobId" },
    { method: "GET", path: "/api/tracks/download/file/:jobId" },
    { method: "DELETE", path: "/api/tracks/download/jobs/:jobId" },
    { method: "GET", path: "/api/spotify/login" },
    { method: "GET", path: "/api/spotify/callback" },
    { method: "GET", path: "/api/spotify/status" },
    { method: "POST", path: "/api/spotify/logout" },
    { method: "GET", path: "/api/spotify/liked" },
    { method: "GET", path: "/api/spotify/liked-all" },
    { method: "GET", path: "/api/spotify/playlists" },
    {
      method: "GET",
      path: "/api/spotify/playlists/:playlistId/tracks",
    },
    { method: "GET", path: "/api/spotify/albums" },
    { method: "GET", path: "/api/spotify/albums/:albumId/tracks" },
    { method: "GET", path: "/api/spotify/top-tracks" },
    { method: "POST", path: "/api/yandex/token" },
    { method: "GET", path: "/api/yandex/status" },
    { method: "POST", path: "/api/yandex/logout" },
    { method: "GET", path: "/api/yandex/liked" },
    { method: "GET", path: "/api/yandex/playlists" },
    { method: "GET", path: "/api/yandex/playlists/:uid/:kind/tracks" },
    { method: "POST", path: "/api/ws/tickets" },
  ];
}

function policyAuthDependencies() {
  return {
    platform: {
      createAuthorizationUrl: vi.fn(),
      exchangeCode: vi.fn(),
      introspect: vi.fn(),
    },
    sessionStore: {
      createTransaction: vi.fn(),
      consumeTransaction: vi.fn(),
      createSession: vi.fn(),
      getSession: vi.fn(),
      observeSession: vi.fn(),
      refreshSession: vi.fn(),
      revokeSession: vi.fn(),
      issueProviderOAuthState: vi.fn(),
      consumeProviderOAuthState: vi.fn(),
      issueWebSocketTicket: vi.fn(),
      consumeWebSocketTicket: vi.fn(),
    },
    webOrigin: "https://tf.apollot.ru",
    secureCookies: true,
  };
}

async function startApp(integrationsGateway?: TfIntegrationsGateway, searchGateway?: TfSearchGateway): Promise<{
  readonly origin: string;
  readonly dependencies: ReturnType<typeof policyAuthDependencies>;
}> {
  const dependencies = policyAuthDependencies();
  const app = createApiApp({ auth: dependencies, integrationsGateway, tracks: searchGateway ? { searchGateway } : undefined });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    dependencies,
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("protected route policy coverage", () => {
  it("discovers the exact protected route inventory", async () => {
    const trackRoutes = discoverRoutes(createTracksRouter());
    const collectionRoutes = discoverRoutes(createCollectionsRouter());
    const playlistRoutes = discoverRoutes(createPlaylistsRouter());
    const importRoutes = discoverRoutes(createPlaylistImportsRouter());
    const spotifyRoutes = discoverRoutes(createSpotifyRouter());
    const yandexRoutes = discoverRoutes(createYandexRouter());
    const { createWebSocketTicketRouter } =
      await import("./websocket-tickets.js");
    const websocketTicketRoutes = discoverRoutes(
      createWebSocketTicketRouter({
        issueWebSocketTicket: vi.fn(),
      }),
    );
    const discovered = [
      ...trackRoutes,
      ...collectionRoutes,
      ...playlistRoutes,
      ...importRoutes,
      ...spotifyRoutes,
      ...yandexRoutes,
      ...websocketTicketRoutes,
    ];

    expect(trackRoutes).toHaveLength(22);
    expect(collectionRoutes).toHaveLength(5);
    expect(playlistRoutes).toHaveLength(7);
    expect(importRoutes).toHaveLength(8);
    expect(spotifyRoutes).toHaveLength(11);
    expect(yandexRoutes).toHaveLength(6);
    expect(websocketTicketRoutes).toHaveLength(1);
    expect(
      [...discovered].sort((left, right) =>
        `${left.method} ${left.path}`.localeCompare(
          `${right.method} ${right.path}`,
        ),
      ),
    ).toEqual(
      exactInventory().sort((left, right) =>
        `${left.method} ${left.path}`.localeCompare(
          `${right.method} ${right.path}`,
        ),
      ),
    );
    expect(() =>
      assertProtectedRouteCoverage(discovered, TF_ROUTE_POLICIES),
    ).not.toThrow();
    for (const route of [...playlistRoutes, ...importRoutes]) {
      const policy = TF_ROUTE_POLICIES.find(
        (candidate) =>
          candidate.method === route.method && candidate.path === route.path,
      );
      expect(policy).toMatchObject({
        capability: "tf.collections",
        live: true,
      });
    }
  });

  it("rejects missing, stale, duplicate, and method-mismatched policies", () => {
    const discovered = exactInventory();
    const withoutFirst = TF_ROUTE_POLICIES.slice(1);
    const stale = [
      ...TF_ROUTE_POLICIES,
      {
        method: "GET",
        path: "/api/tracks/stale",
        pattern: /^\/api\/tracks\/stale$/,
        capability: "tf.search",
        live: false,
      },
    ] as const;
    const duplicate = [...TF_ROUTE_POLICIES, TF_ROUTE_POLICIES[0]!] as const;
    const methodMismatch = discovered.map((route, index) =>
      index === 0 ? { ...route, method: "PUT" } : route,
    );

    expect(() =>
      assertProtectedRouteCoverage(discovered, withoutFirst),
    ).toThrow();
    expect(() => assertProtectedRouteCoverage(discovered, stale)).toThrow();
    expect(() => assertProtectedRouteCoverage(discovered, duplicate)).toThrow();
    expect(() =>
      assertProtectedRouteCoverage(methodMismatch, TF_ROUTE_POLICIES),
    ).toThrow();
  });
});

describe("direct protected endpoints", () => {
  it("requires tf.search before dispatching a signed artist command", async () => {
    const secret = "s".repeat(32);
    const requestId = "20000000-0000-4000-8000-000000000002";
    const serviceOrigin = "https://tf-search.example.test";
    const serviceFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      schemaVersion: 1, requestId, query: "Artist", results: [], sources: ["yt", "sc"],
      providerStatus: { yt: "ok", sc: "ok", bc: "skipped", dz: "skipped" },
    }));
    const gateway = new HttpTfSearchClient(
      { origin: serviceOrigin, internalAuthSecret: secret, timeoutMs: 1_000 },
      { fetch: serviceFetch, randomUuid: () => requestId },
    );
    const { origin, dependencies } = await startApp(undefined, gateway);
    const path = "/api/tracks/artist";
    const url = `${origin}${path}?name=Artist`;
    expect(requiredPolicyForRequest("GET", path)).toMatchObject({ capability: "tf.search", live: false });
    expect(requiredPolicyForRequest("POST", path)).toBeNull();
    expect(requiredPolicyForRequest("GET", `${path}/extra`)).toBeNull();

    const anonymous = await fetch(url);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    const now = Date.now();
    const session = {
      id: "10000000-0000-4000-8000-000000000001",
      accountId: "30000000-0000-4000-8000-000000000003",
      platformSessionId: "40000000-0000-4000-8000-000000000004",
      installationId: "50000000-0000-4000-8000-000000000005",
      entitlements: ["tf.collections"],
      assertionExpiresAt: new Date(now + 120_000).toISOString(),
      expiresAt: new Date(now + 300_000).toISOString(),
    };
    const revision = randomBytes(32).toString("base64url");
    const handle = randomBytes(32).toString("base64url");
    dependencies.sessionStore.observeSession.mockResolvedValueOnce({ revision, session });
    const headers = { cookie: `__Host-apollo_tf=${handle}`, "x-tf-capability": "tf.search" };
    const denied = await fetch(url, { headers });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    await expect(denied.json()).resolves.toEqual({ error: "module_access_denied" });
    expect(serviceFetch).not.toHaveBeenCalled();

    dependencies.sessionStore.observeSession.mockResolvedValueOnce({
      revision, session: { ...session, entitlements: ["tf.search"] },
    });
    const allowed = await fetch(url, { headers });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("no-store");
    await expect(allowed.json()).resolves.toEqual({ schemaVersion: 1, artist: "Artist", results: [], partial: false });
    expect(serviceFetch).toHaveBeenCalledOnce();
    const [target, init] = serviceFetch.mock.calls[0]!;
    expect(String(target)).toBe(`${serviceOrigin}${TF_SEARCH_ARTIST_DISCOVERY_PATH}`);
    expect(init?.method).toBe("POST");
    const rawBody = Buffer.from(String(init?.body));
    expect(JSON.parse(rawBody.toString("utf8"))).toEqual({
      schemaVersion: 1, requestId, artist: "Artist", sources: ["yt", "sc"], limitPerSource: 10,
    });
    const signed = new Headers(init?.headers);
    expect(signed.get("x-apollo-internal-signature")).toBe(createSignedBodySignature({
      method: "POST", path: TF_SEARCH_ARTIST_DISCOVERY_PATH,
      timestamp: signed.get("x-apollo-internal-timestamp")!,
      nonce: signed.get("x-apollo-internal-nonce")!, rawBody, secret,
    }));
    expect(dependencies.platform.introspect).not.toHaveBeenCalled();
  });

  it.each(spotifyAlbumPages)(
    "requires live tf.integrations and signs the verified account for $path",
    async ({ path, policyPath, operation, input, result }) => {
      const secret = "i".repeat(32);
      const serviceOrigin = "https://tf-integrations.example.test";
      const accountId = "10000000-0000-4000-8000-000000000001";
      const requestId = "20000000-0000-4000-8000-000000000002";
      const now = Date.now();
      const session = {
        id: "30000000-0000-4000-8000-000000000003",
        accountId,
        platformSessionId: "40000000-0000-4000-8000-000000000004",
        installationId: "50000000-0000-4000-8000-000000000005",
        entitlements: ["tf.integrations", "tf.search"],
        assertionExpiresAt: new Date(now + 120_000).toISOString(),
        expiresAt: new Date(now + 300_000).toISOString(),
      };
      const introspection = {
        active: true,
        accountId,
        sessionId: session.platformSessionId,
        installationId: session.installationId,
        accountStatus: "active",
        entitlements: session.entitlements,
        expiresAt: session.expiresAt,
      };
      const serviceFetch = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ schemaVersion: 1, requestId, accountId, operation, result }),
      );
      const gateway = new HttpTfIntegrationsClient(
        { origin: serviceOrigin, internalAuthSecret: secret, timeoutMs: 1_000 },
        { fetch: serviceFetch, randomUuid: () => requestId },
      );
      const { origin, dependencies } = await startApp(gateway);
      const handle = randomBytes(32).toString("base64url");
      const alias = "90000000-0000-4000-8000-000000000009";
      const url = `${origin}${path}?offset=2&limit=5&accountId=${alias}&sid=${alias}&albumId=Ignored`;
      const legacyHeaders = { "x-client-session": alias, "x-account-id": alias };
      const headers = { ...legacyHeaders, cookie: `__Host-apollo_tf=${handle}` };

      expect(requiredPolicyForRequest("GET", path)).toMatchObject({
        path: policyPath,
        capability: "tf.integrations",
        live: true,
      });

      const anonymous = await fetch(url, { headers: legacyHeaders });
      expect(anonymous.status).toBe(401);
      expect(dependencies.sessionStore.observeSession).not.toHaveBeenCalled();

      dependencies.sessionStore.observeSession.mockResolvedValue({
        revision: randomBytes(32).toString("base64url"),
        session,
      });
      dependencies.sessionStore.refreshSession.mockResolvedValue(session);
      dependencies.platform.introspect
        .mockResolvedValueOnce({ ...introspection, entitlements: ["tf.search"] })
        .mockResolvedValueOnce(introspection);

      const denied = await fetch(url, { headers });
      expect(denied.status).toBe(403);
      await expect(denied.json()).resolves.toEqual({
        error: "module_access_denied",
      });
      expect(serviceFetch).not.toHaveBeenCalled();

      const allowed = await fetch(url, { headers });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("cache-control")).toBe("no-store");
      await expect(allowed.json()).resolves.toEqual(result);
      expect(dependencies.sessionStore.observeSession).toHaveBeenCalledWith(handle);
      expect(dependencies.platform.introspect).toHaveBeenCalledTimes(2);
      for (const [request] of dependencies.platform.introspect.mock.calls) {
        expect(request).toEqual({
          accountId,
          sessionId: session.platformSessionId,
          installationId: session.installationId,
          audience: "apollo-tf",
        });
      }
      expect(serviceFetch).toHaveBeenCalledOnce();
      const [target, init] = serviceFetch.mock.calls[0]!;
      expect(String(target)).toBe(`${serviceOrigin}${TF_INTEGRATIONS_COMMAND_PATH}`);
      expect(init?.method).toBe("POST");
      const rawBody = String(init?.body);
      expect(JSON.parse(rawBody)).toEqual({
        schemaVersion: 1,
        requestId,
        accountId,
        operation,
        input,
      });
      const signedHeaders = new Headers(init?.headers);
      expect(signedHeaders.get("x-apollo-internal-signature")).toBe(
        createSignedBodySignature({
          method: "POST",
          path: TF_INTEGRATIONS_COMMAND_PATH,
          timestamp: signedHeaders.get("x-apollo-internal-timestamp")!,
          nonce: signedHeaders.get("x-apollo-internal-nonce")!,
          rawBody: Buffer.from(rawBody),
          secret,
        }),
      );
    },
  );

  it.each([
    ["POST", "/api/spotify/albums"],
    ["HEAD", "/api/spotify/albums"],
    ["GET", "/api/spotify/Albums"],
    ["GET", "/api/spotify/albums/"],
    ["GET", "/api/spotify/albums/Album123"],
    ["GET", "/api/spotify/albums/Album123/tracks/extra"],
    ["POST", "/api/spotify/albums/Album123/tracks"],
    ["GET", "/api/spotify/albums/Album123/tracks/"],
  ])("does not grant the album policy to %s %s", (method, path) => {
    expect(requiredPolicyForRequest(method, path)).toBeNull();
  });

  it("denies direct track, collection, Spotify, and Yandex calls without the TF cookie", async () => {
    const { origin, dependencies } = await startApp();
    const canary = randomBytes(32).toString("base64url");
    const responses = await Promise.all([
      fetch(`${origin}/api/tracks/search`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${canary}`,
          "x-client-session": canary,
        },
        body: JSON.stringify({
          artist: "Artist",
          title: "Title",
          capability: "tf.search",
        }),
      }),
      fetch(`${origin}/api/spotify/status?sid=${canary}`, {
        headers: {
          "x-client-session": canary,
          cookie: `connect.sid=${canary}`,
        },
      }),
      fetch(`${origin}/api/yandex/status?sessionId=${canary}`, {
        headers: { "x-client-session": canary },
      }),
      fetch(`${origin}/api/collections/liked`),
      fetch(`${origin}/api/collections/playlists`),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      403, 401, 401, 401, 401,
    ]);
    await expect(
      Promise.all(responses.map((response) => response.json())),
    ).resolves.toEqual([
      { error: "forbidden" },
      { error: "unauthorized" },
      { error: "unauthorized" },
      { error: "unauthorized" },
      { error: "unauthorized" },
    ]);
    expect(dependencies.sessionStore.observeSession).not.toHaveBeenCalled();
    expect(dependencies.platform.introspect).not.toHaveBeenCalled();
  });

  it("keeps health outside policy middleware and removes X-Client-Session from CORS", async () => {
    const { origin } = await startApp();

    const health = await fetch(`${origin}/api/healthz`);
    const preflight = await fetch(`${origin}/api/tracks/search`, {
      method: "OPTIONS",
      headers: {
        origin: "https://tf.apollot.ru",
        "access-control-request-method": "POST",
        "access-control-request-headers": "X-Client-Session, Content-Type",
      },
    });

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });
    expect(preflight.status).toBe(204);
    expect(
      preflight.headers.get("access-control-allow-headers")?.toLowerCase(),
    ).not.toContain("x-client-session");
  });
});
