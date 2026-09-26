import { describe, expect, it } from "vitest";
import { moveLikedBefore } from "./liked-order.js";

describe("moveLikedBefore", () => {
  const tracks = [
    { storageId: 9, trackId: "yt_a", sortPosition: "90" },
    { storageId: 7, trackId: "yt_b", sortPosition: "70" },
    { storageId: 5, trackId: "yt_c", sortPosition: "50" },
    { storageId: 3, trackId: "yt_d", sortPosition: "30" },
  ];

  it("inserts before an anchor while preserving every other relative position", () => {
    expect(moveLikedBefore(tracks, "yt_d", "yt_b")).toEqual([
      { storageId: 3, sortPosition: "70" },
      { storageId: 7, sortPosition: "50" },
      { storageId: 5, sortPosition: "30" },
    ]);
  });

  it("moves to the end and recognizes a no-op", () => {
    expect(moveLikedBefore(tracks, "yt_a", null).map((row) => row.storageId)).toEqual([7, 5, 3, 9]);
    expect(moveLikedBefore(tracks, "yt_b", "yt_c")).toEqual([]);
  });

  it("does not accept a missing account-owned track or anchor", () => {
    expect(() => moveLikedBefore(tracks, "yt_foreign", "yt_a")).toThrow("liked_track_not_found");
    expect(() => moveLikedBefore(tracks, "yt_a", "yt_foreign")).toThrow("liked_track_not_found");
  });
});
