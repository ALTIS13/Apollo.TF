import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runId = process.env["TF_TEST_RUN_ID"];
const targets = [
  [process.env["TF_TEST_ADMIN_DATABASE_URL"], "postgres"],
  [process.env["TF_TEST_MIGRATOR_DATABASE_URL"], "apollo_tf_migrator"],
  [process.env["TF_TEST_RUNTIME_DATABASE_URL"], "apollo_tf_runtime"],
] as const;
const configured = Boolean(runId && targets.every(([url]) => url));
type Pool = ReturnType<typeof import("@workspace/db/pool").createTfPool>;

describe.skipIf(!configured)("playlist import selections on marked PG16", () => {
  const pools: Pool[] = [];
  const accounts = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
  const [accountA, accountB, boundsAccount, raceAccount, constraintsAccount] = accounts;
  const priorDatabaseUrl = process.env["DATABASE_URL"];
  const first = { candidateId: "one_a-1", evidenceRevision: "a".repeat(64) };
  const second = { candidateId: "two", evidenceRevision: "b".repeat(64) };
  const metadata = { artist: "Artist", title: "Track", durationSeconds: null };
  let runtime: Pool;
  let migrationResult: Awaited<ReturnType<typeof import("@workspace/db/migrations").runTfMigrations>>;
  let closeStorePool: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    if (!runId || !/^[a-z0-9_]{8,32}$/.test(runId)) throw new Error("Invalid disposable selection target");
    const databaseName = `apollo_tf_test_${runId}`;
    const ports = new Set<string>();
    for (const [raw, role] of targets) {
      if (!raw) throw new Error("Missing disposable selection target role");
      const url = new URL(raw);
      if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
        url.pathname !== `/${databaseName}` || decodeURIComponent(url.username) !== role ||
        url.search || url.hash) throw new Error("Expected marked loopback selection target and exact roles");
      ports.add(url.port || "5432");
    }
    if (ports.size !== 1) throw new Error("Disposable selection roles must share the same port");
    const { createTfPool } = await import("@workspace/db/pool");
    for (const [raw, role] of targets) {
      const pool = createTfPool(raw!, role === "apollo_tf_runtime" ? "runtime" : "migration");
      pools.push(pool);
      const { rows } = await pool.query<{ role: string; db: string; addr: string; port: number; version: number; marker: string }>(`
        select current_user::text as role, current_database()::text as db,
          host(inet_server_addr()) as addr, inet_server_port() as port,
          current_setting('server_version_num')::integer as version,
          shobj_description(oid, 'pg_database') as marker
        from pg_database where datname = current_database()
      `);
      expect(rows).toEqual([{
        role, db: databaseName, addr: "127.0.0.1", port: Number(new URL(raw!).port || "5432"),
        version: expect.any(Number), marker: `apollo.tf.integration-run:${runId}`,
      }]);
      expect(rows[0]!.version).toBeGreaterThanOrEqual(160000);
      expect(rows[0]!.version).toBeLessThan(170000);
    }
    const { runTfMigrations } = await import("@workspace/db/migrations");
    migrationResult = await runTfMigrations(pools[1]!);
    runtime = pools[2]!;
    process.env["DATABASE_URL"] = targets[2][0]!;
  }, 30_000);

  async function stores() {
    const { defaultPlaylistImportSelectionStore: selection } = await import("./playlist-import-selection-store.js");
    const { defaultPlaylistImportStore: draft } = await import("./playlist-import-store.js");
    const { pool } = await import("@workspace/db");
    closeStorePool = () => pool.end();
    return { selection, draft };
  }

  async function seedDraft(account: string, id: string, count: number) {
    const { draft } = await stores();
    expect(await draft.put(account, id, {
      name: "Draft", source: "file", entries: Array.from({ length: count }, () => metadata),
    })).toMatchObject({ status: "created" });
  }

  afterAll(async () => {
    try {
      if (runtime) await runtime.query(
        "delete from public.playlist_import_drafts where account_id = any($1::uuid[])", [accounts],
      );
    } finally {
      try {
        await Promise.all([...pools.map((pool) => pool.end()), closeStorePool?.()]);
      } finally {
        if (priorDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
        else process.env["DATABASE_URL"] = priorDatabaseUrl;
      }
    }
  });

  it("applies the selection migration once and grants only the necessary table and column privileges", async () => {
    expect([...migrationResult.alreadyApplied, ...migrationResult.applied].at(-1))
      .toBe("0008_playlist_import_selections.sql");
    const { runTfMigrations } = await import("@workspace/db/migrations");
    expect(await runTfMigrations(pools[1]!)).toMatchObject({ applied: [], alreadyApplied: expect.arrayContaining([
      "0007_playlist_import_drafts.sql", "0008_playlist_import_selections.sql",
    ]) });
    const { rows } = await runtime.query(`
      select tableowner,
        has_table_privilege(current_user, 'public.playlist_import_selections', 'SELECT') as can_read,
        (has_column_privilege(current_user, 'public.playlist_import_selections', 'account_id', 'INSERT') and
         has_column_privilege(current_user, 'public.playlist_import_selections', 'import_id', 'INSERT') and
         has_column_privilege(current_user, 'public.playlist_import_selections', 'position', 'INSERT') and
         has_column_privilege(current_user, 'public.playlist_import_selections', 'candidate_id', 'INSERT') and
         has_column_privilege(current_user, 'public.playlist_import_selections', 'evidence_revision', 'INSERT')) as can_insert,
        has_column_privilege(current_user, 'public.playlist_import_selections', 'selected_at', 'INSERT') as can_backdate,
        has_table_privilege(current_user, 'public.playlist_import_selections', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as broad_write,
        has_column_privilege(current_user, 'public.playlist_import_selections', 'candidate_id', 'UPDATE') as can_replace_candidate,
        has_column_privilege(current_user, 'public.playlist_import_selections', 'evidence_revision', 'UPDATE') as can_replace_revision,
        has_column_privilege(current_user, 'public.playlist_import_selections', 'selected_at', 'UPDATE') as can_refresh_time,
        (has_column_privilege(current_user, 'public.playlist_import_selections', 'account_id', 'UPDATE') or
         has_column_privilege(current_user, 'public.playlist_import_selections', 'import_id', 'UPDATE') or
         has_column_privilege(current_user, 'public.playlist_import_selections', 'position', 'UPDATE')) as can_move
      from pg_tables where schemaname = 'public' and tablename = 'playlist_import_selections'
    `);
    expect(rows).toEqual([{
      tableowner: "apollo_tf_migrator", can_read: true, can_insert: true, can_backdate: false, broad_write: false,
      can_replace_candidate: true, can_replace_revision: true, can_refresh_time: true, can_move: false,
    }]);
  });

  it("preserves exact retry time and replaces only the addressed account and position", async () => {
    const { selection, draft } = await stores();
    const id = randomUUID();
    await seedDraft(accountA, id, 2);
    await seedDraft(accountB, id, 2);
    expect(await selection.get(accountA, id, 0)).toBeNull();
    const original = await selection.put(accountA, id, 0, first, metadata);
    expect(original).toEqual({ ...first, selectedAt: expect.any(String) });
    expect(new Date(original!.selectedAt).toISOString()).toBe(original!.selectedAt);
    const replays = await Promise.all(Array.from({ length: 4 }, () => selection.put(accountA, id, 0, first, metadata)));
    expect(replays).toEqual(Array.from({ length: 4 }, () => original));
    expect(await selection.get(accountB, id, 0)).toBeNull();
    const otherAccount = await selection.put(accountB, id, 0, first, metadata);
    const otherPosition = await selection.put(accountA, id, 1, first, metadata);
    const replaced = await selection.put(accountA, id, 0, second, metadata);
    expect(replaced).toMatchObject(second);
    expect(Date.parse(replaced!.selectedAt)).toBeGreaterThan(Date.parse(original!.selectedAt));
    const revised = { ...second, evidenceRevision: first.evidenceRevision };
    const replacedRevision = await selection.put(accountA, id, 0, revised, metadata);
    expect(replacedRevision).toMatchObject(revised);
    expect(await selection.get(accountA, id, 0)).toEqual(replacedRevision);
    expect(await selection.get(accountA, id, 1)).toEqual(otherPosition);
    expect(await selection.get(accountB, id, 0)).toEqual(otherAccount);
    expect(await draft.remove(accountA, id)).toBe(true);
    expect(await selection.get(accountA, id, 0)).toBeNull();
    expect(await selection.get(accountA, id, 1)).toBeNull();
    expect(await selection.get(accountB, id, 0)).toEqual(otherAccount);
    expect(await selection.put(accountA, id, 0, first, metadata)).toBeNull();
  });

  it("rejects positions outside the current draft and accepts position 199 in a full draft", async () => {
    const { selection } = await stores();
    const small = randomUUID();
    const full = randomUUID();
    await seedDraft(boundsAccount, small, 2);
    await seedDraft(boundsAccount, full, 200);
    for (const pos of [-1, 0.5, 2, 199, 200]) {
      expect(await selection.put(boundsAccount, small, pos, first, metadata)).toBeNull();
      expect(await selection.get(boundsAccount, small, pos)).toBeNull();
    }
    expect(await selection.put(boundsAccount, full, 199, first, metadata)).toMatchObject(first);
    expect(await selection.put(boundsAccount, full, 200, first, metadata)).toBeNull();
    expect(await selection.put(randomUUID(), full, 0, first, metadata)).toBeNull();
  });

  it.each([
    { name: "shorter", entries: [metadata] },
    { name: "same length with changed metadata", entries: [metadata, { ...metadata, title: "Different track" }] },
  ])("rejects a stale selection after recreation ($name)", async ({ entries }) => {
    const { selection } = await stores();
    const id = randomUUID();
    await seedDraft(raceAccount, id, 2);
    const mutator = await runtime.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await mutator.query("begin");
      await mutator.query("select pg_advisory_xact_lock(hashtextextended('tf:playlist-import-drafts:' || $1::uuid::text, 0))", [raceAccount]);
      await mutator.query("delete from public.playlist_import_drafts where account_id = $1 and id = $2", [raceAccount, id]);
      await mutator.query(`
        insert into public.playlist_import_drafts (account_id, id, source, name, entries)
        values ($1, $2, 'file', 'Replacement', $3::jsonb)
      `, [raceAccount, id, JSON.stringify(entries)]);
      pending = selection.put(raceAccount, id, 1, first, metadata).catch((error: unknown) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
        const { rows } = await runtime.query<{ waiting: boolean }>(`
          select exists (select 1 from pg_locks where locktype = 'advisory' and not granted
            and database = (select oid from pg_database where datname = current_database())) as waiting
        `);
        waiting = rows[0]!.waiting;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
      await mutator.query("commit");
      expect(await pending).toBeNull();
      expect(await selection.get(raceAccount, id, 1)).toBeNull();
      const currentEntry = entries[1];
      if (currentEntry) {
        await expect(selection.put(raceAccount, id, 1, second, currentEntry)).resolves.toMatchObject(second);
      }
    } finally {
      try {
        await mutator.query("rollback");
      } finally {
        mutator.release();
        await pending;
      }
    }
  });

  it("enforces the composite parent and selection metadata constraints in PostgreSQL", async () => {
    const { selection } = await stores();
    const id = randomUUID();
    await seedDraft(constraintsAccount, id, 1);
    const insert = (account: string, pos: number, candidate: string, revision: string) => runtime.query(`
      insert into public.playlist_import_selections (account_id, import_id, position, candidate_id, evidence_revision)
      values ($1, $2, $3, $4, $5)
    `, [account, id, pos, candidate, revision]);
    await expect(insert(randomUUID(), 0, first.candidateId, first.evidenceRevision)).rejects.toMatchObject({ code: "23503" });
    await expect(insert(constraintsAccount, 200, first.candidateId, first.evidenceRevision)).rejects.toMatchObject({ code: "23514" });
    for (const candidateId of ["-bad", "UPPER", "x".repeat(65)]) {
      await expect(insert(constraintsAccount, 0, candidateId, first.evidenceRevision)).rejects.toMatchObject({ code: "23514" });
      await expect(selection.put(constraintsAccount, id, 0, { ...first, candidateId }, metadata)).rejects.toThrow();
    }
    for (const evidenceRevision of ["A".repeat(64), "a".repeat(63)]) {
      await expect(insert(constraintsAccount, 0, first.candidateId, evidenceRevision)).rejects.toMatchObject({ code: "23514" });
      await expect(selection.put(constraintsAccount, id, 0, { ...first, evidenceRevision }, metadata)).rejects.toThrow();
    }
    expect(await selection.get(constraintsAccount, id, 0)).toBeNull();
  });
});
