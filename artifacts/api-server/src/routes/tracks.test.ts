import { once } from "node:events";
import { EventEmitter } from "node:events";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import express, { type Response as ExpressResponse } from "express";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TfSearchGateway } from "../lib/tf-search-client.js";
import { HttpTfSearchClient } from "../lib/tf-search-client.js";
import { downloadJobDataSchema } from "@workspace/tf-download-contract";
import { createMediaLinkAdmission, MediaLinkAdmissionError } from "../lib/media-link-admission.js";
import { MediaLinkResolutionError } from "../lib/media-link.js";
import {
  TfDownloadWorkerError,
  type TfDownloadWorkerGateway,
} from "../lib/tf-download-worker-client.js";
import {
  DownloadQueueCapacityError,
  DownloadQueueUnavailableError,
} from "../lib/background-queue.js";
import { createTracksRouter, type TrackRouteDependencies } from "./tracks.js";

const ytdlpMocks = vi.hoisted(() => ({
  getStreamUrl: vi.fn(),
  spawnAudioDownload: vi.fn(),
}));

const durationProbeMock = vi.hoisted(() => vi.fn());

vi.mock("@workspace/tf-download-contract/duration-probe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/tf-download-contract/duration-probe")>()),
  probeSourceDuration: durationProbeMock,
}));

vi.mock("../lib/ytdlp.js", () => ({
  getStreamUrl: ytdlpMocks.getStreamUrl,
  spawnAudioDownload: ytdlpMocks.spawnAudioDownload,
}));

const streamCacheMocks = vi.hoisted(() => ({
  getCachedStreamUrl: vi.fn(),
  setCachedStreamUrl: vi.fn(),
}));

vi.mock("../lib/stream-cache.js", () => streamCacheMocks);

vi.hoisted(() => {
  process.env["DATABASE_URL"] ??= "postgres://unused:unused@127.0.0.1:1/unused";
});

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ACCOUNT_ID = "90000000-0000-4000-8000-000000000009";
const JOB_ID = "30000000-0000-4000-8000-000000000003";
const principal = {
  accountId: ACCOUNT_ID,
  tfSessionId: "40000000-0000-4000-8000-000000000004",
  installationId: "30000000-0000-4000-8000-000000000003",
  entitlements: [
    "tf.collections",
    "tf.downloads",
    "tf.integrations",
    "tf.search",
  ],
  sessionExpiresAt: "2026-07-24T04:00:00.000Z",
  policyFreshUntil: "2026-07-24T03:05:00.000Z",
} as const;
const servers: Server[] = [];
const testLogger = pino({ enabled: false });

function trackIdFor(
  source: "yt" | "sc" | "bc" | "dz",
  sourceUrl: string,
): string {
  return `${source}_${Buffer.from(sourceUrl, "utf8").toString("base64url")}`;
}

function queueTrack(overrides: Record<string, unknown> = {}) {
  return {
    trackId: trackIdFor("yt", "https://www.youtube.com/watch?v=queue-contract"),
    artist: "Artist",
    title: "Title",
    quality: "320",
    ...overrides,
  };
}

function result(
  index = 0,
  overrides: Partial<{
    readonly id: string;
    readonly score: number;
    readonly source: "youtube" | "soundcloud" | "bandcamp" | "deezer";
    readonly sourceUrl: string;
  }> = {},
) {
  return {
    id: overrides.id ?? `yt_result_${index}`,
    title: `Track ${index}`,
    artist: "Artist",
    type: "original" as const,
    duration: 180,
    source: overrides.source ?? ("youtube" as const),
    thumbnailUrl: null,
    quality: ["128", "320"],
    viewCount: 42,
    score: overrides.score ?? 90 - index,
    sourceUrl:
      overrides.sourceUrl ?? `https://www.youtube.com/watch?v=result-${index}`,
  };
}

function searchResponse(
  overrides: Partial<{
    readonly results: ReturnType<typeof result>[];
    readonly cached: boolean;
    readonly sources: ("yt" | "sc" | "bc" | "dz")[];
    readonly fallbackAvailable: boolean;
  }> = {},
) {
  return {
    schemaVersion: 1 as const,
    requestId: "10000000-0000-4000-8000-000000000001",
    query: "Artist Track",
    results: overrides.results ?? [result()],
    cached: overrides.cached ?? false,
    sources: overrides.sources ?? ["yt", "sc", "bc", "dz"],
    fallbackAvailable: overrides.fallbackAvailable ?? false,
    providerStatus: {
      yt: "ok" as const,
      sc: "ok" as const,
      bc: "ok" as const,
      dz: "ok" as const,
    },
  };
}

function artistDiscoveryResponse(
  overrides: Partial<{
    readonly query: string;
    readonly results: ReturnType<typeof result>[];
  }> = {},
) {
  return {
    schemaVersion: 1 as const,
    requestId: "10000000-0000-4000-8000-000000000001",
    query: overrides.query ?? "Artist",
    results: overrides.results ?? [result()],
    sources: ["yt", "sc"] as const,
    providerStatus: {
      yt: "ok" as const,
      sc: "ok" as const,
      bc: "skipped" as const,
      dz: "skipped" as const,
    },
  };
}

function searchGateway() {
  return {
    search: vi.fn().mockResolvedValue(searchResponse()),
    freeSearch: vi.fn().mockResolvedValue(searchResponse()),
    discoverArtist: vi.fn().mockResolvedValue(artistDiscoveryResponse()),
    suggestions: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      requestId: "10000000-0000-4000-8000-000000000001",
      suggestions: [{ artist: "Artist", title: "Track" }],
    }),
    sourceReference: vi.fn().mockResolvedValue(sourceReference("unknown")),
  } satisfies TfSearchGateway;
}

function sourceReference(status: "known" | "unknown" | "ambiguous", duration = 210) {
  const now = Date.now();
  return {
    schemaVersion: 1 as const,
    requestId: ACCOUNT_ID,
    sourceKey: "yt:server-reference",
    status,
    ...(status === "known" ? { reference: {
      artist: "Server Artist",
      title: "Server Title (Live)",
      type: "live" as const,
      expectedDurationSeconds: duration,
      provenance: "catalog" as const,
      observedAt: now,
      expiresAt: now + 300_000,
    } } : {}),
  };
}

function downloadWorkerGateway(): TfDownloadWorkerGateway & {
  readonly openFile: ReturnType<typeof vi.fn>;
} {
  return {
    openFile: vi.fn().mockRejectedValue(new TfDownloadWorkerError(404)),
  };
}

function routeDependencies(overrides: Partial<TrackRouteDependencies> = {}) {
  const dependencies = {
    searchGateway: searchGateway(),
    admitMediaLink: createMediaLinkAdmission(),
    resolveMediaLink: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      source: "youtube",
      artist: "Artist",
      title: "Track",
      durationSeconds: 180,
    }),
    loadRecentTracks: vi.fn().mockResolvedValue([
      {
        trackId: "recent-track",
        artist: "Artist",
        title: "Title",
      },
    ]),
    recordPlay: vi.fn().mockResolvedValue(undefined),
    recordLyricsFeedback: vi.fn().mockResolvedValue("recorded"),
    loadTopArtists: vi.fn().mockResolvedValue([]),
    loadLikedArtists: vi.fn().mockResolvedValue([]),
    enqueueDownload: vi.fn().mockResolvedValue({
      jobId: "job-created",
      position: 1,
    }),
    listDownloadJobs: vi.fn().mockResolvedValue([]),
    getDownloadJobStatus: vi.fn().mockResolvedValue({
      status: "waiting",
      progress: 0,
    }),
    cancelDownloadJob: vi.fn().mockResolvedValue({ status: "canceled" }),
    downloadWorkerGateway: downloadWorkerGateway(),
  };
  return Object.assign(
    dependencies,
    overrides,
  ) satisfies TrackRouteDependencies;
}

async function startTracksServer(
  dependencies: TrackRouteDependencies,
  currentPrincipal: {
    readonly accountId: string;
    readonly tfSessionId: string;
    readonly installationId: string;
    readonly entitlements: readonly string[];
    readonly sessionExpiresAt: string;
    readonly policyFreshUntil: string;
  } = principal,
  observeResponse?: (response: ExpressResponse) => void,
): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((request, response, next) => {
    request.tfPrincipal = currentPrincipal;
    request.log = testLogger;
    observeResponse?.(response);
    next();
  });
  app.use("/api", createTracksRouter(dependencies));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/api`;
}

beforeEach(() => {
  streamCacheMocks.getCachedStreamUrl.mockReset().mockResolvedValue(null);
  streamCacheMocks.setCachedStreamUrl.mockReset().mockResolvedValue(undefined);
  ytdlpMocks.getStreamUrl.mockReset();
  durationProbeMock.mockReset();
});

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("TF search module routing", () => {
  it("returns pasted track-link metadata without selecting playable media", async () => {
    const dependencies = routeDependencies();
    const baseUrl = await startTracksServer(dependencies);
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const response = await fetch(`${baseUrl}/tracks/link-metadata`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      source: "youtube",
      artist: "Artist",
      title: "Track",
      durationSeconds: 180,
    });
    expect(dependencies.resolveMediaLink).toHaveBeenCalledWith(url);
    expect(dependencies.searchGateway.search).not.toHaveBeenCalled();
  });

  it("rejects invalid link input before provider metadata lookup", async () => {
    const dependencies = routeDependencies();
    const baseUrl = await startTracksServer(dependencies);
    const response = await fetch(`${baseUrl}/tracks/link-metadata`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "" }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad_request" });
    expect(dependencies.resolveMediaLink).not.toHaveBeenCalled();
  });

  it("returns stable errors for unsupported and unavailable media links", async () => {
    const dependencies = routeDependencies();
    const baseUrl = await startTracksServer(dependencies);
    for (const [code, status] of [
      ["unsupported_media_link", 422],
      ["media_link_unavailable", 503],
    ] as const) {
      dependencies.resolveMediaLink.mockRejectedValueOnce(new MediaLinkResolutionError(code));
      const response = await fetch(`${baseUrl}/tracks/link-metadata`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://soundcloud.com/artist/track" }),
      });
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: code });
    }
  });

  it.each([
    ["media_link_rate_limited", 429, 17],
    ["media_link_overloaded", 503, 1],
  ] as const)("maps %s admission to a stable response", async (code, status, retryAfterSeconds) => {
    const admitMediaLink = vi.fn().mockRejectedValue(
      new MediaLinkAdmissionError(code, retryAfterSeconds),
    );
    const dependencies = routeDependencies({ admitMediaLink });
    const baseUrl = await startTracksServer(dependencies);
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    const response = await fetch(`${baseUrl}/tracks/link-metadata`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });

    expect(response.status).toBe(status);
    expect(response.headers.get("retry-after")).toBe(String(retryAfterSeconds));
    await expect(response.json()).resolves.toEqual({ error: code });
    expect(admitMediaLink).toHaveBeenCalledWith(ACCOUNT_ID, url, expect.any(Function));
    expect(dependencies.resolveMediaLink).not.toHaveBeenCalled();
  });

  it("shares an in-flight link lookup for one account without spending another request", async () => {
    let release!: (value: Awaited<ReturnType<TrackRouteDependencies["resolveMediaLink"]>>) => void;
    const pending = new Promise<Awaited<ReturnType<TrackRouteDependencies["resolveMediaLink"]>>>(
      (resolve) => { release = resolve; },
    );
    const dependencies = routeDependencies({
      admitMediaLink: createMediaLinkAdmission({ maxRequestsPerAccount: 1, now: () => 0 }),
    });
    dependencies.resolveMediaLink.mockReturnValueOnce(pending);
    const baseUrl = await startTracksServer(dependencies);
    const request = (url: string) => fetch(`${baseUrl}/tracks/link-metadata`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    const first = request(url);
    await vi.waitFor(() => expect(dependencies.resolveMediaLink).toHaveBeenCalledTimes(1));
    const joined = request(url);
    const limited = await request("https://www.youtube.com/watch?v=another-ID");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    release({ schemaVersion: 1, source: "youtube", title: "Track" });

    const [firstResponse, joinedResponse] = await Promise.all([first, joined]);
    expect(firstResponse.status).toBe(200);
    expect(joinedResponse.status).toBe(200);
    expect(dependencies.resolveMediaLink).toHaveBeenCalledTimes(1);
  });

  it("passes free text with account scope and strips internal result URLs", async () => {
    const gateway = searchGateway();
    gateway.freeSearch.mockResolvedValue({ ...searchResponse(), query: "late night music" });
    const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));
    const result = await fetch(`${baseUrl}/tracks/free-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "  late night music  ", mode: "manual", sources: ["yt"] }),
    });
    expect(result.status).toBe(200);
    expect(gateway.freeSearch).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID, query: "late night music", mode: "manual", sources: ["yt"], maxResults: 20,
    });
    expect(JSON.stringify(await result.json())).not.toContain("sourceUrl");
    const invalid = await fetch(`${baseUrl}/tracks/free-search`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "x" }),
    });
    expect(invalid.status).toBe(400);
  });
  it("preserves the public search response while stripping module-only fields", async () => {
    const gateway = searchGateway();
    gateway.search.mockResolvedValue(
      searchResponse({
        sources: ["yt"],
        fallbackAvailable: true,
      }),
    );
    const baseUrl = await startTracksServer(
      routeDependencies({ searchGateway: gateway }),
    );

    const response = await fetch(`${baseUrl}/tracks/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artist: "Artist",
        title: "Track",
        mode: "manual",
        sources: ["yt"],
        maxResults: 7,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(gateway.search).toHaveBeenCalledWith({
      artist: "Artist",
      title: "Track",
      accountId: ACCOUNT_ID,
      mode: "manual",
      sources: ["yt"],
      maxResults: 7,
    });
    expect(body).toEqual({
      query: "Artist Track",
      results: [
        {
          id: "yt_result_0",
          title: "Track 0",
          artist: "Artist",
          type: "original",
          duration: 180,
          source: "youtube",
          thumbnailUrl: null,
          quality: ["128", "320"],
          viewCount: 42,
          score: 90,
        },
      ],
      cached: false,
      sources: ["yt"],
      fallbackAvailable: true,
    });
    expect(JSON.stringify(body)).not.toContain("sourceUrl");
    expect(JSON.stringify(body)).not.toContain("providerStatus");
  });

  it("maps a failed public search dispatch to the stable unavailable response", async () => {
    const gateway = searchGateway();
    gateway.search.mockRejectedValue(new Error("private module detail"));
    const baseUrl = await startTracksServer(
      routeDependencies({ searchGateway: gateway }),
    );

    const response = await fetch(`${baseUrl}/tracks/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artist: "Artist", title: "Track" }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "search_unavailable",
    });
  });

  it("rejects out-of-contract source and max-result bounds before dispatch", async () => {
    const gateway = searchGateway();
    const baseUrl = await startTracksServer(
      routeDependencies({ searchGateway: gateway }),
    );

    for (const { body, message } of [
      {
        body: {
          artist: "Artist",
          title: "Track",
          mode: "manual",
          sources: ["yt", "yt"],
        },
        message: "invalid search options",
      },
      {
        body: {
          artist: "Artist",
          title: "Track",
          maxResults: 41,
        },
        message: "artist and title are required",
      },
      {
        body: {
          artist: "Artist",
          title: "Track",
          maxResults: 1.5,
        },
        message: "invalid search options",
      },
    ]) {
      const response = await fetch(`${baseUrl}/tracks/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "bad_request",
        message,
      });
    }
    expect(gateway.search).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only artist or title before gateway dispatch", async () => {
    const gateway = searchGateway();
    const baseUrl = await startTracksServer(
      routeDependencies({ searchGateway: gateway }),
    );

    for (const body of [
      { artist: "   ", title: "Track" },
      { artist: "Artist", title: "\t\r\n" },
    ]) {
      const response = await fetch(`${baseUrl}/tracks/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "bad_request",
        message: "artist and title are required",
      });
    }

    expect(gateway.search).not.toHaveBeenCalled();
  });

  it("keeps batch concurrency at eight, truncates to five, and applies the score threshold", async () => {
    let active = 0;
    let maximumActive = 0;
    const gateway = searchGateway();
    gateway.search.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return searchResponse({
        results: Array.from({ length: 6 }, (_, index) =>
          result(index, { score: index === 0 ? 80 : 79 - index }),
        ),
      });
    });
    const baseUrl = await startTracksServer(
      routeDependencies({ searchGateway: gateway }),
    );
    const tracks = Array.from({ length: 17 }, (_, index) => ({
      artist: `Artist ${index}`,
      title: `Track ${index}`,
    }));

    const response = await fetch(`${baseUrl}/tracks/batch-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks }),
    });
    const body = (await response.json()) as {
      results: {
        matches: Record<string, unknown>[];
        bestScore: number;
        autoSelected: boolean;
      }[];
    };

    expect(response.status).toBe(200);
    expect(gateway.search).toHaveBeenCalledTimes(17);
    expect(maximumActive).toBe(8);
    expect(body.results).toHaveLength(17);
    expect(body.results[0]).toMatchObject({
      bestScore: 80,
      autoSelected: true,
    });
    expect(body.results[0]?.matches).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain("sourceUrl");

    gateway.search.mockClear();
    const rejected = await fetch(`${baseUrl}/tracks/batch-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tracks: Array.from({ length: 101 }, () => ({
          artist: "Artist",
          title: "Track",
        })),
      }),
    });
    expect(rejected.status).toBe(400);
    expect(gateway.search).not.toHaveBeenCalled();
  });

  it("delegates suggestions to the module cache", async () => {
    const gateway = searchGateway();
    const baseUrl = await startTracksServer(
      routeDependencies({ searchGateway: gateway }),
      { ...principal, accountId: OTHER_ACCOUNT_ID },
    );

    const response = await fetch(`${baseUrl}/tracks/suggest?q=%20ArTiSt%20`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggestions: [{ artist: "Artist", title: "Track" }],
    });
    expect(gateway.suggestions).toHaveBeenCalledWith(OTHER_ACCOUNT_ID, "artist", 5);
  });

  it("rejects an overlong suggestion query before calling the module", async () => {
    const gateway = searchGateway();
    const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));

    const response = await fetch(`${baseUrl}/tracks/suggest?q=${"a".repeat(201)}`);

    expect(response.status).toBe(400);
    expect(gateway.suggestions).not.toHaveBeenCalled();
  });

  it("keeps recommendation personalization in the API and strips private candidates", async () => {
    const gateway = searchGateway();
    gateway.discoverArtist
      .mockResolvedValueOnce(
        artistDiscoveryResponse({ results: [result(0), result(1)] }),
      )
      .mockResolvedValueOnce(
        artistDiscoveryResponse({
          query: "Second Artist",
          results: [result(0), result(2, { id: "yt_unique" })],
        }),
      );
    const baseUrl = await startTracksServer(
      routeDependencies({
        searchGateway: gateway,
        loadTopArtists: vi.fn().mockResolvedValue(["Artist", "Second Artist"]),
      }),
    );

    const response = await fetch(`${baseUrl}/tracks/recommendations`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(gateway.discoverArtist).toHaveBeenNthCalledWith(1, {
      artist: "Artist",
      sources: ["yt", "sc"],
      limitPerSource: 6,
    });
    expect(gateway.discoverArtist).toHaveBeenNthCalledWith(2, {
      artist: "Second Artist",
      sources: ["yt", "sc"],
      limitPerSource: 6,
    });
    expect(gateway.search).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      basis: "listening_history",
      results: [
        { id: "yt_result_0" },
        { id: "yt_result_1" },
        { id: "yt_unique" },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("sourceUrl");
    expect(JSON.stringify(body)).not.toContain("providerStatus");
  });

  it("discovers from saved artists when an account has no listening history", async () => {
    const gateway = searchGateway();
    const loadLikedArtists = vi.fn().mockResolvedValue(["Favorite Artist"]);
    gateway.discoverArtist.mockResolvedValue(
      artistDiscoveryResponse({ query: "Favorite Artist", results: [result(7)] }),
    );
    const baseUrl = await startTracksServer(routeDependencies({
      searchGateway: gateway,
      loadLikedArtists,
      loadTopArtists: vi.fn().mockResolvedValue([]),
    }));

    const response = await fetch(`${baseUrl}/tracks/recommendations`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      basis: "liked_tracks",
      results: [{ id: "yt_result_7" }],
    });
    expect(loadLikedArtists).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(gateway.discoverArtist).toHaveBeenCalledWith({
      artist: "Favorite Artist",
      sources: ["yt", "sc"],
      limitPerSource: 6,
    });
  });

  it("deduplicates artist seeds and names only sources that produced results", async () => {
    const gateway = searchGateway();
    gateway.discoverArtist
      .mockResolvedValueOnce(artistDiscoveryResponse({ results: [result(0)] }))
      .mockRejectedValueOnce(new Error("saved artist unavailable"))
      .mockResolvedValueOnce(artistDiscoveryResponse({ results: [result(9)] }));
    const baseUrl = await startTracksServer(routeDependencies({
      searchGateway: gateway,
      loadLikedArtists: vi.fn().mockResolvedValue(["Artist", " artist ", "Saved"]),
      loadTopArtists: vi.fn().mockResolvedValue(["ARTIST", "History"]),
    }));

    const response = await fetch(`${baseUrl}/tracks/recommendations`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      basis: "mixed",
      results: [{ id: "yt_result_0" }, { id: "yt_result_9" }],
    });
    expect(gateway.discoverArtist.mock.calls.map(([input]) => input.artist)).toEqual([
      "Artist", "Saved", "History",
    ]);
  });

  it("isolates artist discovery failures and returns at most 20 deduped public candidates", async () => {
    const gateway = searchGateway();
    const candidates = Array.from({ length: 22 }, (_, index) =>
      result(index, {
        id: index === 21 ? "yt_result_0" : `candidate_${index}`,
      }),
    );
    gateway.discoverArtist
      .mockRejectedValueOnce(new Error("private module detail"))
      .mockResolvedValueOnce(
        artistDiscoveryResponse({
          query: "Second Artist",
          results: candidates,
        }),
      );
    const baseUrl = await startTracksServer(
      routeDependencies({
        searchGateway: gateway,
        loadTopArtists: vi.fn().mockResolvedValue(["Artist", "Second Artist"]),
      }),
    );

    const response = await fetch(`${baseUrl}/tracks/recommendations`);
    const body = (await response.json()) as {
      results: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(gateway.discoverArtist).toHaveBeenCalledTimes(2);
    expect(body.results).toHaveLength(20);
    expect(new Set(body.results.map((candidate) => candidate["id"])).size).toBe(
      20,
    );
    expect(JSON.stringify(body)).not.toContain("sourceUrl");
    expect(JSON.stringify(body)).not.toContain("providerStatus");
  });

  it("keeps the empty recommendation fallback when every artist discovery fails", async () => {
    const gateway = searchGateway();
    gateway.discoverArtist.mockRejectedValue(
      new Error("private module detail"),
    );
    const baseUrl = await startTracksServer(
      routeDependencies({
        searchGateway: gateway,
        loadTopArtists: vi.fn().mockResolvedValue(["Artist"]),
      }),
    );

    const response = await fetch(`${baseUrl}/tracks/recommendations`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ results: [], basis: "none" });
  });

  it("uses private module candidates for every Deezer playback and download fallback", async () => {
    const gateway = searchGateway();
    const sourceUrl = "https://www.youtube.com/watch?v=fallback";
    gateway.search.mockResolvedValue(
      searchResponse({
        results: [result(0, { sourceUrl })],
      }),
    );
    ytdlpMocks.getStreamUrl.mockResolvedValue({
      url: "https://media.example.test/audio",
      mimeType: "audio/mpeg",
    });
    durationProbeMock.mockResolvedValue(210);
    ytdlpMocks.spawnAudioDownload.mockImplementation(() => {
      const process = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
      };
      process.stdout = new PassThrough();
      process.stderr = new PassThrough();
      process.kill = vi.fn();
      queueMicrotask(() => {
        process.stdout.end("audio");
        process.emit("close", 0);
      });
      return process;
    });
    const baseUrl = await startTracksServer(
      routeDependencies({ searchGateway: gateway }),
    );
    const deezerUrl = "https://cdns-preview-e.dzcdn.net/stream/c-test-preview";
    const trackId = `dz_${Buffer.from(deezerUrl).toString("base64url")}`;
    const query = "artist=Artist&title=Track";

    const stream = await fetch(`${baseUrl}/tracks/${trackId}/stream?${query}&expectedDurationSeconds=205`);
    expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
    expect(streamCacheMocks.setCachedStreamUrl).not.toHaveBeenCalled();
    const download = await fetch(
      `${baseUrl}/tracks/${trackId}/download?${query}`,
    );
    const audioStream = await fetch(
      `${baseUrl}/tracks/${trackId}/audio-stream?${query}&expectedDurationSeconds=205`,
    );
    await Promise.all([download.arrayBuffer(), audioStream.arrayBuffer()]);

    expect(stream.status).toBe(200);
    expect(durationProbeMock).toHaveBeenCalledTimes(2);
    expect(durationProbeMock).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl }));
    await expect(stream.json()).resolves.toMatchObject({
      streamUrl: "https://media.example.test/audio",
    });
    expect(download.status).toBe(200);
    expect(audioStream.status).toBe(200);
    expect(gateway.search).toHaveBeenCalledTimes(3);
    expect(ytdlpMocks.getStreamUrl).toHaveBeenCalledWith(sourceUrl);
    expect(ytdlpMocks.spawnAudioDownload).toHaveBeenCalledWith(
      sourceUrl,
      "256",
    );
    expect(ytdlpMocks.spawnAudioDownload).toHaveBeenCalledWith(
      sourceUrl,
      "128",
    );
  });
});

it("skips mismatched LRCLIB search records before returning lyrics", async () => {
  const originalFetch = globalThis.fetch;
  const record = (artistName: string, duration: number, plainLyrics: string) => ({
    id: duration,
    trackName: "First song",
    artistName,
    albumName: "Album",
    duration,
    instrumental: false,
    plainLyrics,
    syncedLyrics: null,
    lyricsfile: null,
  });
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://lrclib.net/api/get?")) return Promise.resolve(new Response(null, { status: 404 }));
    if (url.startsWith("https://lrclib.net/api/search?")) return Promise.resolve(Response.json([
      record("Other artist", 180, "Wrong artist"),
      record("Artist", 30, "Wrong version"),
      record("Artist", 181, "Matching line"),
    ]));
    return originalFetch(input, init);
  });
  try {
    const baseUrl = await startTracksServer(routeDependencies());
    const response = await originalFetch(`${baseUrl}/tracks/lyrics?artist=Artist&title=First+song&duration=180`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      plainLyrics: "Matching line",
      syncedLyrics: null,
      source: "lrclib",
      match: "metadata",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("marks lyrics.ovh fallback as unverified when LRCLIB has no matching recording", async () => {
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://lrclib.net/api/get?")) return Promise.resolve(new Response(null, { status: 404 }));
    if (url.startsWith("https://lrclib.net/api/search?")) return Promise.resolve(Response.json([{
      id: 1, trackName: "Other song", artistName: "Artist", albumName: "Album", duration: 180,
      instrumental: false, plainLyrics: "Wrong song", syncedLyrics: null, lyricsfile: null,
    }]));
    if (url.startsWith("https://api.lyrics.ovh/v1/")) return Promise.resolve(Response.json({ lyrics: "Unverified line" }));
    return originalFetch(input, init);
  });
  try {
    const baseUrl = await startTracksServer(routeDependencies());
    const response = await originalFetch(`${baseUrl}/tracks/lyrics?artist=Artist&title=First+song&duration=180`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      plainLyrics: "Unverified line",
      syncedLyrics: null,
      source: "lyrics.ovh",
      match: "unverified",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("records a lyrics issue for the authenticated account without accepting client identity or lyrics text", async () => {
  const recordLyricsFeedback = vi.fn()
    .mockResolvedValueOnce("recorded")
    .mockResolvedValueOnce("already_reported");
  const baseUrl = await startTracksServer(routeDependencies({ recordLyricsFeedback }));
  const body = {
    trackId: "yt_first",
    artist: "Artist",
    title: "First song",
    durationSeconds: 180,
    lyricsSource: "lrclib",
    reason: "wrong_track",
  };

  const first = await fetch(`${baseUrl}/tracks/lyrics/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(201);
  await expect(first.json()).resolves.toEqual({ state: "recorded" });
  expect(recordLyricsFeedback).toHaveBeenCalledWith({
    accountId: ACCOUNT_ID,
    ...body,
  });

  const duplicate = await fetch(`${baseUrl}/tracks/lyrics/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(duplicate.status).toBe(200);
  await expect(duplicate.json()).resolves.toEqual({ state: "already_reported" });

  for (const extra of [
    { accountId: OTHER_ACCOUNT_ID },
    { lyrics: "private text" },
    { lyricsSource: "none" },
  ]) {
    const invalid = await fetch(`${baseUrl}/tracks/lyrics/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
    });
    expect(invalid.status).toBe(400);
  }
  expect(recordLyricsFeedback).toHaveBeenCalledTimes(2);
});

describe("server source-reference admission", () => {
  const sourceUrl = "https://www.youtube.com/watch?v=Ap0ll0Tf001";
  const id = trackIdFor("yt", sourceUrl);

  it.each(["stream", "download", "audio-stream", "queue"])(
    "stops %s admission when HTTP closes during a successful short-reference lookup",
    async (route) => {
      const gateway = searchGateway();
      let releaseReference!: (value: ReturnType<typeof sourceReference>) => void;
      const reference = new Promise<ReturnType<typeof sourceReference>>((resolve) => {
        releaseReference = resolve;
      });
      let markLookupStarted!: () => void;
      const lookupStarted = new Promise<void>((resolve) => { markLookupStarted = resolve; });
      gateway.sourceReference.mockImplementation(() => {
        markLookupStarted();
        return reference;
      });
      const dependencies = routeDependencies({ searchGateway: gateway });
      let markResponseClosed!: (response: ExpressResponse) => void;
      const responseClosed = new Promise<ExpressResponse>((resolve) => { markResponseClosed = resolve; });
      const baseUrl = await startTracksServer(dependencies, principal, (response) => {
        response.once("close", () => markResponseClosed(response));
      });
      streamCacheMocks.getCachedStreamUrl.mockResolvedValue({ url: "https://media.example.test/short", mimeType: "audio/webm" });
      ytdlpMocks.spawnAudioDownload.mockImplementation(() => {
        const process = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
        });
        queueMicrotask(() => {
          process.stdout.end("audio");
          process.stderr.end();
          process.emit("close", 0);
        });
        return process;
      });
      const queued = route === "queue";
      const request = httpRequest(
        queued ? `${baseUrl}/tracks/download/queue` : `${baseUrl}/tracks/${id}/${route}`,
        { method: queued ? "POST" : "GET", headers: { "content-type": "application/json" } },
      );
      const clientError = once(request, "error");
      const clientClosed = new Promise<void>((resolve) => { request.once("close", resolve); });
      request.end(queued ? JSON.stringify({ tracks: [queueTrack({ trackId: id })] }) : undefined);

      try {
        await lookupStarted;
        request.destroy(new Error("fixture client abort"));
        await clientError;
        await clientClosed;
        const response = await responseClosed;
        expect(response.destroyed).toBe(true);
        releaseReference(sourceReference("known", 25));
        // Flush the released admission's promise chain before inspecting its side effects.
        await new Promise<void>((resolve) => { setImmediate(resolve); });

        expect(gateway.sourceReference).toHaveBeenCalledExactlyOnceWith({ accountId: ACCOUNT_ID, sourceUrl });
        expect(durationProbeMock).not.toHaveBeenCalled();
        expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
        expect(streamCacheMocks.setCachedStreamUrl).not.toHaveBeenCalled();
        expect(ytdlpMocks.getStreamUrl).not.toHaveBeenCalled();
        expect(ytdlpMocks.spawnAudioDownload).not.toHaveBeenCalled();
        expect(dependencies.enqueueDownload).not.toHaveBeenCalled();
      } finally {
        releaseReference(sourceReference("known", 25));
        request.destroy();
        await clientClosed;
      }
    },
  );

  it.each(["stream", "download", "audio-stream"])(
    "rejects a known preview on %s when the browser omits its duration",
    async (route) => {
      const gateway = searchGateway();
      gateway.sourceReference.mockResolvedValue(sourceReference("known"));
      durationProbeMock.mockResolvedValue(30);
      streamCacheMocks.getCachedStreamUrl.mockResolvedValue({ url: "https://media.example.test/cached", mimeType: "audio/webm" });
      const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));
      const response = await fetch(`${baseUrl}/tracks/${id}/${route}`);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: "preview_rejected" });
      expect(gateway.sourceReference).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, sourceUrl });
      expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
      expect(ytdlpMocks.spawnAudioDownload).not.toHaveBeenCalled();
      expect(ytdlpMocks.getStreamUrl).not.toHaveBeenCalled();
    },
  );

  it("cannot weaken a known reference with a small client hint", async () => {
    const gateway = searchGateway();
    gateway.sourceReference.mockResolvedValue(sourceReference("known"));
    durationProbeMock.mockResolvedValue(30);
    const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));
    const response = await fetch(`${baseUrl}/tracks/${id}/stream?expectedDurationSeconds=1`);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "preview_rejected" });
  });

  it("preserves a genuinely short server recording despite a forged long hint", async () => {
    const gateway = searchGateway();
    gateway.sourceReference.mockResolvedValue(sourceReference("known", 25));
    streamCacheMocks.getCachedStreamUrl.mockResolvedValue({ url: "https://media.example.test/short", mimeType: "audio/webm" });
    const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));
    const response = await fetch(`${baseUrl}/tracks/${id}/stream?expectedDurationSeconds=300`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ cached: true });
    expect(durationProbeMock).not.toHaveBeenCalled();
  });

  it.each(["stream", "download", "audio-stream"])(
    "fails closed before %s side effects when the reference service fails",
    async (route) => {
      const gateway = searchGateway();
      gateway.sourceReference.mockRejectedValue(new Error("private upstream detail"));
      const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));
      const response = await fetch(`${baseUrl}/tracks/${id}/${route}`);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "duration_unverified" });
      expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
      expect(ytdlpMocks.spawnAudioDownload).not.toHaveBeenCalled();
      expect(ytdlpMocks.getStreamUrl).not.toHaveBeenCalled();
    },
  );

  it("does not treat a gateway without reference support as an unknown success", async () => {
    const { sourceReference: _reference, ...gateway } = searchGateway();
    const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));
    const response = await fetch(`${baseUrl}/tracks/${id}/stream`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "duration_unverified" });
    expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
  });

  it("cannot turn ambiguous server evidence into a reference through a browser hint", async () => {
    const gateway = searchGateway();
    gateway.sourceReference.mockResolvedValue(sourceReference("ambiguous"));
    streamCacheMocks.getCachedStreamUrl.mockResolvedValue({ url: "https://media.example.test/unknown", mimeType: "audio/webm" });
    const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));
    const response = await fetch(`${baseUrl}/tracks/${id}/stream?expectedDurationSeconds=300`);
    expect(response.status).toBe(200);
    expect(durationProbeMock).not.toHaveBeenCalled();
  });

  it("binds Deezer fallback to the selected media source, not the original id or browser metadata", async () => {
    const gateway = searchGateway();
    gateway.sourceReference.mockResolvedValue(sourceReference("known"));
    gateway.search.mockResolvedValue(searchResponse({ results: [result(0, { sourceUrl })] }));
    durationProbeMock.mockResolvedValue(30);
    const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));
    const deezerId = trackIdFor("dz", "https://cdns-preview-e.dzcdn.net/stream/c-reference");
    const response = await fetch(`${baseUrl}/tracks/${deezerId}/download?artist=Forged&title=Forged&expectedDurationSeconds=1`);
    expect(response.status).toBe(422);
    expect(gateway.sourceReference).toHaveBeenCalledExactlyOnceWith({ accountId: ACCOUNT_ID, sourceUrl });
    expect(ytdlpMocks.spawnAudioDownload).not.toHaveBeenCalled();
  });

  it.each([undefined, 1, 86_400])(
    "freezes server recording and duration instead of queue hint %s",
    async (expectedDurationSeconds) => {
      const gateway = searchGateway();
      gateway.sourceReference.mockResolvedValue(sourceReference("known"));
      const dependencies = routeDependencies({ searchGateway: gateway });
      const baseUrl = await startTracksServer(dependencies);
      const response = await fetch(`${baseUrl}/tracks/download/queue`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tracks: [queueTrack({ trackId: id, expectedDurationSeconds })] }),
      });
      expect(response.status).toBe(200);
      const job = dependencies.enqueueDownload.mock.calls[0]![0];
      expect(job).toMatchObject({ accountId: ACCOUNT_ID, sourceUrl, artist: "Server Artist", title: "Server Title (Live)", expectedDurationSeconds: 210 });
      expect(job).not.toHaveProperty("reference");
      expect(job).not.toHaveProperty("sourceKey");
    },
  );

  it("does not partially enqueue a batch with an unavailable reference", async () => {
    const gateway = searchGateway();
    gateway.sourceReference.mockResolvedValueOnce(sourceReference("known")).mockRejectedValueOnce(new Error("private detail"));
    const dependencies = routeDependencies({ searchGateway: gateway });
    const baseUrl = await startTracksServer(dependencies);
    const response = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks: [queueTrack({ trackId: id }), queueTrack()] }),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "duration_unverified" });
    expect(dependencies.enqueueDownload).not.toHaveBeenCalled();
  });

  it("clears an ambiguous queued hint instead of forwarding it as recording evidence", async () => {
    const gateway = searchGateway();
    gateway.sourceReference.mockResolvedValue(sourceReference("ambiguous"));
    const dependencies = routeDependencies({ searchGateway: gateway });
    const baseUrl = await startTracksServer(dependencies);
    const response = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks: [queueTrack({ trackId: id, expectedDurationSeconds: 300 })] }),
    });
    expect(response.status).toBe(200);
    expect(dependencies.enqueueDownload.mock.calls[0]![0].expectedDurationSeconds).toBeUndefined();
  });

  it("uses the authenticated account rather than a query-supplied account for lookup", async () => {
    const gateway = searchGateway();
    streamCacheMocks.getCachedStreamUrl.mockResolvedValue({ url: "https://media.example.test/source", mimeType: "audio/webm" });
    const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }), { ...principal, accountId: OTHER_ACCOUNT_ID });
    const response = await fetch(`${baseUrl}/tracks/${id}/stream?accountId=${ACCOUNT_ID}`);
    expect(response.status).toBe(200);
    expect(gateway.sourceReference).toHaveBeenCalledExactlyOnceWith({ accountId: OTHER_ACCOUNT_ID, sourceUrl });
  });

  it("carries a real signed search reference into API admission and a frozen queue command", async () => {
    // Exercise the service boundary without making API production compilation own search sources.
    const searchModuleRoot = new URL("../../../tf-search/src/", import.meta.url);
    const { createTfSearchApp } = await import(fileURLToPath(new URL("app.ts", searchModuleRoot)));
    const { createSearchService } = await import(fileURLToPath(new URL("search-service.ts", searchModuleRoot)));
    const { HmacInternalRequestAuthenticator } = await import(fileURLToPath(new URL("internal-auth.ts", searchModuleRoot)));
    const secret = "integration-fixture-secret".repeat(2);
    const service = createSearchService({
      providers: [{ source: "yt", async search() {
        return [{ ...result(0, { id, sourceUrl }), duration: 120 }];
      } }],
      async catalogLookup() {
        return [{ artist: "Artist", title: "Track 0", type: "original", duration: 210 }];
      },
    });
    const server = createTfSearchApp({
      service, auth: new HmacInternalRequestAuthenticator({ secret }), ready: () => true,
    }).listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const gateway = new HttpTfSearchClient({ origin: `http://127.0.0.1:${port}`, internalAuthSecret: secret, timeoutMs: 1000 });
    const search = await gateway.search({ accountId: ACCOUNT_ID, artist: "Artist", title: "Track 0", sources: ["yt"], mode: "manual", maxResults: 1 });
    expect(search.results.map(({ id: trackId }) => trackId)).toEqual([id]);
    const dependencies = routeDependencies({ searchGateway: gateway });
    const baseUrl = await startTracksServer(dependencies);
    durationProbeMock.mockResolvedValue(30);
    const playback = await fetch(`${baseUrl}/tracks/${id}/stream?expectedDurationSeconds=1`);
    expect(playback.status).toBe(422);
    await expect(playback.json()).resolves.toEqual({ error: "preview_rejected" });
    const queued = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks: [queueTrack({ trackId: id, expectedDurationSeconds: 1 })] }),
    });
    expect(queued.status).toBe(200);
    const job = dependencies.enqueueDownload.mock.calls[0]![0];
    expect(job).toMatchObject({
      accountId: ACCOUNT_ID, sourceUrl, expectedDurationSeconds: 210, artist: "Artist", title: "Track 0",
    });
    expect(downloadJobDataSchema.safeParse(job).success).toBe(true);
  });
});

describe("stream preview boundary", () => {
  const previewUrl = "https://cdns-preview-e.dzcdn.net/stream/c-test-preview";
  const deezerId = trackIdFor("dz", previewUrl);

  it("does not probe or resolve a Deezer fallback outside its declared provider host", async () => {
    const gateway = searchGateway();
    gateway.search.mockResolvedValue(searchResponse({
      results: [result(0, {
        source: "youtube",
        sourceUrl: "https://www.youtube.com.evil.example/watch?v=private",
      })],
    }));
    const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));

    const response = await fetch(
      `${baseUrl}/tracks/${deezerId}/stream?artist=Artist&title=Track&expectedDurationSeconds=210`,
    );

    expect(response.status).toBe(500);
    expect(durationProbeMock).not.toHaveBeenCalled();
    expect(ytdlpMocks.getStreamUrl).not.toHaveBeenCalled();
  });

  it("rejects a preview before reading an existing non-Deezer stream cache", async () => {
    const sourceUrl = "https://www.youtube.com/watch?v=preview";
    const id = trackIdFor("yt", sourceUrl);
    streamCacheMocks.getCachedStreamUrl.mockResolvedValue({
      url: "https://media.example.test/cached-preview",
      mimeType: "audio/webm",
    });
    durationProbeMock.mockResolvedValue(30);
    const baseUrl = await startTracksServer(routeDependencies());

    const response = await fetch(`${baseUrl}/tracks/${id}/stream?expectedDurationSeconds=210`);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "preview_rejected" });
    expect(durationProbeMock).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl }));
    expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
    expect(ytdlpMocks.getStreamUrl).not.toHaveBeenCalled();
  });

  it("rejects an invalid expected duration without probing or reading the cache", async () => {
    const id = trackIdFor("yt", "https://www.youtube.com/watch?v=bad-duration");
    const baseUrl = await startTracksServer(routeDependencies());

    const response = await fetch(`${baseUrl}/tracks/${id}/stream?expectedDurationSeconds=0`);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad_request" });
    expect(durationProbeMock).not.toHaveBeenCalled();
    expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
  });

  it("keeps a verified full-length cache hit and fails closed on unavailable duration", async () => {
    const sourceUrl = "https://www.youtube.com/watch?v=complete";
    const id = trackIdFor("yt", sourceUrl);
    streamCacheMocks.getCachedStreamUrl.mockResolvedValue({
      url: "https://media.example.test/full",
      mimeType: "audio/webm",
    });
    durationProbeMock.mockResolvedValueOnce(205).mockRejectedValueOnce(new Error("private provider text"));
    const baseUrl = await startTracksServer(routeDependencies());

    const full = await fetch(`${baseUrl}/tracks/${id}/stream?expectedDurationSeconds=210`);
    expect(full.status).toBe(200);
    await expect(full.json()).resolves.toMatchObject({ cached: true });
    const unknown = await fetch(`${baseUrl}/tracks/${id}/stream?expectedDurationSeconds=210`);
    expect(unknown.status).toBe(503);
    await expect(unknown.json()).resolves.toEqual({ error: "duration_unverified" });
    expect(streamCacheMocks.getCachedStreamUrl).toHaveBeenCalledTimes(1);
  });

  it("refreshes a verified non-Deezer stream without reading the cached URL", async () => {
    const sourceUrl = "https://www.youtube.com/watch?v=refreshable";
    const id = trackIdFor("yt", sourceUrl);
    streamCacheMocks.getCachedStreamUrl.mockResolvedValue({
      url: "https://media.example.test/stale",
      mimeType: "audio/webm",
    });
    durationProbeMock.mockResolvedValue(205);
    ytdlpMocks.getStreamUrl.mockResolvedValue({
      url: "https://media.example.test/fresh",
      mimeType: "audio/mpeg",
    });
    const baseUrl = await startTracksServer(routeDependencies());

    const response = await fetch(
      `${baseUrl}/tracks/${id}/stream?refresh=1&expectedDurationSeconds=210`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id,
      streamUrl: "https://media.example.test/fresh",
      mimeType: "audio/mpeg",
    });
    expect(durationProbeMock).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl }));
    expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
    expect(ytdlpMocks.getStreamUrl).toHaveBeenCalledExactlyOnceWith(sourceUrl);
    expect(streamCacheMocks.setCachedStreamUrl).toHaveBeenCalledExactlyOnceWith(
      id,
      "https://media.example.test/fresh",
      "audio/mpeg",
    );
  });

  it("rejects a known preview before refreshing a non-Deezer stream", async () => {
    const sourceUrl = "https://www.youtube.com/watch?v=short-refresh";
    const id = trackIdFor("yt", sourceUrl);
    durationProbeMock.mockResolvedValue(30);
    const baseUrl = await startTracksServer(routeDependencies());

    const response = await fetch(
      `${baseUrl}/tracks/${id}/stream?refresh=1&expectedDurationSeconds=210`,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "preview_rejected" });
    expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
    expect(ytdlpMocks.getStreamUrl).not.toHaveBeenCalled();
    expect(streamCacheMocks.setCachedStreamUrl).not.toHaveBeenCalled();
  });

  it.each(["0", "01", "true", "", "1&refresh=1"])(
    "rejects invalid refresh=%s before probing or reading the cache",
    async (refresh) => {
      const id = trackIdFor("yt", "https://www.youtube.com/watch?v=bad-refresh");
      const baseUrl = await startTracksServer(routeDependencies());

      const response = await fetch(`${baseUrl}/tracks/${id}/stream?refresh=${refresh}`);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "bad_request" });
      expect(durationProbeMock).not.toHaveBeenCalled();
      expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
      expect(ytdlpMocks.getStreamUrl).not.toHaveBeenCalled();
      expect(streamCacheMocks.setCachedStreamUrl).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["ID only", ""],
    ["artist only", "?artist=Artist"],
    ["title only", "?title=Track"],
  ])(
    "refuses legacy Deezer %s without using an opaque cache hit",
    async (_name, query) => {
      streamCacheMocks.getCachedStreamUrl.mockResolvedValue({
        url: previewUrl,
        mimeType: "audio/mpeg",
      });
      const gateway = searchGateway();
      const baseUrl = await startTracksServer(
        routeDependencies({ searchGateway: gateway }),
      );

      const response = await fetch(
        `${baseUrl}/tracks/${deezerId}/stream${query}`,
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "stream_error",
        message: "Could not resolve stream URL",
      });
      expect(gateway.search).not.toHaveBeenCalled();
      expect(ytdlpMocks.getStreamUrl).not.toHaveBeenCalled();
      expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
      expect(streamCacheMocks.setCachedStreamUrl).not.toHaveBeenCalled();
    },
  );

  it.each(["no candidate", "search rejection", "resolver rejection"])(
    "refuses preview substitution after %s",
    async (failure) => {
      const gateway = searchGateway();
      if (failure === "no candidate") {
        gateway.search.mockResolvedValue(searchResponse({ results: [] }));
      } else if (failure === "search rejection") {
        gateway.search.mockRejectedValue(new Error("search unavailable"));
      } else {
        ytdlpMocks.getStreamUrl.mockRejectedValueOnce(
          new Error("resolver unavailable"),
        );
      }
      const baseUrl = await startTracksServer(
        routeDependencies({ searchGateway: gateway }),
      );

      const response = await fetch(
        `${baseUrl}/tracks/${deezerId}/stream?artist=Artist&title=Track`,
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "stream_error",
        message: "Could not resolve stream URL",
      });
      expect(gateway.search).toHaveBeenCalledTimes(1);
      expect(gateway.search).toHaveBeenCalledWith({
        artist: "Artist",
        title: "Track",
        mode: "manual",
        sources: ["yt"],
        maxResults: 3,
      });
      expect(ytdlpMocks.getStreamUrl).toHaveBeenCalledTimes(
        failure === "resolver rejection" ? 1 : 0,
      );
      expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
      expect(streamCacheMocks.setCachedStreamUrl).not.toHaveBeenCalled();
    },
  );

  it("keeps Deezer private resolution behind tf.search even with a cache hit", async () => {
    streamCacheMocks.getCachedStreamUrl.mockResolvedValue({
      url: "https://media.example.test/previous-resolution",
      mimeType: "audio/mpeg",
    });
    const gateway = searchGateway();
    const baseUrl = await startTracksServer(
      routeDependencies({ searchGateway: gateway }),
      { ...principal, entitlements: ["tf.downloads"] },
    );

    const response = await fetch(
      `${baseUrl}/tracks/${deezerId}/stream?artist=Artist&title=Track`,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "module_access_denied",
    });
    expect(gateway.search).not.toHaveBeenCalled();
    expect(ytdlpMocks.getStreamUrl).not.toHaveBeenCalled();
    expect(streamCacheMocks.getCachedStreamUrl).not.toHaveBeenCalled();
    expect(streamCacheMocks.setCachedStreamUrl).not.toHaveBeenCalled();
  });

  it("preserves a non-Deezer cache hit without resolving again", async () => {
    const id = trackIdFor("yt", "https://www.youtube.com/watch?v=cached");
    streamCacheMocks.getCachedStreamUrl.mockResolvedValue({
      url: "https://media.example.test/cached-audio",
      mimeType: "audio/webm",
    });
    const baseUrl = await startTracksServer(routeDependencies());

    const response = await fetch(`${baseUrl}/tracks/${id}/stream`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id,
      streamUrl: "https://media.example.test/cached-audio",
      mimeType: "audio/webm",
      cached: true,
    });
    expect(streamCacheMocks.getCachedStreamUrl).toHaveBeenCalledExactlyOnceWith(
      id,
    );
    expect(streamCacheMocks.setCachedStreamUrl).not.toHaveBeenCalled();
    expect(ytdlpMocks.getStreamUrl).not.toHaveBeenCalled();
  });
});

describe("legacy binary route preview admission", () => {
  const sourceUrl = "https://www.youtube.com/watch?v=legacy-preview";
  const id = trackIdFor("yt", sourceUrl);

  it.each(["download", "audio-stream"])(
    "rejects a known short source before starting %s output",
    async (route) => {
      durationProbeMock.mockResolvedValue(30);
      const baseUrl = await startTracksServer(routeDependencies());

      const response = await fetch(
        `${baseUrl}/tracks/${id}/${route}?expectedDurationSeconds=210`,
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: "preview_rejected" });
      expect(durationProbeMock).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl }));
      expect(ytdlpMocks.spawnAudioDownload).not.toHaveBeenCalled();
    },
  );

  it.each(["download", "audio-stream"])(
    "does not start %s output when known duration cannot be checked",
    async (route) => {
      durationProbeMock.mockRejectedValue(new Error("private provider text"));
      const baseUrl = await startTracksServer(routeDependencies());

      const response = await fetch(
        `${baseUrl}/tracks/${id}/${route}?expectedDurationSeconds=210`,
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "duration_unverified" });
      expect(ytdlpMocks.spawnAudioDownload).not.toHaveBeenCalled();
    },
  );

  it("checks the Deezer fallback source rather than its preview URL", async () => {
    const previewId = trackIdFor("dz", "https://cdns-preview-e.dzcdn.net/stream/c-legacy");
    const gateway = searchGateway();
    gateway.search.mockResolvedValue(searchResponse({
      results: [result(0, { sourceUrl })],
    }));
    durationProbeMock.mockResolvedValue(30);
    const baseUrl = await startTracksServer(routeDependencies({ searchGateway: gateway }));

    const response = await fetch(
      `${baseUrl}/tracks/${previewId}/download?artist=Artist&title=Track&expectedDurationSeconds=210`,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "preview_rejected" });
    expect(durationProbeMock).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl }));
    expect(ytdlpMocks.spawnAudioDownload).not.toHaveBeenCalled();
  });

  it("rejects malformed expected duration before starting a legacy download", async () => {
    const baseUrl = await startTracksServer(routeDependencies());

    const response = await fetch(
      `${baseUrl}/tracks/${id}/download?expectedDurationSeconds=0`,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad_request" });
    expect(durationProbeMock).not.toHaveBeenCalled();
    expect(ytdlpMocks.spawnAudioDownload).not.toHaveBeenCalled();
  });
});

describe("track account ownership", () => {
  it("uses the principal account for recent, play, and recommendations", async () => {
    const dependencies = routeDependencies();
    const baseUrl = await startTracksServer(dependencies);
    const attackerHeaders = { "x-client-session": OTHER_ACCOUNT_ID };

    const recent = await fetch(
      `${baseUrl}/tracks/recent?sessionId=${OTHER_ACCOUNT_ID}&limit=12`,
      { headers: attackerHeaders },
    );
    const play = await fetch(`${baseUrl}/tracks/play`, {
      method: "POST",
      headers: {
        ...attackerHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        trackId: "played-track",
        artist: "Artist",
        title: "Title",
        sessionId: OTHER_ACCOUNT_ID,
      }),
    });
    const recommendations = await fetch(
      `${baseUrl}/tracks/recommendations?sessionId=${OTHER_ACCOUNT_ID}`,
      { headers: attackerHeaders },
    );

    expect(recent.status).toBe(200);
    expect(play.status).toBe(201);
    expect(recommendations.status).toBe(200);
    expect(dependencies.loadRecentTracks).toHaveBeenCalledWith(ACCOUNT_ID, 12);
    expect(dependencies.recordPlay).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      trackId: "played-track",
      artist: "Artist",
      title: "Title",
    });
    expect(dependencies.loadTopArtists).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(dependencies.loadLikedArtists).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(
      JSON.stringify(dependencies.loadRecentTracks.mock.calls),
    ).not.toContain(OTHER_ACCOUNT_ID);
    expect(JSON.stringify(dependencies.recordPlay.mock.calls)).not.toContain(
      OTHER_ACCOUNT_ID,
    );
    expect(
      JSON.stringify(dependencies.loadTopArtists.mock.calls),
    ).not.toContain(OTHER_ACCOUNT_ID);
    expect(
      JSON.stringify(dependencies.loadLikedArtists.mock.calls),
    ).not.toContain(OTHER_ACCOUNT_ID);
  });

  it.each([
    ["missing tracks", {}],
    ["empty tracks", { tracks: [] }],
    [
      "more than 50 tracks",
      { tracks: Array.from({ length: 51 }, () => queueTrack()) },
    ],
    ["unknown top-level field", { tracks: [queueTrack()], extra: true }],
    [
      "unknown track field",
      { tracks: [queueTrack({ installationId: OTHER_ACCOUNT_ID })] },
    ],
    [
      "track id longer than 4096",
      { tracks: [queueTrack({ trackId: "x".repeat(4097) })] },
    ],
    [
      "artist longer than 300",
      { tracks: [queueTrack({ artist: "x".repeat(301) })] },
    ],
    [
      "title longer than 500",
      { tracks: [queueTrack({ title: "x".repeat(501) })] },
    ],
  ])("rejects %s as one strict queue request", async (_label, body) => {
    const dependencies = routeDependencies();
    const baseUrl = await startTracksServer(dependencies);

    const response = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad_request" });
    expect(dependencies.enqueueDownload).not.toHaveBeenCalled();
  });

  it("rejects an invalid quality instead of normalizing it", async () => {
    const dependencies = routeDependencies();
    const baseUrl = await startTracksServer(dependencies);

    const response = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tracks: [queueTrack({ quality: "lossless" })],
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad_request" });
    expect(dependencies.enqueueDownload).not.toHaveBeenCalled();
  });

  it.each([
    "https://www.youtube.com/watch?v=caller-bypass",
    "https://private.example.test/source-canary",
  ])(
    "never accepts raw caller sourceUrl %s as a source fallback",
    async (sourceUrl) => {
      const dependencies = routeDependencies();
      const baseUrl = await startTracksServer(dependencies);

      const response = await fetch(`${baseUrl}/tracks/download/queue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tracks: [
            queueTrack({
              trackId: "opaque-caller-track",
              sourceUrl,
            }),
          ],
        }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "bad_request" });
      expect(dependencies.enqueueDownload).not.toHaveBeenCalled();
    },
  );

  it("derives the source URL only from the trusted track id", async () => {
    const dependencies = routeDependencies();
    const baseUrl = await startTracksServer(dependencies);
    const sourceUrl = "https://soundcloud.com/artist/server-derived";
    const trackId = trackIdFor("sc", sourceUrl);

    const response = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tracks: [queueTrack({ trackId, quality: "flac" })],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ trackId, jobId: "job-created", position: 1 }],
    });
    expect(dependencies.enqueueDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        trackId,
        sourceUrl,
        quality: "flac",
      }),
    );
  });

  it.each([
    [
      "credentials",
      "yt",
      "https://user:password@www.youtube.com/watch?v=private",
    ],
    [
      "a non-default port",
      "yt",
      "https://www.youtube.com:8443/watch?v=private",
    ],
    ["the default port", "yt", "https://www.youtube.com:443/watch?v=private"],
    ["a fragment", "yt", "https://www.youtube.com/watch?v=private#fragment"],
    ["non-HTTPS", "yt", "http://www.youtube.com/watch?v=private"],
    [
      "a mismatched provider host",
      "yt",
      "https://soundcloud.com/artist/private",
    ],
    ["an internal host", "sc", "https://127.0.0.1/private"],
  ] as const)(
    "rejects an encoded track URL with %s before enqueue",
    async (_label, source, sourceUrl) => {
      const dependencies = routeDependencies();
      const baseUrl = await startTracksServer(dependencies);

      const response = await fetch(`${baseUrl}/tracks/download/queue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tracks: [queueTrack({ trackId: trackIdFor(source, sourceUrl) })],
        }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "bad_request" });
      expect(dependencies.enqueueDownload).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["yt", "https://music.youtube.com/watch?v=valid-query&list=preserved"],
    ["sc", "https://api-v2.soundcloud.com/tracks/1?client_id=preserved"],
    ["bc", "https://artist.bandcamp.com/track/valid?from=preserved"],
  ] as const)(
    "accepts a strict %s provider URL and preserves its query string",
    async (source, sourceUrl) => {
      const dependencies = routeDependencies();
      const baseUrl = await startTracksServer(dependencies);
      const trackId = trackIdFor(source, sourceUrl);

      const response = await fetch(`${baseUrl}/tracks/download/queue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tracks: [queueTrack({ trackId })] }),
      });

      expect(response.status).toBe(200);
      expect(dependencies.enqueueDownload).toHaveBeenCalledWith(
        expect.objectContaining({ trackId, sourceUrl }),
      );
    },
  );

  it("accepts a strict Deezer provider URL with a query string", async () => {
    const gateway = searchGateway();
    gateway.search.mockResolvedValue(searchResponse());
    const dependencies = routeDependencies({ searchGateway: gateway });
    const baseUrl = await startTracksServer(dependencies);
    const trackId = trackIdFor(
      "dz",
      "https://api.deezer.com/track/1?utm_source=preserved",
    );

    const response = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks: [queueTrack({ trackId })] }),
    });

    expect(response.status).toBe(200);
    expect(gateway.search).toHaveBeenCalledOnce();
    expect(dependencies.enqueueDownload).toHaveBeenCalledOnce();
  });

  it("forwards a bounded expected duration to the worker and rejects invalid values", async () => {
    const dependencies = routeDependencies();
    const baseUrl = await startTracksServer(dependencies);
    const send = (expectedDurationSeconds: unknown) => fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks: [queueTrack({ expectedDurationSeconds })] }),
    });

    expect((await send(210)).status).toBe(200);
    expect(dependencies.enqueueDownload).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDurationSeconds: 210 }),
    );
    for (const invalid of [0, 86_401, 30.5, "210"]) {
      expect((await send(invalid)).status).toBe(400);
    }
    expect(dependencies.enqueueDownload).toHaveBeenCalledTimes(1);
  });

  it("resolves a Deezer download through tf-search only with live tf.search access", async () => {
    const gateway = searchGateway();
    const resolvedSourceUrl =
      "https://www.youtube.com/watch?v=deezer-server-fallback";
    gateway.search.mockResolvedValue(
      searchResponse({
        results: [
          result(0, {
            source: "youtube",
            sourceUrl: resolvedSourceUrl,
          }),
        ],
        sources: ["yt", "sc"],
      }),
    );
    const dependencies = routeDependencies({ searchGateway: gateway });
    const baseUrl = await startTracksServer(dependencies);
    const trackId = trackIdFor(
      "dz",
      "https://cdns-preview-e.dzcdn.net/stream/c-test",
    );

    const response = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tracks: [
          queueTrack({ trackId, artist: "DZ Artist", title: "DZ Title" }),
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(gateway.search).toHaveBeenCalledWith({
      artist: "DZ Artist",
      title: "DZ Title",
      mode: "manual",
      sources: ["yt", "sc"],
      maxResults: 6,
    });
    expect(dependencies.enqueueDownload).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: resolvedSourceUrl }),
    );
  });

  it.each([
    [
      "credentials",
      "youtube",
      "https://user:password@www.youtube.com/watch?v=private",
    ],
    ["a port", "youtube", "https://www.youtube.com:8443/watch?v=private"],
    [
      "a fragment",
      "youtube",
      "https://www.youtube.com/watch?v=private#fragment",
    ],
    ["non-HTTPS", "youtube", "http://www.youtube.com/watch?v=private"],
    [
      "a mismatched provider host",
      "youtube",
      "https://soundcloud.com/artist/private",
    ],
    ["an internal host", "soundcloud", "https://127.0.0.1/private"],
  ] as const)(
    "rejects a Deezer fallback with %s before enqueue",
    async (_label, source, sourceUrl) => {
      const gateway = searchGateway();
      gateway.search.mockResolvedValue(
        searchResponse({
          results: [result(0, { source, sourceUrl })],
          sources: ["yt", "sc"],
        }),
      );
      const dependencies = routeDependencies({ searchGateway: gateway });
      const baseUrl = await startTracksServer(dependencies);
      const trackId = trackIdFor(
        "dz",
        "https://cdns-preview-e.dzcdn.net/stream/c-test",
      );

      const response = await fetch(`${baseUrl}/tracks/download/queue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tracks: [queueTrack({ trackId })] }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "bad_request" });
      expect(dependencies.enqueueDownload).not.toHaveBeenCalled();
    },
  );

  it("does not ask tf-search for a Deezer fallback without tf.search access", async () => {
    const gateway = searchGateway();
    const dependencies = routeDependencies({ searchGateway: gateway });
    const baseUrl = await startTracksServer(dependencies, {
      ...principal,
      entitlements: ["tf.downloads"],
    });
    const trackId = trackIdFor(
      "dz",
      "https://cdns-preview-e.dzcdn.net/stream/c-test",
    );

    const response = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks: [queueTrack({ trackId })] }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "module_access_denied",
    });
    expect(gateway.search).not.toHaveBeenCalled();
    expect(dependencies.enqueueDownload).not.toHaveBeenCalled();
  });

  it.each([
    ["capacity", new DownloadQueueCapacityError()],
    ["Redis", new DownloadQueueUnavailableError()],
    ["internal", new Error("private-queue-error-canary")],
  ])("sanitizes %s queue failures as the same 503", async (_label, error) => {
    const dependencies = routeDependencies({
      enqueueDownload: vi.fn().mockRejectedValue(error),
    });
    const baseUrl = await startTracksServer(dependencies);

    const response = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks: [queueTrack()] }),
    });
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"error":"download_queue_unavailable"}');
    expect(body).not.toContain("private-queue-error-canary");
  });

  it("returns the accepted job when two tracks race for the last queue slot", async () => {
    const accepted = queueTrack({
      trackId: trackIdFor(
        "yt",
        "https://www.youtube.com/watch?v=accepted-at-200",
      ),
    });
    const rejected = queueTrack({
      trackId: trackIdFor(
        "yt",
        "https://www.youtube.com/watch?v=rejected-at-201",
      ),
    });
    const enqueue = vi
      .fn()
      .mockResolvedValueOnce({ jobId: "job-at-position-200", position: 200 })
      .mockRejectedValueOnce(new DownloadQueueCapacityError());
    const baseUrl = await startTracksServer(
      routeDependencies({ enqueueDownload: enqueue }),
    );

    const response = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks: [accepted, rejected] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        {
          trackId: accepted.trackId,
          jobId: "job-at-position-200",
          position: 200,
        },
        {
          trackId: rejected.trackId,
          error: "download_queue_unavailable",
        },
      ],
    });
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it("keeps mixed results in request order without leaking queue errors", async () => {
    const canary = "private-mixed-queue-canary";
    const failed = queueTrack({
      trackId: trackIdFor("yt", "https://www.youtube.com/watch?v=failed-first"),
    });
    const accepted = queueTrack({
      trackId: trackIdFor(
        "yt",
        "https://www.youtube.com/watch?v=accepted-second",
      ),
    });
    let rejectFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      rejectFirst = resolve;
    });
    const enqueue = vi.fn(async (input: { readonly trackId: string }) => {
      if (input.trackId === failed.trackId) {
        await firstGate;
        throw new Error(canary);
      }
      return { jobId: "job-completed-first", position: 17 };
    });
    const baseUrl = await startTracksServer(
      routeDependencies({ enqueueDownload: enqueue }),
    );

    const responsePromise = fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks: [failed, accepted] }),
    });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
    rejectFirst();
    const response = await responsePromise;
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      results: [
        {
          trackId: failed.trackId,
          error: "download_queue_unavailable",
        },
        {
          trackId: accepted.trackId,
          jobId: "job-completed-first",
          position: 17,
        },
      ],
    });
    expect(body).not.toContain(canary);
  });

  it("binds every download operation to the principal account", async () => {
    const dependencies = routeDependencies();
    const baseUrl = await startTracksServer(dependencies);
    const sourceUrl = "https://www.youtube.com/watch?v=account-bound";
    const trackId = trackIdFor("yt", sourceUrl);
    const attackerHeaders = { "x-client-session": OTHER_ACCOUNT_ID };

    const queued = await fetch(`${baseUrl}/tracks/download/queue`, {
      method: "POST",
      headers: {
        ...attackerHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tracks: [
          {
            trackId,
            artist: "Artist",
            title: "Title",
            quality: "192",
          },
        ],
      }),
    });
    const jobs = await fetch(
      `${baseUrl}/tracks/download/jobs?sessionId=${OTHER_ACCOUNT_ID}`,
      { headers: attackerHeaders },
    );
    const status = await fetch(
      `${baseUrl}/tracks/download/status/${JOB_ID}?sessionId=${OTHER_ACCOUNT_ID}`,
      { headers: attackerHeaders },
    );
    const file = await fetch(
      `${baseUrl}/tracks/download/file/${JOB_ID}?sessionId=${OTHER_ACCOUNT_ID}`,
      { headers: attackerHeaders },
    );
    const canceled = await fetch(
      `${baseUrl}/tracks/download/jobs/${JOB_ID}?sessionId=${OTHER_ACCOUNT_ID}`,
      { method: "DELETE", headers: attackerHeaders },
    );

    expect(queued.status).toBe(200);
    expect(jobs.status).toBe(200);
    expect(status.status).toBe(200);
    expect(file.status).toBe(404);
    expect(canceled.status).toBe(200);
    expect(dependencies.enqueueDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        accountId: ACCOUNT_ID,
        trackId,
        artist: "Artist",
        title: "Title",
        quality: "192",
        sourceUrl,
        createdAt: expect.any(String),
      }),
    );
    expect(dependencies.listDownloadJobs).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(dependencies.getDownloadJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      ACCOUNT_ID,
    );
    expect(dependencies.cancelDownloadJob).toHaveBeenCalledWith(
      JOB_ID,
      ACCOUNT_ID,
    );
    expect(dependencies.downloadWorkerGateway.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        jobId: JOB_ID,
      }),
    );
    for (const spy of [
      dependencies.enqueueDownload,
      dependencies.listDownloadJobs,
      dependencies.getDownloadJobStatus,
      dependencies.cancelDownloadJob,
      dependencies.downloadWorkerGateway.openFile,
    ]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(OTHER_ACCOUNT_ID);
    }
  });

  it("hides unknown or foreign jobs and makes canceled responses idempotent", async () => {
    const unknown = routeDependencies({
      listDownloadJobs: vi.fn().mockResolvedValue([]),
      getDownloadJobStatus: vi.fn().mockResolvedValue({
        status: "unknown",
        progress: 0,
      }),
      cancelDownloadJob: vi.fn().mockResolvedValue({ status: "unknown" }),
    });
    const unknownUrl = await startTracksServer(unknown);

    const [jobs, status, file, canceled] = await Promise.all([
      fetch(`${unknownUrl}/tracks/download/jobs`),
      fetch(`${unknownUrl}/tracks/download/status/${JOB_ID}`),
      fetch(`${unknownUrl}/tracks/download/file/${JOB_ID}`),
      fetch(`${unknownUrl}/tracks/download/jobs/${JOB_ID}`, {
        method: "DELETE",
      }),
    ]);

    expect(jobs.status).toBe(200);
    await expect(jobs.json()).resolves.toEqual({ jobs: [] });
    expect([status.status, file.status, canceled.status]).toEqual([
      404, 404, 404,
    ]);

    const alreadyCanceled = routeDependencies({
      cancelDownloadJob: vi.fn().mockResolvedValue({ status: "canceled" }),
    });
    const canceledUrl = await startTracksServer(alreadyCanceled);
    const [first, second] = await Promise.all([
      fetch(`${canceledUrl}/tracks/download/jobs/${JOB_ID}`, {
        method: "DELETE",
      }),
      fetch(`${canceledUrl}/tracks/download/jobs/${JOB_ID}`, {
        method: "DELETE",
      }),
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);
    await expect(first.json()).resolves.toEqual({
      jobId: JOB_ID,
      status: "canceled",
    });
    await expect(second.json()).resolves.toEqual({
      jobId: JOB_ID,
      status: "canceled",
    });
  });

  it.each(["waiting", "active"] as const)(
    "preserves the committed %s cancellation state and exact job id",
    async (state) => {
      const dependencies = routeDependencies({
        cancelDownloadJob: vi.fn().mockResolvedValue({ status: state }),
      });
      const baseUrl = await startTracksServer(dependencies);

      const response = await fetch(
        `${baseUrl}/tracks/download/jobs/${JOB_ID}`,
        { method: "DELETE" },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        jobId: JOB_ID,
        status: state,
      });
    },
  );

  it("sanitizes list, status, and cancel backend failures as 503", async () => {
    const canary = "private-redis-operation-canary";
    const cases = [
      {
        path: "/tracks/download/jobs",
        method: "GET",
        dependencies: routeDependencies({
          listDownloadJobs: vi.fn().mockRejectedValue(new Error(canary)),
        }),
      },
      {
        path: `/tracks/download/status/${JOB_ID}`,
        method: "GET",
        dependencies: routeDependencies({
          getDownloadJobStatus: vi.fn().mockRejectedValue(new Error(canary)),
        }),
      },
      {
        path: `/tracks/download/jobs/${JOB_ID}`,
        method: "DELETE",
        dependencies: routeDependencies({
          cancelDownloadJob: vi.fn().mockRejectedValue(new Error(canary)),
        }),
      },
    ];

    for (const current of cases) {
      const baseUrl = await startTracksServer(current.dependencies);
      const response = await fetch(`${baseUrl}${current.path}`, {
        method: current.method,
      });
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(body).toBe('{"error":"download_queue_unavailable"}');
      expect(body).not.toContain(canary);
    }
  });
});

describe("download worker file proxy", () => {
  it("binds the worker command to the principal and forwards one range as a stream", async () => {
    const worker = downloadWorkerGateway();
    worker.openFile.mockResolvedValue({
      status: 206,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from("udi"));
          controller.close();
        },
      }),
      contentLength: 3,
      contentType: "audio/mpeg",
      contentDisposition:
        "attachment; filename=\"Artist - Title.mp3\"; filename*=UTF-8''Artist%20-%20Title.mp3",
      contentRange: "bytes 1-3/5",
    });
    const dependencies = routeDependencies({
      downloadWorkerGateway: worker,
    });
    const baseUrl = await startTracksServer(dependencies);

    const response = await fetch(
      `${baseUrl}/tracks/download/file/30000000-0000-4000-8000-000000000003`,
      {
        headers: {
          range: "bytes=1-3",
          "x-client-session": OTHER_ACCOUNT_ID,
        },
      },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.text()).resolves.toBe("udi");
    expect(worker.openFile).toHaveBeenCalledTimes(1);
    expect(worker.openFile).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      jobId: "30000000-0000-4000-8000-000000000003",
      range: { start: 1, end: 3 },
      signal: expect.any(AbortSignal),
    });
    expect(JSON.stringify(worker.openFile.mock.calls)).not.toContain(
      OTHER_ACCOUNT_ID,
    );
  });

  it.each([
    "bytes=3-1",
    "bytes=-3",
    "bytes=1-2,4-5",
    "items=1-2",
    "bytes=1073741824-",
  ])(
    "rejects invalid or multiple public range %s before dispatch",
    async (range) => {
      const worker = downloadWorkerGateway();
      const baseUrl = await startTracksServer(
        routeDependencies({ downloadWorkerGateway: worker }),
      );

      const response = await fetch(
        `${baseUrl}/tracks/download/file/30000000-0000-4000-8000-000000000003`,
        { headers: { range } },
      );

      expect(response.status).toBe(416);
      await expect(response.json()).resolves.toEqual({
        error: "range_not_satisfiable",
      });
      expect(worker.openFile).not.toHaveBeenCalled();
    },
  );

  it.each([404, 409, 416, 503] as const)(
    "maps intended worker status %s without downstream details",
    async (status) => {
      const worker = downloadWorkerGateway();
      worker.openFile.mockRejectedValue(new TfDownloadWorkerError(status));
      const baseUrl = await startTracksServer(
        routeDependencies({ downloadWorkerGateway: worker }),
      );

      const response = await fetch(
        `${baseUrl}/tracks/download/file/30000000-0000-4000-8000-000000000003`,
      );
      const body = await response.json();

      expect(response.status).toBe(status);
      expect(body).toEqual({
        error:
          status === 404
            ? "file_not_found"
            : status === 409
              ? "file_not_ready"
              : status === 416
                ? "range_not_satisfiable"
                : "worker_unavailable",
      });
      expect(JSON.stringify(body)).not.toContain("downstream");
    },
  );

  it("aborts the worker stream when the browser disconnects", async () => {
    const worker = downloadWorkerGateway();
    let workerSignal: AbortSignal | undefined;
    const canceled = vi.fn();
    worker.openFile.mockImplementation(async (input) => {
      workerSignal = input.signal;
      return {
        status: 200 as const,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from("a"));
          },
          cancel: canceled,
        }),
        contentLength: 5,
        contentType: "audio/mpeg" as const,
        contentDisposition:
          "attachment; filename=\"file.mp3\"; filename*=UTF-8''file.mp3",
      };
    });
    const baseUrl = await startTracksServer(
      routeDependencies({ downloadWorkerGateway: worker }),
    );
    const browser = new AbortController();
    const response = await fetch(
      `${baseUrl}/tracks/download/file/30000000-0000-4000-8000-000000000003`,
      { signal: browser.signal },
    );
    const reader = response.body!.getReader();
    await reader.read();

    browser.abort();

    await vi.waitFor(() => expect(workerSignal?.aborted).toBe(true));
    await vi.waitFor(() => expect(canceled).toHaveBeenCalled());
  });
});
