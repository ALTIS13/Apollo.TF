import { randomUUID } from "node:crypto";

import { createTfMigrationReadinessProbe } from "@workspace/db/migrations";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { LikedCollectionStore, LikedTrackRecord } from "./collections.js";

const TARGET_ERROR =
  "TF liked collection proof requires a marked disposable runtime database";
const HISTORICAL_LIKED_AT = "2001-02-03T04:05:06.000Z";

function targetConfiguration(runtimeUrl?: string, runId?: string) {
  if (runtimeUrl === undefined && runId === undefined) return undefined;
  if (
    !runtimeUrl ||
    !runId ||
    !/^[a-z0-9](?:[a-z0-9_]{6,30}[a-z0-9])$/.test(runId)
  ) {
    throw new Error(TARGET_ERROR);
  }
  const databaseName = `apollo_tf_test_${runId}`;
  try {
    const url = new URL(runtimeUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      decodeURIComponent(url.username) !== "apollo_tf_runtime" ||
      decodeURIComponent(url.pathname) !== `/${databaseName}`
    ) {
      throw new Error(TARGET_ERROR);
    }
  } catch {
    // Do not include a credential-bearing URL in validation failures.
    throw new Error(TARGET_ERROR);
  }
  return {
    runtimeUrl,
    databaseName,
    marker: `apollo.tf.integration-run:${runId}`,
  };
}

const runtimeUrl = process.env.TF_TEST_RUNTIME_DATABASE_URL;
const runId = process.env.TF_TEST_RUN_ID;

describe.skipIf(runtimeUrl === undefined && runId === undefined)(
  "actual liked collection store with PostgreSQL 17 and two accounts",
  () => {
    let pool: (typeof import("@workspace/db"))["pool"] | undefined;
    let store: LikedCollectionStore;
    let verified = false;
    let accountA: string;
    let accountB: string;
    let aOld: LikedTrackRecord;
    let aShared: LikedTrackRecord;
    let aNew: LikedTrackRecord;
    let bOld: LikedTrackRecord;
    let bShared: LikedTrackRecord;
    let bNew: LikedTrackRecord;

    beforeAll(async () => {
      const target = targetConfiguration(runtimeUrl, runId);
      if (!target) throw new Error(TARGET_ERROR);

      // Import the real singleton only after replacing any ambient production URL.
      vi.resetModules();
      vi.stubEnv("DATABASE_URL", target.runtimeUrl);
      ({ pool } = await import("@workspace/db"));
      const identity = await pool.query(`
        select current_database()::text as database_name,
          shobj_description(d.oid, 'pg_database')::text as marker,
          current_user::text as current_role, session_user::text as session_role,
          current_setting('server_version_num')::integer as server_version,
          r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolinherit,
          r.rolreplication, r.rolbypassrls, r.rolcanlogin,
          exists (select 1 from pg_auth_members m where m.member = r.oid) as member_of_role
        from pg_database d join pg_roles r on r.rolname = current_user
        where d.datname = current_database()
      `);
      expect(identity.rows).toEqual([
        {
          database_name: target.databaseName,
          marker: target.marker,
          current_role: "apollo_tf_runtime",
          session_role: "apollo_tf_runtime",
          server_version: expect.any(Number),
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: false,
          rolcanlogin: true,
          member_of_role: false,
        },
      ]);
      expect(identity.rows[0].server_version).toBeGreaterThanOrEqual(170_000);
      expect(identity.rows[0].server_version).toBeLessThan(180_000);
      expect(await createTfMigrationReadinessProbe(pool)()).toBe(true);

      const privileges = await pool.query(`
        select pg_get_userbyid(c.relowner)::text as table_owner,
          has_table_privilege(current_user, c.oid, 'SELECT') as can_select,
          has_table_privilege(current_user, c.oid, 'INSERT') as can_insert,
          has_table_privilege(current_user, c.oid, 'UPDATE') as can_update,
          has_table_privilege(current_user, c.oid, 'DELETE') as can_delete,
          has_table_privilege(current_user, c.oid, 'TRUNCATE') as can_truncate,
          has_schema_privilege(current_user, 'public', 'CREATE') as can_create,
          has_database_privilege(current_user, current_database(), 'CREATE') as can_create_schema,
          has_sequence_privilege(current_user, 'public.liked_tracks_id_seq', 'USAGE') as can_use_sequence,
          has_sequence_privilege(current_user, 'public.liked_tracks_id_seq', 'UPDATE') as can_reset_sequence
        from pg_class c where c.oid = 'public.liked_tracks'::regclass
      `);
      expect(privileges.rows).toEqual([
        {
          table_owner: "apollo_tf_migrator",
          can_select: true,
          can_insert: true,
          can_update: true,
          can_delete: true,
          can_truncate: false,
          can_create: false,
          can_create_schema: false,
          can_use_sequence: true,
          can_reset_sequence: false,
        },
      ]);
      ({ defaultLikedCollectionStore: store } =
        await import("./collections.js"));
      verified = true;
    }, 30_000);

    afterAll(async () => {
      try {
        await pool?.end();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    const list = (
      accountId: string,
      cursorId: number | null = null,
      limit = 100,
    ) => store.list({ accountId, cursorId, limit });

    async function snapshot(accountId: string) {
      return (
        await pool!.query(
          "select * from public.liked_tracks where session_id = $1 order by id desc",
          [accountId],
        )
      ).rows;
    }

    async function seed(
      accountId: string,
      trackId: string,
    ): Promise<LikedTrackRecord> {
      const saved = await store.save({
        accountId,
        trackId,
        artist: `Artist ${accountId}`,
        title: `Title ${trackId}`,
        thumbnailUrl: "https://example.invalid/cover.jpg",
        durationSeconds: 180,
      });
      expect(Number.isFinite(Date.parse(saved.likedAt))).toBe(true);
      return { ...saved, likedAt: HISTORICAL_LIKED_AT };
    }

    beforeEach(async () => {
      accountA = randomUUID();
      accountB = randomUUID();
      const suffix = randomUUID();
      // Interleave owners so removing either owner predicate breaks pagination.
      aOld = await seed(accountA, `yt_old_${suffix}`);
      bOld = await seed(accountB, `sc_old_${suffix}`);
      aShared = await seed(accountA, `yt_shared_${suffix}`);
      bShared = await seed(accountB, aShared.trackId);
      aNew = await seed(accountA, `bc_new_${suffix}`);
      bNew = await seed(accountB, `dz_new_${suffix}`);
      // A historical timestamp catches timestamp-reset regressions without sleeps.
      const seeded = await pool!.query(
        "update public.liked_tracks set liked_at = $1 where session_id = any($2::text[])",
        [HISTORICAL_LIKED_AT, [accountA, accountB]],
      );
      expect(seeded.rowCount).toBe(6);
    }, 30_000);

    afterEach(async () => {
      if (!verified || !accountA || !accountB) return;
      // Independent SQL cleanup must not rely on the DELETE implementation under test.
      await pool!.query(
        "delete from public.liked_tracks where session_id = any($1::text[])",
        [[accountA, accountB]],
      );
      expect(await snapshot(accountA)).toEqual([]);
      expect(await snapshot(accountB)).toEqual([]);
    }, 15_000);

    it("SELECT scopes both cursor branches to the owner and applies descending order and limit", async () => {
      expect(await list(accountA)).toEqual([aNew, aShared, aOld]);
      expect(await list(accountB)).toEqual([bNew, bShared, bOld]);
      expect(await list(accountA, null, 2)).toEqual([aNew, aShared]);
      expect(await list(accountB, null, 2)).toEqual([bNew, bShared]);
      expect(await list(accountA, aShared.storageId, 2)).toEqual([aOld]);
      expect(await list(accountB, bShared.storageId, 2)).toEqual([bOld]);
      expect(await list(accountA, aNew.storageId, 1)).toEqual([aShared]);
      expect(await list(accountA, bShared.storageId)).toEqual([aShared, aOld]);
      expect(await list(accountB, aShared.storageId)).toEqual([bOld]);
      expect(await list(accountA, aOld.storageId)).toEqual([]);
      expect(await list(accountB, bOld.storageId)).toEqual([]);
    });

    it("looks up only tracks owned by the current account, including shared IDs", async () => {
      const requested = [aOld.trackId, aShared.trackId, bNew.trackId];
      expect(new Set(await store.lookup(accountA, requested))).toEqual(
        new Set([aOld.trackId, aShared.trackId]),
      );
      expect(new Set(await store.lookup(accountB, requested))).toEqual(
        new Set([aShared.trackId, bNew.trackId]),
      );
    });

    it("upserts idempotently, preserves storage ID and likedAt, and isolates owners of the same track", async () => {
      expect(aShared.storageId).not.toBe(bShared.storageId);
      const untouchedB = await snapshot(accountB);
      const input = {
        accountId: accountA,
        trackId: aShared.trackId,
        artist: aShared.artist!,
        title: aShared.title!,
        thumbnailUrl: aShared.thumbnailUrl,
        durationSeconds: aShared.durationSeconds,
      };
      expect(await store.save(input)).toEqual(aShared);
      expect(await store.save(input)).toEqual(aShared);

      const updated = {
        ...input,
        artist: "Updated Artist",
        title: "Updated Title",
        thumbnailUrl: null,
        durationSeconds: null,
      };
      const expected = {
        ...aShared,
        artist: updated.artist,
        title: updated.title,
        thumbnailUrl: null,
        durationSeconds: null,
      };
      expect(await store.save(updated)).toEqual(expected);
      expect(await store.save(updated)).toEqual(expected);
      const restored = {
        ...updated,
        thumbnailUrl: "https://example.invalid/new.jpg",
        durationSeconds: 241,
      };
      const restoredRecord = {
        ...expected,
        thumbnailUrl: restored.thumbnailUrl,
        durationSeconds: 241,
      };
      expect(await store.save(restored)).toEqual(restoredRecord);
      expect(await list(accountA)).toEqual([aNew, restoredRecord, aOld]);
      const rows = await snapshot(accountA);
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.track_id === aShared.trackId)).toEqual([
        expect.objectContaining({
          id: aShared.storageId,
          session_id: accountA,
          artist: restored.artist,
          title: restored.title,
          duration: "241",
          thumbnail_url: restored.thumbnailUrl,
          liked_at: new Date(HISTORICAL_LIKED_AT),
        }),
      ]);
      expect(await snapshot(accountB)).toEqual(untouchedB);
      expect(await list(accountB)).toEqual([bNew, bShared, bOld]);
    });

    it("DELETE is owner-and-track scoped, repeatable, and preserves the unrelated account", async () => {
      const untouchedB = await snapshot(accountB);
      const remainingA = (await snapshot(accountA)).filter(
        (row) => row.id !== aShared.storageId,
      );
      await expect(
        store.remove(accountA, aShared.trackId),
      ).resolves.toBeUndefined();
      expect(await snapshot(accountA)).toEqual(remainingA);
      expect(await snapshot(accountB)).toEqual(untouchedB);
      await expect(
        store.remove(accountA, aShared.trackId),
      ).resolves.toBeUndefined();
      // A track owned only by B is also a no-op when removed by A.
      await expect(
        store.remove(accountA, bNew.trackId),
      ).resolves.toBeUndefined();
      expect(await snapshot(accountA)).toEqual(remainingA);
      expect(await list(accountA)).toEqual([aNew, aOld]);
      expect(await snapshot(accountB)).toEqual(untouchedB);
      expect(await list(accountB)).toEqual([bNew, bShared, bOld]);
    });
  },
);
