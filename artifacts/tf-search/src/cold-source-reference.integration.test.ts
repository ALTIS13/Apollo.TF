import { afterEach, describe, expect, it, vi } from "vitest";
import type { TfSourceReferenceCommand } from "@workspace/tf-search-contract/source-reference";
import { createSearchService, type InternalTrack } from "./search-service.js";

const sourceUrl = "https://www.youtube.com/watch?v=BaW_jenozKc";
const requestId = "10000000-0000-4000-8000-000000000001";
const lookup: TfSourceReferenceCommand = { schemaVersion: 1, requestId, accountId: requestId, sourceUrl };
const catalog = { artist: "Artist", title: "Track", type: "original" as const, duration: 210 };
function observation(overrides: Partial<InternalTrack> = {}): InternalTrack {
  return { id: "yt_observation", artist: "Artist - Topic", title: "Artist - Track (Official Audio)",
    type: "original", duration: 30, source: "youtube", sourceUrl,
    thumbnailUrl: null, quality: ["unknown"], viewCount: null, score: 0, ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

describe("cold source-reference revalidation", () => {
  it("recovers a saved source without search, requests fresh catalog evidence and retains warm expiry", async () => {
    let now = 1_000;
    let inspections = 0;
    let catalogDuration = 210;
    const service = createSearchService({ providers: [], now: () => now,
      async sourceMetadataLookup(url) { expect(url).toBe(sourceUrl); inspections += 1; return observation(); },
      async catalogLookup(query, limit, options) {
        expect(query).toBe("artist track");
        expect(limit).toBe(25);
        if (!options?.fresh || options.signal?.aborted) return [];
        return [{ ...catalog, duration: catalogDuration }];
      },
    });
    expect(await service.sourceReference(lookup)).toEqual({ schemaVersion: 1, requestId,
      sourceKey: "youtube:BaW_jenozKc", status: "known", reference: {
        artist: "Artist", title: "Track", type: "original", expectedDurationSeconds: 210,
        provenance: "catalog", observedAt: 1_000, expiresAt: 301_000,
      } });
    now = 2_000;
    expect(await service.sourceReference(lookup)).toMatchObject({ status: "known", reference: { observedAt: 1_000, expiresAt: 301_000 } });
    expect(inspections).toBe(1);
    now = 301_000;
    catalogDuration = 211;
    expect(await service.sourceReference(lookup)).toMatchObject({ status: "known", reference: {
      expectedDurationSeconds: 211, observedAt: 301_000, expiresAt: 601_000,
    } });
    expect(inspections).toBe(2);
  });

  it("coalesces canonical aliases but returns each caller's own correlation", async () => {
    const selected = deferred<InternalTrack>();
    let inspections = 0;
    const service = createSearchService({ providers: [], now: () => 1_000,
      sourceMetadataLookup() { inspections += 1; return selected.promise; },
      async catalogLookup() { return [catalog]; },
    });
    const first = service.sourceReference(lookup);
    const secondId = "20000000-0000-4000-8000-000000000002";
    const second = service.sourceReference({ ...lookup, requestId: secondId, accountId: secondId, sourceUrl: "https://youtu.be/BaW_jenozKc?si=tracking" });
    selected.resolve(observation());
    expect(await first).toMatchObject({ requestId, status: "known", reference: { expectedDurationSeconds: 210 } });
    expect(await second).toMatchObject({ requestId: secondId, sourceKey: "youtube:BaW_jenozKc", status: "known" });
    expect(inspections).toBe(1);
  });

  it("never promotes a lone source's own duration when no catalog recording matches", async () => {
    let now = 1_000;
    let inspections = 0;
    const service = createSearchService({ providers: [], now: () => now,
      async sourceMetadataLookup() { inspections += 1; return observation({ duration: 210 }); },
      async catalogLookup() { return [{ ...catalog, title: "Unrelated" }]; },
    });
    expect(await service.sourceReference(lookup)).toEqual({ schemaVersion: 1, requestId, sourceKey: "youtube:BaW_jenozKc", status: "unknown" });
    now = 15_999;
    expect(await service.sourceReference(lookup)).toMatchObject({ status: "unknown" });
    expect(inspections).toBe(1);
    now = 16_000;
    expect(await service.sourceReference(lookup)).toMatchObject({ status: "unknown" });
    expect(inspections).toBe(2);
  });

  it("preserves catalog ambiguity instead of accepting its own full-duration peer", async () => {
    const service = createSearchService({ providers: [], now: () => 1_000,
      async sourceMetadataLookup() { return observation({ duration: 210 }); },
      async catalogLookup() { return [catalog, { ...catalog, duration: 25 }]; },
    });
    expect(await service.sourceReference(lookup)).toEqual({ schemaVersion: 1, requestId, sourceKey: "youtube:BaW_jenozKc", status: "ambiguous" });
  });

  it("retains an explicit clean version and legitimate short recording", async () => {
    const service = createSearchService({ providers: [], now: () => 1_000,
      async sourceMetadataLookup() { return observation({ title: "Artist - Track (Clean)", duration: 25 }); },
      async catalogLookup() { return [catalog, { ...catalog, title: "Track (Clean)", duration: 25 }]; },
    });
    expect(await service.sourceReference(lookup)).toMatchObject({ status: "known", reference: {
      title: "Track (Clean)", expectedDurationSeconds: 25, provenance: "catalog",
    } });
  });

  it("does not admit an explicitly marked demo source as an unknown ordinary recording", async () => {
    const service = createSearchService({ providers: [],
      async sourceMetadataLookup() { return observation({ title: "Track (Demo)" }); },
      async catalogLookup() { return []; },
    });
    await expect(service.sourceReference(lookup)).rejects.toThrow("Source reference unavailable");
  });

  it.each(["metadata", "catalog"] as const)("fails closed on %s errors, sanitizes them and permits a later retry", async (failure) => {
    let now = 1_000;
    let failed = true;
    let attempts = 0;
    const service = createSearchService({ providers: [], now: () => now,
      async sourceMetadataLookup() {
        attempts += 1;
        if (failed && failure === "metadata") throw new Error("private provider URL and credentials");
        return observation();
      },
      async catalogLookup() {
        if (failed && failure === "catalog") throw new Error("private catalog transport");
        return [catalog];
      },
    });
    await expect(service.sourceReference(lookup)).rejects.toThrow("Source reference unavailable");
    failed = false;
    now = 2_999;
    await expect(service.sourceReference(lookup)).rejects.toThrow("Source reference unavailable");
    expect(attempts).toBe(1);
    now = 3_000;
    expect(await service.sourceReference(lookup)).toMatchObject({ status: "known" });
    expect(attempts).toBe(2);
  });

  it.each([
    { sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { source: "soundcloud" as const },
    { duration: Number.NaN },
    { artist: "A".repeat(301) },
  ])("rejects malformed or cross-source observations before catalog authority (%j)", async (bad) => {
    const service = createSearchService({ providers: [], async sourceMetadataLookup() { return observation(bad); },
      async catalogLookup() { throw new Error("catalog must not be reached"); },
    });
    await expect(service.sourceReference(lookup)).rejects.toThrow("Source reference unavailable");
  });

  it("bounds active distinct sources while allowing a duplicate to join current work", async () => {
    const pending = deferred<void>();
    const service = createSearchService({ providers: [], async sourceMetadataLookup(url) {
      await pending.promise;
      return observation({ sourceUrl: url });
    }, async catalogLookup() { return [catalog]; } });
    const urls = Array.from({ length: 9 }, (_, index) => `https://www.youtube.com/watch?v=${String(index).padStart(11, "0")}`);
    const jobs = urls.slice(0, 8).map((url) => service.sourceReference({ ...lookup, sourceUrl: url }));
    const duplicate = service.sourceReference({ ...lookup, sourceUrl: urls[0]! });
    await expect(service.sourceReference({ ...lookup, sourceUrl: urls[8]! })).rejects.toThrow("Source reference unavailable");
    pending.resolve();
    expect((await Promise.all([...jobs, duplicate])).every((result) => result.status === "known")).toBe(true);
    expect(await service.sourceReference({ ...lookup, sourceUrl: urls[8]! })).toMatchObject({ status: "known" });
  });

  it.each(["metadata", "catalog"] as const)("aborts a %s deadline and cannot install a late reference", async (phase) => {
    vi.useFakeTimers();
    const selected = deferred<InternalTrack>();
    const catalogPending = deferred<readonly typeof catalog[]>();
    let signal!: AbortSignal;
    let completed = false;
    const service = createSearchService({ providers: [], sourceMetadataLookup(_url, options) {
      signal = options!.signal!;
      return completed || phase === "catalog" ? Promise.resolve(observation()) : selected.promise;
    }, catalogLookup() { return completed || phase === "metadata" ? Promise.resolve([catalog]) : catalogPending.promise; } });
    const rejected = service.sourceReference(lookup).then(() => undefined, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(18_000);
    expect(await rejected).toMatchObject({ message: "Source reference unavailable" });
    expect(signal.aborted).toBe(true);
    selected.resolve(observation());
    catalogPending.resolve([catalog]);
    await Promise.resolve();
    await expect(service.sourceReference(lookup)).rejects.toThrow("Source reference unavailable");
    completed = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await service.sourceReference(lookup)).toMatchObject({ status: "known" });
  });

  it.each([undefined, observation({ artist: "Unknown" })])("keeps unsupported or unidentified metadata unknown without a catalog request (%j)", async (metadata) => {
    const service = createSearchService({ providers: [], async sourceMetadataLookup() { return metadata; },
      async catalogLookup() { throw new Error("unexpected catalog"); },
    });
    expect(await service.sourceReference(lookup)).toEqual({ schemaVersion: 1, requestId, sourceKey: "youtube:BaW_jenozKc", status: "unknown" });
  });
});
