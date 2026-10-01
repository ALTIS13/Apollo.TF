import { describe, expect, it } from "vitest";
import type { TfSearchCommand } from "@workspace/tf-search-contract";
import {
  canonicalSourceKey,
  type TfSourceReferenceCommand,
} from "@workspace/tf-search-contract/source-reference";
import { createSearchService, type InternalTrack, type SearchProvider } from "./search-service.js";
import type { RecordingDurationReference } from "./recording-reference.js";

const requestId = "10000000-0000-4000-8000-000000000001";
const sourceUrl = "https://www.youtube.com/watch?v=BaW_jenozKc";
const fullUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const command: TfSearchCommand = {
  schemaVersion: 1, requestId, accountId: requestId,
  artist: "Artist", title: "Track", mode: "manual", sources: ["yt"], maxResults: 4,
};
const lookup: TfSourceReferenceCommand = { schemaVersion: 1, requestId, accountId: requestId, sourceUrl };
const catalog: RecordingDurationReference = { artist: "Artist", title: "Track", type: "original", duration: 210 };

function candidate(overrides: Partial<InternalTrack> = {}): InternalTrack {
  return {
    id: "yt_excerpt", artist: "Artist", title: "Track", type: "original", duration: 30,
    source: "youtube", sourceUrl, thumbnailUrl: null, quality: ["128"], viewCount: 1, score: 0,
    ...overrides,
  };
}

describe("search-owned source references", () => {
  it.each(["exact", "free", "discovery"] as const)(
    "retains catalog comparison for rejected media from %s search without lookup fan-out",
    async (mode) => {
      let providerCalls = 0;
      let catalogCalls = 0;
      const service = createSearchService({
        now: () => 1_000,
        providers: [{ source: "yt", async search() { providerCalls += 1; return [candidate()]; } }],
        async catalogLookup() { catalogCalls += 1; return [catalog]; },
      });
      const response = mode === "exact" ? await service.search(command)
        : mode === "free" ? await service.freeSearch({
          schemaVersion: 1, requestId, accountId: requestId, query: "Artist Track", mode: "manual", sources: ["yt"], maxResults: 4,
        }) : await service.discoverArtist({ schemaVersion: 1, requestId, artist: "Artist", sources: ["yt"], limitPerSource: 4 });
      expect(response.results).toEqual([]);
      const reference = await service.sourceReference?.({ ...lookup, sourceUrl: "https://youtu.be/BaW_jenozKc?si=tracking" });
      expect(reference).toEqual({
        schemaVersion: 1, requestId, sourceKey: canonicalSourceKey(sourceUrl), status: "known",
        reference: { artist: "Artist", title: "Track", type: "original", expectedDurationSeconds: 210,
          provenance: "catalog", observedAt: 1_000, expiresAt: 301_000 },
      });
      expect([providerCalls, catalogCalls]).toEqual([1, 1]);
    },
  );

  it.each(["preview_catalog", "peer"] as const)("exposes the existing %s comparison without duplicating admission logic", async (provenance) => {
    const full = provenance === "peer" ? candidate({ id: "yt_full", sourceUrl: fullUrl, duration: 210 })
      : candidate({ id: "dz_preview", source: "deezer", sourceUrl: "https://cdns-preview-a.dzcdn.net/stream/preview.mp3", duration: 210 });
    const service = createSearchService({ now: () => 1_000,
      providers: [{ source: "yt", async search() { return [candidate(), full]; } }],
    });
    await service.search(command);
    expect(await service.sourceReference?.(lookup)).toMatchObject({ status: "known", reference: { provenance, expectedDurationSeconds: 210 } });
  });

  it("retains trusted short/version metadata rather than uploader presentation", async () => {
    const service = createSearchService({ now: () => 1_000,
      providers: [{ source: "yt", async search() {
        return [candidate({ artist: "Artist - Topic", title: "Artist - Track - Clean (Official Audio)", duration: 25 })];
      } }],
      async catalogLookup() { return [{ ...catalog, title: "Track (Clean)", duration: 25 }]; },
    });
    await service.search(command);
    expect(await service.sourceReference?.(lookup)).toMatchObject({ status: "known", reference: {
      artist: "Artist", title: "Track (Clean)", type: "original", expectedDurationSeconds: 25, provenance: "catalog",
    } });
  });

  it("does not let a later unknown recording observation erase a known preview reference or refresh its TTL", async () => {
    let now = 1_000;
    let observed = candidate();
    let references = [catalog];
    const service = createSearchService({ now: () => now,
      providers: [{ source: "yt", async search() { return [observed]; } }],
      async catalogLookup() { return references; },
    });
    await service.search(command);
    now = 2_000;
    references = [];
    observed = candidate({ title: "Track (Clean)" });
    await service.search(command);
    expect(await service.sourceReference?.(lookup)).toMatchObject({ status: "known", reference: {
      expectedDurationSeconds: 210, observedAt: 1_000, expiresAt: 301_000,
    } });
  });

  it("reports ambiguous catalog evidence even with a matching full media peer", async () => {
    const service = createSearchService({ now: () => 1_000,
      providers: [{ source: "yt", async search() { return [candidate(), candidate({ id: "full", sourceUrl: fullUrl, duration: 210 })]; } }],
      async catalogLookup() { return [{ ...catalog, duration: 25 }, catalog]; },
    });
    await service.search(command);
    expect(await service.sourceReference?.(lookup)).toEqual({ schemaVersion: 1, requestId, sourceKey: canonicalSourceKey(sourceUrl), status: "ambiguous" });
  });

  it("keeps an unrelated short recording unknown rather than borrowing catalog evidence", async () => {
    const service = createSearchService({ providers: [{ source: "yt", async search() { return [candidate({ title: "Interlude" })]; } }],
      async catalogLookup() { return [catalog]; },
    });
    await service.search(command);
    expect(await service.sourceReference?.(lookup)).toMatchObject({ status: "unknown" });
  });

  it("does not reissue expired private evidence from a longer-lived public search cache", async () => {
    let now = 1_000;
    let providerCalls = 0;
    const providers: SearchProvider[] = (["yt", "sc", "bc", "dz"] as const).map((source) => ({ source,
      async search() { providerCalls += 1; return source === "yt" ? [candidate({ duration: 210 })] : []; },
    }));
    const service = createSearchService({ providers, now: () => now });
    const cacheable = { ...command, mode: "auto" as const, sources: ["yt", "sc", "bc", "dz"] as const };
    await service.search({ ...cacheable, sources: [...cacheable.sources] });
    now = 301_000;
    expect((await service.search({ ...cacheable, sources: [...cacheable.sources] })).cached).toBe(true);
    expect(await service.sourceReference?.(lookup)).toMatchObject({ status: "unknown" });
    expect(providerCalls).toBe(4);
  });
});
