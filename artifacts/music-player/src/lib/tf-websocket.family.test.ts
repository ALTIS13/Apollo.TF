import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TfWebSocketLifecycle } from "./tf-websocket";
import {
  clearTfSessionSecurityState,
  commitTfSessionSecurityState,
  createWebSocketTicket,
  TfApiError,
} from "./tf-session-client";
const token = "a".repeat(42) + "A";
class Socket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  end(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}
const active: TfWebSocketLifecycle[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  clearTfSessionSecurityState();
  commitTfSessionSecurityState({
    accountId: "11111111-1111-4111-8111-111111111111",
    installationId: "22222222-2222-4222-8222-222222222222",
    entitlements: ["tf.search"],
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    csrfToken: token,
    renewalProfile: "renewal-v1",
  });
});
afterEach(() => {
  active.splice(0).forEach((l) => l.stop());
  clearTfSessionSecurityState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function flush() {
  for (let n = 0; n < 15; n++) await Promise.resolve();
}
function fixture(
  createTicket: (signal?: AbortSignal) => Promise<string> = async () => token,
  successor = true,
) {
  const sockets: Socket[] = [],
    terminal = vi.fn();
  const lifecycle = new TfWebSocketLifecycle({
    successor,
    createTicket,
    buildUrl: (t) => `wss://tf.apollot.ru/api/ws?ticket=${t}`,
    createSocket: () => {
      const s = new Socket();
      sockets.push(s);
      return s as unknown as WebSocket;
    },
    onMessage: vi.fn(),
    onTerminalError: terminal,
  });
  active.push(lifecycle);
  lifecycle.start();
  return { lifecycle, sockets, terminal };
}
it("successor normal reconnects stop after three attempts even if every socket opens briefly", async () => {
  const f = fixture();
  await flush();
  f.sockets[0].open();
  f.sockets[0].end();
  await vi.advanceTimersByTimeAsync(3000);
  f.sockets[1].open();
  f.sockets[1].end();
  await vi.advanceTimersByTimeAsync(6000);
  f.sockets[2].open();
  f.sockets[2].end();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.sockets).toHaveLength(3);
  expect(f.terminal).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "unavailable" }),
  );
});
it("successor attempt timeout cancels held ticket without letting a late result create a socket", async () => {
  let release!: (value: string) => void, signal: AbortSignal | undefined;
  const f = fixture((s) => {
    signal = s;
    return new Promise((r) => {
      release = r;
    });
  });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(signal?.aborted).toBe(true);
  expect(f.terminal).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "unavailable" }),
  );
  release(token);
  await flush();
  expect(f.sockets).toHaveLength(0);
});
it("SW1 healthy open beyond120s starts a fresh recovery window on close", async () => {
  const f = fixture();
  await flush();
  f.sockets[0].open();
  await vi.advanceTimersByTimeAsync(130_000);
  f.sockets[0].end();
  expect(f.terminal).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2999);
  expect(f.sockets).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.sockets).toHaveLength(2);
  expect(f.terminal).not.toHaveBeenCalled();
});
it("SW2 preserves the legacy Retry-After-derived delay and explicit lifecycle restart", async () => {
  let attempts = 0;
  const f = fixture(async () => {
    attempts++;
    throw new TfApiError(
      401,
      "expired",
      "expired",
      true,
      undefined,
      undefined,
      attempts === 1 ? 20 : 1,
    );
  }, false);
  await flush();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(attempts).toBe(2);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(attempts).toBe(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(attempts).toBe(3);
  f.lifecycle.stop();
  f.lifecycle.start();
  await flush();
  expect(attempts).toBe(4);
  await vi.advanceTimersByTimeAsync(3000);
  expect(attempts).toBe(5);
});
it.each([
  [4409, "access_revalidation_required", "expired"],
  [4401, "session_revoked", "unauthenticated"],
  [1006, "", "unavailable"],
])(
  "connected close%s maps to%s without guessing terminal revocation",
  async (code, reason, kind) => {
    const f = fixture();
    await flush();
    f.sockets[0].open();
    f.sockets[0].end(code as number, reason as string);
    expect(f.terminal).toHaveBeenCalledWith(expect.objectContaining({ kind }));
  },
);
it("real ticket client requires exact201/one canonical member, and forwards AbortSignal", async () => {
  const abort = new AbortController();
  const request = vi.fn(
    async () =>
      new Response(JSON.stringify({ ticket: token }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", request);
  await expect(createWebSocketTicket(abort.signal)).rejects.toMatchObject({
    kind: "invalid",
  });
  request.mockResolvedValue(
    new Response(JSON.stringify({ ticket: token, extra: true }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await expect(createWebSocketTicket(abort.signal)).rejects.toMatchObject({
    kind: "invalid",
  });
  request.mockResolvedValue(
    new Response(JSON.stringify({ ticket: token }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await expect(createWebSocketTicket(abort.signal)).resolves.toBe(token);
  expect(request.mock.calls.at(-1)?.[1]).toMatchObject({
    signal: abort.signal,
    credentials: "include",
  });
});
