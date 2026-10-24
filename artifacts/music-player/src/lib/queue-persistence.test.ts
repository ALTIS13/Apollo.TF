import { describe, expect, it } from "vitest";
import type { TrackResult } from "@workspace/api-client-react";
import { readQueueSnapshot, writeQueueSnapshot } from "./queue-persistence";

const identityA = {
  accountId: "10000000-0000-4000-8000-000000000001",
  installationId: "20000000-0000-4000-8000-000000000002",
};
const identityB = { ...identityA, accountId: "10000000-0000-4000-8000-000000000003" };
const first: TrackResult = {
  id: "yt_first", title: "First", artist: "Artist", duration: 180,
  source: "youtube", type: "original", thumbnailUrl: null, quality: [], score: 0,
};

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() { return entries.size; },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => { entries.delete(key); },
    setItem: (key, value) => { entries.set(key, value); },
  };
}

describe("device-local queue snapshot", () => {
  it("restores only for the same account and installation without a stream URL", () => {
    const storage = memoryStorage();
    const track = { ...first, streamUrl: "https://expired.example/audio" };
    expect(writeQueueSnapshot(storage, identityA, [track], 0, 42, 100_000)).toBe(true);
    expect(readQueueSnapshot(storage, identityA, 100_001)).toEqual({
      queue: [first], index: 0, positionSeconds: 42,
    });
    expect(readQueueSnapshot(storage, identityB, 100_001)).toBeNull();
    expect(readQueueSnapshot(storage, { ...identityA, installationId: "different" }, 100_001)).toBeNull();
    expect([...Array(storage.length)].map((_, index) => storage.getItem(storage.key(index)!)).join(" "))
      .not.toContain("expired.example");
  });

  it("rejects stale and malformed snapshots without throwing", () => {
    const storage = memoryStorage();
    writeQueueSnapshot(storage, identityA, [first], 0, 3, 100_000);
    expect(readQueueSnapshot(storage, identityA, 100_000 + 8 * 24 * 60 * 60 * 1000)).toBeNull();
    const key = storage.key(0)!;
    storage.setItem(key, "{invalid");
    expect(readQueueSnapshot(storage, identityA, 100_001)).toBeNull();
    storage.setItem(key, JSON.stringify({ version: 1, savedAt: 100_000, index: 0, positionSeconds: 0,
      queue: [{ ...first, id: "https://evil.example/track" }] }));
    expect(readQueueSnapshot(storage, identityA, 100_001)).toBeNull();
  });
});
