import { expect, it, vi } from "vitest";
import { redisFamilyWsPersistence } from "./tf-family-websocket.js";
import { wsFamilyFixture } from "./tf-family-websocket-test-support.js";
it("actual Redis adapter submits a three-key same-slot compare/deadline/one-time transition and rejects noninteger verdicts", async () => {
  const f = await wsFamilyFixture(),
    selection = (await f.consumer.authorizeWebSocket(f.handle)).selection;
  const evaluate = vi.fn(async () => 1 as unknown);
  const adapter = redisFamilyWsPersistence({
    get: async () => null,
    set: vi.fn(),
    eval: evaluate,
  });
  await expect(
    adapter.transition(
      "consume",
      selection,
      `tf-auth:{families}:ws-ticket:${"a".repeat(64)}`,
      "ticket-raw",
      f.now() + 30_000,
    ),
  ).resolves.toBe(true);
  const [script, keyCount, ...args] = evaluate.mock.calls[0] as unknown as [
    string,
    number,
    ...(string | number)[],
  ];
  expect(keyCount).toBe(3);
  expect(args.slice(0, 3).every((k) => String(k).includes("{families}"))).toBe(
    true,
  );
  expect(args.slice(3)).toEqual([
    "consume",
    selection.raw,
    selection.lineageRaw,
    "ticket-raw",
    f.now() + 30_000,
  ]);
  // Script intent only: execution and native concurrency are a separately recorded runtime gate.
  expect(script).toContain("redis.call('TIME')");
  expect(script).toContain("redis.call('DEL',KEYS[3])");
  expect(script).toContain("expiry > now+30000");
  expect(script).toContain("'NX'");
  for (const result of ["1", null, 2, -1]) {
    evaluate.mockResolvedValue(result);
    await expect(
      adapter.transition("confirm", selection, "", "", f.now() + 30_000),
    ).rejects.toMatchObject({ reason: "AUTHORITY_UNAVAILABLE" });
  }
  evaluate.mockResolvedValue(0);
  await expect(
    adapter.transition("confirm", selection, "", "", f.now() + 30_000),
  ).resolves.toBe(false);
});
it("ticket budget uses a dedicated hashed family key and fails closed on Redis ambiguity", async () => {
  const f = await wsFamilyFixture(),
    evaluate = vi.fn(async () => 11 as unknown);
  const adapter = redisFamilyWsPersistence({
    get: async () => null,
    set: vi.fn(),
    eval: evaluate,
  });
  await expect(adapter.allow(f.handle)).resolves.toBe(false);
  const args = evaluate.mock.calls[0] as unknown as unknown[];
  expect(args[2]).toMatch(/^tf-auth:\{families\}:ws-ticket-rate:[a-f0-9]{64}$/);
  expect(args[2]).not.toContain(f.handle);
  evaluate.mockResolvedValue("10");
  await expect(adapter.allow(f.handle)).rejects.toMatchObject({
    reason: "AUTHORITY_UNAVAILABLE",
  });
});
