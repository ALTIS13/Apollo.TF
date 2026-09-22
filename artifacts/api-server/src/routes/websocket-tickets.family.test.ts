import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { beforeAll, expect, it, vi } from "vitest";
import type { Express } from "express";
import { ticketFixture } from "../lib/tf-family-websocket-test-support.js";
let createApiApp: (typeof import("../app.js"))["createApiApp"];
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
  ({ createApiApp } = await import("../app.js"));
});
async function request(
  app: Express,
  headers: Record<string, string>,
  raw?: string[],
) {
  const req = new IncomingMessage(new Socket());
  req.method = "POST";
  req.url = "/api/ws/tickets";
  req.headers = headers;
  req.rawHeaders = raw ?? Object.entries(headers).flat();
  const res = new ServerResponse(req);
  return new Promise<{
    status: number;
    body: any;
    headers: ReturnType<typeof res.getHeaders>;
  }>((resolve) => {
    res.end = function (chunk?: unknown) {
      resolve({
        status: res.statusCode,
        body: JSON.parse(chunk?.toString() ?? "null"),
        headers: res.getHeaders(),
      });
      return res;
    } as typeof res.end;
    app(req, res);
    req.push(null);
  });
}
async function fixture(enabled = true) {
  const { f, service, tickets } = await ticketFixture();
  const legacy = {
    getSession: vi.fn(),
    observeSession: vi.fn(),
    createTransaction: vi.fn(),
    consumeTransaction: vi.fn(),
    createSession: vi.fn(),
    refreshSession: vi.fn(),
    revokeSession: vi.fn(),
    issueProviderOAuthState: vi.fn(),
    consumeProviderOAuthState: vi.fn(),
    issueWebSocketTicket: vi.fn(),
  };
  const app = createApiApp({
    nodeEnv: "test",
    familyWebSocket: enabled ? service : undefined,
    auth: {
      platform: f.platform,
      renewal: f.consumer,
      sessionStore: legacy,
      webOrigin: "https://tf.apollot.ru",
      secureCookies: true,
    },
  });
  const headers = {
    origin: "https://tf.apollot.ru",
    "x-csrf-token": f.csrf,
    cookie: `__Host-apollo_tf_family=${f.handle}; __Host-apollo_tf_family_csrf=${f.csrf}`,
  };
  return { f, app, legacy, tickets, headers };
}
it("actual app issues exact successor201 through Origin/CSRF/current tf.search without legacy storage", async () => {
  const f = await fixture();
  const response = await request(f.app, f.headers);
  expect(response.status).toBe(201);
  expect(Object.keys(response.body)).toEqual(["ticket"]);
  expect(
    Buffer.from(response.body.ticket, "base64url").toString("base64url"),
  ).toBe(response.body.ticket);
  expect(f.legacy.issueWebSocketTicket).not.toHaveBeenCalled();
  expect(f.tickets.size).toBe(1);
});
it("disabled family WS and malformed/foreign requests cannot fall back or call producer", async () => {
  const disabled = await fixture(false);
  const before = disabled.f.requests.length;
  expect((await request(disabled.app, disabled.headers)).status).toBe(503);
  expect(disabled.f.requests.length).toBe(before);
  const f = await fixture();
  const count = f.f.requests.length;
  for (const headers of [
    { ...f.headers, origin: "https://foreign.invalid" },
    { ...f.headers, "x-csrf-token": "wrong" },
    { ...f.headers, "content-length": "2" },
  ]) {
    expect([400, 403]).toContain((await request(f.app, headers)).status);
  }
  expect(f.f.requests.length).toBe(count);
  expect(f.legacy.issueWebSocketTicket).not.toHaveBeenCalled();
});
it("successor ticket route keeps short expiry finite and capability denial distinct from outage", async () => {
  const f = await fixture();
  f.f.capabilities([]);
  expect((await request(f.app, f.headers)).body).toEqual({
    code: "TF_RENEWAL_ACCESS_DENIED",
    retryable: false,
  });
  f.f.fail({
    code: "TF_RENEWAL_ACCESS_EXPIRED",
    status: 401,
    retryable: false,
  });
  const expired = await request(f.app, f.headers);
  expect(expired.status).toBe(401);
  expect(expired.body.code).toBe("TF_RENEWAL_ACCESS_EXPIRED");
  expect(expired.headers["set-cookie"]).toBeUndefined();
  f.f.fail({
    code: "TF_RENEWAL_AUTHORITY_UNAVAILABLE",
    status: 503,
    retryable: true,
  });
  expect((await request(f.app, f.headers)).status).toBe(503);
});
