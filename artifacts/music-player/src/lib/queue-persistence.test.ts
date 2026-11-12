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

  it("persists queue metadata without artwork URLs or changing order and position", () => {
    const storage = memoryStorage();
    const second = { ...first, id: "yt_second", title: "Second" };
    const queue = [
      { ...first, thumbnailUrl: "https://artwork.example/cover?signature=test-only" },
      { ...second, thumbnailUrl: "https://cdn.example/cover" },
    ];
    expect(writeQueueSnapshot(storage, identityA, queue, 1, 42, 100_000)).toBe(true);
    expect(storage.getItem(storage.key(0)!)).not.toMatch(/artwork\.example|cdn\.example|test-only/);
    expect(readQueueSnapshot(storage, identityA, 100_001)).toEqual({
      queue: [first, second], index: 1, positionSeconds: 42,
    });
  });

  it("ignores legacy artwork on read without rewriting any stored queue", () => {
    const storage = memoryStorage();
    expect(writeQueueSnapshot(storage, identityA, [first], 0, 15, 100_000)).toBe(true);
    expect(writeQueueSnapshot(storage, identityB, [first], 0, 37, 100_000)).toBe(true);
    const keyA = storage.key(0)!;
    const keyB = storage.key(1)!;
    const otherQueue = storage.getItem(keyB);
    const legacy = JSON.stringify({ version: 1, savedAt: 100_000, index: 0, positionSeconds: 15,
      queue: [{ ...first, thumbnailUrl: "https://legacy.example/private-artwork" },
        { ...first, thumbnailUrl: "blob:https://legacy.example/not-durable" }] });
    storage.setItem(keyA, legacy);
    expect(readQueueSnapshot(storage, identityA, 100_001)).toEqual({
      queue: [first, first], index: 0, positionSeconds: 15,
    });
    expect(storage.getItem(keyA)).toBe(legacy);
    expect(storage.getItem(keyB)).toBe(otherQueue);
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
