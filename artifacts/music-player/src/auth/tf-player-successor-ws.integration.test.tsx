import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth, type TfAuthContextValue } from "./tf-auth";
import { TfSessionBoundary } from "./TfSessionBoundary";
import { PlayerProvider, usePlayer } from "@/hooks/use-player";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";
const A = "11111111-1111-4111-8111-111111111111",
  B = "33333333-3333-4333-8333-333333333333",
  token = "a".repeat(42) + "A";
let auth: TfAuthContextValue,
  player: ReturnType<typeof usePlayer>,
  identity: string,
  paths: string[];
let heldRenew: (() => Promise<Response>) | null;
let heldStream: (() => Promise<Response>) | null;
let heldPlay: (() => Promise<void>) | null;
class AudioDouble extends EventTarget {
  static all: AudioDouble[] = [];
  currentTime = 0;
  duration = 500;
  src = "";
  volume = 0.8;
  paused = true;
  constructor() {
    super();
    AudioDouble.all.push(this);
  }
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    await heldPlay?.();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  load() {}
}
class SocketDouble {
  static all: SocketDouble[] = [];
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    SocketDouble.all.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  end(code: number, reason: string) {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}
const json = (body: unknown, status = 200, profile = false) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(profile ? { "Apollo-TF-Session-Profile": "renewal-v1" } : {}),
    },
  });
function Probe() {
  auth = useTfAuth();
  player = usePlayer();
  return <span>{auth.status}</span>;
}
beforeEach(() => {
  vi.useFakeTimers();
  clearTfSessionSecurityState();
  identity = A;
  paths = [];
  heldRenew = null;
  heldStream = null;
  heldPlay = null;
  AudioDouble.all = [];
  SocketDouble.all = [];
  vi.stubGlobal("Audio", AudioDouble);
  vi.stubGlobal("WebSocket", SocketDouble);
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url, "https://tf.apollot.ru").pathname;
    paths.push(path);
    if (path.endsWith("/auth/me"))
      return json(
        {
          accountId: identity,
          installationId: "22222222-2222-4222-8222-222222222222",
          entitlements: ["tf.search"],
          csrfToken: token,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
        200,
        true,
      );
    if (path.endsWith("/renew-context")) return json({ csrf_token: token });
    if (path.endsWith("/auth/renew"))
      return heldRenew ? heldRenew() : new Response(null, { status: 204 });
    if (path.endsWith("/ws/tickets")) return json({ ticket: token }, 201);
    if (path.endsWith("/stream"))
      return heldStream
        ? heldStream()
        : json({ streamUrl: "https://media.invalid/test", expiresAt: null });
    return new Response(null, { status: 204 });
  });
});
afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function flush() {
  await act(async () => {
    for (let n = 0; n < 20; n++) await Promise.resolve();
  });
}
async function setup(enabled: boolean) {
  vi.stubEnv("VITE_APOLLO_TF_SUCCESSOR_WS_ENABLED", enabled ? "true" : "false");
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <TfAuthProvider>
        <TfSessionBoundary>
          <PlayerProvider>
            <Probe />
          </PlayerProvider>
        </TfSessionBoundary>
      </TfAuthProvider>
    </QueryClientProvider>,
  );
  await flush();
  return cache;
}
it("two-sided client opt-in is off unless explicitly enabled", async () => {
  await setup(false);
  expect(paths.some((p) => p.endsWith("/ws/tickets"))).toBe(false);
});
it("actual same-account short renewal replaces only the socket and preserves Audio/cache/queue", async () => {
  const cache = await setup(true);
  expect(SocketDouble.all).toHaveLength(1);
  SocketDouble.all[0].open();
  await act(async () => {
    await player.playTrack({
      id: "one",
      title: "Track",
      artist: "Artist",
      duration: 500,
      thumbnailUrl: null,
      source: "youtube",
      type: "original",
      quality: [],
      score: 1,
    });
  });
  const audio = AudioDouble.all[0],
    queue = player.queue;
  audio.currentTime = 76;
  const saved = { liked: ["one"] };
  cache.setQueryData(["saved"], saved);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(240_000);
  });
  await flush();
  expect(auth.status).toBe("authenticated");
  expect(AudioDouble.all).toEqual([audio]);
  expect(audio.currentTime).toBe(76);
  expect(player.queue).toBe(queue);
  expect(cache.getQueryData(["saved"])).toBe(saved);
  expect(SocketDouble.all).toHaveLength(2);
  expect(SocketDouble.all[0].readyState).toBe(3);
});
it("4409 uses non-manual recovery: timeout/focus cannot exceed BR1 budget, and old socket cannot invalidate B", async () => {
  await setup(true);
  expect(SocketDouble.all).toHaveLength(1);
  const old = SocketDouble.all[0];
  old.open();
  const lateClose = old.onclose;
  heldRenew = () => new Promise(() => {});
  await act(async () => {
    old.end(4409, "access_revalidation_required");
  });
  await flush();
  for (let n = 0; n < 3; n++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
  }
  expect(paths.filter((p) => p.endsWith("/auth/renew"))).toHaveLength(3);
  expect(auth.status).toBe("unavailable");
  heldRenew = null;
  identity = B;
  await act(async () => {
    await auth.refresh();
  });
  await flush();
  await act(async () => {
    lateClose?.({ code: 4401, reason: "session_revoked" } as CloseEvent);
  });
  expect(auth.status).toBe("authenticated");
  expect(auth.session?.accountId).toBe(B);
});
it("a delayed remote track completion cannot seek the renewed same-account Audio generation", async () => {
  await setup(true);
  const socket = SocketDouble.all[0];
  socket.open();
  let release!: (r: Response) => void;
  heldStream = () =>
    new Promise((r) => {
      release = r;
    });
  await act(async () => {
    socket.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "player_state",
          track: {
            id: "delayed",
            title: "Track",
            artist: "Artist",
            duration: 500,
            thumbnailUrl: null,
            source: "youtube",
          },
          position: 91,
          isPlaying: false,
        }),
      }),
    );
  });
  await flush();
  expect(paths.some((p) => p.endsWith("/stream"))).toBe(true);
  const audio = AudioDouble.all[0];
  await act(async () => {
    await auth.refresh();
  });
  await flush();
  await act(async () => {
    release(json({ streamUrl: "https://media.invalid/late", expiresAt: null }));
  });
  await flush();
  expect(AudioDouble.all).toEqual([audio]);
  expect(audio.currentTime).toBe(0);
});
it("a delayed remote load cannot start or seek after only its originating socket closes", async () => {
  await setup(true);
  const socket = SocketDouble.all[0];
  socket.open();
  let release!: (r: Response) => void;
  heldStream = () =>
    new Promise((r) => {
      release = r;
    });
  await act(async () => {
    socket.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "player_state",
          track: {
            id: "old-socket",
            title: "Track",
            artist: "Artist",
            duration: 500,
            thumbnailUrl: null,
            source: "youtube",
          },
          position: 91,
          isPlaying: true,
        }),
      }),
    );
  });
  await flush();
  await act(async () => {
    socket.end(1000, "");
  });
  await act(async () => {
    release(
      json({ streamUrl: "https://media.invalid/old-socket", expiresAt: null }),
    );
  });
  await flush();
  const audio = AudioDouble.all[0];
  expect(audio.src).toBe("");
  expect(audio.currentTime).toBe(0);
  expect(audio.paused).toBe(true);
});
it("a delayed old remote play promise cannot pause newer local playback", async () => {
  await setup(true);
  const socket = SocketDouble.all[0];
  socket.open();
  let release!: () => void;
  heldPlay = () =>
    new Promise((r) => {
      release = r;
    });
  await act(async () => {
    socket.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "player_state",
          track: {
            id: "old-play",
            title: "Track",
            artist: "Artist",
            duration: 500,
            thumbnailUrl: null,
            source: "youtube",
          },
          position: 91,
          isPlaying: false,
        }),
      }),
    );
  });
  await flush();
  expect(release).toBeTypeOf("function");
  await act(async () => {
    socket.end(1000, "");
  });
  heldPlay = null;
  await act(async () => {
    await player.playTrack({
      id: "new-play",
      title: "New",
      artist: "Artist",
      duration: 500,
      thumbnailUrl: null,
      source: "youtube",
      type: "original",
      quality: [],
      score: 1,
    });
  });
  const audio = AudioDouble.all[0];
  audio.currentTime = 17;
  await act(async () => {
    release();
  });
  await flush();
  expect(player.currentTrack?.id).toBe("new-play");
  expect(audio.paused).toBe(false);
  expect(audio.currentTime).toBe(17);
});
