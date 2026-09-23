import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { searchTracks } from "@workspace/api-client-react";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Discover from "@/pages/Discover";
import Favorites from "@/pages/Favorites";
import Home from "@/pages/Home";
import { TfAuthProvider } from "@/auth/tf-auth";
import { TfSessionBoundary } from "@/auth/TfSessionBoundary";
import {
  useSpotifyLogout,
  spotifyLoginUrl,
} from "@/hooks/use-spotify";
import { useYandexLogout } from "@/hooks/use-yandex";
import {
  canUseTfProtectedActivity,
  clearTfSessionSecurityState,
  commitTfSessionSecurityState,
  fetchTfSession,
  subscribeTfAuthSecurityEvents,
  tfRequestInit,
} from "./tf-session-client";

// Collection behavior is covered with the real auth provider in its own tests.
vi.mock("@/components/LikedCollection", () => ({
  LikedCollection: () => null,
  SaveLikedTrackButton: () => null,
}));

const CSRF_TOKEN = "c".repeat(42) + "A";
const session = {
  accountId: "10000000-0000-4000-8000-000000000001",
  installationId: "20000000-0000-4000-8000-000000000002",
  entitlements: ["tf.search", "tf.downloads"],
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  csrfToken: CSRF_TOKEN,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function queryWrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function authQueryWrapper({ children }: { children: ReactNode }) {
  return queryWrapper({ children: createElement(TfAuthProvider, null, children) });
}

async function loadActiveSession() {
  vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(session));
  commitTfSessionSecurityState(await fetchTfSession());
  vi.mocked(fetch).mockClear();
}

describe("TF API migration", () => {
  beforeEach(() => {
    clearTfSessionSecurityState();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads recommendations without a sessionId query and with credentials", async () => {
    await loadActiveSession();
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith("/auth/me") ? jsonResponse(session) : jsonResponse({ results: [] }),
    );

    render(createElement(Discover), { wrapper: authQueryWrapper });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/tracks/recommendations"))).toHaveLength(1));
    const [url, request] = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/tracks/recommendations"))!;
    const requestUrl = new URL(String(url), window.location.origin);

    expect(requestUrl.pathname).toBe("/api/tracks/recommendations");
    expect(requestUrl.searchParams.get("limit")).toBe("20");
    expect(requestUrl.searchParams.has("sessionId")).toBe(false);
    expect(request).toMatchObject({ credentials: "include" });
  });

  it("posts Spotify and Yandex logout with CSRF", async () => {
    await loadActiveSession();
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({})));
    const { result } = renderHook(
      () => ({ spotify: useSpotifyLogout(), yandex: useYandexLogout() }),
      { wrapper: queryWrapper },
    );

    await act(async () => {
      await result.current.spotify.mutateAsync();
      await result.current.yandex.mutateAsync();
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/spotify/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/yandex/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    for (const [, request] of vi.mocked(fetch).mock.calls) {
      expect(new Headers(request?.headers).get("X-CSRF-Token")).toBe(CSRF_TOKEN);
    }
  });

  it("navigates to Spotify login without sid", () => {
    const url = new URL(spotifyLoginUrl(), window.location.origin);

    expect(url.pathname).toBe("/api/spotify/login");
    expect(url.searchParams.has("sid")).toBe(false);
  });

  it("renders Yandex disconnected without accepting or transporting a provider token", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith("/auth/me")
        ? jsonResponse({ ...session, entitlements: [...session.entitlements, "tf.integrations"] })
        : jsonResponse({ connected: false }),
    );
    const user = userEvent.setup();

    render(createElement(TfAuthProvider, null,
      createElement(TfSessionBoundary, null, createElement(Favorites)),
    ), { wrapper: queryWrapper });
    await user.click(await screen.findByRole("button", { name: "Yandex Music" }));

    expect(await screen.findByText("Yandex Music не подключён.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "К подключениям" })).toHaveAttribute("href", "/integrations");
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain("/api/yandex/status");
    expect(screen.queryByPlaceholderText(/token/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Yandex Music" })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).not.toContain("/api/yandex/token");
  });

  it("preserves CSRF headers through generated searchTracks request options", async () => {
    await loadActiveSession();
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ query: "Artist Track", results: [], cached: false }));

    await searchTracks(
      { artist: "Artist", title: "Track" },
      tfRequestInit({ method: "POST" }),
    );

    expect(fetch).toHaveBeenCalledWith(
      "/api/tracks/search",
      expect.objectContaining({ credentials: "include" }),
    );
    const request = vi.mocked(fetch).mock.calls[0][1];
    expect(new Headers(request?.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(request?.headers).get("X-CSRF-Token")).toBe(CSRF_TOKEN);
  });

  it("reads CSRF at Home search mutation time instead of reusing a render snapshot", async () => {
    const firstToken = "a".repeat(42) + "A";
    const nextToken = "b".repeat(42) + "A";
    const firstSession = { ...session, csrfToken: firstToken };
    const nextSession = { ...session, csrfToken: nextToken };
    const user = userEvent.setup();

    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith("/auth/me")
        ? jsonResponse(firstSession)
        : jsonResponse({ query: "Artist Track", results: [], cached: false }),
    );

    render(createElement(Home), { wrapper: authQueryWrapper });
    await waitFor(() => expect(canUseTfProtectedActivity()).toBe(true));
    vi.mocked(fetch).mockClear();
    clearTfSessionSecurityState();
    await user.click(screen.getByRole("button", { name: "Точный" }));
    await user.type(screen.getByRole("textbox", { name: "Исполнитель" }), "Artist");
    await user.type(screen.getByRole("combobox", { name: "Название трека" }), "Track");
    await user.click(screen.getByRole("button", { name: "Найти" }));

    expect(await screen.findByText("Search Failed")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/tracks/search"))).toHaveLength(0);

    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith("/auth/me")
        ? jsonResponse(nextSession)
        : jsonResponse({ query: "Artist Track", results: [], cached: false }),
    );
    commitTfSessionSecurityState(await fetchTfSession());
    vi.mocked(fetch).mockClear();

    await user.click(screen.getByRole("button", { name: "Найти" }));

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/tracks/search"))).toHaveLength(1));
    const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/tracks/search"))![1];
    expect(new Headers(request?.headers).get("X-CSRF-Token")).toBe(nextToken);
  });

  it.each([
    [401, "unauthorized", "invalidated"],
    [403, "module_access_denied", "revalidate"],
    [503, "policy_unavailable", "unavailable"],
  ])("forwards generated search %s %s into the auth channel", async (status, code, eventType) => {
    await loadActiveSession();
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith("/auth/me")
        ? jsonResponse(session)
        : new Response(JSON.stringify({ error: code }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const events: Array<{ type: string; error: { code: string } }> = [];
    const unsubscribe = subscribeTfAuthSecurityEvents((event) => {
      events.push(event);
    });
    const user = userEvent.setup();

    render(createElement(Home), { wrapper: authQueryWrapper });
    await user.click(screen.getByRole("button", { name: "Точный" }));
    await user.type(screen.getByRole("textbox", { name: "Исполнитель" }), "Artist");
    await user.type(screen.getByRole("combobox", { name: "Название трека" }), "Track");
    await user.click(screen.getByRole("button", { name: "Найти" }));

    expect(await screen.findByText("Search Failed")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/tracks/search"))).toHaveLength(1);
    await waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      type: eventType,
      error: { status, code },
    });
    unsubscribe();
  });

  it("uses the generated search function without render-time request options", () => {
    const homeSource = readFileSync(path.resolve(import.meta.dirname, "../pages/Home.tsx"), "utf8");

    expect(homeSource).not.toMatch(/\buseSearchTracks\b/);
    expect(homeSource).toMatch(/searchTracks\(\s*data,\s*tfRequestInit\(\{\s*method:\s*"POST"\s*\}\),?\s*\)/s);
  });

  it("forwards WebSocket terminal errors into the auth channel", () => {
    const playerSource = readFileSync(path.resolve(import.meta.dirname, "../hooks/use-player.tsx"), "utf8");

    expect(playerSource).toMatch(/onTerminalError:\s*\(error\)\s*=>\s*\{/);
    expect(playerSource).toMatch(/reportTfAuthError\(error\)/);
  });

  it("contains no legacy identity transport in runtime TypeScript", () => {
    const srcDir = path.resolve(import.meta.dirname, "..");
    const runtimeFiles = readdirSync(srcDir, { recursive: true, withFileTypes: true })
      .filter((entry) =>
        entry.isFile()
        && /\.tsx?$/.test(entry.name)
        && !entry.name.includes(".test."))
      .map((entry) => path.join(entry.parentPath, entry.name));
    const legacyIdentity = [
      /getClientSessionId/,
      /X-Client-Session/,
      /trackfinder_session_id/,
      /\bsessionId\b/,
      /\bsid\b/,
    ];

    for (const file of runtimeFiles) {
      const source = readFileSync(file, "utf8");
      for (const identity of legacyIdentity) {
        expect(source, `${path.relative(srcDir, file)} contains ${identity}`).not.toMatch(identity);
      }
    }
  });

  it("contains no browser-managed Yandex provider-token flow in runtime TypeScript", () => {
    const srcDir = path.resolve(import.meta.dirname, "..");
    const runtimeFiles = readdirSync(srcDir, { recursive: true, withFileTypes: true })
      .filter((entry) =>
        entry.isFile()
        && /\.tsx?$/.test(entry.name)
        && !entry.name.includes(".test."))
      .map((entry) => path.join(entry.parentPath, entry.name));
    const providerTokenFlow = [
      /\/yandex\/token/i,
      /useYandexSaveToken/,
      /response_type=token/i,
      /(?:yandex.{0,40}token|token.{0,40}yandex)/i,
    ];

    for (const file of runtimeFiles) {
      const source = readFileSync(file, "utf8");
      for (const pattern of providerTokenFlow) {
        expect(source, `${path.relative(srcDir, file)} contains ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
