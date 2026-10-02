import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LikedTrack } from "@workspace/api-client-react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth } from "@/auth/tf-auth";
import { suspendTfProtectedActivity, TfApiError } from "@/lib/tf-session-client";
import { LikedCollection } from "./LikedCollection";

const player = vi.hoisted(() => ({ playTrack: vi.fn(), playCollection: vi.fn(), addToQueue: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-player", () => ({ usePlayer: () => player }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const clients: QueryClient[] = [];
const accountA = "10000000-0000-4000-8000-000000000001";
const accountB = "10000000-0000-4000-8000-000000000002";
const tracks: LikedTrack[] = [
  {
    trackId: "yt_first", title: "First", artist: "Artist", thumbnailUrl: null,
    durationSeconds: 180, likedAt: "2026-09-04T20:00:00.000Z",
  },
  {
    trackId: "sc_second", title: "Second", artist: "Artist", thumbnailUrl: null,
    durationSeconds: null, likedAt: "2026-09-04T20:00:00.000Z",
  },
];
const json = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { "Content-Type": "application/json" },
});

type TrackInput = { trackId: string; artist: string; title: string; thumbnailUrl: string | null; durationSeconds: number | null };

function fixture({ holdMove = false, holdRemove = false, initialRows = tracks, admit }: {
  holdMove?: boolean;
  holdRemove?: boolean;
  initialRows?: LikedTrack[];
  admit?: (track: TrackInput, index: number) => Promise<Response>;
} = {}) {
  let account = accountA;
  let installation = "20000000-0000-4000-8000-000000000001";
  let entitlements = ["tf.collections"];
  let token = "c".repeat(42) + "A";
  let rows = [...initialRows];
  let nextRows: LikedTrack[] = [];
  let nextCursor: string | null = null;
  const posted: TrackInput[] = [];
  let revision = 7;
  let finishMove: (() => void) | undefined;
  let finishRemove: (() => void) | undefined;
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/auth/me")) return json({
      accountId: account,
      installationId: installation,
      entitlements,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      csrfToken: token,
    });
    if (path.endsWith("/collections/liked/order") && init?.method === "PATCH") {
      if (holdMove) await new Promise<void>((resolve) => { finishMove = resolve; });
      const request = JSON.parse(String(init.body)) as {
        trackId: string; beforeTrackId: string | null; expectedRevision: string;
      };
      if (request.expectedRevision !== String(revision)) return new Response(
        JSON.stringify({ error: "liked_order_conflict", revision: String(revision) }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
      const source = rows.find((row) => row.trackId === request.trackId)!;
      rows = rows.filter((row) => row.trackId !== request.trackId);
      const before = request.beforeTrackId === null ? rows.length
        : rows.findIndex((row) => row.trackId === request.beforeTrackId);
      rows.splice(before, 0, source);
      return json({ revision: String(++revision) });
    }
    if (path.includes("/collections/liked?")) return json({
      items: path.includes("cursor=") ? nextRows : rows, nextCursor: path.includes("cursor=") ? null : nextCursor, revision: String(revision),
    });
    if (path.includes("/collections/liked/") && init?.method === "DELETE") {
      if (holdRemove) await new Promise<void>((resolve) => { finishRemove = resolve; });
      rows = rows.filter((row) => row.trackId !== decodeURIComponent(path.split("/").pop()!));
      revision += 1;
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("/collections/playlists/9/tracks") && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as TrackInput;
      posted.push(input);
      return admit ? admit(input, posted.length - 1) : admission(input);
    }
    if (path.endsWith("/playlists")) return json({ playlists: [{
      id: 9, name: "Focus", description: null, trackCount: posted.length,
      createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z",
    }] });
    if (path.endsWith("/auth/logout")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <TfAuthProvider>{children}</TfAuthProvider>
    </QueryClientProvider>
  );
  return {
    wrapper,
    client,
    fetchMock,
    posted,
    setRows: (next: LikedTrack[]) => { rows = next; },
    setNextRows: (next: LikedTrack[]) => { nextRows = next; },
    setNextCursor: (next: string | null) => { nextCursor = next; },
    finishMove: () => {
      if (!finishMove) throw new Error("No move is pending");
      finishMove();
    },
    finishRemove: () => {
      if (!finishRemove) throw new Error("No removal is pending");
      finishRemove();
    },
    switchAccount: () => { account = accountB; },
    changeScope: (kind: string) => {
      if (kind === "account") account = accountB;
      if (kind === "installation") installation = "20000000-0000-4000-8000-000000000002";
      if (kind === "entitlement") entitlements = [];
      if (kind === "session") token = "d".repeat(42) + "A";
    },
  };
}

function admission(track: TrackInput, added = true) {
  return json({ track: { ...track, position: 0, addedAt: "2026-09-23T00:00:00Z" }, added });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function AuthControls() {
  const auth = useTfAuth();
  return <>
    <button onClick={() => void auth.refresh()}>Refresh session</button>
    <button onClick={() => void auth.logout()}>Logout</button>
    <output aria-label="Auth state">{auth.status}:{auth.session?.accountId}:{auth.session?.installationId}:{auth.session?.csrfToken}:{auth.session?.entitlements.join(",")}</output>
  </>;
}

async function chooseTracks(user: ReturnType<typeof userEvent.setup>, titles: string[]) {
  await screen.findByText(titles[0]);
  await user.click(screen.getByRole("button", { name: "Выбрать треки" }));
  for (const title of titles) await user.click(screen.getByRole("checkbox", { name: `Выбрать ${title}` }));
}

async function selectTracks(user: ReturnType<typeof userEvent.setup>, titles: string[]) {
  await chooseTracks(user, titles);
  await user.click(screen.getByRole("button", { name: "Добавить выбранные в плейлист" }));
  return screen.findByRole("button", { name: /Focus/ });
}

beforeEach(() => {
  player.playTrack.mockReset().mockResolvedValue(undefined);
  player.playCollection.mockReset().mockResolvedValue(undefined);
  player.addToQueue.mockReset();
  toast.mockReset();
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps listening actions visible and exposes reorder controls only while editing", async () => {
  const f = fixture();
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await screen.findByText("Second");

  expect(screen.queryByRole("button", { name: "Переместить First" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Поднять First" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Опустить First" })).not.toBeInTheDocument();
  expect(screen.getByText("3:00")).toBeVisible();
  expect(screen.getByLabelText("Длительность неизвестна")).toBeVisible();
  for (const title of ["First", "Second"]) {
    expect(screen.getByRole("button", { name: `Воспроизвести ${title}` })).toBeVisible();
    expect(screen.getByRole("button", { name: `Добавить ${title} в плейлист` })).toBeVisible();
    expect(screen.getByRole("button", { name: `Удалить ${title}` })).toBeVisible();
  }
  const toggle = screen.getByRole("button", { name: "Изменить порядок" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await user.click(toggle);
  expect(screen.getByRole("button", { name: "Готово" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Переместить Second" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Поднять Second" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Опустить Second" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Воспроизвести First" }));
  expect(player.playTrack).toHaveBeenCalledWith(expect.objectContaining({ id: "yt_first" }));
  await user.click(screen.getByRole("button", { name: "Готово" }));
  expect(screen.queryByRole("button", { name: "Переместить Second" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("First");
  await user.click(screen.getByRole("button", { name: "Добавить First в плейлист" }));
  expect(await screen.findByRole("dialog", { name: "Добавить в плейлист" })).toBeVisible();
  expect(f.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/collections/liked/order"))).toBe(false);
});

it("reorders from the keyboard only after opting in and retains server order on exit", async () => {
  const f = fixture();
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await screen.findByText("Second");
  await user.click(screen.getByRole("button", { name: "Изменить порядок" }));
  screen.getByRole("button", { name: "Переместить Second" }).focus();
  await user.keyboard("{ArrowUp}");
  await waitFor(() => expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Second"));
  const move = f.fetchMock.mock.calls.find(([url]) => String(url).endsWith("/collections/liked/order"))!;
  expect(JSON.parse(String(move[1]?.body))).toEqual({
    trackId: "sc_second", beforeTrackId: "yt_first", expectedRevision: "7",
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Готово" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Готово" }));
  const rows = screen.getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("Second");
  expect(rows[1]).toHaveTextContent("First");
  expect(within(rows[0]).queryByRole("button", { name: "Переместить Second" })).not.toBeInTheDocument();
});

it("cannot exit editing or repeat a move while its request is pending", async () => {
  const f = fixture({ holdMove: true });
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await screen.findByText("Second");
  await user.click(screen.getByRole("button", { name: "Изменить порядок" }));
  await user.click(screen.getByRole("button", { name: "Поднять Second" }));
  const done = screen.getByRole("button", { name: "Готово" });
  await waitFor(() => expect(done).toBeDisabled());
  expect(screen.getByRole("button", { name: "Переместить Second" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Поднять Second" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Воспроизвести Second" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Добавить Second в плейлист" })).toBeEnabled();
  await user.click(done);
  expect(done).toHaveAttribute("aria-pressed", "true");
  await act(async () => { f.finishMove(); });
  await waitFor(() => expect(done).toBeEnabled());
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Second");
  await user.click(done);
  expect(screen.getByRole("button", { name: "Изменить порядок" })).toHaveAttribute("aria-pressed", "false");
});

it("resets editing on account change even when the next account has the same track IDs", async () => {
  const f = fixture();
  const user = userEvent.setup();
  function AccountSwitch() {
    const auth = useTfAuth();
    return <button type="button" onClick={() => {
      f.switchAccount();
      void auth.refresh();
    }}>Switch account</button>;
  }
  render(<><AccountSwitch /><LikedCollection /></>, { wrapper: f.wrapper });
  await screen.findByText("Second");
  await user.click(screen.getByRole("button", { name: "Изменить порядок" }));
  expect(screen.getByRole("button", { name: "Переместить Second" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Switch account" }));
  const toggle = await screen.findByRole("button", { name: "Изменить порядок" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await screen.findByText("Second");
  expect(screen.queryByRole("button", { name: "Переместить Second" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("First");
});

it("caps keyboard selection at 20 loaded IDs, prunes missing rows and clears on mode exit", async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({ ...tracks[0], trackId: `yt_${index}`, title: `Track ${index}` }));
  const f = fixture({ initialRows: rows });
  f.setNextCursor("next-page");
  f.setNextRows([{ ...tracks[0], trackId: "bc_next", title: "Next page" }]);
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await screen.findByText("Track 20");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Выбрать треки" }));
  expect(screen.getByRole("button", { name: "Изменить порядок" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Добавить выбранные в плейлист" })).toBeDisabled();
  screen.getByRole("checkbox", { name: "Выбрать Track 0" }).focus();
  await user.keyboard(" ");
  for (let index = 1; index < 20; index++) await user.click(screen.getByRole("checkbox", { name: `Выбрать Track ${index}` }));
  expect(screen.getByRole("checkbox", { name: "Выбрать Track 20" })).toBeDisabled();
  expect(screen.getByText("Выбрано: 20 / 20")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Ещё треки" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Ещё треки" })).not.toBeInTheDocument());
  expect(screen.getByRole("checkbox", { name: "Выбрать Next page" })).not.toBeChecked();
  f.setRows(rows.slice(1));
  await user.click(screen.getByRole("button", { name: "Обновить коллекцию" }));
  await waitFor(() => expect(screen.getByText("Выбрано: 19 / 20")).toBeVisible());
  expect(screen.getByRole("checkbox", { name: "Выбрать Track 20" })).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Завершить выбор" }));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Выбрать треки" }));
  expect(screen.getByText("Выбрано: 0 / 20")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Завершить выбор" }));
  await user.click(screen.getByRole("button", { name: "Изменить порядок" }));
  expect(screen.getByRole("button", { name: "Выбрать треки" })).toBeDisabled();
});

it("uses the newly chosen loaded set instead of a cancelled retry snapshot after selection changes", async () => {
  const held = deferred<Response>();
  const f = fixture({ initialRows: [...tracks, { ...tracks[0], trackId: "bc_third", title: "Third" }],
    admit: async (input, index) => index === 0 ? held.promise : admission(input) });
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await user.click(await selectTracks(user, ["First", "Second"]));
  await waitFor(() => expect(f.posted).toHaveLength(1));
  await user.keyboard("{Escape}");
  await act(async () => held.resolve(admission(f.posted[0])));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Выбрать First" })).toBeEnabled());
  await user.click(screen.getByRole("checkbox", { name: "Выбрать First" }));
  await user.click(screen.getByRole("checkbox", { name: "Выбрать Third" }));
  await user.click(screen.getByRole("button", { name: "Добавить выбранные в плейлист" }));
  const target = await screen.findByRole("button", { name: /Focus/ });
  expect(target).toBeEnabled();
  await user.click(target);
  await waitFor(() => expect(screen.getByText("Выбрано: 0 / 20")).toBeVisible());
  expect(f.posted.map((input) => input.trackId)).toEqual(["yt_first", "sc_second", "bc_third"]);
});

it("closing the picker leaves a sent admission uncertain and rechecks only the original selected IDs", async () => {
  const first = deferred<Response>();
  const rows = [tracks[0], { ...tracks[0], trackId: "yt_live", title: "First (Live)", durationSeconds: 232 }, tracks[1]];
  const f = fixture({ initialRows: rows, admit: async (input, index) => index === 0 ? first.promise : admission(input, false) });
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  const target = await selectTracks(user, ["First (Live)", "First"]);
  fireEvent.click(target);
  fireEvent.click(target);
  await waitFor(() => expect(f.posted).toHaveLength(1));
  expect(f.posted[0]).toEqual({ trackId: "yt_first", artist: "Artist", title: "First", thumbnailUrl: null, durationSeconds: 180 });
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByRole("textbox", { name: "Название нового плейлиста" })).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await act(async () => first.resolve(admission(f.posted[0])));
  await waitFor(() => expect(screen.getByRole("button", { name: "Завершить выбор" })).toBeEnabled());
  expect(f.posted).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Добавить выбранные в плейлист" }));
  await user.click(await screen.findByRole("button", { name: "Повторить неподтверждённые" }));
  await waitFor(() => expect(screen.getByText(/Уже были: 2/)).toBeVisible());
  expect(f.posted.map((input) => input.trackId)).toEqual(["yt_first", "yt_first", "yt_live"]);
  expect(f.posted[2]).toEqual({ trackId: "yt_live", artist: "Artist", title: "First (Live)", thumbnailUrl: null, durationSeconds: 232 });
  expect(screen.getByRole("checkbox", { name: "Выбрать First" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Выбрать First (Live)" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Выбрать Second" })).not.toBeChecked();
  expect(f.fetchMock.mock.calls.filter(([, init]) => ["DELETE", "PATCH"].includes(init?.method ?? ""))).toHaveLength(0);
});

it.each([
  { kind: "application error", status: 404, code: "playlist_not_found", global: false },
  { kind: "policy unavailable", status: 503, code: "policy_unavailable", global: true },
])("keeps partial confirmations and retries only the immutable remainder after $kind", async ({ status, code, global }) => {
  const rows = [...tracks, { ...tracks[0], trackId: "bc_third", title: "Third" }];
  const held = deferred<Response>();
  const failed = deferred<Response>();
  const f = fixture({ initialRows: rows, admit: async (input, index) => {
    if (index === 0) return held.promise;
    if (index === 1) return failed.promise;
    return admission(input, index !== 2);
  } });
  const user = userEvent.setup();
  render(<><AuthControls /><LikedCollection /></>, { wrapper: f.wrapper });
  const target = await selectTracks(user, ["Third", "Second", "First"]);
  fireEvent.click(target);
  fireEvent.click(target);
  await waitFor(() => expect(f.posted).toHaveLength(1));
  expect(screen.getByRole("button", { name: "Завершить выбор", hidden: true })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Выбрать Third", hidden: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Воспроизвести выбранные", hidden: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Добавить выбранные в очередь", hidden: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Удалить Third", hidden: true })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Добавить Third в плейлист", hidden: true })).not.toBeInTheDocument();
  const changedRows = rows.map((row) => ({ ...row, title: `${row.title} changed` }));
  f.setRows(changedRows);
  act(() => f.client.setQueryData(["tf", "liked", accountA], {
    pages: [{ items: changedRows, nextCursor: null, revision: "7" }], pageParams: [null],
  }));
  await act(async () => held.resolve(admission(f.posted[0])));
  await waitFor(() => expect(f.posted).toHaveLength(2));
  expect(f.posted[1]).toEqual({ trackId: "sc_second", artist: "Artist", title: "Second", thumbnailUrl: null, durationSeconds: null });
  expect(screen.getByRole("checkbox", { name: "Выбрать First changed", hidden: true })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Выбрать Second changed", hidden: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Завершить выбор", hidden: true })).toBeDisabled();
  await act(async () => failed.resolve(new Response(JSON.stringify({ error: code }), {
    status, headers: { "Content-Type": "application/json" },
  })));
  expect(f.posted.map((input) => input.trackId)).toEqual(["yt_first", "sc_second"]);
  if (global) {
    await waitFor(() => expect(screen.getByLabelText("Auth state")).toHaveTextContent("unavailable"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh session" }));
    await waitFor(() => expect(screen.getByLabelText("Auth state")).toHaveTextContent("authenticated"));
  } else {
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить трек");
    await user.keyboard("{Escape}");
  }
  expect(screen.getByText(/Добавлено: 1/)).toBeVisible();
  expect(screen.getByText(/Не подтверждено: 2/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Добавить выбранные в плейлист" }));
  await user.click(await screen.findByRole("button", { name: "Повторить неподтверждённые" }));
  await waitFor(() => expect(screen.getByText(/Не подтверждено: 0/)).toBeVisible());
  expect(f.posted.map((input) => input.trackId)).toEqual(["yt_first", "sc_second", "sc_second", "bc_third"]);
  expect(f.posted[3].title).toBe("Third");
  expect(f.posted[2].title).toBe("Second");
  expect(screen.getByText(/Уже были: 1/)).toBeVisible();
  expect(screen.getByText("Выбрано: 0 / 20")).toBeVisible();
});

it.each(["account", "installation", "entitlement", "session", "generation", "logout", "unmount"])(
  "stops a held batch on %s change without confirming an obsolete response or using replacement credentials",
  async (kind) => {
    const held = deferred<Response>();
    const f = fixture({ admit: async (input, index) => index === 0 ? held.promise : admission(input) });
    const user = userEvent.setup();
    const view = render(<><AuthControls /><LikedCollection /></>, { wrapper: f.wrapper });
    const target = await selectTracks(user, ["First", "Second"]);
    await user.click(target);
    await waitFor(() => expect(f.posted).toHaveLength(1));
    if (kind === "unmount") view.unmount();
    else if (kind === "generation") act(() => suspendTfProtectedActivity(new TfApiError(503, "policy_unavailable", "unavailable")));
    else if (kind === "logout") {
      fireEvent.click(screen.getByRole("button", { name: "Logout", hidden: true }));
      await waitFor(() => expect(screen.getByLabelText("Auth state")).toHaveTextContent("unauthenticated"));
    } else {
      f.changeScope(kind);
      fireEvent.click(screen.getByRole("button", { name: "Refresh session", hidden: true }));
      await waitFor(() => {
        const state = screen.getByLabelText("Auth state");
        if (kind === "account") expect(state).toHaveTextContent(accountB);
        if (kind === "installation") expect(state).toHaveTextContent("20000000-0000-4000-8000-000000000002");
        if (kind === "session") expect(state).toHaveTextContent("d".repeat(42) + "A");
        if (kind === "entitlement") expect(state).not.toHaveTextContent("tf.collections");
      });
    }
    await act(async () => held.resolve(admission(f.posted[0])));
    expect(f.posted.map((input) => input.trackId)).toEqual(["yt_first"]);
    if (["account", "installation"].includes(kind)) {
      await screen.findByText("Second");
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByText(/Добавлено: 1/)).not.toBeInTheDocument();
    }
    if (kind === "session") {
      expect(screen.getByRole("checkbox", { name: "Выбрать First" })).toBeChecked();
      expect(screen.queryByText(/Добавлено: 1/)).not.toBeInTheDocument();
    }
  },
);

it.each(["play", "append"])("selected queue %s uses selected-only full recordings in collection order without clearing selection", async (command) => {
  const f = fixture({ initialRows: [...tracks, {
    ...tracks[0], trackId: "dz_live", title: "First (Live)", artist: "Other artist",
    thumbnailUrl: "https://example.test/live.jpg", durationSeconds: 232,
  }] });
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await chooseTracks(user, ["First (Live)", "Second"]);
  const action = screen.getByRole("button", { name: command === "play" ? "Воспроизвести выбранные" : "Добавить выбранные в очередь" });
  if (command === "play") {
    action.focus();
    await user.keyboard(" ");
  } else {
    act(() => { fireEvent.click(action); fireEvent.click(action); });
    await waitFor(() => expect(action).toBeEnabled());
  }
  const expected = [
    { id: "sc_second", title: "Second", artist: "Artist", thumbnailUrl: null, duration: 0, source: "soundcloud", type: "original", quality: [], score: 0 },
    { id: "dz_live", title: "First (Live)", artist: "Other artist", thumbnailUrl: "https://example.test/live.jpg", duration: 232, source: "deezer", type: "original", quality: [], score: 0 },
  ];
  if (command === "play") {
    expect(player.playCollection).toHaveBeenCalledExactlyOnceWith(expected);
    expect(player.addToQueue).not.toHaveBeenCalled();
  } else {
    expect(player.addToQueue.mock.calls).toEqual([[expected[0]], [expected[1]]]);
    expect(player.playCollection).not.toHaveBeenCalled();
  }
  expect(player.playTrack).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox", { name: "Выбрать First" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Выбрать Second" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Выбрать First (Live)" })).toBeChecked();
  expect(screen.getByText("Выбрано: 2 / 20")).toBeVisible();
  expect(toast).not.toHaveBeenCalled();
  expect(f.fetchMock.mock.calls.filter(([, init]) => ["POST", "PATCH", "DELETE"].includes(init?.method ?? ""))).toHaveLength(0);
});

it.each(["empty", "entitlement", "generation", "deadline"])("selected queue suppresses playback and append for %s even before scheduled rendering", async (condition) => {
  const f = fixture();
  const user = userEvent.setup();
  render(<><AuthControls /><LikedCollection /></>, { wrapper: f.wrapper });
  await screen.findByText("First");
  await user.click(screen.getByRole("button", { name: "Выбрать треки" }));
  if (condition !== "empty") await user.click(screen.getByRole("checkbox", { name: "Выбрать First" }));
  const play = screen.getByRole("button", { name: "Воспроизвести выбранные" });
  const append = screen.getByRole("button", { name: "Добавить выбранные в очередь" });
  if (condition === "empty") {
    expect(play).toBeDisabled();
    expect(append).toBeDisabled();
  } else if (condition === "entitlement") {
    f.changeScope("entitlement");
    await user.click(screen.getByRole("button", { name: "Refresh session" }));
    await waitFor(() => expect(screen.getByLabelText("Auth state")).not.toHaveTextContent("tf.collections"));
  } else if (condition === "generation") {
    act(() => suspendTfProtectedActivity(new TfApiError(503, "policy_unavailable", "unavailable")));
  } else {
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600_000);
    expect(play).toBeEnabled();
    expect(append).toBeEnabled();
  }
  fireEvent.click(play);
  fireEvent.click(append);
  expect(player.playCollection).not.toHaveBeenCalled();
  expect(player.addToQueue).not.toHaveBeenCalled();
});

it.each(["resolve", "reject"])("selected queue blocks duplicate/conflicting commands until selected play %s settles, without audio success claims", async (settlement) => {
  const held = deferred<void>();
  player.playCollection.mockReturnValueOnce(held.promise);
  const f = fixture();
  f.setNextCursor("next-page");
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await chooseTracks(user, ["First", "Second"]);
  const play = screen.getByRole("button", { name: "Воспроизвести выбранные" });
  const append = screen.getByRole("button", { name: "Добавить выбранные в очередь" });
  act(() => {
    fireEvent.click(play);
    fireEvent.click(play);
    fireEvent.click(append);
    fireEvent.click(screen.getByRole("button", { name: "Воспроизвести First" }));
    fireEvent.click(screen.getByRole("button", { name: "Воспроизвести загруженные треки" }));
  });
  const conflicting = [
    "Воспроизвести выбранные", "Добавить выбранные в очередь", "Завершить выбор", "Изменить порядок",
    "Добавить выбранные в плейлист", "Удалить First", "Воспроизвести First", "Воспроизвести загруженные треки",
    "Обновить коллекцию", "Ещё треки",
  ];
  for (const name of conflicting) expect(screen.getByRole("button", { name })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Выбрать Second" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Добавить выбранные в плейлист" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(player.playCollection).toHaveBeenCalledTimes(1);
  expect(player.playTrack).not.toHaveBeenCalled();
  expect(player.addToQueue).not.toHaveBeenCalled();
  await act(async () => {
    if (settlement === "resolve") held.resolve(undefined);
    else held.reject(new Error("unexpected player rejection"));
  });
  await waitFor(() => expect(play).toBeEnabled());
  expect(screen.getByRole("checkbox", { name: "Выбрать First" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Выбрать Second" })).toBeChecked();
  expect(toast).not.toHaveBeenCalled();
  if (settlement === "reject") expect(screen.getByRole("alert")).toHaveTextContent("Не удалось");
  else expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("selected queue waits for a pending liked removal and ignores disappeared selected IDs", async () => {
  const f = fixture({ holdRemove: true });
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await chooseTracks(user, ["First", "Second"]);
  await user.click(screen.getByRole("button", { name: "Удалить First" }));
  const play = screen.getByRole("button", { name: "Воспроизвести выбранные" });
  const append = screen.getByRole("button", { name: "Добавить выбранные в очередь" });
  expect(play).toBeDisabled();
  expect(append).toBeDisabled();
  fireEvent.click(play);
  fireEvent.click(append);
  expect(player.playCollection).not.toHaveBeenCalled();
  expect(player.addToQueue).not.toHaveBeenCalled();
  await act(async () => f.finishRemove());
  await waitFor(() => expect(screen.getByText("Выбрано: 1 / 20")).toBeVisible());
  await user.click(append);
  expect(player.addToQueue).toHaveBeenCalledExactlyOnceWith({
    id: "sc_second", artist: "Artist", title: "Second", thumbnailUrl: null,
    duration: 0, source: "soundcloud", type: "original", quality: [], score: 0,
  });
});

it.each(["account", "installation", "session", "generation", "unmount"])("selected queue old %s completion cannot clear replacement selection or unlock a newer play", async (kind) => {
  const old = deferred<void>();
  const next = deferred<void>();
  player.playCollection.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const f = fixture();
  const user = userEvent.setup();
  const view = render(<><AuthControls /><LikedCollection /></>, { wrapper: f.wrapper });
  await chooseTracks(user, ["First"]);
  await user.click(screen.getByRole("button", { name: "Воспроизвести выбранные" }));
  expect(player.playCollection).toHaveBeenCalledTimes(1);
  if (kind === "unmount") {
    view.unmount();
    render(<><AuthControls /><LikedCollection /></>, { wrapper: f.wrapper });
    await screen.findByText("Second");
  } else {
    if (kind === "generation") act(() => suspendTfProtectedActivity(new TfApiError(503, "policy_unavailable", "unavailable")));
    else f.changeScope(kind);
    await user.click(screen.getByRole("button", { name: "Refresh session" }));
    await waitFor(() => {
      const state = screen.getByLabelText("Auth state");
      if (kind === "account") expect(state).toHaveTextContent(accountB);
      if (kind === "installation") expect(state).toHaveTextContent("20000000-0000-4000-8000-000000000002");
      if (kind === "session") expect(state).toHaveTextContent("d".repeat(42) + "A");
      if (kind === "generation") expect(screen.getByRole("button", { name: "Воспроизвести выбранные" })).toBeEnabled();
    });
    await screen.findByText("Second");
  }
  if (!screen.queryByRole("checkbox", { name: "Выбрать First" })) await user.click(screen.getByRole("button", { name: "Выбрать треки" }));
  const first = screen.getByRole("checkbox", { name: "Выбрать First" });
  if (first.getAttribute("aria-checked") === "true") await user.click(first);
  await user.click(screen.getByRole("checkbox", { name: "Выбрать Second" }));
  const play = screen.getByRole("button", { name: "Воспроизвести выбранные" });
  await user.click(play);
  expect(player.playCollection).toHaveBeenCalledTimes(2);
  await act(async () => {
    if (kind === "session") old.reject(new Error("obsolete failure"));
    else old.resolve(undefined);
  });
  expect(play).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Выбрать Second" })).toBeChecked();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => next.resolve(undefined));
  await waitFor(() => expect(play).toBeEnabled());
  expect(screen.getByRole("checkbox", { name: "Выбрать Second" })).toBeChecked();
});
