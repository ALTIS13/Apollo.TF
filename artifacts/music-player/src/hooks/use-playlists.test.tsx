import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth } from "@/auth/tf-auth";
import { PlaylistAction } from "@/components/PlaylistAction";
import { PlaylistsCollection } from "@/components/PlaylistsCollection";
import { useAddPlaylistTrack, useCreatePlaylist, usePlaylist, usePlaylists } from "./use-playlists";

const playCollection = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-player", () => ({ usePlayer: () => ({ playTrack: vi.fn(), playCollection }) }));

const accountA = "10000000-0000-4000-8000-000000000001";
const accountB = "10000000-0000-4000-8000-000000000002";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("creates a current-account playlist, adds an open-source track, and drops old data after account switch", async () => {
  let account = accountA;
  let playlists: Array<{ id: number; name: string; description: null; trackCount: number; createdAt: string; updatedAt: string }> = [];
  let tracks: Array<{ trackId: string; artist: string; title: string; thumbnailUrl: null; durationSeconds: number; position: number; addedAt: string }> = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/auth/me")) return json({
      accountId: account,
      installationId: "20000000-0000-4000-8000-000000000001",
      entitlements: ["tf.collections"],
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      csrfToken: "c".repeat(42) + "A",
    });
    if (path.endsWith("/collections/playlists") && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as { name: string };
      const playlist = { id: 1, name: input.name, description: null, trackCount: 0, createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z" };
      playlists = [playlist];
      return json({ playlist }, 201);
    }
    if (path.endsWith("/collections/playlists/1/tracks") && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as { trackId: string; artist: string; title: string; durationSeconds: number };
      const track = { ...input, thumbnailUrl: null, position: 0, addedAt: "2026-09-23T00:00:00Z" };
      tracks = [track];
      playlists = playlists.map((playlist) => ({ ...playlist, trackCount: 1 }));
      return json({ track, added: true });
    }
    if (path.endsWith("/collections/playlists/1")) return playlists[0]
      ? json({ playlist: playlists[0], tracks })
      : json({ error: "playlist_not_found" }, 404);
    if (path.endsWith("/collections/playlists")) return json({ playlists });
    throw Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><TfAuthProvider>{children}</TfAuthProvider></QueryClientProvider>;
  const { result, unmount } = renderHook(() => {
    const listing = usePlaylists();
    return {
      auth: useTfAuth(),
      playlists: listing,
      playlist: usePlaylist(listing.data?.playlists[0]?.id ?? null),
      create: useCreatePlaylist(),
      add: useAddPlaylistTrack(),
    };
  }, { wrapper });

  await waitFor(() => expect(result.current.playlists.data?.playlists).toEqual([]));
  await act(async () => { await result.current.create.mutateAsync("Night drive"); });
  await act(async () => { await result.current.add.mutateAsync({ playlistId: 1, track: { trackId: "yt_recording", artist: "Artist", title: "Song", thumbnailUrl: null, durationSeconds: 180 } }); });
  await waitFor(() => expect(result.current.playlist.data?.tracks[0]?.trackId).toBe("yt_recording"));
  expect(result.current.playlists.data?.playlists[0]?.trackCount).toBe(1);
  const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/collections/playlists/1/tracks") && init?.method === "POST")!;
  expect(post[1]?.credentials).toBe("include");
  expect(new Headers(post[1]?.headers).get("X-CSRF-Token")).toBe("c".repeat(42) + "A");
  expect(JSON.parse(String(post[1]?.body))).not.toHaveProperty("accountId");

  account = accountB;
  playlists = [];
  tracks = [];
  await act(async () => { await result.current.auth.refresh(); });
  await waitFor(() => expect(result.current.playlists.data?.playlists).toEqual([]));
  expect(result.current.playlist.data?.tracks).toBeUndefined();
  expect(client.getQueryData(["tf", "playlists", accountA])).toBeUndefined();

  unmount();
  const actionView = render(<PlaylistAction track={{ id: "yt_recording", artist: "Artist", title: "Song", thumbnailUrl: null, duration: 180, source: "youtube", type: "original", quality: [], score: 1 }} />, { wrapper });
  const openButton = await screen.findByRole("button", { name: "Добавить Song в плейлист" });
  await waitFor(() => expect(openButton).toBeEnabled());
  fireEvent.click(openButton);
  expect(await screen.findByRole("dialog", { name: "Добавить в плейлист" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Название нового плейлиста" }), { target: { value: "New set" } });
  fireEvent.click(screen.getByRole("button", { name: "Создать плейлист и добавить трек" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(playlists[0]?.name).toBe("New set");
  expect(tracks[0]?.trackId).toBe("yt_recording");
  actionView.unmount();
  render(<PlaylistsCollection />, { wrapper });
  fireEvent.click(await screen.findByRole("button", { name: /New set/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Слушать плейлист" }));
  expect(playCollection).toHaveBeenCalledWith([expect.objectContaining({ id: "yt_recording", title: "Song" })]);
});

it("moves a playlist track through the account API and renders the confirmed order", async () => {
  const playlist = { id: 9, name: "Focus", description: null, trackCount: 2, createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z" };
  let tracks = [
    { trackId: "yt_first", artist: "Artist", title: "First", thumbnailUrl: null, durationSeconds: 180, position: 0, addedAt: "2026-09-23T00:00:00Z" },
    { trackId: "sc_second", artist: "Artist", title: "Second", thumbnailUrl: null, durationSeconds: 210, position: 1, addedAt: "2026-09-23T00:00:00Z" },
  ];
  let failNextReorder = true;
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/auth/me")) return json({
      accountId: accountA,
      installationId: "20000000-0000-4000-8000-000000000001",
      entitlements: ["tf.collections"],
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      csrfToken: "c".repeat(42) + "A",
    });
    if (path.endsWith("/collections/playlists")) return json({ playlists: [playlist] });
    if (path.endsWith("/collections/playlists/9/tracks/order") && init?.method === "PATCH") {
      if (failNextReorder) {
        failNextReorder = false;
        return json({ error: "storage_unavailable" }, 500);
      }
      const { trackIds } = JSON.parse(String(init.body)) as { trackIds: string[] };
      tracks = trackIds.map((id, position) => ({ ...tracks.find((track) => track.trackId === id)!, position }));
      return json({ playlist, tracks });
    }
    if (path.endsWith("/collections/playlists/9")) return json({ playlist, tracks });
    throw Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><TfAuthProvider>{children}</TfAuthProvider></QueryClientProvider>;
  render(<PlaylistsCollection />, { wrapper });
  fireEvent.click(await screen.findByRole("button", { name: /Focus/ }));
  const items = await screen.findAllByRole("listitem");
  expect(within(items[0]).getByText("First")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Переместить First ниже" }));
  expect(await screen.findByText("Не удалось изменить порядок треков.")).toBeInTheDocument();
  expect(within(screen.getAllByRole("listitem")[0]).getByText("First")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Переместить First ниже" }));
  await waitFor(() => expect(within(screen.getAllByRole("listitem")[0]).getByText("Second")).toBeInTheDocument());
  const patch = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/collections/playlists/9/tracks/order") && init?.method === "PATCH")!;
  expect(JSON.parse(String(patch[1]?.body))).toEqual({ trackIds: ["sc_second", "yt_first"] });
  expect(new Headers(patch[1]?.headers).get("X-CSRF-Token")).toBe("c".repeat(42) + "A");
});
