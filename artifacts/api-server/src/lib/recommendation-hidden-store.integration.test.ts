import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const runId = process.env["TF_TEST_RUN_ID"];
const adminUrl = process.env["TF_TEST_ADMIN_DATABASE_URL"];
const migratorUrl = process.env["TF_TEST_MIGRATOR_DATABASE_URL"];
const runtimeUrl = process.env["TF_TEST_RUNTIME_DATABASE_URL"];
const configured = Boolean(runId && adminUrl && migratorUrl && runtimeUrl);
type Pool = ReturnType<typeof import("@workspace/db/pool").createTfPool>;

describe.skipIf(!configured)("recommendation hidden real-store PG16", () => {
  let adminPool: Pool;
  let migratorPool: Pool;
  let runtimePool: Pool;
  let store: typeof import("./recommendation-hidden-store.js") | undefined;
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const accountA = randomUUID();
  const accountB = randomUUID();
  const sourceKey = randomUUID();
  const youtubeId = `yt_${sourceKey}`;
  const soundcloudId = `sc_${sourceKey}`;

  beforeAll(async () => {
    if (!runId || !adminUrl || !migratorUrl || !runtimeUrl || !/^[a-z0-9_]{8,32}$/.test(runId)) {
      throw new Error("Invalid disposable recommendation target");
    }
    const databaseName = `apollo_tf_test_${runId}`;
    const ports = new Set<string>();
    for (const [raw, user] of [
      [adminUrl, "postgres"],
      [migratorUrl, "apollo_tf_migrator"],
      [runtimeUrl, "apollo_tf_runtime"],
    ] as const) {
      const url = new URL(raw);
      if (url.hostname !== "127.0.0.1" || url.pathname !== `/${databaseName}` ||
        decodeURIComponent(url.username) !== user) {
        throw new Error("Recommendation target must be a marked loopback database with exact roles");
      }
      ports.add(url.port || "5432");
    }
    if (ports.size !== 1) throw new Error("Recommendation target roles must use the same loopback port");
    const { createTfPool } = await import("@workspace/db/pool");
    adminPool = createTfPool(adminUrl, "migration");
    migratorPool = createTfPool(migratorUrl, "migration");
    runtimePool = createTfPool(runtimeUrl);
    for (const [pool, user] of [
      [adminPool, "postgres"],
      [migratorPool, "apollo_tf_migrator"],
      [runtimePool, "apollo_tf_runtime"],
    ] as const) {
      const identity = await pool.query(`
        select current_user::text as username, current_database()::text as database_name,
          host(inet_server_addr())::text as server_address,
          current_setting('server_version_num')::integer as server_version,
          shobj_description(d.oid, 'pg_database')::text as marker
        from pg_database d where d.datname = current_database()
      `);
      expect(identity.rows).toEqual([{
        username: user, database_name: databaseName, server_address: "127.0.0.1",
        server_version: expect.any(Number), marker: `apollo.tf.integration-run:${runId}`,
      }]);
      expect(identity.rows[0].server_version).toBeGreaterThanOrEqual(160000);
      expect(identity.rows[0].server_version).toBeLessThan(170000);
    }
    const { runTfMigrations } = await import("@workspace/db/migrations");
    await runTfMigrations(migratorPool);
    process.env["DATABASE_URL"] = runtimeUrl;
    store = await import("./recommendation-hidden-store.js");
  });

  beforeEach(async () => {
    await runtimePool.query("delete from public.recommendation_hidden where account_id in ($1, $2)", [accountA, accountB]);
  });

  afterAll(async () => {
    try {
      if (store) {
        await runtimePool.query("delete from public.recommendation_hidden where account_id in ($1, $2)", [accountA, accountB]);
      }
    } finally {
      await Promise.all([adminPool, migratorPool, runtimePool].filter(Boolean).map((pool) => pool.end()));
      if (store) {
        const { pool } = await import("@workspace/db");
        await pool.end();
      }
      if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = previousDatabaseUrl;
    }
  });

  it("persists idempotent membership with account and exact source-ID isolation", async () => {
    await store!.hideRecommendation({ accountId: accountA, trackId: youtubeId });
    const first = await runtimePool.query<{ hidden_at: Date }>(
      "select hidden_at from public.recommendation_hidden where account_id = $1 and track_id = $2", [accountA, youtubeId],
    );
    await store!.hideRecommendation({ accountId: accountA, trackId: youtubeId });
    await store!.hideRecommendation({ accountId: accountA, trackId: soundcloudId });
    await store!.hideRecommendation({ accountId: accountB, trackId: youtubeId });
    expect([...(await store!.loadHiddenTrackIds(accountA))].sort()).toEqual([youtubeId, soundcloudId].sort());
    expect(await store!.loadHiddenTrackIds(accountB)).toEqual([youtubeId]);
    const duplicate = await runtimePool.query<{ hidden_at: Date }>(
      "select hidden_at from public.recommendation_hidden where account_id = $1 and track_id = $2", [accountA, youtubeId],
    );
    expect(duplicate.rows).toEqual(first.rows);
  });

  it("restores and clears idempotently without changing another account", async () => {
    for (const trackId of [youtubeId, soundcloudId]) await store!.hideRecommendation({ accountId: accountA, trackId });
    await store!.hideRecommendation({ accountId: accountB, trackId: youtubeId });
    for (let attempt = 0; attempt < 2; attempt++) await store!.restoreRecommendation({ accountId: accountA, trackId: youtubeId });
    expect(await store!.loadHiddenTrackIds(accountA)).toEqual([soundcloudId]);
    for (let attempt = 0; attempt < 2; attempt++) await store!.clearHiddenRecommendations(accountA);
    expect(await store!.loadHiddenTrackIds(accountA)).toEqual([]);
    expect(await store!.loadHiddenTrackIds(accountB)).toEqual([youtubeId]);
  });

  it("keeps migrator ownership, runtime set-only grants, and DB length constraints", async () => {
    const owner = await adminPool.query<{ tableowner: string }>(
      "select tableowner from pg_tables where schemaname = 'public' and tablename = 'recommendation_hidden'",
    );
    expect(owner.rows).toEqual([{ tableowner: "apollo_tf_migrator" }]);
    const privileges = await runtimePool.query(`
      select has_table_privilege(current_user, 'public.recommendation_hidden', 'SELECT') as can_select,
        has_table_privilege(current_user, 'public.recommendation_hidden', 'INSERT') as can_insert,
        has_table_privilege(current_user, 'public.recommendation_hidden', 'DELETE') as can_delete,
        has_table_privilege(current_user, 'public.recommendation_hidden', 'UPDATE') as can_update,
        has_table_privilege(current_user, 'public.recommendation_hidden', 'TRUNCATE') as can_truncate,
        has_table_privilege(current_user, 'public.recommendation_hidden', 'REFERENCES') as can_reference,
        has_table_privilege(current_user, 'public.recommendation_hidden', 'TRIGGER') as can_trigger
    `);
    expect(privileges.rows).toEqual([{
      can_select: true, can_insert: true, can_delete: true, can_update: false, can_truncate: false, can_reference: false, can_trigger: false,
    }]);
    await expect(runtimePool.query("update public.recommendation_hidden set hidden_at = now() where account_id = $1", [accountA]))
      .rejects.toMatchObject({ code: "42501" });
    for (const trackId of ["", "x".repeat(4097)]) {
      await expect(runtimePool.query(
        "insert into public.recommendation_hidden (account_id, track_id) values ($1, $2)", [accountA, trackId],
      )).rejects.toMatchObject({ code: "23514" });
    }
  });
});
