import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runId = process.env["TF_TEST_RUN_ID"];
const targets = [
  [process.env["TF_TEST_ADMIN_DATABASE_URL"], "postgres"],
  [process.env["TF_TEST_MIGRATOR_DATABASE_URL"], "apollo_tf_migrator"],
  [process.env["TF_TEST_RUNTIME_DATABASE_URL"], "apollo_tf_runtime"],
] as const;
const configured = Boolean(runId && targets.every(([url]) => url));
type Pool = ReturnType<typeof import("@workspace/db/pool").createTfPool>;

describe.skipIf(!configured)("playlist import drafts on marked PG16", () => {
  const pools: Pool[] = [];
  const accounts = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
  const [accountA, accountB, quotaAccount, otherAccount, constraintAccount] = accounts;
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  let runtime: Pool;
  let draftsTableExists = false;
  let closeStorePool: (() => Promise<void>) | undefined;
  const entries = [
    { artist: "Artist", title: "Second", durationSeconds: null },
    { artist: "Artist", title: "First", durationSeconds: 181 },
  ] as const;
  const input = { name: "Draft", source: "file", entries } as const;

  beforeAll(async () => {
    if (!runId || !/^[a-z0-9_]{8,32}$/.test(runId)) throw new Error("Invalid disposable import target");
    const databaseName = `apollo_tf_test_${runId}`;
    const ports = new Set<string>();
    for (const [raw, role] of targets) {
      if (!raw) throw new Error("Missing disposable import target role");
      const url = new URL(raw);
      if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
        url.pathname !== `/${databaseName}` || decodeURIComponent(url.username) !== role ||
        url.search || url.hash) throw new Error("Expected a disposable loopback database with exact roles");
      ports.add(url.port || "5432");
    }
    if (ports.size !== 1) throw new Error("Disposable role URLs must share the same port");

    const { createTfPool } = await import("@workspace/db/pool");
    for (const [raw, role] of targets) {
      const pool = createTfPool(raw!, role === "apollo_tf_runtime" ? "runtime" : "migration");
      pools.push(pool);
      const { rows } = await pool.query<{ role: string; db: string; addr: string; version: number; marker: string }>(`
        select current_user::text as role, current_database()::text as db,
          host(inet_server_addr()) as addr, current_setting('server_version_num')::integer as version,
          shobj_description(oid, 'pg_database') as marker
        from pg_database where datname = current_database()
      `);
      expect(rows).toEqual([{
        role, db: databaseName, addr: "127.0.0.1", version: expect.any(Number),
        marker: `apollo.tf.integration-run:${runId}`,
      }]);
      expect(rows[0]!.version).toBeGreaterThanOrEqual(160000);
      expect(rows[0]!.version).toBeLessThan(170000);
    }
    const { runTfMigrations } = await import("@workspace/db/migrations");
    await runTfMigrations(pools[1]!);
    runtime = pools[2]!;
    const { rows } = await runtime.query<{ present: boolean }>(
      "select to_regclass('public.playlist_import_drafts') is not null as present",
    );
    draftsTableExists = rows[0]!.present;
    process.env["DATABASE_URL"] = targets[2][0]!;
  }, 30_000);

  async function loadStore() {
    const { defaultPlaylistImportStore } = await import("./playlist-import-store.js");
    const { pool } = await import("@workspace/db");
    closeStorePool = () => pool.end();
    return defaultPlaylistImportStore;
  }

  afterAll(async () => {
    try {
      if (draftsTableExists) await runtime.query(
        "delete from public.playlist_import_drafts where account_id = any($1::uuid[])", [accounts],
      );
    } finally {
      try {
        await Promise.all([...pools.map((pool) => pool.end()), closeStorePool?.()]);
      } finally {
        if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
        else process.env["DATABASE_URL"] = previousDatabaseUrl;
      }
    }
  });

  it("migrates and reapplies with migrator ownership and only runtime select/insert/delete", async () => {
    expect(draftsTableExists).toBe(true);
    const { runTfMigrations } = await import("@workspace/db/migrations");
    const rerun = await runTfMigrations(pools[1]!);
    expect(rerun.applied).toEqual([]);
    expect(rerun.alreadyApplied.at(-1)).toBe("0007_playlist_import_drafts.sql");
    const { rows } = await runtime.query(`
      select tableowner, has_table_privilege(current_user, 'public.playlist_import_drafts', 'SELECT') as can_select,
        has_table_privilege(current_user, 'public.playlist_import_drafts', 'INSERT') as can_insert,
        has_table_privilege(current_user, 'public.playlist_import_drafts', 'DELETE') as can_delete,
        has_table_privilege(current_user, 'public.playlist_import_drafts', 'UPDATE') as can_update,
        has_table_privilege(current_user, 'public.playlist_import_drafts', 'TRUNCATE') as can_truncate,
        has_table_privilege(current_user, 'public.playlist_import_drafts', 'REFERENCES') as can_reference,
        has_table_privilege(current_user, 'public.playlist_import_drafts', 'TRIGGER') as can_trigger
      from pg_tables where schemaname = 'public' and tablename = 'playlist_import_drafts'
    `);
    expect(rows).toEqual([{
      tableowner: "apollo_tf_migrator", can_select: true, can_insert: true, can_delete: true,
      can_update: false, can_truncate: false, can_reference: false, can_trigger: false,
    }]);
    await expect(runtime.query("update public.playlist_import_drafts set name = 'No'"))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("preserves metadata order and creation time on exact normalized replay without overwriting conflicts", async () => {
    const store = await loadStore();
    const id = randomUUID();
    const result = await store.put(accountA, id, { ...input, name: "  Draft  ", entries: [
      { title: " Second ", durationSeconds: null, artist: " Artist " }, entries[1],
    ] });
    expect(result.status).toBe("created");
    const detail = await store.get(accountA, id);
    expect(detail).toEqual({ id, ...input, entryCount: 2, createdAt: expect.any(String) });
    expect(new Date(detail!.createdAt).toISOString()).toBe(detail!.createdAt);
    expect(await store.put(accountA, id, input)).toEqual({ status: "existing", draft: detail });
    for (const changed of [
      { ...input, name: "Different" }, { ...input, source: "spotify_album" as const },
      { ...input, entries: [...entries].reverse() },
      { ...input, entries: [{ ...entries[0], durationSeconds: 1 }, entries[1]] },
    ]) expect(await store.put(accountA, id, changed)).toEqual({ status: "conflict" });
    expect(await store.get(accountA, id)).toEqual(detail);
    expect(await store.list(accountA)).toEqual([{
      id, name: "Draft", source: "file", entryCount: 2, createdAt: detail!.createdAt,
    }]);
    const persisted = await runtime.query("select entries from public.playlist_import_drafts where account_id = $1 and id = $2", [accountA, id]);
    expect(persisted.rows).toEqual([{ entries }]);
    expect(await store.get(accountB, id)).toBeNull();
    expect(await store.remove(accountB, id)).toBe(false);
    expect(await store.put(accountB, id, { ...input, source: "spotify_playlist" })).toMatchObject({ status: "created" });
    expect(await store.remove(accountA, id)).toBe(true);
    expect(await store.remove(accountA, id)).toBe(false);
    expect(await store.list(accountA)).toEqual([]);
    expect(await store.get(accountB, id)).toMatchObject({ source: "spotify_playlist" });
  });

  it("serializes concurrent replays and quotas per account without consuming another account's slots", async () => {
    const store = await loadStore();
    const sharedId = randomUUID();
    const initial = await Promise.all(Array.from({ length: 4 }, () => store.put(quotaAccount, sharedId, input)));
    expect(initial.map(({ status }) => status).sort()).toEqual(["created", "existing", "existing", "existing"]);
    const attempts = await Promise.all(Array.from({ length: 34 }, () => store.put(quotaAccount, randomUUID(), input)));
    expect(attempts.filter(({ status }) => status === "created")).toHaveLength(29);
    expect(attempts.filter(({ status }) => status === "limit")).toHaveLength(5);
    expect(await store.list(quotaAccount)).toHaveLength(30);
    expect(await store.put(quotaAccount, sharedId, input)).toMatchObject({ status: "existing" });
    expect(await store.put(quotaAccount, sharedId, { ...input, name: "Different" })).toEqual({ status: "conflict" });
    expect(await store.put(otherAccount, sharedId, { ...input, source: "spotify_liked" })).toMatchObject({ status: "created" });
    await expect(store.remove(quotaAccount, sharedId)).resolves.toBe(true);
    await expect(store.put(quotaAccount, randomUUID(), input)).resolves.toMatchObject({ status: "created" });
    expect(await store.list(quotaAccount)).toHaveLength(30);
    expect(await store.list(otherAccount)).toHaveLength(1);
  });

  it("rejects invalid draft metadata at both the store and database boundaries", async () => {
    const store = await loadStore();
    const insert = (rawEntries: unknown) => runtime.query(`
      insert into public.playlist_import_drafts (account_id, id, source, name, entries)
      values ($1, $2, 'file', 'Draft', $3::jsonb)
    `, [constraintAccount, randomUUID(), JSON.stringify(rawEntries)]);
    const excessive = Array.from({ length: 201 }, () => entries[0]);
    const extra = [{ ...entries[0], trackId: "not-metadata" }];
    for (const invalid of [[], excessive, extra, {}, [null], [{ ...entries[0], durationSeconds: "181" }]]) {
      await expect(insert(invalid)).rejects.toMatchObject({ code: "23514" });
    }
    for (const invalid of [[], excessive, extra]) {
      await expect(store.put(constraintAccount, randomUUID(), { ...input, entries: invalid })).rejects.toThrow();
    }
    expect(await store.list(constraintAccount)).toEqual([]);
    const max = Array.from({ length: 200 }, () => entries[0]);
    await expect(store.put(constraintAccount, randomUUID(), { ...input, source: "spotify_album", entries: max }))
      .resolves.toMatchObject({ status: "created", draft: { entryCount: 200 } });
  });

  it.each([
    { artist: "a".repeat(301), durationSeconds: 1 },
    { artist: "Artist", durationSeconds: 0 },
    { artist: "Artist", durationSeconds: 1.5 },
    { artist: "Artist", durationSeconds: 86_401 },
  ])("enforces import artist and duration bounds at the store boundary (%#)", async (invalid) => {
    const store = await loadStore();
    await expect(store.put(constraintAccount, randomUUID(), {
      ...input, entries: [{ title: "Track", ...invalid }],
    })).rejects.toThrow();
  });

  it.each([
    { artist: "a".repeat(301), durationSeconds: 1 },
    { artist: "Artist", durationSeconds: 0 },
    { artist: "Artist", durationSeconds: 1.5 },
    { artist: "Artist", durationSeconds: 86_401 },
  ])("enforces import artist and duration bounds at the database boundary (%#)", async (invalid) => {
    await expect(runtime.query(`
      insert into public.playlist_import_drafts (account_id, id, source, name, entries)
      values ($1, $2, 'file', 'Draft', $3::jsonb)
    `, [constraintAccount, randomUUID(), JSON.stringify([{ title: "Track", ...invalid }])]))
      .rejects.toMatchObject({ code: "23514" });
  });

  it("accepts the exact artist and duration bounds and unknown duration", async () => {
    const store = await loadStore();
    const boundaryEntries = [1, 86_400, null].map((durationSeconds) => ({
      artist: "a".repeat(300), title: "Track", durationSeconds,
    }));
    await expect(store.put(constraintAccount, randomUUID(), { ...input, entries: boundaryEntries }))
      .resolves.toMatchObject({ status: "created", draft: { entries: boundaryEntries } });
  });
});
