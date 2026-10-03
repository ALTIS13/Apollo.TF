import { describe, expect, it } from "vitest";

import {
  ListLikedTracksQueryParams,
  SaveLikedTrackBody,
  SaveLikedTrackParams,
  ListLikedTracksResponse,
  SaveLikedTrackResponse,
} from "./generated/api";

describe("generated liked collection schemas", () => {
  it("accepts the bounded public collection request", () => {
    expect(
      ListLikedTracksQueryParams.parse({
        limit: "100",
        cursor: "bGlrZWQ6MTI",
      }),
    ).toEqual({ limit: 100, cursor: "bGlrZWQ6MTI" });
    expect(SaveLikedTrackParams.parse({ trackId: "yt_track-1" })).toEqual({
      trackId: "yt_track-1",
    });
    expect(
      SaveLikedTrackBody.parse({
        artist: "Artist",
        title: "Track",
        thumbnailUrl: null,
        durationSeconds: 240,
      }),
    ).toEqual({
      artist: "Artist",
      title: "Track",
      thumbnailUrl: null,
      durationSeconds: 240,
    });
  });

  it("rejects out-of-range collection input", () => {
    expect(ListLikedTracksQueryParams.safeParse({ limit: "101" }).success).toBe(
      false,
    );
    expect(SaveLikedTrackParams.safeParse({ trackId: "foreign" }).success).toBe(
      false,
    );
    expect(
      SaveLikedTrackBody.safeParse({
        artist: "Artist",
        title: "Track",
        durationSeconds: 86_401,
      }).success,
    ).toBe(false);
  });

  it("matches JSON response timestamps and rejects fractional or foreign-owner input", () => {
    const item = {
      trackId: "yt_track-1",
      artist: null,
      title: null,
      thumbnailUrl: null,
      durationSeconds: 240,
      likedAt: "2026-09-04T20:00:00.000Z",
    };
    expect(
      ListLikedTracksResponse.parse({ items: [item], nextCursor: null }),
    ).toEqual({ items: [item], nextCursor: null });
    expect(SaveLikedTrackResponse.parse({ item })).toEqual({ item });
    expect(ListLikedTracksQueryParams.safeParse({ limit: "1.5" }).success).toBe(
      false,
    );
    expect(
      SaveLikedTrackBody.safeParse({
        artist: "Artist",
        title: "Track",
        durationSeconds: 1.5,
      }).success,
    ).toBe(false);
    expect(
      SaveLikedTrackBody.safeParse({
        artist: "Artist",
        title: "Track",
        accountId: "foreign",
      }).success,
    ).toBe(false);
    expect(
      SaveLikedTrackBody.parse({ artist: " Artist ", title: " Track " }),
    ).toEqual({ artist: "Artist", title: "Track" });
  });
});
