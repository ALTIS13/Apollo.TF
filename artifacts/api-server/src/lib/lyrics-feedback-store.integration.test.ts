import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runId = process.env["TF_TEST_RUN_ID"];
const adminUrl = process.env["TF_TEST_ADMIN_DATABASE_URL"];
const migratorUrl = process.env["TF_TEST_MIGRATOR_DATABASE_URL"];
const runtimeUrl = process.env["TF_TEST_RUNTIME_DATABASE_URL"];
const configured = Boolean(runId && adminUrl && migratorUrl && runtimeUrl);
type Pool = ReturnType<typeof import("@workspace/db/pool").createTfPool>;

describe.skipIf(!configured)("lyrics feedback real-store triage", () => {
  let adminPool: Pool;
  let migratorPool: Pool;
  let runtimePool: Pool;
  let reportId: number | undefined;

  beforeAll(async () => {
    if (!runId || !adminUrl || !migratorUrl || !runtimeUrl || !/^[a-z0-9_]{8,32}$/.test(runId)) {
      throw new Error("Invalid disposable lyrics feedback target");
    }
    const databaseName = `apollo_tf_test_${runId}`;
    for (const raw of [adminUrl, migratorUrl, runtimeUrl]) {
      const url = new URL(raw);
      if (url.hostname !== "127.0.0.1" || url.pathname !== `/${databaseName}`) {
        throw new Error("Lyrics feedback target must be a marked loopback database");
      }
    }
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
        select current_user::text as username,
          current_database()::text as database_name,
          host(inet_server_addr())::text as server_address,
          current_setting('server_version_num')::integer as server_version,
          shobj_description(d.oid, 'pg_database')::text as marker
        from pg_database d where d.datname = current_database()
      `);
      expect(identity.rows).toEqual([{
        username: user,
        database_name: databaseName,
        server_address: "127.0.0.1",
        server_version: expect.any(Number),
        marker: `apollo.tf.integration-run:${runId}`,
      }]);
      expect(identity.rows[0].server_version).toBeGreaterThanOrEqual(160000);
      expect(identity.rows[0].server_version).toBeLessThan(170000);
    }
    const { runTfMigrations } = await import("@workspace/db/migrations");
    await runTfMigrations(migratorPool);
  });

  afterAll(async () => {
    try {
      if (reportId !== undefined && adminPool) {
        await adminPool.query("delete from public.lyrics_feedback_events where feedback_id = $1", [reportId]);
        await adminPool.query("delete from public.lyrics_feedback where id = $1", [reportId]);
      }
    } finally {
      await Promise.all([adminPool, migratorPool, runtimePool].filter(Boolean).map((pool) => pool.end()));
      const { pool } = await import("@workspace/db");
      await pool.end();
    }
  });

  it("commits each transition with its audit event and rolls back an audit failure", async () => {
    const { recordLyricsFeedback, loadLyricsFeedbackTriage, updateLyricsFeedback } = await import("./lyrics-feedback-store.js");
    const trackId = `triage_${randomUUID()}`;
    const feedback = {
      accountId: "10000000-0000-4000-8000-000000000001",
      trackId,
      artist: "Artist",
      title: "Song",
      durationSeconds: 180,
      lyricsSource: "lrclib",
      reason: "out_of_sync",
    } as const;
    expect(await recordLyricsFeedback(feedback)).toBe("recorded");
    expect(await recordLyricsFeedback(feedback)).toBe("already_reported");
    const first = await runtimePool.query<{ id: number }>(
      "select id from public.lyrics_feedback where track_id = $1", [trackId],
    );
    const id = first.rows[0]?.id;
    if (!id) throw new Error("Missing inserted feedback");
    reportId = id;
    const open = await loadLyricsFeedbackTriage("open", null);
    expect(open.reports.find((row) => row.id === id)?.revision).toBe(1);

    const requestId = randomUUID();
    const reviewing = await updateLyricsFeedback(id, { status: "reviewing", expectedRevision: 1 }, requestId);
    expect(reviewing.kind).toBe("updated");
    if (reviewing.kind !== "updated") throw new Error("Missing review result");
    expect(reviewing.report.revision).toBe(2);
    expect(await updateLyricsFeedback(id, { status: "resolved", expectedRevision: 1, note: "Fixed lyrics" }, randomUUID())).toEqual({ kind: "conflict" });
    expect((await updateLyricsFeedback(id, { status: "reviewing", expectedRevision: 2 }, randomUUID())).kind).toBe("updated");
    const resolved = await updateLyricsFeedback(id, { status: "resolved", expectedRevision: 2, note: "Fixed lyrics" }, randomUUID());
    expect(resolved.kind).toBe("updated");
    expect((await loadLyricsFeedbackTriage("resolved", null)).reports.find((row) => row.id === id)?.resolutionNote).toBe("Fixed lyrics");

    await expect(updateLyricsFeedback(id, { status: "open", expectedRevision: 3 }, requestId)).rejects.toMatchObject({ cause: { code: "23505" } });
    const persisted = await runtimePool.query<{ status: string; revision: number }>(
      "select status, revision from public.lyrics_feedback where id = $1", [id],
    );
    expect(persisted.rows).toEqual([{ status: "resolved", revision: 3 }]);
    const events = await runtimePool.query<{ from_status: string; to_status: string }>(
      "select from_status, to_status from public.lyrics_feedback_events where feedback_id = $1 order by created_at, id", [id],
    );
    expect(events.rows).toEqual([
      { from_status: "open", to_status: "reviewing" },
      { from_status: "reviewing", to_status: "resolved" },
    ]);
    expect(await recordLyricsFeedback(feedback)).toBe("recorded");
    expect((await loadLyricsFeedbackTriage("open", null)).reports.find((row) => row.id === id)?.revision).toBe(4);
    const reopened = await runtimePool.query<{ from_status: string; to_status: string; operator_identity: string }>(
      "select from_status, to_status, operator_identity from public.lyrics_feedback_events where feedback_id = $1 order by created_at desc limit 1", [id],
    );
    expect(reopened.rows).toEqual([{ from_status: "resolved", to_status: "open", operator_identity: "listener-report" }]);
  });
});
