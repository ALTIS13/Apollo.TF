import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as sessions from "./tf-session-store.js";

const opaque = () => randomBytes(32).toString("base64url");
function fixture() {
  let now = Date.now();
  const entries = new Map<
    string,
    { value: string; expiry: number; outbox: boolean }
  >();
  const persistence = {
    async read(key: string) {
      const e = entries.get(key);
      return e && e.expiry > now ? e.value : null;
    },
    async cas(
      key: string,
      expected: string | null,
      value: string,
      expiry: number,
      extend = false,
      outbox = false,
    ) {
      if ((await this.read(key)) !== expected) return false;
      const current = entries.get(key);
      entries.set(key, {
        value,
        expiry: extend || !current ? expiry : Math.min(current.expiry, expiry),
        outbox,
      });
      return true;
    },
    async pending() {
      return [...entries]
        .filter(([, e]) => e.outbox && e.expiry > now)
        .map(([key]) => key);
    },
  };
  const Store = (
    sessions as unknown as {
      TfFamilyStore: new (p: typeof persistence, clock: () => number) => any;
    }
  ).TfFamilyStore;
  expect(typeof Store).toBe("function");
  const store = new Store(persistence, () => now);
  const binding = {
    schema_version: 1,
    contract_id: "apollo.tf.session-renewal.v1",
    account_id: randomUUID(),
    session_id: randomUUID(),
    installation_id: randomUUID(),
    client_id: "apollo-tf-api",
    audience: "apollo-tf",
  };
  const response = () => ({
    ...binding,
    family_id: randomUUID(),
    generation: 0,
    renewal_reference: opaque(),
    absolute_expires_at: new Date(now + 3600_000).toISOString(),
    issued_at: new Date(Math.floor(now / 1000) * 1000).toISOString(),
    access_expires_at: new Date(now + 300_000).toISOString(),
    renew_after: new Date(now + 240_000).toISOString(),
    token: {
      access_token: "signed.test.assertion",
      token_type: "Bearer",
      expires_in: 300,
    },
  });
  return {
    store,
    binding,
    response,
    entries,
    advance(ms: number) {
      now += ms;
    },
  };
}
async function active(f: ReturnType<typeof fixture>) {
  const login = await f.store.createLogin();
  await f.store.beginEnrollment(
    login.handle,
    f.binding,
    "initial.assertion.value",
  );
  const claimed = await f.store.claim(login.handle);
  await f.store.complete(login.handle, claimed, f.response());
  return login;
}
describe("D05 family persistence state", () => {
  it("rejects completion at exact short-access expiry rather than persisting unusable success", async () => {
    const f = fixture();
    const login = await f.store.createLogin();
    await f.store.beginEnrollment(
      login.handle,
      f.binding,
      "initial.assertion.value",
    );
    const claimed = await f.store.claim(login.handle);
    await expect(
      f.store.complete(login.handle, claimed, {
        ...f.response(),
        access_expires_at: new Date(f.store.now()).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("retains renewable context after short expiry but never past family absolute cap", async () => {
    const f = fixture();
    const login = await active(f);
    f.advance(301_000);
    const record = await f.store.read(login.handle);
    expect(record.record.phase).toBe("ACTIVE");
    expect(Date.parse(record.record.result.access_expires_at)).toBeLessThan(
      Date.now() + 302_000,
    );
    f.advance(3600_000);
    expect(await f.store.read(login.handle)).toBeNull();
  });
  it("persists one operation across replica lease expiry and response-loss retry", async () => {
    const f = fixture();
    const login = await active(f);
    const first = await f.store.claim(login.handle);
    await expect(f.store.claim(login.handle)).rejects.toMatchObject({
      reason: "OPERATION_IN_PROGRESS",
    });
    f.advance(15_001);
    const second = await f.store.claim(login.handle);
    expect(second.record.operation.idempotencyKey).toBe(
      first.record.operation.idempotencyKey,
    );
    expect(second.record.operation.nonce).toBe(first.record.operation.nonce);
    expect(second.record.operation.attempts).toBe(2);
    expect(second.raw).not.toBe(first.raw);
  });
  it("rejects an old completion after logout, keeping no raw reference in the tombstone", async () => {
    const f = fixture();
    const login = await active(f);
    const old = await f.store.claim(login.handle);
    await f.store.close(login.handle, () => "encrypted-revoke-packet");
    const result = {
      ...old.record.result,
      generation: 1,
      renewal_reference: opaque(),
    };
    await expect(
      f.store.complete(login.handle, old, result),
    ).rejects.toMatchObject({ reason: "REFERENCE_SPENT" });
    const closed = await f.store.read(login.handle);
    expect(closed.record.phase).toBe("CLOSED");
    expect(closed.raw).not.toContain(result.renewal_reference);
    expect(closed.raw).not.toContain(old.record.result.renewal_reference);
  });
  it("rejects account substitution or extension of an existing absolute cap", async () => {
    const f = fixture();
    const login = await active(f);
    const op = await f.store.claim(login.handle);
    await expect(
      f.store.complete(login.handle, op, {
        ...op.record.result,
        account_id: randomUUID(),
        generation: 1,
        renewal_reference: opaque(),
      }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      f.store.complete(login.handle, op, {
        ...op.record.result,
        generation: 1,
        renewal_reference: opaque(),
        absolute_expires_at: new Date(Date.now() + 7 * 3600_000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("caps enrollment at eight hours and bounds retry to three attempts / sixty seconds", async () => {
    const f = fixture();
    const login = await f.store.createLogin();
    await f.store.beginEnrollment(
      login.handle,
      f.binding,
      "initial.assertion.value",
    );
    const first = await f.store.claim(login.handle);
    await expect(
      f.store.complete(login.handle, first, {
        ...f.response(),
        absolute_expires_at: new Date(Date.now() + 9 * 3600_000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 503 });
    f.advance(15_001);
    await f.store.claim(login.handle);
    f.advance(15_001);
    await f.store.claim(login.handle);
    f.advance(15_001);
    await expect(f.store.claim(login.handle)).rejects.toMatchObject({
      reason: "RETRY_EXPIRED",
    });
  });
});
