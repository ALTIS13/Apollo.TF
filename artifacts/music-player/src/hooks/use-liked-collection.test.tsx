import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth } from "@/auth/tf-auth";
import { LikedCollection, SaveLikedTrackButton } from "@/components/LikedCollection";
import {
  useLikedCollection,
  useSaveLikedTrack,
  useLikedTrackLookup,
  likedCollectionKey,
} from "./use-liked-collection";

const accountA = "10000000-0000-4000-8000-000000000001";
const accountB = "10000000-0000-4000-8000-000000000002";
const item = {
  trackId: "yt_track",
  artist: "Artist",
  title: "Track",
  thumbnailUrl: null,
  durationSeconds: 180,
  likedAt: "2026-09-04T20:00:00.000Z",
};
const playCollection = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-player", () => ({ usePlayer: () => ({ playCollection, playTrack: vi.fn() }) }));
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

function fixture() {
  let account = accountA;
  let rows: (typeof item)[] = [];
  let revision = 0;
  const fetchMock = vi.fn(
    async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/auth/me"))
        return json({
          accountId: account,
          installationId: "20000000-0000-4000-8000-000000000001",
          entitlements: ["tf.collections"],
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          csrfToken: "c".repeat(42) + "A",
        });
      if (path.endsWith("/auth/logout"))
        return new Response(null, { status: 204 });
      if (path.endsWith("/collections/liked/lookup")) {
        const requested = JSON.parse(String(init?.body)) as { trackIds: string[] };
        return json({
          likedTrackIds: requested.trackIds.filter((id) =>
            rows.some((row) => row.trackId === id)),
        });
      }
      if (path.endsWith("/playlists"))
        return json({ playlists: [{ id: 7, name: "Evening", trackCount: 0 }] });
      if (path.endsWith("/playlists/7/tracks") && init?.method === "POST")
        return json({ added: true });
      if (path.endsWith("/collections/liked/order") && init?.method === "PATCH") {
        const move = JSON.parse(String(init.body)) as {
          trackId: string; beforeTrackId: string | null; expectedRevision: string;
        };
        if (move.expectedRevision !== String(revision))
          return new Response(JSON.stringify({ error: "liked_order_conflict", revision: String(revision) }), {
            status: 409, headers: { "Content-Type": "application/json" },
          });
        const source = rows.find((row) => row.trackId === move.trackId)!;
        rows = rows.filter((row) => row.trackId !== move.trackId);
        const before = move.beforeTrackId === null ? rows.length : rows.findIndex((row) => row.trackId === move.beforeTrackId);
        rows.splice(before, 0, source);
        revision += 1;
        return json({ revision: String(revision) });
      }
      if (init?.method === "PUT") {
        rows = [item];
        return json({ item });
      }
      if (init?.method === "DELETE") {
        rows = [];
        return new Response(null, { status: 204 });
      }
      return json({ items: rows, nextCursor: null, revision: String(revision) });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <TfAuthProvider>{children}</TfAuthProvider>
    </QueryClientProvider>
  );
  return {
    wrapper,
    client,
    fetchMock,
    setRows: (next: (typeof item)[]) => {
      rows = next;
    },
    switchAccount: () => {
      account = accountB;
      rows = [];
    },
  };
}

function setup() {
  const f = fixture();
  return {
    ...f,
    ...renderHook(
      () => ({
        auth: useTfAuth(),
        collection: useLikedCollection(),
        save: useSaveLikedTrack(),
      }),
      { wrapper: f.wrapper },
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  playCollection.mockClear();
});

it("plays the loaded liked tracks in order and adds one to an Apollo playlist", async () => {
  const f = fixture();
  f.setRows([item, { ...item, trackId: "sc_second", title: "Second" }]);
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await screen.findByText("Second");

  await user.click(screen.getByRole("button", { name: "Воспроизвести загруженные треки" }));
  expect(playCollection).toHaveBeenCalledWith([
    expect.objectContaining({ id: "yt_track", title: "Track" }),
    expect.objectContaining({ id: "sc_second", title: "Second" }),
  ]);

  await user.click(screen.getByRole("button", { name: "Добавить Track в плейлист" }));
  await user.click(await screen.findByRole("button", { name: /Evening/ }));
  await waitFor(() => expect(f.fetchMock.mock.calls.some(([url, init]) =>
    String(url).endsWith("/playlists/7/tracks") && init?.method === "POST"
  )).toBe(true));
  const add = f.fetchMock.mock.calls.find(([url]) => String(url).endsWith("/playlists/7/tracks"))!;
  expect(JSON.parse(String(add[1]?.body))).toMatchObject({ trackId: "yt_track", artist: "Artist", title: "Track" });
  expect(JSON.parse(String(add[1]?.body))).not.toHaveProperty("accountId");
});

it("moves a liked track in the account order and refreshes the visible list", async () => {
  const f = fixture();
  f.setRows([item, { ...item, trackId: "sc_second", title: "Second" }]);
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await screen.findByText("Second");
  await user.click(screen.getByRole("button", { name: "Поднять Second" }));
  await waitFor(() => {
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Second");
    expect(rows[1]).toHaveTextContent("Track");
  });
  const move = f.fetchMock.mock.calls.find(([url]) => String(url).endsWith("/collections/liked/order"))!;
  expect(move[1]?.method).toBe("PATCH");
  expect(move[1]?.credentials).toBe("include");
  expect(new Headers(move[1]?.headers).get("X-CSRF-Token")).toBe("c".repeat(42) + "A");
  expect(JSON.parse(String(move[1]?.body))).toEqual({
    trackId: "sc_second", beforeTrackId: "yt_track", expectedRevision: "0",
  });
});

it("saves/removes with current cookie/CSRF flow and invalidates the account collection", async () => {
  const { result, client, fetchMock } = setup();
  await waitFor(() =>
    expect(result.current.collection.query.isSuccess).toBe(true),
  );
  await act(async () => {
    await result.current.save.mutateAsync(item);
  });
  await waitFor(() => expect(result.current.collection.items).toHaveLength(1));
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
  expect(put[0]).toBe("/api/collections/liked/yt_track");
  expect(put[1]?.credentials).toBe("include");
  expect(new Headers(put[1]?.headers).get("X-CSRF-Token")).toBe(
    "c".repeat(42) + "A",
  );
  expect(JSON.parse(String(put[1]?.body))).not.toHaveProperty("accountId");
  expect(client.getQueryData(likedCollectionKey(accountA))).toBeDefined();
  await act(async () => {
    await result.current.collection.remove.mutateAsync(item.trackId);
  });
  await waitFor(() => expect(result.current.collection.items).toHaveLength(0));
  const deletion = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "DELETE",
  )!;
  expect(new Headers(deletion[1]?.headers).get("X-CSRF-Token")).toBe(
    "c".repeat(42) + "A",
  );
});

it("looks up search-result hearts in one current-account request and clears them on account switch", async () => {
  const f = fixture();
  f.setRows([item]);
  const { result } = renderHook(
    () => ({
      auth: useTfAuth(),
      lookup: useLikedTrackLookup(["yt_track", "sc_other"]),
    }),
    { wrapper: f.wrapper },
  );
  await waitFor(() =>
    expect(result.current.lookup.data?.likedTrackIds).toEqual(["yt_track"]),
  );
  const lookup = f.fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/collections/liked/lookup"))!;
  expect(lookup[1]?.method).toBe("POST");
  expect(new Headers(lookup[1]?.headers).get("X-CSRF-Token")).toBe(
    "c".repeat(42) + "A",
  );
  expect(JSON.parse(String(lookup[1]?.body))).toEqual({
    trackIds: ["sc_other", "yt_track"],
  });
  f.switchAccount();
  await act(async () => { await result.current.auth.refresh(); });
  await waitFor(() =>
    expect(result.current.lookup.data?.likedTrackIds).toEqual([]),
  );
  expect(f.client.getQueryData(["tf", "liked", accountA, "lookup", "sc_other", "yt_track"])).toBeUndefined();
});

it("toggles a previously saved search result through delete and idempotent save", async () => {
  const f = fixture();
  f.setRows([item]);
  function SearchHeart() {
    const lookup = useLikedTrackLookup([item.trackId]);
    return <SaveLikedTrackButton
      track={{
        id: item.trackId,
        artist: item.artist,
        title: item.title,
        thumbnailUrl: null,
        duration: 180,
        source: "youtube",
        type: "original",
        quality: [],
        score: 1,
      }}
      saved={lookup.data?.likedTrackIds.includes(item.trackId) ?? false}
      checking={lookup.isFetching && !lookup.data}
    />;
  }
  render(<SearchHeart />, { wrapper: f.wrapper });
  const removeButton = await screen.findByRole("button", { name: "Удалить из избранного" });
  expect(removeButton).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(removeButton);
  const saveButton = await screen.findByRole("button", { name: "Сохранить в избранное" });
  expect(saveButton).toHaveAttribute("aria-pressed", "false");
  expect(f.fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  fireEvent.click(saveButton);
  await waitFor(() => expect(screen.getByRole("button", { name: "Удалить из избранного" })).toHaveAttribute("aria-pressed", "true"));
  expect(f.fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
});

it("clears account A data on switch and account B data on logout", async () => {
  const { result, client, switchAccount } = setup();
  await waitFor(() =>
    expect(result.current.collection.query.isSuccess).toBe(true),
  );
  await act(async () => {
    await result.current.save.mutateAsync(item);
  });
  await waitFor(() => expect(result.current.collection.items).toHaveLength(1));
  switchAccount();
  await act(async () => {
    await result.current.auth.refresh();
  });
  await waitFor(() =>
    expect(result.current.auth.session?.accountId).toBe(accountB),
  );
  await waitFor(() =>
    expect(result.current.collection.query.isSuccess).toBe(true),
  );
  expect(result.current.collection.items).toEqual([]);
  expect(client.getQueryData(likedCollectionKey(accountA))).toBeUndefined();
  await act(async () => {
    await result.current.auth.logout();
  });
  expect(result.current.auth.status).toBe("unauthenticated");
  expect(client.getQueryData(likedCollectionKey(accountB))).toBeUndefined();
});

it("does not restore account A cache when a canceled response arrives after switching", async () => {
  const { result, client, fetchMock, switchAccount } = setup();
  await waitFor(() =>
    expect(result.current.collection.query.isSuccess).toBe(true),
  );
  let resolveOld!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveOld = resolve;
      }),
  );
  act(() => {
    void result.current.collection.query.refetch();
  });
  await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
  switchAccount();
  await act(async () => {
    await result.current.auth.refresh();
  });
  await waitFor(() =>
    expect(result.current.auth.session?.accountId).toBe(accountB),
  );
  await act(async () => {
    resolveOld(json({ items: [item], nextCursor: null }));
  });
  await waitFor(() =>
    expect(result.current.collection.query.isSuccess).toBe(true),
  );
  expect(result.current.collection.items).toEqual([]);
  expect(client.getQueryData(likedCollectionKey(accountA))).toBeUndefined();
});

it("loads the next page with the server cursor in the same account cache", async () => {
  const { result, fetchMock } = setup();
  await waitFor(() =>
    expect(result.current.collection.query.isSuccess).toBe(true),
  );
  fetchMock.mockImplementationOnce(async () =>
    json({ items: [item], nextCursor: "bGlrZWQ6Nw" }),
  );
  await act(async () => {
    await result.current.collection.query.refetch();
  });
  await waitFor(() =>
    expect(result.current.collection.query.hasNextPage).toBe(true),
  );
  fetchMock.mockImplementationOnce(async () =>
    json({ items: [{ ...item, trackId: "sc_second" }], nextCursor: null }),
  );
  await act(async () => {
    await result.current.collection.query.fetchNextPage();
  });
  await waitFor(() =>
    expect(result.current.collection.items.map((row) => row.trackId)).toEqual([
      "yt_track",
      "sc_second",
    ]),
  );
  expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(
    "/api/collections/liked?limit=50&cursor=bGlrZWQ6Nw&sort=manual",
  );
  expect(result.current.collection.query.hasNextPage).toBe(false);
});

it("does not let an old mutation 401 sign out the replacement account", async () => {
  const { result, fetchMock, switchAccount } = setup();
  await waitFor(() =>
    expect(result.current.collection.query.isSuccess).toBe(true),
  );
  let resolveOld!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveOld = resolve;
      }),
  );
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.save.mutateAsync(item).catch((error) => error);
  });
  await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
  switchAccount();
  await act(async () => {
    await result.current.auth.refresh();
  });
  await waitFor(() =>
    expect(result.current.auth.session?.accountId).toBe(accountB),
  );
  await act(async () => {
    resolveOld(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await pending;
  });
  expect(result.current.auth.status).toBe("authenticated");
  expect(result.current.auth.session?.accountId).toBe(accountB);
});

it("refreshes the original account collection after navigation unmounts a pending save", async () => {
  const { wrapper, fetchMock, setRows } = fixture();
  let save!: ReturnType<typeof useSaveLikedTrack>;
  function SaveHost() {
    save = useSaveLikedTrack();
    return null;
  }
  function CollectionHost() {
    const collection = useLikedCollection();
    return (
      <div data-testid="collection-size">
        {collection.query.isSuccess ? collection.items.length : "pending"}
      </div>
    );
  }
  const view = render(
    <>
      <CollectionHost />
      <SaveHost />
    </>,
    { wrapper },
  );
  await waitFor(() =>
    expect(screen.getByTestId("collection-size")).toHaveTextContent("0"),
  );
  let resolveSave!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveSave = resolve;
      }),
  );
  let pending!: Promise<unknown>;
  act(() => {
    pending = save.mutateAsync(item);
  });
  await waitFor(() => expect(resolveSave).toBeTypeOf("function"));
  view.rerender(
    <>
      <CollectionHost />
    </>,
  );
  await act(async () => {
    setRows([item]);
    resolveSave(json({ item }));
    await pending;
  });
  await waitFor(() =>
    expect(screen.getByTestId("collection-size")).toHaveTextContent("1"),
  );
});
