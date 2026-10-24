import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PostgresSupabaseSessionLiveness } from "./supabase-identity.js";

const connectionString = process.env.SUPABASE_AUTH_TEST_DATABASE_URL;
const sessionId = process.env.SUPABASE_AUTH_TEST_SESSION_ID;
const subject = process.env.SUPABASE_AUTH_TEST_SUBJECT;
const describePostgres =
  connectionString && sessionId && subject
    ? describe.sequential
    : describe.skip;

describePostgres("Supabase strict session liveness", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: connectionString!,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 5_000,
      max: 2,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  test("accepts only the exact auth.sessions id and user pair", async () => {
    const liveness = new PostgresSupabaseSessionLiveness(pool);

    await expect(
      liveness.isLive({ sessionId: sessionId!, subject: subject! }),
    ).resolves.toBe(true);
    await expect(
      liveness.isLive({
        sessionId: "fa1abac6-cb9b-44d1-a94c-f3267a33f8b4",
        subject: subject!,
      }),
    ).resolves.toBe(false);
    await expect(
      liveness.isLive({
        sessionId: sessionId!,
        subject: "9e4aa69d-449c-4191-bf62-b4c64bd63e0b",
      }),
    ).resolves.toBe(false);
  });

  test("checker role cannot read unrelated auth session fields", async () => {
    await expect(
      pool.query("select private_marker from auth.sessions"),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
