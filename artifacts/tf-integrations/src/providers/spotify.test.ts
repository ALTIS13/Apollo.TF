import { randomUUID } from "node:crypto";

import { SPOTIFY_PLAYLIST_MAX_OFFSET, SPOTIFY_PLAYLIST_PAGE_SIZE } from "@workspace/tf-integrations-contract";
import { describe, expect, it, vi } from "vitest";

import {
  ProviderError,
  SpotifyProvider,
  type SpotifyProviderOptions,
} from "./spotify.js";

type RecordedRequest = {
  readonly url: string;
  readonly init: RequestInit;
};

const now = Date.parse("2026-07-25T12:00:00.000Z");
const callbackUri = "https://tf.apollot.ru/api/spotify/callback";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recordingFetch(responses: readonly Response[]): {
  readonly requests: RecordedRequest[];
  readonly fetch: typeof fetch;
} {
  const requests: RecordedRequest[] = [];
  let index = 0;
  return {
    requests,
    fetch: (async (
      input: Parameters<typeof fetch>[0],
      init: RequestInit = {},
    ) => {
      expect(init.redirect).toBe("error");
      requests.push({ url: String(input), init });
      const response = responses[index++];
      if (response === undefined) {
        throw new Error("unexpected fetch");
      }
      return response;
    }) as typeof fetch,
  };
}

function makeProvider(
  responses: readonly Response[],
  overrides: Partial<SpotifyProviderOptions> = {},
): {
  readonly provider: SpotifyProvider;
  readonly requests: RecordedRequest[];
} {
  const recorded = recordingFetch(responses);
  return {
    provider: new SpotifyProvider({
      clientId: "spotify-client",
      clientSecret: "spotify-credential",
      callbackUri,
      fetch: recorded.fetch,
      now: () => now,
      ...overrides,
    }),
    requests: recorded.requests,
  };
}

function spotifyTrack(id = "track-1") {
  return {
    id,
    name: "Track One",
    artists: [{ name: "Artist One" }, { name: "Artist Two" }],
    album: {
      name: "Album One",
      images: [
        { url: "https://i.scdn.co/image/small", width: 64, height: 64 },
        { url: "https://i.scdn.co/image/large", width: 640, height: 640 },
      ],
    },
    duration_ms: 182_999,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  };
}

function expectRedirectError(requests: readonly RecordedRequest[]): void {
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.init.redirect).toBe("error");
  }
}

async function providerOutcomeWithin(
  pending: Promise<unknown>,
  timeoutMs = 100,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timeout: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("SpotifyProvider", () => {
  it("builds the fixed authorization URL with existing read scopes and exact callback", () => {
    const { provider } = makeProvider([]);
    const state = `state-${randomUUID()}`;

    const authorizationUrl = provider.authorizationUrl({
      state,
      callbackUri,
    });
    const parsed = new URL(authorizationUrl);

    expect(parsed.origin).toBe("https://accounts.spotify.com");
    expect(parsed.pathname).toBe("/authorize");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      response_type: "code",
      client_id: "spotify-client",
      scope:
        "user-library-read playlist-read-private playlist-read-collaborative user-top-read user-read-recently-played",
      redirect_uri: callbackUri,
      state,
    });
    expect(() =>
      provider.authorizationUrl({
        state,
        callbackUri: "https://tf.apollot.ru/api/spotify/callback?next=private",
      }),
    ).toThrow(ProviderError);
  });

  it("requires the command callback to equal the configured runtime callback", async () => {
    const { provider, requests } = makeProvider([]);
    const otherOriginCallback =
      "https://attacker.example/api/spotify/callback";

    expect(() =>
      provider.authorizationUrl({
        state: "state",
        callbackUri: otherOriginCallback,
      }),
    ).toThrow(ProviderError);
    await expect(
      provider.exchangeCode({
        code: "bounded-code",
        callbackUri: otherOriginCallback,
      }),
    ).rejects.toMatchObject({ code: "provider_rejected" });
    expect(requests).toHaveLength(0);

    expect(() =>
      makeProvider([], {
        callbackUri: "http://tf.example.test/api/spotify/callback",
      }),
    ).toThrow(ProviderError);

    const deploymentCallback =
      "https://api.deployment.example/api/spotify/callback";
    const configuredProvider = makeProvider([], {
      callbackUri: deploymentCallback,
    }).provider;
    expect(
      new URL(
        configuredProvider.authorizationUrl({
          state: "state",
          callbackUri: deploymentCallback,
        }),
      ).searchParams.get("redirect_uri"),
    ).toBe(deploymentCallback);
  });

  it("exchanges a bounded code with confidential Basic authentication and requires valid tokens", async () => {
    const accessToken = `access-${randomUUID()}`;
    const refreshToken = `refresh-${randomUUID()}`;
    const { provider, requests } = makeProvider([
      jsonResponse({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3_600,
        token_type: "Bearer",
        scope: "user-library-read",
      }),
      jsonResponse({
        id: "spotify-user",
        display_name: "Spotify User",
        external_urls: {
          spotify: "https://open.spotify.com/user/spotify-user",
        },
      }),
    ]);

    await expect(
      provider.exchangeCode({ code: "bounded-code", callbackUri }),
    ).resolves.toEqual({
      secret: {
        accessToken,
        refreshToken,
        expiresAt: "2026-07-25T13:00:00.000Z",
      },
      account: { id: "spotify-user", displayName: "Spotify User" },
    });

    expect(requests.map(({ url }) => url)).toEqual([
      "https://accounts.spotify.com/api/token",
      "https://api.spotify.com/v1/me",
    ]);
    expect(requests[0]!.init.method).toBe("POST");
    expect(requests[0]!.init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic c3BvdGlmeS1jbGllbnQ6c3BvdGlmeS1jcmVkZW50aWFs",
    });
    expect([...new URLSearchParams(String(requests[0]!.init.body))]).toEqual([
      ["grant_type", "authorization_code"],
      ["code", "bounded-code"],
      ["redirect_uri", callbackUri],
    ]);
    expect(requests[1]!.init.headers).toEqual({
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    });
    expectRedirectError(requests);

    const missingRefresh = makeProvider([
      jsonResponse({ access_token: "access", expires_in: 3_600 }),
    ]).provider;
    await expect(
      missingRefresh.exchangeCode({ code: "bounded-code", callbackUri }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
    await expect(
      provider.exchangeCode({ code: "x".repeat(8_193), callbackUri }),
    ).rejects.toMatchObject({ code: "provider_rejected" });
  });

  it.each([
    {
      field: "missing access token",
      response: { refresh_token: "refresh", expires_in: 3_600 },
    },
    {
      field: "non-string access token",
      response: {
        access_token: 42,
        refresh_token: "refresh",
        expires_in: 3_600,
      },
    },
    {
      field: "missing expiry",
      response: { access_token: "access", refresh_token: "refresh" },
    },
    {
      field: "non-integer expiry",
      response: {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: "3600",
      },
    },
    {
      field: "zero expiry",
      response: {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 0,
      },
    },
    {
      field: "oversized expiry",
      response: {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 86_401,
      },
    },
  ])("rejects an exchange response with $field", async ({ response }) => {
    const { provider } = makeProvider([jsonResponse(response)]);
    await expect(
      provider.exchangeCode({ code: "bounded-code", callbackUri }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("refreshes with confidential Basic authentication and preserves a missing replacement refresh token", async () => {
    const replacementAccess = `access-${randomUUID()}`;
    const existingRefresh = `refresh-${randomUUID()}`;
    const { provider, requests } = makeProvider([
      jsonResponse({
        access_token: replacementAccess,
        expires_in: 1_800,
        token_type: "Bearer",
      }),
    ]);

    await expect(
      provider.refresh({
        accessToken: "expiring-access",
        refreshToken: existingRefresh,
        expiresAt: "2026-07-25T12:01:00.000Z",
      }),
    ).resolves.toEqual({
      refreshed: true,
      secret: {
        accessToken: replacementAccess,
        refreshToken: existingRefresh,
        expiresAt: "2026-07-25T12:30:00.000Z",
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://accounts.spotify.com/api/token");
    expect(requests[0]!.init.method).toBe("POST");
    expect(requests[0]!.init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic c3BvdGlmeS1jbGllbnQ6c3BvdGlmeS1jcmVkZW50aWFs",
    });
    expect([...new URLSearchParams(String(requests[0]!.init.body))]).toEqual([
      ["grant_type", "refresh_token"],
      ["refresh_token", existingRefresh],
    ]);
    expectRedirectError(requests);

    const fresh = makeProvider([]).provider;
    await expect(
      fresh.refresh({
        accessToken: "fresh-access",
        refreshToken: existingRefresh,
        expiresAt: "2026-07-25T12:01:00.001Z",
      }),
    ).resolves.toEqual({
      refreshed: false,
      secret: {
        accessToken: "fresh-access",
        refreshToken: existingRefresh,
        expiresAt: "2026-07-25T12:01:00.001Z",
      },
    });
  });

  it("calls only fixed Spotify HTTPS endpoints with bounded query values", async () => {
    const { provider, requests } = makeProvider([
      jsonResponse({ items: [], total: 1, next: null }),
      jsonResponse({
        items: [
          {
            id: "playlist-1",
            name: "Playlist One",
            description: "",
            tracks: { total: 1 },
            images: [{ url: "https://i.scdn.co/image/playlist" }],
            owner: { display_name: "Owner" },
          },
        ],
        total: 1,
      }),
      jsonResponse({
        items: [{ track: spotifyTrack("playlist-track") }],
        total: 1,
      }),
      jsonResponse({ items: [spotifyTrack("top")] }),
    ]);

    await provider.likedTracks({
      accessToken: "access",
      offset: 1_000_000,
      limit: 50,
    });
    await provider.playlists({ accessToken: "access" });
    await provider.playlistTracks({
      accessToken: "access",
      playlistId: "playlist / identifier",
      offset: 0,
      limit: 1,
    });
    await provider.topTracks({
      accessToken: "access",
      timeRange: "long_term",
    });

    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.spotify.com/v1/me/tracks?offset=1000000&limit=50",
      "https://api.spotify.com/v1/me/playlists?limit=50",
      "https://api.spotify.com/v1/playlists/playlist%20%2F%20identifier/tracks?offset=0&limit=1&fields=items%28track%28id%2Cname%2Cartists%2Calbum%2Cduration_ms%2Cexternal_urls%29%29%2Ctotal%2Cnext",
      "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term",
    ]);
    expectRedirectError(requests);

    await expect(
      provider.likedTracks({
        accessToken: "access",
        offset: 1_000_001,
        limit: 50,
      }),
    ).rejects.toMatchObject({ code: "provider_rejected" });
    await expect(
      provider.playlistTracks({
        accessToken: "access",
        playlistId: "x".repeat(513),
        offset: 0,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "provider_rejected" });
  });

  it("reads Development Mode playlist items without treating metadata-only playlists as empty", async () => {
    const owned = {
      id: "owned", name: "Owned", description: null, images: [],
      owner: { display_name: null, id: "spotify-owner" },
    };
    const followed = Array.from({ length: 50 }, (_, index) => ({
      ...owned, id: `followed-${index}`, name: "Followed",
    }));
    const { provider, requests } = makeProvider([
      jsonResponse({ items: followed, total: 51 }),
      jsonResponse({ items: [{ ...owned, items: { total: 5 } }], total: 51 }),
      jsonResponse({ items: [
        { item: { ...spotifyTrack("first"), type: "track" } },
        { item: null },
        { item: { id: "episode", type: "episode" } },
        { is_local: true, item: { type: "track" } },
        { item: { ...spotifyTrack("last"), type: "track" } },
      ], total: 5 }),
    ], { playlistApi: "items" });

    await expect(provider.playlists({ accessToken: "access" })).resolves.toEqual({
      playlists: [{ id: "owned", name: "Owned", description: "", trackCount: 5,
        owner: "spotify-owner", thumbnailUrl: null }], total: 51,
    });
    expect(new URL(requests[1]!.url).searchParams.get("offset")).toBe("50");
    const page = await provider.playlistTracks({
      accessToken: "access", playlistId: "owned", offset: 0, limit: 5,
    });
    expect(page.tracks.map(({ id }) => id)).toEqual(["first", "last"]);
    expect(page).toMatchObject({ offset: 0, limit: 5, total: 5 });
    const url = new URL(requests[2]!.url);
    expect(url.pathname).toBe("/v1/playlists/owned/items");
    expect(url.searchParams.get("fields")).toContain("item(id,name,type,");
  });

  it.each([
    {},
    { id: "legacy", name: "Legacy", description: "", images: [],
      owner: { display_name: "Owner" }, tracks: { total: 1 } },
  ])("rejects malformed or wrong-profile playlists instead of reporting an empty library (%j)", async (item) => {
    const { provider, requests } = makeProvider([
      jsonResponse({ items: [item], total: 1 }),
    ], { playlistApi: "items" });
    await expect(provider.playlists({ accessToken: "access" }))
      .rejects.toMatchObject({ code: "invalid_provider_response" });
    expect(requests).toHaveLength(1);
  });

  it("does not present a zero-progress playlist page as an empty library", async () => {
    const { provider, requests } = makeProvider([
      jsonResponse({ items: [], total: 51 }),
    ], { playlistApi: "items" });
    await expect(provider.playlists({ accessToken: "access" }))
      .rejects.toMatchObject({ code: "provider_unavailable" });
    expect(requests).toHaveLength(1);
  });

  it.each(["liked", "playlist-items"] as const)("rejects a zero-progress %s track page without rejecting unavailable positions", async (kind) => {
    const wrapper = kind === "liked" ? "track" : "item";
    const { provider } = makeProvider([
      jsonResponse({ items: [], total: 80 }),
      jsonResponse({ items: [{ [wrapper]: null }], total: 51 }),
      jsonResponse({ items: [], total: 50 }),
    ], { playlistApi: "items" });
    const read = () => kind === "liked"
      ? provider.likedTracks({ accessToken: "access", offset: 50, limit: 1 })
      : provider.playlistTracks({ accessToken: "access", playlistId: "owned", offset: 50, limit: 1 });

    await expect(read()).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(read()).resolves.toEqual({ offset: 50, limit: 1, total: 51, tracks: [] });
    await expect(read()).resolves.toEqual({ offset: 50, limit: 1, total: 50, tracks: [] });
  });

  it("retains neighboring Spotify tracks when an album was taken down", async () => {
    const removed = spotifyTrack("RemovedAlbumTrack");
    const { provider } = makeProvider([jsonResponse({
      items: [
        { item: spotifyTrack("FirstTrack") },
        { item: { ...removed, album: { ...removed.album, name: "" } } },
        { item: spotifyTrack("LastTrack") },
      ],
      total: 3,
    })], { playlistApi: "items" });

    const result = await provider.playlistTracks({ accessToken: "access", playlistId: "owned", offset: 0, limit: 3 });
    expect(result.total).toBe(3);
    expect(result.tracks.map(({ id }) => id)).toEqual(["FirstTrack", "LastTrack"]);
  });

  it("rejects a track response larger than its requested page", async () => {
    const { provider } = makeProvider([jsonResponse({
      items: [{ track: spotifyTrack("FirstTrack") }, { track: spotifyTrack("LastTrack") }],
      total: 2,
    })]);

    await expect(provider.likedTracks({ accessToken: "access", offset: 0, limit: 1 }))
      .rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("fills a short playlist window using only the validated Spotify continuation offset", async () => {
    const { provider, requests } = makeProvider([
      jsonResponse({ items: [{ item: spotifyTrack("FirstTrack") }, { item: null }], total: 8,
        next: "https://api.spotify.com/v1/playlists/owned/items?offset=2&limit=50&market=US" }),
      jsonResponse({ items: [{ item: spotifyTrack("LastTrack") }], total: 8,
        next: "https://api.spotify.com/v1/playlists/owned/items?offset=4&limit=2" }),
    ], { playlistApi: "items" });

    const result = await provider.playlistTracks({ accessToken: "access", playlistId: "owned", offset: 0, limit: 4 });
    expect(result).toMatchObject({ offset: 0, limit: 4, total: 8 });
    expect(result.tracks.map(({ id }) => id)).toEqual(["FirstTrack", "LastTrack"]);
    expect(requests.map(({ url }) => {
      const request = new URL(url);
      return [request.pathname, request.searchParams.get("offset"), request.searchParams.get("limit"), request.searchParams.has("market")];
    })).toEqual([["/v1/playlists/owned/items", "0", "4", false], ["/v1/playlists/owned/items", "2", "2", false]]);
  });

  it("does not return partial liked tracks when the provider continuation is foreign", async () => {
    const { provider, requests } = makeProvider([jsonResponse({
      items: [{ track: spotifyTrack("FirstTrack") }], total: 8,
      next: "https://example.invalid/v1/me/tracks?offset=1",
    })]);

    await expect(provider.likedTracks({ accessToken: "access", offset: 0, limit: 4 }))
      .rejects.toMatchObject({ code: "invalid_provider_response" });
    expect(requests).toHaveLength(1);
  });

  it("bounds fragmented liked-track windows without accepting a partial result", async () => {
    const { provider, requests } = makeProvider(Array.from({ length: 4 }, (_, offset) => jsonResponse({
      items: [{ track: spotifyTrack(`Track${offset}`) }], total: 12,
      next: `https://api.spotify.com/v1/me/tracks?offset=${offset + 1}`,
    })));

    await expect(provider.likedTracks({ accessToken: "access", offset: 0, limit: 8 }))
      .rejects.toMatchObject({ code: "provider_unavailable" });
    expect(requests).toHaveLength(4);
  });

  it("rejects an album changing total between fragments of the same track window", async () => {
    const track = { ...spotifyTrack("AlbumTrack"), disc_number: 1, track_number: 1 };
    const { provider, requests } = makeProvider([
      jsonResponse({ offset: 0, limit: 4, total: 8, items: [track], next: "https://api.spotify.com/v1/albums/album1/tracks?offset=1" }),
      jsonResponse({ offset: 1, limit: 3, total: 9, items: [{ ...track, id: "OtherTrack" }], next: "https://api.spotify.com/v1/albums/album1/tracks?offset=4" }),
    ]);

    await expect(provider.albumTracks({ accessToken: "access", albumId: "album1", offset: 0, limit: 4 }))
      .rejects.toMatchObject({ code: "provider_unavailable" });
    expect(requests).toHaveLength(2);
  });

  it.each([
    { total: 2, limit: 2, count: 1, code: "provider_unavailable" },
    { total: 1, limit: 2, count: 2, code: "invalid_provider_response" },
  ])("rejects terminal track pages with $count raw rows for $total positions", async ({ total, limit, count, code }) => {
    const { provider } = makeProvider([jsonResponse({
      items: Array.from({ length: count }, (_, index) => ({ track: spotifyTrack(`Track${index}`) })),
      total,
      next: null,
    })]);

    await expect(provider.likedTracks({ accessToken: "access", offset: 0, limit }))
      .rejects.toMatchObject({ code });
  });

  describe("playlist catalog pages", () => {
    const metadata = {
      id: "playlistA", name: "Playlist A", description: null, images: [],
      owner: { display_name: null, id: "ownerA" },
    };

    it("advances over an empty filtered page using its partial raw count, not the next URL", async () => {
      const { provider, requests } = makeProvider([jsonResponse({
        offset: 40, limit: 50, total: 120,
        next: "https://untrusted.invalid/?offset=90",
        items: [metadata, { ...metadata, id: "playlistB" }],
      })], { playlistApi: "items" });
      const signal = new AbortController().signal;

      await expect(provider.playlistsPage({ accessToken: "access", offset: 40, limit: 50, signal }))
        .resolves.toStrictEqual({ offset: 40, limit: 50, total: 120, nextOffset: 42, playlists: [] });
      expect(requests.map(({ url }) => url)).toEqual(["https://api.spotify.com/v1/me/playlists?offset=40&limit=50"]);
      expect(requests[0]?.init.signal).toBe(signal);
    });

    it.each(["tracks", "items"] as const)("normalizes only readable %s-profile metadata on a terminal page", async (profile) => {
      const { provider, requests } = makeProvider([jsonResponse({
        offset: 10, limit: 3, total: 11,
        items: [{ ...metadata, [profile]: { total: 4 }, unrelated: "not exposed" }],
      })], { playlistApi: profile });

      await expect(provider.playlistsPage({ accessToken: "access", offset: 10, limit: 3 }))
        .resolves.toStrictEqual({ offset: 10, limit: 3, total: 11, nextOffset: null, playlists: [
          { id: "playlistA", name: "Playlist A", description: "", trackCount: 4, thumbnailUrl: null, owner: "ownerA" },
        ] });
      expect(requests).toHaveLength(1);
    });

    it.each([
      { name: "mismatched offset", change: { offset: 1 } },
      { name: "mismatched limit", change: { limit: 2 } },
      { name: "excess raw rows", change: { items: [metadata, metadata] } },
      { name: "rows beyond total", change: { total: 0 } },
      { name: "wrong profile", change: { items: [{ ...metadata, tracks: { total: 2 } }] } },
      { name: "zero progress before total", change: { items: [] }, code: "provider_unavailable" },
    ])("rejects $name without fetching another page", async ({ change, code }) => {
      const { provider, requests } = makeProvider([jsonResponse({
        offset: 0, limit: 1, total: 2, items: [metadata], ...change,
      })], { playlistApi: "items" });

      await expect(provider.playlistsPage({ accessToken: "access", offset: 0, limit: 1 }))
        .rejects.toMatchObject({ code: code ?? "invalid_provider_response" });
      expect(requests).toHaveLength(1);
    });

    it.each([
      [SPOTIFY_PLAYLIST_MAX_OFFSET - 1, SPOTIFY_PLAYLIST_MAX_OFFSET],
      [SPOTIFY_PLAYLIST_MAX_OFFSET, null],
    ] as const)("keeps readable rows at offset %s with bounded successor %s", async (offset, nextOffset) => {
      const total = SPOTIFY_PLAYLIST_MAX_OFFSET + 2;
      const { provider, requests } = makeProvider([jsonResponse({
        offset, limit: 1, total, items: [{ ...metadata, items: { total: 4 } }],
      })], { playlistApi: "items" });

      await expect(provider.playlistsPage({ accessToken: "access", offset, limit: 1 }))
        .resolves.toStrictEqual({ offset, limit: 1, total, nextOffset, playlists: [
          { id: "playlistA", name: "Playlist A", description: "", trackCount: 4, thumbnailUrl: null, owner: "ownerA" },
        ] });
      expect(requests).toHaveLength(1);
    });

    it("rejects inputs outside the playlist-specific bounds without a request", async () => {
      const { provider, requests } = makeProvider([]);
      for (const input of [
        { offset: SPOTIFY_PLAYLIST_MAX_OFFSET + 1, limit: 1 },
        { offset: 0, limit: SPOTIFY_PLAYLIST_PAGE_SIZE + 1 },
      ]) {
        await expect(provider.playlistsPage({ accessToken: "access", ...input }))
          .rejects.toMatchObject({ code: "provider_rejected" });
      }
      expect(requests).toEqual([]);
    });
  });

  it("does not fall back to the legacy endpoint after a playlist access refusal", async () => {
    const { provider, requests } = makeProvider([
      jsonResponse({ error: { status: 403 } }, 403),
    ], { playlistApi: "items" });
    await expect(provider.playlistTracks({
      accessToken: "access", playlistId: "followed", offset: 0, limit: 1,
    })).rejects.toMatchObject({ code: "provider_rejected" });
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/v1/playlists/followed/items",
    ]);
  });

  it("reads saved albums and ordered simplified tracks as attributed metadata only", async () => {
    const signal = new AbortController().signal;
    const { provider, requests } = makeProvider([
      jsonResponse({ offset: 10, limit: 2, total: 12, items: [{ album: { id: "removed1", name: "" } }, { album: {
        id: "album1", name: "Album", artists: [{ name: "Artist" }], total_tracks: 2,
        images: [{ url: "https://i.scdn.co/image/cover", width: null }],
        tracks: { items: [{ preview_url: "https://p.scdn.co/preview" }] },
      } }] }),
      jsonResponse({ offset: 0, limit: 2, total: 2, items: [
        { id: "track2", name: "Second Disc", artists: [{ name: "Artist" }], duration_ms: 181250,
          disc_number: 2, track_number: 1, preview_url: "https://p.scdn.co/preview" },
        { id: "track1", name: "First Disc", artists: [{ name: "Artist" }], duration_ms: 193000,
          disc_number: 1, track_number: 1 },
      ] }),
    ]);
    await expect(provider.savedAlbums({ accessToken: "access", offset: 10, limit: 2, signal })).resolves.toEqual({
      offset: 10, limit: 2, total: 12, albums: [{ id: "album1", title: "Album", artist: "Artist",
        trackCount: 2, thumbnailUrl: "https://i.scdn.co/image/cover", providerUrl: "https://open.spotify.com/album/album1" }],
    });
    await expect(provider.albumTracks({ accessToken: "access", albumId: "album1", offset: 0, limit: 2, signal })).resolves.toEqual({
      offset: 0, limit: 2, total: 2, tracks: [
        { id: "track2", title: "Second Disc", artist: "Artist", duration: 181, discNumber: 2, trackNumber: 1,
          providerUrl: "https://open.spotify.com/track/track2" },
        { id: "track1", title: "First Disc", artist: "Artist", duration: 193, discNumber: 1, trackNumber: 1,
          providerUrl: "https://open.spotify.com/track/track1" },
      ],
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.spotify.com/v1/me/albums?offset=10&limit=2",
      "https://api.spotify.com/v1/albums/album1/tracks?offset=0&limit=2",
    ]);
    expect(requests.every(({ init }) => init.signal === signal)).toBe(true);
  });

  it("bounds saved album pages before asking Spotify for embedded track data", async () => {
    const { provider, requests } = makeProvider([]);
    await expect(provider.savedAlbums({ accessToken: "access", offset: 0, limit: 11 }))
      .rejects.toMatchObject({ code: "provider_rejected" });
    expect(requests).toHaveLength(0);
  });

  it("does not fetch invalid album IDs or accept a mismatched upstream page", async () => {
    const { provider, requests } = makeProvider([
      jsonResponse({ offset: 50, limit: 1, total: 51, items: [] }),
    ]);
    await expect(provider.albumTracks({ accessToken: "access", albumId: "album%2F1", offset: 0, limit: 1 }))
      .rejects.toMatchObject({ code: "provider_rejected" });
    expect(requests).toHaveLength(0);
    await expect(provider.savedAlbums({ accessToken: "access", offset: 0, limit: 1 }))
      .rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("forwards the command abort signal to every fixed Spotify request", async () => {
    const controller = new AbortController();
    const { provider, requests } = makeProvider([
      jsonResponse({ items: [], total: 0 }),
    ]);

    await provider.likedTracks({
      accessToken: "access",
      offset: 0,
      limit: 1,
      signal: controller.signal,
    });

    expect(requests[0]?.init.signal).toBe(controller.signal);
  });

  it.each([
    ["0", 0],
    ["00042", 42],
    ["86400", 86_400],
    ["86401", undefined],
    ["+3", undefined],
    ["-1", undefined],
    ["3.0", undefined],
    ["1e2", undefined],
    ["4, 5", undefined],
    ["Wed, 21 Oct 2015 07:28:00 GMT", undefined],
    ["", undefined],
    [null, undefined],
  ] as const)("handles Spotify 429 with Retry-After %j without retrying or reading its body", async (header, seconds) => {
    const response = new Response("private provider body", {
      status: 429,
      headers: header === null ? undefined : { "Retry-After": header },
    });
    const cancel = vi.spyOn(response.body!, "cancel");
    const getReader = vi.spyOn(response.body!, "getReader");
    const { provider, requests } = makeProvider([response]);
    const error = await provider.likedTracks({ accessToken: "access", offset: 0, limit: 1 })
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: "provider_rate_limited", retryAfterSeconds: seconds });
    expect(JSON.stringify(error)).not.toContain("private provider body");
    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it.each(["token exchange", "profile lookup"])("keeps Spotify OAuth %s 429 as a provider rejection", async (stage) => {
    const throttled = new Response("private provider body", {
      status: 429,
      headers: { "Retry-After": "5" },
    });
    const cancel = vi.spyOn(throttled.body!, "cancel");
    const responses = stage === "token exchange" ? [throttled] : [
      jsonResponse({ access_token: "access", refresh_token: "refresh", expires_in: 3_600 }),
      throttled,
    ];
    const { provider, requests } = makeProvider(responses);

    await expect(provider.exchangeCode({ code: "code", callbackUri })).rejects.toMatchObject({
      code: "provider_rejected",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(responses.length);
  });

  it("cancels non-OK and oversized declared response bodies before throwing", async () => {
    const nonOk = new Response("provider-error-body", { status: 503 });
    const nonOkCancel = vi.spyOn(nonOk.body!, "cancel");
    const nonOkProvider = makeProvider([nonOk]).provider;
    await expect(
      nonOkProvider.likedTracks({
        accessToken: "access",
        offset: 0,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(nonOkCancel).toHaveBeenCalledOnce();

    const declaredOversized = new Response("{}", {
      status: 200,
      headers: { "content-length": String(1024 * 1024 + 1) },
    });
    const oversizedCancel = vi.spyOn(
      declaredOversized.body!,
      "cancel",
    );
    const oversizedProvider = makeProvider([declaredOversized]).provider;
    await expect(
      oversizedProvider.playlists({ accessToken: "access" }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
    expect(oversizedCancel).toHaveBeenCalledOnce();
  });

  it("bounds streaming JSON and cancels stalled or non-terminating bodies on abort", async () => {
    let oversizedCancelled = false;
    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel() {
        oversizedCancelled = true;
      },
    });
    const oversizedProvider = makeProvider([
      new Response(oversizedStream, { status: 200 }),
    ]).provider;
    const oversizedOutcome = await providerOutcomeWithin(
      oversizedProvider.likedTracks({
        accessToken: "access",
        offset: 0,
        limit: 1,
      }),
    );
    expect(oversizedOutcome).toMatchObject({
      error: expect.objectContaining({
        code: "invalid_provider_response",
      }),
    });
    expect(oversizedCancelled).toBe(true);

    let stalledCancelled = false;
    const stalledStream = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel() {
        stalledCancelled = true;
      },
    });
    const stalledProvider = makeProvider([
      new Response(stalledStream, { status: 200 }),
    ]).provider;
    const controller = new AbortController();
    const stalled = stalledProvider.likedTracks({
      accessToken: "access",
      offset: 0,
      limit: 1,
      signal: controller.signal,
    });
    controller.abort();
    const stalledOutcome = await providerOutcomeWithin(stalled);
    expect(stalledOutcome).toMatchObject({
      error: expect.objectContaining({ code: "provider_unavailable" }),
    });
    expect(stalledCancelled).toBe(true);
  });

  it("drains finite malformed JSON and returns only a stable provider error", async () => {
    const malformed = makeProvider([
      new Response("{", { status: 200 }),
    ]).provider;

    await expect(
      malformed.playlists({ accessToken: "access" }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("rejects dot-segment playlist IDs before constructing a provider path", async () => {
    const { provider, requests } = makeProvider([
      jsonResponse({
        items: [{ track: spotifyTrack("playlist-track") }],
        total: 1,
      }),
    ]);

    for (const playlistId of [".", ".."]) {
      await expect(
        provider.playlistTracks({
          accessToken: "access",
          playlistId,
          offset: 0,
          limit: 1,
        }),
      ).rejects.toMatchObject({ code: "provider_rejected" });
    }
    expect(requests).toHaveLength(0);

    await expect(
      provider.playlistTracks({
        accessToken: "access",
        playlistId: "playlist..safe",
        offset: 0,
        limit: 1,
      }),
    ).resolves.toMatchObject({ total: 1 });
    expect(requests[0]!.url).toBe(
      "https://api.spotify.com/v1/playlists/playlist..safe/tracks?offset=0&limit=1&fields=items%28track%28id%2Cname%2Cartists%2Calbum%2Cduration_ms%2Cexternal_urls%29%29%2Ctotal%2Cnext",
    );
  });

  it("strictly validates and normalizes liked tracks, playlists, playlist tracks, and top tracks", async () => {
    const expectedTrack = {
      id: "track-1",
      title: "Track One",
      artist: "Artist One, Artist Two",
      album: "Album One",
      duration: 182,
      thumbnailUrl: "https://i.scdn.co/image/large",
      providerUrl: "https://open.spotify.com/track/track-1",
    };
    const { provider } = makeProvider([
      jsonResponse({ items: [{ track: spotifyTrack() }, { track: null }], total: 7, next: null }),
      jsonResponse({
        items: [
          {
            id: "playlist-1",
            name: "Playlist One",
            description: "Description",
            tracks: { total: 7 },
            images: [{ url: "https://i.scdn.co/image/playlist" }],
            owner: { display_name: "Playlist Owner" },
          },
        ],
        total: 1,
      }),
      jsonResponse({ items: [{ track: spotifyTrack() }, { track: null }], total: 7, next: null }),
      jsonResponse({ items: [spotifyTrack()] }),
    ]);

    await expect(
      provider.likedTracks({ accessToken: "access", offset: 5, limit: 2 }),
    ).resolves.toEqual({
      offset: 5,
      limit: 2,
      total: 7,
      tracks: [expectedTrack],
    });
    await expect(
      provider.playlists({ accessToken: "access" }),
    ).resolves.toEqual({
      playlists: [
        {
          id: "playlist-1",
          name: "Playlist One",
          description: "Description",
          trackCount: 7,
          thumbnailUrl: "https://i.scdn.co/image/playlist",
          owner: "Playlist Owner",
        },
      ],
      total: 1,
    });
    await expect(
      provider.playlistTracks({
        accessToken: "access",
        playlistId: "playlist-1",
        offset: 5,
        limit: 2,
      }),
    ).resolves.toEqual({
      offset: 5,
      limit: 2,
      total: 7,
      tracks: [expectedTrack],
    });
    await expect(
      provider.topTracks({
        accessToken: "access",
        timeRange: "medium_term",
      }),
    ).resolves.toEqual({ tracks: [expectedTrack] });

    const malformed = makeProvider([
      jsonResponse({
        items: [
          {
            track: {
              ...spotifyTrack(),
              duration_ms: "182999",
            },
          },
        ],
        total: 1,
      }),
    ]).provider;
    await expect(
      malformed.likedTracks({ accessToken: "access", offset: 0, limit: 1 }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("rejects a malformed playlist-track response independently", async () => {
    const malformedPlaylistTracks = makeProvider([
      jsonResponse({
        items: [
          {
            track: {
              ...spotifyTrack(),
              external_urls: {
                spotify: "http://open.spotify.com/track/track-1",
              },
            },
          },
        ],
        total: 1,
      }),
    ]).provider;
    await expect(
      malformedPlaylistTracks.playlistTracks({
        accessToken: "access",
        playlistId: "playlist-1",
        offset: 0,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("rejects a malformed top-track response independently", async () => {
    const malformedTopTracks = makeProvider([
      jsonResponse({
        items: [{ ...spotifyTrack(), artists: [{ name: 42 }] }],
      }),
    ]).provider;
    await expect(
      malformedTopTracks.topTracks({
        accessToken: "access",
        timeRange: "medium_term",
      }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("returns stable provider errors without raw body, token, code, URL query, or credentials", async () => {
    const tokenCanary = `token-${randomUUID()}`;
    const codeCanary = `code-${randomUUID()}`;
    const bodyCanary = `body-${randomUUID()}`;
    const credentialCanary = `credential-${randomUUID()}`;
    const queryCanary = `query-${randomUUID()}`;
    const logged: unknown[] = [];
    const { provider } = makeProvider(
      [
        new Response(bodyCanary, {
          status: 401,
          headers: { "Content-Type": "text/plain" },
        }),
      ],
      {
        clientSecret: credentialCanary,
        logger: {
          error(event, message) {
            logged.push(event, message);
          },
        },
      },
    );

    let caught: unknown;
    try {
      await provider.exchangeCode({
        code: codeCanary,
        callbackUri: `${callbackUri}?${queryCanary}`,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "provider_rejected" });

    const failed = makeProvider(
      [
        new Response(bodyCanary, {
          status: 401,
          headers: { "Content-Type": "text/plain" },
        }),
      ],
      {
        clientSecret: credentialCanary,
        logger: {
          error(event, message) {
            logged.push(event, message);
          },
        },
      },
    ).provider;
    try {
      await failed.likedTracks({
        accessToken: tokenCanary,
        offset: 0,
        limit: 1,
      });
    } catch (error) {
      caught = error;
    }

    const exposed = JSON.stringify({ caught: String(caught), logged });
    expect(caught).toMatchObject({ code: "provider_rejected" });
    expect(exposed).not.toContain(tokenCanary);
    expect(exposed).not.toContain(codeCanary);
    expect(exposed).not.toContain(bodyCanary);
    expect(exposed).not.toContain(credentialCanary);
    expect(exposed).not.toContain(queryCanary);
    expect(exposed).not.toContain(callbackUri);
  });
});
