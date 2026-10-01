import { describe, expect, it } from "vitest";
import { tfSearchResponseSchema, type TfSearchCommand } from "@workspace/tf-search-contract";
import { createSearchService, type InternalTrack } from "./search-service.js";
import { BoundedSearchCache } from "./cache.js";

const command: TfSearchCommand = {
  schemaVersion: 1,
  requestId: "10000000-0000-4000-8000-000000000001",
  artist: "Artist",
  title: "Track",
  mode: "auto",
  sources: ["yt"],
  maxResults: 8,
};

function candidate(overrides: Partial<InternalTrack> = {}): InternalTrack {
  return {
    id: "yt_excerpt",
    artist: "Artist",
    title: "Track",
    type: "original",
    duration: 30,
    source: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=excerpt",
    thumbnailUrl: null,
    quality: ["128"],
    viewCount: 0,
    score: 0,
    ...overrides,
  };
}

const catalogReference = { artist: "Artist", title: "Track", type: "original" as const, duration: 210 };

describe("catalog duration search integration", () => {
  it("rejects an isolated excerpt using parallel catalog metadata even with only YouTube selected", async () => {
    let release!: () => void;
    const mediaReady = new Promise<void>((resolve) => { release = resolve; });
    const lookups: Array<[string, number]> = [];
    const service = createSearchService({
      providers: [{ source: "yt", async search() { await mediaReady; return [candidate()]; } }],
      async catalogLookup(query, limit) { lookups.push([query, limit]); return [catalogReference]; },
    });

    const pending = service.search(command);
    expect(lookups).toEqual([["Artist Track", 4]]);
    release();
    const response = await pending;
    expect(response.results).toEqual([]);
    expect(response.sources).toEqual(["yt"]);
    expect(response.providerStatus).toEqual({ yt: "ok", sc: "skipped", bc: "skipped", dz: "skipped" });
    expect(tfSearchResponseSchema.safeParse(response).success).toBe(true);
    expect(service.parserTelemetry().find(({ source }) => source === "yt")?.previewsRejectedPerMinute).toBe(1);
  });

  it("uses the original free/discovery query once, without per-candidate metadata fan-out", async () => {
    const lookups: Array<[string, number]> = [];
    const service = createSearchService({
      providers: [{ source: "yt", async search() {
        return [candidate(), candidate({ id: "yt_interlude", title: "Interlude", duration: 25 })];
      } }],
      async catalogLookup(query, limit) { lookups.push([query, limit]); return [catalogReference]; },
    });
    const free = await service.freeSearch({
      schemaVersion: 1, requestId: command.requestId, query: "Artist favorites",
      sources: ["yt"], maxResults: 8, mode: "manual",
    });
    const discovery = await service.discoverArtist({
      schemaVersion: 1, requestId: command.requestId, artist: "Artist", sources: ["yt"], limitPerSource: 6,
    });
    expect(lookups).toEqual([["Artist favorites", 4], ["Artist", 6]]);
    expect(free.results.map(({ id }) => id)).toEqual(["yt_interlude"]);
    expect(discovery.results.map(({ id }) => id)).toEqual(["yt_interlude"]);
  });

  it("retries a failed catalog lookup instead of caching an unverified short candidate as a success", async () => {
    let attempts = 0;
    const warnings: unknown[] = [];
    const service = createSearchService({
      providers: [
        { source: "yt", async search() { return [candidate()]; } },
        ...(["sc", "bc", "dz"] as const).map((source) => ({ source, async search() { return []; } })),
      ],
      async catalogLookup() {
        attempts += 1;
        if (attempts === 1) throw new Error("catalog outage");
        return [catalogReference];
      },
      logger: { warn(event) { warnings.push(event); } },
    });
    const allSources = { ...command, sources: ["yt", "sc", "bc", "dz"] as TfSearchCommand["sources"] };
    const unknown = await service.search(allSources);
    expect(service.telemetry().status).toBe("warning");
    const verified = await service.search(allSources);
    const cached = await service.search(allSources);
    expect(unknown.results.map(({ id }) => id)).toEqual(["yt_excerpt"]);
    expect(verified.cached).toBe(false);
    expect(verified.results).toEqual([]);
    expect(cached.cached).toBe(true);
    expect(attempts).toBe(2);
    expect(warnings).toEqual([{ source: "dz", errorClass: "catalog_reference_failure" }]);
  });

  it("caps catalog-backed search snapshots at five minutes instead of the legacy hourly TTL", async () => {
    let now = 0;
    let duration = 25;
    let attempts = 0;
    const service = createSearchService({
      now: () => now,
      cache: new BoundedSearchCache({ now: () => now }),
      providers: [
        { source: "yt", async search() { return [candidate()]; } },
        ...(["sc", "bc", "dz"] as const).map((source) => ({ source, async search() { return []; } })),
      ],
      async catalogLookup() { attempts += 1; return [{ ...catalogReference, duration }]; },
    });
    const allSources = { ...command, sources: ["yt", "sc", "bc", "dz"] as TfSearchCommand["sources"] };
    expect((await service.search(allSources)).results).toHaveLength(1);
    now = 299_999;
    expect((await service.search(allSources)).cached).toBe(true);
    now = 300_000;
    duration = 210;
    const refreshed = await service.search(allSources);
    expect(refreshed.cached).toBe(false);
    expect(refreshed.results).toEqual([]);
    expect(attempts).toBe(2);
  });
});
