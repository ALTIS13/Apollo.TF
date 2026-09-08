import { createServer, IncomingMessage } from "node:http";
import { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { attachWebSocketServer, type WebSocketServerHandle } from "./ws.js";
import { ticketFixture } from "./lib/tf-family-websocket-test-support.js";

class Wire extends Duplex {
  chunks: Buffer[] = [];
  _read() {}
  _write(chunk: Buffer, _encoding: string, callback: () => void) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
  setTimeout() {
    return this;
  }
  setNoDelay() {
    return this;
  }
  setKeepAlive() {
    return this;
  }
  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
  message(value: unknown) {
    const body = Buffer.from(JSON.stringify(value)),
      mask = randomBytes(4);
    const size =
      body.length < 126
        ? Buffer.from([0x81, 0x80 | body.length])
        : Buffer.from([0x81, 0xfe, body.length >> 8, body.length & 255]);
    this.push(
      Buffer.concat([
        size,
        mask,
        Buffer.from(body.map((b, n) => b ^ mask[n % 4]!)),
      ]),
    );
  }
}
const handles: WebSocketServerHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
});
async function flush() {
  for (let n = 0; n < 12; n++) await new Promise((r) => setTimeout(r, 1));
}
async function fixture() {
  const t = await ticketFixture(),
    server = createServer();
  const legacy = {
    consumeWebSocketTicket: vi.fn(async () => null),
    observeSession: vi.fn(async () => null),
  };
  const platform = { introspect: vi.fn() };
  handles.push(
    attachWebSocketServer(server, {
      familyWebSocket: t.service,
      webOrigin: "https://tf.apollot.ru",
      sessionStore: legacy,
      platform,
      now: t.f.now,
    }),
  );
  async function connect(
    origin = "https://tf.apollot.ru",
    ticket?: string,
    cookie?: string,
  ) {
    ticket ??= await t.service.issue(t.f.handle, t.f.csrf, t.f.csrf);
    const wire = new Wire(),
      req = new IncomingMessage(wire as any);
    req.method = "GET";
    req.httpVersion = "1.1";
    req.url = `/api/ws?ticket=${ticket}`;
    req.headers = {
      host: "tf.apollot.ru",
      connection: "Upgrade",
      upgrade: "websocket",
      origin,
      "sec-websocket-version": "13",
      "sec-websocket-key": randomBytes(16).toString("base64"),
      cookie:
        cookie ??
        `__Host-apollo_tf_family=${t.f.handle}; __Host-apollo_tf_family_csrf=${t.f.csrf}`,
    };
    req.rawHeaders = Object.entries(req.headers).flat() as string[];
    server.emit("upgrade", req, wire, Buffer.alloc(0));
    await flush();
    return wire;
  }
  return { ...t, server, legacy, platform, connect };
}
const message = (title: string) => ({
  type: "player_state",
  track: {
    id: title,
    title,
    artist: "artist",
    thumbnailUrl: null,
    duration: 100,
  },
  position: 10,
  isPlaying: false,
});
it("actual native upgrade requires Origin before consume and never invokes legacy for family cookies", async () => {
  const t = await fixture();
  const ticket = await t.service.issue(t.f.handle, t.f.csrf, t.f.csrf);
  const wrong = await t.connect("https://foreign.invalid", ticket);
  expect(wrong.text()).toContain("403");
  expect(t.tickets.size).toBe(1);
  const valid = await t.connect(undefined, ticket);
  expect(valid.text()).toContain("101 Switching Protocols");
  expect(t.tickets.size).toBe(0);
  expect(t.legacy.consumeWebSocketTicket).not.toHaveBeenCalled();
});
it("two-way room traffic waits for sender AND recipient checks without validation lock cycles", async () => {
  const t = await fixture(),
    a = await t.connect(),
    b = await t.connect();
  expect(a.text()).toContain("101 Switching Protocols");
  expect(b.text()).toContain("101 Switching Protocols");
  const releases: Array<() => void> = [];
  t.f.hold(
    () =>
      new Promise<void>((r) => {
        releases.push(r);
      }),
  );
  a.message(message("from-a"));
  b.message(message("from-b"));
  await flush();
  expect(a.text()).not.toContain("from-b");
  expect(b.text()).not.toContain("from-a");
  expect(releases.length).toBe(2);
  for (let n = 0; n < 4; n++) {
    releases.splice(0).forEach((r) => r());
    await flush();
  }
  expect(a.text()).toContain("from-b");
  expect(b.text()).toContain("from-a");
});
it("shutdown during held room checks prevents late relay and releases all work", async () => {
  const t = await fixture(),
    a = await t.connect(),
    b = await t.connect();
  const releases: Array<() => void> = [];
  t.f.hold(
    () =>
      new Promise<void>((r) => {
        releases.push(r);
      }),
  );
  a.message(message("must-not-arrive"));
  await flush();
  await handles.pop()!.close();
  releases.forEach((r) => r());
  await flush();
  expect(b.text()).not.toContain("must-not-arrive");
  expect(a.destroyed && b.destroyed).toBe(true);
});
it("legacy sender cannot bypass a successor recipient's current capability check", async () => {
  const t = await fixture();
  const legacyTicket = {
    accountId: t.f.binding.account_id,
    sessionId: "44444444-4444-4444-8444-444444444444",
    sessionHandle: randomBytes(32).toString("base64url"),
    createdAt: new Date(t.f.now()).toISOString(),
    expiresAt: new Date(t.f.now() + 30_000).toISOString(),
  };
  const session = {
    id: legacyTicket.sessionId,
    accountId: legacyTicket.accountId,
    platformSessionId: t.f.binding.session_id,
    installationId: t.f.binding.installation_id,
    entitlements: ["tf.search"],
    expiresAt: t.f.result.access_expires_at,
    assertionExpiresAt: t.f.result.access_expires_at,
  };
  t.legacy.consumeWebSocketTicket.mockResolvedValue(legacyTicket as never);
  t.legacy.observeSession.mockResolvedValue({
    revision: "stable",
    session,
  } as never);
  t.platform.introspect.mockResolvedValue({
    active: true,
    accountId: session.accountId,
    sessionId: session.platformSessionId,
    installationId: session.installationId,
    accountStatus: "active",
    entitlements: ["tf.search"],
    expiresAt: session.expiresAt,
  });
  const legacy = await t.connect(
    undefined,
    randomBytes(32).toString("base64url"),
    `__Host-apollo_tf=${legacyTicket.sessionHandle}`,
  );
  const successor = await t.connect();
  expect(legacy.text()).toContain("101 Switching Protocols");
  expect(successor.text()).toContain("101 Switching Protocols");
  t.f.capabilities([]);
  legacy.message(message("denied-delivery"));
  await flush();
  expect(successor.text()).not.toContain("denied-delivery");
  expect(successor.text()).toContain("policy_revoked");
});
it("an exact short deadline deauthorizes even while its producer check is held", async () => {
  const t = await fixture();
  t.f.advance(299_000);
  const socket = await t.connect();
  expect(socket.text()).toContain("101 Switching Protocols");
  let release!: () => void;
  t.f.hold(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  socket.message(message("held-at-deadline"));
  await flush();
  t.f.advance(1000);
  await new Promise((r) => setTimeout(r, 1050));
  expect(socket.text()).toContain("access_revalidation_required");
  release();
  await flush();
  expect(
    t.f.requests.filter((r) => r.path.endsWith("/check")).at(-1)?.signal
      ?.aborted,
  ).toBe(true);
});
it("enforces four active successor sockets per family", async () => {
  const t = await fixture();
  for (let n = 0; n < 4; n++)
    expect((await t.connect()).text()).toContain("101 Switching Protocols");
  expect((await t.connect()).text()).toContain("503 Service Unavailable");
});
it("caps pending native upgrades at64 and shutdown aborts their held checks", async () => {
  const t = await fixture(),
    ticket = await t.service.issue(t.f.handle, t.f.csrf, t.f.csrf);
  const releases: Array<() => void> = [];
  t.f.hold(
    () =>
      new Promise<void>((r) => {
        releases.push(r);
      }),
  );
  const wires = await Promise.all(
    Array.from({ length: 65 }, () => t.connect(undefined, ticket)),
  );
  expect(
    wires.filter((w) => w.text().includes("503 Service Unavailable")),
  ).toHaveLength(1);
  expect(releases).toHaveLength(64);
  await handles.pop()!.close();
  releases.forEach((r) => r());
  await flush();
  expect(wires.slice(0, 64).every((w) => w.destroyed)).toBe(true);
  expect(wires.some((w) => w.text().includes("101 Switching Protocols"))).toBe(
    false,
  );
});
