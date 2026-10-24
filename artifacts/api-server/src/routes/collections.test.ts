import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TfPrincipal } from "../lib/tf-policy.js";
import {
  createCollectionsRouter,
  encodeLikedCursor,
  type LikedCollectionStore,
  type LikedTrackRecord,
} from "./collections.js";
import { LikedOrderConflict } from "./liked-order.js";

vi.hoisted(() => {
  process.env["DATABASE_URL"] ??= "postgres://unused:unused@127.0.0.1:1/unused";
});

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ACCOUNT_ID = "20000000-0000-4000-8000-000000000002";
const principal: TfPrincipal = {
  accountId: ACCOUNT_ID,
  tfSessionId: "30000000-0000-4000-8000-000000000003",
  installationId: "40000000-0000-4000-8000-000000000004",
  entitlements: ["tf.collections"],
  sessionExpiresAt: "2026-09-05T00:00:00.000Z",
  policyFreshUntil: "2026-09-04T23:59:00.000Z",
};
const servers: Server[] = [];

function track(
  storageId: number,
  overrides: Partial<LikedTrackRecord> = {},
): LikedTrackRecord {
  return {
    storageId,
    trackId: `yt_track-${storageId}`,
    artist: "Artist",
    title: `Track ${storageId}`,
    thumbnailUrl: null,
    durationSeconds: 180,
    likedAt: "2026-09-04T20:00:00.000Z",
    ...overrides,
  };
}

function store(overrides: Partial<LikedCollectionStore> = {}) {
  return {
    list: vi.fn().mockResolvedValue([]),
    listManual: vi.fn().mockResolvedValue({ rows: [], revision: "0" }),
    lookup: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(track(1)),
    remove: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue({ revision: "1" }),
    ...overrides,
  } satisfies LikedCollectionStore;
}

async function startServer(
  currentStore: LikedCollectionStore,
): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.tfPrincipal = principal;
    next();
  });
  app.use(createCollectionsRouter({ store: currentStore }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("liked collection routes", () => {
  it("looks up only requested IDs under the principal account and preserves request order", async () => {
    const currentStore = store({
      lookup: vi.fn().mockResolvedValue(["sc_second", "yt_first"]),
    });
    const origin = await startServer(currentStore);
    const response = await fetch(`${origin}/collections/liked/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackIds: ["yt_first", "bc_absent", "sc_second"] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      likedTrackIds: ["yt_first", "sc_second"],
    });
    expect(currentStore.lookup).toHaveBeenCalledWith(ACCOUNT_ID, [
      "yt_first", "bc_absent", "sc_second",
    ]);
  });

  it.each([
    { trackIds: [] },
    { trackIds: ["yt_same", "yt_same"] },
    { trackIds: ["bad"] },
    { trackIds: ["yt_valid"], accountId: OTHER_ACCOUNT_ID },
    { trackIds: Array.from({ length: 41 }, (_, i) => `yt_${i}`) },
  ])("rejects invalid liked lookup input before storage access", async (body) => {
    const currentStore = store();
    const origin = await startServer(currentStore);
    const response = await fetch(`${origin}/collections/liked/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(currentStore.lookup).not.toHaveBeenCalled();
  });

  it("lists only the principal account and emits an opaque next cursor", async () => {
    const currentStore = store({
      list: vi.fn().mockResolvedValue([track(9), track(7), track(4)]),
    });
    const origin = await startServer(currentStore);

    const response = await fetch(
      `${origin}/collections/liked?limit=2&cursor=${encodeLikedCursor(12)}`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          trackId: "yt_track-9",
          artist: "Artist",
          title: "Track 9",
          thumbnailUrl: null,
          durationSeconds: 180,
          likedAt: "2026-09-04T20:00:00.000Z",
        },
        {
          trackId: "yt_track-7",
          artist: "Artist",
          title: "Track 7",
          thumbnailUrl: null,
          durationSeconds: 180,
          likedAt: "2026-09-04T20:00:00.000Z",
        },
      ],
      nextCursor: encodeLikedCursor(7),
    });
    expect(currentStore.list).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      cursorId: 12,
      limit: 3,
    });
  });

  it("lists persisted manual order with a revision and rejects a stale cursor", async () => {
    const ordered = [track(7), track(9), track(4)].map((row) => ({
      ...row,
      sortPosition: String(row.storageId),
    }));
    const currentStore = store({
      listManual: vi.fn().mockResolvedValueOnce({ rows: ordered, revision: "3" })
        .mockResolvedValueOnce({ rows: [], revision: "4" }),
    });
    const origin = await startServer(currentStore);
    const first = await fetch(`${origin}/collections/liked?sort=manual&limit=2`);
    expect(first.status).toBe(200);
    const page = await first.json() as {
      revision: string;
      items: { trackId: string }[];
      nextCursor: string;
    };
    expect(page.revision).toBe("3");
    expect(page.items.map((row: { trackId: string }) => row.trackId)).toEqual([
      "yt_track-7", "yt_track-9",
    ]);
    expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const second = await fetch(`${origin}/collections/liked?sort=manual&limit=2&cursor=${page.nextCursor}`);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({ error: "liked_order_conflict", revision: "4" });
    expect(currentStore.listManual).toHaveBeenCalledWith(expect.objectContaining({
      accountId: ACCOUNT_ID,
      limit: 3,
      cursor: expect.objectContaining({ revision: "3" }),
    }));
  });

  it("moves a liked track under the principal account with an expected revision", async () => {
    const currentStore = store();
    const origin = await startServer(currentStore);
    const response = await fetch(`${origin}/collections/liked/order`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trackId: "yt_track-9",
        beforeTrackId: "sc_track-2",
        expectedRevision: "3",
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revision: "1" });
    expect(currentStore.move).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      trackId: "yt_track-9",
      beforeTrackId: "sc_track-2",
      expectedRevision: "3",
    });
  });

  it("returns the current revision when a move conflicts with another device", async () => {
    const currentStore = store({ move: vi.fn().mockRejectedValue(new LikedOrderConflict("4")) });
    const origin = await startServer(currentStore);
    const response = await fetch(`${origin}/collections/liked/order`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trackId: "yt_track-9", beforeTrackId: null, expectedRevision: "3",
      }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "liked_order_conflict", revision: "4" });
  });

  it("upserts metadata under the principal account", async () => {
    const saved = track(15, {
      trackId: "sc_saved-track",
      artist: "Saved Artist",
      title: "Saved Track",
      thumbnailUrl: "https://cdn.example/cover.jpg",
      durationSeconds: 241,
    });
    const currentStore = store({
      save: vi.fn().mockResolvedValue(saved),
    });
    const origin = await startServer(currentStore);

    const response = await fetch(`${origin}/collections/liked/sc_saved-track`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artist: "  Saved Artist ",
        title: " Saved Track  ",
        thumbnailUrl: "https://cdn.example/cover.jpg",
        durationSeconds: 241,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      item: {
        trackId: "sc_saved-track",
        artist: "Saved Artist",
        title: "Saved Track",
        thumbnailUrl: "https://cdn.example/cover.jpg",
        durationSeconds: 241,
        likedAt: "2026-09-04T20:00:00.000Z",
      },
    });
    expect(currentStore.save).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      trackId: "sc_saved-track",
      artist: "Saved Artist",
      title: "Saved Track",
      thumbnailUrl: "https://cdn.example/cover.jpg",
      durationSeconds: 241,
    });
  });

  it("removes idempotently under the principal account", async () => {
    const currentStore = store();
    const origin = await startServer(currentStore);

    const response = await fetch(`${origin}/collections/liked/bc_track-5`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(currentStore.remove).toHaveBeenCalledWith(ACCOUNT_ID, "bc_track-5");
  });

  it.each([
    [
      "malformed cursor",
      "/collections/liked?cursor=not-a-cursor",
      "GET",
      undefined,
    ],
    ["invalid limit", "/collections/liked?limit=101", "GET", undefined],
    [
      "out-of-range manual cursor",
      `/collections/liked?sort=manual&cursor=${Buffer.from("o:0:999999999999999999999999").toString("base64url")}`,
      "GET",
      undefined,
    ],
    [
      "foreign owner field",
      "/collections/liked/yt_track-1",
      "PUT",
      { artist: "Artist", title: "Track", accountId: OTHER_ACCOUNT_ID },
    ],
    [
      "foreign owner on move",
      "/collections/liked/order",
      "PATCH",
      { trackId: "yt_valid", beforeTrackId: null, expectedRevision: "0", accountId: OTHER_ACCOUNT_ID },
    ],
    [
      "self anchor on move",
      "/collections/liked/order",
      "PATCH",
      { trackId: "yt_valid", beforeTrackId: "yt_valid", expectedRevision: "0" },
    ],
  ])("rejects %s before storage access", async (_label, path, method, body) => {
    const currentStore = store();
    const origin = await startServer(currentStore);

    const response = await fetch(`${origin}${path}`, {
      method,
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad_request" });
    expect(currentStore.list).not.toHaveBeenCalled();
    expect(currentStore.listManual).not.toHaveBeenCalled();
    expect(currentStore.save).not.toHaveBeenCalled();
    expect(currentStore.remove).not.toHaveBeenCalled();
    expect(currentStore.move).not.toHaveBeenCalled();
  });
});
