import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TfPrincipal } from "../lib/tf-policy.js";
import {
  createPlaylistsRouter,
  type PlaylistCollectionStore,
  type PlaylistRecord,
  type PlaylistTrackRecord,
} from "./playlists.js";

vi.hoisted(() => {
  process.env["DATABASE_URL"] ??= "postgres://unused:unused@127.0.0.1:1/unused";
});

const accountId = "10000000-0000-4000-8000-000000000001";
const principal: TfPrincipal = {
  accountId,
  tfSessionId: "30000000-0000-4000-8000-000000000003",
  installationId: "40000000-0000-4000-8000-000000000004",
  entitlements: ["tf.collections"],
  sessionExpiresAt: "2026-09-05T00:00:00.000Z",
  policyFreshUntil: "2026-09-04T23:59:00.000Z",
};
const playlist: PlaylistRecord = {
  id: 7,
  name: "Drive",
  description: null,
  trackCount: 1,
  createdAt: "2026-09-04T20:00:00.000Z",
  updatedAt: "2026-09-04T20:00:00.000Z",
};
const track: PlaylistTrackRecord = {
  trackId: "yt_track-1",
  artist: "Artist",
  title: "Title",
  thumbnailUrl: null,
  durationSeconds: 180,
  position: 0,
  addedAt: "2026-09-04T20:01:00.000Z",
};
const servers: Server[] = [];

function store(
  overrides: Partial<PlaylistCollectionStore> = {},
): PlaylistCollectionStore {
  return {
    list: vi.fn().mockResolvedValue([playlist]),
    create: vi.fn().mockResolvedValue({ ...playlist, trackCount: 0 }),
    get: vi.fn().mockResolvedValue({ playlist, tracks: [track] }),
    addTrack: vi.fn().mockResolvedValue({ track, added: true }),
    removeTrack: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

async function startServer(
  currentStore: PlaylistCollectionStore,
): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.tfPrincipal = principal;
    next();
  });
  app.use(createPlaylistsRouter({ store: currentStore }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

describe("TF playlists", () => {
  it("lists account-owned playlists with track counts", async () => {
    const currentStore = store();
    const origin = await startServer(currentStore);
    const response = await fetch(`${origin}/collections/playlists`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ playlists: [playlist] });
    expect(currentStore.list).toHaveBeenCalledWith(accountId);
  });

  it("creates a named playlist without accepting client ownership", async () => {
    const currentStore = store();
    const origin = await startServer(currentStore);
    const response = await fetch(`${origin}/collections/playlists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  Drive  " }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      playlist: { ...playlist, trackCount: 0 },
    });
    expect(currentStore.create).toHaveBeenCalledWith(accountId, "Drive");
  });

  it("returns playlist detail in position order", async () => {
    const currentStore = store();
    const origin = await startServer(currentStore);
    const response = await fetch(`${origin}/collections/playlists/7`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      playlist,
      tracks: [track],
    });
    expect(currentStore.get).toHaveBeenCalledWith(accountId, 7);
  });

  it("admits a TF track and reports a duplicate without changing metadata", async () => {
    const currentStore = store({
      addTrack: vi
        .fn()
        .mockResolvedValueOnce({ track, added: true })
        .mockResolvedValueOnce({ track, added: false }),
    });
    const origin = await startServer(currentStore);
    const body = {
      trackId: "yt_track-1",
      artist: "Artist",
      title: "Title",
      durationSeconds: 180,
    };
    for (const added of [true, false]) {
      const response = await fetch(`${origin}/collections/playlists/7/tracks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ track, added });
    }
    expect(currentStore.addTrack).toHaveBeenCalledWith(accountId, 7, {
      ...body,
      thumbnailUrl: null,
    });
  });

  it("removes tracks and playlists with empty 204 responses", async () => {
    const currentStore = store();
    const origin = await startServer(currentStore);
    const trackResponse = await fetch(
      `${origin}/collections/playlists/7/tracks/yt_track-1`,
      { method: "DELETE" },
    );
    const playlistResponse = await fetch(`${origin}/collections/playlists/7`, {
      method: "DELETE",
    });
    expect([trackResponse.status, playlistResponse.status]).toEqual([204, 204]);
    expect(await trackResponse.text()).toBe("");
    expect(await playlistResponse.text()).toBe("");
    expect(currentStore.removeTrack).toHaveBeenCalledWith(
      accountId,
      7,
      "yt_track-1",
    );
    expect(currentStore.remove).toHaveBeenCalledWith(accountId, 7);
  });

  it.each([
    ["GET", "/collections/playlists/7"],
    ["POST", "/collections/playlists/7/tracks"],
    ["DELETE", "/collections/playlists/7/tracks/yt_track-1"],
    ["DELETE", "/collections/playlists/7"],
  ])(
    "returns the same 404 for absent or foreign playlist on %s %s",
    async (method, path) => {
      const currentStore = store({
        get: vi.fn().mockResolvedValue(null),
        addTrack: vi.fn().mockResolvedValue(null),
        removeTrack: vi.fn().mockResolvedValue(false),
        remove: vi.fn().mockResolvedValue(false),
      });
      const origin = await startServer(currentStore);
      const response = await fetch(`${origin}${path}`, {
        method,
        headers:
          method === "POST"
            ? { "content-type": "application/json" }
            : undefined,
        body:
          method === "POST"
            ? JSON.stringify({ trackId: "sc_song", artist: "A", title: "T" })
            : undefined,
      });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "playlist_not_found",
      });
    },
  );

  it.each([
    ["POST", "/collections/playlists", { name: "" }],
    ["POST", "/collections/playlists", { name: "A", accountId: "foreign" }],
    [
      "POST",
      "/collections/playlists/7/tracks",
      { trackId: "sp_song", artist: "A", title: "T" },
    ],
    [
      "POST",
      "/collections/playlists/7/tracks",
      {
        trackId: "yt_song",
        artist: "A",
        title: "T",
        mediaUrl: "https://music.yandex.ru/audio",
      },
    ],
    [
      "POST",
      "/collections/playlists/7/tracks",
      { trackId: "yt_song", artist: "A", title: "T", durationSeconds: 0 },
    ],
    [
      "POST",
      "/collections/playlists/7/tracks",
      {
        trackId: "yt_song",
        artist: "A",
        title: "T",
        thumbnailUrl: "javascript:alert(1)",
      },
    ],
    [
      "POST",
      "/collections/playlists/0/tracks",
      { trackId: "yt_song", artist: "A", title: "T" },
    ],
    [
      "POST",
      "/collections/playlists/1e0/tracks",
      { trackId: "yt_song", artist: "A", title: "T" },
    ],
    [
      "DELETE",
      "/collections/playlists/7/tracks/https:%2F%2Fopen.spotify.com",
      undefined,
    ],
  ])(
    "rejects invalid %s %s before storage access",
    async (method, path, body) => {
      const currentStore = store();
      const origin = await startServer(currentStore);
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "bad_request" });
      expect(currentStore.create).not.toHaveBeenCalled();
      expect(currentStore.addTrack).not.toHaveBeenCalled();
      expect(currentStore.removeTrack).not.toHaveBeenCalled();
    },
  );
});
