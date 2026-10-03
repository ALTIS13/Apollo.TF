import { randomUUID } from "node:crypto";

import { createTfPool } from "@workspace/db/pool";
import { runTfMigrations } from "@workspace/db/migrations";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PlaylistCollectionStore } from "./playlists.js";

const runId = process.env.TF_TEST_PLAYLIST_RUN_ID;
const migratorUrl = process.env.TF_TEST_PLAYLIST_MIGRATOR_DATABASE_URL;
const runtimeUrl = process.env.TF_TEST_PLAYLIST_RUNTIME_DATABASE_URL;
const enabled = [runId, migratorUrl, runtimeUrl].some(Boolean);
const TARGET_ERROR = "Playlist proof requires a marked disposable TF database";

function validateUrl(raw: string | undefined, role: string, database: string): string {
  try {
    const url = new URL(raw!);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      decodeURIComponent(url.username) !== role ||
      decodeURIComponent(url.pathname) !== `/${database}` ||
      !url.hostname
    ) throw new Error(TARGET_ERROR);
    return raw!;
  } catch {
    throw new Error(TARGET_ERROR);
  }
}

describe.skipIf(!enabled)("playlist store on disposable PostgreSQL", () => {
  let store: PlaylistCollectionStore;
  let pool: (typeof import("@workspace/db"))["pool"] | undefined;
  let accountA: string;
  let accountB: string;
  const playlistIds: { account: string; id: number }[] = [];

  beforeAll(async () => {
    if (!runId || !/^[a-z0-9](?:[a-z0-9_]{6,30}[a-z0-9])$/.test(runId))
      throw new Error(TARGET_ERROR);
    const database = `apollo_tf_test_${runId}`;
    const migration = createTfPool(
      validateUrl(migratorUrl, "apollo_tf_migrator", database),
      "migration",
    );
    try {
      const identity = await migration.query(
        `select current_database()::text as database,
          shobj_description(d.oid, 'pg_database')::text as marker,
          current_user::text as role
         from pg_database d where d.datname = current_database()`,
      );
      if (
        identity.rows.length !== 1 ||
        identity.rows[0].database !== database ||
        identity.rows[0].marker !== `apollo.tf.integration-run:${runId}` ||
        identity.rows[0].role !== "apollo_tf_migrator"
      ) throw new Error(TARGET_ERROR);
      await runTfMigrations(migration);
    } finally {
      await migration.end();
    }

    vi.resetModules();
    vi.stubEnv("DATABASE_URL", validateUrl(runtimeUrl, "apollo_tf_runtime", database));
    ({ pool } = await import("@workspace/db"));
    const runtimeIdentity = await pool.query(
      `select current_database()::text as database,
        shobj_description(d.oid, 'pg_database')::text as marker,
        current_user::text as role
       from pg_database d where d.datname = current_database()`,
    );
    if (
      runtimeIdentity.rows.length !== 1 ||
      runtimeIdentity.rows[0].database !== database ||
      runtimeIdentity.rows[0].marker !== `apollo.tf.integration-run:${runId}` ||
      runtimeIdentity.rows[0].role !== "apollo_tf_runtime"
    ) throw new Error(TARGET_ERROR);
    ({ defaultPlaylistCollectionStore: store } = await import("./playlists.js"));
    accountA = randomUUID();
    accountB = randomUUID();
  });

  afterAll(async () => {
    try {
      if (store) {
        for (const { account, id } of playlistIds) await store.remove(account, id);
      }
    } finally {
      await pool?.end();
      vi.unstubAllEnvs();
    }
  });

  it("serializes duplicate admissions, persists order and isolates owners", async () => {
    const a = await store.create(accountA, "A");
    playlistIds.push({ account: accountA, id: a.id });
    const b = await store.create(accountB, "B");
    playlistIds.push({ account: accountB, id: b.id });
    const first = {
      trackId: "yt_first", artist: "Artist", title: "First",
      thumbnailUrl: null, durationSeconds: 240,
    };
    const concurrent = await Promise.all([
      store.addTrack(accountA, a.id, first),
      store.addTrack(accountA, a.id, first),
    ]);
    expect(concurrent.map((result) => result?.added).sort()).toEqual([false, true]);
    await store.addTrack(accountA, a.id, { ...first, trackId: "yt_second", title: "Second" });
    await store.addTrack(accountB, b.id, first);

    expect(await store.get(accountB, a.id)).toBeNull();
    expect(await store.addTrack(accountB, a.id, first)).toBeNull();
    expect(await store.reorder(accountB, a.id, ["yt_second", "yt_first"])).toBeNull();
    expect(await store.reorder(accountA, a.id, ["yt_first"])).toBe("invalid_order");

    const reordered = await store.reorder(accountA, a.id, ["yt_second", "yt_first"]);
    expect(reordered && reordered !== "invalid_order" && reordered.tracks.map((track) => [track.trackId, track.position]))
      .toEqual([["yt_second", 0], ["yt_first", 1]]);
    expect((await store.get(accountA, a.id))?.tracks.map((track) => track.trackId))
      .toEqual(["yt_second", "yt_first"]);
    expect((await store.get(accountB, b.id))?.tracks.map((track) => track.trackId))
      .toEqual(["yt_first"]);
    const persisted = await pool!.query(
      `select playlist_id, track_id, position from public.playlist_tracks
       where playlist_id = any($1::integer[]) order by playlist_id, position`,
      [[a.id, b.id]],
    );
    expect(persisted.rows).toEqual([
      { playlist_id: a.id, track_id: "yt_second", position: 0 },
      { playlist_id: a.id, track_id: "yt_first", position: 1 },
      { playlist_id: b.id, track_id: "yt_first", position: 0 },
    ]);
    expect(await store.removeTrack(accountB, a.id, "yt_first")).toBe(false);
    expect(await store.remove(accountB, a.id)).toBe(false);
  });
});
