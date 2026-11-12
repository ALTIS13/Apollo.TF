import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TfSessionBoundary } from "@/auth/TfSessionBoundary";
import { TfAuthProvider } from "@/auth/tf-auth";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";
import Favorites from "./Favorites";

vi.mock("@/components/LikedCollection", () => ({ LikedCollection: () => null }));
vi.mock("@/components/PlaylistsCollection", () => ({ PlaylistsCollection: () => null }));
vi.mock("@/components/ProviderCandidatePanel", () => ({ ProviderCandidatePanel: () => null }));

const album = {
  id: "exactAlbum",
  title: "Night Sessions",
  artist: "The Quartet",
  trackCount: 51,
  thumbnailUrl: "https://i.scdn.co/image/album-art",
  providerUrl: "https://open.spotify.com/album/exactAlbum",
};
const track = {
  id: "exactTrack",
  title: "Last Train",
  artist: "The Quartet",
  duration: 203,
  providerUrl: "https://open.spotify.com/track/exactTrack",
  discNumber: 2,
  trackNumber: 1,
};
const albumsPath = "/api/spotify/albums?offset=0&limit=10";
const nextAlbumsPath = "/api/spotify/albums?offset=10&limit=10";
const tracksPath = "/api/spotify/albums/exactAlbum/tracks?offset=0&limit=50";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(respond: (url: string) => Response | Promise<Response>, entitled = true, collections = false) {
  const http = vi.fn<typeof fetch>((url) => {
    if (url === "/api/auth/me") {
      return Promise.resolve(json({
        accountId: "10000000-0000-4000-8000-000000000001",
        installationId: "20000000-0000-4000-8000-000000000002",
        entitlements: ["tf.search", ...(entitled ? ["tf.integrations"] : []), ...(collections ? ["tf.collections"] : [])],
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        csrfToken: "c".repeat(42) + "A",
      }));
    }
    if (url === "/api/spotify/liked?offset=0&limit=50") {
      return Promise.resolve(json({ offset: 0, limit: 50, total: 0, tracks: [] }));
    }
    return Promise.resolve(respond(String(url)));
  });
  vi.stubGlobal("fetch", http);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TfAuthProvider>
        <TfSessionBoundary><Favorites /></TfSessionBoundary>
      </TfAuthProvider>
    </QueryClientProvider>,
  );
  return { http, user: userEvent.setup() };
}

function connected(url: string) {
  if (url === "/api/spotify/status") return json({ connected: true, spotifyUserId: "owner" });
  throw new Error(`Unexpected request: ${url}`);
}

async function openAlbums(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Spotify" }));
  await user.click(await screen.findByRole("button", { name: "Альбомы" }));
}

afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.unstubAllGlobals();
});

describe("Spotify saved albums in Favorites", () => {
  it("reviews the paged album and saves only ordered unresolved metadata after confirmation", async () => {
    const { user, http } = setup((url) => {
      if (url === albumsPath) return json({ offset: 0, limit: 10, total: 1, albums: [album] });
      if (url === tracksPath) return json({ offset: 0, limit: 50, total: 51, tracks: [track, track] });
      if (url === "/api/spotify/albums/exactAlbum/tracks?offset=50&limit=50") {
        return json({ offset: 50, limit: 50, total: 51, tracks: [{ ...track, title: "Closer" }] });
      }
      if (url.startsWith("/api/collections/imports/")) return json({ draft: { id: url.split("/").at(-1), name: album.title,
        source: "spotify_album", entries: [], entryCount: 3, createdAt: "2026-11-12T12:00:00Z" } }, 201);
      return connected(url);
    }, true, true);
    await openAlbums(user);
    await user.click(await screen.findByRole("button", { name: /Night Sessions/ }));
    await user.click(await screen.findByRole("button", { name: "Импортировать метаданные" }));
    expect(await screen.findByText(/Недоступно.*48/)).toBeInTheDocument();
    expect(http.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    const puts = http.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(String(puts[0]?.[0])).toMatch(/^\/api\/collections\/imports\/[0-9a-f-]{36}$/);
    expect(JSON.parse(String(puts[0]?.[1]?.body))).toEqual({ name: album.title, source: "spotify_album", entries: [
      { title: "Last Train", artist: "The Quartet", durationSeconds: 203 },
      { title: "Last Train", artist: "The Quartet", durationSeconds: 203 },
      { title: "Closer", artist: "The Quartet", durationSeconds: 203 },
    ] });
    expect(new Headers(puts[0]?.[1]?.headers).has("X-CSRF-Token")).toBe(true);
    expect(http.mock.calls.every(([url]) => !String(url).includes("/api/tracks/"))).toBe(true);
  });

  it("loads only the active view, pages both levels, and links exact Spotify items without playback or matching", async () => {
    const { http, user } = setup((url) => {
      if (url === albumsPath) return json({ offset: 0, limit: 10, total: 11, albums: [{ ...album, id: "firstAlbum", title: "First Album", providerUrl: "https://open.spotify.com/album/firstAlbum" }] });
      if (url === nextAlbumsPath) return json({ offset: 10, limit: 10, total: 11, albums: [album] });
      if (url === tracksPath) return json({ offset: 0, limit: 50, total: 51, tracks: [{ ...track, id: "firstTrack", title: "First Track", providerUrl: "https://open.spotify.com/track/firstTrack", discNumber: 1 }] });
      if (url === "/api/spotify/albums/exactAlbum/tracks?offset=50&limit=50") return json({ offset: 50, limit: 50, total: 51, tracks: [track] });
      return connected(url);
    });
    await user.click(await screen.findByRole("button", { name: "Spotify" }));
    const albumsTab = await screen.findByRole("button", { name: "Альбомы" });
    expect(http.mock.calls.some(([url]) => String(url).includes("/spotify/albums"))).toBe(false);
    await user.click(albumsTab);
    await screen.findByRole("button", { name: /First Album/ });
    expect(http.mock.calls.some(([url]) => String(url).includes("/tracks?"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Следующая страница" }));
    const albumButton = await screen.findByRole("button", { name: /Night Sessions/ });
    const albumLink = screen.getByRole("link", { name: "Открыть в Spotify: Night Sessions" });
    expect(albumLink).toHaveAttribute("href", album.providerUrl);
    expect(albumLink.parentElement).toBe(albumButton.parentElement);
    await user.click(albumButton);
    expect(await screen.findByText("First Track")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть в Spotify: Night Sessions" })).toHaveAttribute("href", album.providerUrl);
    await user.click(screen.getByRole("button", { name: "Следующая страница" }));
    expect(await screen.findByText("Last Train")).toBeInTheDocument();
    expect(screen.getByText("3:23")).toBeInTheDocument();
    expect(screen.getByText("2.1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть в Spotify: Last Train" })).toHaveAttribute("href", track.providerUrl);
    expect(screen.queryByRole("button", { name: /Найти в TF|Скачать|Воспроизвести/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "К альбомам" }));
    expect(await screen.findByRole("button", { name: /Night Sessions/ })).toBeInTheDocument();
    expect(screen.queryByText("Last Train")).not.toBeInTheDocument();
    for (const [url, init] of http.mock.calls.filter(([url]) => String(url).includes("/spotify/albums"))) {
      expect(init).toMatchObject({ method: "GET", credentials: "include", signal: expect.any(AbortSignal) });
      expect(String(url)).not.toMatch(/sessionId|accountId/);
    }
    expect(http.mock.calls.every(([url]) => !String(url).includes("/api/tracks/"))).toBe(true);
  });

  it("keeps pagination when the first upstream page contains only skipped albums", async () => {
    const { user } = setup((url) => {
      if (url === albumsPath) return json({ offset: 0, limit: 10, total: 11, albums: [] });
      if (url === nextAlbumsPath) return json({ offset: 10, limit: 10, total: 11, albums: [album] });
      return connected(url);
    });
    await openAlbums(user);
    expect(await screen.findByText("На этой странице нет альбомов.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Следующая страница" }));
    expect(await screen.findByRole("button", { name: /Night Sessions/ })).toBeInTheDocument();
  });

  it("retries the failing list or detail request and renders a successful empty page", async () => {
    let albumReads = 0;
    let trackReads = 0;
    const { user } = setup((url) => {
      if (url === albumsPath) return ++albumReads === 1
        ? json({ error: "spotify_error", detail: "internal provider detail" }, 502)
        : json({ offset: 0, limit: 10, total: 1, albums: [album] });
      if (url === tracksPath) return ++trackReads === 1
        ? json({ error: "spotify_error", detail: "internal provider detail" }, 502)
        : json({ offset: 0, limit: 50, total: 0, tracks: [] });
      return connected(url);
    });
    await openAlbums(user);
    expect(await screen.findByRole("alert")).not.toHaveTextContent("internal provider detail");
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    await user.click(await screen.findByRole("button", { name: /Night Sessions/ }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("В альбоме нет треков.")).toBeInTheDocument();
    expect([albumReads, trackReads]).toEqual([2, 2]);
  });

  it("aborts a track request on back and an album request on leaving Spotify; late replies cannot sign out Apollo", async () => {
    let finishTracks!: (response: Response) => void;
    let finishAlbums!: (response: Response) => void;
    const { user, http } = setup((url) => {
      if (url === albumsPath) return json({ offset: 0, limit: 10, total: 11, albums: [album] });
      if (url === tracksPath) return new Promise((resolve) => { finishTracks = resolve; });
      if (url === nextAlbumsPath) return new Promise((resolve) => { finishAlbums = resolve; });
      return connected(url);
    });
    await openAlbums(user);
    await user.click(await screen.findByRole("button", { name: /Night Sessions/ }));
    const findSignal = (path: string) => http.mock.calls.find(([url]) => url === path)?.[1]?.signal;
    await waitFor(() => expect(findSignal(tracksPath)?.aborted).toBe(false));
    await user.click(screen.getByRole("button", { name: "К альбомам" }));
    expect(findSignal(tracksPath)?.aborted).toBe(true);
    await act(async () => finishTracks(json({ error: "unauthorized" }, 401)));
    await screen.findByRole("button", { name: /Night Sessions/ });
    await user.click(screen.getByRole("button", { name: "Следующая страница" }));
    await waitFor(() => expect(findSignal(nextAlbumsPath)?.aborted).toBe(false));
    await user.click(screen.getByRole("button", { name: "Apollo" }));
    expect(findSignal(nextAlbumsPath)?.aborted).toBe(true);
    await act(async () => finishAlbums(json({ offset: 10, limit: 10, total: 11, albums: [album] })));
    expect(screen.queryByText("Night Sessions")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Требуется вход" })).not.toBeInTheDocument();
  });

  it("refreshes the provider connection on not_connected without signing out Apollo", async () => {
    let connectedNow = true;
    const { user } = setup((url) => {
      if (url === "/api/spotify/status") return json({ connected: connectedNow, spotifyUserId: "owner" });
      if (url === albumsPath) {
        connectedNow = false;
        return json({ error: "not_connected" }, 401);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    await openAlbums(user);
    expect(await screen.findByText("Spotify не подключён.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Требуется вход" })).not.toBeInTheDocument();
  });

  it("does not load Spotify data without the integrations entitlement", async () => {
    const { http, user } = setup(connected, false);
    await user.click(await screen.findByRole("button", { name: "Spotify" }));
    expect(await screen.findByText(/недоступно для этого аккаунта/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Альбомы" })).not.toBeInTheDocument();
    expect(http.mock.calls.every(([url]) => !String(url).includes("/api/spotify/"))).toBe(true);
  });

  it("does not request saved albums without a confirmed Spotify owner", async () => {
    const { http, user } = setup((url) => {
      if (url === "/api/spotify/status") return json({ connected: true });
      throw new Error(`Unexpected request: ${url}`);
    });
    await openAlbums(user);
    expect(await screen.findByText("Не удалось подтвердить аккаунт Spotify.")).toBeInTheDocument();
    expect(http.mock.calls.some(([url]) => String(url).includes("/spotify/albums"))).toBe(false);
  });
});
