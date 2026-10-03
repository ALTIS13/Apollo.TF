import { afterEach, expect, it, vi } from "vitest";
import { ticketFixture } from "./tf-family-websocket-test-support.js";
afterEach(() => vi.useRealTimers());
it("issues a canonical opaque ticket and only one concurrent consume can admit the checked family", async () => {
  const { f, service, tickets } = await ticketFixture();
  const ticket = await service.issue(f.handle, f.csrf, f.csrf);
  expect(Buffer.from(ticket, "base64url").byteLength).toBe(32);
  expect([...tickets.keys()][0]).toMatch(
    /^tf-auth:\{families\}:ws-ticket:[a-f0-9]{64}$/,
  );
  const raw = [...tickets.values()][0].raw;
  expect(raw).not.toContain(f.result.token.access_token);
  expect(raw).not.toContain(f.result.renewal_reference);
  expect(raw).not.toContain(f.csrf);
  const results = await Promise.allSettled([
    service.consume(ticket, f.handle, f.csrf),
    service.consume(ticket, f.handle, f.csrf),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(tickets.size).toBe(0);
});
it("wrong custody cannot burn a ticket or reach producer and the ticket expires exactly at30s", async () => {
  const { f, service, tickets } = await ticketFixture();
  const ticket = await service.issue(f.handle, f.csrf, f.csrf);
  const count = f.requests.length;
  await expect(
    service.consume(ticket, f.handle, "wrong"),
  ).rejects.toMatchObject({ reason: "ACCESS_DENIED" });
  expect(tickets.size).toBe(1);
  expect(f.requests.length).toBe(count);
  f.advance(30_000);
  await expect(service.consume(ticket, f.handle, f.csrf)).rejects.toMatchObject(
    { reason: "INVALID_REFERENCE" },
  );
});
it("rate exhaustion precedes producer work while invalid CSRF consumes no slot", async () => {
  const { f, service } = await ticketFixture();
  for (let n = 0; n < 12; n++)
    await expect(
      service.issue(f.handle, f.csrf, "wrong"),
    ).rejects.toMatchObject({ reason: "ACCESS_DENIED" });
  for (let n = 0; n < 10; n++) await service.issue(f.handle, f.csrf, f.csrf);
  const count = f.requests.length;
  await expect(service.issue(f.handle, f.csrf, f.csrf)).rejects.toMatchObject({
    reason: "RATE_LIMITED",
  });
  expect(f.requests.length).toBe(count);
});
it("a logout winning while producer check is held prevents ticket publication", async () => {
  const { f, service, tickets } = await ticketFixture();
  let release!: () => void;
  f.hold(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const issuing = service.issue(f.handle, f.csrf, f.csrf);
  for (let n = 0; n < 30; n++) await new Promise((r) => setTimeout(r, 1));
  await f.consumer.logout(f.handle);
  release();
  // The accepted consumer's terminal close CAS may lose to the already closed record.
  await expect(issuing).rejects.toMatchObject({
    reason: "AUTHORITY_UNAVAILABLE",
  });
  expect(tickets.size).toBe(0);
});
it("routine renewal cannot make a pinned old ticket/socket borrow the new JTI", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { f, service } = await ticketFixture();
  f.advance(239_000);
  vi.setSystemTime(f.now());
  const old = await service.issue(f.handle, f.csrf, f.csrf);
  const connected = await service.consume(
    await service.issue(f.handle, f.csrf, f.csrf),
    f.handle,
    f.csrf,
  );
  f.advance(1000);
  vi.setSystemTime(f.now());
  await f.consumer.renew(f.handle);
  await expect(service.consume(old, f.handle, f.csrf)).rejects.toMatchObject({
    reason: "REFERENCE_SPENT",
    terminal: false,
  });
  await expect(service.validate(connected)).rejects.toMatchObject({
    reason: "REFERENCE_SPENT",
    terminal: false,
  });
  const fresh = await service.consume(
    await service.issue(f.handle, f.csrf, f.csrf),
    f.handle,
    f.csrf,
  );
  expect(fresh.generation).toBe(1);
  expect(fresh.assertionJti).toBe(f.jti);
});
it("ticket ttl never exceeds checked short expiry, and policy denial never issues a ticket", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { f, service, tickets } = await ticketFixture();
  f.advance(299_000);
  vi.setSystemTime(f.now());
  await service.issue(f.handle, f.csrf, f.csrf);
  expect([...tickets.values()][0].expiry - f.now()).toBe(1000);
  f.capabilities([]);
  await expect(service.issue(f.handle, f.csrf, f.csrf)).rejects.toMatchObject({
    reason: "ACCESS_DENIED",
    status: 403,
  });
  expect(tickets.size).toBe(1);
});
