import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth, type TfAuthContextValue } from "./tf-auth";
import { TfSessionBoundary } from "./TfSessionBoundary";
import { PlayerProvider, usePlayer } from "@/hooks/use-player";
import {
  clearTfSessionSecurityState,
  reportTfAuthError,
  TfApiError,
  tfFetch,
} from "@/lib/tf-session-client";

const A = "11111111-1111-4111-8111-111111111111",
  B = "33333333-3333-4333-8333-333333333333";
const csrf = "a".repeat(42) + "A";
const track = {
  id: "track-one",
  title: "Track",
  artist: "Artist",
  duration: 500,
  thumbnailUrl: null,
  source: "youtube" as const,
  type: "original" as const,
  quality: [],
  score: 1,
};
const json = (body: unknown, status = 200, profile: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(profile ? { "Apollo-TF-Session-Profile": profile } : {}),
    },
  });
const snapshot = (
  accountId = A,
  entitlements = ["tf.search", "tf.collections"],
) => ({
  accountId,
  installationId: "22222222-2222-4222-8222-222222222222",
  entitlements,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  csrfToken: csrf,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
class ControlledAudio extends EventTarget {
  static instances: ControlledAudio[] = [];
  currentTime = 0;
  duration = 500;
  volume = 0.8;
  src = "";
  paused = true;
  constructor() {
    super();
    ControlledAudio.instances.push(this);
  }
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  load() {}
}
let auth: TfAuthContextValue, player: ReturnType<typeof usePlayer>;
let nextMe: (() => Promise<Response>) | null;
let nextRenew: (() => Promise<Response>) | null;
let paths: string[];
let identity: string, profile: string | null;
function Controls() {
  auth = useTfAuth();
  return <span data-testid="status">{auth.status}</span>;
}
function PlayerProbe() {
  player = usePlayer();
  return <span data-testid="track">{player.currentTrack?.id}</span>;
}
async function flush() {
  await act(async () => {
    for (let n = 0; n < 15; n++) await Promise.resolve();
  });
}
async function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={cache}>
      <TfAuthProvider>
        <Controls />
        <TfSessionBoundary>
          <PlayerProvider>
            <PlayerProbe />
          </PlayerProvider>
        </TfSessionBoundary>
      </TfAuthProvider>
    </QueryClientProvider>,
  );
  await flush();
  return { cache, ...rendered };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T12:00:00.000Z"));
  clearTfSessionSecurityState();
  paths = [];
  nextMe = null;
  nextRenew = null;
  identity = A;
  profile = "renewal-v1";
  ControlledAudio.instances = [];
  vi.stubGlobal("Audio", ControlledAudio);
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      constructor() {
        throw new Error("successor WS is gated");
      }
    },
  );
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url, "https://tf.apollot.ru").pathname;
    paths.push(path);
    if (path.endsWith("/auth/me"))
      return nextMe ? nextMe() : json(snapshot(identity), 200, profile);
    if (path.endsWith("/renew-context")) return json({ csrf_token: csrf });
    if (path.endsWith("/auth/renew"))
      return nextRenew ? nextRenew() : new Response(null, { status: 204 });
    if (path.endsWith("/stream"))
      return json({ streamUrl: "https://media.invalid/test", expiresAt: null });
    if (path.endsWith("/ws/tickets"))
      return json({ error: "websocket_unavailable" }, 503);
    return new Response(null, { status: 204 });
  });
});
afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("rendered browser renewal and actual player continuity", () => {
  it("Retry-After never schedules an attempt at or after the 60-second recovery boundary", async () => {
    await setup();
    nextRenew = async () => {
      const r = json({ code: "TF_RENEWAL_RATE_LIMITED", retryable: true }, 429);
      r.headers.set("Retry-After", "30");
      return r;
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400_000);
    });
    expect(paths.filter((p) => p.endsWith("/auth/renew"))).toHaveLength(2);
  });
  it("pre-expiry renew preserves mounted Audio, queue, position and query cache", async () => {
    const { cache } = await setup();
    await act(async () => {
      await player.playTrack(track);
    });
    const audio = ControlledAudio.instances[0],
      queue = player.queue;
    audio.currentTime = 73;
    audio.dispatchEvent(new Event("timeupdate"));
    await flush();
    const data = { liked: [track.id] };
    cache.setQueryData(["library"], data);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    await flush();
    expect(paths.filter((p) => p.endsWith("/auth/renew"))).toHaveLength(1);
    expect(auth.status).toBe("authenticated");
    expect(ControlledAudio.instances).toEqual([audio]);
    expect(player.queue).toBe(queue);
    expect(audio.currentTime).toBe(73);
    expect(audio.paused).toBe(false);
    expect(cache.getQueryData(["library"])).toBe(data);
    expect(paths.some((p) => p.endsWith("/ws/tickets"))).toBe(false);
  });
  it("reload with expired short401 performs exactly context -> renew -> me", async () => {
    let first = true;
    nextMe = async () =>
      first
        ? ((first = false), json({ error: "unauthorized" }, 401, "renewal-v1"))
        : json(snapshot(), 200, "renewal-v1");
    await setup();
    expect(auth.status).toBe("authenticated");
    expect(paths.slice(0, 4)).toEqual([
      "/api/auth/me",
      "/api/auth/renew-context",
      "/api/auth/renew",
      "/api/auth/me",
    ]);
  });
  it("sleep/focus/visibility/manual retry coalesce one renewal", async () => {
    await setup();
    const pending = deferred<Response>();
    nextRenew = () => pending.promise;
    vi.setSystemTime(new Date("2026-09-08T12:06:00.000Z"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      void auth.refresh();
    });
    await flush();
    expect(paths.filter((p) => p.endsWith("/auth/renew"))).toHaveLength(1);
    pending.resolve(new Response(null, { status: 204 }));
    await flush();
    expect(auth.status).toBe("authenticated");
  });
  it("outage pauses synchronously, preserves non-authorizing state and recovers only same identity", async () => {
    const { cache } = await setup();
    await act(async () => {
      await player.playTrack(track);
    });
    const audio = ControlledAudio.instances[0];
    audio.currentTime = 41;
    nextRenew = async () =>
      json({ code: "TF_RENEWAL_AUTHORITY_UNAVAILABLE", retryable: true }, 503);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    await flush();
    expect(audio.paused).toBe(true);
    expect(auth.status).toBe("unavailable");
    expect(screen.getByText("Сервис временно недоступен")).toBeInTheDocument();
    expect(() => player.togglePlayPause()).not.toThrow();
    expect(audio.paused).toBe(true);
    await expect(tfFetch("/tracks/protected")).rejects.toBeInstanceOf(
      TfApiError,
    );
    nextRenew = null;
    await act(async () => {
      await auth.refresh();
    });
    expect(auth.session?.accountId).toBe(A);
    expect(player.queue[0]?.id).toBe(track.id);
    expect(player.progress).toBe(41);
    expect(audio.paused).toBe(true);
    cache.setQueryData(["account-a"], "private");
    identity = B;
    await act(async () => {
      await auth.refresh();
    });
    expect(auth.session?.accountId).toBe(B);
    expect(player.queue).toEqual([]);
    expect(cache.getQueryData(["account-a"])).toBeUndefined();
  });
  it("deadline blocks playback even while renewal transport is pending", async () => {
    await setup();
    await act(async () => {
      await player.playTrack(track);
    });
    const audio = ControlledAudio.instances[0];
    const pending = deferred<Response>();
    nextRenew = () => pending.promise;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(audio.paused).toBe(true);
    expect(auth.hasEntitlement("tf.search")).toBe(false);
    await expect(tfFetch("/tracks/protected")).rejects.toBeInstanceOf(
      TfApiError,
    );
    pending.resolve(new Response(null, { status: 204 }));
    await flush();
  });
  it.each(["logout", "unmount"])(
    "late renewal cannot revive after %s",
    async (operation) => {
      const f = await setup();
      const pending = deferred<Response>();
      nextRenew = () => pending.promise;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(240_000);
      });
      if (operation === "logout")
        await act(async () => {
          await auth.logout();
        });
      else f.unmount();
      const before = paths.length;
      pending.resolve(new Response(null, { status: 204 }));
      await flush();
      expect(paths.slice(before)).not.toContain("/api/auth/me");
      if (operation === "logout") expect(auth.status).toBe("unauthenticated");
    },
  );
  it.each([null, "legacy-v1", "unknown"])(
    "non-successor401 (%s) never renews",
    async (value) => {
      profile = value;
      nextMe = async () => json({ error: "unauthorized" }, 401, value);
      await setup();
      expect(auth.status).toBe("unauthenticated");
      expect(paths).toEqual(["/api/auth/me"]);
    },
  );
  it("terminal renew401 stops the single recovery attempt without looping", async () => {
    nextMe = async () => json({ error: "unauthorized" }, 401, "renewal-v1");
    nextRenew = async () =>
      json({ code: "TF_RENEWAL_SESSION_REVOKED", retryable: false }, 401);
    await setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    expect(auth.status).toBe("unauthenticated");
    expect(paths.filter((p) => p.endsWith("/auth/renew"))).toHaveLength(1);
  });
  it("current capability403 stops Audio before an asynchronous revalidation finishes", async () => {
    await setup();
    await act(async () => {
      await player.playTrack(track);
    });
    const audio = ControlledAudio.instances[0];
    const pending = deferred<Response>();
    nextMe = () => pending.promise;
    act(() => {
      reportTfAuthError(
        new TfApiError(403, "module_access_denied", "forbidden"),
      );
      expect(audio.paused).toBe(true);
    });
    pending.resolve(json(snapshot(A, []), 200, "renewal-v1"));
    await flush();
    expect(auth.hasEntitlement("tf.search")).toBe(false);
  });
  it("protected ACCESS_EXPIRED recovers, not user logout", async () => {
    await setup();
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url, "https://tf.apollot.ru").pathname;
      paths.push(path);
      if (path.endsWith("/protected"))
        return json(
          { code: "TF_RENEWAL_ACCESS_EXPIRED", retryable: false },
          401,
        );
      if (path.endsWith("renew-context")) return json({ csrf_token: csrf });
      if (path.endsWith("/renew")) return new Response(null, { status: 204 });
      return json(snapshot(), 200, "renewal-v1");
    });
    await act(async () => {
      await tfFetch("/tracks/protected").catch(() => {});
    });
    await flush();
    expect(auth.status).toBe("authenticated");
    expect(paths.filter((p) => p.endsWith("/auth/renew"))).toHaveLength(1);
  });
  it("three retryable attempts exhaust the cycle; deadline and focus do not restart it", async () => {
    await setup();
    nextRenew = async () =>
      json({ code: "TF_RENEWAL_AUTHORITY_UNAVAILABLE", retryable: true }, 503);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(auth.status).toBe("unavailable");
    expect(paths.filter((p) => p.endsWith("/auth/renew"))).toHaveLength(3);
  });
  it("hidden idle tab does not keep its family alive and recovers on visibility", async () => {
    await setup();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301_000);
    });
    expect(paths.filter((p) => p.endsWith("/auth/renew"))).toHaveLength(0);
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(auth.status).toBe("authenticated");
    expect(paths.filter((p) => p.endsWith("/auth/renew"))).toHaveLength(1);
    visibility.mockRestore();
  });
  it("policy refresh to B wins over delayed renewal A", async () => {
    const { cache } = await setup();
    cache.setQueryData(["account-a"], "private");
    const pending = deferred<Response>();
    nextRenew = () => pending.promise;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    identity = B;
    act(() =>
      reportTfAuthError(
        new TfApiError(403, "module_access_denied", "forbidden"),
      ),
    );
    await flush();
    expect(auth.session?.accountId).toBe(B);
    const count = paths.length;
    pending.resolve(new Response(null, { status: 204 }));
    await flush();
    expect(paths).toHaveLength(count);
    expect(auth.session?.accountId).toBe(B);
    expect(cache.getQueryData(["account-a"])).toBeUndefined();
  });
  it("request timeout releases single-flight so deliberate retry can recover", async () => {
    await setup();
    const pending = deferred<Response>();
    nextRenew = () => pending.promise;
    await act(async () => {
      // Stop at the 10-second timeout, before the automatic retry at 251s.
      await vi.advanceTimersByTimeAsync(250_000);
    });
    expect(auth.status).toBe("unavailable");
    nextRenew = null;
    await act(async () => {
      await auth.refresh();
    });
    expect(auth.status).toBe("authenticated");
    const recoveredRequests = paths.length;
    pending.resolve(new Response(null, { status: 204 }));
    await flush();
    expect(paths).toHaveLength(recoveredRequests);
    expect(auth.status).toBe("authenticated");
  });
  it("renew capability403 is not presented as a dependency outage", async () => {
    await setup();
    nextRenew = async () =>
      json({ code: "TF_RENEWAL_ACCESS_DENIED", retryable: false }, 403);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    expect(auth.hasEntitlement("tf.search")).toBe(false);
    expect(screen.getByText("Модуль недоступен")).toBeInTheDocument();
    expect(
      screen.queryByText("Сервис временно недоступен"),
    ).not.toBeInTheDocument();
  });
  it("delayed stream cannot play after logout", async () => {
    await setup();
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("/stream")
        ? pending.promise
        : new Response(null, { status: 204 }),
    );
    let play!: Promise<void>;
    act(() => {
      play = player.playTrack(track);
    });
    await flush();
    const audio = ControlledAudio.instances[0];
    await act(async () => {
      await auth.logout();
    });
    pending.resolve(json({ streamUrl: "https://media.invalid/stale" }));
    await act(async () => {
      await play;
    });
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe("");
  });
  it("sleeping Audio timeupdate at expiry suspends before a focus event", async () => {
    await setup();
    await act(async () => {
      await player.playTrack(track);
    });
    const audio = ControlledAudio.instances[0];
    vi.setSystemTime(new Date("2026-09-08T12:06:00.000Z"));
    act(() => {
      audio.dispatchEvent(new Event("timeupdate"));
      expect(audio.paused).toBe(true);
    });
    await flush();
  });
  it("routine renewal invalidates a delayed stream without leaving loading stuck", async () => {
    await setup();
    const pending = deferred<Response>();
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
      url.endsWith("/stream") ? pending.promise : original(url, init),
    );
    let play!: Promise<void>;
    act(() => {
      play = player.playTrack(track);
    });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    pending.resolve(json({ streamUrl: "https://media.invalid/old" }));
    await act(async () => {
      await play;
    });
    expect(player.isLoading).toBe(false);
    expect(ControlledAudio.instances[0].paused).toBe(true);
  });
});
