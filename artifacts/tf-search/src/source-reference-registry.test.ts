import { describe, expect, it } from "vitest";
import type { MediaComparisonAssessment } from "./media-completeness.js";
import { recordingReferenceKey } from "./recording-reference.js";
import { SourceReferenceRegistry } from "./source-reference-registry.js";

const url = "https://www.youtube.com/watch?v=BaW_jenozKc";
function known(title = "Track", duration = 210, provenance: "catalog" | "peer" = "catalog"): MediaComparisonAssessment {
  const recording = { artist: "Artist", title, type: "original" as const, duration };
  return { status: "known", recordingKey: recordingReferenceKey(recording)!, reference: {
    artist: "Artist", title, type: "original", expectedDurationSeconds: duration, provenance,
  } };
}

describe("bounded source reference registry", () => {
  it("expires five-minute evidence despite LRU reads", () => {
    let now = 1_000;
    const registry = new SourceReferenceRegistry({ now: () => now });
    registry.observe(url, known());
    now = 300_999;
    expect(registry.lookup(url)?.status).toBe("known");
    now = 301_000;
    expect(registry.lookup(url)?.status).toBe("unknown");
  });

  it("bounds the default registry to 4096 sources and evicts the least recently used source", () => {
    const registry = new SourceReferenceRegistry({ now: () => 1_000 });
    for (let i = 0; i < 4_096; i += 1) registry.observe(`https://soundcloud.com/Artist/Track${i}`, known());
    registry.lookup("https://soundcloud.com/Artist/Track0");
    registry.observe("https://soundcloud.com/Artist/Track4096", known());
    expect(registry.size).toBe(4_096);
    expect(registry.lookup("https://soundcloud.com/Artist/Track1")?.status).toBe("unknown");
    expect(registry.lookup("https://soundcloud.com/Artist/Track0")?.status).toBe("known");
  });

  it("marks conflicting recording versions observed through canonical aliases as ambiguous", () => {
    const registry = new SourceReferenceRegistry({ now: () => 1_000 });
    registry.observe(url, known("Track (2011 Remaster)"));
    registry.observe("https://youtu.be/BaW_jenozKc", known("Track (2020 Remaster)"));
    expect(registry.lookup(url)?.status).toBe("ambiguous");
  });

  it("does not allow compatible pairwise updates to drift through conflicting durations", () => {
    const registry = new SourceReferenceRegistry({ now: () => 1_000 });
    for (const duration of [210, 212, 214]) registry.observe(url, known("Track", duration));
    expect(registry.lookup(url)?.status).toBe("ambiguous");
  });

  it("keeps ambiguity sticky for its live TTL instead of resolving it with later known or unknown observations", () => {
    let now = 1_000;
    const registry = new SourceReferenceRegistry({ now: () => now });
    registry.observe(url, known());
    registry.observe(url, { status: "ambiguous", recordingKey: recordingReferenceKey({ artist: "Artist", title: "Track", type: "original", duration: 210 }) });
    now = 2_000;
    registry.observe(url, { status: "unknown" });
    registry.observe(url, known());
    expect(registry.lookup(url)?.status).toBe("ambiguous");
    now = 301_000;
    registry.observe(url, known());
    expect(registry.lookup(url)?.status).toBe("known");
  });

  it("does not refresh catalog freshness using a weaker compatible peer observation", () => {
    let now = 1_000;
    const registry = new SourceReferenceRegistry({ now: () => now });
    registry.observe(url, known());
    now = 2_000;
    registry.observe(url, known("Track", 210, "peer"));
    expect(registry.lookup(url)).toMatchObject({ status: "known", reference: {
      provenance: "catalog", observedAt: 1_000, expiresAt: 301_000,
    } });
  });

  it("does not expose mutable references to callers", () => {
    const registry = new SourceReferenceRegistry({ now: () => 1_000 });
    registry.observe(url, known());
    const response = registry.lookup(url);
    if (response?.status === "known") response.reference.expectedDurationSeconds = 25;
    expect(registry.lookup(url)).toMatchObject({ reference: { expectedDurationSeconds: 210 } });
  });
});
